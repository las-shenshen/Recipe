const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const recipesCollection = db.collection('recipes')
const favoritesCollection = db.collection('recipe_favorites')
const profilesCollection = db.collection('user_profiles')
const categoriesCollection = db.collection('recipe_categories')
const DEFAULT_RECIPES = [
  { id: 'r1', name: '番茄炖牛腩', category: '家常硬菜', time: 90, servings: 3, difficulty: '中等', emoji: '🍅', color: '#F8E7D8', description: '酸甜浓郁的汤汁裹着软烂牛腩，配米饭特别香。周末炖上一锅，全家都爱吃。', ingredients: [{ name: '牛腩', amount: '500 克' }, { name: '番茄', amount: '3 个' }, { name: '洋葱', amount: '半个' }, { name: '姜片', amount: '4 片' }, { name: '生抽', amount: '2 勺' }, { name: '冰糖', amount: '少许' }], steps: ['牛腩切块，冷水下锅焯水，洗净浮沫。', '番茄切块，洋葱切丝；热锅少油，炒香姜片和洋葱。', '放入牛腩翻炒，加生抽和冰糖，再加入番茄炒出汁。', '加热水没过食材，小火炖约 1 小时至牛腩软烂。'], kidFriendly: false },
  { id: 'r2', name: '葱香鸡蛋', category: '快手家常', time: 15, servings: 2, difficulty: '简单', emoji: '🍳', color: '#F5EEE4', description: '葱香扑鼻、几分钟就能上桌的家常菜。', ingredients: [{ name: '鸡蛋', amount: '3 个' }, { name: '小葱', amount: '2 根' }, { name: '盐', amount: '少许' }, { name: '食用油', amount: '适量' }], steps: ['鸡蛋打散，加少许盐；小葱切成葱花。', '热锅倒油，倒入蛋液快速翻炒至凝固。', '撒入葱花，翻炒几下即可出锅。'], kidFriendly: true },
  { id: 'r3', name: '蒜蓉炒青菜', category: '素食清爽', time: 10, servings: 2, difficulty: '简单', emoji: '🥬', color: '#E8EEDB', description: '清脆爽口，新手也能轻松做好。', ingredients: [{ name: '时令青菜', amount: '一把' }, { name: '蒜', amount: '3 瓣' }, { name: '盐', amount: '适量' }, { name: '食用油', amount: '少许' }], steps: ['青菜洗净沥干，蒜切末。', '热锅下油，放入蒜末炒出香味。', '大火放入青菜快速翻炒，加盐调味，断生即可出锅。'], kidFriendly: true },
  { id: 'r4', name: '玉米排骨汤', category: '暖心汤羹', time: 60, servings: 4, difficulty: '简单', emoji: '🍲', color: '#F1E8D9', description: '清甜暖胃，炖好一锅全家分享。', ingredients: [{ name: '排骨', amount: '500 克' }, { name: '玉米', amount: '1 根' }, { name: '胡萝卜', amount: '1 根' }, { name: '姜', amount: '3 片' }], steps: ['排骨切块焯水，玉米和胡萝卜切段。', '排骨、玉米、胡萝卜和姜片放入汤锅，加足量清水。', '大火煮开后转小火炖 50 分钟，加盐调味。'], kidFriendly: false }
]

function resolveProfileAvatars(profiles) {
  const fileIds = []
  ;(profiles || []).forEach(profile => {
    const id = profile.avatarFileId || (String(profile.avatarUrl || '').indexOf('cloud://') === 0 ? profile.avatarUrl : '')
    if (id && fileIds.indexOf(id) < 0) fileIds.push(id)
  })
  if (!fileIds.length) return Promise.resolve(profiles || [])
  const chunks = []
  for (let index = 0; index < fileIds.length; index += 50) chunks.push(fileIds.slice(index, index + 50))
  return Promise.all(chunks.map(fileList => cloud.getTempFileURL({ fileList }))).then(results => {
    const urls = {}
    results.forEach(result => (result.fileList || []).forEach(item => {
      if (item.status === 0 && item.tempFileURL) urls[item.fileID] = item.tempFileURL
    }))
    return (profiles || []).map(profile => {
      const id = profile.avatarFileId || (String(profile.avatarUrl || '').indexOf('cloud://') === 0 ? profile.avatarUrl : '')
      return Object.assign({}, profile, { avatarUrl: urls[id] || (String(profile.avatarUrl || '').indexOf('cloud://') === 0 ? '' : (profile.avatarUrl || '')) })
    })
  }).catch(() => (profiles || []).map(profile => Object.assign({}, profile, {
    avatarUrl: String(profile.avatarUrl || '').indexOf('cloud://') === 0 ? '' : (profile.avatarUrl || '')
  })))
}

function getUserProfile(openid) {
  return profilesCollection.where({ _id: openid }).limit(1).get().then(result => {
    const profile = (result.data || [])[0] || { _id: openid, nickname: '家庭成员', avatarUrl: '' }
    return resolveProfileAvatars([profile]).then(items => items[0])
  })
}

function saveUserProfile(openid, profile) {
  const input = profile || {}
  const avatarFileId = String(input.avatarFileId || '')
  const data = {
    nickname: String(input.nickname || '家庭成员').slice(0, 30),
    avatarFileId,
    avatarUrl: avatarFileId || String(input.avatarUrl || '').slice(0, 2048),
    updatedAt: db.serverDate()
  }
  return profilesCollection.doc(openid).set({ data }).then(() => resolveProfileAvatars([data]).then(items => items[0]))
}

function quickLogin(event, openid) {
  if (!openid) return Promise.reject(new Error('微信身份识别失败，请重试'))
  if (!event.profile || !String(event.profile.nickname || '').trim() || !(event.profile.avatarFileId || event.profile.avatarUrl)) {
    return Promise.reject(new Error('请先填写微信昵称并选择头像'))
  }
  return saveUserProfile(openid, event.profile).then(profile => ({
    loggedIn: true,
    profile: { nickname: profile.nickname, avatarUrl: profile.avatarUrl, avatarFileId: profile.avatarFileId }
  }))
}

function currentProfile(openid) {
  return getUserProfile(openid).then(profile => ({ profile: { nickname: profile.nickname, avatarUrl: profile.avatarUrl, avatarFileId: profile.avatarFileId || '' } }))
}

function normalizeCategoryName(value) {
  return String(value || '').trim().slice(0, 20)
}

function categoryDocumentId(name) {
  return `cat_${Buffer.from(name, 'utf8').toString('hex')}`
}

function listCategories(openid) {
  return categoriesCollection.orderBy('name', 'asc').limit(200).get().then(result => ({
    categories: (result.data || []).map(item => ({
      name: item.name,
      createdBy: item.createdBy,
      isMine: item.createdBy === openid
    }))
  }))
}

function createCategory(event, openid) {
  const name = normalizeCategoryName(event.name)
  if (!name) return Promise.reject(new Error('分类名称不能为空'))
  const id = categoryDocumentId(name)
  return categoriesCollection.where({ _id: id }).limit(1).get().then(result => {
    const existing = (result.data || [])[0]
    if (existing) return { category: { name: existing.name, createdBy: existing.createdBy, isMine: existing.createdBy === openid } }
    const data = { name, createdBy: openid, createdAt: db.serverDate() }
    return categoriesCollection.doc(id).set({ data }).then(() => ({ category: { name, createdBy: openid, isMine: true } }))
  })
}

function removeCategory(event, openid) {
  const name = normalizeCategoryName(event.name)
  if (!name) return Promise.reject(new Error('分类名称不能为空'))
  const id = categoryDocumentId(name)
  return categoriesCollection.where({ _id: id }).limit(1).get().then(result => {
    const category = (result.data || [])[0]
    if (!category) return { deleted: false }
    if (category.createdBy !== openid) return Promise.reject(new Error('只能删除自己创建的分类'))
    return recipesCollection.where({ category: name }).count().then(result => {
      if (result.total > 0) return Promise.reject(new Error('该分类下还有菜谱，请先调整菜谱分类'))
      return categoriesCollection.doc(id).remove().then(() => ({ deleted: true }))
    })
  })
}

function loadRecipe(recipeId) {
  return recipesCollection.where({ _id: recipeId }).limit(1).get().then(result => (result.data || [])[0] || null)
}

function loadRecipeFavorites(recipeId, openid) {
  return Promise.all([
    favoritesCollection.where({ recipeId }).orderBy('createdAt', 'desc').limit(8).get(),
    favoritesCollection.where({ recipeId }).count(),
    favoritesCollection.where({ recipeId, openid }).limit(1).get()
  ]).then(results => {
    const favorites = results[0].data || []
    const count = results[1].total || favorites.length
    const favorite = (results[2].data || []).length > 0
    const userIds = []
    favorites.forEach(item => {
      if (userIds.indexOf(item.openid) < 0) userIds.push(item.openid)
    })
    if (favorite && userIds.indexOf(openid) < 0) userIds.push(openid)
    return Promise.all(userIds.map(getUserProfile)).then(profiles => ({
      favorite,
      favoriteCount: count,
      favoriteUsers: profiles.map(profile => ({ nickname: profile.nickname, avatarUrl: profile.avatarUrl }))
    }))
  })
}

function presentRecipe(recipe, openid) {
  const authorTask = recipe.authorOpenid === 'system'
    ? Promise.resolve({ nickname: '家庭菜谱', avatarUrl: '' })
    : getUserProfile(recipe.authorOpenid)
  return Promise.all([authorTask, loadRecipeFavorites(recipe._id, openid)]).then(results => {
    const author = results[0]
    return Object.assign({}, cleanRecipe(recipe), {
      id: recipe._id,
      createdAt: recipe.createdAt,
      updatedAt: recipe.updatedAt,
      authorName: author.nickname,
      authorAvatar: author.avatarUrl,
      isMine: recipe.authorOpenid === openid,
      isCloud: true
    }, results[1])
  })
}

function listRecipes(openid) {
  return recipesCollection.orderBy('updatedAt', 'desc').limit(60).get().then(async result => {
    const recipes = result.data || []
    if (!recipes.length) return []
    const recipeIds = recipes.map(recipe => recipe._id)
    const favoriteResult = await favoritesCollection.where({ recipeId: _.in(recipeIds) }).limit(1000).get()
    const favoritesByRecipe = {}
    const openids = []
    recipes.forEach(recipe => { if (openids.indexOf(recipe.authorOpenid) < 0) openids.push(recipe.authorOpenid) })
    ;(favoriteResult.data || []).forEach(favorite => {
      if (!favoritesByRecipe[favorite.recipeId]) favoritesByRecipe[favorite.recipeId] = []
      favoritesByRecipe[favorite.recipeId].push(favorite)
      if (openids.indexOf(favorite.openid) < 0) openids.push(favorite.openid)
    })
    const profileChunks = []
    for (let index = 0; index < openids.length; index += 100) profileChunks.push(openids.slice(index, index + 100))
    const profileResults = await Promise.all(profileChunks.map(chunk => profilesCollection.where({ _id: _.in(chunk) }).limit(100).get()))
    const profiles = {}
    const storedProfiles = []
    profileResults.forEach(result => (result.data || []).forEach(profile => storedProfiles.push(profile)))
    const hydratedProfiles = await resolveProfileAvatars(storedProfiles)
    hydratedProfiles.forEach(profile => { profiles[profile._id] = profile })
    return recipes.map(recipe => {
      const author = profiles[recipe.authorOpenid] || { nickname: '家庭成员', avatarUrl: '' }
      const favorites = favoritesByRecipe[recipe._id] || []
      return Object.assign({}, cleanRecipe(recipe), {
        id: recipe._id,
        createdAt: recipe.createdAt,
        updatedAt: recipe.updatedAt,
        authorName: author.nickname,
        authorAvatar: author.avatarUrl,
        isMine: recipe.authorOpenid === openid,
        isCloud: true,
        favorite: favorites.some(item => item.openid === openid),
        favoriteCount: favorites.length,
        favoriteUsers: favorites.slice(0, 8).map(item => {
          const profile = profiles[item.openid] || { nickname: '家庭成员', avatarUrl: '' }
          return { nickname: profile.nickname, avatarUrl: profile.avatarUrl }
        })
      })
    })
  })
}

function ensureDefaultRecipe(recipeId) {
  const seed = DEFAULT_RECIPES.find(recipe => recipe.id === recipeId)
  if (!seed) return Promise.reject(new Error('这道菜谱已不存在'))
  const data = Object.assign({}, cleanRecipe(seed), {
    authorOpenid: 'system',
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  })
  return recipesCollection.doc(recipeId).set({ data }).then(() => Object.assign({ _id: recipeId }, data))
}

function cleanRecipe(recipe) {
  return {
    name: String(recipe.name || '').trim().slice(0, 60),
    category: String(recipe.category || '家常菜').slice(0, 40),
    description: String(recipe.description || '').slice(0, 300),
    time: Math.max(1, Number(recipe.time) || 30),
    servings: Math.max(1, Number(recipe.servings) || 2),
    difficulty: String(recipe.difficulty || '简单').slice(0, 20),
    emoji: String(recipe.emoji || '🥘').slice(0, 8),
    color: String(recipe.color || '#F6E8D7').slice(0, 20),
    ingredients: Array.isArray(recipe.ingredients) ? recipe.ingredients.slice(0, 100).map(item => ({
      name: String(item.name || '').trim().slice(0, 60),
      amount: String(item.amount || '适量').slice(0, 60)
    })).filter(item => item.name) : [],
    steps: Array.isArray(recipe.steps) ? recipe.steps.slice(0, 100).map(step => String(step || '').slice(0, 500)).filter(Boolean) : [],
    kidFriendly: Boolean(recipe.kidFriendly)
  }
}

function saveRecipe(event, openid) {
  const input = event.recipe || {}
  const recipeId = String(input.id || '').trim()
  const cleaned = cleanRecipe(input)
  if (!recipeId || !cleaned.name || !cleaned.ingredients.length || !cleaned.steps.length) {
    return Promise.reject(new Error('菜谱信息不完整'))
  }
  // Profile and ownership checks are independent. Run them together to keep
  // the function within the default Cloud Function timeout.
  return Promise.all([saveUserProfile(openid, event.profile), loadRecipe(recipeId)]).then(results => {
    const profile = results[0]
    const existing = results[1]
    if (existing && existing.authorOpenid !== openid) return Promise.reject(new Error('只能编辑自己添加的菜谱'))
    const data = Object.assign({}, cleaned, {
      authorOpenid: openid,
      createdAt: existing ? existing.createdAt : db.serverDate(),
      updatedAt: db.serverDate()
    })
    const write = existing
      ? recipesCollection.doc(recipeId).update({ data })
      : recipesCollection.doc(recipeId).set({ data })
    return write.then(() => Object.assign({}, cleaned, {
      id: recipeId,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      authorName: profile.nickname,
      authorAvatar: profile.avatarUrl,
      isMine: true,
      isCloud: true,
      favorite: false,
      favoriteCount: 0,
      favoriteUsers: []
    }))
  })
}

function removeAllRecipeFavorites(recipeId) {
  return favoritesCollection.where({ recipeId }).limit(100).get().then(result => {
    return Promise.all((result.data || []).map(item => favoritesCollection.doc(item._id).remove()))
  })
}

function deleteRecipe(event, openid) {
  const recipeId = String(event.recipeId || '')
  return loadRecipe(recipeId).then(recipe => {
    if (!recipe) return { deleted: false }
    if (recipe.authorOpenid !== openid) return Promise.reject(new Error('只能删除自己添加的菜谱'))
    return Promise.all([recipesCollection.doc(recipeId).remove(), removeAllRecipeFavorites(recipeId)]).then(() => ({ deleted: true }))
  })
}

function toggleFavorite(event, openid) {
  const recipeId = String(event.recipeId || '')
  const favorite = Boolean(event.favorite)
  return loadRecipe(recipeId).then(recipe => {
    const actualRecipe = recipe || (['r1', 'r2', 'r3', 'r4'].indexOf(recipeId) >= 0 ? null : false)
    const recipeTask = actualRecipe === false
      ? Promise.reject(new Error('这道菜谱已不存在'))
      : Promise.resolve(actualRecipe || ensureDefaultRecipe(recipeId))
    return recipeTask.then(foundRecipe => Promise.all([saveUserProfile(openid, event.profile), favoritesCollection.where({ recipeId, openid }).limit(1).get()]).then(results => {
      const profile = results[0]
      const existing = (results[1].data || [])[0]
      const mutation = favorite
        ? (existing ? Promise.resolve() : favoritesCollection.add({ data: { recipeId, openid, createdAt: db.serverDate() } }))
        : (existing ? favoritesCollection.doc(existing._id).remove() : Promise.resolve())
      return mutation.then(() => Object.assign({}, cleanRecipe(foundRecipe), {
        id: recipeId,
        createdAt: foundRecipe.createdAt,
        updatedAt: foundRecipe.updatedAt,
        authorName: foundRecipe.authorOpenid === 'system' ? '家庭菜谱' : ((foundRecipe.authorOpenid === openid && profile.nickname) || '家庭成员'),
        authorAvatar: foundRecipe.authorOpenid === openid ? profile.avatarUrl : '',
        isMine: foundRecipe.authorOpenid === openid,
        isCloud: true,
        favorite,
        favoriteCount: favorite ? 1 : 0,
        favoriteUsers: favorite ? [{ nickname: profile.nickname, avatarUrl: profile.avatarUrl }] : []
      }))
    }))
  })
}

exports.main = async (event) => {
  const openid = cloud.getWXContext().OPENID
  try {
    let data
    if (event.action === 'listRecipes') data = { recipes: await listRecipes(openid) }
    else if (event.action === 'quickLogin') data = await quickLogin(event, openid)
    else if (event.action === 'getProfile') data = await currentProfile(openid)
    else if (event.action === 'listCategories') data = await listCategories(openid)
    else if (event.action === 'createCategory') data = await createCategory(event, openid)
    else if (event.action === 'removeCategory') data = await removeCategory(event, openid)
    else if (event.action === 'saveRecipe') data = { recipe: await saveRecipe(event, openid) }
    else if (event.action === 'deleteRecipe') data = await deleteRecipe(event, openid)
    else if (event.action === 'toggleFavorite') data = { recipe: await toggleFavorite(event, openid) }
    else return { ok: false, message: '未知操作' }
    return Object.assign({ ok: true }, data)
  } catch (error) {
    return { ok: false, message: error.message || '云端操作失败' }
  }
}
