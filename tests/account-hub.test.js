const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function fixture(openid = 'wechat-user') {
  const source = fs.readFileSync(path.join(__dirname, '../cloudfunctions/accountHub/index.js'), 'utf8')
  const documents = new Map()
  const updates = []
  const cloud = {
    DYNAMIC_CURRENT_ENV: 'dynamic',
    init() {},
    database: () => ({
      collection: () => ({
        where: query => ({
          limit: () => ({ get: async () => ({ data: documents.has(query._id) ? [documents.get(query._id)] : [] }) })
        }),
        doc: id => ({
          update: async ({ data }) => {
            updates.push({ id, data })
            documents.set(id, Object.assign({}, documents.get(id), data))
          },
          set: async ({ data }) => {
            updates.push({ id, data })
            documents.set(id, data)
          }
        })
      }),
      serverDate: () => 'SERVER_DATE'
    }),
    getWXContext: () => ({ OPENID: openid }),
    getTempFileURL: async ({ fileList }) => ({ fileList: fileList.map(fileID => ({ fileID, status: 0, tempFileURL: `https://temporary.invalid/${fileID}` })) })
  }
  const module = { exports: {} }
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    require: name => {
      assert.equal(name, 'wx-server-sdk')
      return cloud
    },
    console
  }, { filename: 'accountHub/index.js' })
  return { main: module.exports.main, documents, updates }
}

test('quick login uses WeChat OPENID and requires no profile permission', async () => {
  const f = fixture()
  const result = await f.main({ action: 'login', openid: 'spoofed-user' })
  assert.equal(result.ok, true)
  assert.equal(result.authenticated, true)
  assert.equal(result.profile.nickname, '家庭成员')
  assert.equal(f.documents.size, 0)
  assert.equal(f.updates.length, 0)
})

test('profile updates are stored against the authenticated OPENID', async () => {
  const f = fixture()
  const result = await f.main({ action: 'updateProfile', openid: 'spoofed-user', profile: { nickname: '小明' } })
  assert.equal(result.ok, true)
  assert.equal(f.updates[0].id, 'wechat-user')
  assert.equal(f.documents.get('wechat-user').nickname, '小明')
})

test('profile API rejects a missing WeChat identity', async () => {
  const f = fixture('')
  const result = await f.main({ action: 'login' })
  assert.equal(result.ok, false)
  assert.match(result.message, /微信身份/)
  assert.equal(f.updates.length, 0)
})

test('invalid nickname and non-cloud avatar are rejected without writing', async () => {
  const f = fixture()
  const nickname = await f.main({ action: 'updateProfile', profile: { nickname: '   ' } })
  const avatar = await f.main({ action: 'updateProfile', profile: { nickname: '小明', avatarFileId: 'https://example.invalid/avatar.png' } })
  assert.equal(nickname.ok, false)
  assert.equal(avatar.ok, false)
  assert.equal(f.updates.length, 0)
})

test('saved avatar uses a temporary display URL while retaining its cloud file ID', async () => {
  const f = fixture()
  const fileID = 'cloud://env.bucket/avatars/avatar.png'
  const result = await f.main({ action: 'updateProfile', profile: { nickname: '小明', avatarFileId: fileID } })
  assert.equal(result.ok, true)
  assert.equal(f.documents.get('wechat-user').avatarUrl, fileID)
  assert.equal(result.profile.avatarFileId, fileID)
  assert.equal(result.profile.avatarUrl, `https://temporary.invalid/${fileID}`)
})
