const { createHash } = require('crypto')
const { applyOperation, validateOperation } = require('./shopping-model')
const hash = value => createHash('sha256').update(value).digest('hex')
const emptyList = () => ({ revision: 0, items: [] })
const present = list => ({ revision: list.revision, items: list.items })

module.exports = function createShoppingList(db) {
  async function list() {
    const result = await db.collection('shared_shopping_lists').doc('global').get()
    return { list: present(result.data || emptyList()) }
  }

  async function mutate(event, openid) {
    if (!openid) throw new Error('请在微信小程序中打开买菜清单')
    if (typeof event.operationId !== 'string' || !/^[\w-]{1,100}$/.test(event.operationId)) throw new Error('操作编号无效')
    const operation = validateOperation(Object.assign({}, event, { type: event.operation }))
    const token = hash(`${openid}:${event.operationId}`)
    const shared = await db.runTransaction(async transaction => {
      const doc = transaction.collection('shared_shopping_lists').doc('global')
      const receipt = transaction.collection('shared_shopping_operations').doc(token)
      const current = (await doc.get()).data || emptyList()
      // Receipts remain valid even after a long offline period.
      if ((await receipt.get()).data) return present(current)
      let accepted = operation
      const imports = []
      if (operation.type === 'importItems') {
        const items = []
        for (const item of operation.items) {
          const marker = transaction.collection('shared_shopping_operations').doc(`i_${hash(item.id)}`)
          if (!(await marker.get()).data) { items.push(item); imports.push(marker) }
        }
        accepted = Object.assign({}, operation, { items })
      }
      const items = applyOperation(current.items, accepted)
      if (items.length > 1000) throw new Error('共享清单已满，请先清理已买项目')
      const next = { revision: (Number(current.revision) || 0) + 1, items }
      await doc.set({ data: next })
      await receipt.set({ data: { revision: next.revision } })
      for (const marker of imports) await marker.set({ data: { revision: next.revision } })
      return next
    })
    return { list: shared }
  }
  return { list, mutate }
}
