/**
 * motion.js — scroll behaviour: reveals, nav state, scrollspy, sticky scenes.
 *
 * Everything here degrades to "content is simply visible". If the browser has
 * no IntersectionObserver, or the user asked for reduced motion, elements are
 * marked in immediately and no scroll listener is installed at all.
 */

import { onMediaChange, bp } from './mq.js';

export const reducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* -------------------------------------------------------------------------
   Reveals
   ------------------------------------------------------------------------- */
export function initReveals() {
  const targets = document.querySelectorAll('[data-reveal], [data-stagger]');

  // `.scales` draws its connecting thread off `.is-in` too, and it is not a
  // [data-reveal] target — marking it here keeps the thread from being lost
  // on the reduced-motion and no-IntersectionObserver paths.
  const scales = document.querySelector('.scales');

  if (reducedMotion() || !('IntersectionObserver' in window)) {
    targets.forEach((el) => el.classList.add('is-in'));
    scales?.classList.add('is-in');
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

  if (scales) {
    const io2 = new IntersectionObserver(
      (e) => e.forEach((x) => { if (x.isIntersecting) { x.target.classList.add('is-in'); io2.unobserve(x.target); } }),
      /* 0, like every other observer here. A threshold of 0.25 cannot be met
         by an element taller than the viewport — `.scales` is 658 px against
         a 360 px landscape phone — so the connecting thread was one layout
         change away from never being drawn, with nothing to say so. */
      { threshold: 0 },
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
  const narrow = window.matchMedia(bp('stack'));
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
  onMediaChange(narrow, placeActions);

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
  const small = () => window.matchMedia(bp('scene')).matches;

  if (reducedMotion() || !track) {
    onProgress(1, true);
    return () => {};
  }

  /* A scene driven 1:1 by scrollTop tracks a trackpad's jitter and reads as
     mechanical. Easing the rendered value toward the scroll value each frame
     — the damping every well-made pinned section uses — costs one rAF loop
     while the scene is on screen and makes the difference between "attached
     to the scrollbar" and "following you". */
  const DAMPING = 0.14;
  let target = 0;
  let value = 0;
  let raf = 0;
  let running = false;

  const readTarget = () => {
    const rect = track.getBoundingClientRect();
    const scrollable = rect.height - window.innerHeight;
    if (scrollable <= 0) return 1;
    return Math.min(1, Math.max(0, -rect.top / scrollable));
  };

  const frame = () => {
    const delta = target - value;
    value += delta * DAMPING;
    // snap once the remaining distance is below a pixel's worth of progress
    if (Math.abs(delta) < 0.0004) { value = target; running = false; }
    onProgress(value, false);
    raf = running ? requestAnimationFrame(frame) : 0;
  };

  const start = () => {
    if (running) return;
    running = true;
    raf = requestAnimationFrame(frame);
  };

  const onScroll = () => {
    if (small()) { onProgress(1, true); return; }
    target = readTarget();
    start();
  };

  // The loop only runs while the scene is anywhere near the viewport; off
  // screen there is nothing to animate and no reason to burn frames.
  let near = true;
  if ('IntersectionObserver' in window) {
    near = false;
    new IntersectionObserver(
      ([e]) => { near = e.isIntersecting; if (near) onScroll(); },
      { rootMargin: '200px 0px' },
    ).observe(track);
  }

  const onScrollGuarded = () => { if (near) onScroll(); };

  window.addEventListener('scroll', onScrollGuarded, { passive: true });
  window.addEventListener('resize', onScrollGuarded, { passive: true });
  target = readTarget();
  value = target;
  onProgress(value, small());

  return () => {
    cancelAnimationFrame(raf);
    running = false;
    window.removeEventListener('scroll', onScrollGuarded);
    window.removeEventListener('resize', onScrollGuarded);
  };
}

/* -------------------------------------------------------------------------
   Pause looping animations while their section is off screen
   ------------------------------------------------------------------------- */
/* The aurora, the context-loss particles and the live pip all animate forever.
   Off screen they still composite every frame, on a page this tall, on a
   phone, on a battery. Toggling a class lets CSS stop them. */
export function initOffscreenPause() {
  if (!('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver(
    (entries) => entries.forEach((e) => {
      e.target.classList.toggle('is-offscreen', !e.isIntersecting);
    }),
    { rootMargin: '120px 0px' },
  );
  document.querySelectorAll('[data-animates]').forEach((el) => io.observe(el));
}

/* -------------------------------------------------------------------------
   Reading progress
   ------------------------------------------------------------------------- */
export function initReadingProgress() {
  const bar = document.querySelector('.nav__progress i');
  if (!bar) return;

  let raf = 0;
  const update = () => {
    raf = 0;
    const doc = document.documentElement;
    const scrollable = doc.scrollHeight - window.innerHeight;
    const p = scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 0;
    bar.style.setProperty('--read', p.toFixed(4));
  };
  window.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(update); }, { passive: true });
  window.addEventListener('resize', () => { if (!raf) raf = requestAnimationFrame(update); }, { passive: true });
  update();
}

/* -------------------------------------------------------------------------
   Hero parallax — the aurora drifts slower than the page
   ------------------------------------------------------------------------- */
export function initHeroParallax() {
  const hero = document.querySelector('.hero');
  const aurora = hero?.querySelector('.hero__aurora');
  const inner = hero?.querySelector('.hero__inner');
  if (!hero || !aurora || reducedMotion()) return;

  let raf = 0;
  const apply = () => {
    raf = 0;
    const y = window.scrollY;
    if (y > window.innerHeight * 1.2) return;    // past the hero: nothing to do
    aurora.style.transform = `translate3d(0, ${y * 0.22}px, 0)`;
    inner.style.transform = `translate3d(0, ${y * 0.07}px, 0)`;
    inner.style.opacity = String(Math.max(0, 1 - y / (window.innerHeight * 0.85)));
  };
  window.addEventListener('scroll', () => {
    if (!raf) raf = requestAnimationFrame(apply);
  }, { passive: true });
  apply();
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
