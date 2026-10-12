const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createTestEnv } = require('../helpers/setup');
const { createDispatcher } = require('../../lib/dispatch');

test('completed MCP dispatch requests do not keep backup maintenance busy', { timeout: 15000 }, async () => {
  const env = createTestEnv();
  try {
    await env.ready();
    const admin = request.agent(env.app);
    await admin.post('/api/auth/login').send({ username: 'admin', password: 'testpassword123' }).expect(200);
    const token = (await admin.post('/api/tokens').send({ name: 'dispatch-backup-regression' }).expect(200)).body.token;
    const dispatcher = createDispatcher(env.app, { token });
    await dispatcher.get('/api/files');
    await assert.rejects(dispatcher.get('/api/files/999999/content'), { status: 404 });
    const response = await admin.get('/api/admin/export').buffer(true).parse((res, done) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
    assert.equal(response.status, 200);
    assert.match(response.headers['content-type'], /application\/zip/);
    assert.equal(response.body.subarray(0, 2).toString(), 'PK');
  } finally {
    env.cleanup();
  }
});
