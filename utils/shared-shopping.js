const community = require('./community')
const { normalizeItems, applyOperation, validateOperation } = require('./shopping-model')
const STATE_KEY = 'sharedShoppingState'
let worker = null
let refreshRequested = false
let networkListenerReady = false
let sequence = 0
const listeners = new Set()

function readState() {
  const saved = wx.getStorageSync(STATE_KEY)
  if (saved && saved.base && Array.isArray(saved.queue)) return saved
  return {
    base: wx.getStorageSync('sharedShoppingBase') || { revision: 0, items: [] },
    queue: wx.getStorageSync('sharedShoppingQueue') || [],
    imported: wx.getStorageSync('sharedShoppingImportedIds') || [],
    error: ''
  }
}
function notify() { listeners.forEach(listener => { try { listener() } catch (_) {} }) }
function saveState(state) { wx.setStorageSync(STATE_KEY, state); notify() }
function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) }
function getItems() {
  const state = readState()
  return state.queue.reduce((items, operation) => applyOperation(items, operation), normalizeItems(state.base.items))
}
function getState() {
  const state = readState()
  return { items: getItems(), revision: state.base.revision, pendingCount: state.queue.length,
    importPending: state.queue.some(operation => operation.type === 'importItems'),
    syncError: Boolean(state.error), errorMessage: state.error || '', syncing: Boolean(worker) }
}
function validList(result) {
  const list = result && result.list
  if (!list || !Array.isArray(list.items) || !Number.isInteger(list.revision) || list.revision < 0) throw new Error('共享清单响应无效')
  return { revision: list.revision, items: normalizeItems(list.items) }
}
function flush() {
  if (worker) return worker
  // All reads and writes share one worker. A read cannot expose an already
  // committed operation while that same operation is still optimistically queued.
  worker = Promise.resolve().then(async () => {
    while (true) {
      const operation = readState().queue[0]
      if (operation) {
        const result = await community.call('mutateShoppingList', Object.assign({}, operation, { operation: operation.type }), 'shoppingHub')
        const list = validList(result)
        const current = readState()
        if (current.queue[0] && current.queue[0].operationId === operation.operationId) {
          if (list.revision >= current.base.revision) current.base = list
          current.queue.shift()
          if (operation.type === 'importItems') current.imported = Array.from(new Set(current.imported.concat(operation.items.map(item => item.id))))
          current.error = ''
          // Snapshot, receipt acknowledgement and queue are committed together.
          saveState(current)
        }
      } else if (refreshRequested) {
        refreshRequested = false
        const list = validList(await community.call('listShoppingList', {}, 'shoppingHub'))
        const current = readState()
        if (list.revision >= current.base.revision) current.base = list
        current.error = ''
        saveState(current)
      } else break
    }
    const current = readState()
    current.error = ''
    saveState(current)
    return getState()
  }).catch(error => {
    const current = readState()
    current.error = error.message || error.errMsg || '云端暂不可用'
    saveState(current)
    throw error
  }).finally(() => { worker = null; notify() })
  notify()
  return worker
}
function sync() { refreshRequested = true; return flush() }
function enqueueAll(inputs) {
  try {
    const current = readState()
    if (current.queue.length + inputs.length > 500) throw new Error('待同步操作过多，请联网后重试')
    const operations = inputs.map(input => Object.assign(validateOperation(input), {
      operationId: `shop_${Date.now()}_${++sequence}_${Math.random().toString(36).slice(2, 12)}`
    }))
    if (!operations.length) return Promise.resolve([])
    current.queue = current.queue.concat(operations)
    current.error = ''
    saveState(current)
    const task = flush().catch(() => getState())
    return Promise.resolve(operations.map(operation => ({ operationId: operation.operationId, task })))
  } catch (error) { return Promise.reject(error) }
}
function batches(type, field, values, extra) {
  const inputs = []
  for (let index = 0; index < values.length; index += 100) inputs.push(Object.assign({ type, [field]: values.slice(index, index + 100) }, extra))
  return enqueueAll(inputs)
}
function stableLegacyItems(items) {
  return normalizeItems((items || []).map((item, index) => Object.assign({}, item, {
    id: item.id || `legacy_${index}_${encodeURIComponent(String(item.name || '').trim()).slice(0, 80)}`,
    source: item.source || (item.recipeId && item.recipeId !== 'manual' ? 'recipe' : 'manual')
  })))
}
function getMigrationState() {
  const state = readState()
  const known = new Set(state.imported)
  state.queue.filter(operation => operation.type === 'importItems').forEach(operation => operation.items.forEach(item => known.add(item.id)))
  return { items: stableLegacyItems(wx.getStorageSync('shoppingItems') || []).filter(item => !known.has(item.id)),
    pending: state.queue.some(operation => operation.type === 'importItems') }
}
function addItems(items) { return batches('addItems', 'items', items) }
function importLocalItems(items) {
  const state = readState()
  const known = new Set(state.imported)
  state.queue.filter(operation => operation.type === 'importItems').forEach(operation => operation.items.forEach(item => known.add(item.id)))
  const candidates = stableLegacyItems(items).filter(item => !known.has(item.id))
  const inputs = []
  for (let index = 0; index < candidates.length; index += 20) inputs.push({ type: 'importItems', items: candidates.slice(index, index + 20) })
  return enqueueAll(inputs)
}
function recipeItems(recipe, sets) {
  if (!recipe || !Array.isArray(recipe.ingredients)) throw new Error('菜谱食材不存在')
  return recipe.ingredients.map(ingredient => ({
    id: `${recipe.id}::${String(ingredient.name || '').trim()}`, name: ingredient.name,
    baseAmount: ingredient.amount || '适量', sets: Math.max(1, Math.min(99, Number(sets) || 1)),
    checked: false, recipeId: recipe.id, recipeName: recipe.name, recipeCategory: recipe.category, source: 'recipe'
  }))
}
function addRecipeIngredients(recipe, sets) {
  try { return addItems(recipeItems(recipe, sets)) } catch (error) { return Promise.reject(error) }
}
function addMenuIngredients(recipes) {
  try { return addItems(recipes.reduce((items, recipe) => items.concat(recipeItems(recipe, recipe.quantity)), [])) }
  catch (error) { return Promise.reject(error) }
}
function setChecked(ids, checked) { return batches('setChecked', 'ids', Array.from(new Set(ids)), { checked: Boolean(checked) }) }
function deleteItems(ids) { return batches('deleteItems', 'ids', Array.from(new Set(ids))) }
function clearChecked(ids) { return batches('clearChecked', 'ids', Array.from(new Set(ids))) }
function deleteRecipeItems(recipeId) { return enqueueAll([{ type: 'deleteRecipeItems', recipeId }]) }
function updateRecipeItems(recipe, previousId) {
  return enqueueAll([{ type: 'updateRecipeItems', recipeId: recipe.id, previousId: previousId || recipe.id,
    recipeName: recipe.name, recipeCategory: recipe.category,
    ingredients: (recipe.ingredients || []).map(item => ({ name: item.name, amount: item.amount || '适量' })) }])
}
function init() {
  if (!networkListenerReady && typeof wx.onNetworkStatusChange === 'function') {
    networkListenerReady = true
    wx.onNetworkStatusChange(result => {
      if (!result.isConnected) return
      refreshRequested = true
      const active = worker
      if (active) active.then(
        () => { if (refreshRequested) flush().catch(() => {}) },
        () => { if (refreshRequested) flush().catch(() => {}) }
      )
      else flush().catch(() => {})
    })
  }
  return flush().catch(() => getState())
}
module.exports = { init, sync, flush, subscribe, getState, getItems, addItems, importLocalItems,
  addRecipeIngredients, addMenuIngredients, setChecked, deleteItems, clearChecked,
  deleteRecipeItems, updateRecipeItems, getMigrationState, normalizeItems }
