// 容器内只做一次：首次调用（冷启动）时确保共享集合存在，避免依赖控制台手工建集合。
// 集合已存在时 createCollection 会抛错，统一忽略；成功后跳过后续检查，减少每次调用
// 的往返次数（个人版云函数执行超时仅 3 秒，需要留出余量）。
let ensured = false

async function ensureCollections(db) {
  if (ensured || typeof db.createCollection !== 'function') return
  for (const name of ['shared_shopping_lists', 'shared_shopping_operations']) {
    try {
      await db.createCollection(name)
    } catch (error) {
      // 集合已存在（或当前环境暂不支持创建），继续。
    }
  }
  ensured = true
}

module.exports = ensureCollections
