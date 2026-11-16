const community = require('./utils/community')
const sharedShopping = require('./utils/shared-shopping')

App({
  onLaunch() {
    community.init()
    sharedShopping.init()
    if (!wx.getStorageSync('familyRecipes')) {
      wx.setStorageSync('familyRecipes', this.seedRecipes())
    }
    if (!wx.getStorageSync('shoppingItems')) wx.setStorageSync('shoppingItems', [])
  },
  seedRecipes() {
    return [
      { id: 'r1', name: '番茄炖牛腩', category: '家常硬菜', time: 90, servings: 3, difficulty: '中等', emoji: '🍅', color: '#F8E7D8', description: '酸甜浓郁的汤汁裹着软烂牛腩，配米饭特别香。周末炖上一锅，全家都爱吃。', ingredients: [{name:'牛腩',amount:'500 克'},{name:'番茄',amount:'3 个'},{name:'洋葱',amount:'半个'},{name:'姜片',amount:'4 片'},{name:'生抽',amount:'2 勺'},{name:'冰糖',amount:'少许'}], steps: ['牛腩切块，冷水下锅焯水，洗净浮沫。','番茄切块，洋葱切丝；热锅少油，炒香姜片和洋葱。','放入牛腩翻炒，加生抽和冰糖，再加入番茄炒出汁。','加热水没过食材，小火炖约 1 小时至牛腩软烂。'], favorite: true },
      { id: 'r2', name: '葱香鸡蛋', category: '快手家常', time: 15, servings: 2, difficulty: '简单', emoji: '🍳', color: '#F5EEE4', description: '葱香扑鼻、几分钟就能上桌的家常菜。', ingredients: [{name:'鸡蛋',amount:'3 个'},{name:'小葱',amount:'2 根'},{name:'盐',amount:'少许'},{name:'食用油',amount:'适量'}], steps: ['鸡蛋打散，加少许盐；小葱切成葱花。','热锅倒油，倒入蛋液快速翻炒至凝固。','撒入葱花，翻炒几下即可出锅。'], favorite: false, kidFriendly: true },
      { id: 'r3', name: '蒜蓉炒青菜', category: '素食清爽', time: 10, servings: 2, difficulty: '简单', emoji: '🥬', color: '#E8EEDB', description: '清脆爽口，新手也能轻松做好。', ingredients: [{name:'时令青菜',amount:'一把'},{name:'蒜',amount:'3 瓣'},{name:'盐',amount:'适量'},{name:'食用油',amount:'少许'}], steps: ['青菜洗净沥干，蒜切末。','热锅下油，放入蒜末炒出香味。','大火放入青菜快速翻炒，加盐调味，断生即可出锅。'], favorite: false, kidFriendly: true },
      { id: 'r4', name: '玉米排骨汤', category: '暖心汤羹', time: 60, servings: 4, difficulty: '简单', emoji: '🍲', color: '#F1E8D9', description: '清甜暖胃，炖好一锅全家分享。', ingredients: [{name:'排骨',amount:'500 克'},{name:'玉米',amount:'1 根'},{name:'胡萝卜',amount:'1 根'},{name:'姜',amount:'3 片'}], steps: ['排骨切块焯水，玉米和胡萝卜切段。','排骨、玉米、胡萝卜和姜片放入汤锅，加足量清水。','大火煮开后转小火炖 50 分钟，加盐调味。'], favorite: false }
    ]
  }
})
