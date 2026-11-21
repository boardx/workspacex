/** Live Dev acceptance: only visible UI creates/edits/explicitly confirms owned QA data.
 * A synthetic journey checks software behavior, never real interviews or classroom outcomes.
 * Credentials, request allowlists, run identity and evidence publication belong to the runner.
 */
import { collectNativeSurvey, surveyFixture } from './devapp-aidt-survey.mjs';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { ProbeFailure } from './devapp-aidt-auth-readonly.mjs';

export const REQUIRED_CHECKS = Object.freeze([
  'overview', 's1-draft-not-complete', 's1-confirmed-reentry',
  's2-ten-card-chats', 's2-interview-handoff',
  ...Array.from({ length: 10 }, (_, index) => `s2-interview-u${String(index + 1).padStart(2, '0')}`),
  's2-distinct-threads', 's2-card-management', 's3-definition-hmw-handoff',
  's4-brainstorm-five-to-two', 's5-prototype-question-version',
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

const textHash = value => createHash('sha256').update(value, 'utf8').digest('hex');
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value ?? '');
const textWithin = (value, limit = 6000) => typeof value === 'string' && Boolean(value.trim()) && value.length <= limit;

/** Select the precise original turn, never the first passed S1 or a diagnostic fixture. */
export function aidtS1Question(proofs, scope) {
  if (!scope || !textWithin(scope.projectId, 256) || !uuid(scope.entityId) || !/^thr[A-Za-z0-9_.:-]{1,252}$/.test(scope.threadId ?? '')
    || !/^[a-f0-9]{40}$/.test(scope.source ?? '') || !/^[0-9]+-[0-9]+$/.test(scope.tag ?? '')
    || !['teaching-chat-stage-1', 'teaching-chat-stage-1-revision'].includes(scope.checkpoint)
    || !textWithin(scope.prompt, 5000) || !Number.isSafeInteger(scope.revision) || scope.revision < 1) fail('S1_ACTUAL_QUESTION_UNVERIFIED');
  const rows = Array.isArray(proofs) ? proofs.filter(row => row?.stageId === 1 && row.checkpoint === scope.checkpoint && row.syntheticProblemFixture === false) : [];
  const proof = rows[0];
  if (rows.length !== 1 || proof.status !== 'passed' || proof.projectId !== scope.projectId || proof.entityId !== scope.entityId
    || proof.threadId !== scope.threadId || proof.source !== scope.source || proof.tag !== scope.tag || proof.prompt !== scope.prompt
    || !textWithin(proof.assistantText) || proof.assistantTextSha256 !== textHash(proof.assistantText)
    || proof.studentTextSha256 !== textHash(scope.prompt)
    || ['runId','inputMessageId','assistantMessageId'].some(key => !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test(proof[key] ?? ''))
    || !Array.isArray(proof.sourceRevisions) || proof.sourceRevisions.length !== 1
    || proof.sourceRevisions[0]?.stageId !== 1 || proof.sourceRevisions[0]?.revision !== scope.revision) fail('S1_ACTUAL_QUESTION_UNVERIFIED');
  return Object.freeze({ projectId: scope.projectId, entityId: scope.entityId, threadId: scope.threadId,
    runId: proof.runId, inputMessageId: proof.inputMessageId, assistantMessageId: proof.assistantMessageId,
    assistantText: proof.assistantText, assistantTextSha256: proof.assistantTextSha256,
    studentPrompt: scope.prompt, revision: scope.revision });
}

/** No default answer and no form-write fallback. This hook is not H03 dialogue signoff. */
export async function prepareAidtS1NativeResponse(question, reviewStudentResponse) {
  if (typeof reviewStudentResponse !== 'function') fail('S1_I3_STUDENT_RESPONSE_REVIEW_REQUIRED');
  const review = await reviewStudentResponse(question);
  if (review?.approved !== true || ['projectId','entityId','threadId','runId','inputMessageId','assistantMessageId','assistantTextSha256']
    .some(key => review[key] !== question[key]) || !textWithin(review.response, 3000)
    || review.response.trim() === question.assistantText.trim() || !textWithin(review.selectedDirection, 120)
    || !textWithin(review.choiceReason, 650) || !textWithin(review.rewrittenTheme, 650)) fail('S1_I3_STUDENT_RESPONSE_REVIEW_REQUIRED');
  const prompt = `${SYNTHETIC}。\n上次引导师的追问（仅供对照）：\n${question.assistantText}\n\n学生的回答：\n${review.response}\n本组选择的研究方向：${review.selectedDirection}\n选择及取舍理由：${review.choiceReason}\n学生重写命题：${review.rewrittenTheme}\n请按学生自己的选择更新工作坊草稿，逐字保留原始命题、研究范围和学生重写命题；仍未知的地方保留未知。只整理草稿，不确认成果，不调用工具、不生成文件。`;
  if (prompt.length > 5000) fail('S1_I3_STUDENT_RESPONSE_REVIEW_REQUIRED');
  return Object.freeze({ prompt, response: review.response, selectedDirection: review.selectedDirection,
    choiceReason: review.choiceReason, rewrittenTheme: review.rewrittenTheme, question,
    h03ConversationSignoff: false, teachingQualityAccepted: false });
}

/** One existing second native turn; no form mutation, retry, confirmation or extra send. */
export async function runAidtS1NativeRevision({ question, original, reviewStudentResponse,
  sendStudentResponse, readReply, readSaved, reload, assertUi }) {
  const review = await prepareAidtS1NativeResponse(question, reviewStudentResponse);
  await requireAcceptedS1Feedback(() => sendStudentResponse(review.prompt));
  const reply = await readReply(review.prompt);
  if (reply.projectId !== question.projectId || reply.entityId !== question.entityId || reply.threadId !== question.threadId
    || reply.studentPrompt !== review.prompt || reply.revision !== original.revision
    || ['runId','inputMessageId','assistantMessageId'].some(key => reply[key] === question[key])) fail('S1_NATIVE_RESPONSE_UNVERIFIED');
  const draft = assertSavedAidtS1NativeDraft(await readSaved(), reply,
    { initial: original.fields.initial, rewrittenTheme: review.rewrittenTheme, focus: review.selectedDirection });
  await reload();
  assertSavedAidtS1Revision(await readSaved(), draft);
  await assertUi(draft);
  return { draft, review, reply, h03ConversationSignoff: false, teachingQualityAccepted: false };
}

/** The reply must produce a new persisted draft for this exact entity, not a local preview. */
export function assertSavedAidtS1NativeDraft(stage, proof, expected = {}) {
  const fields = stage?.content?.draft?.fields;
  let entity, draft; try { entity = JSON.parse(fields?.[`problemEntity:${proof.entityId}`]); draft = JSON.parse(fields?.[`problemDraft:${proof.entityId}`]); } catch { fail('S1_NATIVE_DRAFT_UNVERIFIED'); }
  if (stage.projectId !== proof.projectId || stage.stageId !== 1 || !Number.isSafeInteger(stage.revision) || stage.revision <= proof.revision
    || entity?.id !== proof.entityId || entity.archived !== false || !draft || Array.isArray(draft)
    || !Array.isArray(stage.sourceStageRevisions) || stage.sourceStageRevisions.length
    || Object.values(draft).some(value => typeof value !== 'string') || !textWithin(draft.initial)
    || draft.draftTurnId !== proof.assistantMessageId || draft.roundCompletion || draft.problemReflectionConfirmed
    || (expected.initial !== undefined ? draft.initial !== expected.initial : !proof.studentPrompt.includes(draft.initial))
    || (expected.rewrittenTheme !== undefined && draft.rewrittenTheme !== expected.rewrittenTheme)
    || (expected.focus !== undefined && draft.focus !== expected.focus)) fail('S1_NATIVE_DRAFT_UNVERIFIED');
  if (expected.focus !== undefined && draft.problemDirections) {
    let directions; try { directions = JSON.parse(draft.problemDirections); } catch { fail('S1_NATIVE_DRAFT_UNVERIFIED'); }
    if (!Array.isArray(directions) || (directions.length && !directions.some(direction => direction?.id === draft.problemDirectionId
      && direction.title === expected.focus && ['group','ai'].includes(direction.source)))) fail('S1_NATIVE_DRAFT_UNVERIFIED');
  }
  return { projectId: stage.projectId, entityId: proof.entityId, revision: stage.revision, fields: { ...draft } };
}

/** Confirmation changes only reflection/round flags; the reviewed saved content stays exact. */
export function assertSavedAidtS1Revision(stage, expected, { revision, confirmed = false } = {}) {
  const fields = stage?.content?.draft?.fields;
  let entity, draft; try { entity = JSON.parse(fields?.[`problemEntity:${expected.entityId}`]); draft = JSON.parse(fields?.[`problemDraft:${expected.entityId}`]); } catch { fail('S1_REVIEWED_REVISION_UNVERIFIED'); }
  if (stage.projectId !== expected.projectId || stage.stageId !== 1 || entity?.id !== expected.entityId || entity.archived !== false
    || !draft || typeof draft !== 'object' || Array.isArray(draft) || !expected.fields || !textWithin(expected.fields.initial)
    || Object.values(draft).some(value => typeof value !== 'string') || !Number.isSafeInteger(expected.revision) || expected.revision < 1
    || !Number.isSafeInteger(stage.revision) || stage.revision < 1
    || (confirmed && stage.revision <= expected.revision)
    || (revision !== undefined ? stage.revision !== revision : confirmed ? stage.revision <= expected.revision : stage.revision !== expected.revision)) fail('S1_REVIEWED_REVISION_UNVERIFIED');
  const { roundCompletion, ...actualFields } = draft;
  const expectedFields = { ...expected.fields, ...(confirmed ? { problemReflectionConfirmed: 'true' } : {}) };
  const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a],[b]) => a.localeCompare(b))) : item);
  if (canonical(actualFields) !== canonical(expectedFields)) fail('S1_REVIEWED_REVISION_UNVERIFIED');
  if (confirmed) {
    if (!Array.isArray(stage.sourceStageRevisions) || stage.sourceStageRevisions.length) fail('S1_CONFIRMED_REVISION_UNVERIFIED');
    const digest = textHash(canonical({ projectId: expected.projectId, stageId: 1,
      draft: { fields: expectedFields, ideas: [], selectedIdeaId: '' }, sources: [] }));
    const record = JSON.stringify({ schemaVersion: 1, projectId: expected.projectId, stageId: 1, digest });
    if (fields.problemHandoffEntity !== expected.entityId || roundCompletion !== record || fields.roundCompletion !== record
      || Object.entries(expectedFields).some(([key, value]) => fields[key] !== value)) fail('S1_CONFIRMED_REVISION_UNVERIFIED');
  } else if (roundCompletion) fail('S1_REVIEWED_REVISION_UNVERIFIED');
  return stage.revision;
}

export function assertAidtS1Handoff(href, scope, confirmed) {
  let url; try { url = new URL(href, scope.origin); } catch { fail('S1_CONFIRMED_HANDOFF_UNVERIFIED'); }
  if (!uuid(confirmed?.entityId) || !Number.isSafeInteger(confirmed.revision) || confirmed.revision < 1
    || typeof href !== 'string' || url.origin !== scope.origin || url.username || url.password || url.hash
    || url.pathname !== `/aidt/${encodeURIComponent(scope.projectId)}` || url.searchParams.getAll('step').length !== 1 || url.searchParams.get('step') !== '2'
    || url.searchParams.getAll('problemEntity').length !== 1 || url.searchParams.get('problemEntity') !== confirmed.entityId
    || url.searchParams.getAll('problemRevision').length !== 1 || url.searchParams.get('problemRevision') !== String(confirmed.revision)
    || ['entity','history','summary'].some(key => url.searchParams.has(key))) fail('S1_CONFIRMED_HANDOFF_UNVERIFIED');
  return url.href;
}

export function assertAidtS2Topic(record, confirmed) {
  if (!uuid(confirmed?.entityId) || !Number.isSafeInteger(confirmed.revision) || confirmed.revision < 1
    || !textWithin(confirmed.rewrittenTheme, 650) || record?.problemEntityId !== confirmed.entityId
    || record?.topicRevision !== confirmed.revision || record?.topic !== confirmed.rewrittenTheme) fail('S2_CONFIRMED_TOPIC_UNVERIFIED');
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

export function hasInterviewPrerequisite({ s1 }) {
  // A separately confirmed problem is diagnostic evidence, never the original S1 handoff.
  return s1 === true;
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

const creationFields = { problem: 'problemEntity:', interview: 'interviewRecord:', surprise: 'definitionSurprise:', persona: 'definitionPersona:', hmw: 'definitionHmw:', prototype: 'prototypeEntity:', test: 'testGroup:' };
const creationKinds = { problem: 1, interview: 2, surprise: 3, persona: 3, hmw: 3, idea: 4, prototype: 5, test: 6 };

function cardIds(stage, kind) {
  const draft = stage.content?.draft, fields = draft?.fields ?? {};
  if (kind === 'idea') return (draft?.ideas ?? [])
    .filter(item => !/^draft-[123]$/.test(item.id) || item.title?.trim() || item.description?.trim() || item.imageAttachment)
    .map(item => item.id);
  const prefix = creationFields[kind];
  const ids = Object.keys(fields).filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length));
  if (kind === 'surprise' && fields.definitionPrimaryEntity === 'true') ids.push('primary-surprise');
  return ids;
}

export function assertSavedCardCreation(before, after, target, kind) {
  if (creationKinds[kind] !== target.stage || after.projectId !== target.projectId || after.stageId !== target.stage ||
      before.content && (before.projectId !== target.projectId || before.stageId !== target.stage) ||
      !Number.isInteger(before.revision) || !Number.isInteger(after.revision) || after.revision <= before.revision) fail('CARD_CREATION_REVISION_UNVERIFIED');
  const oldIds = cardIds(before, kind), ids = cardIds(after, kind);
  if (!ids.includes(target.entityId) || oldIds.includes(target.entityId) || ids.length !== oldIds.length + 1 ||
      new Set(ids).size !== ids.length || oldIds.some(id => !ids.includes(id))) fail('CARD_CREATION_ENTITY_UNVERIFIED');
}

export async function runAidtJourney({ page, expect, scope, checkpoint, capture, api,
  saveStage, armCardCreate, reviewAndSave, report, registerFixture, armInterviewEdit, saveReport, saveDownload,
  armSurvey, surveyReceipt, armDesignCreate, armDesignGeneration, armDesignImage, createAnonymousPage, createSurveyParticipant, savePrint, teachingFeedback, reviewS1StudentResponse }) {
  if (scope.syntheticLabel !== SYNTHETIC) fail('SYNTHETIC_SCOPE_REQUIRED');
  const root = `/aidt/${encodeURIComponent(scope.projectId)}`;
  const origin = new URL(page.url()).origin;
  const unique = `${scope.runId}-${scope.runAttempt}`.replace(/[^a-zA-Z0-9-]/g, '').slice(-28);
  const text = value => `${SYNTHETIC}。${value}`;
  const feedback = async (stage, studentQuestion, code, finding, fixture, testPlan) => {
    if (typeof teachingFeedback !== 'function') fail('NATIVE_TEACHING_CHAT_UNAVAILABLE');
    return teachingFeedback(stage, studentQuestion ?? `QA ${scope.runId} 合成软件验收，非真实采访或课堂。请以本步已保存的学生初稿为依据，这是单轮纯文字咨询，只指出一个可完善处并问一个开放问题，不执行方案，不需要任务计划。不要替学生做决定，不保存成果，不调用工具、不生成文件，不把合成资料当真人证据。第${stage}步。`, code, finding, fixture, testPlan);
  };
  const stageEvidence = new Map();
  report.stageEvidence = [];
  const evidence = stage => {
    if (!stageEvidence.has(stage)) { const row = { stage, scope: 'live_dev', synthetic: true, inputs: [], iterations: [], outputs: [], completion: {}, notes: [], timings: [] }; stageEvidence.set(stage, row); report.stageEvidence.push(row); }
    return stageEvidence.get(stage);
  };
  const savedStage = async stage => { const result = await api(`/api/projects/${scope.projectId}/aidt/stages/${stage}`); if (result.status !== 200 || (result.data?.stage && (result.data.stage.projectId !== scope.projectId || result.data.stage.stageId !== stage || !Number.isInteger(result.data.stage.revision)))) fail('STAGE_REVISION_UNVERIFIED'); return result.data?.stage ?? { revision: 0, content: null }; };
  const revision = async stage => (await savedStage(stage)).revision;
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
    if ([3, 5, 6].includes(stage)) await expect(page.getByTestId(id).getByRole('textbox')).toHaveCount(0);
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
  const capturedDialogs = new Set();
  const captureCardCreation = async (stage, kind, submit, { reopen = false, example = kind } = {}) => {
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const tag = dialog.getByRole('textbox', { name: '添加标签', exact: true });
    await tag.fill('QA课堂'); await tag.press('Enter');
    await expect(dialog.getByText('QA课堂', { exact: true })).toBeVisible();
    const screenshotName = '0' + stage + '-create-' + example;
    if (!capturedDialogs.has(example)) await capture(screenshotName + '-dialog', stage, 'card-dialog');
    const before = await savedStage(stage);
    armCardCreate(stage);
    const [response] = await Promise.all([
      page.waitForResponse(r => r.url() === origin + `/api/projects/${scope.projectId}/aidt/stages/${stage}` && r.request().method() === 'PUT', { timeout: 30000 }),
      submit(),
    ]);
    if (response.status() !== 200) fail('CARD_CREATION_SAVE_UNVERIFIED');
    await page.waitForURL(url => url.pathname === root && url.searchParams.get('step') === String(stage) &&
      Boolean(url.searchParams.get('entity')) && Boolean(url.searchParams.get('thread')?.startsWith('thr_aidt_')));
    const target = ownedAidtEntityRoute(page.url(), { origin, projectId: scope.projectId }, { stage });
    const threadId = new URL(target.href).searchParams.get('thread');
    await expect(page.getByTestId('copilotkit-v2-input')).toBeVisible();
    if (!capturedDialogs.has(example)) {
      await capture(screenshotName + '-chat', stage);
      capturedDialogs.add(example);
    }
    const saved = await savedStage(stage);
    assertSavedCardCreation(before, saved, target, kind);
    await follow(stage === 1 ? '返回问题列表' : stage === 2 ? '返回访谈列表' : '返回产物列表');
    await page.reload();
    await expect(page.getByTestId('aidt-step-entity-directory')).toBeVisible();
    const reloaded = await savedStage(stage);
    assertSavedCardCreation(before, reloaded, target, kind);
    if (reloaded.revision < saved.revision) fail('CARD_CREATION_RELOAD_UNVERIFIED');
    const fields = reloaded.content.draft.fields;
    const storedTags = stage === 2 ? JSON.parse(fields['interviewRecord:' + target.entityId]).tags : JSON.parse(fields['cardTags:' + target.entityId] ?? '[]');
    if (!Array.isArray(storedTags) || !storedTags.includes('QA课堂')) fail('CARD_CREATION_TAG_RELOAD_UNVERIFIED');
    const directoryHref = page.url();
    let card;
    if (stage === 2) {
      const record = JSON.parse(reloaded.content.draft.fields[`interviewRecord:${target.entityId}`]);
      if (record.id !== target.entityId || !/^U\d{2}$/.test(record.code)) fail('CARD_CREATION_INTERVIEW_UNVERIFIED');
      card = page.getByRole('button', { name: new RegExp('^' + record.code + '(?:\\s|$)') });
    } else {
      const links = page.getByTestId('aidt-step-entity-directory').locator('a[href]');
      const matchingLinks = () => links.evaluateAll((links, id) => links.filter(link => new URL(link.href).searchParams.get('entity') === id).map(link => link.getAttribute('href')), target.entityId);
      await expect.poll(async () => new Set(await matchingLinks()).size).toBe(1);
      const matches = await matchingLinks();
      card = page.locator('a[href=' + JSON.stringify(matches[0]) + ']').first();
    }
    await expect(card).toBeVisible();
    if (reopen) {
      await click(card);
      await page.waitForURL(url => matchesAidtEntityRoute(url.href, target) && url.searchParams.get('thread') === threadId);
      await expect(page.getByTestId('copilotkit-v2-input')).toBeVisible();
      lastEntityRoute = target;
    }
    (evidence(stage).cardCreations ??= []).push({ kind, entityId: target.entityId, threadId, beforeRevision: before.revision, savedRevision: saved.revision, reloadedRevision: reloaded.revision, reopened: reopen });
    return { target, directoryHref };
  };
  const output = async (target = lastEntityRoute) => {
    if (!target) fail('CAPTURED_ENTITY_REQUIRED');
    return openAidtEntityOutcome({ page, target, waitForRoute: waitForEntity,
      assertReady: () => entityReady(target.stage) });
  };
  const shot = async (name, stage) => {
    const url = new URL(page.url());
    if (url.pathname !== root || (stage && url.searchParams.get('step') !== String(stage))) return;
    const thread = url.searchParams.get('thread');
    const proof = thread && report.teachingEvidence.findLast(item => item.threadId === thread && item.status === 'passed');
    if (proof) {
      await expect(page.getByTestId('copilot-user-message').filter({ hasText: proof.prompt }).last()).toBeVisible();
      const response = page.getByTestId('copilot-assistant-message').filter({ has: page.locator('[data-message-id="' + proof.assistantMessageId + '"]') });
      await expect(response).toBeVisible();
      await expect.poll(() => response.innerText().then(value => value.trim().length)).toBeGreaterThan(8);
    }
    await capture(name, stage);
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
  let firstQuestion, originalProblemDraft, confirmedProblem, diagnosticStep2Href;
  let problemDraftReady = false;
  const problemInitial = text('想了解校园午休中，赶课与闲暇两种情境如何影响饮品选择的犹豫。');
  // Fixed enum/booleans only: no request, URL query, account or error-stack material.
  report.s1Navigation = { operation: 'not-started', entityOutcomeObserved: false, savedInitialObserved: false, reentrySavedInitialObserved: false, teachingCheckpointAccepted: false };
  const openProblem = async link => openAidtProblemOutcome({ page, route: problemRoute, link,
    scope: { origin, projectId: scope.projectId }, waitForRoute: predicate => expect.poll(predicate, { timeout: 30000 }).toBe(true),
    assertReady: async () => {
      const panel = page.getByRole('region', { name: '工作坊问题产物' });
      await expect(panel).toBeVisible();
      await expect(panel.locator('input,textarea,select,button,[contenteditable="true"]')).toHaveCount(0);
    } });
  const problemName = `QA合成选题 ${unique}`;
  const personaName = `QA合成画像 ${unique}`;
  const question = '合成情境中，学生能否从静态队列示意中理解先看等待时间再决定的顺序？';


  await check('overview', undefined, async () => {
    await go(); await expect(page.getByTestId('aidt-dashboard')).toBeVisible();
    for (let stage = 1; stage <= 6; stage++) await expect(page.getByTestId(`aidt-step-${stage}`)).toBeVisible();
  }, '00-overview');

  await check('s1-draft-not-complete', undefined, async () => {
    report.s1Navigation.operation = 'create-problem';
    await go(1); await click(page.getByTestId('aidt-new-entity-card')); await fill('问题名称', problemName);
    await captureCardCreation(1, 'problem', () => click(btn('创建问题')), { reopen: true });
    report.s1Navigation.operation = 'open-problem-outcome';
    await page.waitForURL(url => url.searchParams.get('thread')?.startsWith('thr_aidt_'));
    problemRoute = ownedAidtProblemRoute(page.url(), { origin, projectId: scope.projectId });
    await openProblem(); report.s1Navigation.entityOutcomeObserved = true;
    await page.waitForURL(url => url.searchParams.get('thread')?.startsWith('thr_aidt_'));
    problemHref = page.url();
    report.s1Navigation.operation = 'native-teaching-feedback';
    const initialRevision = await revision(1);
    await requireAcceptedS1Feedback(() => feedback(1, problemInitial));
    firstQuestion = aidtS1Question(report.teachingEvidence, { ...scope, entityId: problemRoute.entityId,
      threadId: new URL(page.url()).searchParams.get('thread'), prompt: problemInitial, revision: initialRevision, checkpoint: 'teaching-chat-stage-1' });
    await expect.poll(async () => {
      const saved = await savedStage(1);
      const fields = JSON.parse(saved?.content?.draft?.fields?.[`problemDraft:${problemRoute.entityId}`] ?? '{}');
      return fields.draftTurnId === firstQuestion.assistantMessageId && !!fields.initial?.trim() && !fields.roundCompletion;
    }, { timeout: 30000 }).toBe(true);
    originalProblemDraft = assertSavedAidtS1NativeDraft(await savedStage(1), firstQuestion);
    const savedInitial = originalProblemDraft.fields.initial;
    await expect(page.getByTestId('aidt-stage-output')).toContainText(savedInitial);
    evidence(1).inputs.push({ name: '学生初始命题', content: problemInitial, format: '原生 Chat 学生消息', source: { entityId: problemRoute.entityId, inputMessageId: firstQuestion.inputMessageId, runId: firstQuestion.runId } });
    report.s1Navigation.savedInitialObserved = true;
    report.s1Navigation.operation = 'verify-draft-not-complete';
    await go(); await expect(page.getByTestId('aidt-stage-save-1')).not.toHaveAttribute('data-completed', 'true');
    await expect(page.getByTestId('aidt-stage-save-1')).toContainText('草稿');
    problemDraftReady = true;
  }, '01-problem-draft-overview');

  state.s1 = await check('s1-confirmed-reentry', 1, async () => {
    if (!problemDraftReady || !problemRoute || !problemHref || !firstQuestion || !originalProblemDraft) fail('S1_SAVED_DRAFT_REQUIRED');
    report.s1Navigation.operation = 'reenter-saved-problem-outcome';
    assertSavedAidtS1Revision(await savedStage(1), originalProblemDraft);
    await openProblem();
    await expect(page.getByTestId('aidt-stage-output')).toContainText(originalProblemDraft.fields.initial);
    report.s1Navigation.reentrySavedInitialObserved = true;
    report.s1Navigation.operation = 'student-response-before-rewrite';
    report.s1I3Review = { status: 'manual-response-review-required', h03ConversationSignoff: false, teachingQualityAccepted: false,
      questionRunId: firstQuestion.runId, questionMessageId: firstQuestion.assistantMessageId, questionSha256: firstQuestion.assistantTextSha256,
      prematureModelRewrite: Boolean(originalProblemDraft.fields.rewrittenTheme), prematureModelSelection: Boolean(originalProblemDraft.fields.problemDirectionId) };
    let secondNativeReply;
    const revised = await runAidtS1NativeRevision({ question: firstQuestion, original: originalProblemDraft,
      reviewStudentResponse: reviewS1StudentResponse, sendStudentResponse: prompt => feedback(1, prompt),
      readReply: async prompt => { secondNativeReply = aidtS1Question(report.teachingEvidence, { ...scope, entityId: problemRoute.entityId,
        threadId: new URL(page.url()).searchParams.get('thread'), prompt, revision: originalProblemDraft.revision, checkpoint: 'teaching-chat-stage-1-revision' }); return secondNativeReply; },
      readSaved: async () => { await expect.poll(async () => {
        const saved = await savedStage(1);
        const fields = JSON.parse(saved?.content?.draft?.fields?.[`problemDraft:${problemRoute.entityId}`] ?? '{}');
        return saved.revision > originalProblemDraft.revision && fields.draftTurnId === secondNativeReply?.assistantMessageId;
      }, { timeout: 30000 }).toBe(true); return savedStage(1); },
      reload: () => openProblem(), assertUi: async draft => {
        if (!matchesAidtProblemRoute(page.url(), problemRoute, true)) fail('S1_RESPONSE_ENTITY_CHANGED');
        await expect.poll(() => new URL(page.url()).searchParams.get('thread')).toBe(firstQuestion.threadId);
        await expect(page.getByTestId('aidt-stage-output')).toContainText(draft.fields.initial);
        await expect(page.getByTestId('aidt-stage-output')).toContainText(draft.fields.rewrittenTheme);
      } });
    report.s1Navigation.teachingCheckpointAccepted = true;
    report.s1I3Review.status = 'native-student-response-and-rewrite-saved';
    report.s1I3Review.responseInputMessageId = revised.reply.inputMessageId;
    report.s1I3Review.responseRunId = revised.reply.runId;
    evidence(1).iterations.push({ action: '学生回应实际追问并选择方向，在原生Chat改写命题', before: originalProblemDraft.fields.initial,
      after: revised.draft.fields.rewrittenTheme, reason: revised.review.choiceReason, response: revised.review.response,
      questionMessageId: firstQuestion.assistantMessageId, questionSha256: firstQuestion.assistantTextSha256,
      before_revision: originalProblemDraft.revision, after_revision: revised.draft.revision, entityId: problemRoute.entityId,
      inputMessageId: revised.reply.inputMessageId, assistantMessageId: revised.reply.assistantMessageId, h03ConversationSignoff: false });
    report.s1Navigation.operation = 'confirm-round-and-persist';
    const chatReview = page.getByRole('region', { name: '对话中的成果确认', exact: true });
    await expect(chatReview).toContainText(revised.draft.fields.rewrittenTheme);
    const [confirmationResponse] = await Promise.all([
      page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/projects/${scope.projectId}/aidt/stages/1`, { timeout: 30000 }),
      reviewAndSave(1, btn('确认本轮成果并保存', chatReview)),
    ]);
    if (confirmationResponse.status() !== 200) fail('S1_CONFIRMATION_NOT_PERSISTED');
    await expect(chatReview).toContainText('本轮成果已确认并保存', { timeout: 30000 });
    const confirmedStage = await savedStage(1);
    const confirmedRevision = assertSavedAidtS1Revision(confirmedStage, revised.draft, { confirmed: true });
    confirmedProblem = { entityId: problemRoute.entityId, revision: confirmedRevision, rewrittenTheme: revised.draft.fields.rewrittenTheme };
    report.s1I3Review.confirmedRevision = confirmedRevision;
    step2Href = assertAidtS1Handoff(await chatReview.getByRole('link', { name: '继续第2步', exact: true }).getAttribute('href'), { origin, projectId: scope.projectId }, confirmedProblem);
    await shot('01-problem-confirmed', 1);
    await follow('返回问题列表');
    report.s1Navigation.operation = 'verify-completed-overview-and-reload';
    await completed(1); await page.reload();
    await expect(page.getByTestId('aidt-stage-save-1')).toHaveAttribute('data-completed', 'true');
    assertSavedAidtS1Revision(await savedStage(1), revised.draft, { revision: confirmedRevision, confirmed: true });
    await page.goto(owned(problemHref)); await expect(page.getByTestId('aidt-stage-output')).toContainText('方向已确认');
    await expect(page.getByTestId('aidt-stage-output')).toContainText(revised.draft.fields.rewrittenTheme);
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
    // The first real reply may ask a clarification. Only the second turn must produce actionable questions.
    const readRecord = async () => {
      const raw = (await savedStage(2)).content?.draft?.fields?.[`interviewRecord:${target.entityId}`];
      return raw ? JSON.parse(raw) : null;
    };
    await expect.poll(async () => (await readRecord())?.original, { timeout: 30000 }).toBe(initial);
    const revisionInput = text(`${code}：我想改得更具体，先问「上次到了哪个窗口」，再追问「哪一刻决定继续等或离开」。请据此调整我的问题清单草稿。`);
    if (!await feedback(2, revisionInput, code)) fail('S2_NATIVE_TEACHING_REVISION_REQUIRED');
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
    const canonical = await readRecord();
    if (canonical?.code !== code || canonical.original !== initial || canonical.adopted !== adopted || canonical.guideConfirmed !== true) fail('INTERVIEW_CHAT_GUIDE_NOT_SAVED');
    assertAidtS2Topic(canonical, confirmedProblem);
    await expect(inspector.getByTestId('aidt-interview-question-list')).toContainText(adopted);
    recordInterviewIteration(initial, revisionInput, `${code}问题初稿`, target);
    recordInterviewIteration(revisionInput, adopted, `${code}问题清单`, target);
    await printOutput(2, `interview-guide-${code}`, inspector.getByTestId('aidt-interview-guide-print'), ['访谈问题清单', code, adopted]);
    return adopted;
  };
  // Keep the pending problem untouched. This is a second QA entity and needs
  // its own successful real answer and student's confirmation before handoff.
  if (!state.s1 && problemHref && hasPendingProblemReview(report.pendingTeachingReviews, problemHref, scope.projectId)) {
    state.syntheticHandoff = await check('synthetic-problem-for-interviews', undefined, async () => {
      const fixtureName = `QA独立访谈前置题 ${unique}`;
      await go(1); await click(page.getByTestId('aidt-new-entity-card')); await fill('问题名称', fixtureName);
      await captureCardCreation(1, 'problem', () => click(btn('创建问题')), { reopen: true });
      const fixtureRoute = ownedAidtProblemRoute(page.url(), { origin, projectId: scope.projectId });
      const fixture = await openAidtProblemOutcome({ page, route: fixtureRoute,
        scope: { origin, projectId: scope.projectId }, waitForRoute: waitForEntity,
        assertReady: () => expect(page.getByTestId('copilotkit-v2-input')).toBeVisible() });
      if (fixture.entityId === problemRoute.entityId) fail('INDEPENDENT_PROBLEM_REQUIRED');
      const initial = text('独立问题：午休时，在食堂饮品窗口的学生如何判断是否排队？我们没有真正采访；课堂练习用的排队经历只是小组猜测。我们选择午休赶课的学生，以时间信息为研究范围，希望追问最近一次排队和放弃经历。我们仍不知道等待信息从哪里获得。请根据这份完整材料整理工作坊问题草稿，保留猜测和待验证项。');
      if (!await feedback(1, initial, undefined, false, true)) fail('SYNTHETIC_PROBLEM_REAL_REPLY_REQUIRED');
      await reviewAndSave(1, btn('确认本轮成果并保存'));
      diagnosticStep2Href = owned(await page.getByRole('link', { name: '继续第2步', exact: true }).getAttribute('href'));
      const destination = new URL(diagnosticStep2Href);
      if (destination.searchParams.get('problemEntity') !== fixture.entityId || !Number(destination.searchParams.get('problemRevision'))) fail('INDEPENDENT_CONFIRMED_SOURCE_UNVERIFIED');
      report.diagnosticInterviewPrerequisite = { mode: 'diagnostic only; original teaching unresolved', entityId: fixture.entityId,
        revision: Number(destination.searchParams.get('problemRevision')), href: diagnosticStep2Href, originalS1Passed: false,
        formalContinuationAllowed: false, h03ConversationSignoff: false };
    });
  }
  const tenChatsOpened = await check('s2-ten-card-chats', 2, async () => {
    if (!hasInterviewPrerequisite(state) || !step2Href || !confirmedProblem) fail('S1_CONFIRMED_HANDOFF_REQUIRED');
    assertAidtS1Handoff(step2Href, { origin, projectId: scope.projectId }, confirmedProblem);
    const directory = new URL(step2Href); directory.searchParams.delete('entity'); directory.searchParams.delete('tool');
    interviewDirectory = owned(directory.href);
    report.interviewCardChats = [];
    for (let index = 1; index <= 10; index++) {
      const code = `U${String(index).padStart(2, '0')}`;
      await page.goto(interviewDirectory);
      const topic = page.locator('summary').filter({ hasText: `已确认研究问题 · 第 1 步 V${confirmedProblem.revision}` });
      await expect(topic).toBeVisible();
      if (await topic.locator('..').getAttribute('open') === null) await topic.click();
      await expect(topic.locator('..')).toContainText(confirmedProblem.rewrittenTheme);
      await click(page.getByTestId('aidt-new-entity-card'));
      await fill('受访者姓名或化名', `QA受访者 ${code}`, page.getByRole('dialog'));
      await captureCardCreation(2, 'interview', () => click(btn('创建访谈')), { reopen: true });
      const target = savedAidtInterviewRoute(await savedStage(2), code, interviewDirectory, { origin, projectId: scope.projectId });
      assertAidtS2Topic(JSON.parse((await savedStage(2)).content.draft.fields[`interviewRecord:${target.entityId}`]), confirmedProblem);
      await waitForEntity(() => matchesAidtEntityRoute(page.url(), target));
      await expect(page.getByTestId('copilotkit-v2-input')).toBeVisible();
      await output(target);
      await expect.poll(() => new URL(page.url()).searchParams.get('thread')).toMatch(/^thr_aidt_/);
      await expect(page.getByTestId('aidt-interview-output')).toContainText(code);
      const threadId = new URL(page.url()).searchParams.get('thread');
      expect(state.interviews.some(item => item.threadId === threadId || item.target.entityId === target.entityId)).toBe(false);
      state.interviews.push({ code, threadId, target, href: page.url(), hasMaterial: false });
      await readOnlyInterviewOutput();
      report.interviewCardChats.push({ code, threadId, entityId: target.entityId, inspectorVisible: true, inspectorReadOnly: true });
    }
  }, '02-ten-card-chats');

  const completeInterview = async interview => {
    const { code, target } = interview;
    await output(target);
    interview.adopted = await confirmInterviewGuide(code, target);
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
    const firstFinding = text(`我先写下自己的发现。标题：${code}关注等待时间。具体情况：午休选饮品时先看模拟队列再作决定。学生解释：等待时间可能影响选择，仍需真实访谈核实。第1段的原话是「${quote}」。请检查这些发现和引用，整理本次访谈的发现卡。`);
    if (!await feedback(2, firstFinding, code, true)) fail('S2_NATIVE_FINDING_REPLY_REQUIRED');
    const proof = report.teachingEvidence.find(row => row.stageId === 2 && row.entityId === target.entityId && row.prompt === firstFinding && row.status === 'passed');
    const readFinding = async () => {
      const draft = (await savedStage(2)).content?.draft;
      const card = draft?.discoveryCards?.find(item => item.id === target.entityId);
      const record = JSON.parse(draft?.fields?.[`interviewRecord:${target.entityId}`] ?? '{}');
      const interpretation = draft?.fields?.[`interviewInterpretation:${target.entityId}`];
      if (!proof || record.draftTurnId !== proof.assistantMessageId || !card ||
          card.participantCode !== code || !card.headline?.trim() || !card.context?.trim() || !interpretation?.trim() ||
          !firstFinding.includes(card.headline) || !firstFinding.includes(card.context) || !firstFinding.includes(interpretation) ||
          card.quote !== quote || draft.fields[`interviewConfirmed:${target.entityId}`] === 'true') return null;
      return card;
    };
    await expect.poll(async () => Boolean(await readFinding()), { timeout: 30000 }).toBe(true);
    const projected = await readFinding();
    const actions = page.getByTestId('aidt-interview-chat-actions');
    await disclosure('整理访谈发现');
    await confirmInInterviewChat(btn('确认人物发现卡', actions));
    await output(target);
    const inspector = await readOnlyInterviewOutput();
    evidence(2).outputs.push({ name: `${code}人物发现卡`, format: 'native finding card; synthetic text, real-person photo missing', status: 'pass', evidence: `Normal UI confirmation at V${await revision(2)}; software scope only` });
    await expect(inspector.getByTestId('aidt-interview-finding')).toContainText(projected.headline);
    recordInterviewIteration(firstFinding, projected.headline, `${code}人物发现卡`, target);
    Object.assign(interview, { quote, materialName: `qa-${unique}-${code}.txt`, hasMaterial: true });
  };
  if (tenChatsOpened) {
    for (const interview of state.interviews) {
      await check(`s2-interview-${interview.code.toLowerCase()}`, 2, () => completeInterview(interview));
    }
  }
  state.s2 = await check('s2-interview-handoff', 2, async () => {
    if (!state.s1 || !confirmedProblem || !step2Href) fail('S1_CONFIRMED_HANDOFF_REQUIRED');
    assertAidtS1Handoff(step2Href, { origin, projectId: scope.projectId }, confirmedProblem);
    if (!tenChatsOpened || state.interviews.length !== 10 || state.interviews.some(interview => !interview.hasMaterial)) fail('TEN_CONFIRMED_INTERVIEWS_REQUIRED');
    await page.goto(interviewDirectory);
    for (const interview of state.interviews) {
      await expect(page.getByRole('button', { name: new RegExp('^' + interview.code + '\\s.*发现卡已核对') })).toBeVisible();
    }
    step3Href = owned(await page.getByTestId('aidt-stage-next').getAttribute('href'));
    await shot('02-interview-directory', 2); await completed(2); await page.goto(interviewDirectory);
  }, '02-empathy');
  await check('s2-distinct-threads', 2, async () => {
    if (!tenChatsOpened || state.interviews.some(interview => !interview.adopted || !interview.hasMaterial)) fail('TEN_CONFIRMED_INTERVIEWS_REQUIRED');
    const observed = [];
    report.interviewIsolation = observed;
    for (const interview of [...state.interviews].reverse()) {
      await page.goto(interviewDirectory);
      await expect(page.getByTestId('copilotkit-v2-input')).toHaveCount(0);
      await openAidtEntityOutcome({ page, target: interview.target, activate: () => click(page.getByRole('button', { name: interviewCodePattern(interview.code) })), waitForRoute: waitForEntity,
        assertDetail: () => expect(page.getByTestId('copilotkit-v2-input')).toBeVisible(), assertReady: () => entityReady(2) });
      await expect.poll(() => new URL(page.url()).searchParams.get('thread')).toBe(interview.threadId);
      await page.reload(); await output(interview.target);
      assertAidtS2Topic(JSON.parse((await savedStage(2)).content.draft.fields[`interviewRecord:${interview.target.entityId}`]), confirmedProblem);
      await expect.poll(() => new URL(page.url()).searchParams.get('thread')).toBe(interview.threadId);
      await expect(page.getByTestId('aidt-interview-output')).toContainText(interview.code);
      const timeline = page.getByTestId('copilotkit-v2-messages');
      const ownTurns = report.teachingEvidence.filter(row => row.threadId === interview.threadId && row.stageId === 2 && row.status === 'passed');
      if (ownTurns.length !== 3) fail('INTERVIEW_CHAT_HISTORY_UNVERIFIED');
      const messages = await api(`/api/chat/threads/${encodeURIComponent(interview.threadId)}/messages?limit=100`);
      const records = Array.isArray(messages.data) ? messages.data : messages.data?.messages;
      if (messages.status !== 200 || !Array.isArray(records) || messages.data?.nextCursor) fail('INTERVIEW_CHAT_HISTORY_UNVERIFIED');
      for (const proof of ownTurns) {
        const ownReply = records.find(row => row.id === proof.assistantMessageId && row.authorKind === 'agent' && row.agentRunId === proof.runId);
        if (ownReply?.text !== proof.assistantText || !records.some(row => row.id === proof.inputMessageId && row.text === proof.prompt)) fail('INTERVIEW_CHAT_HISTORY_UNVERIFIED');
        await expect(timeline.getByTestId('chat-user-message-text').filter({ hasText: proof.prompt })).toBeVisible();
        // Markdown punctuation is absent from the rendered bubble. Also verify the durable identity above.
        const fragment = (ownReply.text.match(/[\p{Script=Han}]{4,}|[a-zA-Z]{5,}/gu) ?? []).sort((a,b) => b.length-a.length)[0];
        if (!fragment) fail('INTERVIEW_REPLY_TEXT_NOT_VISIBLE');
        await expect(timeline.getByTestId('copilot-assistant-message').filter({ hasText: fragment.slice(0, 35) }).first()).toBeVisible();
      }
      for (const sibling of report.teachingEvidence.filter(row => row.stageId === 2 && row.status === 'passed' && row.threadId !== interview.threadId)) {
        await expect(timeline.getByTestId('chat-user-message-text').filter({ hasText: sibling.prompt })).toHaveCount(0);
        if (records.some(row => row.id === sibling.inputMessageId || row.id === sibling.assistantMessageId)) fail('SIBLING_INTERVIEW_MESSAGE_VISIBLE');
      }
      await click(page.getByRole('button', { name: /产物列表/ }));
      const nativeArtifacts = page.getByTestId('chat-artifacts-panel');
      const interviewArtifact = nativeArtifacts.getByTestId('chat-host-artifact');
      await expect(interviewArtifact).toHaveText(`${interview.code} · 访谈产物`);
      await expect(nativeArtifacts.getByTestId('chat-artifacts-empty')).toHaveCount(0);
      for (const sibling of state.interviews.filter(other => other !== interview)) {
        await expect(nativeArtifacts.getByRole('button', { name: `${sibling.code} · 访谈产物`, exact: true })).toHaveCount(0);
      }
      await click(interviewArtifact);
      await expect.poll(() => new URL(page.url()).searchParams.get('thread')).toBe(interview.threadId);
      const inspector = await readOnlyInterviewOutput();
      await expect(inspector.getByTestId('aidt-interview-question-list')).toContainText(interview.adopted);
      await expect(inspector.getByTestId('aidt-interview-finding')).toContainText(interview.quote);
      for (const other of state.interviews.filter(other => other !== interview)) {
        await expect(inspector).not.toContainText(other.adopted);
        await expect(inspector).not.toContainText(other.quote);
      }
      expect(new URL(page.url()).searchParams.get('entity')).toBe(new URL(interview.href).searchParams.get('entity'));
      observed.push({ code: interview.code, stableThread: true, savedStudentMessage: true, savedAssistantMessage: true, noSiblingMessages: true, confirmedGuide: true, exportedPdf: true, rightInspector: true, nativeArtifactListReentry: true, directoryReentry: true, refresh: true });
    }
    report.independentEntityThreadsVerified = true;
  }, '02-independent-chat');

  await check('s2-card-management', 2, async () => {
    if (!interviewDirectory || state.interviews.length !== 10) fail('INTERVIEW_CARDS_REQUIRED');
    await page.goto(interviewDirectory);
    const grid = page.getByRole('list', { name: '访谈卡片', exact: true });
    const cards = grid.getByRole('listitem');
    await expect(cards).toHaveCount(10);
    await click(page.getByTestId('aidt-new-entity-card'));
    const creation = page.getByRole('dialog', { name: '新建访谈' });
    await fill('受访者姓名或化名', '临时化名', creation);
    const { target: created } = await captureCardCreation(2, 'interview', () => click(btn('创建访谈', creation)));
    const createdRecord = JSON.parse((await savedStage(2)).content.draft.fields[`interviewRecord:${created.entityId}`] ?? '{}');
    if (createdRecord.code !== 'U11') fail('S2_CARD_AUTO_OPEN_MISMATCH');
    await expect(cards).toHaveCount(11);
    const temporary = cards.filter({ has: page.getByRole('button', { name: /^U11(?:\s|$)/ }) });
    await expect(page.getByTestId('aidt-shared-save')).toHaveCount(0);
    await click(btn('改名与标签', temporary));
    const editor = page.getByRole('dialog', { name: '编辑访谈卡' });
    const name = `临时访谈 ${unique}`;
    const tags = [`QA午休 ${unique}`, `QA饮品 ${unique}`];
    await fill('受访者姓名或化名', name, editor);
    const tagInput = editor.getByTestId('interview-tag-input');
    for (const tag of tags) { await tagInput.fill(tag); await tagInput.press('Enter'); }
    await saveStage(2, btn('保存修改', editor));
    await page.reload();
    await expect(temporary.getByText(name, { exact: true })).toBeVisible();
    const filter = page.getByRole('group', { name: '筛选标签', exact: true });
    for (const tag of tags) {
      await click(btn(tag, filter));
      await expect(btn(tag, filter)).toHaveAttribute('aria-pressed', 'true');
      await expect(cards).toHaveCount(1);
      await expect(temporary.getByText(tag, { exact: true })).toBeVisible();
    }
    await click(btn('全部', filter));
    await click(btn('删除访谈卡', temporary));
    await saveStage(2, btn('确认删除', page.getByRole('dialog', { name: '删除访谈卡？' })));
    await page.reload();
    await expect(cards).toHaveCount(10);
    await expect(temporary).toHaveCount(0);
    await click(btn('查看已移除'));
    await expect(grid.getByText(name, { exact: true })).toBeVisible();
    report.interviewCardManagement = { created: true, editedAfterReload: true, retainedMultipleTags: true, filterMatchedEachTag: true, removedFromActiveAfterReload: true, retainedArchive: true };
  }, '02-interview-card-management');

  state.s3 = await check('s3-definition-hmw-handoff', 3, async () => {
    if (!state.s2 || !step3Href) { await go(3); fail('S2_CONFIRMED_HANDOFF_REQUIRED'); }
    await page.goto(owned(step3Href));
    const source = state.interviews[0];
    const secondSource = state.interviews[1];
    const context = `使用已确认的 ${source.code} 与 ${secondSource.code} 发现卡，记录分别为 ${source.target.entityId} 与 ${secondSource.target.entityId}。`;
    const confirmDefinition = async (target, prompt) => {
      if (!await feedback(3, text(prompt))) fail('DEFINITION_TEACHING_REPLY_REQUIRED');
      const proof = report.teachingEvidence.find(item => item.stageId === 3 && item.entityId === target.entityId && item.status === 'passed');
      if (!proof) fail('DEFINITION_TEACHING_REPLY_REQUIRED');
      await saveStage(3, btn('确认当前产物'), { confirmation: true });
      const stage = await savedStage(3);
      if (stage.content.draft.fields['definitionChatSource:' + target.entityId] !== proof.assistantMessageId) fail('DEFINITION_CONFIRMATION_SOURCE_UNVERIFIED');
      await output(target);
      const panel = page.getByTestId('aidt-definition-editor');
      await expect(panel.getByRole('textbox')).toHaveCount(0);
      return { panel, draft: stage.content.draft };
    };
    const createDefinition = async (kind, label, launch, title, sourceLabel, sourceName) => {
      await click(page.getByTestId('aidt-new-entity-card'));
      await click(btn(launch, page.getByRole('group', { name: '选择卡片类型' })));
      const dialog = page.getByRole('dialog', { name: '新建' + label });
      await fill('卡片名称', title, dialog);
      const source = dialog.getByRole('group', { name: sourceLabel, exact: true }).getByRole('checkbox', { name: sourceName });
      await source.check();
      if (kind === 'persona') await dialog.getByRole('group', { name: sourceLabel, exact: true }).getByRole('checkbox', { name: /U02/ }).check();
      return captureCardCreation(3, kind, () => click(btn('创建' + label, dialog)), { reopen: true });
    };
    const { target: surprise } = await createDefinition('surprise', '意外发现', '新建意外发现', 'QA意外发现', '来源访谈', /U01/);
    const noSurprise = await confirmDefinition(surprise, '我们重新读了合成材料，暂无与原先想法冲突的证据。请如实记录「暂无意外发现」。');
    await expect(noSurprise.panel).toContainText('暂无');
    await follow('返回产物列表');
    const { target: persona } = await createDefinition('persona', '画像', '新建画像', personaName, '来源访谈', /U01/);
    const personaProjection = await confirmDefinition(persona, `${context} 我们将画像命名为「${personaName}」。午休赶课的学生先看队列，希望了解等待时间。只有合成记录，不能推广到真实人群。请整理为画像并引用这两张发现卡。`);
    const personaRecord = JSON.parse(personaProjection.draft.fields['definitionPersona:' + persona.entityId]);
    if (!personaRecord.confirmed || ![source, secondSource].every(row => personaRecord.cardIds.includes(row.target.entityId))) fail('PERSONA_FINDING_LINK_UNVERIFIED');
    personaHref = persona.href;
    await expect(personaProjection.panel).toContainText(personaRecord.name);
    await follow('返回产物列表');
    const { target: alternate } = await createDefinition('hmw', 'HMW', '新建 HMW', 'QA另一研究方向', '来源画像', personaName);
    const alternateProjection = await confirmDefinition(alternate, `${context} 关联画像「${personaRecord.name}」（记录 ${persona.entityId}）。另一个方向是：我们如何让午休赶课的学生在排队前理解等待时间？这是待核实的方向。请记录这个问题及来源。`);
    const alternateRecord = JSON.parse(alternateProjection.draft.fields['definitionHmw:' + alternate.entityId]);
    if (!alternateRecord.confirmed || !alternateRecord.personaIds.includes(persona.entityId)) fail('HMW_REFERENCE_UNVERIFIED');
    await follow('返回产物列表');
    const { target: hmw } = await createDefinition('hmw', 'HMW', '新建 HMW', 'QA研究方向', '来源画像', personaName);
    const hmwProjection = await confirmDefinition(hmw, `${context} 关联已确认画像「${personaRecord.name}」（记录 ${persona.entityId}）。我们如何帮助不同时间情境中的学生理解等待信息，并保留自主选择？请整理这个方向，标注现有依据只是合成记录。`);
    const hmwRecord = JSON.parse(hmwProjection.draft.fields['definitionHmw:' + hmw.entityId]);
    if (!hmwRecord.confirmed || !hmwRecord.personaIds.includes(persona.entityId) || !hmwRecord.cardIds.includes(source.target.entityId)) fail('HMW_REFERENCE_UNVERIFIED');
    if (alternate.entityId === hmw.entityId || alternateRecord.text.trim() === hmwRecord.text.trim()) fail('DISTINCT_HMW_REQUIRED');
    state.hmwChoices = { selected: hmw.entityId, alternate: alternate.entityId };
    await expect(hmwProjection.panel).toContainText(hmwRecord.text);
    await saveStage(3, btn('选为本轮 HMW'), { confirmation: true });
    step4Href = owned(await page.getByTestId('aidt-stage-next').getAttribute('href'));
    evidence(3).outputs.push({ name: personaRecord.name, format: 'confirmed Chat persona with linked interview', status: 'pass' }, { name: hmwRecord.text, format: 'confirmed HMW with persona and interview source', status: 'pass' });
    await follow('返回产物列表');
    await shot('03-definition-directory', 3); await completed(3); await page.goto(owned(step3Href));
  }, '03-definition');

  state.s4 = await check('s4-brainstorm-five-to-two', 4, async () => {
    if (!state.s3 || !step4Href) fail('S3_CONFIRMED_HANDOFF_REQUIRED');
    const stage3 = await savedStage(3);
    const frozenUrl = new URL(owned(step4Href));
    if (String(stage3.revision) !== frozenUrl.searchParams.get('hmwRevision')) fail('SELECTED_HMW_UNVERIFIED');
    const hmws = Object.entries(stage3.content.draft.fields).flatMap(([key, value]) => {
      if (!key.startsWith('definitionHmw:')) return [];
      try { const hmw = JSON.parse(value); return hmw?.confirmed && !hmw.archived ? [hmw] : []; }
      catch { return []; }
    });
    if (hmws.length < 2) fail('S4_TWO_CONFIRMED_HMWS_REQUIRED');
    const chosenHmw = hmws.find(item => item.id !== stage3.content.draft.fields.definitionHmwId);
    if (!chosenHmw) fail('S4_TWO_CONFIRMED_HMWS_REQUIRED');
    const methodSessions = new Set();
    const start = async (method, target) => {
      await page.goto(frozenUrl.href);
      const directory = page.getByRole('region', { name: '头脑风暴', exact: true });
      const hmw = directory.getByRole('combobox', { name: 'HMW', exact: true });
      await expect.poll(() => hmw.locator('option').count()).toBeGreaterThanOrEqual(3);
      await hmw.selectOption(chosenHmw.id);
      await directory.getByRole('combobox', { name: '发散方法' }).selectOption(method);
      await directory.getByRole('spinbutton', { name: '希望探索的点子数' }).fill(String(target));
      await saveStage(4, btn('开始头脑风暴', directory));
      await expect.poll(() => new URL(page.url()).searchParams.get('entity')).toMatch(/^brainstorm-/);
      const entity = new URL(page.url()).searchParams.get('entity');
      await expect.poll(() => new URL(page.url()).searchParams.get('thread')).toMatch(/^thr_aidt_/);
      const threadId = new URL(page.url()).searchParams.get('thread');
      if (methodSessions.has(threadId)) fail('S4_BRAINSTORM_THREAD_NOT_INDEPENDENT');
      methodSessions.add(threadId);
      const key = 'ideaBrainstorm:' + entity;
      const read = async () => JSON.parse((await savedStage(4)).content.draft.fields[key] ?? 'null');
      const session = await read();
      if (session?.source?.id !== chosenHmw.id || session.source?.text !== chosenHmw.text || session.source?.revision !== stage3.revision
        || session.method !== method || session.count !== target) fail('S4_BRAINSTORM_SOURCE_UNVERIFIED');
      return { entity, threadId, read };
    };
    const second = await start('scamper', 1);
    const secondPrompt = text('我的初步办法是发一张纸卡。请按当前场次的方法选择一个具体步骤延展这个点子，说明你用了哪一步。');
    if (!await feedback(4, secondPrompt)) fail('S4_SCAMPER_NATIVE_FEEDBACK_REQUIRED');
    await expect.poll(async () => (await second.read())?.candidates.length, { timeout: 30000 }).toBe(1);
    const exactScamper = report.teachingEvidence.find(row => row.threadId === second.threadId && row.prompt === secondPrompt && row.status === 'passed');
    if (!exactScamper || !/SCAMPER|替代|组合|调整|改变|移除/u.test(exactScamper.assistantText)) fail('S4_SCAMPER_METHOD_NOT_OBSERVED');
    const reverse = await start('reverse', 5);
    const reversePrompt = text('我想到在排队入口放纸牌显示等待时间。请用场次选定的方法先对比怎样会让体验变糟及如何翻转，再和我一起补到本场目标数量。只做概念草稿。');
    if (!await feedback(4, reversePrompt)) fail('S4_REVERSE_NATIVE_FEEDBACK_REQUIRED');
    await expect.poll(async () => (await reverse.read())?.candidates.length, { timeout: 30000 }).toBe(5);
    const exactReverse = report.teachingEvidence.find(row => row.threadId === reverse.threadId && row.prompt === reversePrompt && row.status === 'passed');
    if (!exactReverse || !/逆向|翻转|反转|反过来/u.test(exactReverse.assistantText)) fail('S4_REVERSE_METHOD_NOT_OBSERVED');
    const output = page.getByTestId('aidt-brainstorm-output');
    await expect(output).toBeVisible();
    await expect(output.getByRole('listitem')).toHaveCount(5);
    const selectedIds = (await reverse.read()).candidates.slice(0, 2);
    const compare = page.getByRole('region', { name: '筛选点子' });
    await click(compare.getByText('筛选点子 · 已选 0', { exact: true }));
    await compare.getByRole('checkbox').nth(0).check();
    await compare.getByRole('checkbox').nth(1).check();
    await expect(compare.getByText('筛选点子 · 已选 2', { exact: true })).toBeVisible();
    await reviewAndSave(4, btn('确认入选点子', compare));
    await expect.poll(async () => JSON.parse((await savedStage(4)).content.draft.fields.ideaHandoffIds || '[]'), { timeout: 30000 }).toEqual(selectedIds);
    const stage4 = await savedStage(4);
    const frozenHandoff = owned(await compare.getByRole('link', { name: '进入原型制作' }).getAttribute('href'));
    if (String(stage4.revision) !== new URL(frozenHandoff).searchParams.get('ideaRevision')) fail('S4_BRAINSTORM_HANDOFF_REVISION_MISMATCH');
    await page.reload();
    await expect(output.getByRole('listitem')).toHaveCount(5);
    await expect.poll(() => new URL(page.url()).searchParams.get('thread')).toBe(reverse.threadId);
    await expect(output.getByRole('heading', { name: /入选 2/ })).toBeVisible();
    await shot('04-brainstorm-five-to-two', 4);
    await completed(4);
    await page.goto(frozenHandoff);
    await expect(page.getByTestId('aidt-step-entity-directory')).toBeVisible();
    step5Href = frozenHandoff;
    report.brainstormHandoff = { hmwId: chosenHmw.id, hmwRevision: stage3.revision, stage4Revision: stage4.revision, sameSessionAfterReload: true, retained: 5, selected: 2, selectedIds, methodThreadCount: 2, methods: ['reverse', 'scamper'] };
  }, '04-brainstorm');

  state.s5 = await check('s5-prototype-question-version', 5, async () => {
    if (!state.s4 || !step5Href) { await go(5); fail('S4_CONFIRMED_HANDOFF_REQUIRED'); }
    if (typeof armDesignGeneration !== 'function' || typeof armDesignCreate !== 'function') fail('BOUNDED_DESIGN_GENERATION_GUARD_REQUIRED');
    await page.goto(owned(step5Href));
    await click(page.getByTestId('aidt-new-entity-card'));
    const dialog = page.getByRole('dialog', { name: '新建原型' });
    await fill('原型名称', '未命名设计', dialog);
    const chosenIdeas = dialog.getByRole('group', { name: '来源点子', exact: true });
    await expect(chosenIdeas.getByRole('checkbox', { checked: true }).first()).toBeVisible();
    const { target: designRoute } = await captureCardCreation(5, 'prototype', async () => {
      await armDesignCreate(); await click(btn('创建原型', dialog));
    }, { reopen: true });
    designId = designRoute.entityId;
    await output(designRoute);
    const actions = page.getByRole('region', { name: '原型对话操作' });
    await expect(actions.getByRole('link', { name: '打开 Design 工作台' })).toHaveCount(0);

    const studentInputs = {
      verificationQuestion: question,
      beforeTestBelief: '我预计并排信息能帮助比较，实际等待行为未知。',
      verificationBasis: '这只是合成练习中的学生预期，暂无真实研究证据。',
      verificationLimits: '静态图能检查理解或意向，不能证明实际等待、购买或付费。',
      type: '静态示意图', situation: '合成校园午休', task: '先看等待信息再决定',
    };
    const request = text(`QA ${scope.runId}，请整理本轮学生草稿，原样保留下面的问题、看法与依据，使用当前原型 Skill 已约定的格式，只给文字，不启动工具和生成。
${JSON.stringify(studentInputs)}`);
    if (!await feedback(5, request)) fail('S5_NATIVE_TEACHING_REPLY_REQUIRED');
    await output(designRoute);
    const inspector = page.getByTestId('aidt-prototype-entity-output');
    await expect(inspector).toContainText(question);
    await expect(inspector.getByRole('textbox')).toHaveCount(0);
    const beforeQuestion = await revision(5);
    await reviewAndSave(5, btn('确认验证问题', actions));
    await expect.poll(() => revision(5)).toBeGreaterThan(beforeQuestion);
    const readPrototype = async () => JSON.parse((await savedStage(5)).content?.draft?.fields?.[`prototypeEntity:${designId}`] ?? '{}');
    const bound = await readPrototype();
    if (bound.verificationQuestion !== question || bound.beforeTestBelief !== studentInputs.beforeTestBelief
      || bound.verificationBasis !== studentInputs.verificationBasis || bound.verificationQuestionConfirmed !== 'true') fail('S5_QUESTION_NOT_EXACTLY_CONFIRMED');
    const selectedIdeas = JSON.parse(bound.prototypeIdeaSource ?? '{}');
    const priorStage = await savedStage(4);
    if (JSON.stringify(selectedIdeas.ideaIds) !== JSON.stringify(report.brainstormHandoff.selectedIds) || selectedIdeas.revision !== report.brainstormHandoff.stage4Revision || selectedIdeas.revision !== priorStage.revision || JSON.stringify(selectedIdeas.ideaIds) !== priorStage.content.draft.fields.ideaHandoffIds) fail('S5_IDEA_SOURCE_MISMATCH');
    evidence(5).inputs.push({ name: '确认后的验证问题', content: question, format: 'native Chat and saved entity', source: { entityId: designId, ideaRevision: selectedIdeas.revision } });
    const workbenchLink = actions.getByRole('link', { name: '打开 Design 工作台', exact: true });
    await expect(workbenchLink).toBeVisible();
    await workbenchLink.click();
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
    await saveStage(5, picker.getByRole('button', { name: /^选择 v\d+：/ }).first());
    await expect(page.getByTestId('aidt-prototype-recorded-reference')).toContainText(/v[1-9]\d*/);
    const generatedVersion = JSON.parse((await readPrototype()).prototypeReference ?? '{}');
    if (!generatedVersion.versionId || !generatedVersion.generatedFrameCount) fail('S5_NATIVE_DESIGN_VERSION_REQUIRED');
    if (typeof armDesignImage !== 'function') fail('S5_SYNTHETIC_IMAGE_GUARD_REQUIRED');
    await disclosure('用图片制作静态原型');
    const fileName = `qa-${scope.runId}-prototype.png`;
    const bytes = schematicPng(unique, 5);
    await actions.getByLabel('上传原型图片').setInputFiles({ name: fileName, mimeType: 'image/png', buffer: bytes });
    await armDesignImage({ id: designId, fileName, bytes });
    await saveStage(5, btn('保存上传图片方案', actions));
    const imageVersion = JSON.parse((await readPrototype()).prototypeReference ?? '{}');
    if (!imageVersion.versionId || imageVersion.versionId === generatedVersion.versionId || imageVersion.source !== 'user'
      || imageVersion.designId !== generatedVersion.designId) fail('S5_STATIC_IMAGE_VERSION_NOT_RETAINED');
    await expect(inspector.getByRole('img', { name: fileName, exact: true })).toBeVisible();
    await click(btn('选择真实原型版本', picker));
    await click(picker.locator('[aria-label="已关联的设计"]').getByRole('button', { name: '未命名设计', exact: true }));
    await expect(picker.getByRole('button', { name: new RegExp(`^选择 v${generatedVersion.seq}：`) })).toBeVisible();
    await expect(picker.getByRole('button', { name: new RegExp(`^选择 v${imageVersion.seq}：`) })).toBeVisible();
    evidence(5).outputs.push({ name: '原生设计及静态图片候选', format: 'two preserved native Design snapshots', status: 'pass',
      evidence: `Design v${generatedVersion.seq}；图片 v${imageVersion.seq}` });
    const beforeHandoff = await revision(5);
    await reviewAndSave(5, btn('确认本原型', actions));
    await expect.poll(() => revision(5)).toBeGreaterThan(beforeHandoff);
    const frozen = await readPrototype();
    const prototype = JSON.parse(frozen.prototypeReference ?? '{}');
    if (frozen.verificationQuestion !== question || prototype.designId !== designId || !prototype.versionId || !prototype.generatedFrameCount || !frozen.aidtPrototypeConfirmedHandoff) fail('S5_VERSION_NOT_EXACTLY_CONFIRMED');
    evidence(5).outputs.push({ name: '已选静态原型与绑定验证问题', format: 'native Design version reference and verification question', status: 'pass', evidence: (await page.getByTestId('aidt-prototype-recorded-reference').innerText()).slice(0,2000) });
    const nextLink = page.getByTestId('aidt-stage-next');
    await expect(nextLink).toBeVisible();
    step6Href = owned(await nextLink.getAttribute('href'));
    if (new URL(step6Href).searchParams.get('prototypeEntity') !== designId || Number(new URL(step6Href).searchParams.get('prototypeRevision')) !== await revision(5)) fail('S5_HANDOFF_VERSION_MISMATCH');
    await shot('05-prototype-question-version', 5); await completed(5); await output(designRoute);
    report.designGenerationAndVersionWorkflowVerified = true;
    report.designProviderIndependentlyVerified = false;
  }, '05-prototype');

  state.s6 = await check('s6-test-reflection', 6, async () => {
    if (!state.s5 || !step6Href) { await go(6); fail('S5_REAL_VERSION_HANDOFF_REQUIRED'); }
    let interviewTarget;
    for (const [method, label] of [['interview', '线下访谈'], ['survey', '问卷']]) {
      await page.goto(owned(step6Href)); await click(page.getByTestId('aidt-new-entity-card'));
      const dialog = page.getByRole('dialog', { name: '新建测试卡片' });
      await fill('测试名称', `QA合成${label} ${unique}`, dialog);
      await expect(dialog).toContainText('原型');
      const { target: testTarget } = await captureCardCreation(6, 'test', () => click(btn('创建测试卡片', dialog)), { reopen: true, example: method + '-test' });
      await output(testTarget);
      const detail = page.getByTestId('aidt-test-group-detail');
      await expect(detail.getByRole('textbox')).toHaveCount(0);
      const actions = page.getByTestId('aidt-test-chat-confirmation');
      await disclosure('关联测试材料');
      const methodField = actions.getByRole('combobox', { name: '测试方式', exact: true });
      const saveSource = async action => {
        armCardCreate(6);
        const [response] = await Promise.all([page.waitForResponse(row => row.url() === origin + '/api/projects/' + scope.projectId + '/aidt/stages/6' && row.request().method() === 'PUT'), action()]);
        if (response.status() !== 200) fail('TEST_MATERIAL_WRITE_UNVERIFIED');
      };
      if (await methodField.inputValue() !== method) await saveSource(() => methodField.selectOption(method));
      const initialPlan = text(`本组准备通过${label}观察学生读懂队列提示的情况。我们的初始测试问题是：你会从哪里开始看？接下来想做什么？请根据这个实体的验证问题整理成不诱导的测试计划，保留我们的测试方式，目前尚未采集反馈。`);
      if (!await feedback(6, initialPlan, undefined, false, false, true)) fail('TEST_PLAN_REPLY_REQUIRED');
      const planProof = report.teachingEvidence.find(item => item.stageId === 6 && item.entityId === testTarget.entityId && item.prompt === initialPlan && item.status === 'passed');
      const readGroup = async () => JSON.parse((await savedStage(6)).content.draft.fields['testGroup:' + testTarget.entityId]);
      await expect.poll(async () => (await readGroup()).planFromMessageId, { timeout: 30000 }).toBe(planProof?.assistantMessageId ?? 'MISSING');
      await expect(detail).toContainText((await readGroup()).task);
      await shot('06-' + method + '-chat-plan', 6);
      const syntheticTestRecord = text(`${label}合成材料第1段。合成页面按查看等待信息、理解选择、决定是否排队的顺序展示。未进行真实用户测试。`);
      const survey = surveyFixture(scope.runId);
      if (method === 'survey') {
        armSurvey(testTarget.entityId);
        await collectNativeSurvey({ page, expect, actions, saveSource, fixture: survey, receipt: surveyReceipt, createSurveyParticipant });
      } else await saveSource(() => uploaded('本组原始材料', `qa-${unique}-${method}.txt`, Buffer.from(syntheticTestRecord), 'text/plain'));
      const prompt = text(`这次${label}测试针对当前原型（测试实体 ${testTarget.entityId}）。任务是请参与者指出在页面哪里先了解等待信息、如何决定下一步。只用刚关联的${method === 'survey' ? '原生问卷答卷，自报原话为「' + survey.answer + '」' : '线下访谈合成材料第1段'}，未测试真实对象，未观察到真人行为或原话。学生反思：现有材料只能检查界面的顺序，证据不足。暂不能改变最初判断，实际学生是否看懂仍不清楚。下一轮回第2步，原因是需要真实访谈。先取得授权，再听学生结合页面说明选择。请整理本轮测试、反思和回溯方向。`);
      if (!await feedback(6, prompt)) fail('TEST_TEACHING_REPLY_REQUIRED');
      const proof = report.teachingEvidence.find(item => item.stageId === 6 && item.entityId === testTarget.entityId && item.prompt === prompt && item.status === 'passed');
      await saveStage(6, btn('确认并保存测试成果', actions), { confirmation: true });
      await page.reload();
      await output(testTarget);
      const fields = (await savedStage(6)).content.draft.fields;
      const testRecord = JSON.parse(fields['testGroup:' + testTarget.entityId]);
      if (testRecord.method !== method || testRecord.designId !== designId || !testRecord.versionId || !proof || testRecord.confirmedFromMessageId !== proof.assistantMessageId || !testRecord.task?.trim() || !testRecord.reflection?.trim() ||
          fields.reflectionConfirmed !== 'true' || fields.understandingChangeStatus !== 'insufficient' || fields.returnStep !== '2') fail('TEST_NATIVE_ROUND_UNVERIFIED');
      if (method === 'survey') {
        if (testRecord.did || testRecord.source?.kind !== 'survey' || testRecord.source.id !== surveyReceipt().id || testRecord.surveyResponseId !== surveyReceipt().responseId) fail('NATIVE_SURVEY_RESPONSE_REQUIRED');
        await disclosure('原型版本与来源');
        await expect(detail.getByRole('link', { name: '查看原生答卷' })).toHaveAttribute('href', new RegExp('/studio/survey/' + testRecord.source.id + '/responses'));
        await expect(detail.getByText('已定位答卷 ' + testRecord.surveyResponseId, { exact: true })).toBeVisible();
        await disclosure('查看所选答卷的原始回答');
        await expect(detail.getByText(survey.answer, { exact: true })).toBeVisible();
        await shot('06-survey-real-response', 6);
      }
      if (method === 'interview') {
        interviewTarget = testTarget;
        await disclosure('原型版本与来源');
        await expect(detail.getByTestId('aidt-research-original-text')).toContainText(syntheticTestRecord);
        await shot('06-interview-reloaded-original', 6);
      }
      await expect(detail).toContainText(testRecord.task);
      await expect(detail).toContainText(testRecord.reflection);
      evidence(6).outputs.push({ name: label, entityId: testTarget.entityId, threadId: new URL(testTarget.href).searchParams.get('thread'), designId, versionId: testRecord.versionId, method });
      await shot('06-native-' + method + '-plan-and-material', 6);
    }
    const tested = evidence(6).outputs.filter(item => item.designId === designId);
    if (tested.length !== 2 || tested[0].entityId === tested[1].entityId || tested[0].threadId === tested[1].threadId || tested[0].versionId !== tested[1].versionId) fail('TEST_GROUP_ISOLATION_UNVERIFIED');
    await shot('06-reflection-insufficient-return-empathy', 6); await completed(6); await page.goto(owned(step6Href));
    if (!interviewTarget) fail('TEST_GROUP_ISOLATION_UNVERIFIED');
    await output(interviewTarget);
    const interviewOutput = page.getByTestId('aidt-test-group-detail');
    await disclosure('原型版本与来源');
    await expect(interviewOutput.getByRole('link', { name: '查看原生答卷' })).toHaveCount(0);
    await expect(interviewOutput).not.toContainText(surveyReceipt().responseId);
    await expect(interviewOutput).not.toContainText(surveyFixture(scope.runId).answer);
    report.nativeSurveyRoundtrip = { ...surveyReceipt(), participantBrowserIndependent: true, siblingIsolation: true, screenshot: '06-survey-real-response.png' };
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
    await expect(reportRegion.getByRole('textbox')).toHaveCount(0);
    await expect(page.getByTestId('aidt-summary-materials')).toBeVisible();
    const reportPrompt = text('请依据本项目六个步骤当前已确认的版本起草小组研究报告。说明项目问题、访谈发现、画像和 HMW、发散与收敛、原型验证问题、测试反思和下一轮安排。逐步列出引用的版本，保留证据缺口。明确写入「合成验收数据，非真实访谈」，避免将软件验证描述成真实受访者的结论。');
    if (!await feedback(6, reportPrompt)) fail('REPORT_NATIVE_REPLY_REQUIRED');
    const proof = report.teachingEvidence.find(item => item.entityId === 'group-report' && item.status === 'passed' && item.prompt === reportPrompt);
    if (!proof) fail('REPORT_NATIVE_REPLY_REQUIRED');
    const actions = page.getByTestId('aidt-report-chat-actions');
    await click(btn('采用报告草稿', actions));
    await saveReport();
    await reviewAndSave(6, btn('确认小组报告', actions));
    await expect(page.getByTestId('aidt-report-save-state')).toContainText('已确认');
    await disclosure('已确认版本与导出');
    const readVersion = page.getByRole('button', { name: /^查看确认版 V\d+$/ }); await click(readVersion);
    await expect(page.getByRole('article', { name: '已确认报告正文', exact: true })).toContainText(SYNTHETIC);
    const sources = page.getByRole('list', { name: '确认版本来源', exact: true }); await expect(sources).toBeVisible();
    for (let stage = 1; stage <= 6; stage++) {
      const selectedRevision = proof.sourceRevisions.find(item => item.stageId === stage)?.revision;
      if (!selectedRevision) fail('REPORT_SOURCE_REVISION_MISSING');
      await expect(sources.getByText(new RegExp('第\\s*' + stage + '\\s*步.*V' + selectedRevision + '(?:\\D|$)'))).toBeVisible();
    }
    const [download] = await Promise.all([page.waitForEvent('download'), click(page.getByRole('button', { name: /^下载 V\d+ Markdown$/ }))]);
    if (typeof saveDownload !== 'function') fail('REPORT_SAFE_DOWNLOAD_STORAGE_REQUIRED');
    await saveDownload(download);
    if (await download.failure()) fail('REPORT_DOWNLOAD_FAILED');
    const stream = await download.createReadStream(); if (!stream) fail('REPORT_DOWNLOAD_UNREADABLE');
    let bytes = 0; const chunks = []; for await (const chunk of stream) { bytes += chunk.length; if (bytes > 1000000) fail('REPORT_DOWNLOAD_TOO_LARGE'); chunks.push(chunk); }
    const content = Buffer.concat(chunks), exportedText = content.toString('utf8'); expect(exportedText).toContain(SYNTHETIC);
    const requiredReportHighlights = ['午休', '等待', '访谈', '画像', '原型', '测试'];
    for (const text of requiredReportHighlights) { expect(exportedText).toContain(text); await expect(page.getByRole('article', { name: '已确认报告正文', exact: true })).toContainText(text); }
    report.nativeReportContentChecks = requiredReportHighlights.map(text => ({ text, observedInConfirmedBody: true, observedInDownloadedMarkdown: true }));
    report.confirmedReportExport = { bytes, sha256: createHash('sha256').update(content).digest('hex'), format: 'markdown' };
    await printOutput(6, 'confirmed-group-report', page.getByRole('button', { name: /^打印 V\d+ PDF$/ }), [SYNTHETIC, '午休']);
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
        const materialRequired = stage === 2;
        if (materialRequired && (!expectedInterview.hasMaterial || !expectedInterview.quote || !expectedInterview.materialName)) fail('FROZEN_MATERIAL_EXPECTATION_MISSING');
        const target = await verifyAidtFrozenBacklink({ page, link, scope: { origin, projectId: scope.projectId }, stage, revision, waitForRoute: waitForEntity,
          materialRequired,
          assertVersion: async () => { const history = page.getByTestId('aidt-entity-history'); await expect(history).toBeVisible(); await expect(history.getByRole('heading', { level: 1 })).toHaveText(new RegExp(` · V${revision}$`)); await expect(history).toContainText('已保存的历史版本。'); await expect(history).toContainText(SYNTHETIC); },
          assertMaterial: async target => {
            const interview = expectedInterview;
            const material = page.getByTestId('aidt-research-material-preview').filter({ hasText: interview.materialName });
            await expect(material).toBeVisible(); await expect(material).toContainText(new URL(target.href).searchParams.get('sourceId'));
            const original = material.getByTestId('aidt-research-original-text'); await expect(original).toBeVisible(); await expect(original).toContainText(interview.quote); await expect(original).toContainText(SYNTHETIC);
          } });
        item.clicked = true; item.frozenRevision = revision; item.entityId = target.entityId; item.materialVerified = materialRequired;
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
