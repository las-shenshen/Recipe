const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

// In-memory stand-in for wx-server-sdk. Like the real server SDK, a query
// without an explicit limit returns at most 100 documents.
function fixture(openid = 'me') {
  const source = fs.readFileSync(path.join(__dirname, '../cloudfunctions/recipeHub/index.js'), 'utf8')
  const store = { recipes: new Map(), recipe_favorites: new Map(), user_profiles: new Map(), recipe_categories: new Map() }
  const createdCollections = []
  let clock = 0
  let autoId = 0

  const matches = (doc, filter) => Object.keys(filter).every(key => {
    const expected = filter[key]
    return expected && expected.$in ? expected.$in.includes(doc[key]) : doc[key] === expected
  })
  function query(name, filter, order, max) {
    const rows = () => {
      const data = Array.from(store[name].values()).filter(doc => matches(doc, filter))
      if (!order) return data
      const sign = order.direction === 'desc' ? -1 : 1
      return data.sort((a, b) => (a[order.field] < b[order.field] ? -1 : a[order.field] > b[order.field] ? 1 : 0) * sign)
    }
    return {
      where: next => query(name, Object.assign({}, filter, next), order, max),
      orderBy: (field, direction) => query(name, filter, { field, direction }, max),
      limit: count => query(name, filter, order, Math.min(count, 1000)),
      get: async () => ({ data: rows().slice(0, max).map(doc => Object.assign({}, doc)) }),
      count: async () => ({ total: rows().length })
    }
  }
  const collection = name => Object.assign(query(name, {}, null, 100), {
    doc: id => ({
      set: async ({ data }) => { store[name].set(id, Object.assign({ _id: id }, data)) },
      update: async ({ data }) => { store[name].set(id, Object.assign({}, store[name].get(id), data)) },
      remove: async () => { store[name].delete(id) }
    }),
    add: async ({ data }) => {
      const id = `auto_${++autoId}`
      store[name].set(id, Object.assign({ _id: id }, data))
      return { _id: id }
    }
  })

  const cloud = {
    DYNAMIC_CURRENT_ENV: 'dynamic',
    init() {},
    database: () => ({
      collection,
      command: { in: values => ({ $in: values }) },
      serverDate: () => ++clock,
      createCollection: async name => {
        createdCollections.push(name)
        throw new Error('collection already exists')
      }
    }),
    getWXContext: () => ({ OPENID: openid }),
    getTempFileURL: async ({ fileList }) => ({ fileList: fileList.map(fileID => ({ fileID, status: 0, tempFileURL: `https://temporary.invalid/${fileID}` })) })
  }
  const module = { exports: {} }
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    Buffer,
    require: name => {
      assert.equal(name, 'wx-server-sdk')
      return cloud
    },
    console
  }, { filename: 'recipeHub/index.js' })

  function seedRecipe(id, authorOpenid, extra) {
    store.recipes.set(id, Object.assign({
      _id: id, name: `菜谱 ${id}`, category: '快手家常', time: 20, servings: 2,
      ingredients: [{ name: '鸡蛋', amount: '2 个' }], steps: ['炒熟'],
      authorOpenid, createdAt: ++clock, updatedAt: clock
    }, extra))
  }
  function seedFavorite(recipeId, userOpenid) {
    const id = `seed_${++autoId}`
    store.recipe_favorites.set(id, { _id: id, recipeId, openid: userOpenid, createdAt: ++clock })
  }
  function seedProfile(userOpenid, nickname) {
    store.user_profiles.set(userOpenid, { _id: userOpenid, nickname, avatarUrl: '', avatarFileId: '' })
  }
  return { main: module.exports.main, store, createdCollections, seedRecipe, seedFavorite, seedProfile }
}

const names = users => Array.from(users, user => user.nickname).sort()

test('favoriting reports everyone who favorited the recipe, not just the caller', async () => {
  const f = fixture('me')
  f.seedProfile('author', '外婆')
  f.seedProfile('other', '爸爸')
  f.seedRecipe('shared1', 'author')
  f.seedFavorite('shared1', 'other')

  const result = await f.main({ action: 'toggleFavorite', recipeId: 'shared1', favorite: true, profile: { nickname: '小明' } })
  assert.equal(result.ok, true)
  assert.equal(result.recipe.favorite, true)
  assert.equal(result.recipe.favoriteCount, 2)
  assert.deepEqual(names(result.recipe.favoriteUsers), ['小明', '爸爸'])
  assert.equal(result.recipe.authorName, '外婆')
  assert.equal(result.recipe.isMine, false)
})

test('unfavoriting keeps the count and users contributed by other people', async () => {
  const f = fixture('me')
  f.seedProfile('other', '爸爸')
  f.seedRecipe('shared1', 'author')
  f.seedFavorite('shared1', 'other')
  f.seedFavorite('shared1', 'me')

  const result = await f.main({ action: 'toggleFavorite', recipeId: 'shared1', favorite: false, profile: { nickname: '小明' } })
  assert.equal(result.ok, true)
  assert.equal(result.recipe.favorite, false)
  assert.equal(result.recipe.favoriteCount, 1)
  assert.deepEqual(names(result.recipe.favoriteUsers), ['爸爸'])
  assert.equal(f.store.recipe_favorites.size, 1)
})

test('repeating a favorite does not add a second record', async () => {
  const f = fixture('me')
  f.seedRecipe('shared1', 'author')
  await f.main({ action: 'toggleFavorite', recipeId: 'shared1', favorite: true, profile: { nickname: '小明' } })
  const result = await f.main({ action: 'toggleFavorite', recipeId: 'shared1', favorite: true, profile: { nickname: '小明' } })
  assert.equal(result.recipe.favoriteCount, 1)
  assert.equal(f.store.recipe_favorites.size, 1)
})

test('favoriting a built-in recipe creates it under the family author', async () => {
  const f = fixture('me')
  const result = await f.main({ action: 'toggleFavorite', recipeId: 'r2', favorite: true, profile: { nickname: '小明' } })
  assert.equal(result.ok, true)
  assert.equal(result.recipe.authorName, '家庭菜谱')
  assert.equal(result.recipe.favoriteCount, 1)
  assert.equal(result.recipe.kidFriendly, true)
  assert.equal(f.store.recipes.get('r2').authorOpenid, 'system')
})

test('list returns more than 60 recipes and counts favorites across query batches', async () => {
  const f = fixture('me')
  f.seedProfile('other', '爸爸')
  for (let index = 1; index <= 130; index += 1) f.seedRecipe(`recipe${index}`, 'author')
  f.seedFavorite('recipe1', 'other')
  f.seedFavorite('recipe1', 'me')
  f.seedFavorite('recipe130', 'other')

  const result = await f.main({ action: 'listRecipes' })
  assert.equal(result.ok, true)
  assert.equal(result.recipes.length, 130)
  // recipe1 is the oldest, so it sits in the second batch of 100 recipe IDs.
  const oldest = result.recipes.find(recipe => recipe.id === 'recipe1')
  assert.equal(oldest.favoriteCount, 2)
  assert.equal(oldest.favorite, true)
  const newest = result.recipes.find(recipe => recipe.id === 'recipe130')
  assert.equal(newest.favoriteCount, 1)
  assert.equal(newest.favorite, false)
  assert.deepEqual(names(newest.favoriteUsers), ['爸爸'])
})

test('list is capped at 200 recipes, newest first', async () => {
  const f = fixture('me')
  for (let index = 1; index <= 230; index += 1) f.seedRecipe(`recipe${index}`, 'author')
  const result = await f.main({ action: 'listRecipes' })
  assert.equal(result.recipes.length, 200)
  assert.equal(result.recipes[0].id, 'recipe230')
  assert.equal(result.recipes.some(recipe => recipe.id === 'recipe30'), false)
})

test('difficulty and kid-friendly flag survive saving', async () => {
  const f = fixture('me')
  const recipe = { id: 'mine1', name: '香煎鸡翅', difficulty: '中等', kidFriendly: true, ingredients: [{ name: '鸡翅', amount: '8 个' }], steps: ['煎熟'] }
  const saved = await f.main({ action: 'saveRecipe', recipe, profile: { nickname: '小明' } })
  assert.equal(saved.ok, true)
  assert.equal(saved.recipe.difficulty, '中等')
  assert.equal(saved.recipe.kidFriendly, true)
  const listed = (await f.main({ action: 'listRecipes' })).recipes[0]
  assert.equal(listed.difficulty, '中等')
  assert.equal(listed.kidFriendly, true)
  assert.equal(listed.authorName, '小明')
})

test('category requests ensure the collection once per container; other requests do not', async () => {
  const f = fixture('me')
  await f.main({ action: 'listRecipes' })
  assert.equal(f.createdCollections.length, 0)

  const created = await f.main({ action: 'createCategory', name: '周末大餐' })
  assert.equal(created.ok, true)
  assert.equal(created.category.isMine, true)
  const listed = await f.main({ action: 'listCategories' })
  assert.deepEqual(Array.from(listed.categories, category => category.name), ['周末大餐'])
  assert.deepEqual(f.createdCollections, ['recipe_categories'])
})

test('only the creator can remove a category, and only when no recipe uses it', async () => {
  const mine = fixture('me')
  await mine.main({ action: 'createCategory', name: '周末大餐' })
  mine.seedRecipe('shared1', 'author', { category: '周末大餐' })
  const inUse = await mine.main({ action: 'removeCategory', name: '周末大餐' })
  assert.equal(inUse.ok, false)
  mine.store.recipes.clear()
  assert.equal((await mine.main({ action: 'removeCategory', name: '周末大餐' })).deleted, true)

  const other = fixture('someone-else')
  other.store.recipe_categories.set('cat_e591a8e69cabe5a4a7e9a490', { _id: 'cat_e591a8e69cabe5a4a7e9a490', name: '周末大餐', createdBy: 'me' })
  const denied = await other.main({ action: 'removeCategory', name: '周末大餐' })
  assert.equal(denied.ok, false)
  assert.equal(other.store.recipe_categories.size, 1)
})

test('the retired recipeHub login action is rejected', async () => {
  const f = fixture('me')
  const result = await f.main({ action: 'quickLogin', profile: { nickname: '小明', avatarUrl: 'https://example.invalid/a.png' } })
  assert.equal(result.ok, false)
  assert.equal(f.store.user_profiles.size, 0)
})
