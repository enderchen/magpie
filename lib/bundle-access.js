// Opaque-origin preview frames cannot send SameSite cookies for private bundle assets.
// A short-lived, file-scoped capability bridges only those resource requests.
const crypto = require('node:crypto');
const { dbGet } = require('./db');
const { now } = require('./util');

const grants = new Map();
const TTL_MS = 5 * 60 * 1000;
const MAX_GRANTS = 1000;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function createBundleAssetBase(file, req) {
  if (file.is_public && !file.share_password_hash && !file.asset_base_path) {
    return `/api/files/${file.id}/asset/`;
  }
  const time = Date.now();
  for (const [key, grant] of grants) if (grant.until <= time) grants.delete(key);
  if (grants.size >= MAX_GRANTS) grants.delete(grants.keys().next().value);
  const key = crypto.randomBytes(24).toString('base64url');
  const token = req.get('authorization')?.startsWith('Bearer ') ? req.get('authorization').slice(7) : null;
  grants.set(key, {
    fileId: file.id,
    storedName: file.stored_name,
    version: file.asset_version || null,
    shareKey: file.share_key,
    sharePassword: file.share_password_hash,
    userId: req.userId || null,
    sessionId: req.tokenSource === 'web' ? req.sessionID : null,
    authVersion: req.session?.authVersion,
    tokenHash: token ? hash(token) : null,
    until: time + TTL_MS,
  });
  return `/api/files/${file.id}/bundle-resource/${key}/`;
}

async function loadBundleGrant(req, res, next) {
  try {
    const grant = grants.get(req.params.grant);
    if (!grant || grant.until <= Date.now() || grant.fileId !== Number(req.params.id)) {
      return res.status(403).json({ error: '资源凭证无效或已过期，请刷新预览' });
    }
    const file = await dbGet('SELECT * FROM files WHERE id = ?', [grant.fileId]);
    if (!file || file.share_key !== grant.shareKey || file.share_password_hash !== grant.sharePassword) {
      return res.status(403).json({ error: '资源访问已撤销' });
    }
    let owner = false;
    if (grant.userId) {
      const user = await dbGet('SELECT id, role, password_hash FROM users WHERE id = ?', [grant.userId]);
      if (!user) return res.status(403).json({ error: '资源访问已撤销' });
      if (grant.sessionId) {
        const session = await new Promise((resolve, reject) => req.sessionStore.get(grant.sessionId, (error, value) => error ? reject(error) : resolve(value)));
        if (!session || session.userId !== user.id || hash(user.password_hash) !== grant.authVersion) {
          return res.status(403).json({ error: '资源访问已撤销' });
        }
      } else if (grant.tokenHash) {
        const globalToken = process.env.MCP_TOKEN && hash(process.env.MCP_TOKEN) === grant.tokenHash;
        const token = globalToken || await dbGet('SELECT id FROM tokens WHERE token_hash = ? AND user_id = ?', [grant.tokenHash, user.id]);
        if (!token) return res.status(403).json({ error: '资源访问已撤销' });
      } else return res.status(403).json({ error: '资源访问已撤销' });
      owner = user.role === 'admin' || file.uploaded_by === user.id;
    }
    if (!owner && (!file.is_public || (file.share_expires_at && file.share_expires_at <= now()) || grant.version)) {
      return res.status(403).json({ error: '资源访问已撤销' });
    }
    let resource = file;
    if (grant.version) {
      const version = await dbGet('SELECT * FROM file_versions WHERE file_id = ? AND version = ?', [file.id, grant.version]);
      if (!version) return res.status(403).json({ error: '版本资源已撤销' });
      resource = { ...file, ...version, id: file.id };
    }
    if (!resource.is_bundle || resource.stored_name !== grant.storedName) return res.status(403).json({ error: '资源访问已撤销' });
    req.fileRecord = resource;
    res.setHeader('Cache-Control', 'private, no-store');
    next();
  } catch (error) { next(error); }
}

module.exports = { createBundleAssetBase, loadBundleGrant };
