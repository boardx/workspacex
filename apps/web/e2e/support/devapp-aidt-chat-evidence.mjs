/** Bounded normal-UI teaching feedback. No synthetic run/message/receipt, resume or approval. */
import { createHash } from 'node:crypto';
import { ORIGIN, ProbeFailure } from './devapp-aidt-auth-readonly.mjs';

export const ENTITY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
export function validTestPlanProjection(before, body, entityId, messageId) {
  const oldDraft = before?.content?.draft, nextDraft = body?.content?.draft, key = 'testGroup:' + entityId;
  if (!oldDraft || !nextDraft || before.revision !== body.expectedRevision || canonical(before.sourceStageRevisions) !== canonical(body.sourceStageRevisions)) return false;
  let old, next;
  try { old = JSON.parse(oldDraft.fields[key]); next = JSON.parse(nextDraft.fields[key]); } catch { return false; }
  if (old.id !== entityId || next.id !== entityId || old.archived || old.confirmedFromMessageId || !id(next.planFromMessageId) ||
      old.planFromMessageId === next.planFromMessageId || messageId && messageId !== next.planFromMessageId ||
      typeof next.task !== 'string' || !next.task.trim() || next.task.length > 300 || typeof next.situation !== 'string' || next.situation.length > 300) return false;
  const retained = value => Object.fromEntries(Object.entries(value).filter(([field]) => !['planFromMessageId','task','situation'].includes(field)));
  const remaining = draft => Object.fromEntries(Object.entries(draft.fields).filter(([field]) => field !== key && field !== 'reflectionConfirmed'));
  return canonical(retained(old)) === canonical(retained(next)) && canonical(remaining(oldDraft)) === canonical(remaining(nextDraft))
    && (!nextDraft.fields.reflectionConfirmed || oldDraft.fields.reflectionConfirmed === nextDraft.fields.reflectionConfirmed)
    && canonical({ ...oldDraft, fields: {} }) === canonical({ ...nextDraft, fields: {} });
}
export function brainstormRecord(stage, id) {
  if (!/^brainstorm-[a-zA-Z0-9-]{1,100}$/.test(id ?? '')) return null;
  try {
    const record = JSON.parse(stage?.content?.draft?.fields?.[`ideaBrainstorm:${id}`] ?? 'null');
    return record?.id === id && record.source?.id && Array.isArray(record.candidates) ? record : null;
  } catch { return null; }
}
export function validBrainstormProjection(before, body, id) {
  const prior = brainstormRecord(before, id), next = brainstormRecord(body, id);
  if (!prior || !next || before.revision !== body.expectedRevision || !Number.isInteger(prior.count)
    || next.candidates.length <= prior.candidates.length || next.candidates.length > prior.count
    || new Set(next.candidates).size !== next.candidates.length
    || !prior.candidates.every((candidate, index) => next.candidates[index] === candidate)) return false;
  const candidateIds = next.candidates.slice(prior.candidates.length);
  const oldDraft = before.content.draft, newDraft = body.content.draft;
  if (!Array.isArray(newDraft.ideas) || newDraft.ideas.length !== oldDraft.ideas.length + candidateIds.length
    || !oldDraft.ideas.every((idea, index) => canonical(idea) === canonical(newDraft.ideas[index]))
    || !newDraft.ideas.slice(oldDraft.ideas.length).every((item, index) => object(item)
      && item.id === candidateIds[index] && ENTITY.test(item.id) && item.id.startsWith(id + '-')
      && typeof item.title === 'string' && typeof item.description === 'string')) return false;
  const { candidates: _oldCandidates, ...samePrior } = prior;
  const { candidates: _newCandidates, ...sameNext } = next;
  return canonical(samePrior) === canonical(sameNext)
    && canonical(before.sourceStageRevisions) === canonical(body.sourceStageRevisions)
    && canonical(oldDraft) === canonical({ ...newDraft, ideas: oldDraft.ideas,
      fields: { ...newDraft.fields, [`ideaBrainstorm:${id}`]: oldDraft.fields[`ideaBrainstorm:${id}`] } });
}

const SEND_PATH = '/api/copilotkit/agent/default/run';
const HEX = /^[a-f0-9]{64}$/;
const fail = code => { throw new ProbeFailure(code); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value);
const sha = value => createHash('sha256').update(value, 'utf8').digest('hex');
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
// The native UI projects a finished answer into one interview's unconfirmed draft.
// Project identity, sibling records, source references, consent and decisions are immutable here.
export function matchesInterviewProjection(previous, next, scope, assistantId) {
  const entity = scope.selector?.entityId;
  if (scope.stageId !== 2 || !id(entity) || !object(previous?.draft?.fields) || !object(next?.draft?.fields)) return false;
  const key = `interviewRecord:${entity}`, interpretation = `interviewInterpretation:${entity}`, confirmed = `interviewConfirmed:${entity}`;
  const clean = (value, keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
  const same = (a, b) => canonical(a) === canonical(b);
  const bounded = (value, max) => typeof value === 'string' && value.length <= max;
  const left = previous.draft, right = next.draft;
  if (!same(clean(previous, ['draft']), clean(next, ['draft'])) || !same(clean(left, ['fields','discoveryCards']), clean(right, ['fields','discoveryCards']))) return false;
  const finding = scope.interviewFinding === true;
  const allowed = finding ? [key, confirmed, interpretation] : [key, confirmed];
  if (!same(clean(left.fields, allowed), clean(right.fields, allowed))) return false;
  if (left.fields[confirmed] !== right.fields[confirmed] && right.fields[confirmed] !== '') return false;
  let before, after;
  try { before = JSON.parse(left.fields[key]); after = JSON.parse(right.fields[key]); } catch { return false; }
  if (!object(before) || !object(after) || before.id !== entity) return false;
  const changeable = finding ? ['draftTurnId'] : ['original','goal','adopted','draftTurnId'];
  if (!same(clean(before, changeable), clean(after, changeable))) return false;
  if (before.draftTurnId !== after.draftTurnId && (!id(after.draftTurnId) || assistantId && after.draftTurnId !== assistantId)) return false;
  if (!finding) {
    return before.guideConfirmed === false && after.original === (scope.interviewGuideRevision ? before.original : scope.prompt) && bounded(after.goal, 250) && bounded(after.adopted, 1000)
      && (!before.original || before.original === after.original) && same(left.discoveryCards, right.discoveryCards);
  }
  if (before.guideConfirmed !== true || right.fields[interpretation] !== undefined && !bounded(right.fields[interpretation], 1000)) return false;
  const oldCards = left.discoveryCards ?? [], newCards = right.discoveryCards ?? [];
  if (!Array.isArray(oldCards) || !Array.isArray(newCards) || !same(oldCards.filter(c => c.id !== entity), newCards.filter(c => c.id !== entity))) return false;
  const old = oldCards.find(c => c.id === entity), cards = newCards.filter(c => c.id === entity);
  if (!cards.length) return !old;
  const card = cards[0];
  if (cards.length !== 1 || !['student-summary', 'quote'].includes(card.headlineKind) || !['headline','context','quote'].every(k => bounded(card[k], 1000))) return false;
  const fixed = c => clean(c, ['headlineKind','headline','context','quote']);
  return same(fixed(card), old ? fixed(old) : { id: entity, participantCode: before.code, sourceRef: '', photoRef: '' });
}

// A verified S1 assistant may update only the working fields of its own problem entity.
export function matchesProblemProjection(previous, next, scope, proof) {
  const entity = scope.selector?.entityId, key = `problemDraft:${entity}`;
  if (scope.stageId !== 1 || !id(entity) || !object(previous?.draft?.fields) || !object(next?.draft?.fields)) return false;
  const omit = (value, keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
  const same = (a, b) => canonical(a) === canonical(b);
  if (!same(omit(previous, ['draft']), omit(next, ['draft'])) || !same(omit(previous.draft, ['fields']), omit(next.draft, ['fields']))
    || !same(omit(previous.draft.fields, [key]), omit(next.draft.fields, [key]))) return false;
  let old, draft, entry;
  try {
    entry = JSON.parse(previous.draft.fields[`problemEntity:${entity}`]);
    old = JSON.parse(previous.draft.fields[key] ?? '{}'); draft = JSON.parse(next.draft.fields[key]);
  } catch { return false; }
  if (entry?.id !== entity || entry.archived !== false || !object(old) || !object(draft) || !id(proof.assistantMessageId)
    || draft.draftTurnId !== proof.assistantMessageId || draft.roundCompletion || draft.problemReflectionConfirmed === 'true') return false;
  const fields = ['initial', 'initialChatMessageId', 'whyWorthStudying', 'sourceDetails', 'problemSources', 'sourceUncertainty', 'known', 'nextAction',
    'rewrittenTheme', 'focus', 'people', 'activity', 'scene', 'discussion', 'followupAnswers', 'assumptions', 'problemDirections', 'problemDirectionId', 'draftTurnId'];
  return same(omit(old, fields), omit(draft, fields)) && fields.every(key => draft[key] === undefined || typeof draft[key] === 'string' && draft[key].length <= 6000)
    && (!draft.initialChatMessageId || draft.initialChatMessageId === old.initialChatMessageId || draft.initialChatMessageId === proof.inputMessageId);
}

const refs = value => {
  if (!Array.isArray(value) || value.length > 6 || value.some(row => !object(row) || Object.keys(row).sort().join(',') !== 'revision,stageId' || !Number.isInteger(row.stageId) || row.stageId < 1 || row.stageId > 6 || !Number.isSafeInteger(row.revision) || row.revision < 1) || new Set(value.map(row => row.stageId)).size !== value.length) fail('TEACHING_SOURCE_REFERENCES_INVALID');
  return [...value].sort((a, b) => a.stageId - b.stageId);
};
function summaryHistory(value) {
  if (!Array.isArray(value) || value.length > 60) fail('TEACHING_SOURCE_REFERENCES_INVALID');
  const rows = value.map(row => refs([row])[0]).sort((a,b) => a.stageId - b.stageId || a.revision - b.revision);
  if (new Set(rows.map(row => row.stageId + ':' + row.revision)).size !== rows.length || rows.some(row => rows.filter(item => item.stageId === row.stageId).length > 10)) fail('TEACHING_SOURCE_REFERENCES_INVALID');
  return rows;
}
function selector(value) {
  if (value?.purpose === 'summary') {
    const expectedKeys = value.entityId === undefined ? 'historyRevisions,projectId,purpose,schemaVersion,stageRevisions' : 'entityId,historyRevisions,projectId,purpose,schemaVersion,stageRevisions';
    if (Object.keys(value).sort().join(',') !== expectedKeys || value.entityId !== undefined && value.entityId !== 'group-report' || value.schemaVersion !== 1 || !id(value.projectId)) fail('TEACHING_SELECTOR_INVALID');
    const stageRevisions = refs(value.stageRevisions);
    if (stageRevisions.length !== 6) fail('TEACHING_SELECTOR_INVALID');
    return { ...value, stageRevisions, historyRevisions: summaryHistory(value.historyRevisions) };
  }
  if (!object(value) || Object.keys(value).some(key => !['schemaVersion', 'purpose', 'projectId', 'stageId', 'stageRevisions', 'entityId', 'sourceEntityId', 'returnRevision'].includes(key)) || value.schemaVersion !== 1 || value.purpose !== 'stage' || !id(value.projectId) || !Number.isInteger(value.stageId) || value.stageId < 1 || value.stageId > 6 || ['entityId', 'sourceEntityId'].some(key => value[key] !== undefined && !id(value[key])) || value.returnRevision !== undefined && (!Number.isSafeInteger(value.returnRevision) || value.returnRevision < 1)) fail('TEACHING_SELECTOR_INVALID');
  const stageRevisions = refs(value.stageRevisions);
  if (stageRevisions.some(row => row.stageId > value.stageId)) fail('TEACHING_SELECTOR_INVALID');
  return { ...value, stageRevisions };
}
export function validateTeachingScope(scope) {
  if (!object(scope) || scope.origin !== 'https://devapp.boardx.us' || !id(scope.projectId) || !id(scope.threadId) || !id(scope.actorId) || !id(scope.skillId) || !id(scope.skillVersionId) || typeof scope.prompt !== 'string' || !/合成|QA/.test(scope.prompt) || scope.prompt.length < 12 || scope.prompt.length > 5000) fail('TEACHING_SCOPE_INVALID');
  const selected = selector(scope.selector);
  if (selected.projectId !== scope.projectId || (selected.purpose === 'summary' ? scope.stageId !== 6 : selected.stageId !== scope.stageId)) fail('TEACHING_SCOPE_MISMATCH');
  return selected;
}
function messageText(message) {
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content) && message.content.every(part => object(part) && part.type === 'text' && typeof part.text === 'string')) return message.content.map(part => part.text).join('');
  fail('TEACHING_NON_TEXT_MESSAGE');
}
const HISTORY_DIAGNOSTIC_KEYS = Object.freeze(['messageCount', 'historyCount', 'firstBadIndex', 'idMatchesDurable',
  'idMatchesKnownClientAlias', 'roleMatches', 'textExact', 'textTrimEqual', 'anyCanonicalTextExact', 'contentShape']);
const HISTORY_DIAGNOSTIC_BOOLEANS = Object.freeze(['idMatchesDurable', 'idMatchesKnownClientAlias', 'roleMatches',
  'textExact', 'textTrimEqual', 'anyCanonicalTextExact']);

/** Fixed-size diagnostic only: no message, identifier, request or error text leaves this function. */
function safeHistoryDiagnostic(value) {
  try {
    if (!object(value)) return;
    const keys = Reflect.ownKeys(value), descriptors = Object.getOwnPropertyDescriptors(value);
    if (keys.some(key => typeof key !== 'string') || keys.sort().join(',') !== [...HISTORY_DIAGNOSTIC_KEYS].sort().join(',')
      || HISTORY_DIAGNOSTIC_KEYS.some(key => !Object.hasOwn(descriptors[key], 'value'))) return;
    const data = Object.fromEntries(HISTORY_DIAGNOSTIC_KEYS.map(key => [key, descriptors[key].value]));
    if (!Number.isInteger(data.messageCount) || data.messageCount < 2 || data.messageCount > 100
      || !Number.isInteger(data.historyCount) || data.historyCount < 0 || data.historyCount > 100
      || !Number.isInteger(data.firstBadIndex) || data.firstBadIndex < 0 || data.firstBadIndex >= data.messageCount - 1
      || HISTORY_DIAGNOSTIC_BOOLEANS.some(key => typeof data[key] !== 'boolean')
      || !['text', 'text-parts', 'nontext', 'other'].includes(data.contentShape)) return;
    return Object.freeze(data);
  } catch { return; }
}

export function teachingHistoryFailureDiagnostic(messages, history, firstBadIndex) {
  try {
    if (!Array.isArray(messages) || messages.length < 2 || messages.length > 100 || !Array.isArray(history) || history.length > 100
      || !Number.isInteger(firstBadIndex) || firstBadIndex < 0 || firstBadIndex >= messages.length - 1) return;
    const message = messages[firstBadIndex], content = message?.content;
    const textParts = Array.isArray(content) && content.every(part => object(part) && part.type === 'text' && typeof part.text === 'string');
    const contentShape = typeof content === 'string' ? 'text' : Array.isArray(content) ? textParts ? 'text-parts' : 'nontext' : 'other';
    const text = typeof content === 'string' ? content : textParts ? content.map(part => part.text).join('') : undefined;
    const durable = history.filter(row => object(row) && typeof message?.id === 'string' && row.id === message.id);
    const aliases = history.filter(row => object(row) && typeof message?.id === 'string' && typeof row.clientMessageId === 'string' && row.clientMessageId === message.id);
    const matched = [...durable, ...aliases];
    return safeHistoryDiagnostic({ messageCount: messages.length, historyCount: history.length, firstBadIndex,
      idMatchesDurable: durable.length > 0, idMatchesKnownClientAlias: aliases.length > 0,
      roleMatches: matched.some(row => row.authorKind === 'human' ? ['user', 'human'].includes(message?.role) : row.authorKind === 'agent' && message?.role === 'assistant'),
      textExact: typeof text === 'string' && matched.some(row => row.text === text),
      textTrimEqual: typeof text === 'string' && matched.some(row => typeof row.text === 'string' && row.text.trim() === text.trim()),
      anyCanonicalTextExact: typeof text === 'string' && history.some(row => object(row) && row.text === text), contentShape });
  } catch { return; }
}

/** Read only the closed schema from this exact failure; malformed diagnostics are discarded. */
export function readTeachingHistoryFailureDiagnostic(error) {
  try {
    if (!(error instanceof ProbeFailure) || error.code !== 'TEACHING_HISTORY_NOT_CANONICAL') return;
    const descriptor = Object.getOwnPropertyDescriptor(error, 'teachingHistoryDiagnostic');
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return;
    return safeHistoryDiagnostic(descriptor.value);
  } catch { return; }
}

/** SDK IDs are transport coordinates only. The backend ID comes from the accepted human row. */
export function validateTeachingWire(request, scope) {
  const expected = validateTeachingScope(scope); let url;
  try { url = new URL(request.url); } catch { fail('TEACHING_WIRE_TARGET_INVALID'); }
  const body = request.body;
  if (request.method !== 'POST' || url.origin !== scope.origin || url.pathname !== SEND_PATH || url.search || url.hash || url.username || url.password || !object(body) || Object.keys(body).some(key => !['threadId', 'runId', 'parentRunId', 'messages', 'state', 'tools', 'context', 'forwardedProps', 'resume'].includes(key)) || !id(body.threadId) || !id(body.runId) || body.resume !== undefined && body.resume !== null || body.parentRunId !== undefined && body.parentRunId !== null) fail('TEACHING_WIRE_TARGET_INVALID');
  const forwarded = body.forwardedProps;
  if (!object(forwarded) || Object.keys(forwarded).some(key => !['chatThreadId', 'clientMessageId', 'aidtContext', ...(scope.stageFile ? ['attachmentIds'] : [])].includes(key)) || forwarded.chatThreadId !== scope.threadId || !id(forwarded.clientMessageId) || canonical(selector(forwarded.aidtContext)) !== canonical(expected)) fail('TEACHING_WIRE_SCOPE_MISMATCH');
  if (scope.stageFile && (!id(scope.stageFile.id) || !Array.isArray(forwarded.attachmentIds)
    || forwarded.attachmentIds.length !== 1 || forwarded.attachmentIds[0] !== scope.stageFile.id)) fail('STAGE_TEXT_WIRE_NOT_VERIFIED');
  if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 100) fail('TEACHING_MESSAGES_INVALID');
  const messages = body.messages, latest = messages.at(-1);
  if (!object(latest) || !['user', 'human'].includes(latest.role) || latest.id !== forwarded.clientMessageId || messageText(latest) !== scope.prompt) fail('TEACHING_STUDENT_TEXT_MISMATCH');
  const history = scope.knownMessages ?? [];
  for (const [index, message] of messages.slice(0, -1).entries()) {
    try {
      if (!object(message) || !history.some(row => row.id === message.id && (row.authorKind === 'human' ? ['user', 'human'].includes(message.role) : row.authorKind === 'agent' && message.role === 'assistant') && row.text === messageText(message))) fail('TEACHING_HISTORY_NOT_CANONICAL');
    } catch (error) {
      if (error instanceof ProbeFailure && error.code === 'TEACHING_HISTORY_NOT_CANONICAL') {
        const diagnostic = teachingHistoryFailureDiagnostic(messages, history, index);
        if (diagnostic) Object.defineProperty(error, 'teachingHistoryDiagnostic', { value: diagnostic });
      }
      throw error;
    }
  }
  return { clientMessageId: forwarded.clientMessageId, sdkRunId: body.runId, sdkThreadId: body.threadId };
}
function messageRows(value) {
  const rows = Array.isArray(value) ? value : value?.messages;
  if (!Array.isArray(rows) || rows.length > 100 || !Array.isArray(value) && value.nextCursor != null) fail('TEACHING_MESSAGE_READ_INVALID');
  return rows;
}
/** Never accept a run learned from SSE, timestamps, a caller string or another author's message. */
export function identifyOwnedTeachingRun(value, scope, wire) {
  validateTeachingScope(scope);
  const rows = messageRows(value).filter(row => row?.clientMessageId === wire.clientMessageId);
  if (rows.length > 1 || rows.some(row => row.authorKind !== 'human' || row.authorId !== scope.actorId || row.text !== scope.prompt || !id(row.id))) fail('TEACHING_ACCEPTANCE_MISMATCH');
  const row = rows[0];
  if (!row || row.agentRunId === null) return null;
  if (scope.stageFile) {
    const attachment = row.attachments?.[0];
    if (!Array.isArray(row.attachments) || row.attachments.length !== 1
      || !['id', 'filename', 'mime', 'bytes'].every(key => attachment?.[key] === scope.stageFile[key])) fail('STAGE_TEXT_MESSAGE_NOT_VERIFIED');
  }
  if (!id(row.agentRunId) || (scope.knownMessages ?? []).some(prior => prior.id === row.id)) fail('TEACHING_ACCEPTANCE_MISMATCH');
  return { runId: row.agentRunId, inputMessageId: row.id };
}
/** Native trace polling reads only a run already bound by canonical human-message
 * observation. It cannot introduce a run, thread, project or execution capability. */
export function decideOwnedTeachingExecutionRead(target, method, facts) {
  const match = /^\/api\/agent-runs\/([A-Za-z0-9_.:-]+)\/execution-events$/.exec(target.pathname);
  if (!match) return;
  const denied = { allow: false, kind: 'out-of-scope-read', code: 'EXECUTION_READ_SCOPE_REJECTED' };
  const cursor = target.searchParams.get('afterSeq'), runId = match[1];
  if (method !== 'GET' || target.origin !== ORIGIN || target.username || target.password || target.hash
    || [...target.searchParams.keys()].join(',') !== 'afterSeq' || target.search !== '?afterSeq=' + cursor
    || !/^(?:-1|0|[1-9][0-9]*)$/.test(cursor ?? '')
    || !Number.isSafeInteger(Number(cursor)) || !id(runId)
    || !id(facts?.actorId) || !id(facts.orgId) || !id(facts.projectId)
    || !(facts.threads instanceof Set) || !(facts.ownedRuns instanceof Set) || !(facts.teachingLedger instanceof Map)) return denied;
  if (!facts.ownedRuns.has(runId)) return { allow: false, kind: 'teaching-run-needs-binding', runId };
  const entries = [...facts.teachingLedger.values()].filter(entry => entry.accepted?.runId === runId);
  if (entries.length !== 1) return denied;
  const entry = entries[0], scope = entry.scope;
  if (!entry.wire || !id(entry.wire.clientMessageId) || !id(entry.accepted.inputMessageId)
    || scope?.actorId !== facts.actorId || scope.projectId !== facts.projectId || scope.origin !== target.origin
    || scope.orgId !== undefined && scope.orgId !== facts.orgId || !facts.threads.has(scope.threadId)) return denied;
  try { validateTeachingScope(scope); } catch { return denied; }
  return { allow: true, kind: 'owned-teaching-execution-read', runId, threadId: scope.threadId,
    inputMessageId: entry.accepted.inputMessageId, afterSeq: Number(cursor) };
}

export function validateTeachingEvidence({ messages, run, receipt }, scope, wire, accepted, frozenSnapshotHash) {
  const chosen = validateTeachingScope(scope), observed = identifyOwnedTeachingRun(messages, scope, wire);
  if (!accepted || canonical(observed) !== canonical(accepted)) fail('TEACHING_ACCEPTANCE_MISMATCH');
  if (!object(run) || run.runId !== accepted.runId || run.threadId !== scope.threadId || run.inputMessageId !== accepted.inputMessageId || run.status !== 'succeeded' || !id(run.resultMessageId) || canonical(run.skillVersionIds) !== canonical([scope.skillVersionId])) fail('TEACHING_DURABLE_RUN_NOT_SUCCEEDED');
  const replies = messageRows(messages).filter(row => row?.id === run.resultMessageId && row.authorKind === 'agent' && row.agentRunId === run.runId && typeof row.text === 'string' && row.text.trim());
  if (replies.length !== 1 || (scope.knownMessages ?? []).some(row => row.id === replies[0].id)) fail('TEACHING_DURABLE_REPLY_MISSING');
  // Receipt schema intentionally does not expose entityId/sourceEntityId. Check only real fields;
  // entity selection is checked separately against the full browser wire + the server-owned thread.
  if (!object(receipt) || receipt.runId !== run.runId || receipt.projectId !== scope.projectId || receipt.purpose !== chosen.purpose || receipt.stageId !== chosen.stageId || receipt.skillVersionId !== scope.skillVersionId || !HEX.test(receipt.snapshotHash ?? '') || canonical(refs(receipt.stageRevisions)) !== canonical(chosen.stageRevisions) || canonical(summaryHistory(receipt.historyRevisions)) !== canonical(chosen.historyRevisions ?? []) || receipt.returnRevision !== chosen.returnRevision) fail('TEACHING_CONTEXT_RECEIPT_MISMATCH');
  if (frozenSnapshotHash !== undefined && receipt.snapshotHash !== frozenSnapshotHash) fail('TEACHING_CONTEXT_SNAPSHOT_CHANGED');
  const application = receipt.application;
  if (!object(application) || application.state !== 'message-dispatch-observed' || typeof application.attemptId !== 'string' || !application.attemptId.startsWith(`${run.runId}:`) || !/^(0|[1-9][0-9]*)$/.test(application.attemptId.slice(run.runId.length + 1)) || !HEX.test(application.assembledContextHash ?? '') || !Number.isFinite(Date.parse(application.assembledAt)) || !Number.isFinite(Date.parse(application.messageDispatchedAt))) fail('TEACHING_CONTEXT_DISPATCH_UNPROVEN');
  const sourceEntities = receipt.entityReferences ?? [];
  if (!Array.isArray(sourceEntities) || sourceEntities.length > 256 || sourceEntities.some(ref => !object(ref)
    || Object.keys(ref).sort().join(',') !== 'entityId,revision,stageId' || !Number.isInteger(ref.stageId)
    || ref.stageId < 1 || ref.stageId > 6 || !Number.isSafeInteger(ref.revision) || ref.revision < 1 || typeof ref.entityId !== 'string' || !ENTITY.test(ref.entityId))
    || new Set(sourceEntities.map(ref => [ref.stageId,ref.entityId,ref.revision].join(':'))).size !== sourceEntities.length) fail('TEACHING_ENTITY_REFERENCES_INVALID');
  return { stageId: scope.stageId, threadId: scope.threadId, sourceEntities, runId: run.runId, inputMessageId: accepted.inputMessageId, assistantMessageId: replies[0].id, skillId: scope.skillId, skillVersionId: scope.skillVersionId, agentVersionId: id(run.agentVersionId) ? run.agentVersionId : null, modelProvider: typeof run.modelProvider === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(run.modelProvider) ? run.modelProvider : null, modelId: typeof run.modelId === 'string' && /^[A-Za-z0-9_./:-]{1,200}$/.test(run.modelId) ? run.modelId : null, sourceRevisions: chosen.stageRevisions, snapshotHash: receipt.snapshotHash, assembledContextHash: application.assembledContextHash, studentTextSha256: sha(scope.prompt), assistantTextSha256: sha(replies[0].text), assistantText: replies[0].text, providerIndependentlyVerified: false, teachingQualityAccepted: false };
}
/** One normal UI send. Caller/guard enforce the bounded per-entity teaching ledger and own all HTTP authorization. */
export async function sendTeachingFeedback({ page, expect, scope, read, armSend, onEvent = () => {}, onPendingReview }) {
  validateTeachingScope(scope);
  const url = new URL(page.url());
  if (url.origin !== scope.origin || url.pathname !== `/aidt/${scope.projectId}` || url.searchParams.get('step') !== String(scope.stageId) || url.searchParams.get(scope.selector.purpose === 'summary' ? 'summaryThread' : 'thread') !== scope.threadId || scope.selector.purpose === 'summary' && (url.searchParams.get('summary') !== '1' || url.searchParams.get('entity') !== 'group-report') || scope.selector.entityId !== undefined && url.searchParams.get('entity') !== scope.selector.entityId) fail('TEACHING_UI_SCOPE_MISMATCH');
  const readData = async path => { const response = await read(path); if (response?.status !== 200) fail('TEACHING_READ_NOT_SUCCESSFUL'); return response.data; };
  const messagePath = `/api/chat/threads/${encodeURIComponent(scope.threadId)}/messages?limit=100`;
  const knownMessages = messageRows(await readData(messagePath));
  const current = { ...scope, knownMessages };
  const stagePaths = [1, 2, 3, 4, 5, 6].map(stageId => `/api/projects/${encodeURIComponent(scope.projectId)}/aidt/stages/${stageId}`);
  const stagesBefore = await Promise.all(stagePaths.map(readData));
  const input = page.getByTestId('copilotkit-v2-input'), send = page.getByTestId('copilotkit-v2-send');
  await expect(input).toBeVisible();
  await expect(page.getByTestId('aidt-chat-context-pending')).toHaveCount(0);
  await input.fill(scope.prompt);
  await expect(send).toBeEnabled();
  armSend(current); onEvent({ event: 'send-started', stageId: scope.stageId });
  const requestReady = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === SEND_PATH, { timeout: 60000 });
  const [request] = await Promise.all([requestReady, send.click()]);
  const wire = validateTeachingWire({ method: request.method(), url: request.url(), body: request.postDataJSON() }, current);
  let stageVersionsUnchanged = true;
  let proof, observedRunId = null, terminalError = null, frozenSnapshotHash = null, pendingReviewReported = false;
  const timeout = Number.isInteger(scope.timeoutMs) && scope.timeoutMs >= 1000 && scope.timeoutMs <= 600000 ? scope.timeoutMs : 120000;
  try {
    await expect.poll(async () => {
      try {
      if (await page.getByTestId('copilotkit-v2-error').count()) fail('TEACHING_UI_ERROR');
      const messages = await readData(messagePath), accepted = identifyOwnedTeachingRun(messages, current, wire);
      if (!accepted) return false;
      if (observedRunId !== null && observedRunId !== accepted.runId) fail('TEACHING_ACCEPTANCE_MISMATCH');
      observedRunId = accepted.runId;
      if (frozenSnapshotHash === null) {
        const firstReceipt = await readData(`/api/agent-runs/${encodeURIComponent(accepted.runId)}/aidt-context`);
        if (!object(firstReceipt) || firstReceipt.runId !== accepted.runId || firstReceipt.projectId !== scope.projectId || firstReceipt.stageId !== scope.selector.stageId || firstReceipt.purpose !== scope.selector.purpose || firstReceipt.skillVersionId !== scope.skillVersionId || !HEX.test(firstReceipt.snapshotHash ?? '') || canonical(refs(firstReceipt.stageRevisions)) !== canonical(selector(scope.selector).stageRevisions)) fail('TEACHING_CONTEXT_RECEIPT_MISMATCH');
        frozenSnapshotHash = firstReceipt.snapshotHash;
      }
      const run = await readData(`/api/agent-runs/${encodeURIComponent(accepted.runId)}`);
      if (['failed', 'cancelled', 'paused'].includes(run.status)) fail('TEACHING_NATIVE_RUN_FAILED');
      if (run.status === 'awaiting_tool_permission') {
        if (run.runId !== accepted.runId || run.threadId !== current.threadId || run.inputMessageId !== accepted.inputMessageId || canonical(run.skillVersionIds) !== canonical([current.skillVersionId])) fail('TEACHING_ACCEPTANCE_MISMATCH');
        if (typeof onPendingReview === 'function' && !pendingReviewReported) {
          pendingReviewReported = true;
          const pending = object(run.pendingApproval) ? run.pendingApproval : null;
          const knownConfirmTaskIntent = pending?.toolName === 'confirm_task_intent';
          const args = knownConfirmTaskIntent && pending?.interrupt?.toolName === 'confirm_task_intent' && object(pending.interrupt.args) ? pending.interrupt.args : null;
          const argumentFields = args ? ['requestId', 'understanding', 'assumptions'].filter(name => Object.hasOwn(args, name)).map(name => ({
            name, type: typeof args[name] === 'string' && args[name].length <= 10000 ? 'string' : name === 'assumptions' && Array.isArray(args[name]) && args[name].length <= 64 && args[name].every(value => typeof value === 'string' && value.length > 0 && value.length <= 10000) ? 'array-of-strings' : 'other',
          })) : [];
          const argumentShapeKnown = Boolean(args && Object.keys(args).sort().join(',') === 'assumptions,requestId,understanding' && typeof args.requestId === 'string' && args.requestId.length > 0 && typeof args.understanding === 'string' && args.understanding.length > 0 && argumentFields.every(field => field.type === (field.name === 'assumptions' ? 'array-of-strings' : 'string')));
          try {
            await onPendingReview({ projectId: current.projectId, stageId: current.stageId, threadId: current.threadId, runId: accepted.runId, inputMessageId: accepted.inputMessageId, permissionRequestId: id(pending?.permissionRequestId) ? pending.permissionRequestId : null, toolName: knownConfirmTaskIntent ? 'confirm_task_intent' : 'other', knownConfirmTaskIntent, argumentFields, argumentShapeKnown });
          } catch { /* Passive diagnostics cannot replace the original tool-review stop. */ }
        }
        // The scope-bound callback owns any read-only UI expansion. Never open a
        // second modal here, and never turn diagnostics into an approval or result.
        const requestedTool = run.pendingApproval?.toolName;
        const toolName = typeof requestedTool === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(requestedTool) ? requestedTool : null;
        let approvalVisible = null, dialogOpened = null;
        try {
          const approval = page.getByTestId('restored-run-approval');
          const dialog = page.getByTestId('chat-tool-permission-dialog');
          const approvalShown = await approval.isVisible();
          dialogOpened = await dialog.isVisible();
          approvalVisible = approvalShown || dialogOpened;
        } catch { /* A failed passive visibility read is unknown, not proof of absence. */ }
        try {
          await onEvent({ event: 'teaching-tool-review-required', stageId: scope.stageId, runId: accepted.runId, threadId: current.threadId, toolName, approvalVisible, dialogOpened });
        } catch { /* Diagnostic callbacks cannot replace the tool-review stop. */ }
        fail('TEACHING_TOOL_REVIEW_REQUIRED');
      }
      if (run.status !== 'succeeded') return false;
      const receipt = await readData(`/api/agent-runs/${encodeURIComponent(accepted.runId)}/aidt-context`);
      proof = validateTeachingEvidence({ messages, run, receipt }, current, wire, accepted, frozenSnapshotHash);
      return true;
      } catch (error) {
        if (error instanceof ProbeFailure) { terminalError = error; return true; }
        throw error;
      }
    }, { timeout, intervals: [500, 1000, 2000] }).toBe(true);
    if (terminalError) throw terminalError;
    const stagesAfter = await Promise.all(stagePaths.map(readData));
    stageVersionsUnchanged = canonical(stagesBefore) === canonical(stagesAfter);
    if (!stageVersionsUnchanged) {
      const allowed = stagesBefore.every((previous, index) => {
        const next = stagesAfter[index];
        if (canonical(previous) === canonical(next)) return true;
        const a = previous.stage, b = next.stage;
        if (index === 5 && current.testPlan === true && a?.stageId === 6 && b?.stageId === 6 && a.projectId === current.projectId && b.projectId === current.projectId && b.revision > a.revision) {
          return validTestPlanProjection(a, { expectedRevision: a.revision, content: b.content, sourceStageRevisions: b.sourceStageRevisions }, current.selector.entityId, proof.assistantMessageId);
        }
        if (index === 3 && current.stageId === 4 && a?.stageId === 4 && b?.stageId === 4 &&
            a.projectId === current.projectId && b.projectId === current.projectId && b.revision > a.revision &&
            canonical(a.sourceStageRevisions) === canonical(b.sourceStageRevisions)) {
          return validBrainstormProjection(a, { expectedRevision: a.revision, content: b.content, sourceStageRevisions: b.sourceStageRevisions }, current.selector.entityId);
        }
        if ((index !== 0 && index !== 1) || a?.stageId !== index + 1 || b?.stageId !== index + 1
          || a.projectId !== current.projectId || b.projectId !== current.projectId || b.revision <= a.revision
          || canonical(a.sourceStageRevisions) !== canonical(b.sourceStageRevisions)) return false;
        return index === 0 ? matchesProblemProjection(a.content, b.content, current, proof)
          : matchesInterviewProjection(a.content, b.content, current, proof.assistantMessageId);
      });
      if (!allowed) fail('TEACHING_STAGE_CHANGED_DURING_RUN');
    }
  } catch (error) {
    onEvent({ event: 'send-failed-or-unresolved', stageId: scope.stageId, runId: observedRunId });
    if (error instanceof ProbeFailure) throw error;
    fail('TEACHING_NATIVE_OUTCOME_UNKNOWN');
  }
  await expect(page.getByTestId('copilotkit-v2-error')).toHaveCount(0);
  onEvent({ event: 'durable-run-succeeded', stageId: scope.stageId, runId: proof.runId });
  return { ...proof, stageSavedByAgent: false, stageVersionsUnchanged, studentDraftProjectionObserved: !stageVersionsUnchanged, contextSnapshotStableAcrossReads: true };
}
