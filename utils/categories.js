const DEFAULT_CATEGORIES = ['快手家常', '家常硬菜', '素食清爽', '暖心汤羹']
const CUSTOM_KEY = 'familyRecipeCustomCategories'
const HIDDEN_KEY = 'familyRecipeHiddenCategories'

function unique(values) {
  return values.filter((value, index) => value && values.indexOf(value) === index)
}

function getSharedCategories() {
  return wx.getStorageSync('familyRecipeSharedCategories') || []
}

function cacheSharedCategories(categories) {
  wx.setStorageSync('familyRecipeSharedCategories', categories || [])
}

function cacheSharedCategory(category) {
  const categories = getSharedCategories().filter(item => item.name !== category.name)
  categories.push(category)
  cacheSharedCategories(categories)
}

function removeSharedCategory(name) {
  cacheSharedCategories(getSharedCategories().filter(item => item.name !== name))
}

function getCategoryInfo(name) {
  return getSharedCategories().find(item => item.name === name) || null
}

function getCategories(recipes) {
  const hidden = wx.getStorageSync(HIDDEN_KEY) || []
  const custom = wx.getStorageSync(CUSTOM_KEY) || []
  const shared = getSharedCategories().map(item => item.name)
  const recipeCategories = (recipes || []).map(recipe => recipe.category)
  return unique(DEFAULT_CATEGORIES.filter(name => hidden.indexOf(name) < 0).concat(custom, shared, recipeCategories.filter(name => hidden.indexOf(name) < 0)))
}

function validateCategory(value, recipes) {
  const name = String(value || '').trim().slice(0, 20)
  if (!name) return { ok: false, message: '分类名称不能为空' }
  const current = getCategories(recipes || wx.getStorageSync('familyRecipes') || [])
  if (current.indexOf(name) >= 0) return { ok: false, message: '这个分类已经存在' }
  return { ok: true, name }
}

function addCategory(value) {
  const validation = validateCategory(value)
  if (!validation.ok) return validation
  const name = validation.name

  const custom = wx.getStorageSync(CUSTOM_KEY) || []
  const hidden = wx.getStorageSync(HIDDEN_KEY) || []
  wx.setStorageSync(CUSTOM_KEY, unique(custom.concat(name)))
  wx.setStorageSync(HIDDEN_KEY, hidden.filter(item => item !== name))
  return { ok: true, name }
}

function removeCategory(name) {
  const recipes = wx.getStorageSync('familyRecipes') || []
  if (recipes.some(recipe => recipe.category === name)) return { ok: false, message: '请先把该分类下的菜谱改到其他分类' }

  const custom = wx.getStorageSync(CUSTOM_KEY) || []
  const hidden = wx.getStorageSync(HIDDEN_KEY) || []
  wx.setStorageSync(CUSTOM_KEY, custom.filter(item => item !== name))
  if (DEFAULT_CATEGORIES.indexOf(name) >= 0) wx.setStorageSync(HIDDEN_KEY, unique(hidden.concat(name)))
  return { ok: true }
}

function canDeleteCategory(name) {
  const shared = getCategoryInfo(name)
  return !shared || Boolean(shared.isMine)
}

module.exports = {
  DEFAULT_CATEGORIES,
  getCategories,
  validateCategory,
  addCategory,
  removeCategory,
  canDeleteCategory,
  getCategoryInfo,
  cacheSharedCategories,
  cacheSharedCategory,
  removeSharedCategory
}
