/** Owned S1 navigation control only; no credentials, network clients or product mutations. */
import { ProbeFailure } from './devapp-aidt-auth-readonly.mjs';
const fail = code => { throw new ProbeFailure(code); };

// Capture the destination before Next Link starts navigating. A matching pathname alone
// cannot distinguish the directory from an entity because both share that pathname.
export function ownedAidtProblemRoute(href, { origin, projectId }) {
  let url;
  try { url = new URL(href, origin); } catch { fail('S1_ENTITY_ROUTE_INVALID'); }
  if (typeof href !== 'string' || !href || url.origin !== origin || url.username || url.password
    || url.pathname !== `/aidt/${encodeURIComponent(projectId)}` || url.hash
    || url.searchParams.getAll('step').length !== 1 || url.searchParams.get('step') !== '1'
    || url.searchParams.getAll('entity').length !== 1
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(url.searchParams.get('entity') ?? '')
    || url.searchParams.has('history') || url.searchParams.has('summary')) fail('S1_ENTITY_ROUTE_INVALID');
  return Object.freeze({ href: url.href, origin, projectId, entityId: url.searchParams.get('entity') });
}

export function matchesAidtProblemRoute(href, route, outcome = false) {
  try {
    const actual = ownedAidtProblemRoute(href, route);
    const url = new URL(actual.href);
    return actual.entityId === route.entityId && (!outcome
      || (url.searchParams.getAll('tool').length === 1 && url.searchParams.get('tool') === 'outcome'));
  } catch { return false; }
}

/** Keep every captured source selector and the native thread; only the tool tab may change. */
export function matchesAidtProblemNativeContext(href, target, outcome = false) {
  if (!matchesAidtProblemRoute(href, target, outcome)) return false;
  try {
    const expected = new URL(target.href), actual = new URL(href);
    const thread = expected.searchParams.get('thread');
    if (expected.searchParams.getAll('thread').length !== 1 || !thread?.startsWith('thr_aidt_')
      || actual.searchParams.getAll('thread').length !== 1 || actual.searchParams.get('thread') !== thread) return false;
    const selectors = url => JSON.stringify([...url.searchParams.entries()].filter(([key]) => key !== 'tool')
      .sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv)));
    return selectors(actual) === selectors(expected);
  } catch { return false; }
}

/** Normal inspector tab interaction; cold outcome navigation remains a separate compatibility helper. */
export async function openAidtProblemNativeOutcome({ page, route, link, scope, waitForRoute, assertReady, navigation }) {
  const target = ownedAidtProblemRoute(link ? await link.getAttribute('href') : route?.href, scope);
  if (route && (target.entityId !== route.entityId || !matchesAidtProblemNativeContext(target.href, route))) fail('S1_ENTITY_ROUTE_CHANGED');
  if (!matchesAidtProblemNativeContext(target.href, target)) fail('S1_ENTITY_NAVIGATION_UNVERIFIED');
  navigation?.bind(target);
  if (link) await link.click();
  else if (!matchesAidtProblemNativeContext(page.url(), target)) {
    const entry = new URL(target.href); entry.searchParams.delete('tool');
    navigation?.phase('goto');
    await page.goto(entry.href, { waitUntil: 'domcontentloaded' });
    navigation?.passed('gotoCompleted');
  }
  // Shell mount and the ensuing tab route share the existing 30-second route budget.
  const deadline = performance.now() + 30000;
  const remaining = () => {
    const value = Math.ceil(deadline - performance.now());
    if (value <= 0) fail('S1_ENTITY_NAVIGATION_UNVERIFIED');
    return value;
  };
  const wait = predicate => waitForRoute(predicate, { timeout: remaining() });
  const composer = page.getByTestId('copilotkit-v2-input');
  const tab = page.getByTestId('chat-task-workbench-inspector-tab-artifacts')
    .and(page.getByRole('tab', { name: '产物', exact: true }));
  navigation?.phase('native-shell');
  await wait(async () => matchesAidtProblemNativeContext(page.url(), target) && await composer.isVisible()
    && await tab.count() === 1 && await tab.isVisible() && await tab.isEnabled());
  if (!matchesAidtProblemNativeContext(page.url(), target) || !await composer.isVisible()
    || await tab.count() !== 1 || !await tab.isVisible() || !await tab.isEnabled()) fail('S1_ENTITY_NAVIGATION_UNVERIFIED');
  navigation?.passed('composerReady'); navigation?.passed('artifactTabReady'); navigation?.phase('native-tab');
  await tab.click({ timeout: remaining() });
  navigation?.phase('route-bound');
  await wait(() => matchesAidtProblemNativeContext(page.url(), target, true));
  if (!matchesAidtProblemNativeContext(page.url(), target, true)) fail('S1_OUTCOME_NAVIGATION_UNVERIFIED');
  navigation?.passed('routeBound');
  await assertReady();
  return target;
}

