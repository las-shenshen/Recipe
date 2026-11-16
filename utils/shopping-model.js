const { scaleAmount } = require('./amount')

function normalizeItems(items) {
  return (items || []).map(item => {
    const source = item.source === 'recipe' ? 'recipe' : 'manual'
    const baseAmount = String(item.baseAmount || item.amount || '适量').trim().slice(0, 60) || '适量'
    const sets = Math.max(1, Math.min(999, Math.floor(Number(item.sets) || 1)))
    return {
      id: String(item.id || ''), name: String(item.name || '').trim().slice(0, 60),
      amount: source === 'recipe' ? scaleAmount(baseAmount, sets) : String(item.amount || baseAmount).slice(0, 100),
      baseAmount, sets, checked: Boolean(item.checked), source,
      recipeId: source === 'recipe' ? String(item.recipeId || '').slice(0, 160) : 'manual',
      recipeName: String(item.recipeName || (source === 'manual' ? '手动添加' : '')).slice(0, 60),
      recipeCategory: String(item.recipeCategory || '').slice(0, 40)
    }
  }).filter(item => item.id && item.name)
}

function applyOperation(items, operation) {
  let next = normalizeItems(items)
  if (operation.type === 'addItems' || operation.type === 'importItems') {
    normalizeItems(operation.items).forEach(item => {
      const index = next.findIndex(existing => existing.id === item.id)
      if (index < 0) next.push(Object.assign({}, item, { checked: operation.type === 'importItems' && item.checked }))
      else if (operation.type === 'addItems') {
        next[index] = Object.assign({}, next[index], item, { sets: Math.min(999, next[index].sets + item.sets), checked: false })
      }
    })
  } else if (operation.type === 'setChecked') {
    next = next.map(item => operation.ids.includes(item.id) ? Object.assign({}, item, { checked: operation.checked }) : item)
  } else if (operation.type === 'deleteItems') {
    next = next.filter(item => !operation.ids.includes(item.id))
  } else if (operation.type === 'clearChecked') {
    next = next.filter(item => !operation.ids.includes(item.id) || !item.checked)
  } else if (operation.type === 'deleteRecipeItems') {
    next = next.filter(item => item.recipeId !== operation.recipeId)
  } else if (operation.type === 'updateRecipeItems') {
    const ingredients = new Map(operation.ingredients.map(item => [item.name, item]))
    const merged = new Map()
    next.forEach(original => {
      let item = original
      if (item.recipeId === operation.previousId || item.recipeId === operation.recipeId) {
        const ingredient = ingredients.get(item.name)
        if (!ingredient) return
        item = Object.assign({}, item, {
          id: item.id === `${operation.previousId}::${item.name}` ? `${operation.recipeId}::${item.name}` : item.id,
          recipeId: operation.recipeId, recipeName: operation.recipeName,
          recipeCategory: operation.recipeCategory, baseAmount: ingredient.amount || '适量'
        })
      }
      const existing = merged.get(item.id)
      merged.set(item.id, existing ? Object.assign({}, item, {
        sets: Math.min(999, existing.sets + item.sets), checked: existing.checked && item.checked
      }) : item)
    })
    next = Array.from(merged.values())
  }
  return normalizeItems(next)
}

function validateOperation(input) {
  const operation = Object.assign({}, input)
  const type = operation.type
  if (!['addItems', 'importItems', 'setChecked', 'deleteItems', 'clearChecked', 'deleteRecipeItems', 'updateRecipeItems'].includes(type)) throw new Error('清单操作无效')
  if (type === 'addItems' || type === 'importItems') {
    const max = type === 'importItems' ? 20 : 100
    if (!Array.isArray(operation.items) || !operation.items.length || operation.items.length > max) throw new Error('清单项目数量无效')
    if (operation.items.some(item => !item || typeof item.id !== 'string' || !item.id.trim() || item.id.length > 200 || !String(item.name || '').trim())) throw new Error('清单项目无效')
    operation.items = normalizeItems(operation.items)
  }
  if (['setChecked', 'deleteItems', 'clearChecked'].includes(type)) {
    if (!Array.isArray(operation.ids) || !operation.ids.length || operation.ids.length > 100 || operation.ids.some(id => typeof id !== 'string' || !id || id.length > 200)) throw new Error('清单项目编号无效')
    operation.ids = Array.from(new Set(operation.ids))
  }
  if (type === 'setChecked' && typeof operation.checked !== 'boolean') throw new Error('勾选状态无效')
  if (type === 'deleteRecipeItems' || type === 'updateRecipeItems') {
    if (typeof operation.recipeId !== 'string' || !operation.recipeId || operation.recipeId.length > 160) throw new Error('菜谱编号无效')
  }
  if (type === 'updateRecipeItems') {
    if (typeof operation.previousId !== 'string' || !operation.previousId || operation.previousId.length > 160 || !Array.isArray(operation.ingredients) || operation.ingredients.length > 100) throw new Error('菜谱食材信息无效')
    operation.recipeName = String(operation.recipeName || '').slice(0, 60)
    operation.recipeCategory = String(operation.recipeCategory || '').slice(0, 40)
    operation.ingredients = operation.ingredients.map(item => ({ name: String(item.name || '').trim().slice(0, 60), amount: String(item.amount || '适量').slice(0, 60) })).filter(item => item.name)
  }
  return operation
}

module.exports = { normalizeItems, applyOperation, validateOperation }
