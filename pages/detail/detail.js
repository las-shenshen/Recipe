const community = require('../../utils/community')
const sharedShopping = require('../../utils/shared-shopping')

Page({
  data: { recipe: null, sets: 1 },
  onLoad(options) { this.id = options.id; this.fromMenu = options.fromMenu === '1' },
  onShow() { if (this.id) this.loadRecipe() },
  loadRecipe() {
    const preview = this.fromMenu && wx.getStorageSync('dailyMenuRecipePreview')
    const recipe = (wx.getStorageSync('familyRecipes') || []).find(item => item.id === this.id) || (preview && preview.id === this.id ? preview : null)
    this.setData({ recipe: recipe || null })
    community.syncRecipes().then(sync => {
      const current = sync.recipes.find(item => item.id === this.id)
      if (current) this.setData({ recipe: current })
    })
  },
  toggleFavorite() {
    if (!this.data.recipe) return
    community.toggleFavorite(this.data.recipe, !this.data.recipe.favorite).then(recipe => this.setData({ recipe }))
      .catch(error => wx.showToast({ title: (error && (error.message || error.errMsg)) || '收藏失败，请稍后重试', icon: 'none' }))
  },
  decreaseSets() { this.setData({ sets: Math.max(1, this.data.sets - 1) }) },
  increaseSets() { this.setData({ sets: Math.min(99, this.data.sets + 1) }) },
  addIngredients() {
    const recipe = this.data.recipe
    if (!recipe) return
    const sets = this.data.sets
    sharedShopping.addRecipeIngredients(recipe, sets).then(entries => Promise.all(entries.map(entry => entry.task))).then(() => {
      const state = sharedShopping.getState()
      wx.showToast({ title: state.pendingCount ? '已暂存，联网后同步' : `已加入共享清单 · ${sets} 套`, icon: 'none' })
    }).catch(error => wx.showToast({ title: error.message || '加入清单失败', icon: 'none' }))
  }
})
