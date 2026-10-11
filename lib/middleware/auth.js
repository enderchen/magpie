// 认证与授权中间件：requireAuth（Session / Bearer Token / MCP_TOKEN）+ requireAdmin + requireTokenAuth。
// 从 server.js 提取，行为保持不变。

const crypto = require('crypto');
const { dbGet, dbRun } = require('../db');
const { now } = require('../util');
const { getAdminUserId } = require('../auth-state');

function hashPrefix(tokenValue, len = 16) {
  return crypto.createHash('sha256').update(tokenValue).digest('hex').slice(0, len);
}

// Roles and account existence are authoritative in SQLite, never in a cached cookie session.
async function refreshSession(req) {
  if (!req.session?.userId) return false;
  const user = await dbGet('SELECT id, username, role, password_hash FROM users WHERE id = ?', [req.session.userId]);
  const version = user && hashPrefix(user.password_hash, 64);
  if (!user || (req.session.authVersion && req.session.authVersion !== version)) {
    await new Promise(resolve => req.session.destroy(resolve));
    return false;
  }
  req.session.username = user.username;
  req.session.userRole = user.role;
  req.session.authVersion = version;
  req.userId = user.id;
  req.userRole = user.role;
  req.tokenSource = 'web';
  req.tokenPrefix = 'session';
  req.tokenHashPrefix = 'session';
  return true;
}

// 软认证：尽力解析 Session/Bearer Token 并填充 req.userId / req.userRole，
// 但不拒绝匿名请求。用于「允许匿名访问公开内容、同时让登录用户/admin 访问受限内容」
// 的端点（详情 / 渲染 / 下载 / 资源 / 短链）。
// 与 requireAuth 共用解析逻辑，仅在未通过认证时不返回 401 而是放行。
async function loadSession(req, res, next) {
  // Session 路径
  try { if (!req.headers.authorization?.startsWith('Bearer ') && await refreshSession(req)) return next(); }
  catch (e) { return next(e); }

  // Bearer Token 路径（与 requireAuth 一致，成功才填充）
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    const tokenValue = auth.slice(7);
    const adminUserId = getAdminUserId();
    if (process.env.MCP_TOKEN && tokenValue === process.env.MCP_TOKEN && adminUserId) {
      const admin = await dbGet('SELECT role FROM users WHERE id = ?', [adminUserId]);
      if (!admin) return next();
      req.userId = adminUserId;
      req.tokenSource = 'mcp';
      req.tokenPrefix = 'mcp';
      req.tokenHashPrefix = hashPrefix(tokenValue);
      req.userRole = admin.role;
      return next();
    }
    const hash = crypto.createHash('sha256').update(tokenValue).digest('hex');
    const tokenRow = await dbGet(
      'SELECT t.user_id, u.role FROM tokens t JOIN users u ON t.user_id = u.id WHERE t.token_hash = ?',
      [hash]
    );
    if (tokenRow) {
      dbRun('UPDATE tokens SET last_used_at = ? WHERE token_hash = ?', [now(), hash]).catch(() => {});
      req.userId = tokenRow.user_id;
      req.userRole = tokenRow.role;
      const source = req.get('x-upload-source');
      req.tokenSource = source === 'mcp' ? 'mcp' : (source === 'cli' ? 'cli' : 'api');
      req.tokenPrefix = tokenRow.token_prefix || tokenValue.slice(0, 12);
      req.tokenHashPrefix = hashPrefix(tokenValue);
      return next();
    }
  }

  // 未通过认证：放行（由下游中间件如 loadFileWithPrivacy 决定是否拒绝）
  return next();
}

async function requireAuth(req, res, next) {
  // Session 路径
  try { if (!req.headers.authorization?.startsWith('Bearer ') && await refreshSession(req)) return next(); }
  catch (e) { return next(e); }

  // Bearer Token 路径
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    const tokenValue = auth.slice(7);

    // 1. 旧 MCP_TOKEN 向后兼容
    const adminUserId = getAdminUserId();
    if (process.env.MCP_TOKEN && tokenValue === process.env.MCP_TOKEN && adminUserId) {
      const admin = await dbGet('SELECT role FROM users WHERE id = ?', [adminUserId]);
      if (!admin) return res.status(401).json({ error: '未登录' });
      req.mcpUserId = adminUserId;
      req.userId = adminUserId;
      req.tokenSource = 'mcp';
      req.tokenPrefix = 'mcp';
      req.tokenHashPrefix = hashPrefix(tokenValue);
      req.userRole = admin.role;
      return next();
    }

    // 2. 用户级 Token 查询
    const hash = crypto.createHash('sha256').update(tokenValue).digest('hex');
    const tokenRow = await dbGet(
      'SELECT t.user_id, t.token_prefix, u.role FROM tokens t JOIN users u ON t.user_id = u.id WHERE t.token_hash = ?',
      [hash]
    );
    if (tokenRow) {
      dbRun('UPDATE tokens SET last_used_at = ? WHERE token_hash = ?', [now(), hash]).catch(() => {});
      req.tokenUserId = tokenRow.user_id;
      req.userId = tokenRow.user_id;
      req.userRole = tokenRow.role;
      const source = req.get('x-upload-source');
      req.tokenSource = source === 'mcp' ? 'mcp' : (source === 'cli' ? 'cli' : 'api');
      req.tokenPrefix = tokenRow.token_prefix || tokenValue.slice(0, 12);
      req.tokenHashPrefix = hashPrefix(tokenValue);
      return next();
    }
  }

  return res.status(401).json({ error: '未登录' });
}

function requireAdmin(req, res, next) {
  if (req.userRole !== 'admin') return res.status(403).json({ error: '需要管理员权限' });
  next();
}

// 必须使用 Token（MCP_TOKEN 或用户级 mg_...）调用，禁止纯 Session Cookie。
// 内容模板「使用/实例化」等需要与系统 Token 绑定的端点使用。
function requireTokenAuth(req, res, next) {
  if (!req.userId) return res.status(401).json({ error: '未登录' });
  if (req.tokenSource === 'web') {
    return res.status(403).json({ error: '请使用 API Token 通过 CLI 或 MCP 使用模板' });
  }
  next();
}

module.exports = { loadSession, requireAuth, requireAdmin, requireTokenAuth };
