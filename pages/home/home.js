const community = require('../../utils/community')

Page({
  data: { recipes: [], filteredRecipes: [], categories: ['全部', '快手菜', '汤汤水水', '孩子爱吃'], activeCategory: '全部', keyword: '', featured: {}, dayLabel: '', safeTop: 0, cloudEnabled: false },
  onShow() {
    this.getTabBar().setData({ selected: 0 })
    const profile = wx.getStorageSync('communityProfile') || {}
    const loginState = wx.getStorageSync('familyLogin') || {}
    this.setData({
      dayLabel: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date().getDay()],
      safeTop: (wx.getSystemInfoSync().statusBarHeight || 20) + 8,
      profile,
      loggedIn: Boolean(loginState.loggedIn)
    })
    this.loadRecipes()
  },
  onPullDownRefresh() { this.loadRecipes().then(() => wx.stopPullDownRefresh()) },
  loadRecipes() {
    return community.syncRecipes().then(sync => {
      const recipes = sync.recipes
      this.setData({ recipes, featured: recipes[0] || {}, cloudEnabled: sync.cloudEnabled })
      this.filterRecipes(recipes, this.data.activeCategory, this.data.keyword)
    })
  },
  matchesCategory(recipe, category) {
    if (category === '全部') return true
    if (category === '快手菜') return recipe.time <= 30
    if (category === '汤汤水水') return recipe.category === '暖心汤羹'
    if (category === '孩子爱吃') return recipe.kidFriendly || ['香煎鸡翅', '番茄炖牛腩'].includes(recipe.name)
    return true
  },
  filterRecipes(recipes, category, keyword) {
    const result = recipes.filter(r => this.matchesCategory(r, category) && (!keyword || r.name.includes(keyword) || (r.ingredients || []).some(i => i.name.includes(keyword))))
    this.setData({ filteredRecipes: result })
  },
  onSearch(e) { this.setData({ keyword: e.detail.value }); this.filterRecipes(this.data.recipes, this.data.activeCategory, e.detail.value) },
  clearSearch() { this.setData({ keyword: '' }); this.filterRecipes(this.data.recipes, this.data.activeCategory, '') },
  selectCategory(e) { const category = e.currentTarget.dataset.category; this.setData({ activeCategory: category }); this.filterRecipes(this.data.recipes, category, this.data.keyword) },
  openRecipe(e) { const id = e.currentTarget.dataset.id || this.data.featured.id; if (id) wx.navigateTo({ url: `/pages/detail/detail?id=${id}` }) },
  goRecipes() { wx.switchTab({ url: '/pages/recipes/recipes' }) },
  goProfile() { wx.navigateTo({ url: '/pages/profile/profile' }) },
  goAdd() { wx.navigateTo({ url: '/pages/add/add' }) },
  toggleFavorite(e) {
    const id = e.currentTarget.dataset.id
    const recipe = this.data.recipes.find(item => item.id === id)
    if (!recipe) return
    community.toggleFavorite(recipe, !recipe.favorite).then(() => this.loadRecipes())
      .catch(error => wx.showToast({ title: (error && (error.message || error.errMsg)) || '收藏失败，请稍后重试', icon: 'none' }))
  }
})
