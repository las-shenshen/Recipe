const { scaleAmount } = require('../../utils/amount')
const community = require('../../utils/community')
const sharedShopping = require('../../utils/shared-shopping')
const recipeCategories = require('../../utils/categories')

Page({
  data: {
    isEditing: false,
    name: '',
    category: '快手家常',
    categoryIndex: 0,
    categories: ['快手家常', '家常硬菜', '素食清爽', '暖心汤羹'],
    description: '',
    time: '',
    servings: '',
    difficulties: ['简单', '中等', '困难'],
    difficultyIndex: 0,
    kidFriendly: false,
    ingredients: [{ name: '', amount: '' }],
    steps: ['']
  },

  onLoad(options) {
    const categories = recipeCategories.getCategories(wx.getStorageSync('familyRecipes') || [])
    this.setData({ categories, category: categories[0] || '快手家常', categoryIndex: 0 })
    if (!options.id) return
    const recipe = (wx.getStorageSync('familyRecipes') || []).find(item => item.id === options.id)
    if (!recipe) {
      wx.showToast({ title: '没有找到这道菜', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 500)
      return
    }
    this.recipeId = recipe.id
    const categoryIndex = Math.max(0, this.data.categories.indexOf(recipe.category))
    // 旧菜谱的难度可能不在选项里，保留原值而不是悄悄改成“简单”。
    const difficulties = !recipe.difficulty || this.data.difficulties.indexOf(recipe.difficulty) >= 0
      ? this.data.difficulties
      : this.data.difficulties.concat(recipe.difficulty)
    this.setData({
      isEditing: true,
      name: recipe.name || '',
      category: recipe.category || this.data.categories[0],
      categoryIndex,
      description: recipe.description || '',
      time: String(recipe.time || ''),
      servings: String(recipe.servings || ''),
      difficulties,
      difficultyIndex: Math.max(0, difficulties.indexOf(recipe.difficulty)),
      kidFriendly: Boolean(recipe.kidFriendly),
      ingredients: (recipe.ingredients || []).map(item => ({ name: item.name || '', amount: item.amount || '' })),
      steps: (recipe.steps || []).slice()
    })
    wx.setNavigationBarTitle({ title: '编辑菜谱' })
  },

  onInput(e) {
    const update = {}
    update[e.currentTarget.dataset.field] = e.detail.value
    this.setData(update)
  },
  onCategory(e) {
    const categoryIndex = Number(e.detail.value)
    this.setData({ categoryIndex, category: this.data.categories[categoryIndex] })
  },
  onDifficulty(e) { this.setData({ difficultyIndex: Number(e.detail.value) }) },
  onKidFriendly(e) { this.setData({ kidFriendly: Boolean(e.detail.value) }) },
  addIngredient() { this.setData({ ingredients: this.data.ingredients.concat([{ name: '', amount: '' }]) }) },
  removeIngredient(e) {
    const index = Number(e.currentTarget.dataset.index)
    this.setData({ ingredients: this.data.ingredients.filter((_, i) => i !== index) })
  },
  onIngredientInput(e) {
    const ingredients = this.data.ingredients.slice()
    const index = Number(e.currentTarget.dataset.index)
    const ingredient = Object.assign({}, ingredients[index])
    ingredient[e.currentTarget.dataset.key] = e.detail.value
    ingredients[index] = ingredient
    this.setData({ ingredients })
  },
  addStep() { this.setData({ steps: this.data.steps.concat(['']) }) },
  removeStep(e) {
    const index = Number(e.currentTarget.dataset.index)
    this.setData({ steps: this.data.steps.filter((_, i) => i !== index) })
  },
  onStepInput(e) {
    const steps = this.data.steps.slice()
    steps[Number(e.currentTarget.dataset.index)] = e.detail.value
    this.setData({ steps })
  },

  saveRecipe() {
    const name = this.data.name.trim()
    const ingredients = this.data.ingredients
      .map(item => ({ name: item.name.trim(), amount: item.amount.trim() }))
      .filter(item => item.name)
    const steps = this.data.steps.map(step => step.trim()).filter(Boolean)
    if (!name) return wx.showToast({ title: '先给菜谱起个名字吧', icon: 'none' })
    if (!ingredients.length) return wx.showToast({ title: '至少添加一种食材', icon: 'none' })
    if (!steps.length) return wx.showToast({ title: '再写一道烹饪步骤吧', icon: 'none' })

    const recipes = wx.getStorageSync('familyRecipes') || []
    const colors = ['#F6E8D7', '#E8EEDB', '#F3E4E1', '#E5ECEB']
    const emojis = ['🥘', '🍳', '🥗', '🍲']
    const oldIndex = this.recipeId ? recipes.findIndex(item => item.id === this.recipeId) : -1
    if (this.recipeId && oldIndex < 0) return wx.showToast({ title: '菜谱已不存在，无法保存', icon: 'none' })

    const oldRecipe = oldIndex >= 0 ? recipes[oldIndex] : null
    const previousId = oldRecipe ? oldRecipe.id : ''
    const shouldAssignSharedId = Boolean(oldRecipe && community.isConfigured() && !oldRecipe.isCloud)
    const recipe = Object.assign({}, oldRecipe || {}, {
      id: shouldAssignSharedId ? `r${Date.now()}_${Math.floor(Math.random() * 10000)}` : (oldRecipe ? oldRecipe.id : `r${Date.now()}`),
      name,
      category: this.data.category,
      description: this.data.description.trim() || '这是一道家的味道。',
      time: Number(this.data.time) || 30,
      servings: Number(this.data.servings) || 2,
      difficulty: this.data.difficulties[this.data.difficultyIndex] || '简单',
      kidFriendly: this.data.kidFriendly,
      emoji: oldRecipe ? oldRecipe.emoji : emojis[recipes.length % emojis.length],
      color: oldRecipe ? oldRecipe.color : colors[recipes.length % colors.length],
      ingredients,
      steps
    })

    if (!oldRecipe) recipe.favorite = false
    community.saveRecipe(recipe).then(saved => {
      const updated = recipes.filter(item => item.id !== previousId || !previousId)
      const index = updated.findIndex(item => item.id === saved.id)
      if (index >= 0) updated[index] = saved
      else updated.unshift(saved)
      wx.setStorageSync('familyRecipes', updated)
      if (oldRecipe) this.updateShoppingItems(saved, previousId)
      wx.showToast({ title: saved.syncError ? '已本机保存，云端未同步' : (oldRecipe ? '菜谱已更新' : '收好了'), icon: saved.syncError ? 'none' : 'success' })
      setTimeout(() => wx.navigateBack(), 500)
    }).catch(error => {
      const message = error && error.errMsg && error.errMsg.indexOf('deny') >= 0
        ? '授权头像昵称后才能共享菜谱'
        : (error.message || '保存失败，请稍后重试')
      wx.showToast({ title: message.slice(0, 18), icon: 'none' })
    })
  },

  updateShoppingItems(recipe, previousId) {
    sharedShopping.updateRecipeItems(recipe, previousId).then(entries => Promise.all(entries.map(entry => entry.task)))
      .catch(() => {})
    const ingredientsByName = {}
    recipe.ingredients.forEach(item => { ingredientsByName[item.name] = item })
    const items = (wx.getStorageSync('shoppingItems') || [])
      .map(item => {
        if (previousId && item.recipeId === previousId && previousId !== recipe.id) {
          return Object.assign({}, item, { recipeId: recipe.id, id: `${recipe.id}::${item.name}` })
        }
        return item
      })
      .filter(item => item.recipeId !== recipe.id || ingredientsByName[item.name])
      .map(item => {
        if (item.recipeId !== recipe.id) return item
        const ingredient = ingredientsByName[item.name]
        const baseAmount = ingredient.amount || '适量'
        const sets = Number(item.sets) || 1
        return Object.assign({}, item, {
          recipeName: recipe.name,
          recipeCategory: recipe.category,
          baseAmount,
          sets,
          amount: scaleAmount(baseAmount, sets)
        })
      })
    wx.setStorageSync('shoppingItems', items)
  }
})
