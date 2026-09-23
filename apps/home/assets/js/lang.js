/**
 * lang.js — language is a property of the page, not runtime state.
 *
 * Each language is its own URL (`/` and `/zh/`), prerendered by
 * `scripts/build-i18n.mjs`. There is nothing to swap at runtime: this module
 * only reports which page you are on, and offers the other one to a visitor
 * whose browser suggests they would prefer it.
 */
const DISMISSED = 'wsx.langhint.dismissed';

export const pageLang = () =>
  (document.documentElement.lang.toLowerCase().startsWith('zh') ? 'zh' : 'en');

const HINT = {
  // Shown on the English page to a browser that prefers Chinese, and vice
  // versa. Each string is written in the language being offered.
  zh: { text: '本页也有中文版。', action: '切换到中文', href: '/zh/' },
  en: { text: 'This page is also available in English.', action: 'Switch to English', href: '/' },
};

export function initLangHint() {
  const current = pageLang();
  const prefers = navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  if (prefers === current) return;

  try { if (localStorage.getItem(DISMISSED) === '1') return; } catch { /* private mode */ }

  const copy = HINT[prefers];
  const bar = document.createElement('div');
  bar.className = 'langhint';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', copy.action);
  bar.lang = prefers === 'zh' ? 'zh-Hans' : 'en';
  bar.innerHTML = `
    <span class="langhint__text"></span>
    <a class="langhint__go"></a>
    <button class="langhint__close" type="button"></button>`;
  bar.querySelector('.langhint__text').textContent = copy.text;
  const go = bar.querySelector('.langhint__go');
  go.textContent = copy.action;
  /* Same section, other language: the switch in the nav already carries the
     fragment (motion.js keeps it current), so borrow it. */
  go.dataset.base = copy.href;
  go.href = document.querySelector('.langswitch__btn:not([aria-current="true"])')?.getAttribute('href') || copy.href;

  const close = bar.querySelector('.langhint__close');
  close.setAttribute('aria-label', prefers === 'zh' ? '关闭' : 'Dismiss');
  close.textContent = '×';
  close.addEventListener('click', () => {
    bar.remove();
    try { localStorage.setItem(DISMISSED, '1'); } catch { /* private mode */ }
  });

  document.body.append(bar);
  requestAnimationFrame(() => bar.classList.add('is-in'));
}
