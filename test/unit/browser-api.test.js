const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const apiModule = import('data:text/javascript;base64,' + fs.readFileSync(path.join(__dirname, '../../public/js/api.js')).toString('base64'));
const originalFetch = global.fetch;
test.afterEach(() => { global.fetch = originalFetch; });
const stall = signal => new Promise((resolve, reject) => {
  if (signal.aborted) return reject(signal.reason);
  signal.addEventListener('abort', () => reject(signal.reason), { once: true });
});

test('short request timeout aborts the connection, without mutating caller options or passing timeoutMs to fetch', async () => {
  const { api } = await apiModule;
  let received;
  global.fetch = async (_url, opts) => { received = opts; return stall(opts.signal); };
  const opts = { timeoutMs: 15, method: 'POST', body: { name: 'fixture' } };
  await assert.rejects(api('/fixture', opts), /请求超时，请重试/);
  assert.equal(received.signal.aborted, true);
  assert.equal(received.timeoutMs, undefined);
  assert.deepEqual(opts.body, { name: 'fixture' });
});

test('timeout covers a body that stalls after response headers', async () => {
  const { api } = await apiModule;
  global.fetch = async (_url, opts) => ({ status: 200, ok: true, json: () => stall(opts.signal) });
  await assert.rejects(api('/fixture', { timeoutMs: 15 }), /请求超时/);
});

test('closing a request preserves cancellation rather than reporting a timeout', async () => {
  const { api } = await apiModule;
  let received;
  global.fetch = async (_url, opts) => { received = opts; return stall(opts.signal); };
  const controller = new AbortController();
  const pending = api('/fixture', { timeoutMs: 1000, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, e => e.name === 'AbortError');
  assert.equal(received.signal.aborted, true);
});

test('normal and error responses clean up timeout; long operations have no implicit timeout', async () => {
  const { api } = await apiModule;
  let received;
  global.fetch = async (_url, opts) => { received = opts; return new Response('{"value":42}'); };
  assert.deepEqual(await api('/fixture', { timeoutMs: 15 }), { value: 42 });
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(received.signal.aborted, false);
  assert.deepEqual(await api('/fixture'), { value: 42 });
  assert.equal(received.signal, undefined);
  global.fetch = async () => new Response('{"error":"登录已失效"}', { status: 401 });
  await assert.rejects(api('/fixture', { timeoutMs: 15 }), e => e.status === 401 && e.message === '登录已失效');
  global.fetch = async () => new Response(null, { status: 204 });
  assert.equal(await api('/fixture', { timeoutMs: 15 }), null);
});
