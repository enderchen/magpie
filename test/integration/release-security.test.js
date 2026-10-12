const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const crypto = require('node:crypto');
const JSZip = require('jszip');
const { createTestEnv } = require('../helpers/setup');

let env, admin, alice, bob, dbRun;
let originalTransport;
let mailFailure = false;
const sentMail = [];
process.env.ALLOW_REGISTRATION = 'true';

test.before(async () => {
  const mail = require('nodemailer');
  originalTransport = mail.createTransport;
  process.env.SMTP_HOST = 'smtp.test.invalid';
  process.env.FEEDBACK_EMAIL = 'feedback@example.test';
  mail.createTransport = () => ({
    async sendMail(message) {
      if (mailFailure) throw new Error('mock delivery failure');
      sentMail.push(message);
      return { messageId: 'mock-only-no-network' };
    },
    close() {},
  });
  env = createTestEnv();
  await env.ready();
  ({ dbRun } = require('../../lib/db'));
  admin = request.agent(env.app);
  await admin.post('/api/auth/login').send({ account: 'admin', password: 'testpassword123' }).expect(200);
  for (const username of ['alice', 'bob']) {
    await admin.post('/api/users').send({ username, password: 'release-test-password', role: 'user' }).expect(200);
  }
  alice = request.agent(env.app);
  bob = request.agent(env.app);
  for (const [agent, account] of [[alice, 'alice'], [bob, 'bob']]) {
    await agent.post('/api/auth/login').send({ account, password: 'release-test-password' }).expect(200);
  }
});
test.after(async () => {
  await require('../../mcp/transport').closeMcpTransports();
  require('nodemailer').createTransport = originalTransport;
  env.cleanup();
});

async function upload(name, isPublic = false, content = '<h1>private payload</h1>') {
  return (await alice.post('/api/files/upload-json').send({ name, content, isPublic }).expect(200)).body;
}

test('private shortlink denies a logged-in non-owner', async () => {
  const file = await upload('private-short.html');
  await bob.get(`/s/${file.share_key}`).expect(403);
  await alice.get(`/s/${file.share_key}`).expect(200);
});

test('private version metadata and rendering deny another user', async () => {
  const file = await upload('private-version.html');
  await alice.post(`/api/files/${file.id}/overwrite-json`).send({ content: '<p>second version</p>' }).expect(200);
  await bob.get(`/api/files/${file.id}/versions`).expect(403);
  await bob.get(`/api/files/${file.id}/versions/1/render`).expect(403);
});

test('share passwords protect direct render, detail and download endpoints', async () => {
  const file = await upload('password-protected.html', true);
  await alice.put(`/api/files/${file.id}/share`).send({ password: 'lock1234' }).expect(200);
  const guest = request.agent(env.app);
  for (const suffix of ['', '/render', '/download']) await guest.get(`/api/files/${file.id}${suffix}`).expect(403);
  await guest.post(`/s/${file.share_key}`).type('form').send({ password: 'lock1234' }).expect(302);
  await guest.get(`/api/files/${file.id}/render`).expect(200);
  await alice.put(`/api/files/${file.id}/share`).send({ password: 'changed1234' }).expect(200);
  await guest.get(`/api/files/${file.id}/render`).expect(403);
});

test('expired public shares also block direct URLs for non-owners', async () => {
  const file = await upload('expired-public.html', true);
  await dbRun('UPDATE files SET share_expires_at = ? WHERE id = ?', ['2000-01-01 00:00:00', file.id]);
  await request(env.app).get(`/api/files/${file.id}/render`).expect(410);
  await alice.get(`/api/files/${file.id}/render`).expect(200);
});

test('HTML direct navigation has response-level opaque-origin sandbox', async () => {
  const file = await upload('isolation.html', true, '<script>window.probe = true</script>');
  const res = await request(env.app).get(`/s/${file.share_key}`).expect(200);
  assert.match(res.headers['content-security-policy'], /sandbox[^;]*allow-scripts/);
  assert.doesNotMatch(res.headers['content-security-policy'], /allow-same-origin/);
});

test('Markdown user scripts never receive a trusted nonce', async () => {
  const file = await upload('nonce.md', true, '# Safe\n<script>window.attacker = true</script>');
  const res = await request(env.app).get(`/s/${file.share_key}`).expect(200);
  const tag = res.text.match(/<script[^>]*>window.attacker = true<\/script>/)?.[0];
  assert.ok(!tag || !/nonce=/.test(tag), 'Untrusted script gained a nonce');
  assert.match(res.headers['content-security-policy'], /sandbox/);
});

test('ZIP HTML and SVG assets have the same response-level isolation', async () => {
  const zip = new JSZip();
  zip.file('index.html', '<h1>ZIP</h1>');
  zip.file('image.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>window.attacker=true</script></svg>');
  const file = (await alice.post('/api/files/upload-zip-base64').send({ name: 'assets.zip', content: (await zip.generateAsync({ type: 'nodebuffer' })).toString('base64'), isPublic: true }).expect(200)).body;
  for (const asset of ['index.html', 'image.svg']) {
    const res = await request(env.app).get(`/api/files/${file.id}/asset/${asset}`).expect(200);
    assert.match(res.headers['content-security-policy'], /sandbox/);
    assert.doesNotMatch(res.headers['content-security-policy'], /allow-same-origin/);
  }
});

test('deleted users lose existing cookie sessions immediately', async () => {
  const id = (await admin.post('/api/users').send({ username: 'deleted', password: 'release-test-password' }).expect(200)).body.id;
  const agent = request.agent(env.app);
  await agent.post('/api/auth/login').send({ account: 'deleted', password: 'release-test-password' }).expect(200);
  await admin.delete(`/api/users/${id}`).expect(200);
  await agent.get('/api/files').expect(401);
});

test('demoted administrators cannot reuse cached admin privileges', async () => {
  const id = (await admin.post('/api/users').send({ username: 'demoted', password: 'release-test-password', role: 'admin' }).expect(200)).body.id;
  const agent = request.agent(env.app);
  await agent.post('/api/auth/login').send({ account: 'demoted', password: 'release-test-password' }).expect(200);
  await admin.put(`/api/users/${id}`).send({ role: 'user' }).expect(200);
  await agent.get('/api/users').expect(403);
});

test('cross-origin and opaque-origin cookie writes are rejected', async () => {
  for (const origin of ['https://attacker.example', 'null']) {
    await alice.post('/api/files/upload-json').set('Origin', origin).send({ name: 'csrf.html', content: '<h1>CSRF</h1>' }).expect(403);
  }
});

test('malformed JSON has a safe 400 response', async () => {
  const res = await request(env.app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"password":"do-not-leak",broken').expect(400);
  assert.doesNotMatch(JSON.stringify(res.body), /do-not-leak|SyntaxError|node_modules/);
});

test('oversized JSON receives 413 rather than internal error', async () => {
  await request(env.app).post('/api/auth/login').send({ data: 'x'.repeat(1024 * 1024 + 1) }).expect(413);
});

test('non-string login fields are rejected before database or password work', async () => {
  await request(env.app).post('/api/auth/login').send({ account: {}, password: [] }).expect(400);
});

test('expired ISO registration code cannot register on the same UTC day', async () => {
  const email = 'expired@example.com', code = '123456';
  await dbRun('INSERT INTO email_verifications (user_id, token_hash, token_prefix, type, new_email, expires_at) VALUES (0, ?, ?, ?, ?, ?)', [crypto.createHash('sha256').update(code + email).digest('hex'), '123***', 'register_code', email, new Date(Date.now() - 60_000).toISOString()]);
  await request(env.app).post('/api/auth/register').send({ email, code, password: 'release-test-password', confirmPassword: 'release-test-password' }).expect(400);
});

test('register-code mail works and login shortcut shares its send-code rate limit', async () => {
  const email = 'mail-code@example.test';
  await request(env.app).post('/api/auth/send-register-code').send({ email }).expect(200);
  const code = sentMail.at(-1).html.match(/\b\d{6}\b/)?.[0];
  assert.ok(code);
  await request(env.app).post('/api/auth/register').send({ email, code, password: 'release-test-password', confirmPassword: 'release-test-password' }).expect(201);
  await request(env.app).post('/api/auth/login').send({ account: 'shortcut@example.test', password: 'release-test-password' }).expect(429);
  assert.equal(sentMail.at(-1).to, email);
});


test('valid registration code is consumed once; login and logout work', async () => {
  const email = 'new-release@example.com', code = '654321';
  await dbRun('INSERT INTO email_verifications (user_id, token_hash, token_prefix, type, new_email, expires_at) VALUES (0, ?, ?, ?, ?, ?)', [crypto.createHash('sha256').update(code + email).digest('hex'), '654***', 'register_code', email, new Date(Date.now() + 600_000).toISOString()]);
  const agent = request.agent(env.app);
  const body = { email, code, password: 'release-test-password', confirmPassword: 'release-test-password' };
  await agent.post('/api/auth/register').send(body).expect(201);
  await agent.get('/api/auth/me').expect(200);
  await agent.post('/api/auth/logout').expect(200);
  await agent.get('/api/auth/me').expect(401);
  await agent.post('/api/auth/login').send({ account: email, password: body.password }).expect(200);
  await request(env.app).post('/api/auth/register').send(body).expect(400);
});


test('changing password retains current session and revokes other cookie sessions', async () => {
  await admin.post('/api/users').send({ username: 'rotation', password: 'release-test-password' }).expect(200);
  const first = request.agent(env.app), second = request.agent(env.app);
  for (const agent of [first, second]) await agent.post('/api/auth/login').send({ account: 'rotation', password: 'release-test-password' }).expect(200);
  await first.post('/api/auth/change-password').send({ currentPassword: 'release-test-password', newPassword: 'rotated-test-password' }).expect(200);
  await first.get('/api/auth/me').expect(200);
  await second.get('/api/files').expect(401);
  await first.post('/api/auth/change-password').send({ currentPassword: {}, newPassword: [] }).expect(400);
});

test('ordinary tag deletion cannot remove another user’s file associations or count them', async () => {
  const own = await upload('tag-own.html');
  const other = (await bob.post('/api/files/upload-json').send({ name: 'tag-other.html', content: '<p>other</p>', isPublic: false }).expect(200)).body;
  const tag = (await alice.post('/api/tags').send({ name: 'shared-release-tag' }).expect(200)).body;
  for (const [agent, file] of [[alice, own], [bob, other]]) await agent.put(`/api/files/${file.id}/tags`).send({ tagIds: [tag.id] }).expect(200);
  const list = (await alice.get('/api/tags').expect(200)).body.tags;
  assert.equal(list.find(t => t.id === tag.id).file_count, 1);
  await alice.delete(`/api/tags/${tag.id}`).expect(200);
  assert.ok((await bob.get(`/api/files/${other.id}`).expect(200)).body.tags.some(t => t.id === tag.id));
  await alice.post(`/api/files/${other.id}/star`).expect(403);
});

test('invalid share updates never partially replace existing aliases', async () => {
  const file = await upload('atomic-share.html', true);
  await alice.put(`/api/files/${file.id}/share`).send({ alias: 'release-atomic', password: 'x' }).expect(400);
  await request(env.app).get(`/s/${file.share_key}`).expect(200);
  await alice.put(`/api/files/${file.id}/share`).send({ password: {} }).expect(400);
});

test('feedback stays stored on mail failure and records success only after delivery', async () => {
  const { dbGet } = require('../../lib/db');
  mailFailure = true;
  const failed = (await request(env.app).post('/api/feedback').send({ content: 'release failure feedback' }).expect(200)).body;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await dbGet('SELECT email_sent FROM feedback WHERE id = ?', [failed.id])).email_sent, 0);
  mailFailure = false;
  const success = (await request(env.app).post('/api/feedback').send({ content: 'release success feedback' }).expect(200)).body;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await dbGet('SELECT email_sent FROM feedback WHERE id = ?', [success.id])).email_sent, 1);
});

test('MCP sessions reject another token and revoked tokens across POST, GET and DELETE', async () => {
  const token = (await alice.post('/api/tokens').send({ name: 'release-mcp' }).expect(200)).body;
  const other = (await bob.post('/api/tokens').send({ name: 'release-other' }).expect(200)).body;
  const init = await request(env.app).post('/mcp').set('Authorization', `Bearer ${token.token}`).set('Accept', 'application/json, text/event-stream').send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'release-test', version: '1' } } }).expect(200);
  const sid = init.headers['mcp-session-id'];
  assert.ok(sid);
  for (const method of ['post', 'get', 'delete']) await request(env.app)[method]('/mcp').set('Authorization', `Bearer ${other.token}`).set('mcp-session-id', sid).expect(403);
  await request(env.app).post('/mcp').set('Authorization', `Bearer ${token.token}`).set('mcp-session-id', sid).set('Accept', 'application/json, text/event-stream').send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }).expect(200);
  await alice.delete(`/api/tokens/${token.id}`).expect(200);
  await request(env.app).post('/mcp').set('Authorization', `Bearer ${token.token}`).set('mcp-session-id', sid).expect(401);
});

test('MCP rejects external and opaque Origin on every method and route spelling', async () => {
  const token = (await alice.post('/api/tokens').send({ name: 'origin-mcp' }).expect(200)).body.token;
  await request(env.app).post('/mcp').set('Host', 'outside.invalid').set('Origin', 'http://outside.invalid').set('Authorization', `Bearer ${token}`).expect(403);
  for (const route of ['/mcp', '/mcp/', '/MCP']) {
    for (const method of ['post', 'get', 'delete', 'options']) {
      for (const origin of ['https://outside.invalid', 'null']) {
        await request(env.app)[method](route).set('Authorization', `Bearer ${token}`).set('Origin', origin).expect(403);
      }
    }
  }
});

test('a fake bearer header never bypasses CSRF with an existing cookie session', async () => {
  await alice.post('/api/files/upload-json').set('Origin', 'https://attacker.example').set('Authorization', 'Bearer invalid-token').send({ name: 'csrf-cookie.html', content: '<p>bad</p>' }).expect(401);
});

async function privateBundle(agent, name) {
  const zip = new JSZip();
  zip.file('index.html', '<html><head></head><body><script src="app.js"></script></body></html>');
  zip.file('app.js', 'window.bundleWorked = true;');
  return (await agent.post('/api/files/upload-zip-base64').send({ name, isPublic: false, content: (await zip.generateAsync({ type: 'nodebuffer' })).toString('base64') }).expect(200)).body;
}

test('private bundle capabilities work without cookies but cannot access other files, APIs or survive logout', async () => {
  const viewer = request.agent(env.app);
  await viewer.post('/api/auth/login').send({ account: 'alice', password: 'release-test-password' }).expect(200);
  const file = await privateBundle(viewer, 'capability-private.zip');
  const render = await viewer.get(`/api/files/${file.id}/render`).expect(200);
  const base = render.text.match(/<base href="([^"]+)"/)?.[1];
  assert.match(base, /bundle-resource/);
  await request(env.app).get(base + 'app.js').expect(200);
  await request(env.app).get(`/api/files/${file.id}/asset/app.js`).expect(401);
  const other = await privateBundle(bob, 'capability-other.zip');
  await request(env.app).get(base.replace(`/files/${file.id}/`, `/files/${other.id}/`) + 'app.js').expect(403);
  await request(env.app).get(base + 'not-present.js').expect(404);
  await viewer.post('/api/auth/logout').expect(200);
  await request(env.app).get(base + 'app.js').expect(403);
});

test('bundle capability expiry and share-password changes revoke resource access', async () => {
  const file = await privateBundle(alice, 'capability-expiry.zip');
  const base = (await alice.get(`/api/files/${file.id}/render`).expect(200)).text.match(/<base href="([^"]+)"/)[1];
  const originalNow = Date.now;
  try {
    Date.now = () => originalNow() + 6 * 60 * 1000;
    await request(env.app).get(base + 'app.js').expect(403);
  } finally { Date.now = originalNow; }
  await alice.put(`/api/files/${file.id}/share`).send({ password: 'capability-new-password' }).expect(200);
  await request(env.app).get(base + 'app.js').expect(403);
});

test('authenticated upload and overwrite accept content over 1MB; anonymous invalid JSON is rejected before parsing', async () => {
  const content = '<p>' + 'x'.repeat(2 * 1024 * 1024) + '</p>';
  const file = (await alice.post('/api/files/upload-json').send({ name: 'over-1mb.html', content, isPublic: false }).expect(200)).body;
  await alice.post(`/api/files/${file.id}/overwrite-json`).send({ content: content + 'v2' }).expect(200);
  await request(env.app).post('/api/files/upload-json').set('Content-Type', 'application/json').send('{broken').expect(401);
});

test('failed registration mail returns 503 and removes the unusable code', async () => {
  const { dbGet } = require('../../lib/db');
  const previousProxy = env.app.get('trust proxy');
  env.app.set('trust proxy', 1); // Isolated synthetic client, separate from the send-limit test.
  mailFailure = true;
  try {
    await request(env.app).post('/api/auth/send-register-code').set('X-Forwarded-For', '192.0.2.55').send({ email: 'delivery-failed@example.test' }).expect(503);
    assert.equal(await dbGet('SELECT id FROM email_verifications WHERE new_email = ?', ['delivery-failed@example.test']), undefined);
  } finally {
    mailFailure = false;
    env.app.set('trust proxy', previousProxy);
  }
});

test('legacy MCP token cannot resurrect a deleted administrator', async () => {
  const state = require('../../lib/auth-state');
  const originalId = state.getAdminUserId();
  const originalToken = process.env.MCP_TOKEN;
  process.env.MCP_TOKEN = 'synthetic-deleted-admin-token';
  state.setAdminUserId(99999999);
  try {
    await request(env.app).get('/api/users').set('Authorization', `Bearer ${process.env.MCP_TOKEN}`).expect(401);
    const file = await upload('deleted-admin-private.html');
    await request(env.app).get(`/api/files/${file.id}/render`).set('Authorization', `Bearer ${process.env.MCP_TOKEN}`).expect(401);
  } finally {
    state.setAdminUserId(originalId);
    if (originalToken === undefined) delete process.env.MCP_TOKEN;
    else process.env.MCP_TOKEN = originalToken;
  }
});

async function withMockedProviderHttp(run) {
  const names = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'WECHAT_OPEN_APP_ID', 'WECHAT_OPEN_APP_SECRET', 'APP_URL', 'ALLOW_REGISTRATION'];
  const old = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const oldFetch = global.fetch;
  for (const name of names.slice(0, 4)) process.env[name] = 'synthetic-provider-setting';
  process.env.APP_URL = 'http://localhost:8858';
  let email = 'oauth-security@example.test', verified = true, providerId = 700100;
  global.fetch = async value => {
    const url = new URL(value);
    let body;
    if (url.pathname === '/login/oauth/access_token') body = { access_token: 'mock' };
    else if (url.pathname === '/user') body = { id: providerId, login: `releaseoauth${providerId}`, email };
    else if (url.pathname === '/user/emails') body = [{ email, verified, primary: true }];
    else if (url.pathname === '/sns/oauth2/access_token') body = { access_token: 'mock', openid: `openid-${providerId}` };
    else if (url.pathname === '/sns/userinfo') body = { openid: `openid-${providerId}`, nickname: `releaseoauth${providerId}` };
    else throw new Error('Unexpected mock provider endpoint');
    return new Response(JSON.stringify(body), { status: 200 });
  };
  try { await run(options => { ({ email = email, verified = verified, providerId = providerId } = options); }); }
  finally {
    global.fetch = oldFetch;
    for (const name of names) if (old[name] === undefined) delete process.env[name]; else process.env[name] = old[name];
  }
}

async function providerLogin(provider) {
  const agent = request.agent(env.app);
  const start = await agent.get(`/api/auth/${provider}/start`).expect(302);
  const state = new URL(start.headers.location).searchParams.get('state');
  const callback = await agent.get(`/api/auth/${provider}/callback`).query({ code: 'mock-code', state }).expect(302);
  return { agent, callback };
}

test('closed registration blocks new GitHub and WeChat accounts', async () => {
  await withMockedProviderHttp(async () => {
    process.env.ALLOW_REGISTRATION = 'false';
    const { dbGet } = require('../../lib/db');
    const before = (await dbGet('SELECT COUNT(*) AS count FROM users')).count;
    for (const provider of ['github', 'wechat']) {
      const { agent, callback } = await providerLogin(provider);
      assert.match(callback.headers.location, /#\/login$/);
      await agent.get('/api/auth/me').expect(401);
    }
    assert.equal((await dbGet('SELECT COUNT(*) AS count FROM users')).count, before);
  });
});

test('unverified GitHub email cannot take over an existing account', async () => {
  const victim = (await admin.post('/api/users').send({ username: 'provider_victim', email: 'provider-victim@example.test', password: 'release-test-password', role: 'admin' }).expect(200)).body;
  await withMockedProviderHttp(async setProfile => {
    process.env.ALLOW_REGISTRATION = 'true';
    setProfile({ email: victim.email, verified: false, providerId: 700101 });
    const { agent } = await providerLogin('github');
    const me = (await agent.get('/api/auth/me').expect(200)).body;
    assert.notEqual(me.id, victim.id);
    assert.equal(me.role, 'user');
    assert.equal(me.email, null);
    assert.equal(me.emailVerified, false);
  });
});

test('verified GitHub email does not auto-bind an unverified local account', async () => {
  await admin.post('/api/users').send({ username: 'local_unverified', email: 'local-unverified@example.test', password: 'release-test-password' }).expect(200);
  await dbRun('UPDATE users SET email_verified = 0 WHERE username = ?', ['local_unverified']);
  await withMockedProviderHttp(async setProfile => {
    setProfile({ email: 'local-unverified@example.test', verified: true, providerId: 700102 });
    const { agent, callback } = await providerLogin('github');
    assert.match(callback.headers.location, /#\/login$/);
    await agent.get('/api/auth/me').expect(401);
  });
});

test('malicious multipart field names return 400 without stopping the service', async () => {
  for (const name of ['', 'data[999999999999999999999999999999]', 'data' + '[x]'.repeat(40)]) {
    const boundary = 'release-security-boundary';
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\nvalue\r\n--${boundary}--\r\n`;
    await alice.post('/api/files/upload').set('Content-Type', `multipart/form-data; boundary=${boundary}`).send(body).expect(400);
    await alice.get('/api/files').expect(200);
  }
});

test('multipart upload accepts exactly 50MB and rejects larger files without orphaned temporary files', async () => {
  const fs = require('node:fs'), path = require('node:path');
  const directory = path.join(env.dataDir, 'uploads');
  const before = new Set(fs.readdirSync(directory));
  const maximum = 50 * 1024 * 1024;
  const buffer = Buffer.alloc(maximum + 1, '.');
  await alice.post('/api/files/upload').attach('file', buffer, 'over-limit.html').expect(400);
  assert.deepEqual(new Set(fs.readdirSync(directory)), before);
  const file = (await alice.post('/api/files/upload').field('isPublic', 'false').attach('file', buffer.subarray(0, maximum), 'at-limit.html').expect(200)).body;
  assert.equal(file.size, maximum);
  await alice.delete(`/api/files/${file.id}`).expect(200);
  assert.deepEqual(new Set(fs.readdirSync(directory)), before);
});
