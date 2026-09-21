/**
 * main.js — wiring.
 *
 * Order matters: capture the English DOM before anything rewrites it, then
 * language, then diagrams (which read the language), then scroll behaviour.
 */
import { initI18n } from './i18n.js';
import { initReveals, initNav, initScene, splitWords, reducedMotion } from './motion.js';
import { renderDiagrams, getLoop, watchBreakpoint, syncDiagramScales } from './diagrams.js';
import { initSurface } from './surface.js';

const boot = () => {
  const i18n = initI18n();

  renderDiagrams(i18n.current);
  splitWords(document.querySelector('[data-split]'));

  initNav();
  initReveals();
  initSurface();
  watchBreakpoint(() => { renderDiagrams(i18n.current); wireLoopScene(); });

  // Diagram label sizes are derived from each svg's rendered width, so they
  // have to be recomputed whenever that width can change.
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(syncDiagramScales, 120);
  }, { passive: true });
  wireLoopScene();

  // Language changes rewrite text nodes, so anything JS generated from copy
  // has to be rebuilt — diagrams and the split headline both are.
  document.addEventListener('langchange', (e) => {
    renderDiagrams(e.detail.lang);
    splitWords(document.querySelector('[data-split]'));
    wireLoopScene();
  });
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
