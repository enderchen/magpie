const test = require('node:test');
const assert = require('node:assert/strict');
const { createDispatcher } = require('../../lib/dispatch');

test('unmatched dispatch releases response lifecycle once', async () => {
  let finishes = 0;
  const app = { handle(req, res, next) {
    res.once('finish', () => {
      finishes++;
      assert.equal(req.complete, true);
      assert.equal(res.writableEnded, true);
    });
    next();
    res.end();
  } };
  await assert.rejects(createDispatcher(app, {}).get('/missing'), { status: 404 });
  assert.equal(finishes, 1);
});

test('synchronous dispatch failure closes pending response', async () => {
  const failure = new Error('handler failed');
  let closes = 0;
  const app = { handle(_req, res) {
    res.once('close', () => { closes++; });
    throw failure;
  } };
  await assert.rejects(createDispatcher(app, {}).get('/api/files'), failure);
  assert.equal(closes, 1);
});
