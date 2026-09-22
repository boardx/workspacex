/**
 * main.js — wiring.
 *
 * The page arrives in its final language (each one is its own prerendered
 * URL), so boot is just: draw the diagrams, then attach scroll behaviour.
 */
import { pageLang, initLangHint } from './lang.js';
import {
  initReveals, initNav, initScene, splitWords, reducedMotion,
  initOffscreenPause, initHeroParallax, initReadingProgress,
} from './motion.js';
import { renderDiagrams, getLoop, watchBreakpoint, syncDiagramScales } from './diagrams.js';
import { initSurface } from './surface.js';
import { initCompare } from './compare.js';

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
};

/* -------------------------------------------------------------------------
   The loop scene: scroll drives the ring, and the ring drives the rail
   ------------------------------------------------------------------------- */
let detachScene = null;

function wireLoopScene() {
  detachScene?.();

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
    li.addEventListener('click', () => {
      if (!track || reducedMotion() || window.matchMedia('(max-width: 860px)').matches) {
        select(i);
        return;
      }
      const rect = track.getBoundingClientRect();
      const scrollable = rect.height - window.innerHeight;
      const target = window.scrollY + rect.top + scrollable * ((i + 0.5) / items.length);
      window.scrollTo({ top: target, behavior: 'smooth' });
    });
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
