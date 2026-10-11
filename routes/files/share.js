// 分享链接控制路由：重新生成短链 + 过期时间 + 访问密码 + 自定义别名。
//
// 设计要点：
//   - 重新生成 / 别名都改写 files.share_key（已有唯一索引 idx_files_share_key 兜底冲突），
//     旧短链因 share_key 不再匹配而立即失效（撤销语义）。
//   - 过期时间存 UTC 'YYYY-MM-DD HH:MM:SS'，与 now() / CURRENT_TIMESTAMP 同格式，
//     server.js 的 /s/:key 直接字符串比较即可判定。
//   - 访问密码用 bcrypt 哈希，绝不返回哈希给前端（详情/列表只回 has_share_password 布尔）。
//
// 挂在共享 router 上，注册顺序：在 crud（PUT /:id）之后、detail-serve（GET /:id）之前。

const bcrypt = require('bcryptjs');
const { dbGet, dbRun } = require('../../lib/db');
const { requireAuth } = require('../../lib/middleware/auth');
const { checkFileOwnership } = require('../../lib/middleware/files');
const { now, generateShareKey, clientIp } = require('../../lib/util');
const logger = require('../../logger');

// 自定义别名白名单：URL 安全、3~32 位。
const ALIAS_RE = /^[a-zA-Z0-9_-]{3,32}$/;

function registerShare(router) {
  // --- 重新生成短链（撤销旧链接）---
  // 生成新随机 share_key 并写回；旧 key 因唯一索引不再被任何行持有 → 立即 404。
  router.post('/:id/share/regenerate', requireAuth, async (req, res) => {
    try {
      const file = await dbGet('SELECT id, uploaded_by, share_key FROM files WHERE id = ?', [req.params.id]);
      if (!file) return res.status(404).json({ error: '文件不存在' });
      if (!checkFileOwnership(req, file)) return res.status(403).json({ error: '无权操作此文件' });

      // 最多重试 5 次规避极小概率的随机碰撞
      let newKey = null;
      for (let i = 0; i < 5; i++) {
        const candidate = generateShareKey();
        const clash = await dbGet('SELECT 1 AS hit FROM files WHERE share_key = ? AND id != ?', [candidate, file.id]);
        if (!clash) { newKey = candidate; break; }
      }
      if (!newKey) return res.status(500).json({ error: '生成短链失败，请重试' });

      await dbRun('UPDATE files SET share_key = ?, updated_at = ? WHERE id = ?', [newKey, now(), file.id]);
      logger.audit('share.regenerate', { fileId: file.id, ip: clientIp(req) });
      res.json({ share_key: newKey });
    } catch (e) {
      logger.error({ type: 'app', action: 'share.regenerate', error: e.message });
      res.status(500).json({ error: '重新生成失败' });
    }
  });

  // --- 更新分享设置：别名 / 过期时间 / 访问密码 ---
  // body: { alias?, expiresAt?, password? }（任一组合；未提供的字段不变）
  router.put('/:id/share', requireAuth, async (req, res) => {
    const { alias, expiresAt, password } = req.body || {};
    if (alias === undefined && expiresAt === undefined && password === undefined) {
      return res.status(400).json({ error: '无更新字段' });
    }
    try {
      const file = await dbGet('SELECT id, uploaded_by, share_key FROM files WHERE id = ?', [req.params.id]);
      if (!file) return res.status(404).json({ error: '文件不存在' });
      if (!checkFileOwnership(req, file)) return res.status(403).json({ error: '无权操作此文件' });

      // 全部验证完成后一次写入，400/409 不会部分修改已有分享设置。
      const changes = [], values = [];
      for (const value of [alias, expiresAt, password]) {
        if (value !== undefined && value !== null && typeof value !== 'string') {
          return res.status(400).json({ error: '分享设置需为字符串或 null' });
        }
      }
      if (alias !== undefined) {
        const trimmed = (alias || '').trim();
        if (trimmed && !ALIAS_RE.test(trimmed)) return res.status(400).json({ error: '别名只能含字母、数字、下划线、连字符，3~32 位' });
        const key = trimmed || generateShareKey();
        const clash = await dbGet('SELECT 1 AS hit FROM files WHERE share_key = ? AND id != ?', [key, file.id]);
        if (clash) return res.status(409).json({ error: '该别名已被占用' });
        changes.push('share_key = ?'); values.push(key);
      }
      if (expiresAt !== undefined) {
        const value = (expiresAt || '').trim();
        let utcStr = null;
        if (value) {
          const d = new Date(value);
          if (isNaN(d.getTime())) return res.status(400).json({ error: '过期时间格式无效' });
          utcStr = d.toISOString().slice(0, 19).replace('T', ' ');
          if (utcStr <= now()) return res.status(400).json({ error: '过期时间必须晚于当前时间' });
        }
        changes.push('share_expires_at = ?'); values.push(utcStr);
      }
      if (password !== undefined) {
        const value = password || '';
        if (value && (value.length < 4 || value.length > 128)) return res.status(400).json({ error: '密码长度需为 4~128 位' });
        changes.push('share_password_hash = ?'); values.push(value ? await bcrypt.hash(value, 10) : null);
      }
      changes.push('updated_at = ?'); values.push(now(), file.id);
      await dbRun(`UPDATE files SET ${changes.join(', ')} WHERE id = ?`, values);

      const updated = await dbGet('SELECT share_key, share_expires_at, share_password_hash IS NOT NULL AS has_share_password FROM files WHERE id = ?', [file.id]);
      logger.audit('share.update', {
        fileId: file.id,
        changes: { alias: alias !== undefined, expiresAt: expiresAt !== undefined, password: password !== undefined },
        ip: clientIp(req),
      });
      res.json({
        share_key: updated.share_key,
        share_expires_at: updated.share_expires_at,
        has_share_password: !!updated.has_share_password,
      });
    } catch (e) {
      logger.error({ type: 'app', action: 'share.update', error: e.message });
      res.status(500).json({ error: '更新分享设置失败' });
    }
  });
}

module.exports = { registerShare, ALIAS_RE };
