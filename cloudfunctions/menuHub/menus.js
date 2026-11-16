const MEALS = ['breakfast', 'lunch', 'dinner']
const TITLES = { breakfast: '早饭', lunch: '中饭', dinner: '晚饭' }

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const time = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
}

function emptyDay(date) {
  return { date, meals: { breakfast: [], lunch: [], dinner: [] }, history: [], revision: 0 }
}

function present(day) {
  return { date: day.date, meals: day.meals, history: day.history, revision: day.revision }
}

module.exports = function createMenus(db, cleanRecipe) {
  const collection = db.collection('shared_daily_menus')

  function snapshot(input) {
    if (!input || typeof input.id !== 'string' || !input.id || input.id.length > 100 || !input.name) {
      throw new Error('菜品信息不完整')
    }
    return Object.assign(cleanRecipe(input), { id: input.id })
  }

  function updateHistory(day, mealKey, recipe) {
    const index = day.history.findIndex(item => item.mealKey === mealKey && item.recipeId === recipe.id)
    if (!recipe.eaten) {
      if (index >= 0) day.history.splice(index, 1)
      return
    }
    const record = {
      date: day.date, mealKey, mealTitle: TITLES[mealKey], recipeId: recipe.id,
      name: recipe.name, emoji: recipe.emoji, color: recipe.color,
      category: recipe.category, time: recipe.time, quantity: recipe.quantity,
      eatenAt: index >= 0 ? day.history[index].eatenAt : Date.now()
    }
    if (index >= 0) day.history[index] = record
    else day.history.push(record)
  }

  async function list(event) {
    const dates = event.dates
    if (!Array.isArray(dates) || !dates.length || dates.length > 7 || !dates.every(validDate)) {
      throw new Error('查询日期无效')
    }
    const result = await collection.where({ date: db.command.in(dates) }).limit(7).get()
    return { days: dates.map(date => present((result.data || []).find(day => day.date === date) || emptyDay(date))) }
  }

  async function mutate(event, openid) {
    const { date, mealKey, recipeId, operation, operationId } = event
    if (!validDate(date)) throw new Error('菜单日期无效')
    if (!['add', 'decrease', 'remove', 'setEaten', 'clear', 'import'].includes(operation)) throw new Error('菜单操作无效')
    if (typeof operationId !== 'string' || !/^[\w-]{1,100}$/.test(operationId)) throw new Error('操作编号无效')
    if (!['clear', 'import'].includes(operation) && !MEALS.includes(mealKey)) throw new Error('餐次无效')
    if (['decrease', 'remove', 'setEaten'].includes(operation) && (typeof recipeId !== 'string' || !recipeId || recipeId.length > 100)) throw new Error('菜品编号无效')
    if (operation === 'setEaten' && typeof event.eaten !== 'boolean') throw new Error('吃饭状态无效')
    const recipe = operation === 'add' ? snapshot(event.recipe) : null
    const token = `${openid}:${operationId}`
    // Each date is one transaction: edits are applied to the latest day, never a stale client copy.
    const day = await db.runTransaction(async transaction => {
      const doc = transaction.collection('shared_daily_menus').doc(date)
      const result = await doc.get()
      const current = result.data || emptyDay(date)
      current.operations = current.operations || []
      if (current.operations.includes(token)) return present(current)
      if (operation === 'clear') {
        current.meals = emptyDay(date).meals
      } else if (operation === 'import') {
        // Explicit legacy import only fills missing dishes; it never replaces shared arrangements.
        const legacy = event.meals || {}
        for (const key of MEALS) {
          if (legacy[key] && !Array.isArray(legacy[key])) throw new Error('旧菜单格式无效')
          for (const input of (legacy[key] || []).slice(0, 100)) {
            const item = snapshot(input)
            if (current.meals[key].some(existing => existing.id === item.id)) continue
            item.quantity = Math.min(99, Math.max(1, Math.floor(Number(input.quantity) || 1)))
            item.eaten = Boolean(input.eaten)
            current.meals[key].push(item)
            if (item.eaten) updateHistory(current, key, item)
          }
        }
      } else {
        const items = current.meals[mealKey]
        const index = items.findIndex(item => item.id === (recipe ? recipe.id : recipeId))
        if (operation === 'add') {
          if (index >= 0) {
            if (items[index].quantity >= 99) throw new Error('每道菜最多安排 99 份')
            items[index].quantity += 1
            if (items[index].eaten) updateHistory(current, mealKey, items[index])
          } else {
            const eaten = current.history.some(item => item.mealKey === mealKey && item.recipeId === recipe.id)
            const item = Object.assign({}, recipe, { quantity: 1, eaten })
            items.push(item)
            if (eaten) updateHistory(current, mealKey, item)
          }
        } else if (index >= 0) {
          if (operation === 'remove' || (operation === 'decrease' && items[index].quantity <= 1)) items.splice(index, 1)
          else if (operation === 'decrease') {
            items[index].quantity -= 1
            if (items[index].eaten) updateHistory(current, mealKey, items[index])
          } else if (operation === 'setEaten') {
            items[index].eaten = event.eaten
            updateHistory(current, mealKey, items[index])
          }
        }
      }
      if (MEALS.some(key => current.meals[key].length > 100) || current.history.length > 300) throw new Error('当天菜品数量已达上限')
      current.revision += 1
      current.operations = current.operations.concat(token).slice(-200)
      // Remove the database-owned id before writing the complete transactional document.
      delete current._id
      await doc.set({ data: current })
      return present(current)
    })
    return { day }
  }

  return { list, mutate }
}
