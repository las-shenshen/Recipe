const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
// wx-server-sdk defaults to throwing for a missing document, including in a transaction.
const db = cloud.database({ throwOnNotFound: false })

function cleanRecipe(recipe) {
  return {
    name: String(recipe.name || '').trim().slice(0, 60),
    category: String(recipe.category || '家常菜').slice(0, 40),
    description: String(recipe.description || '').slice(0, 300),
    time: Math.min(1440, Math.max(1, Number(recipe.time) || 30)),
    servings: Math.min(99, Math.max(1, Number(recipe.servings) || 2)),
    difficulty: String(recipe.difficulty || '简单').slice(0, 20),
    emoji: String(recipe.emoji || '🥝').slice(0, 8),
    color: /^#[0-9a-f]{6}$/i.test(recipe.color) ? recipe.color : '#F6E8D7',
    ingredients: Array.isArray(recipe.ingredients) ? recipe.ingredients.slice(0, 100).filter(Boolean).map(item => ({
      name: String(item.name || '').trim().slice(0, 60), amount: String(item.amount || '适量').slice(0, 60)
    })).filter(item => item.name) : [],
    steps: Array.isArray(recipe.steps) ? recipe.steps.slice(0, 100).map(step => String(step || '').slice(0, 500)).filter(Boolean) : [],
    kidFriendly: Boolean(recipe.kidFriendly)
  }
}

const menus = require('./menus')(db, cleanRecipe)
exports.main = async event => {
  try {
    const openid = cloud.getWXContext().OPENID
    if (!openid) throw new Error('请在微信小程序中打开点菜页面')
    let result
    if (event.action === 'listMenus') result = await menus.list(event)
    else if (event.action === 'mutateMenu') result = await menus.mutate(event, openid)
    else throw new Error('未知菜单操作')
    return Object.assign({ ok: true }, result)
  } catch (error) {
    return { ok: false, message: error.message || '共享菜单暂不可用，请重试' }
  }
}
