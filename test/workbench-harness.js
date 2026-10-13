// Real-browser regressions for restored content and nested dialogs.
// Uses its own temporary database and local server; never uses project data/.
// Run after npm run build:
//   CHROMIUM_PATH=/path/to/chromium NODE_PATH=/path/to/playwright-core/parent node test/workbench-harness.js
// Optional: WORKBENCH_REPORT_DIR=/path/to/evidence
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');
const JSZip = require('jszip');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magpie-workbench-'));
const reportDir = process.env.WORKBENCH_REPORT_DIR || path.join(dataDir, 'results');
fs.mkdirSync(reportDir, { recursive: true });
process.env.MAGPIE_DATA_DIR = dataDir;
process.env.NODE_ENV = 'test';
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASSWORD = 'testpassword123';
process.env.SESSION_SECRET = 'workbench-isolated-test-session';

const results = [], pageErrors = [];
let browser, server, page, base, md, bundle, db;
const original = '# 恢复后的内容 A\n\n必须保持的原文';
const newer = '# 恢复前的内容 B';

async function waitUntil(predicate, message = '等待条件满足', timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error(message);
}

async function check(name, run) {
  const row = { id: `W${String(results.length + 1).padStart(2, '0')}`, name };
  try {
    await run();
    row.status = 'PASS';
  } catch (error) {
    row.status = 'FAIL';
    row.detail = error.message;
    try {
      row.screenshot = `${row.id}-failure.png`;
      await page.screenshot({ path: path.join(reportDir, row.screenshot), fullPage: true });
      await page.reload({ waitUntil: 'networkidle' });
    } catch { /* Preserve the test failure even if screenshot recovery fails. */ }
  }
  results.push(row);
  console.log(`${row.status} ${row.id} ${name}${row.detail ? ' :: ' + row.detail : ''}`);
}

async function api(url, options = {}) {
  const response = await page.request.fetch(base + url, options);
  assert.ok(response.ok(), `${url}: ${response.status()} ${await response.text()}`);
  return response.json();
}

async function preview(id) {
  const url = `${base}/app/#/view/${id}`;
  if (page.url() === url) await page.reload({ waitUntil: 'networkidle' });
  else await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('[data-mode="source"]').waitFor();
  await waitUntil(async () => !(await page.locator('[data-mode="source"]').isDisabled()));
}

async function home() {
  await page.goto(base + '/app/', { waitUntil: 'networkidle' });
  await page.locator('#workspace-title').waitFor();
}

async function more(id, action) {
  const row = page.locator(`.file-item:has(.file-info[data-id="${id}"])`);
  await row.locator('.file-more-trigger').click();
  await row.locator('.btn-' + action).click();
}

async function history() {
  await page.locator('#btn-preview-more').click();
  await page.locator('#menu-version-history').click();
  await page.locator('.version-restore').first().waitFor();
}

async function restore(version) {
  await page.locator(`.version-restore[data-version="${version}"]`).click();
  await page.locator('#dialog-modal-confirm').click();
}

async function assertCurrentViews(content) {
  await waitUntil(async () => !(await page.locator('[data-mode="source"]').isDisabled()));
  await page.locator('[data-mode="source"]').click();
  assert.equal(await page.locator('#source-code').innerText(), content);
  await page.locator('#btn-edit').click();
  assert.equal(await page.locator('#editor-textarea').inputValue(), content);
  await page.locator('#btn-editor-cancel').click();
  assert.equal(await page.locator('#dialog-modal').isVisible(), false, '未改动的内容不应触发放弃编辑确认');
}

async function zip(content, asset) {
  const archive = new JSZip();
  archive.file('index.html', `<h1>${content}</h1>`);
  archive.file(asset, `/* ${content} */`);
  return archive.generateAsync({ type: 'base64' });
}

async function main() {
  assert.ok(process.env.CHROMIUM_PATH, 'Set CHROMIUM_PATH to an isolated test Chromium executable');
  const appModule = require('../server');
  db = appModule.db;
  await appModule.initApp();
  server = await new Promise(resolve => {
    const listening = appModule.app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(base + '/app/#/login', { waitUntil: 'networkidle' });
  await page.locator('#auth-account').fill('admin');
  await page.locator('#auth-password').fill('testpassword123');
  await page.locator('#auth-submit').click();
  await page.locator('#workspace-title').waitFor();
  md = await api('/api/files/upload-json', { method: 'POST', data: { name: '版本回归.md', content: original, isPublic: true } });
  await api(`/api/files/${md.id}/overwrite-json`, { method: 'POST', data: { content: newer } });

  await check('历史版本恢复后渲染显示恢复内容', async () => {
    await preview(md.id);
    await history();
    await restore(1);
    await waitUntil(async () => (await api(`/api/files/${md.id}/content`)).content === original);
    await page.locator('#btn-close-version-panel').click();
    await waitUntil(async () => {
      const frame = page.frames().find(frame => frame.url().includes(`/api/files/${md.id}/render`));
      return frame && (await frame.locator('body').innerText()).includes('恢复后的内容 A');
    });
  });
  await check('不刷新页面，恢复后的源码和编辑器都为当前内容', async () => {
    await assertCurrentViews(original);
    await page.screenshot({ path: path.join(reportDir, 'restored-content.png'), fullPage: true });
  });
  await check('恢复后直接编辑保存不会覆盖成旧版本', async () => {
    await page.locator('#btn-edit').click();
    assert.equal(await page.locator('#editor-textarea').inputValue(), original);
    await page.locator('#editor-textarea').fill(original + '\n\n恢复后继续编辑');
    await page.locator('#btn-editor-save').click();
    await waitUntil(async () => (await api(`/api/files/${md.id}/content`)).content === original + '\n\n恢复后继续编辑');
  });
  await check('预览页上传新版本后源码和编辑器同步', async () => {
    await page.locator('#version-file-input').setInputFiles({ name: '版本回归.md', mimeType: 'text/markdown', buffer: Buffer.from('# 上传后的内容 C') });
    await waitUntil(async () => (await api(`/api/files/${md.id}/content`)).content === '# 上传后的内容 C');
    await waitUntil(async () => !(await page.locator('#version-file-input').isDisabled()));
    await assertCurrentViews('# 上传后的内容 C');
    assert.equal((await api(`/api/files/${md.id}`)).share_key, md.share_key);
  });
  await check('取消恢复不会改变当前文件或版本记录', async () => {
    const before = await api(`/api/files/${md.id}/versions`);
    await history();
    await page.locator('.version-restore[data-version="1"]').click();
    await page.locator('#dialog-modal-cancel').click();
    assert.equal((await api(`/api/files/${md.id}/content`)).content, '# 上传后的内容 C');
    assert.equal((await api(`/api/files/${md.id}/versions`)).versions.length, before.versions.length);
    await page.locator('#btn-close-version-panel').click();
  });
  await check('恢复时读取较慢，源码和编辑入口等待当前内容', async () => {
    let release, continued, requested = false;
    const gate = new Promise(resolve => { release = resolve; });
    const completed = new Promise(resolve => { continued = resolve; });
    const route = `**/api/files/${md.id}/content`;
    await page.route(route, async intercepted => { requested = true; await gate; await intercepted.continue(); continued(); });
    try {
      await history();
      await restore(1);
      await waitUntil(() => requested);
      assert.equal(await page.locator('#btn-edit').isDisabled(), true);
      assert.equal(await page.locator('[data-mode="source"]').isDisabled(), true);
    } finally {
      release();
      await completed;
      await page.unroute(route);
    }
    await page.locator('#btn-close-version-panel').click();
    await assertCurrentViews(original);
  });
  await check('恢复成功但读取失败时阻止编辑旧内容；刷新可恢复', async () => {
    await api(`/api/files/${md.id}/overwrite-json`, { method: 'POST', data: { content: newer } });
    await preview(md.id);
    await history();
    const route = `**/api/files/${md.id}/content`;
    await page.route(route, intercepted => intercepted.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: '回归测试：当前内容读取失败' }) }));
    try {
      const failedRead = page.waitForResponse(response => response.url().endsWith(`/api/files/${md.id}/content`) && response.status() === 500);
      await restore(1);
      await failedRead;
      await page.locator('.toast.error').filter({ hasText: '回归测试：当前内容读取失败' }).waitFor({ state: 'attached' });
      assert.equal(await page.locator('#btn-edit').isDisabled(), true);
      assert.equal(await page.locator('[data-mode="source"]').isDisabled(), true);
    } finally { await page.unroute(route); }
    await preview(md.id);
    await assertCurrentViews(original);
  });
  await check('ZIP 历史恢复重建源码树和入口内容', async () => {
    bundle = await api('/api/files/upload-zip-base64', { method: 'POST', data: { name: '回归网站.zip', content: await zip('ZIP A', 'old.css'), isPublic: true } });
    await api(`/api/files/${bundle.id}/overwrite-zip-base64`, { method: 'POST', data: { name: '回归网站.zip', content: await zip('ZIP B', 'new.css') } });
    await preview(bundle.id);
    await history();
    await restore(1);
    await page.locator('#btn-close-version-panel').click();
    await waitUntil(async () => !(await page.locator('[data-mode="source"]').isDisabled()));
    await page.locator('[data-mode="source"]').click();
    assert.match(await page.locator('#source-code').innerText(), /ZIP A/);
    assert.match(await page.locator('#bundle-tree-body').innerText(), /old.css/);
    assert.doesNotMatch(await page.locator('#bundle-tree-body').innerText(), /new.css/);
    await page.locator('.bundle-file-row[data-path="old.css"]').click();
    await waitUntil(async () => (await page.locator('#source-code').innerText()).includes('/* ZIP A */'));
  });

  await check('分类新建对话框位于原弹窗上方且可鼠标确认', async () => {
    await home();
    await more(md.id, 'category');
    await page.locator('#category-select-create').click();
    await page.locator('#dialog-modal-input').fill('回归分类');
    assert.equal(await page.locator('#dialog-modal-confirm').evaluate(button => { const rect = button.getBoundingClientRect(); return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2).closest('.modal-backdrop').id; }), 'dialog-modal');
    await page.screenshot({ path: path.join(reportDir, 'category-dialog.png'), fullPage: true });
    await page.locator('#dialog-modal-confirm').click();
    await waitUntil(async () => (await api('/api/categories')).categories.some(category => category.name === '回归分类'));
    await page.locator('.category-list-item').filter({ hasText: '回归分类' }).click();
    await waitUntil(async () => (await api(`/api/files/${md.id}`)).category_id !== null);
  });
  await check('新建分类取消返回原弹窗且不写入数据', async () => {
    await more(md.id, 'category');
    await page.locator('#category-select-create').click();
    await page.locator('#dialog-modal-input').fill('不应创建');
    await page.locator('#dialog-modal-cancel').click();
    assert.equal(await page.locator('#category-select-modal').isVisible(), true);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'category-select-create');
    assert.ok(!(await api('/api/categories')).categories.some(category => category.name === '不应创建'));
  });
  await check('嵌套输入框 Tab 与 Shift+Tab 约束焦点', async () => {
    await page.locator('#category-select-create').click();
    await page.locator('#dialog-modal-confirm').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'dialog-modal-close');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'dialog-modal-confirm');
  });
  await check('Escape 只关闭顶部输入框并恢复背景交互', async () => {
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#dialog-modal').isVisible(), false);
    assert.equal(await page.locator('#category-select-modal').isVisible(), true);
    assert.equal(await page.locator('#app').evaluate(app => app.inert), false);
    await page.locator('#category-select-cancel').click();
  });
  await check('重新生成短链确认框可鼠标确认，旧链失效', async () => {
    await more(md.id, 'share-settings');
    await page.locator('#share-regenerate').click();
    await page.screenshot({ path: path.join(reportDir, 'share-confirm.png'), fullPage: true });
    await page.locator('#dialog-modal-confirm').click();
    await waitUntil(async () => (await api(`/api/files/${md.id}`)).share_key !== md.share_key);
    const old = await page.request.get(base + `/s/${md.share_key}`, { maxRedirects: 0 });
    assert.equal(old.status(), 404);
    const current = (await api(`/api/files/${md.id}`)).share_key;
    assert.equal((await page.request.get(base + `/s/${current}`)).status(), 200);
    await waitUntil(async () => (await page.locator('#share-link-input').inputValue()).endsWith('/s/' + current));
  });
  await check('取消短链重新生成保留链接及父弹窗焦点约束', async () => {
    const before = (await api(`/api/files/${md.id}`)).share_key;
    await page.locator('#share-regenerate').click();
    await page.locator('#dialog-modal-cancel').click();
    assert.equal((await api(`/api/files/${md.id}`)).share_key, before);
    assert.equal(await page.locator('#share-settings-modal').isVisible(), true);
    assert.equal(await page.locator('#app').evaluate(app => app.inert), true);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'share-regenerate');
  });
  await check('分享确认框 Escape 不会关闭父弹窗', async () => {
    await page.locator('#share-regenerate').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#dialog-modal').isVisible(), false);
    assert.equal(await page.locator('#share-settings-modal').isVisible(), true);
    assert.equal(await page.locator('#app').evaluate(app => app.inert), true);
    await page.locator('#share-settings-done').click();
    assert.equal(await page.locator('#app').evaluate(app => app.inert), false);
  });
  await check('普通重命名对话框确认后仍可操作文件库', async () => {
    await more(md.id, 'rename');
    await page.locator('#dialog-modal-input').fill('重命名回归.md');
    await page.locator('#dialog-modal-confirm').click();
    await waitUntil(async () => (await api(`/api/files/${md.id}`)).original_name === '重命名回归.md');
    assert.equal(await page.locator('#app').evaluate(app => app.inert), false);
    await page.locator('#search-input').fill('重命名回归');
    await page.locator('#search-clear').click();
  });
  await check('390px 分类新建可鼠标确认', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await more(md.id, 'category');
    await page.locator('#category-select-create').click();
    await page.locator('#dialog-modal-input').fill('移动分类');
    await page.locator('#dialog-modal-confirm').click();
    await waitUntil(async () => (await api('/api/categories')).categories.some(category => category.name === '移动分类'));
    await page.locator('#category-select-cancel').click();
  });
  await check('390px 短链重新生成确认可鼠标操作', async () => {
    const before = (await api(`/api/files/${md.id}`)).share_key;
    await more(md.id, 'share-settings');
    await page.locator('#share-regenerate').click();
    await page.locator('#dialog-modal-confirm').click();
    await waitUntil(async () => (await api(`/api/files/${md.id}`)).share_key !== before);
    await page.locator('#share-settings-done').click();
  });
  await check('市场入口保持隐藏，符合本次未发布范围', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await home();
    assert.equal(await page.locator('#market-link').isVisible(), false);
    assert.equal(await page.locator('.btn-publish-market').first().evaluate(button => window.getComputedStyle(button).display), 'none');
  });
  await check('浏览器没有未捕获的 JavaScript 异常', async () => assert.deepEqual(pageErrors, []));

  const summary = { total: results.length, pass: results.filter(row => row.status === 'PASS').length, fail: results.filter(row => row.status === 'FAIL').length };
  fs.writeFileSync(path.join(reportDir, 'workbench-results.json'), JSON.stringify({ summary, results, pageErrors }, null, 2));
  console.log('SUMMARY ' + JSON.stringify(summary));
  return summary.fail ? 1 : 0;
}

main().then(async code => {
  if (browser) await browser.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  if (db) await new Promise(resolve => db.close(resolve));
  if (!reportDir.startsWith(dataDir + path.sep)) fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(code);
}).catch(async error => {
  console.error(error);
  if (browser) await browser.close();
  if (server) server.closeAllConnections();
  process.exit(2);
});
