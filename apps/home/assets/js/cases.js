/**
 * cases.js — the discipline selector.
 *
 * A real tab pattern, because six panels of prose behind six buttons is
 * exactly what `role="tablist"` is for: arrow keys move between tabs, Home and
 * End jump to the ends, and only the selected tab is in the tab order so the
 * group is one stop rather than six.
 */
export function initCases() {
  const list = document.querySelector('.cases__tabs');
  if (!list) return;

  const tabs = [...list.querySelectorAll('[role="tab"]')];
  const panels = tabs.map((t) => document.getElementById(t.getAttribute('aria-controls')));

  const select = (index, { focus = false } = {}) => {
    tabs.forEach((tab, i) => {
      const on = i === index;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      panels[i]?.toggleAttribute('hidden', !on);
    });
    if (focus) tabs[index].focus();
  };

  tabs.forEach((tab, i) => tab.addEventListener('click', () => select(i)));

  list.addEventListener('keydown', (event) => {
    const current = tabs.indexOf(document.activeElement);
    if (current === -1) return;
    const moves = {
      ArrowRight: current + 1, ArrowDown: current + 1,
      ArrowLeft: current - 1,  ArrowUp: current - 1,
      Home: 0, End: tabs.length - 1,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    select((moves[event.key] + tabs.length) % tabs.length, { focus: true });
  });

  select(0);
}
