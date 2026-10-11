// 分级 CSP（内容安全策略）策略。
//
// 设计：管理界面与用户内容渲染页用不同策略，平衡安全与功能：
//   - 管理界面（app.js / index.html）：严格策略，只放行同源 + 内联 style（前端大量用 inline style）。
//   - Markdown 渲染页：只放行仓库模板脚本的哈希，使用响应头 sandbox 隔离来源。
//   - HTML 渲染页（用户原始 HTML，常含合法 script/外链）：宽松脚本策略 + 响应头 sandbox。
//
// 仓库模板内联脚本按 SHA-256 放行；用户 Markdown 中的脚本不授予 nonce。

const crypto = require('crypto');

// 管理界面：无内联 script（仅一个外链 module + 外链 css），style 需要 unsafe-inline（前端海量 inline style）。
const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

// 管理界面（带 nonce）：为服务端注入的少量内联脚本（如 ICP 备案号配置）放行。
function appCsp(nonce) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

// Markdown 渲染页：仓库内联脚本按哈希放行，vendor 资源同源。
// frame-ancestors 'self'：允许同源 iframe 嵌入（文件列表卡片缩略图），外站不可嵌入。
function markdownCsp(nonce, trustedHashes = []) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' ${[...trustedHashes].join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'self'",
    "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads",
    "object-src 'none'",
  ].join('; ');
}

// HTML 渲染页：用户 HTML 常含合法 script/外链资源，宽松策略 + 响应头 sandbox 兜底。
// 放开 https: 让用户的图表库/CDN/图片能加载；sandbox 去掉 allow-same-origin 阻断对父窗口的访问。
// frame-ancestors 'self'：允许同源 iframe 嵌入（文件列表卡片缩略图），外站不可嵌入。
const HTML_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https:",
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' data: blob: https:",
  "font-src 'self' https: data:",
  "connect-src 'self' https:",
  "frame-ancestors 'self'",
  "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads",
  "object-src 'none'",
].join('; ');

// 渲染端点的 X-Frame-Options 取值（与 CSP frame-ancestors 'self' 对齐，兜底不支持 CSP 的旧浏览器）。
const RENDER_FRAME_VALUE = 'SAMEORIGIN';

// 判断请求路径是否为用户内容渲染端点（这些端点由路由内自行 setHeader，中间件跳过）。
function isRenderPath(reqPath) {
  return /^\/api\/files\/\d+\/(render|versions\/\d+\/(render|asset\/)|asset\/|bundle-resource\/)/.test(reqPath) || /^\/s\//.test(reqPath) || /^\/t\//.test(reqPath);
}

// 生成 nonce（base64，128bit）
function generateNonce() {
  return crypto.randomBytes(16).toString('base64');
}

module.exports = {
  APP_CSP,
  HTML_CSP,
  appCsp,
  markdownCsp,
  isRenderPath,
  generateNonce,
  RENDER_FRAME_VALUE,
};
