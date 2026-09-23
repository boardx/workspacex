/**
 * surface.js — connector lines on the workspace illustration.
 *
 * The notes are positioned in percentages so they reflow with the container;
 * hand-authored path coordinates in a fixed viewBox drift away from them at
 * every width. Measure the real boxes instead and redraw on resize.
 */
const LINKS = [
  ['a', 'b'],   // a decision raises an open question
  ['a', 'c'],   // and lands in the draft
];

export function initSurface() {
  const canvas = document.querySelector('.surface__canvas');
  const svg = canvas?.querySelector('.surface__links');
  if (!canvas || !svg) return;

  const draw = () => {
    const box = canvas.getBoundingClientRect();
    if (!box.width) return;
    svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);

    const notes = Object.fromEntries(
      [...canvas.querySelectorAll('[data-note]')].map((n) => {
        const r = n.getBoundingClientRect();
        return [n.dataset.note, {
          left: r.left - box.left, right: r.right - box.left,
          top: r.top - box.top, bottom: r.bottom - box.top,
          cy: r.top - box.top + r.height / 2,
        }];
      }),
    );

    const paths = LINKS.map(([from, to]) => {
      const a = notes[from]; const b = notes[to];
      if (!a || !b) return '';
      // leave from whichever side faces the target, arrive on the facing side
      const goingRight = b.left >= a.right;
      const x1 = goingRight ? a.right : a.left;
      const x2 = goingRight ? b.left : b.right;
      const y1 = a.cy; const y2 = b.cy;
      const bend = Math.max(24, Math.abs(x2 - x1) * 0.45) * (goingRight ? 1 : -1);
      return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
    }).filter(Boolean);

    svg.replaceChildren(...paths.map((d) => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      el.setAttribute('d', d);
      el.setAttribute('stroke', 'rgba(255,255,255,.22)');
      el.setAttribute('stroke-width', '1.2');
      el.setAttribute('fill', 'none');
      return el;
    }));
  };

  draw();
  // Fonts land after first paint and change the note heights.
  document.fonts?.ready.then(draw);
  let t = 0;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(draw, 120);
  }, { passive: true });
}
