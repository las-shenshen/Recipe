Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/home/home', text: '首页', icon: '⌂' },
      { pagePath: '/pages/recipes/recipes', text: '菜谱', icon: '▤' },
      { pagePath: '/pages/favorites/favorites', text: '收藏', icon: '♡' },
      { pagePath: '/pages/list/list', text: '买菜清单', icon: '☷' },
      { pagePath: '/pages/menu/menu', text: '点菜', icon: '♨' }
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
