const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const { run } = require('../../bin/magpie');
const { resetIo } = require('../../bin/commands/_shared');

async function invoke(args) {
  let code = 0;
  const calls = [];
  try {
    await run(args, {
      cwd: os.tmpdir(), env: { MAGPIE_TOKEN: 'synthetic-test-token' },
      stdout: { write() {} }, stderr: { write() {} }, exit(value) { code = value; },
      async fetchImpl(url, init) {
        calls.push({ url, method: init.method, body: init.body && JSON.parse(init.body) });
        return { status: 200, async text() { return '{"success":true}'; } };
      },
    });
    return { code, calls };
  } finally { resetIo(); }
}

test('mv honors explicit false privacy flags', async () => {
  const privateFile = await invoke(['mv', '1', 'private.md', '--public=false']);
  assert.equal(privateFile.code, 0);
  assert.equal(privateFile.calls[0].body.isPublic, false);
  const unchanged = await invoke(['mv', '1', 'public.md', '--private=false']);
  assert.equal(unchanged.code, 0);
  assert.equal(unchanged.calls[0].body.isPublic, undefined);
  assert.equal((await invoke(['mv', '1', 'public.md', '--public'])).calls[0].body.isPublic, true);
  assert.equal((await invoke(['mv', '1', 'private.md', '--private'])).calls[0].body.isPublic, false);
});

test('mv rejects contradictory public/private flags before sending a request', async () => {
  const result = await invoke(['mv', '1', 'file.md', '--public', '--private']);
  assert.equal(result.code, 2);
  assert.equal(result.calls.length, 0);
});

test('rm requires explicit confirmation even in a noninteractive client', async () => {
  for (const args of [['rm', '1'], ['rm', '1', '--yes=false']]) {
    const result = await invoke(args);
    assert.equal(result.code, 1);
    assert.equal(result.calls.length, 0);
  }
  const confirmed = await invoke(['rm', '1', '--yes']);
  assert.equal(confirmed.code, 0);
  assert.equal(confirmed.calls.length, 1);
  assert.equal(confirmed.calls[0].method, 'DELETE');
});
