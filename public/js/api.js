// API 请求封装：统一 fetch 封装，带鉴权 header 和错误处理

const API_BASE = '';

async function api(path, opts = {}) {
  const url = API_BASE + path;
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  const { timeoutMs, ...requestOpts } = opts;
  if (opts.body && typeof opts.body !== 'string' && !(opts.body instanceof FormData)) requestOpts.body = JSON.stringify(opts.body);
  const controller = timeoutMs > 0 ? new AbortController() : null;
  let timedOut = false;
  const abort = () => controller.abort(opts.signal?.reason);
  if (controller) {
    requestOpts.signal = controller.signal;
    if (opts.signal?.aborted) abort();
    else opts.signal?.addEventListener('abort', abort, { once: true });
  }
  const timer = controller ? setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs) : null;
  try {
    const res = await fetch(url, { ...requestOpts, headers, credentials: 'same-origin' });
    if (res.status === 204) return null;
    const data = await res.json().catch(e => {
      if (requestOpts.signal?.aborted) throw e;
      return {};
    });
    if (!res.ok) {
      const err = new Error(data.error || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  } catch (e) {
    if (timedOut) throw new Error('请求超时，请重试', { cause: e });
    throw e;
  } finally {
    clearTimeout(timer);
    if (controller) opts.signal?.removeEventListener('abort', abort);
  }
}

export { API_BASE, api };
