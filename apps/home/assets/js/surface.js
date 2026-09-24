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
    const box = { width: canvas.clientWidth, height: canvas.clientHeight };
    if (!box.width) return;
    svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);

    /* Layout boxes, not getBoundingClientRect. The notes arrive with a
       reveal transform, and the lines are drawn at load — while the section
       is still below the fold and every note is still offset. Measured with
       transforms, each line was drawn to where its card was about to leave,
       and stayed there: the acceptance set caught a line running under the
       question card on every desktop visit. offset* ignores transforms. */
    const notes = Object.fromEntries(
      [...canvas.querySelectorAll('[data-note]')].map((n) => {
        const left = n.offsetLeft; const top = n.offsetTop;
        return [n.dataset.note, {
          left, right: left + n.offsetWidth,
          top, bottom: top + n.offsetHeight,
          cy: top + n.offsetHeight / 2,
        }];
      }),
    );

    const paths = LINKS.map(([from, to]) => {
      const a = notes[from]; const b = notes[to];
      if (!a || !b) return '';
      /* A target mostly BELOW the source (the draft sits under the decision)
         is joined bottom edge to top edge. Routing every link sideways sent
         this one out of the decision's left edge, back under both cards and
         into the draft's right edge — a line drawn behind the two things it
         claimed to join. */
      const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      if (b.top >= a.bottom && overlap > 24) {
        const x = Math.max(a.left, b.left) + overlap / 2;
        const y1 = a.bottom; const y2 = b.top; const k = (y2 - y1) * 0.5;
        return `M ${x} ${y1} C ${x} ${y1 + k}, ${x} ${y2 - k}, ${x} ${y2}`;
      }
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
