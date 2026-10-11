// 管理员集成测试（仅 admin）：export 备份 / import 恢复 / stats / 权限边界。
// 挂载点 /api/admin，全部 requireAuth + requireAdmin。
const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const JSZip = require('jszip');
const { createTestEnv } = require('../helpers/setup');

// supertest 二进制响应解析器：把响应体收集成 Buffer 挂到 res.body。
// export / skills download 都是流式 zip，需 .buffer(true).parse(binaryParser) 才能拿到字节。
function binaryParser(res, cb) {
  const data = [];
  res.on('data', chunk => data.push(chunk));
  res.on('end', () => cb(null, Buffer.concat(data)));
}

let env;
let adminAgent;
let userAgent;

test.before(async () => {
  env = createTestEnv();
  await env.ready();
  adminAgent = request.agent(env.app);
  await adminAgent.post('/api/auth/login').send({ username: 'admin', password: 'testpassword123' });
  // 建一个普通用户
  await adminAgent.post('/api/users').send({ username: 'regular', password: 'regularpass123', role: 'user' });
  userAgent = request.agent(env.app);
  await userAgent.post('/api/auth/login').send({ username: 'regular', password: 'regularpass123' });
});

test.after(() => {
  env.cleanup();
});

// --- 权限边界 ---
test('未登录 GET /api/admin/stats → 401', async () => {
  const res = await request(env.app).get('/api/admin/stats');
  assert.strictEqual(res.status, 401);
});

test('普通用户 GET /api/admin/stats → 403', async () => {
  const res = await userAgent.get('/api/admin/stats');
  assert.strictEqual(res.status, 403);
});

// --- stats ---
test('admin GET /api/admin/stats → 200，含统计字段', async () => {
  const res = await adminAgent.get('/api/admin/stats');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(typeof res.body.fileCount, 'number');
  assert.strictEqual(typeof res.body.dbSize, 'number');
  assert.strictEqual(typeof res.body.uploadsSize, 'number');
  assert.strictEqual(res.body.totalSize, res.body.dbSize + res.body.uploadsSize);
});

// --- export ---
test('admin GET /api/admin/export → 200，application/zip', async () => {
  const res = await adminAgent.get('/api/admin/export').buffer(true).parse(binaryParser);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers['content-type'] || '', /application\/zip/);
  assert.match(res.headers['content-disposition'] || '', /attachment/);
  // 至少有内容（zip 魔数 PK）
  assert.ok(Buffer.isBuffer(res.body));
  assert.ok(res.body.length > 4);
  assert.strictEqual(res.body[0], 0x50); // 'P'
});

test('普通用户 GET /api/admin/export → 403', async () => {
  const res = await userAgent.get('/api/admin/export');
  assert.strictEqual(res.status, 403);
});

// --- import ---
test('admin import：非 ZIP / 缺 file 字段 → 400', async () => {
  const res = await adminAgent.post('/api/admin/import');
  assert.strictEqual(res.status, 400);
});

test('admin import：ZIP 缺 database.sqlite → 400', async () => {
  // 构造一个不含 database.sqlite 的 zip
  const zip = new JSZip();
  zip.file('readme.txt', 'not a backup');
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  const res = await adminAgent.post('/api/admin/import').attach('file', buf, 'bad.zip');
  assert.strictEqual(res.status, 400);
});

test('admin export→import round-trip → 200', async () => {
  // 先 export 拿到合法备份（buffer 二进制）
  const exportRes = await adminAgent.get('/api/admin/export').buffer(true).parse(binaryParser);
  const buf = exportRes.body; // 已是 Buffer
  // 再 import 回去（应有 database.sqlite）
  const res = await adminAgent.post('/api/admin/import').attach('file', buf, 'roundtrip.zip');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
  // 导入后 stats 仍可读
  const stats = await adminAgent.get('/api/admin/stats');
  assert.strictEqual(stats.status, 200);
});

test('普通用户 import → 403', async () => {
  const zip = new JSZip();
  zip.file('database.sqlite', 'fake');
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  const res = await userAgent.post('/api/admin/import').attach('file', buf, 'x.zip');
  assert.strictEqual(res.status, 403);
});

test('invalid database backups are rejected before touching existing files or accounts', async () => {
  const file = (await adminAgent.post('/api/files/upload-json').send({ name: 'restore-preserve.html', content: '<h1>keep original</h1>', isPublic: false }).expect(200)).body;
  const zip = new JSZip();
  zip.file('database.sqlite', 'not a SQLite database');
  await adminAgent.post('/api/admin/import').attach('file', await zip.generateAsync({ type: 'nodebuffer' }), 'invalid-database.zip').expect(400);
  assert.match((await adminAgent.get(`/api/files/${file.id}/render`).expect(200)).text, /keep original/);
  await adminAgent.get('/api/admin/stats').expect(200);
});

test('backup path traversal is rejected before any data replacement', async () => {
  const zip = new JSZip();
  zip.file('database.sqlite', 'irrelevant');
  zip.file('../outside-restore.txt', 'outside');
  await adminAgent.post('/api/admin/import').attach('file', await zip.generateAsync({ type: 'nodebuffer' }), 'traversal-backup.zip').expect(400);
  await adminAgent.get('/api/admin/stats').expect(200);
});

test('backup round-trip restores content, versions and token encryption while excluding old sessions', async () => {
  const file = (await adminAgent.post('/api/files/upload-json').send({ name: 'restore-roundtrip.html', content: '<h1>backup v1</h1>', isPublic: false }).expect(200)).body;
  await adminAgent.post(`/api/files/${file.id}/overwrite-json`).send({ content: '<h1>backup v2</h1>' }).expect(200);
  const token = (await adminAgent.post('/api/tokens').send({ name: 'backup-roundtrip' }).expect(200)).body;
  const backup = (await adminAgent.get('/api/admin/export').buffer(true).parse(binaryParser).expect(200)).body;
  const zip = await JSZip.loadAsync(backup);
  assert.ok(zip.file('token-key.key'));
  assert.equal(zip.file('sessions.sqlite'), null);
  await adminAgent.post(`/api/files/${file.id}/overwrite-json`).send({ content: '<h1>after backup</h1>' }).expect(200);
  await adminAgent.post('/api/admin/import').attach('file', backup, 'complete-roundtrip.zip').expect(200);
  assert.match((await adminAgent.get(`/api/files/${file.id}/render`).expect(200)).text, /backup v2/);
  assert.match((await adminAgent.get(`/api/files/${file.id}/versions/1/render`).expect(200)).text, /backup v1/);
  await request(env.app).get('/api/files').set('Authorization', `Bearer ${token.token}`).expect(200);
  const { dbGet } = require('../../lib/db');
  const encrypted = await dbGet('SELECT token_enc FROM tokens WHERE id = ?', [token.id]);
  assert.equal(require('../../lib/crypto').decryptToken(encrypted.token_enc), token.token);
});

test('incompatible SQLite schema is rejected before replacing current data', async () => {
  const fs = require('node:fs'), path = require('node:path');
  const sqlite3 = require('sqlite3');
  const temp = path.join(env.dataDir, 'incompatible.sqlite');
  const staged = new sqlite3.Database(temp);
  await new Promise((resolve, reject) => staged.exec("CREATE TABLE users (id INTEGER, username TEXT, password_hash TEXT, role TEXT); INSERT INTO users VALUES (1, 'admin', 'test', 'admin'); CREATE TABLE files (stored_name TEXT, is_bundle INTEGER, entry_path TEXT); CREATE TABLE file_versions (stored_name TEXT, is_bundle INTEGER, entry_path TEXT);", error => error ? reject(error) : resolve()));
  await new Promise(resolve => staged.close(resolve));
  const zip = new JSZip(); zip.file('database.sqlite', fs.readFileSync(temp));
  fs.unlinkSync(temp);
  await adminAgent.post('/api/admin/import').attach('file', await zip.generateAsync({ type: 'nodebuffer' }), 'incompatible.zip').expect(400);
  await adminAgent.get('/api/admin/stats').expect(200);
});

test('restore failure after database replacement rolls back content and keeps the service usable', async () => {
  const fs = require('node:fs');
  const backup = (await adminAgent.get('/api/admin/export').buffer(true).parse(binaryParser).expect(200)).body;
  const file = (await adminAgent.post('/api/files/upload-json').send({ name: 'rollback-current.html', content: '<h1>current after snapshot</h1>', isPublic: false }).expect(200)).body;
  const originalCopy = fs.copyFileSync;
  let injected = false;
  fs.copyFileSync = (source, ...args) => {
    if (!injected && source.includes('restore-stage-') && source.endsWith('database.sqlite')) {
      injected = true;
      throw new Error('synthetic restore copy failure');
    }
    return originalCopy(source, ...args);
  };
  try {
    const response = await adminAgent.post('/api/admin/import').attach('file', backup, 'rollback.zip').expect(500);
    assert.ok(injected);
    assert.match(response.body.error, /已恢复原数据/);
    assert.match((await adminAgent.get(`/api/files/${file.id}/render`).expect(200)).text, /current after snapshot/);
    await adminAgent.get('/api/admin/stats').expect(200);
  } finally { fs.copyFileSync = originalCopy; }
});
