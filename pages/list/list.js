const { aggregateAmounts } = require('../../utils/amount')
const sharedShopping = require('../../utils/shared-shopping')

function ingredientKey(name) { return String(name || '').trim().replace(/\s+/g, '').toLowerCase() }

Page({
  data: {
    items: [], recipeGroups: [], ingredientGroups: [], activeView: 'recipe',
    displayCount: 0, remainingCount: 0, checkedCount: 0,
    newName: '', newAmount: '', pendingCount: 0, syncing: false,
    syncError: false, legacyCount: 0, importPending: false
  },
  onShow() {
    this.getTabBar().setData({ selected: 3 })
    if (this.unsubscribeShopping) this.unsubscribeShopping()
    this.unsubscribeShopping = sharedShopping.subscribe(() => this.renderItems())
    sharedShopping.init()
    this.renderItems()
    this.refreshList()
    this.refreshTimer = setInterval(() => {
      if (!this.data.syncing) this.refreshList()
    }, 10000)
  },
  onHide() { clearInterval(this.refreshTimer); if (this.unsubscribeShopping) this.unsubscribeShopping(); this.unsubscribeShopping = null },
  onUnload() { clearInterval(this.refreshTimer); if (this.unsubscribeShopping) this.unsubscribeShopping(); this.unsubscribeShopping = null },
  onPullDownRefresh() { return this.refreshList().finally(() => wx.stopPullDownRefresh()) },
  refreshList() {
    this.setData({ syncing: true })
    return sharedShopping.sync().then(() => {
      this.setData({ syncError: false, syncing: false })
    }).catch(() => {
      this.setData({ syncError: true, syncing: false })
    }).finally(() => {
      this.setData({ syncing: false })
      this.renderItems()
    })
  },
  retrySync() { this.refreshList() },
  loadItems() { this.renderItems() },
  renderItems() {
    const state = sharedShopping.getState()
    const items = state.items
    const recipeMap = new Map()
    const ingredientMap = new Map()
    items.forEach(item => {
      const recipeKey = item.recipeId || 'manual'
      if (!recipeMap.has(recipeKey)) recipeMap.set(recipeKey, {
        key: recipeKey, name: item.recipeName || '手动添加',
        category: item.recipeCategory || (item.source === 'manual' ? '临时添加' : ''), items: []
      })
      recipeMap.get(recipeKey).items.push(item)
      const key = ingredientKey(item.name)
      if (!ingredientMap.has(key)) ingredientMap.set(key, { key, name: item.name, items: [] })
      ingredientMap.get(key).items.push(item)
    })
    const recipeGroups = Array.from(recipeMap.values())
    const ingredientGroups = Array.from(ingredientMap.values()).map(group => {
      const summary = aggregateAmounts(group.items)
      const checked = group.items.every(item => item.checked)
      const someChecked = group.items.some(item => item.checked)
      return Object.assign({}, group, { amount: summary.amount, note: summary.note, checked, partial: someChecked && !checked })
    })
    const visibleRows = this.data.activeView === 'recipe' ? items : ingredientGroups
    const migration = sharedShopping.getMigrationState()
    this.setData({
      items, recipeGroups, ingredientGroups,
      displayCount: visibleRows.length,
      checkedCount: visibleRows.filter(item => item.checked).length,
      remainingCount: visibleRows.filter(item => !item.checked).length,
      pendingCount: state.pendingCount,
      syncError: state.syncError || this.data.syncError,
      syncing: state.syncing,
      legacyCount: migration.items.length,
      importPending: migration.pending
    })
  },
  queueChange(task, successTitle) {
    this.renderItems()
    return Promise.resolve(task).then(result => {
      const entries = Array.isArray(result) ? result : [result]
      return Promise.all(entries.filter(Boolean).map(entry => entry.task || Promise.resolve()))
    }).then(() => {
      const state = sharedShopping.getState()
      this.setData({ syncError: state.syncError })
      this.renderItems()
      wx.showToast({
        title: state.pendingCount ? '已暂存，联网后同步' : (successTitle || '共享清单已更新'),
        icon: 'none'
      })
    }).catch(error => {
      this.renderItems()
      wx.showToast({ title: (error && (error.message || error.errMsg)) || '操作未能保存', icon: 'none' })
    })
  },
  switchView(e) { this.setData({ activeView: e.currentTarget.dataset.view }); this.renderItems() },
  toggleItem(e) {
    const item = this.data.items.find(row => row.id === e.currentTarget.dataset.id)
    if (!item) return
    this.queueChange(sharedShopping.setChecked([item.id], !item.checked))
  },
  toggleIngredient(e) {
    const group = this.data.ingredientGroups.find(item => item.key === e.currentTarget.dataset.key)
    if (!group) return
    this.queueChange(sharedShopping.setChecked(group.items.map(item => item.id), !group.checked))
  },
  deleteItem(e) { this.queueChange(sharedShopping.deleteItems([e.currentTarget.dataset.id]), '已从共享清单移除') },
  deleteIngredient(e) {
    const group = this.data.ingredientGroups.find(item => item.key === e.currentTarget.dataset.key)
    if (group) this.queueChange(sharedShopping.deleteItems(group.items.map(item => item.id)), '已从共享清单移除')
  },
  onNameInput(e) { this.setData({ newName: e.detail.value }) },
  onAmountInput(e) { this.setData({ newAmount: e.detail.value }) },
  addItem() {
    const name = this.data.newName.trim()
    if (!name) return wx.showToast({ title: '写下要买的食材吧', icon: 'none' })
    const amount = this.data.newAmount.trim() || '适量'
    const item = {
      id: `manual_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      name, amount, baseAmount: amount, sets: 1, checked: false,
      recipeId: 'manual', recipeName: '手动添加', recipeCategory: '临时添加', source: 'manual'
    }
    this.setData({ newName: '', newAmount: '' })
    this.queueChange(sharedShopping.addItems([item]), '已加入共享清单')
  },
  importLegacy() {
    const migration = sharedShopping.getMigrationState()
    if (!migration.items.length) return wx.showToast({ title: '没有待导入的本机项目', icon: 'none' })
    const preview = migration.items.slice(0, 20).map(item => `• ${item.name}  ${item.amount}`).join('\n')
    const extra = migration.items.length > 20 ? `\n以及另外 ${migration.items.length - 20} 项` : ''
    wx.showModal({
      title: '共享本机旧清单？',
      content: `以下项目将加入所有用户共用的清单：\n${preview}${extra}\n\n原本机清单会保留。`,
      confirmText: '确认共享',
      confirmColor: '#D8754C',
      success: result => {
        if (result.confirm) this.queueChange(sharedShopping.importLocalItems(migration.items), '旧清单已加入共享')
      }
    })
  },
  clearChecked() {
    const ids = this.data.items.filter(item => item.checked).map(item => item.id)
    if (!ids.length) return
    wx.showModal({
      title: '清除已买项目？',
      content: `将从所有用户的共享清单中移除 ${ids.length} 项。`,
      confirmText: '清除', confirmColor: '#C45A3D',
      success: result => { if (result.confirm) this.queueChange(sharedShopping.clearChecked(ids), '已清除已买项目') }
    })
  }
})
