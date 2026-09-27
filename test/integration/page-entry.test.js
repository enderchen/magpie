const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createTestEnv } = require('../helpers/setup');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let env;
const oldIcp = process.env.ICP_BEIAN;
test.before(async () => {
  process.env.ICP_BEIAN = '测试备案 <script> &';
  env = createTestEnv();
  await env.ready();
});
test.after(() => {
  env.cleanup();
  if (oldIcp === undefined) delete process.env.ICP_BEIAN;
  else process.env.ICP_BEIAN = oldIcp;
});

test('root shows the approved homepage for anonymous and authenticated visitors', async () => {
  const agent = request.agent(env.app);
  await agent.post('/api/auth/login').send({ account: 'admin', password: 'testpassword123' }).expect(200);
  for (const client of [request(env.app), agent]) {
    const res = await client.get('/').expect(200);
    assert.match(res.text, /id="hero-title"/);
    assert.match(res.text, /id="paste-form"/);
    assert.doesNotMatch(res.text, /id="home-template"|noindex|id="landing-template"/);
    assert.match(res.text, /测试备案 &lt;script&gt; &amp;/);
    assert.match(res.headers['content-security-policy'], /script-src 'self' 'nonce-/);
    assert.equal(res.headers['cache-control'], 'no-cache');
  }
});

test('application shell remains separate and uses versioned assets', async () => {
  const res = await request(env.app).get('/app/').expect(200);
  assert.match(res.text, /id="login-template"/);
  assert.match(res.text, /id="home-template"/);
  assert.doesNotMatch(res.text, /id="landing-template"|id="hero-title"/);
  assert.match(res.text, /(?:\/dist\/app-[^" ]+\.js|\/js\/app\.js\?v=)/);
  const nonce = res.headers['content-security-policy'].match(/'nonce-([^']+)'/)[1];
  assert.ok(res.text.includes(`nonce="${nonce}"`));
});

test('old HTML entrypoints redirect with query parameters intact', async () => {
  for (const [url, target] of [
    ['/home-share/index.html?v=51', '/?v=51'],
    ['/home-share/', '/'], ['/app?source=home', '/app/?source=home'],
    ['/index.html', '/app/'],
  ]) {
    const res = await request(env.app).get(url).expect(302);
    assert.equal(res.headers.location, target);
  }
});

test('homepage static assets and examples resolve without returning app HTML', async () => {
  const res = await request(env.app).get('/');
  const urls = [...res.text.matchAll(/(?:src|href)="(\/(?:home-share|logo-exploration)\/[^"#]+)"/g)].map(m => m[1]);
  for (const url of new Set(urls)) {
    const asset = await request(env.app).get(url).expect(200);
    if (!/\.html(?:\?|$)/.test(url)) assert.doesNotMatch(asset.headers['content-type'], /text\/html/);
  }
});

test('legacy business fragments move to app; homepage section anchors stay put', () => {
  const script = fs.readFileSync(path.join(__dirname, '../../public/home-share/entry.js'), 'utf8');
  for (const hash of ['#/login?oauth=google_failed', '#/register', '#/view/42?mode=source', '#/market/starred', '#/email-verify-expired']) {
    let redirect;
    vm.runInNewContext(script, { window: { location: { hash, search: '?source=old', replace: value => { redirect = value; } }, addEventListener() {} } });
    assert.equal(redirect, '/app/?source=old' + hash);
  }
  for (const hash of ['', '#/', '#try', '#home', '#scenarios', '#ai', '#//evil.example']) {
    vm.runInNewContext(script, { window: { location: { hash, search: '', replace() { assert.fail('Unexpected redirect'); } }, addEventListener() {} } });
  }
});

test('email verification failures return to the application result page', async () => {
  const res = await request(env.app).get('/api/auth/verify-email').expect(302);
  assert.equal(res.headers.location, '/app/#/email-verify-failed');
});
