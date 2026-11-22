/** Fixed agent-operated SOFTWARE QA channel. No credentials, user-selected targets or human signoff. */
import { createHash, randomBytes } from 'node:crypto';
import { lstatSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ProbeFailure, ORIGIN } from './devapp-aidt-auth-readonly.mjs';
import { bindAgentQaInterviewPage, INTERVIEW_BINDING_KEYS, validateAgentQaInterviewBinding, validateAgentQaInterviewWork } from './devapp-aidt-agent-interview-review.mjs';

export const AGENT_QA_CHANNEL = Object.freeze({ repository: 'boardx/workspacex', issueNumber: 6944,
  author: 'usamshen', authorId: 2325074, maxArtifacts: 12, maxLegacyArtifacts: 2, maxRequestBytes: 32768,
  maxInterviewArtifacts: 10, maxInterviewRequestBytes: 16384, maxInterviewBytes: 163840,
  preflightMs: 120000, studentMs: 180000, pollMs: 10000 });
export const AGENT_QA_FILES = Object.freeze({ preflight: 'agent-qa-preflight-request.json', student: 'agent-qa-student-request.json' });
const ENDPOINT = 'https://api.github.com/repos/boardx/workspacex/issues/6944/comments';
const SYNTHETIC = '合成验收数据，非真实访谈';
const HEX = /^[a-f0-9]{64}$/, SHA = /^[a-f0-9]{40}$/, ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/;
const fail = code => { throw new ProbeFailure(code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const text = (value, maximum) => typeof value === 'string' && Boolean(value.trim()) && value.length <= maximum;
const QUESTION_KEYS = ['projectId','entityId','threadId','runId','inputMessageId','assistantMessageId','assistantText','assistantTextSha256','studentPrompt','revision'];
const BINDING_KEYS = ['projectId','entityId','threadId','runId','inputMessageId','assistantMessageId','assistantTextSha256','revision','savedRevision'];
const REPLY_KEYS = ['schemaVersion','kind','reviewerKind','repository','issueNumber','phase','nonce','sourceSha','controlSha','workflowRunId','workflowRunAttempt','releaseTag','requestSha256','binding','decision','work'];
const WORK_KEYS = ['response','selectedDirection','choiceReason','rewrittenTheme'];
const PRIVATE_TEXT = /(?:https?:\/\/|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b1[3-9][0-9]{9}\b|\b(?:gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|sk-[A-Za-z0-9_-]{12,}|eyJ[A-Za-z0-9_-]{16,}\.)|Bearer\s+\S+|(?:password|passwd|sessionToken|authorization|api[_ -]?key|secret|token)\s*[:=])/i;

function strictJson(body) {
  let value; try { value = JSON.parse(body); } catch { fail('AGENT_QA_REPLY_INVALID'); }
  // JSON.parse discards repeated keys. Reject them, including escaped aliases, before schema validation.
  const stack = [];
  for (const match of body.matchAll(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\],:]/g)) {
    const token = match[0], top = stack.at(-1);
    if (token === '{') stack.push({ object: true, key: true, names: new Set() });
    else if (token === '[') stack.push({ object: false });
    else if (token === '}' || token === ']') stack.pop();
    else if (token === ',' && top?.object) top.key = true;
    else if (token.startsWith('"') && top?.object && top.key) {
      const name = JSON.parse(token);
      if (top.names.has(name)) fail('AGENT_QA_REPLY_INVALID');
      top.names.add(name); top.key = false;
    }
  }
  return value;
}

export function agentQaReviewRequested(env, identity) {
  const value = env.AIDT_AGENT_QA_REVIEW;
  if (value !== undefined && !['false','true'].includes(value)) fail('AGENT_QA_OPT_IN_INVALID');
  if (value !== 'true') return false;
  if (env.AIDT_LIVE_DEV !== 'true' || identity?.entryDiagnosticOnly === true || env.AIDT_ENTRY_DIAGNOSTIC_ONLY === 'true') fail('AGENT_QA_OPT_IN_SCOPE_INVALID');
  return true;
}

function safeText(value, maximum, assertSafe) {
  if (!text(value, maximum) || PRIVATE_TEXT.test(value)) fail('AGENT_QA_PRIVATE_TEXT_REJECTED');
  assertSafe(value);
  return value;
}
function validIdentity(identity, controlSource) {
  if (!identity || !SHA.test(identity.source ?? '') || !SHA.test(controlSource ?? '') || !/^[1-9][0-9]*$/.test(identity.run ?? '')
    || !/^[1-9][0-9]*$/.test(identity.attempt ?? '') || !/^[1-9][0-9]*-[1-9][0-9]*$/.test(identity.tag ?? '') || identity.entryDiagnosticOnly) fail('AGENT_QA_IDENTITY_INVALID');
}
function validateQuestion(question, assertSafe) {
  if (!exact(question, QUESTION_KEYS) || ![question.projectId,question.entityId,question.threadId,question.runId,question.inputMessageId,question.assistantMessageId].every(value => ID.test(value ?? ''))
    || !/^thr/.test(question.threadId) || !HEX.test(question.assistantTextSha256 ?? '') || !Number.isSafeInteger(question.revision) || question.revision < 1
    || typeof question.studentPrompt !== 'string' || !question.studentPrompt.includes(SYNTHETIC)) fail('AGENT_QA_QUESTION_INVALID');
  safeText(question.assistantText, 6000, assertSafe); safeText(question.studentPrompt, 5000, assertSafe);
  if (sha(question.assistantText) !== question.assistantTextSha256) fail('AGENT_QA_QUESTION_INVALID');
}

/** The only production network read: public GET on the one fixed issue, without an auth header. */
export async function readAgentQaComments(createdAt, fetchImpl = globalThis.fetch) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(createdAt)) fail('AGENT_QA_TIME_INVALID');
  const url = ENDPOINT + '?per_page=100&since=' + encodeURIComponent(createdAt);
  let response;
  try { response = await fetchImpl(url, { method: 'GET', redirect: 'error', cache: 'no-store',
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'workspacex-aidt-agent-qa' }, signal: AbortSignal.timeout(10000) }); }
  catch { fail('AGENT_QA_GITHUB_READ_FAILED'); }
  if (response.status !== 200 || response.url !== url) fail('AGENT_QA_GITHUB_READ_FAILED');
  let size = 0; const chunks = [];
  try {
    for await (const chunk of response.body) { size += chunk.byteLength; if (size > 1048576) fail('AGENT_QA_REPLY_PAGE_BOUND'); chunks.push(Buffer.from(chunk)); }
  } catch (error) { if (error instanceof ProbeFailure) throw error; fail('AGENT_QA_GITHUB_READ_FAILED'); }
  let rows; try { rows = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('AGENT_QA_GITHUB_READ_FAILED'); }
  if (!Array.isArray(rows) || rows.length >= 100) fail('AGENT_QA_REPLY_PAGE_BOUND');
  return rows;
}

/** SDK is loaded only in an opted-in real job; pure tests inject transport, never install or use it. */
export async function uploadAgentQaRequest({ name, file, root }) {
  try {
    const { DefaultArtifactClient } = await import('@actions/artifact');
    const result = await new DefaultArtifactClient().uploadArtifact(name, [file], root, { retentionDays: 1, compressionLevel: 0 });
    if (!Number.isSafeInteger(result?.id) || result.id < 1) fail('AGENT_QA_UPLOAD_FAILED');
    return { id: result.id };
  } catch { fail('AGENT_QA_UPLOAD_FAILED'); }
}

export function validateAgentQaReply(comment, request, requestSha256, now, assertSafe) {
  if (typeof assertSafe !== 'function') fail('AGENT_QA_SECRET_GUARD_REQUIRED');
  if (!object(comment) || !Number.isSafeInteger(comment.id) || comment.id < 1 || !text(comment.body, 16384)
    || Buffer.byteLength(comment.body) > 16384) fail('AGENT_QA_REPLY_INVALID');
  if (comment.user?.login !== AGENT_QA_CHANNEL.author || comment.user?.id !== AGENT_QA_CHANNEL.authorId || comment.user?.type !== 'User') fail('AGENT_QA_REPLY_AUTHOR_REJECTED');
  const created = Date.parse(comment.created_at), deadline = Date.parse(request.deadlineAt), beginning = Math.floor(Date.parse(request.createdAt) / 1000) * 1000;
  if (!Number.isFinite(created) || comment.created_at !== comment.updated_at || created < beginning || created > deadline || created > now + 1000 || now > deadline) fail('AGENT_QA_REPLY_STALE_OR_EDITED');
  const reply = strictJson(comment.body);
  if (!exact(reply, REPLY_KEYS) || reply.kind !== 'aidt-agent-qa-response' || reply.requestSha256 !== requestSha256
    || ['schemaVersion','reviewerKind','repository','issueNumber','phase','nonce','sourceSha','controlSha','workflowRunId','workflowRunAttempt','releaseTag'].some(key => reply[key] !== request[key])
    || canonical(reply.binding) !== canonical(request.binding)) fail('AGENT_QA_REPLY_BINDING_MISMATCH');
  if (request.phase === 'preflight') {
    if (reply.decision !== 'ready' || reply.work !== null || reply.binding !== null) fail('AGENT_QA_REPLY_INVALID');
  } else if (request.phase === 'interview') {
    if (reply.decision !== 'respond' || !exact(reply.binding, INTERVIEW_BINDING_KEYS)) fail('AGENT_QA_REPLY_INVALID');
    validateAgentQaInterviewBinding(reply.binding);
    validateAgentQaInterviewWork(reply.work, request.question, (value, limit) => safeText(value, limit, assertSafe));
  } else if (request.phase === 'student') {
    if (reply.decision !== 'respond' || !exact(reply.binding, BINDING_KEYS) || !exact(reply.work, WORK_KEYS)) fail('AGENT_QA_REPLY_INVALID');
    for (const [key, limit] of [['response',3000],['selectedDirection',120],['choiceReason',650],['rewrittenTheme',650]]) safeText(reply.work[key], limit, assertSafe);
    if (reply.work.response.trim() === request.question.assistantText.trim()) fail('AGENT_QA_REPLY_INVALID');
  } else fail('AGENT_QA_REPLY_INVALID');
  assertSafe(JSON.stringify(reply));
  return reply;
}

function protocolCandidate(row, nonce) {
  if (typeof row?.body !== 'string' || Buffer.byteLength(row.body) > 16384) return false;
  let body; try { body = JSON.parse(row.body); } catch { return false; }
  return body?.kind === 'aidt-agent-qa-response' && body?.nonce === nonce;
}
function messageSnapshot(value, question) {
  const rows = Array.isArray(value) ? value : value?.messages;
  if (!Array.isArray(rows) || rows.length > 100 || !Array.isArray(value) && value.nextCursor != null) fail('AGENT_QA_MESSAGES_CHANGED');
  const input = rows.filter(row => row?.id === question.inputMessageId), output = rows.filter(row => row?.id === question.assistantMessageId);
  if (input.length !== 1 || output.length !== 1 || input[0].authorKind !== 'human' || input[0].text !== question.studentPrompt
    || input[0].agentRunId !== question.runId || output[0].authorKind !== 'agent' || output[0].agentRunId !== question.runId
    || output[0].text !== question.assistantText || sha(output[0].text) !== question.assistantTextSha256) fail('AGENT_QA_MESSAGES_CHANGED');
  return sha(canonical(rows));
}

/** Only fixed production targets; injection points are functions in an audited Node test/driver, never user inputs. */
export function createAgentQaReviewer({ identity, controlSource, out, assertSafe, transport = {}, now = Date.now, nonce = () => randomBytes(32).toString('hex'), deadlineAt }) {
  validIdentity(identity, controlSource);
  if (typeof assertSafe !== 'function') fail('AGENT_QA_SECRET_GUARD_REQUIRED');
  if (typeof out !== 'string' || !out.startsWith('/')) fail('AGENT_QA_OUTPUT_INVALID');
  const outputInfo = lstatSync(out);
  if (!outputInfo.isDirectory() || outputInfo.isSymbolicLink() || (outputInfo.mode & 0o777) !== 0o700 || outputInfo.uid !== process.getuid()) fail('AGENT_QA_OUTPUT_INVALID');
  const upload = transport.upload ?? uploadAgentQaRequest, read = transport.read ?? readAgentQaComments;
  const wait = transport.wait ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  let count = 0, legacyCount = 0, interviewCount = 0, bytesExported = 0, interviewBytesExported = 0, preflightPassed = false, bound = false, studentUsed = false, interviewReviewer;
  const usedNonces = new Set(), acceptedComments = new Set(), receipts = [];
  const bounded = async (operation, end) => {
    const remaining = end - now();
    if (remaining <= 0) fail('AGENT_QA_REVIEW_TIMEOUT');
    let timer;
    try {
      return await Promise.race([Promise.resolve().then(operation), new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new ProbeFailure('AGENT_QA_REVIEW_TIMEOUT')), remaining);
      })]);
    } finally { clearTimeout(timer); }
  };
  const requestReply = async (phase, binding = null, question = null, assertCurrent = () => {}, reviewDeadline) => {
    if (!['preflight','student','interview'].includes(phase)) fail('AGENT_QA_REPLY_INVALID');
    if (phase === 'interview' ? ++interviewCount > AGENT_QA_CHANNEL.maxInterviewArtifacts : ++legacyCount > AGENT_QA_CHANNEL.maxLegacyArtifacts) fail('AGENT_QA_REQUEST_LIMIT');
    if (++count > AGENT_QA_CHANNEL.maxArtifacts) fail('AGENT_QA_REQUEST_LIMIT');
    const start = now(), nonceValue = nonce();
    if (!HEX.test(nonceValue) || usedNonces.has(nonceValue)) fail('AGENT_QA_NONCE_REUSED');
    usedNonces.add(nonceValue);
    const maximum = start + (phase === 'preflight' ? AGENT_QA_CHANNEL.preflightMs : AGENT_QA_CHANNEL.studentMs);
    const end = Math.min(maximum, deadlineAt ?? maximum, reviewDeadline ?? maximum);
    if (!Number.isFinite(end) || end <= start) fail('AGENT_QA_REVIEW_TIMEOUT');
    const request = Object.freeze({ schemaVersion: 1, kind: 'aidt-agent-qa-request', reviewerKind: 'agent',
      repository: AGENT_QA_CHANNEL.repository, issueNumber: AGENT_QA_CHANNEL.issueNumber, phase, nonce: nonceValue,
      sourceSha: identity.source, controlSha: controlSource, workflowRunId: identity.run, workflowRunAttempt: identity.attempt, releaseTag: identity.tag,
      createdAt: new Date(start).toISOString(), deadlineAt: new Date(end).toISOString(), syntheticLabel: SYNTHETIC, binding, question });
    const payload = JSON.stringify(request, null, 2) + '\n', requestSha256 = sha(payload);
    assertSafe(payload);
    const payloadBytes = Buffer.byteLength(payload);
    if (phase === 'interview') {
      interviewBytesExported += payloadBytes;
      if (payloadBytes > AGENT_QA_CHANNEL.maxInterviewRequestBytes || interviewBytesExported > AGENT_QA_CHANNEL.maxInterviewBytes || !/^U(?:0[1-9]|10)$/.test(binding?.code ?? '')) fail('AGENT_QA_REQUEST_BYTES_BOUND');
    } else {
      bytesExported += payloadBytes;
      if (bytesExported > AGENT_QA_CHANNEL.maxRequestBytes) fail('AGENT_QA_REQUEST_BYTES_BOUND');
    }
    const filename = phase === 'interview' ? `agent-qa-interview-${binding.code}-request.json` : AGENT_QA_FILES[phase], file = resolve(out, filename);
    writeFileSync(file, payload, { flag: 'wx', mode: 0o600 });
    let artifact;
    assertCurrent();
    try { artifact = await bounded(() => upload({ name: `aidt-agent-qa-${phase}${phase === 'interview' ? '-' + binding.code : ''}-${identity.run}-${identity.attempt}`, file, root: out }), end); }
    catch (error) { if (error instanceof ProbeFailure && error.code === 'AGENT_QA_REVIEW_TIMEOUT') throw error; fail('AGENT_QA_UPLOAD_FAILED'); }
    if (!Number.isSafeInteger(artifact?.id) || artifact.id < 1) fail('AGENT_QA_UPLOAD_FAILED');
    let polls = 0;
    const observe = async () => {
      assertCurrent();
      if (++polls > 22 || now() > end) fail('AGENT_QA_REVIEW_TIMEOUT');
      const rows = await bounded(() => read(request.createdAt), end);
      assertCurrent();
      if (!Array.isArray(rows) || rows.length >= 100) fail('AGENT_QA_REPLY_PAGE_BOUND');
      const matches = rows.filter(row => protocolCandidate(row, nonceValue));
      if (matches.length > 1) fail('AGENT_QA_REPLY_DUPLICATE');
      if (!matches.length) return null;
      const comment = matches[0], reply = validateAgentQaReply(comment, request, requestSha256, now(), assertSafe);
      if (acceptedComments.has(comment.id)) fail('AGENT_QA_REPLY_REPLAYED');
      return { comment, reply };
    };
    while (now() <= end) {
      const result = await observe();
      if (result) {
        // Re-read the API object before accepting it; an edited/replaced or duplicate response is never replayed.
        const stable = await observe();
        if (!stable || stable.comment.id !== result.comment.id || stable.comment.body !== result.comment.body) fail('AGENT_QA_REPLY_CHANGED');
        acceptedComments.add(result.comment.id);
        receipts.push({ phase, ...(phase === 'interview' ? { interviewCode: binding.code } : {}), reviewerKind: 'agent', softwareQaOnly: true, artifactId: artifact.id, filename,
          bytes: Buffer.byteLength(payload), requestSha256, commentId: result.comment.id, nonce: nonceValue,
          h03ConversationSignoff: false, teachingQualityAccepted: false });
        return result.reply;
      }
      await bounded(() => wait(Math.min(AGENT_QA_CHANNEL.pollMs, Math.max(0, end - now()))), end);
      if (now() >= end) fail('AGENT_QA_REVIEW_TIMEOUT');
    }
    fail('AGENT_QA_REVIEW_TIMEOUT');
  };
  return Object.freeze({
    async preflight() {
      if (count !== 0) fail('AGENT_QA_PREFLIGHT_REPLAYED');
      await requestReply('preflight'); preflightPassed = true;
      return { ...receipts[0] };
    },
    bindPage({ page, context, readStage, readMessages }) {
      if (!preflightPassed || bound || !page || !context || typeof readStage !== 'function' || typeof readMessages !== 'function') fail('AGENT_QA_PAGE_BINDING_REQUIRED');
      bound = true;
      let invalidated = false;
      const live = question => {
        if (invalidated || page.isClosed() || page.context() !== context || !context.pages().includes(page)) fail('AGENT_QA_PAGE_CHANGED');
        let url; try { url = new URL(page.url()); } catch { fail('AGENT_QA_PAGE_CHANGED'); }
        if (url.origin !== ORIGIN || url.username || url.password || url.hash || url.pathname !== `/aidt/${question.projectId}`
          || url.searchParams.getAll('step').length !== 1 || url.searchParams.get('step') !== '1'
          || url.searchParams.getAll('entity').length !== 1 || url.searchParams.get('entity') !== question.entityId
          || url.searchParams.getAll('thread').length !== 1 || url.searchParams.get('thread') !== question.threadId
          || url.searchParams.has('history') || url.searchParams.has('summary')) fail('AGENT_QA_PAGE_CHANGED');
      };
      const snapshot = async question => {
        live(question);
        const stage = await readStage(question), messages = await readMessages(question);
        let draft; try { draft = JSON.parse(stage?.content?.draft?.fields?.[`problemDraft:${question.entityId}`]); } catch { fail('AGENT_QA_SAVED_VERSION_CHANGED'); }
        if (stage.projectId !== question.projectId || stage.stageId !== 1 || !Number.isSafeInteger(stage.revision) || stage.revision <= question.revision
          || draft?.draftTurnId !== question.assistantMessageId || draft?.roundCompletion || draft?.problemReflectionConfirmed
          || !text(draft?.initial, 6000) || !question.studentPrompt.includes(draft.initial)) fail('AGENT_QA_SAVED_VERSION_CHANGED');
        live(question);
        return { savedRevision: stage.revision, stageHash: sha(canonical(stage)), messageHash: messageSnapshot(messages, question) };
      };
      return async question => {
        if (studentUsed) fail('AGENT_QA_STUDENT_REVIEW_REPLAYED');
        studentUsed = true;
        validateQuestion(question, assertSafe);
        if (typeof page.on !== 'function' || typeof page.off !== 'function' || typeof page.mainFrame !== 'function') fail('AGENT_QA_PAGE_BINDING_REQUIRED');
        const navigated = frame => { if (frame === page.mainFrame()) invalidated = true; };
        const closed = () => { invalidated = true; };
        const writing = request => {
          try {
            const url = new URL(request.url());
            if (url.origin === ORIGIN && (request.method() === 'POST' && url.pathname === '/api/copilotkit/agent/default/run'
              || request.method() === 'PUT' && url.pathname === `/api/projects/${question.projectId}/aidt/stages/1`)) invalidated = true;
          } catch { invalidated = true; }
        };
        page.on('framenavigated', navigated); page.on('close', closed); page.on('request', writing);
        try {
          const studentDeadline = Math.min(now() + AGENT_QA_CHANNEL.studentMs, deadlineAt ?? Infinity);
          const before = await bounded(() => snapshot(question), studentDeadline), original = canonical(question);
          const binding = Object.freeze(Object.fromEntries(BINDING_KEYS.map(key => [key, key === 'savedRevision' ? before.savedRevision : question[key]])));
          const reply = await requestReply('student', binding, { assistantText: question.assistantText, studentPrompt: question.studentPrompt }, () => live(question), studentDeadline);
          const after = await bounded(() => snapshot(question), studentDeadline);
          if (canonical(question) !== original || canonical(before) !== canonical(after)) fail('AGENT_QA_SAVED_VERSION_CHANGED');
          return { ...binding, approved: true, ...reply.work, reviewerKind: 'agent',
            h03ConversationSignoff: false, teachingQualityAccepted: false };
        } finally { page.off('framenavigated', navigated); page.off('close', closed); page.off('request', writing); }
      };
    },
    bindInterviewPage(options) {
      if (!preflightPassed || interviewReviewer) fail('AGENT_QA_INTERVIEW_PORT_REQUIRED');
      interviewReviewer = bindAgentQaInterviewPage({ ...options, requestReply, canonical, sha, bounded, now, deadlineAt,
        studentMs: AGENT_QA_CHANNEL.studentMs, safeText: (value, limit) => safeText(value, limit, assertSafe) });
      return interviewReviewer.review;
    },
    summary: () => ({ reviewerKind: 'agent', softwareQaOnly: true, preflightPassed, requestCount: count, bytesExported,
      interviewRequestCount: interviewCount, interviewBytesExported, totalBytesExported: bytesExported + interviewBytesExported, interview: interviewReviewer?.summary() ?? null,
      h03ConversationSignoff: false, teachingQualityAccepted: false, receipts: receipts.map(item => ({ ...item })) }),
  });
}
