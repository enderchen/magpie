const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function source(file) {
  return fs.readFileSync(path.join(__dirname, '../../public/js', file), 'utf8')
    .replace(/^import .*;\n/gm, '').replace(/^export .*;\n/gm, '');
}

test('upgraded routes enforce light theme without overwriting a saved dark preference', () => {
  const classes = new Set();
  const context = {
    document: { documentElement: { classList: {
      toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); },
    } } },
    localStorage: { getItem() { return 'dark'; }, setItem() { assert.fail('Route must not change saved theme'); } },
    window: { matchMedia() { return { matches: false }; } },
  };
  vm.createContext(context);
  vm.runInContext(source('theme.js'), context);
  context.applyPageTheme(true);
  assert.ok(classes.has('light'));
  assert.ok(classes.has('neo-app'));
  context.applyPageTheme(false);
  assert.ok(!classes.has('light'));
  assert.ok(!classes.has('neo-app'));
});

test('share dialog loads fresh metadata even when opened with a content response lacking share_key', async () => {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', textContent: '', innerHTML: '', style: {}, addEventListener() {} });
    return nodes.get(id);
  };
  const modal = { querySelector(selector) { return node(selector.slice(1)); } };
  let opened = false;
  const requests = [];
  const context = {
    document: { getElementById() { return modal; } },
    location: { origin: 'https://magpie.example' },
    api: async url => { requests.push(url); return { original_name: 'test.html', share_key: 'fresh-key', is_public: true, has_share_password: false }; },
    openModal() { opened = true; }, closeModal() {},
    escapeHtml: value => String(value), toast() {}, copyToClipboard() {}, dialogModal: {},
  };
  vm.createContext(context);
  vm.runInContext(source('pages/share-settings.js'), context);
  await context.openShareSettings(17, { content: '<h1>Test</h1>' });
  assert.deepEqual(requests, ['/api/files/17']);
  assert.equal(node('share-link-input').value, 'https://magpie.example/s/fresh-key');
  assert.equal(node('share-filename').textContent, 'test.html');
  assert.equal(node('share-password-clear').disabled, true);
  assert.equal(opened, true);
});

test('share metadata failure reports an error instead of opening an empty-link dialog', async () => {
  let opened = false;
  let error;
  const context = {
    document: { getElementById() { return {}; } },
    api: async () => { throw new Error('文件已删除'); },
    openModal() { opened = true; }, toast(message) { error = message; },
  };
  vm.createContext(context);
  vm.runInContext(source('pages/share-settings.js'), context);
  await context.openShareSettings(17, {});
  assert.equal(opened, false);
  assert.equal(error, '文件已删除');
});

test('empty search results are distinguished from an empty library', () => {
  const nodes = new Map(['file-list', 'empty-state', 'file-count'].map(id => [id, {
    innerHTML: '', textContent: '', style: {}, querySelector() { return null; },
  }]));
  const container = { querySelector(selector) { return nodes.get(selector.slice(1)); } };
  const context = { document: { addEventListener() {} } };
  vm.createContext(context);
  vm.runInContext(source('pages/home.js'), context);
  context.renderPagination = () => {};
  vm.runInContext("filterState.query = '不存在的文件'", context);
  context.applyFilters(container);
  assert.match(nodes.get('file-list').innerHTML, /无匹配文件/);
  assert.equal(nodes.get('empty-state').style.display, 'none');
  vm.runInContext("filterState.query = ''", context);
  context.applyFilters(container);
  assert.equal(nodes.get('empty-state').style.display, 'block');
});

test('upgraded dialog traps Tab, closes with Escape, and restores background focus', () => {
  const app = { inert: false };
  const previous = { isConnected: true, focus() { context.document.activeElement = previous; } };
  const field = { getClientRects() { return [1]; }, focus() { context.document.activeElement = field; } };
  const last = { getClientRects() { return [1]; }, focus() { context.document.activeElement = last; } };
  const listeners = {};
  const modal = {
    id: 'profile-modal', hidden: true,
    setAttribute() {},
    querySelector() { return field; }, querySelectorAll() { return [field, last]; },
    addEventListener(name, listener) { listeners[name] = listener; },
    removeEventListener(name) { delete listeners[name]; },
  };
  const context = { document: { activeElement: previous, getElementById() { return app; } } };
  vm.createContext(context);
  vm.runInContext(source('utils.js'), context);
  context.openModal(modal);
  assert.equal(app.inert, true);
  assert.equal(context.document.activeElement, field);
  last.focus();
  let prevented = false;
  listeners.keydown({ key: 'Tab', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(context.document.activeElement, field);
  listeners.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(modal.hidden, true);
  assert.equal(app.inert, false);
  assert.equal(context.document.activeElement, previous);
});
