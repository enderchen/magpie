// 标签 CRUD 路由。从 server.js 提取，行为保持不变。
// 挂载点：/api/tags
// 注：文件的标签关联 /api/files/:id/tags 归 routes/files.js（同为 /api/files 前缀）。

const express = require('express');
const { dbAll, dbGet, dbRun } = require('../lib/db');
const { requireAuth } = require('../lib/middleware/auth');
const { clientIp } = require('../lib/util');
const logger = require('../logger');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const role = req.userRole;
    const userId = req.userId;
    let tags;
    if (role === 'admin') {
      tags = await dbAll(`
        SELECT t.id, t.name, t.created_at, COUNT(ft.file_id) AS file_count
        FROM tags t LEFT JOIN file_tags ft ON t.id = ft.tag_id
        GROUP BY t.id ORDER BY t.name ASC
      `);
    } else {
      tags = await dbAll(`
        SELECT t.id, t.name, t.created_at, COUNT(f.id) AS file_count
        FROM tags t LEFT JOIN file_tags ft ON t.id = ft.tag_id
          LEFT JOIN files f ON ft.file_id = f.id AND f.uploaded_by = ?
        GROUP BY t.id ORDER BY t.name ASC
      `, [userId]);
    }
    res.json({ tags });
  } catch (e) {
    res.status(500).json({ error: '获取标签失败' });
  }
});

router.post('/', requireAuth, async (req, res) => {
  const { name } = req.body || {};
  if (typeof name !== 'string' || !name.trim() || name.length > 100) return res.status(400).json({ error: '标签名需为 1~100 字符' });
  try {
    const existing = await dbGet('SELECT id, name, created_at FROM tags WHERE name = ?', [name.trim()]);
    if (existing) return res.json(existing);
    const result = await dbRun('INSERT INTO tags (name) VALUES (?)', [name.trim()]);
    res.json({ id: result.lastID, name: name.trim() });
    logger.audit('tag.create', { tagId: result.lastID, tagName: name.trim(), ip: clientIp(req) });
  } catch (e) {
    res.status(500).json({ error: '创建标签失败' });
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const tag = await dbGet('SELECT id FROM tags WHERE id = ?', [req.params.id]);
    if (!tag) return res.status(404).json({ error: '标签不存在' });
    if (req.userRole === 'admin') {
      await dbRun('DELETE FROM file_tags WHERE tag_id = ?', [req.params.id]);
      await dbRun('DELETE FROM tags WHERE id = ?', [req.params.id]);
    } else {
      // 标签名称共享；普通用户删除时只能移除自己文件上的关联。
      await dbRun('DELETE FROM file_tags WHERE tag_id = ? AND file_id IN (SELECT id FROM files WHERE uploaded_by = ?)', [req.params.id, req.userId]);
      await dbRun('DELETE FROM tags WHERE id = ? AND NOT EXISTS (SELECT 1 FROM file_tags WHERE tag_id = ?)', [req.params.id, req.params.id]);
    }
    res.json({ success: true });
    logger.audit('tag.delete', { tagId: req.params.id, ip: clientIp(req) });
  } catch (e) {
    res.status(500).json({ error: '删除标签失败' });
  }
});

module.exports = router;
