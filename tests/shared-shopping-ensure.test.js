'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

function freshEnsure() {
  const path = require.resolve('../cloudfunctions/shoppingHub/ensure')
  delete require.cache[path]
  return require(path)
}

test('creates both shared collections and ignores already-exists errors', async () => {
  const ensureCollections = freshEnsure()
  const created = []
  const db = {
    async createCollection(name) {
      created.push(name)
      if (name === 'shared_shopping_lists') throw new Error('collection already exists')
    }
  }
  await ensureCollections(db)
  assert.deepEqual(created.sort(), ['shared_shopping_lists', 'shared_shopping_operations'])
})

test('skips the check once collections are ensured in the same container', async () => {
  const ensureCollections = freshEnsure()
  const calls = []
  const db = { async createCollection(name) { calls.push(name) } }
  await ensureCollections(db)
  await ensureCollections(db)
  assert.deepEqual(calls.sort(), ['shared_shopping_lists', 'shared_shopping_operations'])
})

test('no-op when createCollection is unavailable', async () => {
  const ensureCollections = freshEnsure()
  await ensureCollections({})
})
