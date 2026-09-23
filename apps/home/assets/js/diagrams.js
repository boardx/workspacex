/**
 * diagrams.js — the concept illustrations.
 *
 * Each diagram is a pure function of (container, lang) that writes SVG. They
 * re-render on `langchange` rather than trying to patch text nodes in place.
 * Animation is CSS where it can be, and rAF only where a value has to be
 * driven by scroll position.
 */
import STRINGS from './diagram-strings.js';
import { reducedMotion } from './motion.js';
import { pageLang } from './lang.js';
import { onMediaChange, bp } from './mq.js';

let LANG = pageLang();
const t = (key) => STRINGS[key]?.[LANG] ?? STRINGS[key]?.en ?? key;

/* A 1000-unit-wide viewBox squeezed into a 350 px phone renders its 13 px
   labels at about 4.5 px. Scaling down is not a responsive strategy for text,
   so the wide diagrams have genuine vertical variants instead. */
const NARROW_Q = bp('narrow');
const isNarrow = () => window.matchMedia(NARROW_Q).matches;

const NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}, text) => {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
};
const svg = (viewBox, extra = {}) =>
  el('svg', { viewBox, fill: 'none', 'aria-hidden': 'true', ...extra });

/* SVG text is drawn in viewBox units, so the browser scales it along with the
   drawing: a 13-unit label inside a 760-unit box rendered 660 px wide comes out
   at 8.3 px — measured, across every breakpoint including desktop. Sizing it in
   CSS pixels is not possible from inside the viewBox, so instead each svg
   publishes its own scale factor and the label rules multiply by it. The result
   is text at a real, chosen pixel size whatever the viewBox happens to be. */
const SCALED = new Set();

function syncScale(node) {
  const vb = node.viewBox?.baseVal;
  const width = node.getBoundingClientRect().width;
  if (!vb?.width || !width) return;
  node.style.setProperty('--dscale', String(vb.width / width));
}

export function syncDiagramScales() {
  SCALED.forEach((node) => {
    if (node.isConnected) syncScale(node);
    else SCALED.delete(node);
  });
}

function registerScale(node) {
  SCALED.add(node);
  // first pass now, again once fonts land and the container settles
  requestAnimationFrame(() => syncScale(node));
  document.fonts?.ready.then(() => syncScale(node));
}

/* Shared gradient/marker defs, injected once per svg that needs them. */
function defs(target, id = 'g1') {
  const d = el('defs');
  const lg = el('linearGradient', { id, x1: '0', y1: '0', x2: '1', y2: '0' });
  /* The stops read the palette tokens rather than restating the hex. The brand
     gradient used to be declared in four places — here, base.css, the inline
     sprite in each page, and the social card — which is the "same fact in two
     places" the repo's own rules forbid, and a palette change that misses one
     of them ships two brands on one page. */
  lg.append(
    el('stop', { offset: '0',    style: 'stop-color:var(--c-1)' }),
    el('stop', { offset: '0.52', style: 'stop-color:var(--c-2)' }),
    el('stop', { offset: '1',    style: 'stop-color:var(--c-3)' }),
  );
  d.append(lg);
  target.append(d);
  return id;
}

/* =========================================================================
   1 · Hero chain — five stages closing into a loop, with a pulse going round
   ========================================================================= */
function chainNarrow(host) {
  const items = ['context', 'agents', 'action', 'evidence', 'memory'];
  const W = 330, rowH = 62, H = items.length * rowH + 30;
  const s = svg(`0 0 ${W} ${H}`, { class: 'd-chain', preserveAspectRatio: 'xMidYMid meet' });
  defs(s);
  // the return arc swings out to x - 52, so x must leave that much room
  const x = 60;
  s.append(el('line', {
    x1: x, y1: 26, x2: x, y2: 26 + rowH * (items.length - 1),
    stroke: 'rgba(255,255,255,.14)', 'stroke-width': 1.5,
  }));
  items.forEach((key, i) => {
    const y = 26 + rowH * i;
    const g = el('g', { class: 'd-chain__node', style: `--i:${i}` });
    g.append(el('circle', { cx: x, cy: y, r: 16, fill: '#0c0a10', stroke: 'rgba(255,255,255,.16)' }));
    g.append(el('circle', { cx: x, cy: y, r: 4.5, fill: 'url(#g1)', class: 'd-chain__core' }));
    g.append(el('text', { x: x + 30, y: y + 5, class: 'd-label d-label--lg' }, t(`d.chain.${key}`)));
    s.append(g);
  });
  // the return arc that makes it a cycle
  s.append(el('path', {
    d: `M ${x} ${26 + rowH * (items.length - 1) + 22} q 0 24 -26 24 q -26 0 -26 -26 V 52 q 0 -26 26 -26 q 26 0 26 22`,
    stroke: 'rgba(255,255,255,.10)', 'stroke-width': 1.5, 'stroke-dasharray': '4 5', fill: 'none',
  }));
  host.replaceChildren(s);
  registerScale(s);
}

function chainWide(host) {
  const W = 1000, H = 150;
  const s = svg(`0 0 ${W} ${H}`, { class: 'd-chain', preserveAspectRatio: 'xMidYMid meet' });
  defs(s);

  const items = ['context', 'agents', 'action', 'evidence', 'memory'];
  const pad = 70;
  const step = (W - pad * 2) / (items.length - 1);
  const y = 58;

  // connecting rail
  s.append(el('line', {
    x1: pad, y1: y, x2: W - pad, y2: y,
    stroke: 'rgba(255,255,255,.14)', 'stroke-width': 1.5,
  }));

  // the loop-back arc: what makes it a cycle rather than a pipeline
  s.append(el('path', {
    d: `M ${W - pad} ${y} q 46 0 46 32 q 0 30 -60 30 H ${pad + 14} q -60 0 -60 -30 q 0 -32 46 -32`,
    stroke: 'rgba(255,255,255,.10)', 'stroke-width': 1.5,
    'stroke-dasharray': '4 5', fill: 'none',
  }));

  items.forEach((key, i) => {
    const x = pad + step * i;
    const g = el('g', { class: 'd-chain__node', style: `--i:${i}` });
    g.append(el('circle', { cx: x, cy: y, r: 22, fill: 'rgba(255,255,255,.03)', stroke: 'rgba(255,255,255,.16)' }));
    g.append(el('circle', { cx: x, cy: y, r: 5, fill: `url(#g1)`, class: 'd-chain__core' }));
    g.append(el('text', {
      x, y: y + 46, 'text-anchor': 'middle', class: 'd-label',
    }, t(`d.chain.${key}`)));
    s.append(g);
  });

  if (!reducedMotion()) {
    const pulse = el('circle', { r: 4.5, fill: '#fff', class: 'd-chain__pulse' });
    const path = el('path', {
      id: 'chainpath', d: `M ${pad} ${y} H ${W - pad}`, fill: 'none', stroke: 'none',
    });
    const anim = el('animateMotion', { dur: '3.6s', repeatCount: 'indefinite', rotate: 'auto' });
    anim.append(el('mpath', { href: '#chainpath' }));
    pulse.append(anim);
    s.append(path, pulse);
  }

  host.replaceChildren(s);
  registerScale(s);
}

const chain = (host) => (isNarrow() ? chainNarrow(host) : chainWide(host));

/* =========================================================================
   2 · Shift axis — value migrating along a three-stop track
   ========================================================================= */
function axisNarrow(host) {
  const W = 320, H = 240;
  const s = svg(`0 0 ${W} ${H}`, { class: 'd-axis d-axis--v', preserveAspectRatio: 'xMidYMid meet' });
  defs(s, 'g2');
  const x = 26;
  s.append(el('line', { x1: x, y1: 26, x2: x, y2: H - 46, stroke: 'rgba(255,255,255,.12)', 'stroke-width': 2 }));
  s.append(el('line', {
    x1: x, y1: 26, x2: x, y2: H - 46, stroke: 'url(#g2)', 'stroke-width': 2,
    class: 'd-axis__fill', 'stroke-linecap': 'round',
  }));
  [['a1', 26], ['a2', (H - 20) / 2], ['a3', H - 46]].forEach(([key, y], i) => {
    s.append(el('circle', { cx: x, cy: y, r: i === 2 ? 7 : 5, fill: i === 2 ? 'url(#g2)' : 'rgba(255,255,255,.35)' }));
    s.append(el('text', { x: x + 22, y: y + 5, class: 'd-label d-label--lg' }, t(`d.axis.${key}`)));
  });
  s.append(el('text', { x: x + 22, y: 12, class: 'd-label d-label--xs d-label--dim' }, t('d.axis.was')));
  s.append(el('text', { x: x + 22, y: H - 18, class: 'd-label d-label--xs d-label--dim' }, t('d.axis.now')));
  host.replaceChildren(s);
  registerScale(s);
}

function axisWide(host) {
  const W = 1000, H = 92;
  const s = svg(`0 0 ${W} ${H}`, { class: 'd-axis', preserveAspectRatio: 'none' });
  defs(s, 'g2');

  const y = 46;
  s.append(el('line', { x1: 40, y1: y, x2: W - 40, y2: y, stroke: 'rgba(255,255,255,.12)', 'stroke-width': 2 }));
  s.append(el('line', {
    x1: 40, y1: y, x2: W - 40, y2: y, stroke: 'url(#g2)', 'stroke-width': 2,
    class: 'd-axis__fill', 'stroke-linecap': 'round',
  }));

  [['a1', 40], ['a2', W / 2], ['a3', W - 40]].forEach(([key, x], i) => {
    const anchor = i === 0 ? 'start' : i === 2 ? 'end' : 'middle';
    s.append(el('circle', { cx: x, cy: y, r: i === 2 ? 7 : 5, fill: i === 2 ? 'url(#g2)' : 'rgba(255,255,255,.35)' }));
    s.append(el('text', { x, y: y - 18, 'text-anchor': anchor, class: 'd-label d-label--lg' }, t(`d.axis.${key}`)));
  });

  s.append(el('text', { x: 40, y: y + 28, 'text-anchor': 'start', class: 'd-label d-label--dim' }, t('d.axis.was')));
  s.append(el('text', { x: W - 40, y: y + 28, 'text-anchor': 'end', class: 'd-label d-label--dim' }, t('d.axis.now')));

  host.replaceChildren(s);
  registerScale(s);
}

const axis = (host) => (isNarrow() ? axisNarrow(host) : axisWide(host));

/* =========================================================================
   3 · Broken chain — five islands, context evaporating between them
   ========================================================================= */
function brokenChainNarrow(host) {
  const items = ['ask', 'answer', 'redo', 'check', 'file'];
  const W = 320, rowH = 74, H = items.length * rowH + 34;
  const s = svg(`0 0 ${W} ${H}`, { class: 'd-break', preserveAspectRatio: 'xMidYMid meet' });
  const boxW = 210, boxH = 46, x = (W - boxW) / 2;

  s.append(el('text', {
    x: W / 2, y: 16, 'text-anchor': 'middle', class: 'd-label d-label--xs d-label--fail',
  }, t('d.break.lost')));

  items.forEach((key, i) => {
    const y = 32 + rowH * i;
    const g = el('g', { class: 'd-break__box', style: `--i:${i}` });
    g.append(el('rect', {
      x, y, width: boxW, height: boxH, rx: 11,
      fill: 'rgba(255,255,255,.07)', stroke: 'rgba(255,255,255,.22)',
    }));
    g.append(el('text', { x: W / 2, y: y + boxH / 2 + 5, 'text-anchor': 'middle', class: 'd-label' }, t(`d.break.${key}`)));
    s.append(g);

    if (i < items.length - 1) {
      const gy = y + boxH + (rowH - boxH) / 2;
      const b = el('g', { class: 'd-break__gap', style: `--i:${i}` });
      b.append(el('path', {
        d: `M ${W / 2 - 9} ${gy - 5} l 9 4 l -9 4 M ${W / 2 + 9} ${gy - 5} l -9 4 l 9 4`,
        stroke: 'var(--c-fail)', 'stroke-width': 1.6, 'stroke-linecap': 'round', fill: 'none', opacity: '.75',
      }));
      if (!reducedMotion()) {
        for (let p = 0; p < 3; p += 1) {
          b.append(el('circle', {
            cx: W / 2 + 24 + p * 7, cy: gy, r: 1.6,
            fill: 'var(--c-fail)', class: 'd-break__spark', style: `--p:${p}`,
          }));
        }
      }
      s.append(b);
    }
  });
  host.replaceChildren(s);
  registerScale(s);
}

function brokenChainWide(host) {
  const W = 1000, H = 150;
  const s = svg(`0 0 ${W} ${H}`, { class: 'd-break', preserveAspectRatio: 'xMidYMid meet' });

  const items = ['ask', 'answer', 'redo', 'check', 'file'];
  const boxW = 148, boxH = 62, gap = (W - 60 - boxW * 5) / 4;
  const y = 54;

  items.forEach((key, i) => {
    const x = 30 + i * (boxW + gap);
    const g = el('g', { class: 'd-break__box', style: `--i:${i}` });
    g.append(el('rect', {
      x, y, width: boxW, height: boxH, rx: 12,
      fill: 'rgba(255,255,255,.07)', stroke: 'rgba(255,255,255,.22)',
    }));
    g.append(el('text', { x: x + boxW / 2, y: y + boxH / 2 + 5, 'text-anchor': 'middle', class: 'd-label' }, t(`d.break.${key}`)));
    s.append(g);

    // the gap between two boxes is where the work actually breaks
    if (i < items.length - 1) {
      const gx = x + boxW + gap / 2;
      s.append(el('line', {
        x1: x + boxW + 6, y1: y + boxH / 2, x2: gx - 9, y2: y + boxH / 2,
        stroke: 'rgba(255,255,255,.18)', 'stroke-width': 1.2,
      }));
      s.append(el('line', {
        x1: gx + 9, y1: y + boxH / 2, x2: x + boxW + gap - 6, y2: y + boxH / 2,
        stroke: 'rgba(255,255,255,.18)', 'stroke-width': 1.2,
      }));
      // a break mark, and particles drifting up out of it
      const b = el('g', { class: 'd-break__gap', style: `--i:${i}` });
      b.append(el('path', {
        d: `M ${gx - 5} ${y + boxH / 2 - 9} l 4 9 l -4 9 M ${gx + 5} ${y + boxH / 2 - 9} l -4 9 l 4 9`,
        stroke: 'var(--c-fail)', 'stroke-width': 1.6, 'stroke-linecap': 'round', fill: 'none', opacity: '.75',
      }));
      if (!reducedMotion()) {
        for (let p = 0; p < 3; p += 1) {
          b.append(el('circle', {
            cx: gx + (p - 1) * 5, cy: y + boxH / 2 - 12, r: 1.6,
            fill: 'var(--c-fail)', class: 'd-break__spark', style: `--p:${p}`,
          }));
        }
      }
      s.append(b);
      if (i === 1) {
        s.append(el('text', {
          x: W / 2, y: 22, 'text-anchor': 'middle', class: 'd-label d-label--xs d-label--fail',
        }, t('d.break.lost')));
      }
    }
  });

  host.replaceChildren(s);
  registerScale(s);
}

const brokenChain = (host) => (isNarrow() ? brokenChainNarrow(host) : brokenChainWide(host));

/* =========================================================================
   4 · The loop — six stages on a ring, driven by scroll progress
   ========================================================================= */
const LOOP_STAGES = [
  { key: 'intent',  lead: 'human' },
  { key: 'explore', lead: 'ai' },
  { key: 'create',  lead: 'both' },
  { key: 'act',     lead: 'ai' },
  { key: 'verify',  lead: 'gate' },
  { key: 'learn',   lead: 'both' },
];
const LEAD_COLOR = {
  human: 'var(--c-human)', ai: 'var(--c-ai)',
  both: 'var(--c-2)', gate: 'var(--c-evidence)',
};
const LEAD_LABEL = {
  human: 'd.loop.leadHuman', ai: 'd.loop.leadAi',
  both: 'd.loop.leadBoth', gate: 'd.loop.leadEv',
};

function loopRing(host) {
  const S = 520, C = S / 2, R = 176;
  const s = svg(`0 0 ${S} ${S}`, { class: 'd-loop', preserveAspectRatio: 'xMidYMid meet' });
  defs(s, 'g4');

  s.append(el('circle', { cx: C, cy: C, r: R, stroke: 'rgba(255,255,255,.10)', 'stroke-width': 1.5 }));

  const arc = el('circle', {
    cx: C, cy: C, r: R, stroke: 'url(#g4)', 'stroke-width': 3, 'stroke-linecap': 'round',
    transform: `rotate(-90 ${C} ${C})`, class: 'd-loop__arc',
  });
  const circumference = 2 * Math.PI * R;
  arc.setAttribute('stroke-dasharray', String(circumference));
  arc.setAttribute('stroke-dashoffset', String(circumference));
  s.append(arc);

  const nodes = LOOP_STAGES.map((stage, i) => {
    const angle = (-90 + (360 / LOOP_STAGES.length) * i) * (Math.PI / 180);
    const x = C + R * Math.cos(angle);
    const y = C + R * Math.sin(angle);
    const g = el('g', { class: 'd-loop__node', 'data-step': i });
    g.append(el('circle', { cx: x, cy: y, r: 27, fill: '#0c0a10', stroke: 'rgba(255,255,255,.16)', class: 'd-loop__ring' }));
    const dot = el('circle', { cx: x, cy: y, r: 7, fill: LEAD_COLOR[stage.lead], class: 'd-loop__dot' });
    g.append(dot);
    // labels pushed outward along the radius so they never sit on the ring
    const lx = C + (R + 52) * Math.cos(angle);
    const ly = C + (R + 52) * Math.sin(angle);
    g.append(el('text', {
      x: lx, y: ly + 4, 'text-anchor': 'middle', class: 'd-label d-label--lg',
    }, t(`d.loop.${stage.key}`)));
    s.append(g);
    return g;
  });

  // centre readout: which stage, and who is driving it
  const centre = el('g', { class: 'd-loop__centre' });
  const title = el('text', { x: C, y: C - 4, 'text-anchor': 'middle', class: 'd-loop__title' });
  const who = el('text', { x: C, y: C + 24, 'text-anchor': 'middle', class: 'd-label d-label--dim' });
  centre.append(title, who);
  s.append(centre);

  host.replaceChildren(s);
  registerScale(s);

  const N = LOOP_STAGES.length;
  let shown = -1;

  return {
    /** @param {number} p 0→1 */
    render(p) {
      const head = p * N;
      const idx = Math.min(N - 1, Math.floor(head));
      arc.setAttribute('stroke-dashoffset', String(circumference * (1 - p)));

      /* Emphasis is continuous, not a class that flips at the stage boundary:
         each node reacts as the head approaches and recedes, so the ring reads
         as one moving thing rather than six lights switching on and off. */
      nodes.forEach((g, i) => {
        const distance = Math.abs(head - (i + 0.5));
        // Falloff of 1 meant only the node under the head ever lit; widening it
        // lets the neighbours glow as the head approaches, which is what makes
        // the ring read as one travelling highlight.
        const emphasis = Math.max(0, 1 - distance / 1.45);
        g.style.setProperty('--e', emphasis.toFixed(3));
        g.setAttribute('data-active', String(i === idx));
      });

      if (idx !== shown) {
        shown = idx;
        const stage = LOOP_STAGES[idx];
        title.textContent = t(`d.loop.${stage.key}`);
        who.textContent = t(LEAD_LABEL[stage.lead]);
        title.setAttribute('fill', LEAD_COLOR[stage.lead]);
        // re-trigger the crossfade without a class-removal round trip
        centre.style.animation = 'none';
        void centre.getBoundingClientRect();
        centre.style.animation = '';
      }
      return idx;
    },
  };
}

/* =========================================================================
   5 · Architecture — five layers, with the stable core called out
   ========================================================================= */
const ARCH_LAYERS = [
  { id: 'l5', tone: 'fast' },
  { id: 'l4', tone: 'fast' },
  { id: 'l3', tone: 'core' },
  { id: 'l2', tone: 'core' },
  { id: 'l1', tone: 'base' },
];

function arch(host) {
  const narrow = isNarrow();
  const W = narrow ? 340 : 760, rowH = narrow ? 62 : 74, gap = 10;
  const H = ARCH_LAYERS.length * (rowH + gap) + 10;
  const s = svg(`0 0 ${W} ${H}`, { class: 'd-arch', preserveAspectRatio: 'xMidYMid meet' });
  // It carries real controls now, so it must not be hidden from assistive tech.
  s.removeAttribute('aria-hidden');
  defs(s, 'g5');

  ARCH_LAYERS.forEach((layer, i) => {
    const y = i * (rowH + gap) + 5;
    const g = el('g', { class: 'd-arch__row', 'data-tone': layer.tone, style: `--i:${ARCH_LAYERS.length - 1 - i}` });

    g.append(el('rect', {
      x: narrow ? 26 : 40, y, width: W - (narrow ? 36 : 210), height: rowH, rx: 12,
      class: 'd-arch__plate',
    }));
    // the stable core gets a lit left edge — the one visual weight difference
    if (layer.tone === 'core') {
      g.append(el('rect', { x: narrow ? 26 : 40, y, width: 3, height: rowH, rx: 2, fill: 'url(#g5)' }));
    }
    const tx = narrow ? 42 : 62;
    g.append(el('text', { x: tx, y: y + (narrow ? 26 : 30), class: 'd-label d-label--lg' }, t(`d.arch.${layer.id}`)));
    g.append(el('text', { x: tx, y: y + (narrow ? 45 : 51), class: 'd-label d-label--xs d-label--dim' }, t(`d.arch.${layer.id}d`)));
    g.append(el('text', {
      x: narrow ? 12 : 22, y: y + rowH / 2 + 4, 'text-anchor': 'middle', class: 'd-label d-label--xs d-label--faint',
    }, layer.id.toUpperCase()));

    /* Selectable: "model-agnostic" and "the middle must not move" are claims
       the prose makes and the picture never demonstrated. Picking a layer
       shows what sits in it and whether swapping it touches anything else. */
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');
    g.setAttribute('data-layer', layer.id);
    g.setAttribute('aria-pressed', String(layer.id === 'l3'));
    // SVG <text> does not name its ancestor the way HTML content does.
    g.setAttribute('aria-label',
      `${layer.id.toUpperCase()} · ${t(`d.arch.${layer.id}`)} — ${t(`d.arch.${layer.id}d`)}`);
    s.append(g);
  });

  // side brackets: "moves fast" over L5–L4, "must stay stable" over L3–L2
  const bx = W - 200;
  const bracket = (y1, y2, label, cls) => {
    if (narrow) return;   // no room beside the stack; the copy carries this
    const g = el('g', { class: `d-arch__bracket ${cls}` });
    g.append(el('path', {
      d: `M ${bx} ${y1} h 8 V ${y2} h -8`,
      stroke: 'currentColor', 'stroke-width': 1.2, fill: 'none', opacity: '.5',
    }));
    g.append(el('text', {
      x: bx + 18, y: (y1 + y2) / 2 + 4, class: 'd-label d-label--xs', 'text-anchor': 'start',
    }, label));
    s.append(g);
  };
  bracket(5, 5 + rowH * 2 + gap, t('d.arch.fast'), 'is-fast');
  bracket(5 + (rowH + gap) * 2, 5 + (rowH + gap) * 2 + rowH * 2 + gap, t('d.arch.stable'), 'is-core');

  host.replaceChildren(s);
  registerScale(s);
  return wireArchSelection(s);
}

/* Which layers a swap at the selected layer disturbs. The interesting answer
   is the empty one: changing the model at L4 reaches nothing below it. */
const ARCH_IMPACT = {
  l5: ['l5'],
  l4: ['l4'],
  l3: ['l3', 'l4', 'l5'],
  l2: ['l2', 'l3', 'l4', 'l5'],
  l1: ['l1'],
};

function wireArchSelection(root) {
  const rows = [...root.querySelectorAll('[data-layer]')];
  const detail = document.getElementById('arch-detail');
  if (!rows.length) return () => {};

  const select = (id) => {
    const impact = ARCH_IMPACT[id] ?? [id];
    rows.forEach((row) => {
      const rid = row.dataset.layer;
      row.setAttribute('aria-pressed', String(rid === id));
      row.setAttribute('data-selected', String(rid === id));
      row.setAttribute('data-impacted', String(rid !== id && impact.includes(rid)));
    });
    if (detail) {
      detail.querySelectorAll('[data-layer-detail]').forEach((d) => {
        d.toggleAttribute('hidden', d.dataset.layerDetail !== id);
      });
    }
  };

  rows.forEach((row) => {
    row.addEventListener('click', () => select(row.dataset.layer));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(row.dataset.layer); }
    });
  });

  select('l3');
  return () => {};
}

/* =========================================================================
   6 · Harness — six gates; a run that fails verification and is reversed
   ========================================================================= */
const GATES = ['authorize', 'execute', 'observe', 'verify', 'evidence'];

function harnessNarrow(host) {
  const W = 320, rowH = 62, H = GATES.length * rowH + 40;
  const s = svg(`0 0 ${W} ${H}`, { class: 'd-harness', preserveAspectRatio: 'xMidYMid meet' });
  defs(s, 'g6');
  const boxW = 184, boxH = 44, x = 58;
  const centres = [];

  GATES.forEach((key, i) => {
    const y = 30 + rowH * i;
    centres.push(y + boxH / 2);
    const g = el('g', { class: 'd-harness__gate', 'data-gate': key, style: `--i:${i}` });
    g.append(el('rect', {
      x, y, width: boxW, height: boxH, rx: 11,
      fill: 'rgba(255,255,255,.05)', stroke: 'rgba(255,255,255,.16)', class: 'd-harness__plate',
    }));
    g.append(el('text', { x: x + boxW / 2, y: y + boxH / 2 + 5, 'text-anchor': 'middle', class: 'd-label' }, t(`d.harness.${key}`)));
    s.append(g);
    if (i < GATES.length - 1) {
      s.append(el('path', {
        d: `M ${x + boxW / 2} ${y + boxH + 4} V ${y + rowH - 6} m -4 -6 l 4 6 l 4 -6`,
        stroke: 'rgba(255,255,255,.22)', 'stroke-width': 1.3, fill: 'none',
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      }));
    }
  });

  // rollback runs down the right-hand gutter, verify -> execute
  const vy = centres[3], ey = centres[1];
  s.append(el('path', {
    d: `M ${x + boxW + 6} ${vy} q 26 0 26 -26 V ${ey + 26} q 0 -26 -26 -26`,
    stroke: 'var(--c-fail)', 'stroke-width': 1.5, fill: 'none',
    'stroke-dasharray': '5 4', opacity: '.65', class: 'd-harness__rollback',
  }));
  s.append(el('text', {
    x: W - 4, y: (vy + ey) / 2, 'text-anchor': 'end',
    class: 'd-label d-label--xs d-label--fail',
  }, t('d.harness.rollback')));

  const token = el('g', { class: 'd-harness__token' });
  token.append(el('circle', { r: 8, fill: 'url(#g6)' }));
  s.append(token);
  const status = el('text', { x: W / 2, y: 16, 'text-anchor': 'middle', class: 'd-label d-label--xs' }, '');
  s.append(status);
  host.replaceChildren(s);
  registerScale(s);

  if (reducedMotion()) { parkCaught({ token, status, s, at: `translate(${x - 18} ${centres[3]})` }); return () => {}; }
  return runHarness({ token, status, s, at: (i) => `translate(${x - 18} ${centres[i]})` });
}

function harnessWide(host) {
  const W = 1000, H = 210;
  const s = svg(`0 0 ${W} ${H}`, { class: 'd-harness', preserveAspectRatio: 'xMidYMid meet' });
  defs(s, 'g6');

  const boxW = 150, y = 58, boxH = 58;
  const gap = (W - 60 - boxW * GATES.length) / (GATES.length - 1);
  const centres = [];

  GATES.forEach((key, i) => {
    const x = 30 + i * (boxW + gap);
    centres.push(x + boxW / 2);
    const g = el('g', { class: 'd-harness__gate', 'data-gate': key, style: `--i:${i}` });
    g.append(el('rect', {
      x, y, width: boxW, height: boxH, rx: 12,
      fill: 'rgba(255,255,255,.035)', stroke: 'rgba(255,255,255,.14)', class: 'd-harness__plate',
    }));
    g.append(el('text', { x: x + boxW / 2, y: y + boxH / 2 + 5, 'text-anchor': 'middle', class: 'd-label' }, t(`d.harness.${key}`)));
    s.append(g);
    if (i < GATES.length - 1) {
      s.append(el('path', {
        d: `M ${x + boxW + 7} ${y + boxH / 2} H ${x + boxW + gap - 11} m -6 -4 l 6 4 l -6 4`,
        stroke: 'rgba(255,255,255,.22)', 'stroke-width': 1.3, fill: 'none',
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      }));
    }
  });

  // rollback: the return path from verify back to execute
  const vx = centres[3], ex = centres[1];
  s.append(el('path', {
    d: `M ${vx} ${y + boxH + 6} q 0 42 -46 42 H ${ex + 46} q -46 0 -46 -42`,
    stroke: 'var(--c-fail)', 'stroke-width': 1.5, fill: 'none',
    'stroke-dasharray': '5 4', opacity: '.65', class: 'd-harness__rollback',
  }));
  s.append(el('text', {
    x: (vx + ex) / 2, y: y + boxH + 62, 'text-anchor': 'middle',
    class: 'd-label d-label--xs d-label--fail',
  }, t('d.harness.rollback')));

  // the token that walks the gates
  const token = el('g', { class: 'd-harness__token' });
  token.append(el('circle', { r: 9, fill: 'url(#g6)' }));
  s.append(token);

  const status = el('text', {
    x: W / 2, y: 28, 'text-anchor': 'middle', class: 'd-label d-label--xs',
  }, '');
  s.append(status);

  host.replaceChildren(s);
  registerScale(s);

  /* ONE rail for the token, used by both the animated and the parked paths.
     They used to differ: the reduced-motion branch parked it at `y - 16` with
     a comment saying to keep it "clear of the last gate's label rather than on
     top of it", while the animated branch — the one every reader actually sees
     — ran it through `y + boxH / 2`, which is the line the label sits on. So
     "Execute" rendered as "ecute" for thirty-three rounds, and the person who
     knew about the collision had fixed it only in the branch almost nobody
     reaches. A single constant is the fix; the comment was never the problem.
     (The narrow variant has always had this right: it runs up the gutter.) */
  const railY = y - 16;

  if (reducedMotion()) {
    parkCaught({ token, status, s, at: `translate(${centres[3]} ${railY})` });
    return () => {};
  }

  return runHarness({
    token, status, s,
    at: (i) => `translate(${centres[i]} ${railY})`,
    lerp: (a, b, e) => `translate(${centres[a] + (centres[b] - centres[a]) * e} ${railY})`,
  });
}

const harness = (host) => (isNarrow() ? harnessNarrow(host) : harnessWide(host));

/* The still frame a reduced-motion reader gets. It used to be the success
   path — "passed", token on Evidence — directly above a caption saying "the
   run above shows a failing check being caught and reversed". The one frame
   that has to carry the whole animation showed the half the caption says is
   not the point. It is the caught failure now: token on Verify, the gate
   marked failed, the rollback path lit — the same state the animation holds
   at 2.7 s. */
function parkCaught({ token, status, s, at }) {
  token.setAttribute('transform', at);
  status.textContent = t('d.harness.fail');
  status.setAttribute('fill', 'var(--c-fail)');
  s.querySelectorAll('.d-harness__gate').forEach((g, gi) => g.setAttribute('data-state', gi === 3 ? 'fail' : ''));
  s.querySelector('.d-harness__rollback')?.setAttribute('data-on', 'true');
}

/* The run: walk to verify, fail, roll back to execute, walk again, pass.
   A slow loop on purpose — the failing path is the whole message, so it has to
   sit on screen long enough to read. Shared by both orientations; only the
   position function differs. */
const HARNESS_TL = [
  { at: 0,    gate: 0, s: '' },
  { at: 900,  gate: 1, s: '' },
  { at: 1800, gate: 2, s: '' },
  { at: 2700, gate: 3, s: 'fail' },
  { at: 4200, gate: 1, s: 'fail' },
  { at: 5400, gate: 2, s: '' },
  { at: 6300, gate: 3, s: '' },
  { at: 7200, gate: 4, s: 'pass' },
  { at: 8800, gate: 0, s: '' },
];

function runHarness({ token, status, s, at, lerp }) {
  let raf = 0, start = 0;
  const total = HARNESS_TL[HARNESS_TL.length - 1].at;

  const tick = (now) => {
    if (!start) start = now;
    const time = (now - start) % total;
    let i = 0;
    while (i < HARNESS_TL.length - 1 && HARNESS_TL[i + 1].at <= time) i += 1;
    const a = HARNESS_TL[i], b = HARNESS_TL[Math.min(i + 1, HARNESS_TL.length - 1)];
    const span = Math.max(1, b.at - a.at);
    const k = Math.min(1, (time - a.at) / span);
    // ease so the token settles into each gate instead of sliding linearly
    const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
    token.setAttribute('transform', lerp ? lerp(a.gate, b.gate, e) : at(e < 0.5 ? a.gate : b.gate));

    const state = a.s;
    status.textContent = state === 'fail' ? t('d.harness.fail')
      : state === 'pass' ? t('d.harness.pass') : '';
    status.setAttribute('fill', state === 'fail' ? 'var(--c-fail)' : 'var(--c-evidence)');
    s.querySelectorAll('.d-harness__gate').forEach((g, gi) => {
      g.setAttribute('data-state', gi === 3 && state === 'fail' ? 'fail' : '');
    });
    s.querySelector('.d-harness__rollback')?.setAttribute('data-on', String(state === 'fail'));

    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

/* =========================================================================
   7 · Ontology graph — the shape organizational memory actually has
   ========================================================================= */
const GRAPH_NODES = [
  { id: 'person',   x: 92,  y: 72,  r: 26 },
  { id: 'project',  x: 232, y: 44,  r: 30 },
  { id: 'decision', x: 356, y: 108, r: 32 },
  { id: 'evidence', x: 250, y: 186, r: 28, tone: 'ev' },
  { id: 'action',   x: 106, y: 190, r: 26 },
  { id: 'artifact', x: 400, y: 218, r: 26 },
  { id: 'memory',   x: 470, y: 118, r: 30, tone: 'hot' },
];
const GRAPH_EDGES = [
  ['person', 'project'], ['project', 'decision'], ['decision', 'evidence'],
  ['evidence', 'action'], ['action', 'artifact'], ['artifact', 'memory'],
  ['decision', 'memory'], ['person', 'action'], ['evidence', 'artifact'],
];

/* Taller, narrower arrangement of the same seven nodes and nine edges — at
   phone width the wide layout renders its labels at about 8 px. */
const GRAPH_NODES_NARROW = [
  { id: 'person',   x: 62,  y: 54,  r: 26 },
  { id: 'project',  x: 178, y: 40,  r: 28 },
  { id: 'decision', x: 250, y: 132, r: 30 },
  { id: 'evidence', x: 140, y: 166, r: 28, tone: 'ev' },
  { id: 'action',   x: 52,  y: 246, r: 26 },
  { id: 'artifact', x: 168, y: 300, r: 26 },
  { id: 'memory',   x: 258, y: 236, r: 30, tone: 'hot' },
];

function graph(host) {
  const narrow = isNarrow();
  const nodes = narrow ? GRAPH_NODES_NARROW : GRAPH_NODES;
  const s = svg(narrow ? '0 0 320 350' : '0 0 540 270', { class: 'd-graph', preserveAspectRatio: 'xMidYMid meet' });
  defs(s, 'g7');
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

  GRAPH_EDGES.forEach(([a, b], i) => {
    const n1 = byId[a], n2 = byId[b];
    s.append(el('line', {
      x1: n1.x, y1: n1.y, x2: n2.x, y2: n2.y,
      stroke: 'rgba(255,255,255,.13)', 'stroke-width': 1.2,
      class: 'd-graph__edge', style: `--i:${i}`,
    }));
  });

  nodes.forEach((n, i) => {
    const g = el('g', { class: 'd-graph__node', 'data-tone': n.tone ?? '', style: `--i:${i}` });
    g.append(el('circle', {
      cx: n.x, cy: n.y, r: n.r,
      fill: n.tone === 'hot' ? 'url(#g7)' : 'rgba(255,255,255,.04)',
      stroke: n.tone === 'ev' ? 'var(--c-evidence)' : 'rgba(255,255,255,.18)',
      'fill-opacity': n.tone === 'hot' ? '.9' : '1',
    }));
    g.append(el('text', {
      x: n.x, y: n.y + 4, 'text-anchor': 'middle',
      class: `d-label d-label--xs${n.tone === 'hot' ? ' d-label--on' : ''}`,
    }, t(`d.graph.${n.id}`)));
    s.append(g);
  });

  host.replaceChildren(s);
  registerScale(s);
}

/* =========================================================================
   Registry
   ========================================================================= */
const BUILDERS = { chain, axis, break: brokenChain, arch, harness, graph };

let teardowns = [];
let loopApi = null;

export function renderDiagrams(lang = pageLang()) {
  LANG = lang;
  teardowns.forEach((fn) => fn?.());
  teardowns = [];

  document.querySelectorAll('[data-diagram]').forEach((host) => {
    const kind = host.dataset.diagram;
    if (kind === 'loop') { loopApi = loopRing(host); return; }
    const build = BUILDERS[kind];
    if (!build) {
      // A host with no builder renders nothing and reports nothing, which is
      // how `data-diagram="scales"` sat in the markup from round 1 until a
      // derived test count noticed the mismatch.
      console.warn(`[diagrams] no builder for "${kind}" — dead host?`);
      return;
    }
    const stop = build(host);
    if (typeof stop === 'function') teardowns.push(stop);
  });
}

export const getLoop = () => loopApi;

/* Crossing the narrow breakpoint changes which variant is correct, so the
   diagrams are rebuilt — resizing past it otherwise leaves a horizontal
   diagram squeezed into a phone-width column. */
export function watchBreakpoint(rerender) {
  onMediaChange(NARROW_Q, rerender);
}
