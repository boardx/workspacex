/** Live Dev acceptance: only visible UI creates/edits/explicitly confirms owned QA data.
 * A synthetic journey checks software behavior, never real interviews or classroom outcomes.
 * Credentials, request allowlists, run identity and evidence publication belong to the runner.
 */
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { ProbeFailure } from './devapp-aidt-auth-readonly.mjs';

export const REQUIRED_CHECKS = Object.freeze([
  'overview', 's1-draft-not-complete', 's1-confirmed-reentry',
  's2-ten-card-chats', 's2-interview-handoff',
  ...Array.from({ length: 9 }, (_, index) => `s2-guide-u${String(index + 2).padStart(2, '0')}`),
  's2-distinct-threads', 's2-card-management', 's3-definition-hmw-handoff',
  's4-three-distinct-descriptions', 's5-prototype-question-version',
  's6-test-reflection', 'report-confirmed-source-export',
  'six-stage-completion', 'anonymous-access-boundary',
]);
const fail = code => { throw new ProbeFailure(code); };
const SYNTHETIC = '合成验收数据，非真实访谈';

export function hasExactSavedInput(value, expected, depth = 0) {
  if (depth > 24) return false;
  if (typeof value === 'string') {
    if (value === expected) return true;
    if (/^[\[{]/.test(value.trim()) && value.length <= 1048576) { try { return hasExactSavedInput(JSON.parse(value), expected, depth + 1); } catch { return false; } }
    return false;
  }
  return Boolean(value && typeof value === 'object' && Object.values(value).some(item => hasExactSavedInput(item, expected, depth + 1)));
}

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

export async function openAidtProblemOutcome({ page, route, link, scope, waitForRoute, assertReady }) {
  // Reentry receives the original captured target, never the possibly stale current URL.
  const target = ownedAidtProblemRoute(link ? await link.getAttribute('href') : route?.href, scope);
  if (route && target.entityId !== route.entityId) fail('S1_ENTITY_ROUTE_CHANGED');
  if (link) {
    await link.click();
    await waitForRoute(() => matchesAidtProblemRoute(page.url(), target));
    if (!matchesAidtProblemRoute(page.url(), target)) fail('S1_ENTITY_NAVIGATION_UNVERIFIED');
  }
  const outcome = new URL(target.href); outcome.searchParams.set('tool', 'outcome');
  await page.goto(outcome.href, { waitUntil: 'domcontentloaded' });
  await waitForRoute(() => matchesAidtProblemRoute(page.url(), target, true));
  if (!matchesAidtProblemRoute(page.url(), target, true)) fail('S1_OUTCOME_NAVIGATION_UNVERIFIED');
  // Must observe the actual entity input; the directory also has aidt-shared-save.
  await assertReady();
  return target;
}

export function assertSavedAidtProblemInput(stage, entityId, expected) {
  const fields = stage?.content?.draft?.fields;
  let entry, draft;
  try { entry = JSON.parse(fields?.[`problemEntity:${entityId}`]); draft = JSON.parse(fields?.[`problemDraft:${entityId}`]); } catch { fail('S1_SAVED_INITIAL_UNVERIFIED'); }
  if (!Number.isInteger(stage?.revision) || stage.revision < 1 || !expected || entry?.id !== entityId
    || entry.archived !== false || draft?.initial !== expected) fail('S1_SAVED_INITIAL_UNVERIFIED');
  return true;
}

export async function requireAcceptedS1Feedback(feedback) {
  // The native Chat callback already records its own precise checkpoint outcome.
  // Keep that record, require literal acceptance, and never retry or confirm on failure.
  if (await feedback() !== true) fail('S1_TEACHING_FEEDBACK_REQUIRED');
}

export function ownedAidtEntityRoute(href, scope, { stage, entityId, report = false, revision } = {}) {
  let url;
  try { url = new URL(href, scope.origin); } catch { fail('ENTITY_ROUTE_INVALID'); }
  const id = url.searchParams.get('entity');
  if (typeof href !== 'string' || !href || url.origin !== scope.origin || url.username || url.password || url.hash
    || url.pathname !== `/aidt/${encodeURIComponent(scope.projectId)}` || !Number.isInteger(stage) || stage < 1 || stage > 6
    || url.searchParams.getAll('step').length !== 1 || url.searchParams.get('step') !== String(stage)
    || url.searchParams.getAll('entity').length !== 1 || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id ?? '')
    || (entityId && id !== entityId) || url.searchParams.has('history')
    || (report ? stage !== 6 || id !== 'group-report' || url.searchParams.getAll('summary').length !== 1 || url.searchParams.get('summary') !== '1' : url.searchParams.has('summary'))
    || (revision === undefined ? url.searchParams.has('entityRevision') : !Number.isInteger(revision) || revision < 1 || revision > 2147483647 || url.searchParams.getAll('entityRevision').length !== 1 || url.searchParams.get('entityRevision') !== String(revision))) fail('ENTITY_ROUTE_INVALID');
  for (const key of ['sourceId', 'timestamp', 'hmwRevision', 'ideaRevision', 'prototypeEntity', 'prototypeRevision', 'problemEntity', 'problemRevision']) if (url.searchParams.getAll(key).length > 1) fail('ENTITY_ROUTE_INVALID');
  return Object.freeze({ href: url.href, ...scope, stage, entityId: id, report, revision });
}

export function matchesAidtEntityRoute(href, target, tool) {
  try {
    ownedAidtEntityRoute(href, target, target);
    const actual = new URL(href, target.origin);
    const expected = new URL(target.href);
    return ['sourceId', 'timestamp', 'hmwRevision', 'ideaRevision', 'prototypeEntity', 'prototypeRevision', 'problemEntity', 'problemRevision'].every(key => actual.searchParams.get(key) === expected.searchParams.get(key))
      && (!tool || actual.searchParams.getAll('tool').length === 1 && actual.searchParams.get('tool') === tool);
  } catch { return false; }
}

export async function openAidtEntityOutcome({ page, target, activate, waitForRoute, assertDetail, assertReady, tool = 'outcome' }) {
  const route = ownedAidtEntityRoute(target.href, target, target);
  if (activate) {
    await activate();
    await waitForRoute(() => matchesAidtEntityRoute(page.url(), route));
    if (!matchesAidtEntityRoute(page.url(), route)) fail('ENTITY_NAVIGATION_UNVERIFIED');
    await assertDetail();
  }
  const url = new URL(route.href); url.searchParams.set('tool', tool);
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  await waitForRoute(() => matchesAidtEntityRoute(page.url(), route, tool));
  if (!matchesAidtEntityRoute(page.url(), route, tool)) fail('ENTITY_OUTCOME_UNVERIFIED');
  await assertReady();
  return route;
}

export function assertSavedAidtHmwSource(stage, expected) {
  let actual; try { actual = JSON.parse(stage?.content?.draft?.fields?.ideaHmwSource); } catch { fail('HMW_SOURCE_NOT_SAVED'); }
  if (!Number.isInteger(stage?.revision) || stage.revision < 1 || actual?.id !== expected.id || actual?.revision !== expected.revision || actual?.text !== expected.text) fail('HMW_SOURCE_NOT_SAVED');
  return true;
}

export async function verifyAidtFrozenBacklink({ page, link, scope, stage, revision, waitForRoute, assertVersion, assertMaterial, materialRequired = stage === 2 }) {
  const target = ownedAidtEntityRoute(await link.getAttribute('href'), scope, { stage, revision });
  await link.click();
  await waitForRoute(() => matchesAidtEntityRoute(page.url(), target));
  if (!matchesAidtEntityRoute(page.url(), target)) fail('FROZEN_SOURCE_NAVIGATION_UNVERIFIED');
  await assertVersion(target);
  if (stage === 2 && materialRequired) {
    if (!new URL(target.href).searchParams.get('sourceId') || typeof assertMaterial !== 'function') fail('FROZEN_MATERIAL_EXPECTATION_MISSING');
    await assertMaterial(target);
  }
  return target;
}


export function interviewCodePattern(code) {
  if (typeof code !== 'string' || !/^U(?:0[1-9]|10)$/.test(code)) fail('INTERVIEW_CODE_UNEXPECTED');
  return new RegExp(`^${code}(?:\\s|$)`);
}

export function hasInterviewPrerequisite({ s1, syntheticHandoff }) {
  return s1 === true || syntheticHandoff === true;
}

export function hasPendingProblemReview(reviews, problemHref, projectId) {
  if (!problemHref) return false;
  const url = new URL(problemHref);
  const thread = url.searchParams.get('thread');
  return Boolean(thread && url.pathname === `/aidt/${projectId}` && url.searchParams.get('step') === '1'
    && reviews.some(({ receipt }) => receipt?.projectId === projectId && receipt.stageId === 1
      && receipt.threadId === thread && receipt.knownConfirmTaskIntent === true && receipt.toolName === 'confirm_task_intent'));
}

export function savedAidtInterviewRoute(stage, code, directory, scope) {
  interviewCodePattern(code);
  const fields = stage?.content?.draft?.fields ?? {}, records = [];
  try {
    for (const [key, raw] of Object.entries(fields)) if (key.startsWith('interviewRecord:')) {
      const record = JSON.parse(raw);
      if (record.code === code) records.push({ key, record });
    }
  } catch { fail('SAVED_INTERVIEW_ENTITY_UNVERIFIED'); }
  const entry = records[0];
  if (!Number.isInteger(stage?.revision) || stage.revision < 1 || records.length !== 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry?.record.id ?? '')
    || entry.key !== `interviewRecord:${entry.record.id}` || fields[`interviewArchived:${entry.record.id}`] === 'true') fail('SAVED_INTERVIEW_ENTITY_UNVERIFIED');
  const url = new URL(directory, scope.origin); url.searchParams.set('entity', entry.record.id);
  return ownedAidtEntityRoute(url.href, scope, { stage: 2, entityId: entry.record.id });
}

// A small, valid, run-specific schematic fixture. It is not a generated prototype or person photo.
export function schematicPng(identity, ordinal) {
  const width = 240, height = 120;
  const seed = createHash('sha256').update(`${identity}:${ordinal}`).digest();
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const start = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      const block = x > 18 && x < 222 && y > 24 && y < 96;
      for (let c = 0; c < 3; c++) raw[start + 1 + x * 3 + c] = block ? seed[(Math.floor(x / 60) + c + ordinal) % seed.length] : 245;
    }
  }
  const crc = bytes => {
    let n = 0xffffffff;
    for (const byte of bytes) { n ^= byte; for (let bit = 0; bit < 8; bit++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0); }
    return (n ^ 0xffffffff) >>> 0;
  };
  const chunk = (kind, data) => {
    const type = Buffer.from(kind); const head = Buffer.alloc(4), tail = Buffer.alloc(4);
    head.writeUInt32BE(data.length); tail.writeUInt32BE(crc(Buffer.concat([type, data])));
    return Buffer.concat([head, type, data, tail]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr),
    chunk('tEXt', Buffer.from(`QA synthetic schematic\0${identity}:${ordinal}`)), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export async function runAidtJourney({ page, expect, scope, checkpoint, capture, api,
  saveStage, reviewAndSave, report, registerFixture, armInterviewEdit, saveReport, saveDownload,
  armDesignCreate, armDesignGeneration, createAnonymousPage, savePrint, teachingFeedback }) {
  if (scope.syntheticLabel !== SYNTHETIC) fail('SYNTHETIC_SCOPE_REQUIRED');
  const root = `/aidt/${encodeURIComponent(scope.projectId)}`;
  const origin = new URL(page.url()).origin;
  const unique = `${scope.runId}-${scope.runAttempt}`.replace(/[^a-zA-Z0-9-]/g, '').slice(-28);
  const text = value => `${SYNTHETIC}。${value}`;
  const feedback = async (stage, studentQuestion, code, finding, fixture) => {
    if (typeof teachingFeedback !== 'function') fail('NATIVE_TEACHING_CHAT_UNAVAILABLE');
    return teachingFeedback(stage, studentQuestion ?? `QA ${scope.runId} 合成软件验收，非真实采访或课堂。请以本步已保存的学生初稿为依据，这是单轮纯文字咨询，只指出一个可完善处并问一个开放问题，不执行方案，不需要任务计划。不要替学生做决定，不保存成果，不调用工具、不生成文件，不把合成资料当真人证据。第${stage}步。`, code, finding, fixture);
  };
  const stageEvidence = new Map();
  report.stageEvidence = [];
  const evidence = stage => {
    if (!stageEvidence.has(stage)) { const row = { stage, scope: 'live_dev', synthetic: true, inputs: [], iterations: [], outputs: [], completion: {}, notes: [], timings: [] }; stageEvidence.set(stage, row); report.stageEvidence.push(row); }
    return stageEvidence.get(stage);
  };
  const savedStage = async stage => { const result = await api(`/api/projects/${scope.projectId}/aidt/stages/${stage}`); if (result.status !== 200 || (result.data?.stage && (result.data.stage.projectId !== scope.projectId || result.data.stage.stageId !== stage || !Number.isInteger(result.data.stage.revision)))) fail('STAGE_REVISION_UNVERIFIED'); return result.data?.stage ?? { revision: 0, content: null }; };
  const revision = async stage => (await savedStage(stage)).revision;
  const observeInputs = async stage => {
    const candidates = stage === 6 ? ['aidt-test-reflection'] : stage === 5 ? ['aidt-prototype-entity-output','aidt-stage-output'] : stage === 4 ? ['aidt-stage-output','aidt-idea-directory'] : stage === 3 ? ['aidt-definition-editor','aidt-stage-output'] : ['aidt-stage-output'];
    let host; for (const id of candidates) { const candidate = page.getByTestId(id); if (await candidate.isVisible()) { host = candidate; break; } }
    if (!host) fail('STAGE_INPUT_OBSERVATION_UNAVAILABLE');
    const fields = await host.evaluate(root => [...root.querySelectorAll('textarea,input:not([type=file]):not([type=password]),select')].filter(node => node.getClientRects().length > 0).map(node => ({ name: (node.labels?.[0]?.innerText || node.getAttribute('aria-label') || node.getAttribute('data-testid') || node.name || node.tagName).trim().slice(0,180), content: node.type === 'checkbox' || node.type === 'radio' ? String(node.checked) : node.value.slice(0,2000), format: node.tagName === 'SELECT' || ['checkbox','radio'].includes(node.type) ? 'student choice in native UI' : 'plain text in native UI' })));
    if (!fields.length) fail('STAGE_INPUT_FIELDS_NOT_OBSERVED');
    const source = { projectId: scope.projectId, entityId: new URL(page.url()).searchParams.get('entity'), tool: new URL(page.url()).searchParams.get('tool'), saved_base_revision: await revision(stage), observation: 'Current native form values; some edits may be confirmed in the next save' };
    for (const field of fields) { const item = { ...field, source }; if (!evidence(stage).inputs.some(existing => JSON.stringify(existing) === JSON.stringify(item))) evidence(stage).inputs.push(item); }
  };
  const iterate = async (stage, field, label, next, saveButton) => {
    const before = await field.inputValue(), beforeRevision = await revision(stage);
    if (before === next) fail('ITERATION_REQUIRES_ACTUAL_INPUT_CHANGE');
    await field.fill(next); await saveStage(stage, saveButton);
    await expect.poll(async () => { const saved = await savedStage(stage); return saved.revision > beforeRevision && hasExactSavedInput(saved.content, next); }, { timeout: 30000 }).toBe(true);
    await page.reload();
    if (stage === 4) await disclosure('分类与描述单');
    await expect(field).toHaveValue(next);
    const after = await field.inputValue(), afterRevision = await revision(stage);
    if (after !== next) fail('ITERATION_INPUT_NOT_RETAINED');
    evidence(stage).iterations.push({ action: `学生编辑${label}并正常保存`, before, after, reason: '学生先保留初稿，再补充更明确的范围；这是软件验收中的合成修订，不是AI或真实研究结论。', reload_value_matched: true, before_revision: beforeRevision, after_revision: afterRevision });
  };
  const printOutput = async (stage, name, button, texts, imageHashes = []) => {
    if (typeof savePrint !== 'function') fail('PRINT_EVIDENCE_CAPTURE_UNAVAILABLE');
    const out = await savePrint({ stage, name, button, requiredTexts: texts, imageHashes });
    evidence(stage).outputs.push({ name, format: 'PDF from application print document and QA Chromium native output', status: 'pass', filename: out.filename, evidence: `SHA256 ${out.sha256}; application document ${out.htmlSha256}; independent glyph check pending`, independent_pdf_validation: 'pending' });
    return out;
  };
  const owned = href => {
    const url = new URL(href, origin);
    if (url.origin !== origin || url.pathname !== root) fail('LINK_OUTSIDE_OWNED_WORKSPACE');
    return url.href;
  };
  const go = async (stage, query = '') => {
    await page.goto(`${origin}${root}${stage ? `?step=${stage}${query}` : ''}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('aidt-project-workspace')).toBeVisible();
  };
  const btn = (name, host = page) => host.getByRole('button', { name, exact: true });
  const click = async locator => { await expect(locator).toBeVisible(); await expect(locator).toBeEnabled(); await locator.click(); };
  const fill = async (label, value, host = page) => { const locator = host.getByLabel(label, { exact: true }); await expect(locator).toBeEditable(); await locator.fill(value); };
  const disclosure = async name => {
    const summary = page.locator('summary').filter({ hasText: name }).first();
    await expect(summary).toBeVisible();
    if (await summary.locator('..').getAttribute('open') === null) await summary.click();
  };
  let lastEntityRoute = null;
  const waitForEntity = predicate => expect.poll(predicate, { timeout: 30000 }).toBe(true);
  const entityReady = async stage => {
    const id = ({ 2: 'aidt-interview-output', 3: 'aidt-definition-editor', 5: 'aidt-prototype-entity-output', 6: 'aidt-test-group-detail' })[stage];
    if (!id) fail('ENTITY_FORM_EXPECTATION_MISSING');
    await expect(page.getByTestId(id)).toBeVisible();
    if (stage === 6) await expect(page.getByTestId(id).getByRole('textbox', { name: '测试任务与追问', exact: true })).toBeEditable();
  };
  const follow = async (name, { resource = false } = {}) => {
    const link = page.getByRole('link', { name, exact: true }); await expect(link).toBeVisible();
    const href = owned(await link.getAttribute('href')), expected = new URL(href);
    const stage = Number(expected.searchParams.get('step'));
    if (!Number.isInteger(stage) || stage < 1 || stage > 6) fail('ENTITY_ROUTE_INVALID');
    const target = expected.searchParams.has('entity') ? ownedAidtEntityRoute(href, { origin, projectId: scope.projectId }, { stage, report: expected.searchParams.get('summary') === '1' }) : null;
    await link.click();
    await waitForEntity(() => target ? matchesAidtEntityRoute(page.url(), target) : new URL(page.url()).pathname === root && new URL(page.url()).searchParams.get('step') === String(stage) && !new URL(page.url()).searchParams.has('entity') && new URL(page.url()).searchParams.get('summary') === expected.searchParams.get('summary'));
    if (target) {
      if (!matchesAidtEntityRoute(page.url(), target)) fail('ENTITY_NAVIGATION_UNVERIFIED');
      await expect(page.getByTestId(resource ? 'design-detail-input' : 'copilotkit-v2-input')).toBeVisible();
    } else await expect(page.getByTestId('aidt-step-entity-directory')).toBeVisible();
    lastEntityRoute = target;
    return href;
  };
  const output = async (target = lastEntityRoute) => {
    if (!target) fail('CAPTURED_ENTITY_REQUIRED');
    return openAidtEntityOutcome({ page, target, waitForRoute: waitForEntity,
      assertReady: () => entityReady(target.stage) });
  };
  const persistConfirmed = async (stage, control, saveControl) => {
    await reviewAndSave(stage, control);
    // Explicit entity confirmation is a local UI action; persist through the normal CAS button.
    const save = saveControl ?? page.getByTestId('aidt-shared-save');
    if (await save.isVisible() && await save.isEnabled()) {
      const [pending] = await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === `/api/projects/${scope.projectId}/aidt/stages/${stage}` && response.request().method() === 'PUT', { timeout: 30000 }),
        click(save),
      ]);
      if (pending.status() !== 200) fail('CONFIRMED_UI_SAVE_NOT_ACKNOWLEDGED');
    }
    if (!saveControl) await expect(page.getByTestId('aidt-shared-status')).toContainText('小组已保存', { timeout: 30000 });
  };
  const shot = async (name, stage) => {
    const url = new URL(page.url());
    if (url.pathname === root && (!stage || url.searchParams.get('step') === String(stage))) await capture(name, stage);
  };
  const check = async (name, stage, fn, image) => checkpoint(name, async () => {
    const started = new Date().toISOString(), tick = performance.now();
    try { await fn(); } finally {
      if (stage) { const duration = performance.now() - tick; const row = { checkpoint: name, owner: 'root/aidt_ui_first_acceptance', started_at: started, finished_at: new Date().toISOString(), duration_seconds: Math.round(duration/1000), maximum_minutes: stage === 5 ? 20 : 15, timed_out: duration > (stage === 5 ? 1200000 : 900000) }; evidence(stage).timings.push(row); evidence(stage).timing ??= row; }
      if (image) await shot(image, stage);
    }
  });
  const uploaded = async (label, filename, bytes, mime) => {
    if (typeof registerFixture !== 'function') fail('UPLOAD_FIXTURE_GUARD_UNAVAILABLE');
    await registerFixture({ filename, bytes, mime });
    const region = page.getByTestId('aidt-research-material-control').filter({ has: page.getByLabel(`${label}选择文件`, { exact: true }) });
    await region.getByLabel(`${label}选择文件`, { exact: true }).setInputFiles({ name: filename, mimeType: mime, buffer: bytes });
    await click(btn('保存原始材料', region));
    await expect(region).toContainText('原件已保存并回读', { timeout: 60000 });
  };
  const completed = async stage => {
    await go();
    await expect(page.getByTestId(`aidt-stage-save-${stage}`)).toContainText('已完成');
    await expect(page.getByTestId(`aidt-stage-save-${stage}`)).toHaveAttribute('data-completed', 'true');
    await capture(`${String(stage).padStart(2,'0')}-completed-overview`);
    await page.reload();
    await expect(page.getByTestId(`aidt-stage-save-${stage}`)).toHaveAttribute('data-completed', 'true');
    await capture(`${String(stage).padStart(2,'0')}-completed-after-reload`);
    const savedRevision = await revision(stage);
    evidence(stage).completion = { confirmed: true, saved: savedRevision > 0, saved_revision: savedRevision, dashboard_marked: true, reload_persisted: true, screenshot_refs: [`${String(stage).padStart(2,'0')}-completed-overview.png`,`${String(stage).padStart(2,'0')}-completed-after-reload.png`] };
    evidence(stage).outputs.push({ name: `第${stage}步已确认成果`, format: 'WorkspaceX shared stage record', status: 'pass', evidence: `saved revision V${savedRevision}; normal UI confirmation, dashboard and reload observed` });
  };
  let interviewDirectory;
  const state = { s1: false, s2: false, s3: false, s4: false, s5: false, s6: false, interviews: [] };
  let step2Href, step3Href, step4Href, step5Href, step6Href, problemHref, problemRoute, personaHref, designId;
  let problemDraftReady = false;
  const problemInitial = text('想了解校园午休中，赶课与闲暇两种情境如何影响饮品选择的犹豫。');
  // Fixed enum/booleans only: no request, URL query, account or error-stack material.
  report.s1Navigation = { operation: 'not-started', entityOutcomeObserved: false, savedInitialObserved: false, reentrySavedInitialObserved: false, teachingCheckpointAccepted: false };
  const openProblem = async link => openAidtProblemOutcome({ page, route: problemRoute, link,
    scope: { origin, projectId: scope.projectId }, waitForRoute: predicate => expect.poll(predicate, { timeout: 30000 }).toBe(true),
    assertReady: async () => { await expect(page.getByTestId('aidt-field-initial')).toBeEditable(); } });
  const problemName = `QA合成选题 ${unique}`;
  const personaName = `QA合成画像 ${unique}`;
  const question = '合成情境中，学生能否从静态队列示意中理解先看等待时间再决定的顺序？';
  const ideaNames = ['QA纸质队列提示', 'QA分时试饮服务', 'QA同伴口味对照'].map(name => `${name} ${unique}`);

  await check('overview', undefined, async () => {
    await go(); await expect(page.getByTestId('aidt-dashboard')).toBeVisible();
    for (let stage = 1; stage <= 6; stage++) await expect(page.getByTestId(`aidt-step-${stage}`)).toBeVisible();
  }, '00-overview');

  await check('s1-draft-not-complete', undefined, async () => {
    report.s1Navigation.operation = 'create-problem';
    await go(1); await fill('问题名称', problemName); await click(btn('新建问题')); await saveStage(1);
    const link = page.getByRole('link', { name: problemName, exact: true });
    await expect(link).toBeVisible();
    report.s1Navigation.operation = 'open-problem-outcome';
    problemRoute = await openProblem(link); report.s1Navigation.entityOutcomeObserved = true;
    await page.getByTestId('aidt-field-initial').fill(text('想了解校园午休时选择饮品的犹豫。'));
    report.s1Navigation.operation = 'save-and-revise-initial';
    await saveStage(1);
    await iterate(1, page.getByTestId('aidt-field-initial'), '原始命题', problemInitial);
    assertSavedAidtProblemInput(await savedStage(1), problemRoute.entityId, problemInitial);
    report.s1Navigation.savedInitialObserved = true;
    problemHref = page.url();
    report.s1Navigation.operation = 'verify-draft-not-complete';
    await go(); await expect(page.getByTestId('aidt-stage-save-1')).not.toHaveAttribute('data-completed', 'true');
    await expect(page.getByTestId('aidt-stage-save-1')).toContainText('草稿');
    problemDraftReady = true;
  }, '01-problem-draft-overview');

  state.s1 = await check('s1-confirmed-reentry', 1, async () => {
    if (!problemDraftReady || !problemRoute || !problemHref) fail('S1_SAVED_DRAFT_REQUIRED');
    report.s1Navigation.operation = 'reenter-saved-problem-outcome';
    assertSavedAidtProblemInput(await savedStage(1), problemRoute.entityId, problemInitial);
    await openProblem();
    await expect(page.getByTestId('aidt-field-initial')).toHaveValue(problemInitial);
    report.s1Navigation.reentrySavedInitialObserved = true;
    report.s1Navigation.operation = 'confirm-problem-reflection';
    await page.getByTestId('aidt-problem-reflection-why').fill(text('练习把宽泛命题缩小成可研究的范围。'));
    await page.getByTestId('aidt-problem-source-guess').check();
    await page.getByTestId('aidt-problem-reflection-details').fill(text('仅为本次QA自拟情境，没有真实受访者或课堂证据。'));
    await page.getByTestId('aidt-problem-reflection-uncertainty').fill('是否存在这种犹豫、由何引起仍未知。');
    await persistConfirmed(1, page.getByTestId('aidt-problem-reflection-confirm'));
    await disclosure('人群、场景与小组讨论');
    for (const [id, value] of Object.entries({ people: '合成场景中的校园学生；不代表已验证人群', scene: '校园午休的饮品选择，区分赶课与闲暇', activity: '先了解等待信息，再决定是否排队', discussion: text('本组自拟拆解：不确定犹豫来自口味、队列还是时间情境；先了解具体经过，不预设App方案。'), focus: '本轮优先研究时间情境与选择信息，其他方向保留。' })) await page.getByTestId(`aidt-field-${id}`).fill(value);
    await page.getByTestId('aidt-field-rewrittenTheme').fill(text('探索校园午休饮品选择中的情境差异，不预设解决方案。'));
    await saveStage(1);
    report.s1Navigation.operation = 'native-teaching-feedback';
    const clarification = text('我们先把这个看法标为猜测，暂时没有亲眼观察或听到抱怨。为了判断是否值得研究，你会先问我们哪个问题？请直接问一个开放问题。');
    await requireAcceptedS1Feedback(() => feedback(1, clarification));
    report.s1Navigation.teachingCheckpointAccepted = true;
    await observeInputs(1);
    report.s1Navigation.operation = 'confirm-round-and-persist';
    await reviewAndSave(1, btn('确认本轮成果并保存'));
    // This one existing round control auto-saves; do not race it with a second CAS click.
    await expect(page.getByTestId('aidt-round-completion')).toContainText('本轮成果已确认并保存', { timeout: 30000 });
    step2Href = owned(await page.getByRole('link', { name: '继续第2步', exact: true }).getAttribute('href'));
    await shot('01-problem-confirmed', 1);
    await follow('返回产物列表');
    report.s1Navigation.operation = 'verify-completed-overview-and-reload';
    await completed(1); await page.reload();
    await expect(page.getByTestId('aidt-stage-save-1')).toHaveAttribute('data-completed', 'true');
    await page.goto(owned(problemHref)); await expect(page.getByTestId('aidt-stage-output')).toContainText('方向已确认');
    await expect(page.getByTestId('aidt-stage-output')).toContainText('探索校园午休饮品选择中的情境差异');
    report.s1Navigation.operation = 'completed';
  }, '01-problem-reentry');

  const readOnlyInterviewOutput = async () => {
    const inspector = page.getByTestId('aidt-interview-output');
    await expect(inspector).toBeVisible();
    // Collapsed editable forms also violate the results-only inspector.
    await expect(inspector.locator('textarea:not([readonly]):not(:disabled), input:not([readonly]):not(:disabled), select:not(:disabled), [contenteditable="true"], button[role="checkbox"]')).toHaveCount(0);
    return inspector;
  };
  const saveInterviewEdit = async operation => {
    armInterviewEdit();
    const [response] = await Promise.all([
      page.waitForResponse(response => response.request().method() === 'PUT'
        && new URL(response.url()).pathname === `/api/projects/${scope.projectId}/aidt/stages/2`, { timeout: 30000 }),
      operation(),
    ]);
    if (response.status() !== 200) fail('INTERVIEW_EDIT_NOT_PERSISTED');
    await expect(page.getByTestId('aidt-interview-save-state')).toContainText('已保存');
  };
  const confirmInInterviewChat = async button => {
    const [response] = await Promise.all([
      page.waitForResponse(response => response.request().method() === 'PUT'
        && new URL(response.url()).pathname === `/api/projects/${scope.projectId}/aidt/stages/2`, { timeout: 30000 }),
      reviewAndSave(2, button),
    ]);
    if (response.status() !== 200) fail('INTERVIEW_CONFIRMATION_NOT_PERSISTED');
  };
  const recordInterviewIteration = (prompt, result, label, target) => {
    const threadId = new URL(page.url()).searchParams.get('thread');
    const proof = report.teachingEvidence.find(row => row.status === 'passed' && row.stageId === 2 && row.threadId === threadId && row.prompt === prompt);
    if (!proof?.inputMessageId || !proof.assistantMessageId || !proof.assistantText) fail('INTERVIEW_ITERATION_NOT_BOUND');
    const source = { entityId: target.entityId, threadId, runId: proof.runId, inputMessageId: proof.inputMessageId, assistantMessageId: proof.assistantMessageId };
    evidence(2).inputs.push({ name: label, content: prompt, format: 'native Chat student message', source });
    evidence(2).iterations.push({ name: label, before: prompt, suggestion: proof.assistantText, after: result,
      reason: 'Student reviewed the reply, edited the result in Chat and explicitly confirmed it.', source });
  };
  const confirmInterviewGuide = async (code, target) => {
    const inspector = await readOnlyInterviewOutput();
    await expect(inspector).toContainText(code);
    const initial = text(`${code}：请回忆最近一次午休选择饮品的经过。先做了什么，后来怎样决定？`);
    if (!await feedback(2, initial, code)) fail('S2_NATIVE_TEACHING_REPLY_REQUIRED');
    const actions = page.getByTestId('aidt-interview-chat-actions');
    const rows = actions.getByTestId('aidt-interview-chat-question');
    await expect(rows.first()).toBeVisible();
    for (const row of await rows.all()) await row.getByRole('checkbox').uncheck();
    const first = rows.first();
    await first.getByRole('checkbox').check();
    await click(btn('编辑这道问题', first));
    const revisedQuestion = first.getByRole('textbox', { name: '修改问题', exact: true });
    await expect(revisedQuestion).not.toHaveValue('');
    const adopted = text(`${code}：请描述最近一次具体选择的经过，你看到了什么，又是怎样作出决定的？`);
    await revisedQuestion.fill(adopted);
    await confirmInInterviewChat(btn('确认这份问题清单', actions));
    const canonical = JSON.parse((await savedStage(2)).content.draft.fields[`interviewRecord:${target.entityId}`]);
    if (canonical.code !== code || canonical.original !== initial || canonical.adopted !== adopted || canonical.guideConfirmed !== true) fail('INTERVIEW_CHAT_GUIDE_NOT_SAVED');
    await expect(inspector.getByTestId('aidt-interview-question-list')).toContainText(adopted);
    recordInterviewIteration(initial, adopted, `${code}问题清单`, target);
    await printOutput(2, `interview-guide-${code}`, inspector.getByTestId('aidt-interview-guide-print'), ['访谈问题清单', code, adopted]);
    return adopted;
  };
  // Keep the pending problem untouched. This is a second QA entity and needs
  // its own successful real answer and student's confirmation before handoff.
  if (!state.s1 && problemHref && hasPendingProblemReview(report.pendingTeachingReviews, problemHref, scope.projectId)) {
    state.syntheticHandoff = await check('synthetic-problem-for-interviews', undefined, async () => {
      const fixtureName = `QA独立访谈前置题 ${unique}`;
      await go(1); await click(btn('新建问题')); await fill('问题名称', fixtureName); await saveStage(1, btn('创建问题'));
      const fixture = await openAidtProblemOutcome({ page, link: page.getByRole('link', { name: fixtureName, exact: true }),
        scope: { origin, projectId: scope.projectId }, waitForRoute: waitForEntity,
        assertReady: () => expect(page.getByTestId('copilotkit-v2-input')).toBeVisible() });
      if (fixture.entityId === problemRoute.entityId) fail('INDEPENDENT_PROBLEM_REQUIRED');
      const initial = text('独立问题：午休时，在食堂饮品窗口的学生如何判断是否排队？我们没有真正采访；课堂练习用的排队经历只是小组猜测。我们选择午休赶课的学生，以时间信息为研究范围，希望追问最近一次排队和放弃经历。我们仍不知道等待信息从哪里获得。请根据这份完整材料整理工作坊问题草稿，保留猜测和待验证项。');
      if (!await feedback(1, initial, undefined, false, true)) fail('SYNTHETIC_PROBLEM_REAL_REPLY_REQUIRED');
      await reviewAndSave(1, btn('确认本轮成果并保存'));
      step2Href = owned(await page.getByRole('link', { name: '继续第2步', exact: true }).getAttribute('href'));
      const destination = new URL(step2Href);
      if (destination.searchParams.get('problemEntity') !== fixture.entityId || !Number(destination.searchParams.get('problemRevision'))) fail('INDEPENDENT_CONFIRMED_SOURCE_UNVERIFIED');
      report.interviewPrerequisite = { mode: 'separately confirmed synthetic problem; original teaching unresolved', entityId: fixture.entityId, revision: Number(destination.searchParams.get('problemRevision')) };
    });
  }
  const tenChatsOpened = await check('s2-ten-card-chats', 2, async () => {
    if (!hasInterviewPrerequisite(state) || !step2Href) fail('S1_CONFIRMED_HANDOFF_REQUIRED');
    const directory = new URL(step2Href); directory.searchParams.delete('entity'); directory.searchParams.delete('tool');
    interviewDirectory = owned(directory.href);
    report.interviewCardChats = [];
    for (let index = 1; index <= 10; index++) {
      const code = `U${String(index).padStart(2, '0')}`;
      await page.goto(interviewDirectory);
      await click(btn('新建访谈')); await saveStage(2);
      const target = savedAidtInterviewRoute(await savedStage(2), code, interviewDirectory, { origin, projectId: scope.projectId });
      await openAidtEntityOutcome({ page, target, activate: () => click(page.getByRole('button', { name: interviewCodePattern(code) })), waitForRoute: waitForEntity,
        assertDetail: () => expect(page.getByTestId('copilotkit-v2-input')).toBeVisible(), assertReady: () => entityReady(2) });
      await expect.poll(() => new URL(page.url()).searchParams.get('thread')).toMatch(/^thr_aidt_/);
      await expect(page.getByTestId('aidt-interview-output')).toContainText(code);
      const threadId = new URL(page.url()).searchParams.get('thread');
      expect(state.interviews.some(item => item.threadId === threadId || item.target.entityId === target.entityId)).toBe(false);
      state.interviews.push({ code, threadId, target, href: page.url(), hasMaterial: false });
      await readOnlyInterviewOutput();
      report.interviewCardChats.push({ code, threadId, entityId: target.entityId, inspectorVisible: true, inspectorReadOnly: true });
    }
  }, '02-ten-card-chats');

  state.s2 = await check('s2-interview-handoff', 2, async () => {
    if (!tenChatsOpened) fail('TEN_INTERVIEW_CHATS_REQUIRED');
    const first = state.interviews[0], { code, target } = first;
    await output(target);
    first.adopted = await confirmInterviewGuide(code, target);
    await click(page.getByTestId('chat-task-workbench-inspector-tab-materials'));
    const materials = page.getByRole('region', { name: '授权和访谈材料' });
    await expect(materials).toBeVisible();
    await page.getByLabel('已获授权共享文字记录', { exact: true }).check(); await saveInterviewEdit(() => click(btn('更新授权记录')));
    const quote = `QA-${code}：我在合成情境中先看队列，再决定是否等待。`;
    await saveInterviewEdit(() => uploaded(`${code}研究原件`, `qa-${unique}-${code}.txt`, Buffer.from(`${SYNTHETIC}。run=${unique}\n第1段 ${quote}\n`), 'text/plain'));
    const select = page.getByRole('combobox', { name: '转写原件', exact: true });
    await expect(select.locator('option')).toHaveCount(2); await saveInterviewEdit(() => select.selectOption({ index: 1 }));
    await saveInterviewEdit(() => fill('定位（如 01:42 或第 3 段）', '第1段'));
    await saveInterviewEdit(() => fill('校对后的摘录', quote));
    await saveInterviewEdit(() => page.getByLabel('已对照原始材料校对', { exact: true }).check());
    const firstFinding = text(`我自己的发现是${code}关注等待时间。来源是第1段的「${quote}」。请帮我检查这个解释和证据的关系。`);
    if (!await feedback(2, firstFinding, code, true)) fail('S2_NATIVE_FINDING_REPLY_REQUIRED');
    const actions = page.getByTestId('aidt-interview-chat-actions');
    await disclosure('整理访谈发现');
    const titleKind = actions.getByRole('combobox', { name: '标题来源', exact: true });
    if (await titleKind.inputValue() !== 'student-summary') await saveInterviewEdit(() => titleKind.selectOption('student-summary'));
    const discoveryEdits = [
      ['一句发现', text(`${code}的合成记录关注等待时间。`)],
      ['学生记录的可观察情况', text('测试夹具仅包含文字情境，不代表实际观察。')],
      ['学生的解释', text('等待与选择可能有关，此解释未验证。')],
      ['可定位的受访者原话', quote],
    ];
    for (const [label, value] of discoveryEdits) {
      const field = actions.getByLabel(label, { exact: true });
      if (await field.inputValue() !== value) await saveInterviewEdit(() => field.fill(value));
    }
    await confirmInInterviewChat(btn('确认人物发现卡', actions));
    await output(target);
    const inspector = await readOnlyInterviewOutput();
    evidence(2).outputs.push({ name: `${code}人物发现卡`, format: 'native finding card; synthetic text, real-person photo missing', status: 'pass', evidence: `Normal UI confirmation at V${await revision(2)}; software scope only` });
    await expect(inspector.getByTestId('aidt-interview-finding')).toContainText(code + '的合成记录关注等待时间');
    recordInterviewIteration(firstFinding, text(`${code}的合成记录关注等待时间。`), `${code}人物发现卡`, target);
    Object.assign(first, { quote, materialName: `qa-${unique}-${code}.txt`, hasMaterial: true });
    await page.goto(interviewDirectory);
    await expect(page.getByRole('button', { name: /^U01 .*发现卡已核对/ })).toBeVisible();
    step3Href = owned(await page.getByRole('link', { name: '带入综合与定义', exact: true }).getAttribute('href'));
    await shot('02-interview-directory', 2); await completed(2); await page.goto(interviewDirectory);
  }, '02-empathy');

  if (tenChatsOpened) {
    for (const interview of state.interviews.slice(1)) {
      await check(`s2-guide-${interview.code.toLowerCase()}`, 2, async () => {
        await output(interview.target);
        interview.adopted = await confirmInterviewGuide(interview.code, interview.target);
      });
    }
  }
  await check('s2-distinct-threads', 2, async () => {
    if (!tenChatsOpened || state.interviews.some(interview => !interview.adopted)) fail('TEN_CONFIRMED_GUIDES_REQUIRED');
    const observed = [];
    report.interviewIsolation = observed;
    for (const interview of [...state.interviews].reverse()) {
      await page.goto(interviewDirectory);
      await expect(page.getByTestId('copilotkit-v2-input')).toHaveCount(0);
      await openAidtEntityOutcome({ page, target: interview.target, activate: () => click(page.getByRole('button', { name: interviewCodePattern(interview.code) })), waitForRoute: waitForEntity,
        assertDetail: () => expect(page.getByTestId('copilotkit-v2-input')).toBeVisible(), assertReady: () => entityReady(2) });
      await expect.poll(() => new URL(page.url()).searchParams.get('thread')).toBe(interview.threadId);
      await page.reload(); await output(interview.target);
      await expect.poll(() => new URL(page.url()).searchParams.get('thread')).toBe(interview.threadId);
      await expect(page.getByTestId('aidt-interview-output')).toContainText(interview.code);
      const timeline = page.getByTestId('copilotkit-v2-messages');
      const proof = report.teachingEvidence.find(row => row.threadId === interview.threadId && row.stageId === 2 && row.status === 'passed');
      if (!proof?.inputMessageId || !proof.assistantMessageId) fail('INTERVIEW_CHAT_HISTORY_UNVERIFIED');
      await expect(timeline.getByTestId('chat-user-message-text').filter({ hasText: proof.prompt })).toBeVisible();
      const messages = await api(`/api/chat/threads/${encodeURIComponent(interview.threadId)}/messages?limit=100`);
      const records = Array.isArray(messages.data) ? messages.data : messages.data?.messages;
      if (messages.status !== 200 || !Array.isArray(records) || messages.data?.nextCursor) fail('INTERVIEW_CHAT_HISTORY_UNVERIFIED');
      const ownReply = records.find(row => row.id === proof.assistantMessageId && row.authorKind === 'agent' && row.agentRunId === proof.runId);
      if (ownReply?.text !== proof.assistantText || !records.some(row => row.id === proof.inputMessageId && row.text === proof.prompt)) fail('INTERVIEW_CHAT_HISTORY_UNVERIFIED');
      // Markdown punctuation is absent from the rendered bubble. Use a text fragment plus the durable identity above.
      const fragment = (ownReply.text.match(/[\p{Script=Han}]{4,}|[a-zA-Z]{5,}/gu) ?? []).sort((a,b) => b.length-a.length)[0];
      if (!fragment) fail('INTERVIEW_REPLY_TEXT_NOT_VISIBLE');
      await expect(timeline.getByTestId('copilot-assistant-message').filter({ hasText: fragment.slice(0, 35) }).first()).toBeVisible();
      for (const sibling of report.teachingEvidence.filter(row => row.stageId === 2 && row.status === 'passed' && row.threadId !== interview.threadId)) {
        await expect(timeline.getByTestId('chat-user-message-text').filter({ hasText: sibling.prompt })).toHaveCount(0);
        if (records.some(row => row.id === sibling.inputMessageId || row.id === sibling.assistantMessageId)) fail('SIBLING_INTERVIEW_MESSAGE_VISIBLE');
      }
      const inspector = await readOnlyInterviewOutput();
      await expect(inspector.getByTestId('aidt-interview-question-list')).toContainText(interview.adopted);
      for (const other of state.interviews.filter(other => other !== interview)) {
        await expect(inspector).not.toContainText(other.adopted);
      }
      expect(new URL(page.url()).searchParams.get('entity')).toBe(new URL(interview.href).searchParams.get('entity'));
      observed.push({ code: interview.code, stableThread: true, savedStudentMessage: true, savedAssistantMessage: true, noSiblingMessages: true, confirmedGuide: true, exportedPdf: true, rightInspector: true, directoryReentry: true, refresh: true });
    }
    report.independentEntityThreadsVerified = true;
  }, '02-independent-chat');

  await check('s2-card-management', 2, async () => {
    if (!interviewDirectory || state.interviews.length !== 10) fail('INTERVIEW_CARDS_REQUIRED');
    await page.goto(interviewDirectory);
    const grid = page.getByRole('list', { name: '访谈卡片', exact: true });
    const cards = grid.getByRole('listitem');
    await expect(cards).toHaveCount(10);
    await click(btn('新建访谈')); await saveStage(2);
    await expect(cards).toHaveCount(11);
    const temporary = cards.filter({ has: page.getByRole('button', { name: /^U11(?:\s|$)/ }) });
    await click(btn('编辑访谈卡', temporary));
    const editor = page.getByRole('dialog', { name: '编辑访谈卡' });
    const name = `临时访谈 ${unique}`;
    const tags = [`QA午休 ${unique}`, `QA饮品 ${unique}`];
    await fill('访谈名称', name, editor);
    const tagInput = editor.getByTestId('interview-tag-input');
    for (const tag of tags) { await tagInput.fill(tag); await tagInput.press('Enter'); }
    await click(btn('保存修改', editor)); await saveStage(2);
    await page.reload();
    await expect(temporary.getByText(name, { exact: true })).toBeVisible();
    const filter = page.getByRole('combobox', { name: '筛选标签', exact: true });
    for (const tag of tags) {
      await filter.selectOption({ label: tag });
      await expect(cards).toHaveCount(1);
      await expect(temporary.getByText(tag, { exact: true })).toBeVisible();
    }
    await filter.selectOption('');
    await click(btn('删除访谈卡', temporary));
    await click(btn('确认删除', page.getByRole('dialog', { name: '删除访谈卡？' })));
    await saveStage(2); await page.reload();
    await expect(cards).toHaveCount(10);
    await expect(temporary).toHaveCount(0);
    await click(btn('查看已移除'));
    await expect(grid.getByText(name, { exact: true })).toBeVisible();
    report.interviewCardManagement = { created: true, editedAfterReload: true, retainedMultipleTags: true, filterMatchedEachTag: true, removedFromActiveAfterReload: true, retainedArchive: true };
  }, '02-interview-card-management');

  state.s3 = await check('s3-definition-hmw-handoff', 3, async () => {
    if (!state.s2 || !step3Href) { await go(3); fail('S2_CONFIRMED_HANDOFF_REQUIRED'); }
    await page.goto(owned(step3Href));
    await page.getByRole('radio', { name: '暂无意外发现', exact: true }).check();
    await persistConfirmed(3, page.getByTestId('aidt-surprise-confirm'));
    await click(btn('新建画像')); await saveStage(3); await follow('未命名画像'); await output();
    await fill('画像名称', personaName); await fill('用户情境', text('午休时的饮品选择合成情境。'));
    await fill('可观察的行为', text('夹具中的人物先看队列。')); await fill('需求', text('了解等待信息，仍需真实研究。'));
    await fill('反例、适用范围或仍未知的地方', '只有QA合成材料，年龄、兴趣与真实行为均未知。');
    await page.getByRole('group', { name: /^关联已确认的人物发现卡/ }).getByRole('checkbox', { name: /^U01/ }).check();
    await saveStage(3);
    await iterate(3, page.getByRole('textbox', { name: '可观察的行为', exact: true }), '画像的行为范围', text('合成夹具中人物先看队列；赶时间与闲暇情境需要分开理解，尚不能推广到真实人群。'));
    await observeInputs(3);
    await persistConfirmed(3, btn('确认画像')); personaHref = page.url();
    evidence(3).outputs.push({ name: personaName, format: 'native confirmed persona with discovery-card references', status: 'pass', evidence: `V${await revision(3)}` });
    await follow('返回产物列表'); await click(btn('新建 HMW')); await saveStage(3); await follow('未命名 HMW'); await output();
    await fill('我们如何……（HMW）', text('我们如何帮助午休赶时间的学生理解等待信息，同时保留不同选择？'));
    await fill('选择理由或待核实处', '来自本次合成发现卡；是否适用于真实学生仍待验证。');
    await page.getByRole('group', { name: '关联已确认画像', exact: true }).getByRole('checkbox', { name: personaName, exact: true }).check();
    await page.getByRole('group', { name: /^关联已确认的人物发现卡/ }).getByRole('checkbox', { name: /^U01/ }).check();
    await saveStage(3);
    await iterate(3, page.getByRole('textbox', { name: '我们如何……（HMW）', exact: true }), 'HMW表述', text('我们如何帮助不同时间情境中的学生理解等待信息，并保留多种自主选择？'));
    await feedback(3);
    await observeInputs(3);
    await persistConfirmed(3, btn('确认 HMW')); await persistConfirmed(3, btn('选为本轮 HMW'));
    evidence(3).outputs.push({ name: '本轮选定HMW及暂无意外发现记录', format: 'native confirmed HMW and source-card links', status: 'pass', evidence: `V${await revision(3)}; 暂无 is a valid branch, no invented surprise` });
    await follow('返回产物列表'); step4Href = owned(await page.getByRole('link', { name: '带入创意发散', exact: true }).getAttribute('href'));
    await shot('03-definition-directory', 3); await completed(3); await page.goto(owned(step3Href));
  }, '03-definition');

  state.s4 = await check('s4-three-distinct-descriptions', 4, async () => {
    if (!state.s3 || !step4Href) { await go(4); fail('S3_CONFIRMED_HANDOFF_REQUIRED'); }
    await page.goto(owned(step4Href));
    for (const name of ideaNames) { await fill('点子名称', name); await click(btn('新建点子')); await saveStage(4); }
    await disclosure('分类与描述单');
    const hmwStage = await savedStage(3), hmwId = hmwStage.content.draft.fields.definitionHmwId;
    let hmw; try { hmw = JSON.parse(hmwStage.content.draft.fields[`definitionHmw:${hmwId}`]); } catch { fail('SELECTED_HMW_UNVERIFIED'); }
    if (hmw?.id !== hmwId || !hmw.confirmed || hmw.archived || typeof hmw.text !== 'string' || !hmw.text.trim() || String(hmwStage.revision) !== new URL(step4Href).searchParams.get('hmwRevision')) fail('SELECTED_HMW_UNVERIFIED');
    const expectedHmw = { id: hmwId, revision: hmwStage.revision, text: hmw.text };
    let pinned; try { pinned = JSON.parse((await savedStage(4)).content.draft.fields.ideaHmwSource); } catch { /* Must use the visible adoption action. */ }
    if (!pinned) { await click(btn('将此 HMW 用于本轮')); await saveStage(4); }
    assertSavedAidtHmwSource(await savedStage(4), expectedHmw);
    for (let index = 1; index <= 3; index++) {
      await page.getByLabel(`候选${index}核心说明`, { exact: true }).fill(`${SYNTHETIC}\n${['用纸质提示展示队列和预计等待，让学生先了解信息。学生可以据此自主决定是否加入队列，实际效果仍待真实测试。', '用分时预约说明不同可选时段和领取顺序。它帮助学生比较时间安排，是否减少等待需要真实服务测试。', '用同伴口味对照记录展示不同人的偏好和具体描述。学生可据此比较选择，但不能把少数意见当成所有人的偏好。'][index-1]}`);
      await uploaded(`候选${index}原始图片`, `qa-${unique}-idea-${index}.png`, schematicPng(unique, index), 'image/png');
    }
    await saveStage(4);
    await iterate(4, page.getByLabel('候选1核心说明', { exact: true }), '首个点子的核心说明', `${SYNTHETIC}。纸质提示展示队列与预计等待，学生先看再自主决定。它只解释信息，不证明真实等待或偏好已得到改善。`);
    const categories = ['最容易实现的', '最具突破性的', '最有趣的'];
    for (let index = 0; index < 3; index++) {
      await page.getByLabel(`${ideaNames[index]} · ${categories[index]}`, { exact: true }).check();
      await page.getByLabel(`${ideaNames[index]} · 分类理由`, { exact: true }).fill(text('这是本次QA学生选择，不是AI自动决定。'));
    }
    await saveStage(4);
    const ideaDirectoryHref = page.url();
    await follow(`打开「${ideaNames[0]}」对话`); await feedback(4);
    await page.goto(owned(ideaDirectoryHref)); await disclosure('分类与描述单');
    await persistConfirmed(4, btn('确认本组分类'));
    await page.getByRole('checkbox', { name: '本组已比较：这些是不同点子，说明讲清做什么及如何帮助用户。', exact: true }).check();
    await click(page.getByTestId('aidt-idea-sheets-open'));
    await expect(page.getByTestId('aidt-idea-sheet')).toHaveCount(3);
    for (const name of ideaNames) await expect(page.getByTestId('aidt-idea-sheets-preview')).toContainText(name);
    await persistConfirmed(4, btn('确认本轮描述单'));
    for (let i = 1; i <= 3; i++) { const core = await page.getByLabel(`候选${i}核心说明`, { exact: true }).inputValue(); await printOutput(4, `idea-description-${i}`, page.getByTestId(`aidt-idea-sheet-print-${i}`), [ideaNames[i-1], core], [createHash('sha256').update(schematicPng(unique,i)).digest('hex')]); }
    await page.getByRole('group', { name: '带入原型的点子', exact: true }).getByRole('checkbox', { name: ideaNames[0], exact: true }).check();
    await saveStage(4);
    step5Href = owned(await page.getByRole('link', { name: '带入原型制作', exact: true }).getAttribute('href'));
    await observeInputs(4);
    await shot('04-three-idea-descriptions', 4); await completed(4); await page.goto(owned(step4Href));
    report.threeDistinctDescriptionPreviewsVerified = true;
    report.descriptionPdfBytesGenerated = true;
    report.descriptionPdfIndependentGlyphValidation = 'pending artifact download';
  }, '04-ideas');

  state.s5 = await check('s5-prototype-question-version', 5, async () => {
    if (!state.s4 || !step5Href) { await go(5); fail('S4_CONFIRMED_HANDOFF_REQUIRED'); }
    if (typeof armDesignGeneration !== 'function' || typeof armDesignCreate !== 'function') fail('BOUNDED_DESIGN_GENERATION_GUARD_REQUIRED');
    await page.goto(owned(step5Href));
    const createDesign = page.getByTestId('project-resources-new'); await expect(createDesign).toBeVisible(); await expect(createDesign).toBeEnabled();
    await armDesignCreate(); await createDesign.click();
    await expect.poll(() => new URL(page.url()).searchParams.get('entity')).toBeTruthy();
    designId = new URL(page.url()).searchParams.get('entity'); const entityHref = page.url();
    const designRoute = ownedAidtEntityRoute(entityHref, { origin, projectId: scope.projectId }, { stage: 5, entityId: designId });
    await output(designRoute);
    await click(page.getByRole('button', { name: /^采用第 4 步 V\d+ 的 \d+ 个点子$/ }));
    await fill('通过这次制作原型，你最想知道什么？', '学生能理解提示吗？');
    await disclosure('补充先前看法与验证范围');
    await fill('测试前，你们怎么想？', text('目前不确定，预计静态图只能检查理解。'));
    await fill('目前看法的依据', text('仅来自QA合成发现卡，不是已验证的研究事实。'));
    await fill('这个原型能了解什么，还有什么不能验证？', '能检查示意顺序的理解，不能证明真实等待、时间投入或付费行为。');
    const fields = page.getByTestId('aidt-prototype-entity-output').getByRole('group', { name: '原型制作说明', exact: true }).getByRole('textbox');
    const descriptions = ['静态界面示意图', '合成校园午休情境', '先看提示再决定', '选择、查看队列、决定等待', '解释等待信息与操作顺序'];
    for (let index = 0; index < await fields.count(); index++) await fields.nth(index).fill(text(descriptions[index] ?? '表达当前验证范围。'));
    await saveStage(5);
    await iterate(5, page.getByLabel('通过这次制作原型，你最想知道什么？', { exact: true }), '本轮验证问题', question);
    await feedback(5);
    await observeInputs(5);
    evidence(5).notes.push('本轮真实迭代是原型制作前验证问题/制作说明的保存修订；仅调用一次Design生成，没有把再次确认同一文件冒充原型第二版。');
    await persistConfirmed(5, btn('确认本轮验证问题'));
    await follow('打开原生 Design Workbench', { resource: true });
    await expect(page.getByTestId('design-detail-input')).toBeEditable();
    await page.getByTestId('design-detail-input').fill(`${SYNTHETIC}。QA run=${scope.runId}。请生成一页静态校园饮品队列提示界面，标题明确QA合成演示；展示预计等待时间、查看口味、决定是否排队三个区块。只用于检查理解，不宣称有真实研究或用户认可。`);
    const send = page.getByTestId('design-detail-send'); await expect(send).toBeEnabled(); await armDesignGeneration();
    const [generationReceipt] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === `/api/pm-designs/${encodeURIComponent(designId)}/chat` && response.request().method() === 'POST', { timeout: 930000 }),
      send.click(),
    ]);
    if (!generationReceipt.ok()) fail('DESIGN_GENERATION_NOT_SUCCESSFUL');
    // The actual version picker below must verify generated frames; an HTTP response alone is insufficient.
    await expect(send).toBeEnabled({ timeout: 930000 });
    await shot('05-design-generated', 5);
    await output(designRoute);
    const picker = page.getByTestId('aidt-prototype-version-picker'); await click(btn('选择真实原型版本', picker));
    await click(picker.locator('[aria-label="已关联的设计"]').getByRole('button', { name: '未命名设计', exact: true }));
    await click(picker.getByRole('button', { name: /^选择 v\d+：/ }).first());
    await expect(page.getByTestId('aidt-prototype-recorded-reference')).toContainText(/已生成 [1-9]\d*\//);
    await persistConfirmed(5, btn('确认所选原型'));
    evidence(5).outputs.push({ name: '已选静态原型与绑定验证问题', format: 'native Design version reference and verification question', status: 'pass', evidence: (await page.getByTestId('aidt-prototype-recorded-reference').innerText()).slice(0,2000) });
    step6Href = owned(await page.getByRole('link', { name: '带入测试与迭代', exact: true }).getAttribute('href'));
    await shot('05-prototype-question-version', 5); await completed(5); await output(designRoute);
    report.designGenerationAndVersionWorkflowVerified = true;
    report.designProviderIndependentlyVerified = false;
  }, '05-prototype');

  state.s6 = await check('s6-test-reflection', 6, async () => {
    if (!state.s5 || !step6Href) { await go(6); fail('S5_REAL_VERSION_HANDOFF_REQUIRED'); }
    await page.goto(owned(step6Href)); await fill('测试名称', `QA合成测试 ${unique}`); await click(btn('新建测试草稿'));
    // Directory saves are normal non-confirming UI actions, not a seeded test entity.
    await saveStage(6, btn('保存本轮测试与反思'));
    const savedDirectoryHref = page.url();
    await follow('打开刚保存的测试'); await output();
    const detail = page.getByTestId('aidt-test-group-detail'); await expect(detail).toBeVisible();
    await fill('参与者代号', `QA合成对象 ${unique}`, detail);
    await fill('测试情境', text('只用于软件验收的虚构午休情境，未接触真实受访者。'), detail);
    await fill('测试任务与追问', text('请指出示意图里先看等待信息再选择的顺序；这是一份待真实对象测试的计划。'), detail);
    await fill('原件位置（时间点、答卷或批次）', '合成记录第1段', detail);
    const syntheticTestRecord = text('QA记录：本次仅校验软件如何保存原型、测试计划和反馈位置，没有真实用户行为。');
    await uploaded('本组原始材料', `qa-${unique}-test.txt`, Buffer.from(syntheticTestRecord), 'text/plain');
    await fill('原话或问卷原始回答', text('合成夹具文字，不是真人引文；真实回答尚未采集。'), detail);
    await fill('现场观察到的行为', '本次未观察真人行为。', detail);
    await fill('学生解释', '当前只是软件验收，不能由合成材料判断方案有效。', detail);
    await fill('学生对本组测试的反思', '正式研究需授权真实对象并核对记录。', detail);
    await saveStage(6);
    await iterate(6, detail.getByRole('textbox', { name: '测试任务与追问', exact: true }), '待实施的测试问题', text('正式测试时先请对象说明自己会做哪一步，再追问不理解之处；本次不诱导赞同，不声称已经真实测试。'));
    await feedback(6);
    const nativeFields = await detail.locator('input,textarea,select').evaluateAll(nodes => nodes.filter(node => node.getClientRects().length > 0 && node.type !== 'file').map(node => ({ name: (node.labels?.[0]?.innerText || node.tagName).trim().slice(0,180), content: node.value.slice(0,2000), format: 'native test plan/material form' })));
    const nativePlanRevision = await revision(6);
    evidence(6).inputs.push(...nativeFields.map(field => ({ ...field, source: { projectId: scope.projectId, entityId: new URL(page.url()).searchParams.get('entity'), saved_base_revision: nativePlanRevision, observation: 'Native test entity planning and explicitly synthetic material, not a real participant test' } })));
    await shot('06-native-test-plan-and-material', 6);
    await page.goto(owned(savedDirectoryHref));
    const reflection = page.getByTestId('aidt-test-reflection'); await expect(reflection).toBeVisible();
    await expect(reflection.getByTestId('aidt-bound-question')).toContainText(question);
    await reflection.getByRole('combobox', { name: '测试之后，对这个问题的认识有什么变化？', exact: true }).selectOption('insufficient');
    await fill('测试后的认识', text('本次只有合成软件验收，没有真实对象测试，不能判断方案效果。'), reflection);
    await fill('支持判断的测试材料', 'QA合成记录；未采集真实用户行为。', reflection);
    await fill('仍不确定的地方', '需要真实对象理解反馈及实际情境观察，当前证据不足。', reflection);
    await reflection.getByRole('combobox', { name: '如果继续改进，优先从哪一步重新入手？', exact: true }).selectOption('2');
    await fill('为什么从这里重新入手？', '需要真实访谈，不能用QA合成夹具支持效果判断。', reflection);
    await fill('下一步具体做什么？', '取得适当授权后补充真实访谈，再回看原问题；本次不生成新版。', reflection);
    await saveStage(6, btn('保存本轮测试与反思'));
    await iterate(6, reflection.getByRole('textbox', { name: '测试后的认识', exact: true }), '证据不足时的认识', text('本次只有合成软件验收，未测试真实对象；认识暂不能改变，下一轮先补真实访谈后判断情境差异。'), btn('保存本轮测试与反思'));
    await observeInputs(6);
    await persistConfirmed(6, btn('确认本轮学习记录', reflection), btn('保存本轮测试与反思'));
    await page.reload(); await expect(page.getByTestId('aidt-test-reflection')).toContainText('本轮学习记录已确认');
    await shot('06-reflection-insufficient-return-empathy', 6); await completed(6); await page.goto(owned(step6Href));
    evidence(6).notes.push('没有真人测试；本次明确选择证据不足并回共情研究，保存本轮认识与行动，未强制生成新版原型。');
    report.insufficientEvidenceAndReturnWithoutNewPrototypeVerified = true;
  }, '06-reflection');

  await check('report-confirmed-source-export', 6, async () => {
    if (!state.s6) { await go(6, '&summary=1'); fail('S6_REFLECTION_REQUIRED'); }
    if (typeof saveReport !== 'function') fail('REPORT_NORMAL_SAVE_GUARD_REQUIRED');
    await go(6, '&summary=1');
    const open = page.getByRole('link', { name: '打开小组研究报告', exact: true }); await expect(open).toBeVisible();
    const reportTarget = ownedAidtEntityRoute(await open.getAttribute('href'), { origin, projectId: scope.projectId }, { stage: 6, entityId: 'group-report', report: true });
    await openAidtEntityOutcome({ page, target: reportTarget, activate: () => click(open), waitForRoute: waitForEntity,
      assertDetail: () => expect(page.getByTestId('copilotkit-v2-input')).toBeVisible(), tool: 'report',
      assertReady: async () => { await expect(page.getByTestId('aidt-report-preview')).toBeVisible(); await expect(page.getByTestId('aidt-report-reload')).toBeEnabled(); } });
    const reportUrl = new URL(page.url());
    const reportRegion = page.getByTestId('aidt-report-preview'); await expect(reportRegion).toBeVisible();
    await click(btn('编辑报告', reportRegion));
    const draft = reportRegion.getByLabel('小组报告草稿', { exact: true });
    await expect(draft).toHaveValue(/合成/);
    const initial = await draft.inputValue();
    await draft.fill(`${initial}\n\n## QA验收边界\n${SYNTHETIC}。本次验证软件流程与来源追溯，没有进行真实课堂或真实访谈，方案效果尚待验证。\n`);
    await disclosure('选择报告引用的阶段版本');
    for (let stage = 1; stage <= 6; stage++) {
      const sourceSelect = reportRegion.locator('label').filter({ has: page.locator('span').filter({ hasText: new RegExp(`^第 ${stage} 步$`) }) }).locator('select');
      await expect(sourceSelect).toBeEnabled(); await sourceSelect.selectOption({ index: 1 });
    }
    await saveReport(); await click(btn('阅读预览', reportRegion)); await click(btn('确认审阅此版本', reportRegion));
    await reviewAndSave(6, btn('确认小组报告', reportRegion));
    await expect(page.getByTestId('aidt-report-save-state')).toContainText('已确认');
    await disclosure('已确认版本与导出');
    const readVersion = page.getByRole('button', { name: /^查看确认版 V\d+$/ }); await click(readVersion);
    await expect(page.getByRole('article', { name: '已确认报告正文', exact: true })).toContainText(SYNTHETIC);
    const sources = page.getByRole('list', { name: '确认版本来源', exact: true }); await expect(sources).toBeVisible();
    for (let stage = 1; stage <= 6; stage++) await expect(sources).toContainText(`第 ${stage} 步`);
    const [download] = await Promise.all([page.waitForEvent('download'), click(page.getByRole('button', { name: /^下载 V\d+ Markdown$/ }))]);
    if (typeof saveDownload !== 'function') fail('REPORT_SAFE_DOWNLOAD_STORAGE_REQUIRED');
    await saveDownload(download);
    if (await download.failure()) fail('REPORT_DOWNLOAD_FAILED');
    const stream = await download.createReadStream(); if (!stream) fail('REPORT_DOWNLOAD_UNREADABLE');
    let bytes = 0; const chunks = []; for await (const chunk of stream) { bytes += chunk.length; if (bytes > 1000000) fail('REPORT_DOWNLOAD_TOO_LARGE'); chunks.push(chunk); }
    const content = Buffer.concat(chunks), exportedText = content.toString('utf8'); expect(exportedText).toContain(SYNTHETIC);
    const requiredReportHighlights = ['探索校园午休饮品选择中的情境差异', 'U01的合成记录关注等待时间', personaName, '我们如何帮助不同时间情境中的学生理解等待信息', ...ideaNames, question, '本次只有合成软件验收，未测试真实对象', '需要真实访谈'];
    for (const text of requiredReportHighlights) { expect(exportedText).toContain(text); await expect(page.getByRole('article', { name: '已确认报告正文', exact: true })).toContainText(text); }
    report.nativeReportContentChecks = requiredReportHighlights.map(text => ({ text, observedInConfirmedBody: true, observedInDownloadedMarkdown: true }));
    report.confirmedReportExport = { bytes, sha256: createHash('sha256').update(content).digest('hex'), format: 'markdown' };
    await printOutput(6, 'confirmed-group-report', page.getByRole('button', { name: /^打印 V\d+ PDF$/ }), [SYNTHETIC, 'QA验收边界']);
    const confirmedState = await page.getByTestId('aidt-report-save-state').innerText();
    const confirmedMatch = confirmedState.match(/已确认 · V(\d+)/); if (!confirmedMatch) fail('CONFIRMED_REPORT_REVISION_MISSING');
    const confirmedRevision = Number(confirmedMatch[1]);
    const openFrozenSources = async stage => {
      await page.goto(owned(reportUrl.href), { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('aidt-report-reload')).toBeEnabled();
      await disclosure('已确认版本与导出');
      await click(page.getByRole('button', { name: `查看确认版 V${confirmedRevision}`, exact: true }));
      await expect(page.getByRole('article', { name: '已确认报告正文', exact: true })).toContainText(SYNTHETIC);
      const source = page.getByRole('list', { name: '确认版本来源', exact: true });
      const button = source.getByRole('button', { name: new RegExp(`^查看第 ${stage} 步 V\\d+$`) });
      await expect(button).toBeVisible(); const match = (await button.innerText()).match(/V(\d+)$/);
      if (!match) fail('REPORT_SOURCE_REVISION_MISSING');
      const revision = Number(match[1]); await click(button);
      const details = page.locator('[aria-label="来源版本详情"]'); await expect(details).toContainText(`第 ${stage} 步 V${revision}`);
      return { details, revision };
    };
    report.reportSourceLinks = [];
    for (let stage = 1; stage <= 6; stage++) {
      const { details, revision } = await openFrozenSources(stage);
      const links = await details.getByRole('link').evaluateAll(nodes => nodes.map(node => ({ title: node.textContent, href: node.getAttribute('href') })));
      if (!links.length) fail('REPORT_ENTITY_BACKLINK_MISSING');
      for (const item of links) {
        const restored = await openFrozenSources(stage);
        if (restored.revision !== revision) fail('FROZEN_SOURCE_REVISION_CHANGED');
        const link = restored.details.getByRole('link', { name: item.title.trim(), exact: true });
        const expectedRoute = ownedAidtEntityRoute(item.href, { origin, projectId: scope.projectId }, { stage, revision });
        const expectedInterview = stage === 2 ? state.interviews.find(row => row.target.entityId === expectedRoute.entityId) : undefined;
        if (stage === 2 && !expectedInterview) fail('FROZEN_INTERVIEW_EXPECTATION_MISSING');
        const materialRequired = stage === 2 && expectedInterview.hasMaterial === true;
        if (materialRequired && (!expectedInterview.quote || !expectedInterview.materialName)) fail('FROZEN_MATERIAL_EXPECTATION_MISSING');
        const target = await verifyAidtFrozenBacklink({ page, link, scope: { origin, projectId: scope.projectId }, stage, revision, waitForRoute: waitForEntity,
          materialRequired,
          assertVersion: async () => { const history = page.getByTestId('aidt-entity-history'); await expect(history).toBeVisible(); await expect(history.getByRole('heading', { level: 1 })).toHaveText(new RegExp(` · V${revision}$`)); await expect(history).toContainText('已保存的历史版本。'); await expect(history).toContainText(SYNTHETIC); },
          assertMaterial: async target => {
            const interview = expectedInterview;
            const material = page.getByTestId('aidt-research-material-preview').filter({ hasText: interview.materialName });
            await expect(material).toBeVisible(); await expect(material).toContainText(new URL(target.href).searchParams.get('sourceId'));
            const original = material.getByTestId('aidt-research-original-text'); await expect(original).toBeVisible(); await expect(original).toContainText(interview.quote); await expect(original).toContainText(SYNTHETIC);
          } });
        item.clicked = true; item.frozenRevision = revision; item.entityId = target.entityId; item.materialVerified = materialRequired; item.guideOnly = stage === 2 && expectedInterview.hasMaterial === false;
      }
      report.reportSourceLinks.push({ stage, revision, links });
    }
    await openFrozenSources(6);
  }, '07-confirmed-report');

  await check('six-stage-completion', undefined, async () => {
    if (![state.s1,state.s2,state.s3,state.s4,state.s5,state.s6].every(Boolean)) fail('SIX_NORMAL_UI_HANDOFFS_REQUIRED');
    await go(); await page.reload();
    for (let stage = 1; stage <= 6; stage++) await expect(page.getByTestId(`aidt-stage-save-${stage}`)).toHaveAttribute('data-completed', 'true');
    report.sixStageCompletionSurvivesReload = true;
  }, '08-completed-overview');

  await checkpoint('anonymous-access-boundary', async () => {
    if (typeof createAnonymousPage !== 'function') fail('ANONYMOUS_GUARD_UNAVAILABLE');
    const anon = await createAnonymousPage();
    try {
      await anon.page.goto(`${origin}${root}`, { waitUntil: 'domcontentloaded' });
      await expect(anon.page.getByTestId('aidt-shared-save')).toHaveCount(0);
      await expect(anon.page.getByTestId('aidt-dashboard')).toHaveCount(0);
      await expect(anon.page.getByText(scope.projectName, { exact: true })).toHaveCount(0);
      await expect.poll(async () => /\/login(?:\/|$)/.test(new URL(anon.page.url()).pathname) || await anon.page.getByText(/登录后|请先登录|登录以/).count() > 0).toBe(true);
      report.anonymousBoundaryVerified = true;
    } finally { await anon.close(); }
  });
  // No second authenticated actor was used; anonymous access is not a cross-user matrix.
  report.crossUserIsolationVerified = false;
}
