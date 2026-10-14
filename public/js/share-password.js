// Progressive enhancement only: password verification remains a native form POST.
const form = document.querySelector('#share-password-form');
const input = document.querySelector('#share-password');
const toggle = document.querySelector('.share-password-toggle');
const submit = document.querySelector('.share-submit');

if (form && input && toggle && submit) {
  toggle.hidden = false;
  toggle.addEventListener('click', () => {
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    toggle.setAttribute('aria-label', visible ? '隐藏密码' : '显示密码');
    toggle.setAttribute('aria-pressed', String(visible));
    toggle.querySelector('img').src = `/css/share-password/icons/${visible ? 'eye-slash-fill' : 'eye-fill'}.svg`;
    input.focus();
  });

  input.addEventListener('input', () => {
    input.removeAttribute('aria-invalid');
  });

  form.addEventListener('submit', () => {
    submit.disabled = true;
    submit.querySelector('span').textContent = '正在验证…';
    form.setAttribute('aria-busy', 'true');
  });

  // Restore controls when returning via browser history, including the back/forward cache.
  window.addEventListener('pageshow', () => {
    submit.disabled = false;
    submit.querySelector('span').textContent = '查看内容';
    form.removeAttribute('aria-busy');
  });
}
