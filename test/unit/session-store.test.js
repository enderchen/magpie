const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3');
const SQLiteStore = require('../../lib/session-store');

const call = (store, method, ...args) => new Promise((resolve, reject) => store[method](...args, (error, result) => error ? reject(error) : resolve(result)));

test('session store preserves the legacy database, persists across reopen, and never revives expired sessions', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magpie-session-store-'));
  let store;
  try {
    const legacy = new sqlite3.Database(path.join(dir, 'sessions.sqlite'));
    await new Promise((resolve, reject) => legacy.exec('CREATE TABLE sessions (sid PRIMARY KEY, expired, sess)', e => e ? reject(e) : resolve()));
    await new Promise((resolve, reject) => legacy.run('INSERT INTO sessions VALUES (?, ?, ?)', ['legacy', Date.now() + 60000, JSON.stringify({ userId: 42, cookie: { maxAge: 60000 } })], e => e ? reject(e) : resolve()));
    await new Promise((resolve, reject) => legacy.close(e => e ? reject(e) : resolve()));
    store = new SQLiteStore({ dir });
    assert.equal((await call(store, 'get', 'legacy')).userId, 42);
    await call(store, 'set', 'new', { userId: 7, cookie: { expires: new Date(Date.now() + 60000) } });
    await call(store, 'set', 'expired', { userId: 8, cookie: { expires: new Date(Date.now() - 1000) } });
    await call(store, 'touch', 'expired', { cookie: { maxAge: 60000 } });
    assert.equal(await call(store, 'get', 'expired'), null);
    assert.equal(await call(store, 'length'), 2);
    await call(store, 'close');
    store = new SQLiteStore({ dir });
    assert.equal((await call(store, 'get', 'new')).userId, 7);
    assert.equal((await call(store, 'all')).length, 2);
    await call(store, 'destroy', 'legacy');
    assert.equal(await call(store, 'get', 'legacy'), null);
    await call(store, 'clear');
    assert.equal(await call(store, 'length'), 0);
  } finally {
    if (store) await call(store, 'close');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('malformed persisted sessions return one callback error', async () => {
  const store = new SQLiteStore({ db: ':memory:' });
  try {
    await store.ready;
    await new Promise((resolve, reject) => store.db.run('INSERT INTO sessions VALUES (?, ?, ?)', ['broken', Date.now() + 60000, '{invalid'], e => e ? reject(e) : resolve()));
    let callbacks = 0;
    await new Promise(resolve => store.get('broken', error => { callbacks++; assert.ok(error); resolve(); }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(callbacks, 1);
  } finally { await call(store, 'close'); }
});
