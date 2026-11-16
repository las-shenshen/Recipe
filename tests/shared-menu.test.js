'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')

// Run: node --test tests/shared-menu.test.js
// SDK contract supplied by the main agent: throwOnNotFound:false makes a missing
// transaction doc.get() return {data:null}; existing data is an object, and
// runTransaction resolves to the callback result. This is NOT a live SDK test.
// The memory DB models atomic version validation/retry, not SDK retry timing,
// retry budgets, permissions, deployment, or multi-document isolation.
// cleanRecipe is an injected whitelist in factory tests; entry tests use the
// actual entry's sanitizer. wx storage is copied on read/write like serialization.
const ROOT = path.resolve(__dirname, '..')
const DATE = '2026-11-11'
const OTHER_DATE = '2026-11-12'
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const recipe = id => ({ id, name: `Dish ${id}`, emoji: '🥗', color: '#abcdef', category: '蔬菜', time: 15 })
const emptyDay = (date = DATE, revision = 0) => ({ date, meals: { breakfast: [], lunch: [], dinner: [] }, history: [], revision })

function loadModule(relative, mocks = {}, globals = {}) {
  const filename = path.join(ROOT, relative)
  const module = { exports: {} }
  const context = vm.createContext({
    module, exports: module.exports,
    require(name) {
      assert.ok(Object.hasOwn(mocks, name), `Unexpected require: ${name}`)
      return mocks[name]
    },
    ...globals
  })
  new vm.Script(fs.readFileSync(filename, 'utf8'), { filename }).runInContext(context)
  return module.exports
}

function memoryDatabase() {
  const records = new Map()
  const stats = { transactions: 0, attempts: 0, conflicts: 0, commits: 0, queries: 0 }
  let barrier = null
  const version = id => records.get(id)?.version || 0
  const checkCollection = name => assert.equal(name, 'shared_daily_menus')
  const db = {
    command: { in: dates => ({ values: clone(dates) }) },
    collection(name) {
      checkCollection(name)
      return { where: query => ({ limit: limit => ({ async get() {
        stats.queries++
        return { data: [...records.values()].map(record => clone(record.data))
          .filter(day => query.date.values.includes(day.date)).slice(0, limit) }
      } }) }) }
    },
    async runTransaction(callback) {
      stats.transactions++
      for (let attempt = 0; attempt < 30; attempt++) {
        stats.attempts++
        const reads = new Map()
        const writes = new Map()
        const result = await callback({ collection(name) {
          checkCollection(name)
          return { doc(id) { return {
            async get() {
              if (!reads.has(id)) reads.set(id, { version: version(id), data: clone(records.get(id)?.data || null) })
              // Hold first-attempt reads AFTER snapshots are captured. Both
              // callers therefore observe the same version without sleep/races.
              if (barrier && attempt === 0) {
                const gate = barrier
                gate.remaining--
                if (gate.remaining === 0) { barrier = null; gate.release() }
                await gate.promise
              }
              return { data: clone(reads.get(id).data) }
            },
            async set({ data }) {
              assert.ok(reads.has(id), 'Read a document before replacing it')
              assert.ok(!Object.hasOwn(data, '_id'), 'Database-owned _id must not be written')
              writes.set(id, clone(data))
            }
          } } }
        } })
        // No await between validation and commit: this is the atomic CAS.
        if ([...reads].some(([id, read]) => version(id) !== read.version)) {
          stats.conflicts++
          continue
        }
        for (const [id, data] of writes) records.set(id, { version: version(id) + 1, data: { ...data, _id: id } })
        if (writes.size) stats.commits++
        return clone(result)
      }
      throw new Error('Memory transaction retry budget exhausted')
    }
  }
  return {
    db, stats,
    read: (date = DATE) => clone(records.get(date)?.data),
    synchronizeReads(count = 2) {
      assert.equal(barrier, null)
      let release
      const promise = new Promise(resolve => { release = resolve })
      barrier = { remaining: count, promise, release }
    }
  }
}

function fixture() {
  const memory = memoryDatabase()
  let tick = 1000
  class Clock extends Date { static now() { return tick++ } }
  const factory = loadModule('cloudfunctions/menuHub/menus.js', {}, { Date: Clock })
  const menus = factory(memory.db, input => {
    const { name, emoji, color, category, time } = input
    return { name, emoji, color, category, time }
  })
  let sequence = 0
  const mutate = (changes = {}, user = 'alice') => menus.mutate({
    date: DATE, mealKey: 'lunch', operation: 'add', recipe: recipe('a'),
    operationId: `op_${++sequence}`, ...changes
  }, user)
  return { ...memory, menus, mutate }
}

test('concurrent users adding different dishes survive a real version conflict', async () => {
  const f = fixture()
  f.synchronizeReads()
  await Promise.all([f.mutate({ recipe: recipe('a') }), f.mutate({ recipe: recipe('b') }, 'bob')])
  const day = f.read()
  assert.deepEqual(day.meals.lunch.map(item => item.id).sort(), ['a', 'b'])
  assert.deepEqual(day.meals.lunch.map(item => item.quantity), [1, 1])
  assert.equal(day.revision, 2)
  assert.equal(f.stats.conflicts, 1)
  assert.equal(f.stats.attempts, 3)
  assert.equal(f.stats.commits, 2)
})

test('concurrent users accumulate portions of the same existing dish', async () => {
  const f = fixture()
  await f.mutate()
  f.synchronizeReads()
  const results = await Promise.all([f.mutate(), f.mutate({}, 'bob')])
  assert.equal(f.read().meals.lunch.length, 1)
  assert.equal(f.read().meals.lunch[0].quantity, 3)
  assert.equal(f.read().revision, 3)
  assert.equal(f.stats.conflicts, 1)
  assert.deepEqual(results.map(result => result.day.revision).sort(), [2, 3])
})

test('same user operationId deduplicates concurrent calls and later replay', async () => {
  const f = fixture()
  const input = { operationId: 'same_tap' }
  f.synchronizeReads()
  const [first, duplicate] = await Promise.all([f.mutate(input), f.mutate(input)])
  assert.deepEqual(first, duplicate)
  const stored = f.read()
  await f.mutate(input)
  assert.deepEqual(f.read(), stored)
  assert.equal(stored.meals.lunch[0].quantity, 1)
  assert.equal(stored.revision, 1)
  assert.equal(f.stats.commits, 1)
  assert.equal(f.stats.conflicts, 1)
  assert.deepEqual(stored.operations, ['alice:same_tap'])
})

test('operationId is scoped to user: two users with the same id both count', async () => {
  const f = fixture()
  f.synchronizeReads()
  await Promise.all([f.mutate({ operationId: 'same' }), f.mutate({ operationId: 'same' }, 'bob')])
  assert.equal(f.read().meals.lunch[0].quantity, 2)
  assert.equal(f.read().revision, 2)
})

test('another user can decrease, mark eaten and delete a shared dish', async () => {
  const f = fixture()
  await f.mutate()
  await f.mutate()
  await f.mutate({ recipe: recipe('untouched'), mealKey: 'dinner' })
  await f.mutate({ operation: 'decrease', recipeId: 'a' }, 'bob')
  assert.equal(f.read().meals.lunch[0].quantity, 1)
  await f.mutate({ operation: 'setEaten', recipeId: 'a', eaten: true }, 'bob')
  assert.equal(f.read().meals.lunch[0].eaten, true)
  await f.mutate({ operation: 'remove', recipeId: 'a' }, 'bob')
  assert.deepEqual(f.read().meals.lunch, [])
  assert.equal(f.read().meals.dinner[0].id, 'untouched')
  assert.equal(f.read().history[0].recipeId, 'a', 'Removing plans preserves consumed history')
  await f.mutate({ recipe: recipe('last') })
  await f.mutate({ operation: 'decrease', recipeId: 'last' }, 'bob')
  assert.deepEqual(f.read().meals.lunch, [])
})

test('setEaten tracks quantity, keeps one history entry and preserves its timestamp', async () => {
  const f = fixture()
  await f.mutate()
  await f.mutate()
  await f.mutate({ operation: 'setEaten', recipeId: 'a', eaten: true })
  const initial = f.read().history[0]
  assert.equal(initial.quantity, 2)
  assert.equal(initial.date, DATE)
  assert.equal(initial.mealKey, 'lunch')
  assert.equal(initial.mealTitle, '中饭')
  await f.mutate({ operation: 'setEaten', recipeId: 'a', eaten: true }, 'bob')
  await f.mutate({}, 'bob')
  assert.equal(f.read().history.length, 1)
  assert.equal(f.read().history[0].quantity, 3)
  await f.mutate({ operation: 'decrease', recipeId: 'a' })
  assert.equal(f.read().history[0].quantity, 2)
  assert.equal(f.read().history[0].eatenAt, initial.eatenAt)
  await f.mutate({ operation: 'setEaten', recipeId: 'a', eaten: false }, 'bob')
  assert.deepEqual(f.read().history, [])
  assert.equal(f.read().meals.lunch[0].eaten, false)
  await f.mutate({ operation: 'setEaten', recipeId: 'a', eaten: true })
  assert.ok(f.read().history[0].eatenAt > initial.eatenAt)
})

test('history distinguishes meals; clear empties plans but preserves all history', async () => {
  const f = fixture()
  for (const mealKey of ['breakfast', 'lunch', 'dinner']) {
    await f.mutate({ mealKey })
    await f.mutate({ mealKey, operation: 'setEaten', recipeId: 'a', eaten: true })
  }
  const history = f.read().history
  assert.equal(history.length, 3)
  await f.mutate({ operation: 'clear' }, 'bob')
  assert.deepEqual(f.read().meals, emptyDay().meals)
  assert.deepEqual(f.read().history, history)
  await f.mutate()
  assert.equal(f.read().meals.lunch[0].eaten, true)
  assert.deepEqual(f.read().history, history, 'Re-adding retains the existing consumed record')
})

test('rejected import rolls back partially edited transaction snapshots', async () => {
  const f = fixture()
  await f.mutate()
  const before = f.read()
  await assert.rejects(f.mutate({ operation: 'import', meals: {
    breakfast: [recipe('would_be_added')], lunch: 'invalid'
  } }), /旧菜单格式无效/)
  assert.deepEqual(f.read(), before)
  assert.equal(f.stats.commits, 1)
})

test('99-portion limit rejects atomically without consuming operationId', async () => {
  const f = fixture()
  await f.mutate({ operation: 'import', meals: { lunch: [{ ...recipe('a'), quantity: 99 }] } })
  const before = f.read()
  await assert.rejects(f.mutate({ operationId: 'over_limit' }), /99/)
  assert.deepEqual(f.read(), before)
  await f.mutate({ operation: 'decrease', recipeId: 'a' })
  await f.mutate({ operationId: 'over_limit' })
  assert.equal(f.read().meals.lunch[0].quantity, 99)
})

test('list preserves requested order, supplies empty days and hides internal fields', async () => {
  const f = fixture()
  const result = await f.mutate()
  assert.deepEqual(Object.keys(result.day).sort(), ['date', 'history', 'meals', 'revision'])
  const listed = clone(await f.menus.list({ dates: [OTHER_DATE, DATE] }))
  assert.deepEqual(listed.days[0], emptyDay(OTHER_DATE))
  assert.deepEqual(listed.days[1], result.day)
  assert.equal(f.read(OTHER_DATE), undefined)
})

test('date validation rejects impossible and noncanonical dates before DB access', async () => {
  const f = fixture()
  for (const date of [undefined, null, 20261111, '', '2026-2-01', '2026-02-29', '2024-02-30',
    '2026-04-31', '2026-00-11', '2026-13-01', '2026-11-00', '2026-11-32', '2026-11-11T00:00:00Z', ' 2026-11-11']) {
    await assert.rejects(f.mutate({ date }), /菜单日期无效/, String(date))
    await assert.rejects(f.menus.list({ dates: [date] }), /查询日期无效/, String(date))
  }
  for (const dates of [undefined, null, DATE, [], Array(8).fill(DATE)]) {
    await assert.rejects(f.menus.list({ dates }), /查询日期无效/)
  }
  assert.equal(f.stats.transactions, 0)
  assert.equal(f.stats.queries, 0)
  await f.mutate({ date: '2024-02-29' })
  const dates = ['2024-02-29', '2026-12-31', DATE, OTHER_DATE, '2026-11-13', '2026-11-14', '2026-11-15']
  assert.deepEqual(clone((await f.menus.list({ dates })).days.map(day => day.date)), dates)
})

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function clientFixture(handler, initial = {}) {
  let cached = clone(initial)
  let writes = 0
  let random = 0
  const calls = []
  const client = loadModule('utils/shared-menu.js', { './community': {
    call(action, data, target) {
      assert.equal(target, 'menuHub', 'Every request, including retries, must use menuHub')
      calls.push({ action, data: clone(data), target })
      return handler(action, data, calls.length)
    }
  } }, {
    Math: Object.assign(Object.create(Math), { random: () => (++random) / 100 }),
    wx: {
      getStorageSync(key) { assert.equal(key, 'sharedDailyMenus'); return clone(cached) },
      setStorageSync(key, value) { assert.equal(key, 'sharedDailyMenus'); writes++; cached = clone(value) }
    }
  })
  return { client, calls, cached: () => clone(cached), writes: () => writes }
}

test('a pending old read cannot overwrite a newer write, and unrelated dates survive', async () => {
  const oldRead = deferred()
  const newest = emptyDay(DATE, 5)
  newest.meals.lunch = [{ ...recipe('new'), quantity: 2, eaten: false }]
  const f = clientFixture(action => action === 'listMenus' ? oldRead.promise : Promise.resolve({ day: newest }), {
    [DATE]: emptyDay(DATE, 3), [OTHER_DATE]: emptyDay(OTHER_DATE, 7)
  })
  const pending = f.client.sync([DATE])
  await f.client.mutate({ date: DATE, operation: 'add', recipe: recipe('new') })
  oldRead.resolve({ days: [emptyDay(DATE, 4)] })
  await pending
  assert.deepEqual(f.cached(), { [DATE]: newest, [OTHER_DATE]: emptyDay(OTHER_DATE, 7) })
  assert.deepEqual(f.calls.map(call => call.action), ['listMenus', 'mutateMenu'])
})

test('out-of-order write responses also cannot roll back the cache', async () => {
  const first = deferred(), second = deferred()
  const f = clientFixture((action, data, n) => n === 1 ? first.promise : second.promise)
  const slow = f.client.mutate({ date: DATE, operation: 'add' })
  const fast = f.client.mutate({ date: DATE, operation: 'add' })
  second.resolve({ day: emptyDay(DATE, 2) })
  await fast
  first.resolve({ day: emptyDay(DATE, 1) })
  await slow
  assert.equal(f.cached()[DATE].revision, 2)
  assert.notEqual(f.calls[0].data.operationId, f.calls[1].data.operationId)
})

for (const mode of ['read rejection', 'invalid read response', 'write rejection', 'invalid write response', 'retry exhausted']) {
  test(`${mode} leaves cached data unchanged`, async () => {
    const original = { [DATE]: emptyDay(DATE, 9) }
    const f = clientFixture(() => {
      if (mode.includes('invalid')) return Promise.resolve({})
      if (mode === 'retry exhausted') return Promise.reject({ errMsg: 'request:fail network timeout' })
      return Promise.reject(new Error('service refused'))
    }, original)
    const isRead = mode.includes('read')
    await assert.rejects(isRead ? f.client.sync([DATE]) : f.client.mutate({ date: DATE, operation: 'clear' }))
    assert.deepEqual(f.cached(), original)
    assert.equal(f.writes(), 0)
    assert.equal(f.calls.length, mode === 'retry exhausted' ? 2 : 1)
  })
}

test('lost response after commit retries the same operationId and adds exactly once', async () => {
  const server = fixture()
  const f = clientFixture(async (action, request, n) => {
    assert.equal(action, 'mutateMenu')
    const result = await server.menus.mutate(request, 'alice')
    if (n === 1) throw { errMsg: 'cloud.callFunction:fail timeout' }
    return result
  })
  const input = { date: DATE, mealKey: 'lunch', operation: 'add', recipe: recipe('a') }
  const before = clone(input)
  const day = await f.client.mutate(input)
  assert.equal(f.calls.length, 2)
  assert.match(f.calls[0].data.operationId, /^[\w-]{1,100}$/)
  assert.deepEqual(f.calls[0], f.calls[1])
  assert.deepEqual(input, before, 'Caller-owned input must not be mutated')
  assert.equal(day.meals.lunch[0].quantity, 1)
  assert.equal(server.read().revision, 1)
  assert.equal(server.stats.commits, 1)
  assert.deepEqual(f.cached()[DATE], clone(day))
})

function entryFixture(openid) {
  if (arguments.length === 0) openid = 'alice'
  const memory = memoryDatabase()
  const options = [], initCalls = []
  const factory = loadModule('cloudfunctions/menuHub/menus.js')
  const entry = loadModule('cloudfunctions/menuHub/index.js', {
    'wx-server-sdk': {
      DYNAMIC_CURRENT_ENV: 'current-test-env',
      init(config) { initCalls.push(clone(config)) },
      database(config) {
        options.push(clone(config))
        assert.equal(config?.throwOnNotFound, false, 'Missing documents must resolve with data:null')
        return memory.db
      },
      getWXContext: () => ({ OPENID: openid })
    },
    './menus': factory
  })
  return { ...memory, entry, options, initCalls }
}

test('menuHub entry configures missing-document behavior and creates a fresh day', async () => {
  const f = entryFixture()
  assert.deepEqual(f.options, [{ throwOnNotFound: false }])
  assert.deepEqual(f.initCalls, [{ env: 'current-test-env' }])
  const result = clone(await f.entry.main({ action: 'mutateMenu', date: DATE, mealKey: 'lunch',
    operation: 'add', operationId: 'entry_add', recipe: { ...recipe('a'), name: '  Dish A  ', _openid: 'forged' } }))
  assert.equal(result.ok, true)
  assert.equal(result.day.revision, 1)
  assert.equal(result.day.meals.lunch[0].quantity, 1)
  assert.equal(result.day.meals.lunch[0].name, 'Dish A')
  assert.equal(result.day.meals.lunch[0]._openid, undefined)
  const listed = clone(await f.entry.main({ action: 'listMenus', dates: [DATE] }))
  assert.deepEqual(listed, { ok: true, days: [result.day] })
})

test('menuHub entry rejects missing OPENID for reads and writes before database access', async () => {
  for (const openid of [undefined, null, '']) {
    const f = entryFixture(openid)
    for (const action of ['listMenus', 'mutateMenu']) {
      const result = clone(await f.entry.main({ action, dates: [DATE], date: DATE, mealKey: 'lunch',
        operation: 'add', operationId: 'unauthorized', recipe: recipe('a') }))
      assert.deepEqual(result, { ok: false, message: '请在微信小程序中打开点菜页面' })
    }
    assert.equal(f.stats.transactions, 0)
    assert.equal(f.stats.queries, 0)
    assert.equal(f.read(), undefined)
  }
})

test('menuHub entry returns errors for unknown actions and invalid dates', async () => {
  const f = entryFixture()
  assert.deepEqual(clone(await f.entry.main({ action: 'deleteRecipe' })), { ok: false, message: '未知菜单操作' })
  assert.deepEqual(clone(await f.entry.main({ action: 'listMenus', dates: ['2026-02-29'] })),
    { ok: false, message: '查询日期无效' })
  assert.equal(f.stats.queries, 0)
})
