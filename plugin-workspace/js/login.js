// 页舟PageSail uTools 插件 · 登录/设置逻辑

window.Login = (function () {
  const els = {};

  function cacheEls() {
    els.view = document.getElementById('login-view');
    els.serverUrl = document.getElementById('server-url');
    els.account = document.getElementById('account');
    els.password = document.getElementById('password');
    els.btnLogin = document.getElementById('btn-login');
    els.errorBox = document.getElementById('login-error');
    els.subtitle = document.getElementById('login-subtitle');
    els.linkTest = document.getElementById('link-test');
    els.linkClear = document.getElementById('link-clear');
  }

  function showError(msg) {
    if (!els.errorBox) return;
    els.errorBox.textContent = msg;
    els.errorBox.classList.add('show');
  }
  function clearError() {
    els.errorBox.classList.remove('show');
  }

  /** 回填已保存的服务器地址与账号 */
  function prefill() {
    if (!window.pagesail) {
      // preload 未注入：不白屏，给出明确提示
      showError('插件初始化失败：preload 未加载。请重启插件或在开发者工具中检查 preload.js。');
      els.btnLogin.disabled = true;
      return;
    }
    const cfg = window.pagesail.getConfig();
    els.serverUrl.value = cfg.base || 'http://localhost:8858';
    if (cfg.account) els.account.value = cfg.account;
    if (cfg.user) {
      els.subtitle.textContent = `当前账户：${cfg.user.username}（会话已保存，直接登录或重连）`;
    }
  }

  async function handleLogin() {
    clearError();
    const url = els.serverUrl.value.trim();
    const account = els.account.value.trim();
    const password = els.password.value;

    if (!url) return showError('请填写服务器地址');
    if (!account) return showError('请输入账号');
    if (!password) return showError('请输入密码');

    els.btnLogin.disabled = true;
    els.btnLogin.textContent = '登录中…';

    try {
      // 1. 保存并校验服务器地址
      window.pagesail.setBase(url);

      // 2. ping 一下，确认地址可达且是页舟PageSail
      try {
        await window.pagesail.ping();
      } catch (e) {
        // ping 失败仍尝试登录，有些部署可能关了 /health，但给出提示
        console.warn('ping 失败：', e.message);
      }

      // 3. 登录
      const user = await window.pagesail.login({ account, password });
      PS.toast('✅ 登录成功，欢迎 ' + user.username);
      els.password.value = '';
      // 触发主界面加载
      document.dispatchEvent(new CustomEvent('pagesail:logged-in', { detail: user }));
    } catch (err) {
      showError(err.message || '登录失败');
    } finally {
      els.btnLogin.disabled = false;
      els.btnLogin.textContent = '登录';
    }
  }

  async function handleTest() {
    clearError();
    const url = els.serverUrl.value.trim();
    if (!url) return showError('请先填写服务器地址');
    els.linkTest.textContent = '测试中…';
    try {
      const health = await window.pagesail.ping(url);
      PS.toast('✅ 连接成功 · 页舟PageSail v' + (health.version || '?'));
    } catch (err) {
      showError('连接失败：' + err.message);
    } finally {
      els.linkTest.textContent = '测试服务器连接';
    }
  }

  function handleClear() {
    clearError();
    if (!confirm('确定要清空本地缓存吗？\n将清除服务器地址、账号和登录状态。')) return;
    try {
      window.pagesail.clearCache();
      els.serverUrl.value = 'http://localhost:8858';
      els.account.value = '';
      els.password.value = '';
      els.subtitle.textContent = '登录你的页舟PageSail账户';
      PS.toast('✅ 已清空本地缓存');
    } catch (err) {
      showError(err.message || '清空失败');
    }
  }

  function show() {
    const main = document.getElementById('main-view');
    main.classList.add('hidden');
    main.style.display = 'none'; // 与 hide() 对称：显式控制 display
    els.view.style.display = 'flex';
    prefill();
    setTimeout(() => els.serverUrl.focus(), 50);
  }

  function hide() {
    els.view.style.display = 'none';
    // 不能只 remove('hidden')：#main-view 自身有 display:none（ID 选择器），
    // 必须 inline 覆盖为 flex，否则两个视图都不可见 = 白屏。
    const main = document.getElementById('main-view');
    main.classList.remove('hidden');
    main.style.display = 'flex';
  }

  function init() {
    cacheEls();
    prefill();
    els.btnLogin.addEventListener('click', handleLogin);
    els.linkTest.addEventListener('click', handleTest);
    els.linkClear.addEventListener('click', handleClear);
    // 回车登录
    [els.serverUrl, els.account, els.password].forEach((el) =>
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleLogin();
      })
    );
  }

  return { init, show, hide };
})();
