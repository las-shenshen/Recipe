const community = require('../../utils/community')

Page({
  data: {
    loading: false,
    editing: false,
    loggedIn: false,
    profile: { nickname: '', avatarUrl: '' },
    nicknameInput: '',
    avatarTempPath: '',
    avatarBroken: false
  },

  onShow() {
    const loginState = wx.getStorageSync('familyLogin') || {}
    const profile = wx.getStorageSync('communityProfile') || {}
    this.setData({
      loggedIn: Boolean(loginState.loggedIn),
      profile,
      nicknameInput: profile.nickname || '',
      avatarTempPath: '',
      avatarBroken: false,
      editing: false
    })
    if (loginState.loggedIn) {
      community.refreshProfile().then(nextProfile => {
        if ((wx.getStorageSync('familyLogin') || {}).loggedIn) {
          this.setData({ profile: nextProfile, nicknameInput: this.data.editing ? this.data.nicknameInput : nextProfile.nickname || '' })
        }
      }).catch(() => {})
    }
  },

  onChooseAvatar(event) {
    const avatarTempPath = event.detail && event.detail.avatarUrl
    if (avatarTempPath) this.setData({ avatarTempPath, avatarBroken: false })
  },

  onAvatarError() {
    this.setData({ avatarBroken: true })
  },

  onNicknameInput(event) {
    this.setData({ nicknameInput: event.detail.value || '' })
  },

  login() {
    if (this.data.loading) return
    if (!community.isConfigured()) return wx.showToast({ title: '云服务暂不可用，请稍后再试', icon: 'none' })
    this.setData({ loading: true })
    community.quickLogin().then(result => {
      this.setData({ loading: false, loggedIn: true, profile: result.profile, nicknameInput: result.profile.nickname || '', avatarBroken: false, editing: false })
      wx.showToast({ title: '微信登录成功', icon: 'success' })
    }).catch(error => {
      this.setData({ loading: false })
      wx.showToast({ title: (error && (error.message || error.errMsg)) || '登录失败，请稍后重试', icon: 'none' })
    })
  },

  editProfile() {
    this.setData({ editing: true, nicknameInput: this.data.profile.nickname || '' })
  },

  cancelEdit() {
    this.setData({ editing: false, nicknameInput: this.data.profile.nickname || '', avatarTempPath: '' })
  },

  saveProfile() {
    if (this.data.loading) return
    const nickname = String(this.data.nicknameInput || '').trim()
    if (!nickname || Array.from(nickname).length > 30) {
      return wx.showToast({ title: '昵称请填写 1–30 个字', icon: 'none' })
    }
    this.setData({ loading: true })
    community.saveProfile({ nickname }, this.data.avatarTempPath).then(profile => {
      this.setData({ loading: false, profile, nicknameInput: profile.nickname, avatarTempPath: '', avatarBroken: false, editing: false })
      wx.showToast({ title: '资料已更新', icon: 'success' })
    }).catch(error => {
      this.setData({ loading: false })
      wx.showToast({ title: (error && (error.message || error.errMsg)) || '保存失败，请稍后重试', icon: 'none' })
    })
  },

  logout() {
    wx.showModal({
      title: '退出微信登录',
      content: '退出后，本机将不再显示账号资料；已保存的菜谱和收藏会保留。',
      confirmText: '退出登录',
      confirmColor: '#C45A3D',
      success: result => {
        if (!result.confirm) return
        community.logout()
        this.setData({ loggedIn: false, profile: { nickname: '', avatarUrl: '' }, nicknameInput: '', avatarTempPath: '', avatarBroken: false, editing: false })
        wx.showToast({ title: '已退出登录', icon: 'none' })
      }
    })
  },

  goRecipes() { wx.switchTab({ url: '/pages/recipes/recipes' }) },
  goFavorites() { wx.switchTab({ url: '/pages/favorites/favorites' }) },
  goMenu() { wx.switchTab({ url: '/pages/menu/menu' }) },
  goShopping() { wx.switchTab({ url: '/pages/list/list' }) }
})
