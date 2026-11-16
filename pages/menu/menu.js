const community = require('../../utils/community')
const sharedMenu = require('../../utils/shared-menu')
const sharedShopping = require('../../utils/shared-shopping')

const MEALS = [
  { key: 'breakfast', title: '早饭', subtitle: '开启元气的一天', emoji: '🌤️' },
  { key: 'lunch', title: '中饭', subtitle: '好好吃顿正餐', emoji: '☀️' },
  { key: 'dinner', title: '晚饭', subtitle: '一家人围桌吃饭', emoji: '🌙' }
]

function formatDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateLabel(value) {
  const today = formatDate(new Date())
  const next = new Date()
  next.setDate(next.getDate() + 1)
  if (value === today) return '今天'
  if (value === formatDate(next)) return '明天'
  const date = new Date(`${value}T00:00:00`)
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return `${date.getMonth() + 1}月${date.getDate()}日 · ${weekdays[date.getDay()]}`
}

function getWeekStart(value) {
  const date = new Date(`${value}T00:00:00`)
  const offset = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - offset)
  return date
}

function getWeekLabel(date) {
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

function emptyPlan() {
  return { breakfast: [], lunch: [], dinner: [] }
}

Page({
  data: {
    selectedDate: '',
    dateLabel: '',
    weekRange: '',
    weekDays: [],
    weekHistory: [],
    weekEatenCount: 0,
    weekView: false,
    meals: [],
    recipes: [],
    pickerVisible: false,
    pickerMeal: '',
    pickerMealTitle: '',
    availableRecipes: [],
    pickerKeyword: '',
    pickerHeight: 68,
    plannedCount: 0,
    syncing: false,
    saving: false,
    syncError: false,
    hasLegacyPlan: false
  },

  onLoad() {
    const selectedDate = formatDate(new Date())
    this.setData({ selectedDate, dateLabel: dateLabel(selectedDate) })
  },

  onShow() {
    this.menuVisible = true
    this.setData({ saving: (this.pendingSaves || 0) > 0 })
    this.getTabBar().setData({ selected: 4 })
    if (wx.getStorageSync('openDailyMenuToday')) {
      wx.removeStorageSync('openDailyMenuToday')
      this.openToday()
    } else {
      this.loadRecipes()
    }
    this.startMenuRefresh()
  },

  onHide() {
    this.stopMenuRefresh()
    const tabBar = this.getTabBar()
    if (tabBar) tabBar.setData({ hidden: false })
  },

  onUnload() { this.stopMenuRefresh() },

  onPullDownRefresh() {
    return this.refreshMenus().finally(() => wx.stopPullDownRefresh())
  },

  startMenuRefresh() {
    clearInterval(this.menuTimer)
    this.menuTimer = setInterval(() => {
      if (!this.pendingSaves) this.refreshMenus()
    }, 10000)
  },

  stopMenuRefresh() {
    this.menuVisible = false
    clearInterval(this.menuTimer)
  },

  refreshMenus() {
    const start = getWeekStart(this.data.selectedDate)
    const dates = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start)
      date.setDate(start.getDate() + index)
      return formatDate(date)
    })
    const key = dates[0]
    if (this.refreshTask && this.refreshKey === key) return this.refreshTask
    this.refreshKey = key
    const request = (this.refreshRequest || 0) + 1
    this.refreshRequest = request
    this.setData({ syncing: true })
    this.refreshTask = sharedMenu.sync(dates).then(() => {
      if (request !== this.refreshRequest || !this.menuVisible) return
      this.setData({ syncError: false })
      this.renderPlan()
    }).catch(() => {
      if (request === this.refreshRequest && this.menuVisible) this.setData({ syncError: true })
    }).finally(() => {
      if (request !== this.refreshRequest) return
      this.refreshTask = null
      if (this.menuVisible) this.setData({ syncing: false })
    })
    return this.refreshTask
  },

  saveMenu(change, successTitle) {
    const request = Object.assign({ date: this.data.selectedDate }, change)
    this.pendingSaves = (this.pendingSaves || 0) + 1
    this.setData({ saving: true })
    // Keep this device's taps in order; the server merges other users' operations transactionally.
    this.saveTask = (this.saveTask || Promise.resolve()).then(() => sharedMenu.mutate(request)).then(() => {
      if (this.menuVisible) {
        this.setData({ syncError: false })
        this.renderPlan()
        if (successTitle) wx.showToast({ title: successTitle, icon: 'none' })
      }
      return true
    }).catch(error => {
      if (this.menuVisible) {
        this.setData({ syncError: true })
        wx.showToast({ title: error.message || error.errMsg || '保存失败，请重试', icon: 'none' })
      }
      return false
    }).finally(() => {
      this.pendingSaves -= 1
      if (this.menuVisible) this.setData({ saving: this.pendingSaves > 0 })
    })
    return this.saveTask
  },

  openToday() {
    const selectedDate = formatDate(new Date())
    this.setData({ selectedDate, weekView: false, pickerVisible: false })
    wx.pageScrollTo({ scrollTop: 0, duration: 200 })
    this.loadRecipes()
  },

  loadRecipes() {
    this.renderPlan()
    this.refreshMenus()
    community.syncRecipes().then(sync => {
      this.setData({ recipes: sync.recipes || [] })
      this.renderPlan()
    })
  },

  renderPlan() {
    const days = sharedMenu.getDays()
    const dayPlan = (days[this.data.selectedDate] || {}).meals || emptyPlan()
    const meals = MEALS.map(meal => {
      const recipes = (dayPlan[meal.key] || []).map(recipe => Object.assign({ quantity: 1 }, recipe))
      const count = recipes.reduce((total, recipe) => total + Math.max(1, Number(recipe.quantity) || 1), 0)
      return Object.assign({}, meal, { recipes, count })
    })
    const plannedCount = meals.reduce((count, meal) => count + meal.count, 0)
    const start = getWeekStart(this.data.selectedDate)
    const history = Object.keys(days).reduce((all, date) => all.concat(days[date].history || []), [])
    const weekDays = []
    const weekHistory = []
    let weekEatenCount = 0
    const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
    for (let index = 0; index < 7; index += 1) {
      const date = new Date(start)
      date.setDate(start.getDate() + index)
      const value = formatDate(date)
      const dayItems = history.filter(item => item.date === value)
      const eatenCount = dayItems.reduce((count, item) => count + Math.max(1, Number(item.quantity) || 1), 0)
      weekDays.push({ date: value, weekday: weekdays[index], day: date.getDate(), selected: value === this.data.selectedDate, eatenCount })
      if (!dayItems.length) continue
      weekEatenCount += eatenCount
      const dayMeals = MEALS.map(meal => ({
        key: meal.key,
        title: meal.title,
        emoji: meal.emoji,
        recipes: dayItems.filter(item => item.mealKey === meal.key)
      })).filter(meal => meal.recipes.length)
      weekHistory.push({ date: value, label: `${getWeekLabel(date)} · ${weekdays[index]}`, meals: dayMeals, count: eatenCount })
    }
    const end = new Date(start)
    end.setDate(start.getDate() + 6)
    this.setData({
      meals,
      plannedCount,
      dateLabel: dateLabel(this.data.selectedDate),
      weekRange: `${getWeekLabel(start)} — ${getWeekLabel(end)}`,
      weekDays,
      weekHistory,
      weekEatenCount,
      hasLegacyPlan: this.hasLegacyPlan()
    })
    if (this.data.pickerVisible) this.filterAvailableRecipes(this.data.pickerKeyword)
  },

  switchView(e) {
    this.setData({ weekView: e.currentTarget.dataset.view === 'week' })
    this.renderPlan()
  },

  shiftWeek(e) {
    const date = getWeekStart(this.data.selectedDate)
    date.setDate(date.getDate() + Number(e.currentTarget.dataset.offset))
    const selectedDate = formatDate(date)
    this.setData({ selectedDate })
    this.renderPlan()
    this.refreshMenus()
  },

  selectWeekDay(e) {
    const selectedDate = e.currentTarget.dataset.date
    this.setData({ selectedDate, weekView: false })
    this.renderPlan()
    this.refreshMenus()
  },

  selectDate(e) {
    const selectedDate = e.detail.value
    this.setData({ selectedDate, pickerVisible: false })
    this.renderPlan()
    this.refreshMenus()
  },

  shiftDate(e) {
    const date = new Date(`${this.data.selectedDate}T00:00:00`)
    date.setDate(date.getDate() + Number(e.currentTarget.dataset.offset))
    const selectedDate = formatDate(date)
    this.setData({ selectedDate })
    this.renderPlan()
    this.refreshMenus()
  },

  openRecipePicker(e) {
    const mealKey = e.currentTarget.dataset.meal
    const meal = MEALS.find(item => item.key === mealKey)
    if (!meal) return
    this.setData({ pickerVisible: true, pickerMeal: mealKey, pickerMealTitle: meal.title, pickerKeyword: '', pickerHeight: 68 })
    const tabBar = this.getTabBar()
    if (tabBar) tabBar.setData({ hidden: true })
    this.filterAvailableRecipes('')
  },

  closeRecipePicker() {
    this.setData({ pickerVisible: false })
    const tabBar = this.getTabBar()
    if (tabBar) tabBar.setData({ hidden: false })
  },

  stopPropagation() {},

  onPickerTouchStart(e) {
    const touch = e.touches[0]
    this.pickerViewportHeight = wx.getSystemInfoSync().windowHeight
    this.pickerDrag = { startY: touch.clientY, startHeight: this.data.pickerHeight }
  },

  onPickerTouchMove(e) {
    if (!this.pickerDrag) return
    const touch = e.touches[0]
    const delta = (this.pickerDrag.startY - touch.clientY) / this.pickerViewportHeight * 100
    const pickerHeight = Math.max(42, Math.min(92, this.pickerDrag.startHeight + delta))
    this.setData({ pickerHeight })
  },

  onPickerTouchEnd() {
    this.pickerDrag = null
  },

  onPickerSearch(e) {
    const pickerKeyword = e.detail.value.trim()
    this.setData({ pickerKeyword })
    this.filterAvailableRecipes(pickerKeyword)
  },

  filterAvailableRecipes(keyword) {
    const day = sharedMenu.getDays()[this.data.selectedDate] || {}
    const alreadyPlanned = ((day.meals || emptyPlan())[this.data.pickerMeal] || [])
    const recipes = this.data.recipes
      .filter(recipe => !keyword || recipe.name.includes(keyword) || (recipe.ingredients || []).some(item => item.name.includes(keyword)))
      .map(recipe => {
        const selected = alreadyPlanned.find(item => item.id === recipe.id)
        return Object.assign({}, recipe, { selectedQuantity: selected ? Math.max(1, Number(selected.quantity) || 1) : 0 })
      })
    this.setData({ availableRecipes: recipes })
  },

  chooseRecipe(e) {
    const recipeId = e.currentTarget.dataset.id
    const recipe = this.data.recipes.find(item => item.id === recipeId)
    if (!recipe) return
    return this.saveMenu({ operation: 'add', mealKey: this.data.pickerMeal, recipe }, '已加入共享菜单')
  },

  decreaseRecipe(e) {
    const recipeId = e.currentTarget.dataset.id
    return this.saveMenu({ operation: 'decrease', mealKey: this.data.pickerMeal, recipeId })
  },

  removeRecipe(e) {
    const mealKey = e.currentTarget.dataset.meal
    const recipeId = e.currentTarget.dataset.id
    return this.saveMenu({ operation: 'remove', mealKey, recipeId })
  },

  toggleEaten(e) {
    const mealKey = e.currentTarget.dataset.meal
    const recipeId = e.currentTarget.dataset.id
    const day = sharedMenu.getDays()[this.data.selectedDate]
    const recipe = day && day.meals[mealKey].find(item => item.id === recipeId)
    if (!recipe) return
    return this.saveMenu({ operation: 'setEaten', mealKey, recipeId, eaten: !recipe.eaten })
  },

  openRecipe(e) {
    const id = e.currentTarget.dataset.id
    const day = sharedMenu.getDays()[this.data.selectedDate]
    const recipe = day && MEALS.reduce((all, meal) => all.concat(day.meals[meal.key] || []), []).find(item => item.id === id)
    if (recipe) wx.setStorageSync('dailyMenuRecipePreview', recipe)
    wx.navigateTo({ url: `/pages/detail/detail?id=${encodeURIComponent(id)}&fromMenu=1` })
  },

  addMenuIngredients() {
    if (this.data.saving || this.data.syncing || this.data.syncError) return wx.showToast({ title: '请等待菜单同步成功后再添加', icon: 'none' })
    const dayPlan = (sharedMenu.getDays()[this.data.selectedDate] || {}).meals || emptyPlan()
    const selected = MEALS.reduce((all, meal) => all.concat(dayPlan[meal.key] || []), [])
    if (!selected.length) return wx.showToast({ title: '先为今天安排几道菜吧', icon: 'none' })

    sharedShopping.addMenuIngredients(selected).then(entries => Promise.all(entries.map(entry => entry.task)))
      .then(() => wx.showToast({ title: sharedShopping.getState().pendingCount ? '已暂存，联网后同步' : '已加入共享清单', icon: 'none' }))
      .catch(error => wx.showToast({ title: error.message || '加入清单失败', icon: 'none' }))
  },

  clearDayMenu() {
    if (!this.data.plannedCount) return
    const date = this.data.selectedDate
    wx.showModal({
      title: '清空当天菜单？',
      content: '所有人都会看到当天菜单被清空，已吃记录和买菜清单会保留。',
      confirmText: '清空',
      confirmColor: '#D8754C',
      success: result => {
        if (!result.confirm) return
        this.saveMenu({ operation: 'clear', date }, '已清空共享菜单')
      }
    })
  },

  hasLegacyPlan() {
    const date = this.data.selectedDate
    if ((wx.getStorageSync('sharedMenuImportedDates') || []).includes(date)) return false
    const plan = (wx.getStorageSync('dailyMenus') || {})[date] || {}
    return MEALS.some(meal => (plan[meal.key] || []).length)
  },

  importLegacyPlan() {
    if (this.data.saving) return
    const date = this.data.selectedDate
    const meals = (wx.getStorageSync('dailyMenus') || {})[date] || emptyPlan()
    return this.saveMenu({ operation: 'import', date, meals }, '本机旧安排已共享').then(saved => {
      if (!saved) return
      const imported = wx.getStorageSync('sharedMenuImportedDates') || []
      wx.setStorageSync('sharedMenuImportedDates', imported.concat(date))
      if (this.menuVisible) this.renderPlan()
    })
  }
})
