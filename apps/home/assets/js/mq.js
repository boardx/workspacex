/**
 * mq.js — media-query listening that works on the engines people actually run.
 *
 * `MediaQueryList.addEventListener` only arrived in Safari 14 (2020). On older
 * WebKit — which includes every iOS device stuck below iOS 14 — the call throws
 * a TypeError, and because these listeners are attached during boot, that
 * exception used to take the rest of the page's behaviour with it.
 */
export function onMediaChange(query, handler) {
  const mql = typeof query === 'string' ? window.matchMedia(query) : query;
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }
  // Deprecated, but it is the only thing older WebKit has.
  mql.addListener(handler);
  return () => mql.removeListener(handler);
}

/**
 * The breakpoints live in base.css as --bp-* and are read from there, because
 * a number that governs both a stylesheet and a script has to be written once
 * or the two drift — which is exactly what happened when the queries moved to
 * rem and these stayed in px.
 */
export const bp = (name) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--bp-${name}`).trim();
  return `(max-width: ${v || '48rem'})`;
};
