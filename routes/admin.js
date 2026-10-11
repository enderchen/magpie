// 管理员路由：数据备份导出 / 导入恢复 / 存储统计。从 server.js 提取，行为保持不变。
// 挂载点：/api/admin

const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const archiver = require('archiver');
const JSZip = require('jszip');
const sqlite3 = require('sqlite3').verbose();
const { dbRun, dbGet, dbAll, configureDatabase, resetDb } = require('../lib/db');
const { DATA_DIR, UPLOAD_DIR } = require('../lib/paths');
const { requireAuth, requireAdmin } = require('../lib/middleware/auth');
const { clientIp } = require('../lib/util');
const { loadTemplateNameMap } = require('../lib/templates');
const { reloadCategoryNameCache } = require('../lib/categories');
const { clearRenderCache } = require('../lib/render-cache');
const { recalculateAllUsersStorage, summarizeApiCalls } = require('../lib/usage');
const logger = require('../logger');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const { reloadKey } = require('../lib/crypto');
const { setAdminUserId } = require('../lib/auth-state');

const router = express.Router();

// 用于 import 的独立 multer 实例（不限文件类型）
const adminUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, DATA_DIR),
    filename: (req, file, cb) => cb(null, 'import-' + Date.now() + '.zip')
  }),
  limits: { fileSize: 500 * 1024 * 1024 }
});

// Backup/restore excludes concurrent data requests, including in-flight uploads.
let maintenance = false;
const activeDataRequests = new Set();
function trackDataRequests(req, res, next) {
  if (!/^\/(api(?:\/|$)|mcp(?:\/|$)|s\/|t\/|health$)/.test(req.path)) return next();
  if (maintenance) return res.status(503).json({ error: '数据备份或恢复中，请稍后重试' });
  activeDataRequests.add(req);
  const done = () => activeDataRequests.delete(req);
  res.once('finish', done); res.once('close', done);
  next();
}
async function beginMaintenance(currentRequest) {
  if (maintenance) throw Object.assign(new Error('数据维护中，请稍后重试'), { statusCode: 503 });
  maintenance = true;
  const deadline = Date.now() + 10000;
  while ([...activeDataRequests].some(req => req !== currentRequest)) {
    if (Date.now() > deadline) {
      maintenance = false;
      throw Object.assign(new Error('仍有请求进行中，请结束上传或 MCP 连接后重试'), { statusCode: 503 });
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

async function createBackupArchive(req) {
  await beginMaintenance(req);
  let snapshotDir;
  try {
    snapshotDir = fs.mkdtempSync(path.join(path.dirname(DATA_DIR), 'backup-snapshot-'));
    const snapshot = path.join(snapshotDir, 'database.sqlite');
    // SQLite creates a consistent standalone snapshot, including committed WAL changes.
    await dbRun('VACUUM INTO ?', [snapshot]);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.file(snapshot, { name: 'database.sqlite' });
    const keyFile = path.join(DATA_DIR, 'token-key.key');
    if (fs.existsSync(keyFile)) archive.file(keyFile, { name: 'token-key.key' });
    if (fs.existsSync(UPLOAD_DIR)) archive.directory(UPLOAD_DIR, 'uploads');
    const cleanup = () => {
      maintenance = false;
      fs.rmSync(snapshotDir, { recursive: true, force: true });
    };
    archive.once('end', cleanup); archive.once('error', cleanup); archive.once('close', cleanup);
    return archive;
  } catch (error) {
    maintenance = false;
    if (snapshotDir) fs.rmSync(snapshotDir, { recursive: true, force: true });
    throw error;
  }
}

router.get('/export', requireAuth, requireAdmin, async (req, res) => {
  try {
    const archive = await createBackupArchive(req);
    const fname = `magpie-backup-${new Date().toISOString().slice(0, 10)}.zip`;
    const encoded = encodeURIComponent(fname);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`);
    archive.on('error', error => {
      logger.error({ type: 'app', message: '备份导出失败', error: error.message });
      if (!res.headersSent) res.status(500).json({ error: '导出失败' });
      else res.destroy();
    });
    res.on('close', () => { if (!res.writableFinished) archive.abort(); });
    archive.pipe(res);
    await archive.finalize();
    logger.audit('backup.export', { ip: clientIp(req) });
  } catch (error) {
    if (!res.headersSent) res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '导出失败' });
  }
});

const invalidBackup = message => Object.assign(new Error(message), { statusCode: 400 });
async function stageBackup(zip, stageDir) {
  const entries = Object.values(zip.files);
  if (entries.length > 20000) throw invalidBackup('备份文件条目过多');
  let total = 0;
  for (const entry of entries) {
    const original = entry.unsafeOriginalName || entry.name;
    if (original.split(/[\\/]/).includes('..') || /^[/\\]|^[A-Za-z]:/.test(original) ||
        (entry.unixPermissions != null && (entry.unixPermissions & 0o170000) === 0o120000)) throw invalidBackup('备份包含不安全路径');
    // Legacy session archives are accepted but never restore authenticated sessions.
    if (/^sessions\.sqlite(?:-(?:wal|shm))?$/.test(entry.name)) continue;
    if (entry.name !== 'database.sqlite' && entry.name !== 'token-key.key' && !entry.name.startsWith('uploads/')) {
      if (entry.dir && entry.name === 'uploads/') continue;
      throw invalidBackup('备份包含不支持的文件');
    }
    const target = path.resolve(stageDir, entry.name);
    if (!target.startsWith(path.resolve(stageDir) + path.sep)) throw invalidBackup('备份包含不安全路径');
    if (entry.dir) { fs.mkdirSync(target, { recursive: true }); continue; }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    let size = 0;
    const limiter = new Transform({ transform(chunk, _encoding, callback) {
      size += chunk.length; total += chunk.length;
      if (size > 500 * 1024 * 1024 || total > 2 * 1024 * 1024 * 1024) return callback(invalidBackup('备份解压大小超过限制'));
      callback(null, chunk);
    } });
    await pipeline(entry.nodeStream('nodebuffer'), limiter, fs.createWriteStream(target, { mode: 0o600 }));
  }
}
async function validateStagedDatabase(stageDir) {
  let staged;
  try {
    staged = await new Promise((resolve, reject) => {
      const instance = new sqlite3.Database(path.join(stageDir, 'database.sqlite'), sqlite3.OPEN_READONLY, error => error ? reject(error) : resolve(instance));
    });
    const query = (sql, all = false) => new Promise((resolve, reject) => staged[all ? 'all' : 'get'](sql, (error, result) => error ? reject(error) : resolve(result)));
    if ((await query('PRAGMA quick_check')).quick_check !== 'ok') throw invalidBackup('备份数据库校验失败');
    const requiredTables = await dbAll("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
    const stagedTables = new Set((await query("SELECT name FROM sqlite_master WHERE type = 'table'", true)).map(table => table.name));
    for (const table of requiredTables) {
      if (!stagedTables.has(table.name)) throw invalidBackup('备份数据库表结构不完整或版本不兼容');
      const quoted = '"' + table.name.replace(/"/g, '""') + '"';
      const requiredColumns = await dbAll(`PRAGMA table_info(${quoted})`);
      const stagedColumns = new Set((await query(`PRAGMA table_info(${quoted})`, true)).map(column => column.name));
      if (requiredColumns.some(column => !stagedColumns.has(column.name))) throw invalidBackup('备份数据库字段不完整或版本不兼容');
    }
    await query('SELECT id, username, password_hash, role FROM users LIMIT 1');
    if (!(await query("SELECT id FROM users WHERE role = 'admin' LIMIT 1"))) throw invalidBackup('备份缺少管理员账号');
    const files = await query('SELECT stored_name, is_bundle, entry_path FROM files UNION ALL SELECT stored_name, is_bundle, entry_path FROM file_versions', true);
    for (const file of files) {
      if (!file.stored_name || file.stored_name !== path.basename(file.stored_name) || /[/\\]/.test(file.stored_name)) throw invalidBackup('备份文件记录包含不安全路径');
      const stored = path.resolve(stageDir, 'uploads', file.stored_name);
      if (!fs.existsSync(stored)) throw invalidBackup('备份缺少上传文件');
      if (file.is_bundle) {
        const entry = path.resolve(stored, file.entry_path || 'index.html');
        if (!entry.startsWith(stored + path.sep) || !fs.existsSync(entry)) throw invalidBackup('备份入口文件无效');
      }
    }
    const keyPath = path.join(stageDir, 'token-key.key');
    if (fs.existsSync(keyPath) && !/^[0-9a-f]{64}$/i.test(fs.readFileSync(keyPath, 'utf8').trim())) throw invalidBackup('备份密钥格式无效');
  } catch (error) {
    throw error.statusCode ? error : invalidBackup('备份数据库无效或版本不兼容');
  } finally {
    if (staged) await new Promise(resolve => staged.close(resolve));
  }
}

router.post('/import', requireAuth, requireAdmin, adminUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请上传 ZIP 文件' });
  const zipPath = req.file.path;
  let stageDir, backupDir, ownsMaintenance = false, changed = false;
  try {
    let zip;
    try { zip = await JSZip.loadAsync(fs.readFileSync(zipPath)); }
    catch { throw invalidBackup('无效的 ZIP 备份文件'); }
    if (!zip.file('database.sqlite')) throw invalidBackup('无效的备份文件：缺少 database.sqlite');
    stageDir = fs.mkdtempSync(path.join(path.dirname(DATA_DIR), 'restore-stage-'));
    await stageBackup(zip, stageDir);
    await validateStagedDatabase(stageDir);
    await beginMaintenance(req); ownsMaintenance = true;
    await dbRun('PRAGMA wal_checkpoint(TRUNCATE)');
    backupDir = fs.mkdtempSync(path.join(path.dirname(DATA_DIR), 'data-backup-'));
    fs.cpSync(DATA_DIR, backupDir, { recursive: true, filter: source => source !== zipPath });
    logger.info({ type: 'app', message: '导入前备份已创建', backupDir });
    await resetDb(null); // Close the old connection before replacing database files.
    changed = true;
    for (const name of ['database.sqlite', 'database.sqlite-wal', 'database.sqlite-shm', 'uploads']) fs.rmSync(path.join(DATA_DIR, name), { recursive: true, force: true });
    fs.copyFileSync(path.join(stageDir, 'database.sqlite'), path.join(DATA_DIR, 'database.sqlite'));
    if (fs.existsSync(path.join(stageDir, 'uploads'))) fs.cpSync(path.join(stageDir, 'uploads'), UPLOAD_DIR, { recursive: true });
    else fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    if (fs.existsSync(path.join(stageDir, 'token-key.key'))) {
      fs.copyFileSync(path.join(stageDir, 'token-key.key'), path.join(DATA_DIR, 'token-key.key'));
      fs.chmodSync(path.join(DATA_DIR, 'token-key.key'), 0o600);
    }
    await resetDb(new sqlite3.Database(path.join(DATA_DIR, 'database.sqlite')));
    await configureDatabase();
    reloadKey();
    await loadTemplateNameMap(); await reloadCategoryNameCache(); clearRenderCache();
    await recalculateAllUsersStorage();
    setAdminUserId((await dbGet("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1"))?.id || null);
    logger.audit('backup.import', { ip: clientIp(req), backupDir });
    res.json({ success: true, message: '数据已恢复，建议刷新页面重新加载' });
  } catch (error) {
    logger.error({ type: 'app', message: '数据导入失败', error: error.message });
    if (changed && backupDir) {
      try {
        await resetDb(null).catch(() => {});
        for (const name of ['database.sqlite', 'database.sqlite-wal', 'database.sqlite-shm', 'uploads', 'token-key.key']) {
          const source = path.join(backupDir, name), target = path.join(DATA_DIR, name);
          fs.rmSync(target, { recursive: true, force: true });
          if (fs.existsSync(source)) fs.cpSync(source, target, { recursive: true });
        }
        await resetDb(new sqlite3.Database(path.join(DATA_DIR, 'database.sqlite')));
        await configureDatabase(); reloadKey(); clearRenderCache();
        await loadTemplateNameMap(); await reloadCategoryNameCache();
        setAdminUserId((await dbGet("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1"))?.id || null);
      } catch (rollbackError) {
        logger.error({ type: 'app', message: '自动回退失败，已暂停数据请求', backupDir, error: rollbackError.message });
        maintenance = true; ownsMaintenance = false;
        return res.status(503).json({ error: '恢复及自动回退失败，数据接口已暂停，请管理员使用导入前备份处理' });
      }
    }
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : '导入失败，已恢复原数据' });
  } finally {
    if (ownsMaintenance) maintenance = false;
    if (stageDir) fs.rmSync(stageDir, { recursive: true, force: true });
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  }
});

router.get('/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const fileCount = await dbGet('SELECT COUNT(*) AS c FROM files');
    let dbSize = 0;
    const dbPath = path.join(DATA_DIR, 'database.sqlite');
    if (fs.existsSync(dbPath)) dbSize = fs.statSync(dbPath).size;
    if (fs.existsSync(dbPath + '-wal')) dbSize += fs.statSync(dbPath + '-wal').size;
    let uploadsSize = 0;
    if (fs.existsSync(UPLOAD_DIR)) {
      const pending = [UPLOAD_DIR];
      while (pending.length) {
        const directory = pending.pop();
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          const fullPath = path.join(directory, entry.name);
          if (entry.isDirectory()) pending.push(fullPath);
          else if (entry.isFile()) uploadsSize += fs.statSync(fullPath).size;
        }
      }
    }

    const userCount = await dbGet('SELECT COUNT(*) AS c FROM users');
    const totalStorage = await dbGet('SELECT COALESCE(SUM(total_storage_bytes), 0) AS total FROM users');
    const totalViews = await dbGet('SELECT COALESCE(SUM(view_count), 0) AS total FROM files');
    const apiUsage = await summarizeApiCalls();

    res.json({
      fileCount: fileCount.c,
      dbSize,
      uploadsSize,
      totalSize: dbSize + uploadsSize,
      userCount: userCount.c,
      totalStorageBytes: totalStorage.total,
      totalShortLinkViews: totalViews.total,
      totalApiCalls: apiUsage.successful,
      totalApiRequests: apiUsage.requests,
      apiCacheHits: apiUsage.cacheHits,
      apiFailed: apiUsage.failed,
      apiCallsBySource: apiUsage.bySource,
    });
  } catch (e) {
    res.status(500).json({ error: '获取统计失败' });
  }
});

module.exports = router;
module.exports.createBackupArchive = createBackupArchive;
module.exports.trackDataRequests = trackDataRequests;
