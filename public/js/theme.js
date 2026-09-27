const STORAGE_KEY = 'magpie-theme';

function getSystemPreference() {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function getStoredTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function getCurrentTheme() {
  return getStoredTheme() || getSystemPreference();
}

function applyTheme(theme) {
  document.documentElement.classList.toggle('light', theme === 'light');
}

function toggleTheme() {
  const current = getCurrentTheme();
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem(STORAGE_KEY, next); } catch {}
}

function initTheme() {
  applyTheme(getCurrentTheme());

  document.querySelectorAll('.theme-toggle').forEach(btn => {
    btn.addEventListener('click', toggleTheme);
  });
}

function applyPageTheme(isNeo) {
  document.documentElement.classList.toggle('neo-app', isNeo);
  applyTheme(isNeo ? 'light' : getCurrentTheme());
}

function setupThemeToggle(container) {
  if (document.documentElement.classList.contains('neo-app')) return;
  container.querySelectorAll('.theme-toggle').forEach(btn => {
    btn.addEventListener('click', toggleTheme);
  });
}

export { initTheme, setupThemeToggle, toggleTheme, applyPageTheme };
