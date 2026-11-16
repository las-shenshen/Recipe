const community = require('../../utils/community')

Page({
  data: { recipes: [], filteredRecipes: [], mode: 'all', cloudEnabled: false, syncError: false },
  onShow() {
    this.getTabBar().setData({ selected: 2 })
    community.syncRecipes().then(sync => {
      const recipes = sync.recipes.filter(recipe => Number(recipe.favoriteCount) > 0 || recipe.favorite)
      this.setData({ recipes, cloudEnabled: sync.cloudEnabled, syncError: sync.error })
      this.filterRecipes(recipes, this.data.mode)
    })
  },
  selectMode(e) {
    const mode = e.currentTarget.dataset.mode
    this.setData({ mode })
    this.filterRecipes(this.data.recipes, mode)
  },
  filterRecipes(recipes, mode) {
    const filteredRecipes = mode === 'mine' ? recipes.filter(recipe => recipe.favorite) : recipes
    this.setData({ filteredRecipes })
  },
  toggleFavorite(e) {
    const id = e.currentTarget.dataset.id
    const recipe = this.data.recipes.find(item => item.id === id)
    if (!recipe) return
    community.toggleFavorite(recipe, !recipe.favorite).then(updated => {
      const recipes = this.data.recipes.map(item => item.id === id ? updated : item)
      const visibleRecipes = recipes.filter(item => Number(item.favoriteCount) > 0 || item.favorite)
      this.setData({ recipes: visibleRecipes })
      this.filterRecipes(visibleRecipes, this.data.mode)
      wx.showToast({ title: updated.favorite ? '已加入收藏' : '已取消收藏', icon: 'none' })
    }).catch(error => wx.showToast({ title: (error && (error.message || error.errMsg)) || '收藏失败，请稍后重试', icon: 'none' }))
  },
  openRecipe(e) { wx.navigateTo({ url: `/pages/detail/detail?id=${e.currentTarget.dataset.id}` }) },
  goRecipes() { wx.switchTab({ url: '/pages/recipes/recipes' }) }
})
