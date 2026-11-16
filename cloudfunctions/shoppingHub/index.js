const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database({ throwOnNotFound: false })
const shoppingList = require('./list')(db)
const ensureCollections = require('./ensure')

exports.main = async event => {
  try {
    const openid = cloud.getWXContext().OPENID
    if (!openid) throw new Error('请在微信小程序中打开买菜清单')
    if (event.action === 'ensureCollections') { await ensureCollections(db); return { ok: true } }
    await ensureCollections(db)
    if (event.action === 'listShoppingList') return Object.assign({ ok: true }, await shoppingList.list())
    if (event.action === 'mutateShoppingList') return Object.assign({ ok: true }, await shoppingList.mutate(event, openid))
    return { ok: false, message: '未知清单操作' }
  } catch (error) {
    return { ok: false, message: error.message || '共享清单暂不可用，请重试' }
  }
}
