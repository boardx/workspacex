/**
 * i18n.js — language switching.
 *
 * Contract:
 *  - English is the DOM's ground truth: it is authored inline in index.html, so
 *    the page renders complete with JS disabled and crawlers index real copy.
 *  - Switching to Chinese swaps textContent per `data-i18n` key; switching back
 *    restores the English captured at boot. No second copy of the English text
 *    exists anywhere — that is deliberate, and `check-i18n.mjs` enforces it.
 */
import zh from './zh.js';

const DICTS = { zh };
const STORAGE_KEY = 'wsx.lang';
const SUPPORTED = ['en', 'zh'];

/** Original English, captured once before any swap can corrupt it. */
const english = new Map();

function captureEnglish() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    english.set(el, { text: el.textContent });
  });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => {
    english.set(el, { html: el.innerHTML });
  });
}

function apply(lang) {
  const dict = DICTS[lang];

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    if (!dict) {
      el.textContent = english.get(el)?.text ?? el.textContent;
      return;
    }
    const value = dict[key];
    // A missing key falls back to English rather than rendering the raw key.
    // Visible, honest, and caught by the build check long before this runs.
    if (value === undefined) {
      el.textContent = english.get(el)?.text ?? el.textContent;
      if (!apply.warned) console.warn('[i18n] missing key:', key);
      return;
    }
    el.textContent = value;
  });

  document.querySelectorAll('[data-i18n-html]').forEach((el) => {
    const key = el.dataset.i18nHtml;
    const value = dict?.[key];
    // Values come from our own source file, never from user input.
    el.innerHTML = value ?? english.get(el)?.html ?? el.innerHTML;
  });

  document.documentElement.lang = lang === 'zh' ? 'zh-Hans' : 'en';
  document.querySelectorAll('[data-lang]').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.lang === lang));
  });
  document.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
}

function preferred() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (SUPPORTED.includes(stored)) return stored;
  // `zh`, `zh-CN`, `zh-Hans-CN` … all mean Chinese here.
  return navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function initI18n() {
  captureEnglish();

  let current = 'en';
  const set = (lang) => {
    if (!SUPPORTED.includes(lang) || lang === current) return;
    current = lang;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* private mode */ }
    apply(lang);
  };

  document.querySelectorAll('[data-lang]').forEach((btn) => {
    btn.addEventListener('click', () => set(btn.dataset.lang));
  });

  const initial = preferred();
  if (initial !== 'en') set(initial);
  else apply('en');   // still syncs aria-pressed and fires langchange

  return { set, get current() { return current; } };
}
