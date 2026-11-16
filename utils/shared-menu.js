const community = require('./community')
const CACHE_KEY = 'sharedDailyMenus'

function getDays() {
  return wx.getStorageSync(CACHE_KEY) || {}
}

function cacheDays(days) {
  const cached = getDays()
  days.forEach(day => {
    // A read started before a save must not overwrite the newer save response.
    if (!cached[day.date] || day.revision >= cached[day.date].revision) cached[day.date] = day
  })
  wx.setStorageSync(CACHE_KEY, cached)
}

function sync(dates) {
  return community.call('listMenus', { dates }, 'menuHub').then(result => {
    if (!Array.isArray(result.days)) throw new Error('共享菜单暂不可用，请稍后重试')
    cacheDays(result.days)
  })
}

function mutate(data) {
  const request = Object.assign({}, data, {
    operationId: `menu_${Date.now()}_${Math.random().toString(36).slice(2)}`
  })
  function send() { return community.call('mutateMenu', request, 'menuHub') }
  // Reuse the id after a lost response so that one tap cannot add two portions.
  return send().catch(error => {
    if (error.errMsg && /timeout|network|fail/i.test(error.errMsg)) return send()
    throw error
  }).then(result => {
    if (!result.day) throw new Error('共享菜单保存失败，请稍后重试')
    cacheDays([result.day])
    return result.day
  })
}

module.exports = { getDays, sync, mutate }
