const cloudConfig = require('./community-config')
let cloudReady = false
let accountVersion = 0
let loginTask = null

function getLocalRecipes() {
  return wx.getStorageSync('familyRecipes') || []
}

function isConfigured() {
  return Boolean(cloudConfig.envId && wx.cloud && typeof wx.cloud.callFunction === 'function')
}

function init() {
  if (!isConfigured() || cloudReady) return
  try {
    wx.cloud.init({ env: cloudConfig.envId, traceUser: true })
    cloudReady = true
  } catch (error) {
    cloudReady = false
  }
}

function call(action, data, functionName) {
  return new Promise((resolve, reject) => {
    if (!isConfigured()) return reject(new Error('请先配置云开发环境 ID'))
    init()
    if (!cloudReady) return reject(new Error('云开发初始化失败'))
    wx.cloud.callFunction({
      name: functionName || 'recipeHub',
      data: Object.assign({ action }, data || {}),
      success: result => {
        if (!result.result || result.result.ok === false) return reject(new Error((result.result && result.result.message) || '云端请求失败'))
        resolve(result.result)
      },
      fail: reject
    })
  })
}

function requestProfile() {
  const cached = wx.getStorageSync('communityProfile')
  if (cached && cached.nickname) return Promise.resolve(cached)
  if (isConfigured()) return call('getProfile').then(result => {
    const profile = result.profile || { nickname: '家庭成员', avatarUrl: '' }
    wx.setStorageSync('communityProfile', profile)
    return profile
  }).catch(() => ({ nickname: '家庭成员', avatarUrl: '' }))
  return Promise.resolve({ nickname: '家庭成员', avatarUrl: '' })
}

function withAuthor(recipe, defaults) {
  const profile = wx.getStorageSync('communityProfile') || {}
  return Object.assign({
    authorName: '家庭菜谱',
    authorAvatar: '',
    isMine: false,
    isCloud: false,
    favoriteCount: recipe.favorite ? 1 : 0,
    favoriteUsers: recipe.favorite ? [{ nickname: profile.nickname || '我', avatarUrl: profile.avatarUrl || '' }] : []
  }, recipe, defaults || {})
}

function syncRecipes() {
  const localRecipes = getLocalRecipes()
  if (!isConfigured()) {
    const recipes = localRecipes.map(recipe => withAuthor(recipe))
    wx.setStorageSync('familyRecipes', recipes)
    return Promise.resolve({ recipes, cloudEnabled: false, error: false })
  }

  init()
  return call('listRecipes').then(result => {
    const remoteRecipes = result.recipes || []
    const remoteIds = {}
    const recipes = remoteRecipes.map(recipe => {
      remoteIds[recipe.id] = true
      return withAuthor(recipe, { isCloud: true })
    })
    localRecipes.forEach(recipe => {
      if (!remoteIds[recipe.id]) recipes.push(withAuthor(recipe))
    })
    wx.setStorageSync('familyRecipes', recipes)
    wx.setStorageSync('communitySyncError', false)
    return { recipes, cloudEnabled: true, error: false }
  }).catch(error => {
    wx.setStorageSync('communitySyncError', true)
    return { recipes: localRecipes.map(recipe => withAuthor(recipe)), cloudEnabled: true, error: true, cause: error }
  })
}

function syncCategories() {
  const cached = wx.getStorageSync('familyRecipeSharedCategories') || []
  if (!isConfigured()) return Promise.resolve({ categories: cached, error: false })
  init()
  return call('listCategories').then(result => {
    const categories = (result.categories || []).map(category => Object.assign({}, category, { isCloud: true }))
    wx.setStorageSync('familyRecipeSharedCategories', categories)
    return { categories, error: false }
  }).catch(error => ({ categories: cached, error: true, cause: error }))
}

function createCategory(name) {
  return call('createCategory', { name }).then(result => {
    const category = Object.assign({}, result.category, { isCloud: true })
    const categories = wx.getStorageSync('familyRecipeSharedCategories') || []
    wx.setStorageSync('familyRecipeSharedCategories', categories.filter(item => item.name !== category.name).concat(category))
    return category
  })
}

function removeCategory(name) {
  return call('removeCategory', { name }).then(result => {
    const categories = wx.getStorageSync('familyRecipeSharedCategories') || []
    wx.setStorageSync('familyRecipeSharedCategories', categories.filter(item => item.name !== name))
    return result
  })
}

function uploadAvatar(filePath) {
  init()
  if (!filePath || !cloudReady || typeof wx.cloud.uploadFile !== 'function') return Promise.reject(new Error('头像上传暂不可用，请重试'))
  const suffix = (String(filePath).match(/\.(png|jpe?g|webp)$/i) || [])[0] || '.png'
  const cloudPath = `avatars/${Date.now()}_${Math.floor(Math.random() * 100000)}${suffix.toLowerCase()}`
  return new Promise((resolve, reject) => wx.cloud.uploadFile({
    cloudPath,
    filePath,
    success: result => result.fileID ? resolve(result.fileID) : reject(new Error('头像上传失败，请重试')),
    fail: reject
  }))
}

function authenticatedProfile(result, version) {
  if (version !== accountVersion) throw new Error('登录状态已改变，请重试')
  if (result.authenticated !== true || !result.profile || !result.profile.nickname) throw new Error('微信身份验证失败，请重试')
  return result.profile
}

function quickLogin() {
  if (loginTask) return loginTask
  const version = accountVersion
  const task = call('login', {}, 'accountHub').then(result => {
    const savedProfile = authenticatedProfile(result, version)
    wx.setStorageSync('communityProfile', savedProfile)
    wx.setStorageSync('familyLogin', { loggedIn: true, loggedAt: Date.now() })
    return { loggedIn: true, profile: savedProfile }
  })
  loginTask = task.then(result => {
    if (version === accountVersion) loginTask = null
    return result
  }, error => {
    if (version === accountVersion) loginTask = null
    throw error
  })
  return loginTask
}

function saveProfile(profile, avatarTempPath) {
  if (!(wx.getStorageSync('familyLogin') || {}).loggedIn) return Promise.reject(new Error('请先登录微信账号'))
  const version = accountVersion
  const uploadTask = avatarTempPath ? uploadAvatar(avatarTempPath) : Promise.resolve('')
  return uploadTask.then(avatarFileId => {
    if (version !== accountVersion) throw new Error('登录状态已改变，请重试')
    const changes = { nickname: profile.nickname }
    if (avatarFileId) changes.avatarFileId = avatarFileId
    return call('updateProfile', { profile: changes }, 'accountHub')
  }).then(result => {
    const savedProfile = authenticatedProfile(result, version)
    wx.setStorageSync('communityProfile', savedProfile)
    return savedProfile
  })
}

function logout() {
  accountVersion += 1
  loginTask = null
  wx.removeStorageSync('familyLogin')
  wx.removeStorageSync('communityProfile')
}

function refreshProfile() {
  if (!isConfigured()) return Promise.resolve(wx.getStorageSync('communityProfile') || {})
  const version = accountVersion
  return call('getProfile', {}, 'accountHub').then(result => {
    const profile = authenticatedProfile(result, version)
    if ((wx.getStorageSync('familyLogin') || {}).loggedIn) wx.setStorageSync('communityProfile', profile)
    return profile
  })
}

function saveLocalRecipe(recipe, profile, cloudPending) {
  const localRecipes = getLocalRecipes()
  const localRecipe = withAuthor(recipe, {
    authorName: (profile && profile.nickname) || recipe.authorName || '本机用户',
    authorAvatar: (profile && profile.avatarUrl) || recipe.authorAvatar || '',
    isMine: true,
    isCloud: Boolean(recipe.isCloud),
    cloudPending: Boolean(cloudPending)
  })
  const index = localRecipes.findIndex(item => item.id === recipe.id)
  if (index >= 0) localRecipes[index] = localRecipe
  else localRecipes.unshift(localRecipe)
  wx.setStorageSync('familyRecipes', localRecipes)
  return localRecipe
}

function saveRecipe(recipe) {
  if (!isConfigured()) {
    const profile = wx.getStorageSync('communityProfile') || {}
    return Promise.resolve(saveLocalRecipe(recipe, profile, false))
  }

  init()
  return requestProfile().then(profile => call('saveRecipe', { recipe, profile })).then(result => {
    const saved = withAuthor(result.recipe, { isCloud: true })
    const recipes = getLocalRecipes()
    const index = recipes.findIndex(item => item.id === saved.id)
    if (index >= 0) recipes[index] = saved
    else recipes.unshift(saved)
    wx.setStorageSync('familyRecipes', recipes)
    return saved
  })
}

function deleteRecipe(recipe) {
  if (!recipe || !recipe.isCloud || !isConfigured()) return Promise.resolve()
  init()
  return call('deleteRecipe', { recipeId: recipe.id })
}

function replaceLocalRecipe(oldId, recipe) {
  const recipes = getLocalRecipes()
  const index = recipes.findIndex(item => item.id === oldId)
  if (index >= 0) recipes[index] = recipe
  else {
    const existingIndex = recipes.findIndex(item => item.id === recipe.id)
    if (existingIndex >= 0) recipes[existingIndex] = recipe
    else recipes.unshift(recipe)
  }
  wx.setStorageSync('familyRecipes', recipes)

  if (oldId && oldId !== recipe.id) {
    const shoppingItems = (wx.getStorageSync('shoppingItems') || []).map(item => {
      if (item.recipeId !== oldId) return item
      return Object.assign({}, item, {
        id: `${recipe.id}::${item.name}`,
        recipeId: recipe.id,
        recipeName: recipe.name,
        recipeCategory: recipe.category
      })
    })
    wx.setStorageSync('shoppingItems', shoppingItems)
  }
}

function makeSharedId() {
  return `r${Date.now()}_${Math.floor(Math.random() * 100000)}`
}

function toggleLocalFavorite(recipe, favorite) {
  const profile = wx.getStorageSync('communityProfile') || {}
  const recipes = getLocalRecipes().map(item => item.id === recipe.id ? Object.assign({}, item, {
    favorite,
    favoriteCount: favorite ? Math.max(1, Number(item.favoriteCount) || 0) : 0,
    favoriteUsers: favorite ? [{ nickname: profile.nickname || '我', avatarUrl: profile.avatarUrl || '' }] : []
  }) : item)
  wx.setStorageSync('familyRecipes', recipes)
  return Promise.resolve(recipes.find(item => item.id === recipe.id) || recipe)
}

function toggleFavorite(recipe, favorite) {
  if (!recipe) return Promise.reject(new Error('菜谱不存在'))
  if (!isConfigured() || (!recipe.isCloud && !favorite)) return toggleLocalFavorite(recipe, favorite)

  init()
  const profilePromise = requestProfile()
  if (recipe.isCloud) {
    return profilePromise
      .then(profile => call('toggleFavorite', { recipeId: recipe.id, favorite, profile }))
      .then(result => {
        const saved = withAuthor(result.recipe, { isCloud: true })
        replaceLocalRecipe(recipe.id, saved)
        return saved
      })
  }

  const isDefaultRecipe = ['r1', 'r2', 'r3', 'r4'].indexOf(recipe.id) >= 0
  if (isDefaultRecipe) {
    return profilePromise
      .then(profile => call('toggleFavorite', { recipeId: recipe.id, favorite, profile }))
      .then(result => {
        const saved = withAuthor(result.recipe, { isCloud: true })
        replaceLocalRecipe(recipe.id, saved)
        return saved
      })
  }

  return profilePromise.then(profile => {
    const sharedRecipe = Object.assign({}, recipe, { id: makeSharedId(), favorite: false })
    return call('saveRecipe', { recipe: sharedRecipe, profile }).then(result => {
      const saved = withAuthor(result.recipe, { isCloud: true })
      replaceLocalRecipe(recipe.id, saved)
      return call('toggleFavorite', { recipeId: saved.id, favorite, profile })
    })
  }).then(result => {
    const saved = withAuthor(result.recipe, { isCloud: true })
    replaceLocalRecipe(saved.id, saved)
    return saved
  })
}

module.exports = { init, isConfigured, call, syncRecipes, syncCategories, createCategory, removeCategory, quickLogin, refreshProfile, saveProfile, logout, saveRecipe, deleteRecipe, toggleFavorite }
