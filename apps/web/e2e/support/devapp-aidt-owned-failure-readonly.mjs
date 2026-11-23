/** Fixed-instance normal GET diagnostic; no model, account, billing or project mutations. */
import { createHash } from 'node:crypto';
import { validLoginBody } from './devapp-aidt-auth-readonly.mjs';

export const OWNED_FAILURE_SCOPE = Object.freeze({
  origin: 'https://devapp.boardx.us',
  source: 'd9427203c17cdaadd0a49567a55c38a1717b5095',
  tag: '45082216305-1',
  projectId: 'prj-75efa044-830a-4de2-8a93-da0733a4e4f0',
  entityId: '899db27f-da7f-4493-826f-689bdeb5c60c',
  threadId: 'thr_aidt_38909581a7b4ae37c4449fa8992e3d580726bd799c8cb2fa6f1a91a8e6d31ce6',
  humanSha256: 'f72fa0b312e4c668647154601c3c726b69d7f67d1f9adb078b968b3b1af3ab9d',
});
export const OWNED_FAILURE_REPORT_FILE = 'owned-failure-readonly.json';
const STATUS = new Set(['queued', 'running', 'writeback_pending', 'succeeded', 'failed', 'paused', 'cancelled', 'awaiting_tool_permission']);
const ERROR = new Set(['CREDIT_REQUIRED', 'CREDIT_ACCOUNTING_UNAVAILABLE', 'MODEL_CALL_FAILED', 'MODEL_PROVIDER_NOT_CONFIGURED',
  'SKILL_VERSION_UNAVAILABLE', 'AGENT_VERSION_UNAVAILABLE', 'CHAT_WRITEBACK_FAILED', 'HITL_REJECTED']);
const sha = value => createHash('sha256').update(value).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/u.test(value);
const keys = (value, list) => object(value) && Object.keys(value).sort().join(',') === [...list].sort().join(',');
const REPORT_CODES = new Set(['OWNED_FAILURE_NOT_OBSERVED', 'OWNED_FAILURE_OBSERVED', 'OWNED_FAILURE_TIMEOUT',
  'OWNED_FAILURE_INPUT_INVALID', 'OWNED_FAILURE_CONFIGURED_IDENTITY_MISMATCH', 'OWNED_FAILURE_SESSION_CHANGED',
  'OWNED_FAILURE_READ_SCOPE_REJECTED', 'OWNED_FAILURE_READ_INVALID', 'OWNED_FAILURE_ORDINARY_IDENTITY_REQUIRED',
  'OWNED_FAILURE_THREAD_MISMATCH', 'OWNED_FAILURE_MESSAGE_PAGE_INVALID', 'OWNED_FAILURE_HUMAN_BINDING_MISMATCH',
  'OWNED_FAILURE_RUN_BINDING_MISMATCH', 'OWNED_FAILURE_CREDIT_BINDING_MISMATCH', 'OWNED_FAILURE_DIAGNOSTIC_UNAVAILABLE']);
/** Validate before writing; never serialize a rejected report or a caught exception. */
export function isSafeOwnedFailureReport(value) {
  const booleans = ['completed', 'loginVerified', 'ordinaryActorVerified', 'configuredIdentityVerified', 'threadProjectMatches',
    'ownedRunBound', 'runBindingMatches', 'sameSessionVerified', 'runTerminal', 'terminalBeforeRunRead', 'normalRunReadMayMaintainStale'];
  if (!keys(value, ['code', ...booleans, 'matchingHumanCount', 'status', 'errorCode', 'creditOwnerType', 'creditReason',
    'counts', 'readDiagnostics', 'projectWritesAllowed', 'financialWritesAllowed', 'modelRequestsAllowed'])
    || !REPORT_CODES.has(value.code) || !booleans.every(key => typeof value[key] === 'boolean')
    || value.completed !== (value.code === 'OWNED_FAILURE_OBSERVED')
    || !Number.isSafeInteger(value.matchingHumanCount) || value.matchingHumanCount < 0 || value.matchingHumanCount > 100
    || value.status !== null && !STATUS.has(value.status)
    || value.errorCode !== null && value.errorCode !== 'unknown' && !ERROR.has(value.errorCode)
    || ![null, 'user', 'team'].includes(value.creditOwnerType) || ![null, 'member_monthly_limit', 'unknown'].includes(value.creditReason)
    || !keys(value.counts, ['identityReads', 'threadReads', 'messageReads', 'runReads'])
    || !Object.entries(value.counts).every(([key, count]) => Number.isSafeInteger(count) && count >= 0 && count <= (key === 'identityReads' ? 2 : 1))
    || !Array.isArray(value.readDiagnostics) || value.readDiagnostics.length > 5
    || value.readDiagnostics.length !== Object.values(value.counts).reduce((sum, count) => sum + count, 0)
    || !value.readDiagnostics.every(read => keys(read, ['category', 'httpStatus'])
      && ['identity', 'thread-detail', 'thread-messages', 'owned-run'].includes(read.category)
      && (read.httpStatus === null || Number.isSafeInteger(read.httpStatus) && read.httpStatus >= 100 && read.httpStatus <= 599))
    || value.projectWritesAllowed !== 0 || value.financialWritesAllowed !== 0 || value.modelRequestsAllowed !== 0) return false;
  return true;
}
class DiagnosticFailure extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new DiagnosticFailure(code); };

/** Ports are host-controlled, never workflow inputs. readJson performs only the supplied
 * normal GET, with the same browser token checked immediately before and after fetch,
 * no redirect/retry, a 15s abort and a 256 KiB response bound. No body is exported. */
export async function runOwnedFailureReadonly(ports) {
  const report = {
    code: 'OWNED_FAILURE_NOT_OBSERVED', completed: false, loginVerified: false, ordinaryActorVerified: false,
    configuredIdentityVerified: false, threadProjectMatches: false, matchingHumanCount: 0, ownedRunBound: false,
    runBindingMatches: false, sameSessionVerified: false, runTerminal: false,
    status: null, errorCode: null, creditOwnerType: null, creditReason: null,
    terminalBeforeRunRead: false, normalRunReadMayMaintainStale: false,
    counts: { identityReads: 0, threadReads: 0, messageReads: 0, runReads: 0 },
    readDiagnostics: [],
    projectWritesAllowed: 0, financialWritesAllowed: 0, modelRequestsAllowed: 0,
  };
  const deadline = Date.now() + 90000;
  async function bounded(operation, milliseconds) {
    let timer;
    try {
      const wait = Math.min(milliseconds, deadline - Date.now());
      if (wait <= 0) fail('OWNED_FAILURE_TIMEOUT');
      return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new DiagnosticFailure('OWNED_FAILURE_TIMEOUT')), wait);
      })]);
    } finally { clearTimeout(timer); }
  }
  try {
    if (!keys(ports, ['login', 'configuredIdentitySha256', 'readSession', 'readJson'])
      || typeof ports.readSession !== 'function' || typeof ports.readJson !== 'function'
      || !validLoginBody(ports.login)) fail('OWNED_FAILURE_INPUT_INVALID');
    const login = ports.login;
    if (!id(login.userId) || login.orgs.length > 100 || !login.orgs.every(id)
      || new Set(login.orgs).size !== login.orgs.length || login.sessionToken.length > 8192) fail('OWNED_FAILURE_INPUT_INVALID');
    const org = [...login.orgs].sort().find(value => !value.startsWith('org-local-')) ?? [...login.orgs].sort()[0];
    const actor = login.userId, token = login.sessionToken;
    const configured = ports.configuredIdentitySha256;
    if (!/^[a-f0-9]{64}$/u.test(configured ?? '')
      || configured !== sha(JSON.stringify(['devapp-aidt-qa-v1', actor, org]))) fail('OWNED_FAILURE_CONFIGURED_IDENTITY_MISMATCH');
    report.configuredIdentityVerified = true;
    let sessionFingerprint;
    async function sameSession() {
      const snapshot = await bounded(() => ports.readSession(), 5000);
      if (!keys(snapshot, ['token', 'actor', 'org', 'version', 'revision', 'commit'])
        || snapshot.token !== token || snapshot.actor !== actor || snapshot.org !== org
        || ![1, 2].includes(snapshot.version)
        || snapshot.version === 2 && (typeof snapshot.revision !== 'string' || !snapshot.revision || snapshot.revision.length > 256 || snapshot.commit !== snapshot.revision)
        || snapshot.version === 1 && ![null, undefined].includes(snapshot.revision)
        || snapshot.commit !== null && (typeof snapshot.commit !== 'string' || snapshot.commit.length > 256)
        || Date.parse(login.expiresAt) <= Date.now()) fail('OWNED_FAILURE_SESSION_CHANGED');
      const fingerprint = sha(JSON.stringify([snapshot.token, snapshot.actor, snapshot.org, snapshot.version, snapshot.revision, snapshot.commit]));
      if (sessionFingerprint && fingerprint !== sessionFingerprint) fail('OWNED_FAILURE_SESSION_CHANGED');
      sessionFingerprint = fingerprint;
    }
    await sameSession();
    report.loginVerified = true;
    const identityPath = '/api/identity/me?orgId=' + encodeURIComponent(org);
    const threadBase = '/api/chat/threads/' + encodeURIComponent(OWNED_FAILURE_SCOPE.threadId);
    const threadDetailPath = threadBase + '?projectId=' + encodeURIComponent(OWNED_FAILURE_SCOPE.projectId);
    const threadMessagesPath = threadBase + '/messages?limit=100';
    let boundRun;
    async function read(path, count) {
      const allowed = path === identityPath && count === 'identityReads' && report.counts[count] < 2
        || path === threadDetailPath && count === 'threadReads' && report.counts[count] === 0
        || path === threadMessagesPath && count === 'messageReads' && report.counts[count] === 0
        || boundRun && path === '/api/agent-runs/' + encodeURIComponent(boundRun) && count === 'runReads' && report.counts[count] === 0;
      if (!allowed) fail('OWNED_FAILURE_READ_SCOPE_REJECTED');
      await sameSession();
      report.counts[count]++;
      const diagnostic = { category: { identityReads: 'identity', threadReads: 'thread-detail', messageReads: 'thread-messages', runReads: 'owned-run' }[count], httpStatus: null };
      report.readDiagnostics.push(diagnostic);
      if (count === 'runReads') report.normalRunReadMayMaintainStale = true;
      const response = await bounded(() => ports.readJson(path, { expectedTokenSha256: sha(token) }), 15000);
      if (object(response) && Number.isSafeInteger(response.status) && response.status >= 100 && response.status <= 599) diagnostic.httpStatus = response.status;
      await sameSession();
      if (!keys(response, ['status', 'body']) || response.status !== 200 || !object(response.body)
        || Buffer.byteLength(JSON.stringify(response.body)) > 262144) fail('OWNED_FAILURE_READ_INVALID');
      return response.body;
    }
    const identity = await read(identityPath, 'identityReads');
    const verifyIdentity = value => {
      if (value.orgRole !== 'consultant' || value.org?.id !== org || value.org?.kind !== 'organization') fail('OWNED_FAILURE_ORDINARY_IDENTITY_REQUIRED');
    };
    verifyIdentity(identity);
    report.ordinaryActorVerified = true;
    const thread = await read(threadDetailPath, 'threadReads');
    if (thread.thread?.id !== OWNED_FAILURE_SCOPE.threadId || thread.thread?.projectId !== OWNED_FAILURE_SCOPE.projectId
      || thread.thread?.archived !== false) fail('OWNED_FAILURE_THREAD_MISMATCH');
    report.threadProjectMatches = true;
    const messages = await read(threadMessagesPath, 'messageReads');
    if (!keys(messages, ['messages', 'nextCursor']) || !Array.isArray(messages.messages) || messages.messages.length > 100
      || messages.nextCursor !== null || messages.messages.some(row => !object(row) || typeof row.text !== 'string' || row.text.length > 100000)) fail('OWNED_FAILURE_MESSAGE_PAGE_INVALID');
    const matching = messages.messages.filter(row => sha(row.text) === OWNED_FAILURE_SCOPE.humanSha256);
    report.matchingHumanCount = matching.length;
    if (matching.length !== 1 || matching[0].authorKind !== 'human' || matching[0].authorId !== actor
      || !id(matching[0].id) || !id(matching[0].agentRunId)) fail('OWNED_FAILURE_HUMAN_BINDING_MISMATCH');
    const human = matching[0];
    boundRun = human.agentRunId;
    report.ownedRunBound = true;
    const run = await read('/api/agent-runs/' + encodeURIComponent(boundRun), 'runReads');
    if (run.runId !== boundRun || run.threadId !== OWNED_FAILURE_SCOPE.threadId || run.inputMessageId !== human.id
      || !STATUS.has(run.status) || run.error !== null && typeof run.error !== 'string') fail('OWNED_FAILURE_RUN_BINDING_MISMATCH');
    report.runBindingMatches = true;
    const after = await read(identityPath, 'identityReads');
    verifyIdentity(after);
    report.sameSessionVerified = true;
    report.status = run.status;
    report.errorCode = run.error === null ? null : ERROR.has(run.error) ? run.error : 'unknown';
    report.runTerminal = ['succeeded', 'failed', 'cancelled'].includes(run.status);
    if (run.creditFailure !== undefined) {
      const credit = run.creditFailure;
      if (!object(credit) || credit.code !== 'credit_required' || run.status !== 'failed' || run.error !== 'CREDIT_REQUIRED'
        || !['user', 'team'].includes(credit.ownerType) || credit.ownerId !== (credit.ownerType === 'user' ? actor : org)) fail('OWNED_FAILURE_CREDIT_BINDING_MISMATCH');
      report.creditOwnerType = credit.ownerType;
      report.creditReason = credit.reason === undefined ? null : credit.reason === 'member_monthly_limit' ? credit.reason : 'unknown';
    }
    report.completed = true;
    report.code = 'OWNED_FAILURE_OBSERVED';
  } catch (error) {
    report.code = error instanceof DiagnosticFailure ? error.code : 'OWNED_FAILURE_DIAGNOSTIC_UNAVAILABLE';
  }
  return report;
}
