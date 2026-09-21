/**
 * motion.js — scroll behaviour: reveals, nav state, scrollspy, sticky scenes.
 *
 * Everything here degrades to "content is simply visible". If the browser has
 * no IntersectionObserver, or the user asked for reduced motion, elements are
 * marked in immediately and no scroll listener is installed at all.
 */

export const reducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* -------------------------------------------------------------------------
   Reveals
   ------------------------------------------------------------------------- */
export function initReveals() {
  const targets = document.querySelectorAll('[data-reveal], [data-stagger]');

  if (reducedMotion() || !('IntersectionObserver' in window)) {
    targets.forEach((el) => el.classList.add('is-in'));
    return;
  }

  // Index staggered children so CSS can delay each one.
  document.querySelectorAll('[data-stagger]').forEach((group) => {
    [...group.children].forEach((child, i) => child.style.setProperty('--i', i));
  });

  // Anything already on screen at first paint must not wait for a scroll event
  // that may never come (short viewport, deep link, restored scroll position).
  const onscreenNow = (el) => {
    const r = el.getBoundingClientRect();
    return r.top < window.innerHeight * 1.1 && r.bottom > 0;
  };

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        el.classList.add('is-in');
        // Promote only for the duration of the transition, then release the
        // layer — a long page with 40 permanently promoted elements stutters.
        el.style.willChange = 'opacity, transform';
        setTimeout(() => { el.style.willChange = ''; }, 1200);
        io.unobserve(el);
      });
    },
    // Trigger as soon as any sliver enters, with a generous bottom margin, so a
    // fast scroller never outruns the reveal and lands on a blank section.
    { rootMargin: '0px 0px -4% 0px', threshold: 0 },
  );

  targets.forEach((el) => {
    if (onscreenNow(el)) { el.classList.add('is-in'); return; }
    io.observe(el);
  });

  // `.scales` animates its own connecting thread on entry.
  const scales = document.querySelector('.scales');
  if (scales) {
    const io2 = new IntersectionObserver(
      (e) => e.forEach((x) => { if (x.isIntersecting) { x.target.classList.add('is-in'); io2.unobserve(x.target); } }),
      { threshold: 0.25 },
    );
    io2.observe(scales);
  }
}

/* -------------------------------------------------------------------------
   Nav: solid background once scrolled, plus scrollspy
   ------------------------------------------------------------------------- */
export function initNav() {
  const nav = document.getElementById('nav');
  const burger = document.getElementById('burger');
  const links = document.getElementById('navlinks');
  if (!nav) return;

  // --- stuck state (sentinel beats a scroll listener: no work per frame) ---
  const sentinel = document.createElement('div');
  sentinel.style.cssText = 'position:absolute;top:0;height:1px;width:1px;';
  document.body.prepend(sentinel);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(
      ([e]) => nav.setAttribute('data-stuck', String(!e.isIntersecting)),
      { threshold: 0 },
    ).observe(sentinel);
  }

  /* --- narrow bar: relocate the secondary actions into the menu panel ---
     At 390 px the brand, language switch, GitHub link, primary CTA and the
     burger do not fit on one row; the burger was pushed off-screen entirely,
     leaving the menu unreachable. Rather than shrink everything past the touch
     target minimum, move what does not have to be in the bar into the panel. */
  const panel = document.getElementById('nav-panel-actions');
  const movable = [...document.querySelectorAll('[data-mobile-move]')];
  const homes = new Map(movable.map((n) => [n, { parent: n.parentNode, next: n.nextSibling }]));
  const narrow = window.matchMedia('(max-width: 760px)');
  const placeActions = () => {
    if (!panel) return;
    if (narrow.matches) {
      movable.forEach((n) => panel.append(n));
    } else {
      movable.forEach((n) => {
        const home = homes.get(n);
        home.parent.insertBefore(n, home.next);
      });
    }
  };
  placeActions();
  narrow.addEventListener('change', placeActions);

  // --- mobile menu ---
  if (burger && links) {
    const close = () => {
      burger.setAttribute('aria-expanded', 'false');
      links.removeAttribute('data-open');
    };
    burger.addEventListener('click', () => {
      const open = burger.getAttribute('aria-expanded') === 'true';
      burger.setAttribute('aria-expanded', String(!open));
      if (open) links.removeAttribute('data-open');
      else links.setAttribute('data-open', 'true');
    });
    links.addEventListener('click', (e) => { if (e.target.closest('a')) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }

  // --- scrollspy ---
  const anchors = [...document.querySelectorAll('.nav__link')];
  const sections = anchors
    .map((a) => document.querySelector(a.getAttribute('href')))
    .filter(Boolean);
  if (!sections.length || !('IntersectionObserver' in window)) return;

  const visible = new Map();
  const spy = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => visible.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0));
      // Whichever tracked section owns the most of the viewport wins.
      let best = null; let bestRatio = 0;
      visible.forEach((ratio, id) => { if (ratio > bestRatio) { bestRatio = ratio; best = id; } });
      anchors.forEach((a) => {
        const on = best !== null && a.getAttribute('href') === `#${best}`;
        if (on) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      });
    },
    { threshold: [0, 0.15, 0.35, 0.6, 0.9], rootMargin: '-15% 0px -45% 0px' },
  );
  sections.forEach((s) => spy.observe(s));
}

/* -------------------------------------------------------------------------
   Sticky scene: writes a 0→1 progress value while the pin is on screen
   ------------------------------------------------------------------------- */
export function initScene(selector, onProgress) {
  const scene = document.querySelector(selector);
  if (!scene) return () => {};

  const track = scene.querySelector('.scene__track');
  const small = () => window.matchMedia('(max-width: 860px)').matches;

  if (reducedMotion() || !track) {
    onProgress(1, true);
    return () => {};
  }

  let ticking = false;
  const measure = () => {
    if (small()) { onProgress(1, true); return; }
    const rect = track.getBoundingClientRect();
    const pinHeight = window.innerHeight;
    const scrollable = rect.height - pinHeight;
    if (scrollable <= 0) { onProgress(1, false); return; }
    const p = Math.min(1, Math.max(0, -rect.top / scrollable));
    onProgress(p, false);
  };

  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { measure(); ticking = false; });
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  measure();

  return () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
  };
}

/* -------------------------------------------------------------------------
   Hero headline: split into words so they can rise in sequence
   ------------------------------------------------------------------------- */
export function splitWords(el) {
  if (!el) return;
  const text = el.textContent.trim();
  // CJK has no spaces; splitting on whitespace would yield one giant "word".
  // Per-character rise reads as a typewriter and is worse — so CJK rises whole.
  const cjk = /[一-鿿　-〿]/.test(text);
  const parts = cjk ? [text] : text.split(/\s+/);
  el.innerHTML = parts
    .map((w, i) => `<span class="word" style="--i:${i}">${w}</span>`)
    .join(' ');
}
