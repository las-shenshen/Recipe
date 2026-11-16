'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const createList = require('../cloudfunctions/shoppingHub/list')
const model = require('../utils/shopping-model')

function database() {
  const records = new Map()
  let tail = Promise.resolve()
  const docApi = (store, id) => ({
    async get() { return { data: structuredClone(store.get(id) || null) } },
    async set({ data }) { store.set(id, structuredClone(data)) }
  })
  const collectionApi = (store, name) => ({ doc(id) { return docApi(store, `${name}/${id}`) } })
  return {
    collection(name) { return collectionApi(records, name) },
    runTransaction(callback) {
      const task = tail.then(async () => {
        const snapshot = new Map(records)
        const tx = { collection(name) { return collectionApi(snapshot, name) } }
        const result = await callback(tx)
        records.clear()
        snapshot.forEach((value, key) => records.set(key, value))
        return result
      })
      tail = task.catch(() => {})
      return task
    }
  }
}

const item = (id, extra = {}) => Object.assign({ id, name: id, amount: '2 个', baseAmount: '2 个', sets: 1, source: 'manual', checked: false }, extra)
const call = (hub, operation, operationId, user = 'alice') => hub.mutate(Object.assign({ operationId }, operation), user)

function client(handler) {
  const storage = new Map()
  let networkListener
  const module = { exports: {} }
  const filename = path.resolve(__dirname, '../utils/shared-shopping.js')
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports,
    require(name) { return name === './community' ? { call: handler } : model },
    wx: {
      getStorageSync(key) { return structuredClone(storage.get(key)) },
      setStorageSync(key, value) { storage.set(key, structuredClone(value)) },
      onNetworkStatusChange(listener) { networkListener = listener }
    },
    Date, Math, Promise, Map, Set, Array, Object, String, Number, Boolean, Error
  })
  return { api: module.exports, storage: () => structuredClone(storage.get('sharedShoppingState')), reconnect: () => networkListener({ isConnected: true }) }
}

test('concurrent edits merge against current server state and operation receipts deduplicate retries', async () => {
  const hub = createList(database())
  await Promise.all([
    call(hub, { operation: 'addItems', items: [item('a')] }, 'add_a'),
    call(hub, { operation: 'addItems', items: [item('b')] }, 'add_b', 'bob')
  ])
  const first = await call(hub, { operation: 'addItems', items: [item('c')] }, 'retry')
  const retry = await call(hub, { operation: 'addItems', items: [item('c')] }, 'retry')
  assert.deepEqual(first, retry)
  assert.deepEqual((await hub.list()).list.items.map(row => row.id).sort(), ['a', 'b', 'c'])
  assert.equal((await hub.list()).list.revision, 3)
})

test('checkbox target state is stable; clear removes only currently checked captured IDs', () => {
  const items = [item('a', { checked: true }), item('b', { checked: false })]
  const cleared = model.applyOperation(items, { type: 'clearChecked', ids: ['a', 'b'] })
  assert.deepEqual(cleared.map(row => row.id), ['b'])
  assert.equal(model.applyOperation(items, { type: 'setChecked', ids: ['a'], checked: false })[0].checked, false)
})

test('legacy import is stable-ID deduplicated across batches and remains separate from add', async () => {
  const hub = createList(database())
  await call(hub, { operation: 'importItems', items: [item('legacy_1')] }, 'import_1')
  await call(hub, { operation: 'importItems', items: [item('legacy_1'), item('legacy_2')] }, 'import_2')
  assert.deepEqual((await hub.list()).list.items.map(row => row.id), ['legacy_1', 'legacy_2'])
  await call(hub, { operation: 'addItems', items: [item('legacy_1')] }, 'add_again')
  assert.equal((await hub.list()).list.items.find(row => row.id === 'legacy_1').sets, 2)
})

test('recipe ID changes merge duplicate ingredient IDs without losing quantities', () => {
  const items = [
    item('old::盐', { source: 'recipe', recipeId: 'old', name: '盐', baseAmount: '1 勺', sets: 2 }),
    item('new::盐', { source: 'recipe', recipeId: 'new', name: '盐', baseAmount: '1 勺', sets: 3 })
  ]
  const result = model.applyOperation(items, {
    type: 'updateRecipeItems', previousId: 'old', recipeId: 'new', recipeName: '新菜名',
    ingredients: [{ name: '盐', amount: '半勺' }]
  })
  assert.equal(result.length, 1)
  assert.equal(result[0].sets, 5)
  assert.equal(result[0].amount, '2.5 勺')
})

test('invalid payload sizes are rejected before database access', () => {
  assert.throws(() => model.validateOperation({ type: 'importItems', items: Array(21).fill(item('x')) }), /数量无效/)
  assert.throws(() => model.validateOperation({ type: 'setChecked', ids: [], checked: true }), /编号无效/)
})

test('offline changes stay optimistic in insertion order and drain on reconnect', async () => {
  let online = false
  const requests = []
  let server = { revision: 0, items: [] }
  const f = client(async (action, request) => {
    requests.push({ action, operation: request && request.operation, online })
    if (action === 'listShoppingList') return { list: server }
    assert.equal(action, 'mutateShoppingList')
    if (!online) throw new Error('offline')
    server = { revision: server.revision + 1, items: model.applyOperation(server.items, Object.assign({}, request, { type: request.operation })) }
    return { list: server }
  })
  f.api.init()
  await f.api.addItems([item('first')])
  await f.api.addItems([item('second')])
  await f.api.flush().catch(() => {})
  assert.deepEqual(f.api.getItems().map(row => row.id), ['first', 'second'])
  assert.equal(f.api.getState().pendingCount, 2)
  online = true
  await f.api.sync()
  assert.deepEqual(server.items.map(row => row.id), ['first', 'second'])
  assert.equal(f.api.getState().pendingCount, 0)
  assert.deepEqual(requests.filter(request => request.online && request.operation).map(request => request.operation), ['addItems', 'addItems'])
})
