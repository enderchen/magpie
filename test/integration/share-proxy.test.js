// HTTPS termination and native-form headers: do not let supertest's HTTP cookie jar hide Secure-cookie behavior.
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const JSZip = require('jszip');
const { createTestEnv } = require('../helpers/setup');
const origin = 'https://share.example';
let env, ownerCookie, otherCookie;
const call = (method, url, cookie) => {
  const req = request(env.app)[method](url).set('Host', 'share.example').set('X-Forwarded-Proto', 'https');
  if (method !== 'get') req.set('Origin', origin);
  if (cookie) req.set('Cookie', cookie);
  return req;
};
const login = async username => {
  const res = await call('post', '/api/auth/login').send({ username, password: 'testpassword123' }).expect(200);
  const cookie = res.headers['set-cookie'][0];
  assert.match(cookie, /; Secure/);
  assert.match(cookie, /; HttpOnly/);
  assert.match(cookie, /; SameSite=Lax/);
  assert.match(cookie, /; Path=\//);
  return cookie.split(';')[0];
};
test.before(async () => {
  process.env.COOKIE_SECURE = 'true';
  process.env.APP_URL = origin;
  env = createTestEnv();
  env.app.set('trust proxy', 'loopback');
  await env.ready();
  const admin = await login('admin');
  for (const username of ['share_owner', 'share_other']) await call('post', '/api/users', admin).send({ username, password: 'testpassword123', role: 'user' }).expect(200);
  ownerCookie = await login('share_owner');
  otherCookie = await login('share_other');
});
test.after(() => env.cleanup());

test('HTTPS proxy: form POST, Secure cookie, redirects and protected resources for HTML/Markdown/ZIP', async () => {
  const zip = new JSZip();
  zip.file('index.html', '<html><head></head><body><h1>ZIP-secret</h1><img src="image.svg"></body></html>');
  zip.file('image.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const cases = [
    ['/api/files/upload-json', { name: 'proxy.html', content: '<h1>HTML-secret</h1>', isPublic: true }, 'HTML-secret'],
    ['/api/files/upload-json', { name: 'proxy.md', content: '# Markdown-secret', isPublic: true }, 'Markdown-secret'],
    ['/api/files/upload-zip-base64', { name: 'proxy.zip', content: await zip.generateAsync({ type: 'base64' }), isPublic: true }, 'ZIP-secret'],
  ];
  for (const [endpoint, body, marker] of cases) {
    const up = await call('post', endpoint, ownerCookie).send(body).expect(200);
    const { id, share_key: key } = up.body;
    const password = ' proxy +& 密码 ! ';
    await call('put', `/api/files/${id}/share`, ownerCookie).send({ password }).expect(200);
    const gate = await call('get', `/s/${key}`).expect(200);
    assert.equal(gate.headers['referrer-policy'], 'same-origin');
    assert.doesNotMatch(gate.text, new RegExp(marker));
    for (const suffix of ['/render', '/download', '/asset/image.svg']) await call('get', `/api/files/${id}${suffix}`).expect(403);
    await call('head', `/api/files/${id}/render`).expect(403);
    for (const bad of ['', 'wrong']) {
      const error = await call('post', `/s/${key}`).type('form').send({ password: bad }).expect(200);
      assert.match(error.text, /密码错误/);
      assert.equal(error.headers['referrer-policy'], 'same-origin');
    }
    for (const outside of ['null', 'https://outside.example']) await call('post', `/s/${key}`).set('Origin', outside).type('form').send({ password }).expect(403);
    const unlocked = await call('post', `/s/${key}`).type('form').send({ password }).expect(302);
    assert.equal(unlocked.headers.location, `/s/${key}`);
    assert.match(unlocked.headers['set-cookie'][0], /; Secure/);
    const visitorCookie = unlocked.headers['set-cookie'][0].split(';')[0];
    const rendered = await call('get', unlocked.headers.location, visitorCookie).expect(200);
    assert.match(rendered.text, new RegExp(marker));
    assert.equal(rendered.headers['referrer-policy'], 'no-referrer');
    assert.match((await call('get', `/s/${key}`, visitorCookie)).text, new RegExp(marker));
    await call('get', `/api/files/${id}/render`, visitorCookie).expect(200);
    const head = await call('head', `/api/files/${id}/render`, visitorCookie).expect(200);
    assert.match(head.headers['content-type'], /text\/html/);
    await call('get', `/api/files/${id}/download`, visitorCookie).expect(200);
    if (body.name.endsWith('.zip')) {
      const base = rendered.text.match(/<base href="([^"]+)"/)[1];
      await call('get', base + 'image.svg').expect(200);
      await call('get', `/api/files/${id}/asset/image.svg`, visitorCookie).expect(200);
      await call('put', `/api/files/${id}/share`, ownerCookie).send({ password: 'changed' }).expect(200);
      await call('get', base + 'image.svg').expect(403);
    } else await call('put', `/api/files/${id}/share`, ownerCookie).send({ password: 'changed' }).expect(200);
    assert.match((await call('get', `/s/${key}`, visitorCookie)).text, /需要访问密码/);
    await call('put', `/api/files/${id}/share`, ownerCookie).send({ password: null }).expect(200);
    assert.match((await call('get', `/s/${key}`)).text, new RegExp(marker));
  }
});

test('private and expired shares cannot be unlocked by an anonymous or another user', async () => {
  const up = await call('post', '/api/files/upload-json', ownerCookie).send({ name: 'private.html', content: '<h1>private-secret</h1>', isPublic: false }).expect(200);
  const key = up.body.share_key;
  await call('put', `/api/files/${up.body.id}/share`, ownerCookie).send({ password: 'private-pass' }).expect(200);
  const anon = await call('post', `/s/${key}`).type('form').send({ password: 'private-pass' }).expect(302);
  assert.equal(anon.headers.location, '/app/#/login');
  await call('post', `/s/${key}`, otherCookie).type('form').send({ password: 'private-pass' }).expect(403);
  for (const suffix of ['/render', '/download', '/asset/image.svg']) {
    await call('get', `/api/files/${up.body.id}${suffix}`).expect(401);
    await call('get', `/api/files/${up.body.id}${suffix}`, otherCookie).expect(403);
  }
  await call('head', `/api/files/${up.body.id}/render`).expect(401);
  await call('head', `/api/files/${up.body.id}/render`, otherCookie).expect(403);
  await call('post', `/s/${key}`, ownerCookie).type('form').send({ password: 'private-pass' }).expect(302);
  assert.match((await call('get', `/s/${key}`, ownerCookie)).text, /private-secret/);
  const { dbRun } = require('../../lib/db');
  await dbRun('UPDATE files SET share_expires_at = ? WHERE id = ?', ['2000-01-01 00:00:00', up.body.id]);
  await call('get', `/s/${key}`, ownerCookie).expect(410);
  await call('post', `/s/${key}`, ownerCookie).type('form').send({ password: 'private-pass' }).expect(410);
});
