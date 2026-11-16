const community = require('../../utils/community')
const sharedShopping = require('../../utils/shared-shopping')
const recipeCategories = require('../../utils/categories')

Page({
  data: {
    recipes: [],
    filteredRecipes: [],
    categories: ['全部'],
    categoryTabs: [{ name: '全部', selected: true, deletable: false }],
    activeCategory: '全部',
    categoryManage: false,
    activeSwipeId: '',
    keyword: '',
    cloudEnabled: false,
    syncError: false
  },

  onShow() {
    this.getTabBar().setData({ selected: 1 })
    this.loadRecipes()
  },

  loadRecipes() {
    return Promise.all([community.syncRecipes(), community.syncCategories()]).then(results => {
      const sync = results[0]
      const recipes = sync.recipes
      const categories = ['全部'].concat(recipeCategories.getCategories(recipes))
      const activeCategory = categories.indexOf(this.data.activeCategory) >= 0 ? this.data.activeCategory : '全部'
      this.setData({ recipes, categories, activeCategory, cloudEnabled: sync.cloudEnabled, syncError: sync.error })
      this.refreshCategoryTabs(categories, activeCategory, recipes)
      this.filterRecipes(recipes, this.data.keyword, activeCategory)
    })
  },

  refreshCategoryTabs(categories, activeCategory, recipes) {
    const counts = {}
    ;(recipes || this.data.recipes).forEach(recipe => {
      if (recipe.category) counts[recipe.category] = (counts[recipe.category] || 0) + 1
    })
    const categoryTabs = categories.map(name => ({
      name,
      selected: name === activeCategory,
      deletable: name !== '全部' && !counts[name] && recipeCategories.canDeleteCategory(name)
    }))
    this.setData({ categoryTabs, categoryCounts: counts })
  },

  toggleCategoryManage() {
    this.setData({ categoryManage: !this.data.categoryManage })
  },

  addCategory() {
    wx.showModal({
      title: '新增菜谱分类',
      editable: true,
      placeholderText: '例如：周末大餐',
      confirmText: '添加',
      success: result => {
        if (!result.confirm) return
        const validation = recipeCategories.validateCategory(result.content, this.data.recipes)
        if (!validation.ok) return wx.showToast({ title: validation.message, icon: 'none' })
        const saveCategory = community.isConfigured()
          ? community.createCategory(validation.name)
          : Promise.resolve(recipeCategories.addCategory(validation.name))
        saveCategory.then(() => {
          const categories = ['全部'].concat(recipeCategories.getCategories(this.data.recipes))
          this.setData({ categories, activeCategory: validation.name, categoryManage: false })
          this.refreshCategoryTabs(categories, validation.name, this.data.recipes)
          this.filterRecipes(this.data.recipes, this.data.keyword, validation.name)
          wx.showToast({ title: '分类已同步给家人', icon: 'success' })
        }).catch(error => wx.showToast({ title: (error && (error.message || error.errMsg)) || '分类保存失败', icon: 'none' }))
      }
    })
  },

  removeCategory(e) {
    const name = e.currentTarget.dataset.category
    const count = (this.data.categoryCounts && this.data.categoryCounts[name]) || 0
    if (count) return wx.showToast({ title: '请先把该分类下的菜谱改到其他分类', icon: 'none' })
    wx.showModal({
      title: '删除分类？',
      content: `将删除“${name}”分类标签。`,
      confirmText: '删除',
      confirmColor: '#D8754C',
      success: result => {
        if (!result.confirm) return
        const sharedCategory = recipeCategories.getCategoryInfo(name)
        const remove = sharedCategory && sharedCategory.isCloud
          ? community.removeCategory(name)
          : Promise.resolve(recipeCategories.removeCategory(name))
        remove.then(result => {
          if (result && result.ok === false) return wx.showToast({ title: result.message, icon: 'none' })
          const categories = ['全部'].concat(recipeCategories.getCategories(this.data.recipes))
          const activeCategory = this.data.activeCategory === name ? '全部' : this.data.activeCategory
          this.setData({ categories, activeCategory })
          this.refreshCategoryTabs(categories, activeCategory, this.data.recipes)
          this.filterRecipes(this.data.recipes, this.data.keyword, activeCategory)
          wx.showToast({ title: '分类已删除', icon: 'success' })
        }).catch(error => wx.showToast({ title: (error && (error.message || error.errMsg)) || '删除失败', icon: 'none' }))
      }
    })
  },

  onSearch(e) {
    const keyword = e.detail.value.trim()
    this.setData({ keyword })
    this.filterRecipes(this.data.recipes, keyword, this.data.activeCategory)
  },

  selectCategory(e) {
    const activeCategory = e.currentTarget.dataset.category
    this.setData({ activeCategory, activeSwipeId: '' })
    this.refreshCategoryTabs(this.data.categories, activeCategory, this.data.recipes)
    this.filterRecipes(this.data.recipes, this.data.keyword, activeCategory)
  },

  filterRecipes(recipes, keyword, category) {
    const filteredRecipes = recipes.filter(recipe => {
      const matchesCategory = !category || category === '全部' || recipe.category === category
      const matchesKeyword = !keyword || recipe.name.includes(keyword) || (recipe.ingredients || []).some(item => item.name.includes(keyword))
      return matchesCategory && matchesKeyword
    })
    this.setData({ filteredRecipes })
  },

  onTouchStart(e) {
    const touch = e.changedTouches[0]
    this.touchStart = { x: touch.clientX, y: touch.clientY, id: e.currentTarget.dataset.id }
  },

  onTouchEnd(e) {
    if (!this.touchStart) return
    const touch = e.changedTouches[0]
    const deltaX = touch.clientX - this.touchStart.x
    const deltaY = touch.clientY - this.touchStart.y
    const id = this.touchStart.id
    this.touchStart = null
    if (Math.abs(deltaX) < 40 || Math.abs(deltaX) < Math.abs(deltaY)) return

    if (deltaX < 0) this.setData({ activeSwipeId: id })
    else if (this.data.activeSwipeId === id || this.data.activeSwipeId) this.setData({ activeSwipeId: '' })
    this.ignoreNextTap = true
    setTimeout(() => { this.ignoreNextTap = false }, 350)
  },

  openRecipe(e) {
    if (this.ignoreNextTap) return
    this.setData({ activeSwipeId: '' })
    wx.navigateTo({ url: `/pages/detail/detail?id=${e.currentTarget.dataset.id}` })
  },

  editRecipe(e) {
    const recipe = this.data.recipes.find(item => item.id === e.currentTarget.dataset.id)
    if (!recipe || (recipe.isCloud && !recipe.isMine)) return wx.showToast({ title: '只能编辑自己添加的菜谱', icon: 'none' })
    wx.navigateTo({ url: `/pages/add/add?id=${recipe.id}` })
  },

  toggleFavorite(e) {
    const id = e.currentTarget.dataset.id
    const recipe = this.data.recipes.find(item => item.id === id)
    if (!recipe) return
    community.toggleFavorite(recipe, !recipe.favorite).then(updated => {
      const recipes = this.data.recipes.map(item => item.id === id ? updated : item)
      this.setData({ recipes })
      this.filterRecipes(recipes, this.data.keyword, this.data.activeCategory)
      wx.showToast({ title: updated.favorite ? '已加入收藏' : '已取消收藏', icon: 'none' })
    }).catch(error => wx.showToast({ title: (error && (error.message || error.errMsg)) || '收藏失败，请稍后重试', icon: 'none' }))
  },

  deleteRecipe(e) {
    const id = e.currentTarget.dataset.id
    const recipe = this.data.recipes.find(item => item.id === id)
    if (!recipe) return
    if (recipe.isCloud && !recipe.isMine) return wx.showToast({ title: '只能删除自己添加的菜谱', icon: 'none' })
    wx.showModal({
      title: '删除这道菜？',
      content: `“${recipe.name}”会从家庭菜谱和采购清单中移除。`,
      confirmText: '删除',
      confirmColor: '#D8754C',
      success: result => {
        if (!result.confirm) return
        community.deleteRecipe(recipe).then(() => {
          const recipes = (wx.getStorageSync('familyRecipes') || []).filter(item => item.id !== id)
          wx.setStorageSync('familyRecipes', recipes)
          sharedShopping.deleteRecipeItems(id).catch(() => {})
          this.setData({ activeSwipeId: '' })
          this.loadRecipes()
          wx.showToast({ title: '菜谱已删除', icon: 'success' })
        }).catch(() => wx.showToast({ title: '删除失败，请稍后重试', icon: 'none' }))
      }
    })
  },

  goAdd() { wx.navigateTo({ url: '/pages/add/add' }) }
})
