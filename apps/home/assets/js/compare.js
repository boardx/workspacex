/**
 * compare.js — the before / after switch in the problem section.
 *
 * The broken work chain is only half an argument; the point is what replaces
 * it. Showing both in the same frame, switched in place, makes the comparison
 * the reader's own rather than something they have to hold in their head
 * across two sections.
 */
export function initCompare() {
  const group = document.querySelector('.switch');
  const stage = group?.closest('.stage');
  if (!group || !stage) return;

  const buttons = [...group.querySelectorAll('.switch__btn')];
  const panes = [...stage.querySelectorAll('[data-view]')].filter((n) => !n.classList.contains('switch__btn'));

  const show = (view) => {
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    panes.forEach((n) => {
      const on = n.dataset.view === view;
      n.classList.toggle('is-on', on);
      n.classList.toggle('is-off', !on);
      // A hidden pane must leave the accessibility tree too, or a screen reader
      // reads both versions of the same diagram back to back.
      n.toggleAttribute('hidden', !on && n.classList.contains('stage__caption'));
      n.setAttribute('aria-hidden', String(!on));
    });
  };

  buttons.forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));

  // Left/right arrows move between the two, as a segmented control should.
  group.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = buttons.indexOf(document.activeElement);
    if (i === -1) return;
    e.preventDefault();
    const next = buttons[(i + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length];
    next.focus();
    show(next.dataset.view);
  });

  show('break');
}
