/**
 * main.js — wiring.
 *
 * The page arrives in its final language (each one is its own prerendered
 * URL), so boot is just: draw the diagrams, then attach scroll behaviour.
 */
import { bp } from './mq.js';
import { pageLang, initLangHint } from './lang.js';
import {
  initReveals, initNav, initScene, splitWords, reducedMotion,
  initOffscreenPause, initHeroParallax, initReadingProgress,
} from './motion.js';
import { renderDiagrams, getLoop, watchBreakpoint, syncDiagramScales } from './diagrams.js';
import { initSurface } from './surface.js';
import { initCompare } from './compare.js';
import { initCases } from './cases.js';

/* Marks the document as script-capable. Read by the reveal failsafe in
   motion.css: if this never executes, the page reveals itself anyway. */
document.documentElement.classList.add('js');

/* One broken step must not take the rest of the page with it. Measured: with
   diagrams.js blocked, zero reveals ran and the page stayed blank, because a
   failure anywhere in the module aborted all of boot. */
const step = (label, fn) => {
  try { fn(); } catch (error) { console.error(`[home] ${label} failed:`, error); }
};

const boot = () => {
  step('diagrams', () => renderDiagrams(pageLang()));
  step('headline', () => splitWords(document.querySelector('[data-split]')));

  // Reveals first: if anything below throws, the content is already visible.
  step('reveals', initReveals);
  step('nav', initNav);
  step('surface', initSurface);
  step('compare', initCompare);
  step('cases', initCases);
  step('offscreen pause', initOffscreenPause);
  step('hero parallax', initHeroParallax);
  step('reading progress', initReadingProgress);
  step('breakpoint', () => watchBreakpoint(() => {
    step('diagrams', () => renderDiagrams());
    step('loop scene', wireLoopScene);
  }));

  // Diagram label sizes are derived from each svg's rendered width, so they
  // have to be recomputed whenever that width can change.
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(syncDiagramScales, 120);
  }, { passive: true });
  step('loop scene', wireLoopScene);
  step('language hint', initLangHint);
  step('demo', armDemo);
};

/* -------------------------------------------------------------------------
   The scripted demo, loaded on the reader's first move
   -------------------------------------------------------------------------
   It sits just below the hero, so "when it nears the viewport" alone would
   fetch it during the first load on any screen taller than the hero — which
   is most desktops — and every visitor would pay for it whether they looked
   or not. So nothing is fetched until the reader does something (scrolls,
   taps, presses a key), and from then on the module is fetched a screen
   before the section arrives.

   Fetching is not mounting. The live demo is several hundred pixels taller
   than its placeholder, and the first version mounted it the moment it came
   near — including in the middle of a smooth scroll passing THROUGH it, from
   a nav link or a /#panel-edu landing. Everything below grew mid-flight and
   the scroll arrived hundreds of pixels short (the eval's deep-link and
   current-section cases caught it). So it is swapped in only once scrolling
   has stopped with the section on screen: the reader is looking at it, and
   nothing they were heading for moves.

   `import()` is left alone by build-js, so this resolves to assets/js/demo.js
   beside the bundle. */
function armDemo() {
  const host = document.querySelector('[data-demo]');
  if (!host) return;
  const EVENTS = ['scroll', 'pointerdown', 'keydown', 'touchstart'];
  let mod = null; let fetching = false; let done = false; let idle = 0;

  const onScreen = () => {
    const r = host.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight;
  };
  const tryMount = () => {
    if (done || !mod || !onScreen()) return;
    done = true;
    window.removeEventListener('scroll', onScroll);
    mod.initDemo(host);
  };
  const onScroll = () => { clearTimeout(idle); idle = setTimeout(tryMount, 160); };
  const fetchIt = () => {
    if (fetching) return;
    fetching = true;
    import('./demo.js')
      .then((m) => { mod = m; onScroll(); })
      .catch((error) => console.error('[home] demo failed:', error));
  };
  const arm = () => {
    EVENTS.forEach((e) => window.removeEventListener(e, arm));
    window.addEventListener('scroll', onScroll, { passive: true });
    if (!('IntersectionObserver' in window)) { fetchIt(); return; }
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      fetchIt();
    }, { rootMargin: '0px 0px 100% 0px' });
    io.observe(host);
  };
  EVENTS.forEach((e) => window.addEventListener(e, arm, { passive: true }));
  /* /#demo-workforce names a scenario, not an element, so the browser has
     nothing to scroll to. Go to the section; the scroll arms the loader, and
     demo.js reads the fragment when it mounts. */
  if (/^#demo-/.test(location.hash)) document.getElementById('demo')?.scrollIntoView({ block: 'start' });
}

/* -------------------------------------------------------------------------
   The loop scene: scroll drives the ring, and the ring drives the rail
   ------------------------------------------------------------------------- */
let detachScene = null;
let sceneOff = [];

function wireLoopScene() {
  detachScene?.();
  /* The rail is static markup — unlike the diagrams, it is not rebuilt — so
     every re-wire added a second click handler to the same six items and
     never removed the first. Measured: six handlers at boot, forty-two after
     three breakpoint crossings, and one click on a step firing seven smooth
     scrolls to the same place. detachScene released the scene's own window
     listeners and knew nothing about these. */
  sceneOff.forEach((off) => off());
  sceneOff = [];

  const rail = document.getElementById('loop-rail');
  const items = rail ? [...rail.querySelectorAll('.rail__item')] : [];
  const ring = getLoop();
  if (!ring) return;

  const select = (idx) => {
    items.forEach((li, i) => li.setAttribute('aria-current', String(i === idx)));
  };

  // Clicking a step scrolls to the matching point in the track — the rail is a
  // control, not just a readout. Without this the pinned section feels locked.
  const scene = document.querySelector('[data-scene="loop"]');
  const track = scene?.querySelector('.scene__track');
  items.forEach((li, i) => {
    /* Kept as explicit removers rather than an AbortSignal: `signal` in
       addEventListener options is Safari 15, and check-compat.mjs shows this
       page still carries fallbacks for Safari 14. One new baseline assumption
       is not worth four lines. */
    const onClick = () => {
      if (!track || reducedMotion() || window.matchMedia(bp('scene')).matches) {
        select(i);
        return;
      }
      const rect = track.getBoundingClientRect();
      const scrollable = rect.height - window.innerHeight;
      const target = window.scrollY + rect.top + scrollable * ((i + 0.5) / items.length);
      window.scrollTo({ top: target, behavior: 'smooth' });
    };
    li.addEventListener('click', onClick);
    sceneOff.push(() => li.removeEventListener('click', onClick));
  });

  detachScene = initScene('[data-scene="loop"]', (p, stacked) => {
    const idx = ring.render(stacked ? 1 : p);
    if (!stacked) select(idx);
    else items.forEach((li) => li.removeAttribute('aria-current'));
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
