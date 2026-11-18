Component({
  data: {
    selected: 0,
    hidden: false,
    list: [
      { pagePath: '/pages/home/home', text: '首页', icon: 'home' },
      { pagePath: '/pages/recipes/recipes', text: '菜谱', icon: 'recipes' },
      { pagePath: '/pages/favorites/favorites', text: '收藏', icon: 'favorites' },
      { pagePath: '/pages/list/list', text: '买菜清单', icon: 'list' },
      { pagePath: '/pages/menu/menu', text: '点菜', icon: 'menu' }
    ]
  },
  methods: {
    switchTab(e) {
      const index = e.currentTarget.dataset.index
      const item = this.data.list[index]
      if (item.pagePath === '/pages/menu/menu') {
        const pages = getCurrentPages()
        const currentPage = pages[pages.length - 1]
        if (currentPage && currentPage.route === 'pages/menu/menu' && typeof currentPage.openToday === 'function') {
          currentPage.openToday()
          return
        }
        wx.setStorageSync('openDailyMenuToday', true)
      }
      wx.switchTab({ url: item.pagePath })
    }
  }
})
