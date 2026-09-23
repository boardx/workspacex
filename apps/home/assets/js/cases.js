/**
 * cases.js — the discipline selector.
 *
 * A real tab pattern, because six panels of prose behind six buttons is
 * exactly what `role="tablist"` is for: arrow keys move between tabs, Home and
 * End jump to the ends, and only the selected tab is in the tab order so the
 * group is one stop rather than six.
 *
 * And they are addressable. These six panels are the only place on the page
 * where the argument is made in a specific discipline, and until now there was
 * no way to send anyone to one: `/#panel-edu` loaded the page with Legal still
 * selected and the education panel `hidden`, so the browser could not even
 * scroll to it. Selecting a tab rewrites the fragment with `replaceState` —
 * the address bar becomes copyable without a history entry per click — and the
 * fragment is read back on load and on `hashchange`.
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

  /* Accepts either the panel's id or the tab's, because both appear in the
     markup and a reader copying an anchor has no way to know which is which. */
  const indexForHash = () => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id) return -1;
    return tabs.findIndex((t, i) => t.id === id || panels[i]?.id === id);
  };

  const selectFromHash = ({ scroll = false } = {}) => {
    const i = indexForHash();
    if (i === -1) return false;
    select(i);
    /* The panel was `hidden` a moment ago, so the browser has already given up
       on scrolling to it. Bring the section into view instead of the panel, so
       the reader lands on the heading that explains what they are looking at. */
    if (scroll) document.getElementById('start')?.scrollIntoView({ block: 'start' });
    return true;
  };

  tabs.forEach((tab, i) => tab.addEventListener('click', () => {
    select(i);
    const id = panels[i]?.id;
    if (id) history.replaceState(null, '', `#${id}`);
  }));

  window.addEventListener('hashchange', () => selectFromHash({ scroll: true }));

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

  if (!selectFromHash({ scroll: true })) select(0);
}
