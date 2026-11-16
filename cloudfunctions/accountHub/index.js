const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const profiles = db.collection('user_profiles')

async function presentProfile(stored) {
  const profile = {
    nickname: stored.nickname || '家庭成员',
    avatarFileId: stored.avatarFileId || '',
    avatarUrl: stored.avatarUrl || ''
  }
  const fileId = profile.avatarFileId || (profile.avatarUrl.indexOf('cloud://') === 0 ? profile.avatarUrl : '')
  if (fileId) {
    profile.avatarFileId = fileId
    profile.avatarUrl = fileId
    try {
      const result = await cloud.getTempFileURL({ fileList: [fileId] })
      const file = (result.fileList || [])[0]
      if (file && file.status === 0 && file.tempFileURL) profile.avatarUrl = file.tempFileURL
    } catch (error) {
      // Keep the durable cloud file ID; never persist an expiring download URL.
    }
  }
  return profile
}

exports.main = async (event = {}) => {
  try {
    const openid = cloud.getWXContext().OPENID
    if (!openid) throw new Error('无法识别微信身份，请在微信中重新打开')
    if (!['login', 'getProfile', 'updateProfile'].includes(event.action)) throw new Error('不支持的账号操作')
    const result = await profiles.where({ _id: openid }).limit(1).get()
    const stored = (result.data || [])[0]
    let profile = stored || { nickname: '家庭成员', avatarUrl: '', avatarFileId: '' }

    if (event.action === 'updateProfile') {
      const input = event.profile || {}
      const nickname = typeof input.nickname === 'string' ? input.nickname.trim() : ''
      if (!nickname || Array.from(nickname).length > 30) throw new Error('昵称请填写 1–30 个字')
      const changes = { nickname, updatedAt: db.serverDate() }
      // The client can upload a new avatar, but cannot replace it with a local/temporary URL.
      if (input.avatarFileId !== undefined) {
        if (typeof input.avatarFileId !== 'string' || !/^cloud:\/\/[^/]+\/avatars\/[^\s]+$/.test(input.avatarFileId) || input.avatarFileId.length > 2048) {
          throw new Error('头像上传未完成，请重新选择')
        }
        changes.avatarFileId = input.avatarFileId
        changes.avatarUrl = input.avatarFileId
      }
      if (stored) await profiles.doc(openid).update({ data: changes })
      else await profiles.doc(openid).set({ data: Object.assign({}, profile, changes) })
      profile = Object.assign({}, profile, changes)
    }
    // Cloud calls carry the authenticated WeChat identity. No client-provided ID is trusted.
    return { ok: true, authenticated: true, profile: await presentProfile(profile) }
  } catch (error) {
    return { ok: false, message: error.message || '账号连接失败，请稍后重试' }
  }
}
