/* global document, window, navigator */
'use strict';

const editor = document.getElementById('content-editor');
const form = document.getElementById('paste-form');
const help = document.getElementById('editor-help');
const generate = document.getElementById('generate');
const result = document.getElementById('publish-result');
const urlInput = document.getElementById('share-url');
const resultNote = document.getElementById('result-note');
const openLink = document.getElementById('open-link');
const copyLink = document.getElementById('copy-link');
const maxBytes = 200 * 1024;
const samples = {
  html: editor.value,
  markdown: '# 把灵感，装进一页。\n\n这是一份可以分享的小小作品。\n\n- 一个还在生长的想法\n- 一份值得被看见的报告\n- 一次新的出发\n\n**一纸，寄万千。**',
};
let expiryTimer;
let expired = false;
let latestUrl = '';

function message(text, error = false) {
  help.textContent = text;
  help.classList.toggle('is-error', error);
  editor.setAttribute('aria-invalid', String(error));
}

function updateEditor() {
  const size = new Blob([editor.value]).size;
  const type = editor.value.trim().startsWith('<') ? 'HTML' : 'Markdown';
  document.getElementById('detected-type').textContent = editor.value.trim() ? `自动识别为 ${type}` : '支持 HTML / Markdown';
  document.getElementById('byte-count').textContent = `${(size / 1024).toFixed(1)} / 200 KB`;
  message(size > maxBytes ? '内容超过 200 KB，请删减后重试。' : '临时页面公开可见，10 分钟后失效。', size > maxBytes);
  result.hidden = true;
  clearInterval(expiryTimer);
  document.querySelectorAll('[data-sample]').forEach(button => {
    button.setAttribute('aria-pressed', String(editor.value === samples[button.dataset.sample]));
  });
}
editor.addEventListener('input', updateEditor);
document.querySelectorAll('[data-sample]').forEach(button => {
  button.addEventListener('click', () => {
    editor.value = samples[button.dataset.sample];
    updateEditor();
  });
});
document.getElementById('clear-editor').addEventListener('click', () => {
  editor.value = '';
  updateEditor();
  editor.focus();
});

function countdown(expiresAt) {
  clearInterval(expiryTimer);
  const end = Date.parse(expiresAt.replace(' ', 'T') + 'Z');
  const tick = () => {
    const seconds = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    expired = seconds <= 0 || !Number.isFinite(seconds);
    document.getElementById('expiry').textContent = expired ? '链接已过期' : `剩余 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    if (expired) {
      clearInterval(expiryTimer);
      openLink.removeAttribute('href');
      openLink.setAttribute('aria-disabled', 'true');
      copyLink.disabled = true;
      resultNote.textContent = '临时链接已失效，可重新生成。';
    }
  };
  tick();
  if (!expired) expiryTimer = setInterval(tick, 1000);
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (generate.disabled) return;
  const content = editor.value;
  if (!content.trim() || new Blob([content]).size > maxBytes) {
    message(content.trim() ? '内容超过 200 KB，请删减后重试。' : '内容还是空的。粘贴文件内容，或选择上方示例。', true);
    editor.focus();
    return;
  }
  generate.disabled = true;
  generate.textContent = '正在生成…';
  form.setAttribute('aria-busy', 'true');
  result.hidden = true;
  clearInterval(expiryTimer);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch('/api/public/try-paste', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }), signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '暂时无法生成链接，请稍后重试。');
    if (!/^\/s\/[\w-]+$/.test(data.url || '')) throw new Error('返回的链接格式异常，请稍后重试。');
    latestUrl = new URL(data.url, window.location.origin).href;
    urlInput.value = latestUrl;
    openLink.href = latestUrl;
    openLink.removeAttribute('aria-disabled');
    copyLink.disabled = false;
    copyLink.textContent = '复制链接';
    result.hidden = false;
    resultNote.textContent = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
      ? '当前为本地预览，链接仅本机可访问。' : '拥有链接的人均可查看，10 分钟后自动失效。';
    message(content === editor.value ? '已生成当前内容的临时页面。编辑后可再次生成。' : '链接对应提交时的内容。新的修改需要再次生成。');
    countdown(data.expires_at);
  } catch (error) {
    message(error.name === 'AbortError' ? '请求超时，请稍后重试。' : error.message || '网络连接失败，请检查连接后重试。', true);
  } finally {
    clearTimeout(timeout);
    generate.disabled = false;
    generate.textContent = '生成临时链接 ↗';
    form.setAttribute('aria-busy', 'false');
  }
});

copyLink.addEventListener('click', async () => {
  if (expired) return;
  try {
    await navigator.clipboard.writeText(latestUrl);
    copyLink.textContent = '已复制';
    setTimeout(() => { copyLink.textContent = '复制链接'; }, 2500);
  } catch {
    urlInput.focus(); urlInput.select();
    resultNote.textContent = '无法自动复制。链接已选中，请使用系统复制快捷键。';
  }
});


const menuButton = document.getElementById('menu-button');
const mobileMenu = document.getElementById('mobile-menu');
function closeMenu() { mobileMenu.hidden = true; menuButton.setAttribute('aria-expanded', 'false'); menuButton.setAttribute('aria-label', '展开导航'); }
menuButton.addEventListener('click', () => { const open = mobileMenu.hidden; mobileMenu.hidden = !open; menuButton.setAttribute('aria-expanded', String(open)); menuButton.setAttribute('aria-label', open ? '收起导航' : '展开导航'); });
mobileMenu.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !mobileMenu.hidden) { closeMenu(); menuButton.focus(); } });
document.addEventListener('click', event => { if (!event.target.closest('.site-header')) closeMenu(); });
updateEditor();

const siteHeader = document.querySelector('.site-header');
function updateHeaderSurface() {
  siteHeader.classList.toggle('is-scrolled', window.scrollY > 16);
}
window.addEventListener('scroll', updateHeaderSurface, { passive: true });
window.addEventListener('pageshow', updateHeaderSurface);
updateHeaderSurface();
