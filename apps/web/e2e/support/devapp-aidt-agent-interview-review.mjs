/** One source-bound SOFTWARE QA response per owned synthetic interview; never a tool or classroom signoff. */
import { createHash } from 'node:crypto';
import { ProbeFailure, ORIGIN } from './devapp-aidt-auth-readonly.mjs';
const fail = code => { throw new ProbeFailure(code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/, HEX = /^[a-f0-9]{64}$/;
const CODE = /^U(?:0[1-9]|10)$/;
const QUESTION_KEYS = ['stageId','code','projectId','entityId','threadId','runId','inputMessageId','assistantMessageId','assistantText','assistantTextSha256','studentPrompt','studentPromptSha256','revision','sourceProblemEntityId','sourceProblemRevision','skillId','skillVersionId','snapshotHash','assembledContextHash'];
export const INTERVIEW_BINDING_KEYS = Object.freeze(['stageId','code','projectId','entityId','threadId','runId','inputMessageId','assistantMessageId','assistantTextSha256','studentPromptSha256','originalSha256','revision','savedRevision','recordSnapshotHash','sourceProblemEntityId','sourceProblemRevision','sourceSnapshotHash','skillId','skillVersionId','snapshotHash','assembledContextHash']);

export function validateAgentQaInterviewBinding(value) {
  if (!exact(value, INTERVIEW_BINDING_KEYS) || value.stageId !== 2 || !CODE.test(value.code ?? '')
    || !['projectId','entityId','threadId','runId','inputMessageId','assistantMessageId','sourceProblemEntityId','skillId','skillVersionId'].every(key => ID.test(value[key] ?? ''))
    || !value.threadId.startsWith('thr_aidt_')
    || !['assistantTextSha256','studentPromptSha256','originalSha256','recordSnapshotHash','sourceSnapshotHash','snapshotHash','assembledContextHash'].every(key => HEX.test(value[key] ?? ''))
    || !['revision','savedRevision','sourceProblemRevision'].every(key => Number.isSafeInteger(value[key]) && value[key] > 0)
    || value.savedRevision <= value.revision) fail('AGENT_QA_INTERVIEW_BINDING_INVALID');
}

export function validateAgentQaInterviewWork(work, question, safeText) {
  if (!exact(question, ['assistantText','studentPrompt']) || !exact(work, ['response','choiceReason'])) fail('AGENT_QA_INTERVIEW_WORK_INVALID');
  safeText(question.assistantText, 6000); safeText(question.studentPrompt, 5000);
  safeText(work.response, 3000); safeText(work.choiceReason, 650);
  if (work.response.trim() === question.assistantText.trim()) fail('AGENT_QA_INTERVIEW_WORK_INVALID');
}

/** All reads are injected, scoped existing API ports; this module has no network client. */
export function bindAgentQaInterviewPage({ page, context, actor, readActor, readStage, readSource, readMessages, readRun, readReceipt, ownedPin,
  requestReply, safeText, canonical, sha, bounded, now, deadlineAt, studentMs }) {
  if (!page || !context || !ID.test(actor?.actorId ?? '') || !ID.test(actor?.orgId ?? '')
    || [readActor,readStage,readSource,readMessages,readRun,readReceipt,ownedPin,requestReply,safeText,canonical,sha,bounded,now].some(value => typeof value !== 'function')) fail('AGENT_QA_INTERVIEW_PORT_REQUIRED');
  const usedEntities = new Set(), usedCodes = new Set();
  const live = q => {
    if (page.isClosed() || page.context() !== context || !context.pages().includes(page)) fail('AGENT_QA_INTERVIEW_PAGE_CHANGED');
    let url; try { url = new URL(page.url()); } catch { fail('AGENT_QA_INTERVIEW_PAGE_CHANGED'); }
    if (url.origin !== ORIGIN || url.username || url.password || url.hash || url.pathname !== `/aidt/${q.projectId}`
      || url.searchParams.getAll('step').length !== 1 || url.searchParams.get('step') !== '2'
      || url.searchParams.getAll('entity').length !== 1 || url.searchParams.get('entity') !== q.entityId
      || url.searchParams.getAll('thread').length !== 1 || url.searchParams.get('thread') !== q.threadId
      || url.searchParams.has('history') || url.searchParams.has('summary')
      || url.searchParams.has('problemEntity') && (url.searchParams.getAll('problemEntity').length !== 1 || url.searchParams.get('problemEntity') !== q.sourceProblemEntityId)
      || url.searchParams.has('problemRevision') && (url.searchParams.getAll('problemRevision').length !== 1 || url.searchParams.get('problemRevision') !== String(q.sourceProblemRevision))) fail('AGENT_QA_INTERVIEW_PAGE_CHANGED');
  };
  const validate = q => {
    if (!exact(q, QUESTION_KEYS) || q.stageId !== 2 || !CODE.test(q.code ?? '')
      || !['projectId','entityId','threadId','runId','inputMessageId','assistantMessageId','sourceProblemEntityId','skillId','skillVersionId'].every(key => ID.test(q[key] ?? ''))
      || !q.threadId.startsWith('thr_aidt_') || !['assistantTextSha256','studentPromptSha256','snapshotHash','assembledContextHash'].every(key => HEX.test(q[key] ?? ''))
      || !Number.isSafeInteger(q.revision) || q.revision < 1 || !Number.isSafeInteger(q.sourceProblemRevision) || q.sourceProblemRevision < 1
      || typeof q.studentPrompt !== 'string' || !q.studentPrompt.includes('合成验收数据，非真实访谈')) fail('AGENT_QA_INTERVIEW_QUESTION_INVALID');
    safeText(q.studentPrompt, 5000); safeText(q.assistantText, 6000);
    if (sha(q.studentPrompt) !== q.studentPromptSha256 || sha(q.assistantText) !== q.assistantTextSha256) fail('AGENT_QA_INTERVIEW_QUESTION_INVALID');
  };
  const snapshot = async q => {
    live(q);
    const actualActor = await readActor(q);
    if (!exact(actualActor, ['actorId','orgId','orgRole','ordinaryVerified']) || actualActor.actorId !== actor.actorId || actualActor.orgId !== actor.orgId
      || actualActor.orgRole !== 'consultant' || actualActor.ordinaryVerified !== true) fail('AGENT_QA_INTERVIEW_ACTOR_CHANGED');
    const pin = ownedPin(q);
    if (pin?.skillId !== q.skillId || pin.skillVersionId !== q.skillVersionId) fail('AGENT_QA_INTERVIEW_PIN_CHANGED');
    const [stage, source, messages, run, receipt] = await Promise.all([readStage(q),readSource(q),readMessages(q),readRun(q),readReceipt(q)]);
    live(q);
    let record, sourceDraft;
    try { record = JSON.parse(stage?.content?.draft?.fields?.[`interviewRecord:${q.entityId}`]); sourceDraft = JSON.parse(source?.content?.draft?.fields?.[`problemDraft:${q.sourceProblemEntityId}`]); }
    catch { fail('AGENT_QA_INTERVIEW_SAVED_VERSION_CHANGED'); }
    if (stage?.projectId !== q.projectId || stage.stageId !== 2 || !Number.isSafeInteger(stage.revision) || stage.revision <= q.revision
      || record?.id !== q.entityId || record.code !== q.code || record.original !== q.studentPrompt || record.guideConfirmed !== false
      || record.draftTurnId !== q.assistantMessageId
      || typeof record.adopted !== 'string' || typeof record.goal !== 'string' || stage.content.draft.fields[`interviewArchived:${q.entityId}`] === 'true'
      || record.problemEntityId !== q.sourceProblemEntityId || record.topicRevision !== q.sourceProblemRevision
      || source?.projectId !== q.projectId || source.stageId !== 1 || source.revision !== q.sourceProblemRevision
      || sourceDraft?.problemReflectionConfirmed !== 'true' || !sourceDraft.roundCompletion || record.topic !== sourceDraft.rewrittenTheme) fail('AGENT_QA_INTERVIEW_SAVED_VERSION_CHANGED');
    const rows = Array.isArray(messages) ? messages : messages?.messages;
    if (!Array.isArray(rows) || rows.length > 100 || !Array.isArray(messages) && messages?.nextCursor != null) fail('AGENT_QA_INTERVIEW_MESSAGES_CHANGED');
    const input = rows.filter(row => row?.id === q.inputMessageId), output = rows.filter(row => row?.id === q.assistantMessageId);
    if (input.length !== 1 || output.length !== 1 || input[0].authorKind !== 'human' || input[0].text !== q.studentPrompt || input[0].agentRunId !== q.runId
      || output[0].authorKind !== 'agent' || output[0].text !== q.assistantText || output[0].agentRunId !== q.runId) fail('AGENT_QA_INTERVIEW_MESSAGES_CHANGED');
    if (run?.runId !== q.runId || run.threadId !== q.threadId || run.inputMessageId !== q.inputMessageId || run.resultMessageId !== q.assistantMessageId
      || run.status !== 'succeeded' || run.pendingApproval != null || canonical(run.skillVersionIds) !== canonical([q.skillVersionId])) fail('AGENT_QA_INTERVIEW_RUN_CHANGED');
    const entities = receipt?.entityReferences;
    if (receipt?.runId !== q.runId || receipt.projectId !== q.projectId || receipt.stageId !== 2 || receipt.purpose !== 'stage'
      || receipt.skillVersionId !== q.skillVersionId || receipt.snapshotHash !== q.snapshotHash
      || receipt.application?.state !== 'message-dispatch-observed' || receipt.application.assembledContextHash !== q.assembledContextHash
      || typeof receipt.application.attemptId !== 'string' || !receipt.application.attemptId.startsWith(q.runId + ':')
      || !/^(0|[1-9][0-9]*)$/.test(receipt.application.attemptId.slice(q.runId.length + 1))
      || !Number.isFinite(Date.parse(receipt.application.assembledAt)) || !Number.isFinite(Date.parse(receipt.application.messageDispatchedAt))
      || !Array.isArray(receipt.stageRevisions) || !receipt.stageRevisions.some(ref => ref.stageId === 2 && ref.revision === q.revision)
      || !receipt.stageRevisions.some(ref => ref.stageId === 1 && ref.revision === q.sourceProblemRevision)
      || !Array.isArray(entities) || !entities.some(ref => ref.stageId === 1 && ref.entityId === q.sourceProblemEntityId && ref.revision === q.sourceProblemRevision)) fail('AGENT_QA_INTERVIEW_CONTEXT_CHANGED');
    if (canonical(await readActor(q)) !== canonical(actualActor)) fail('AGENT_QA_INTERVIEW_ACTOR_CHANGED');
    live(q);
    return { savedRevision: stage.revision, stageHash: sha(canonical(stage)), recordSnapshotHash: sha(canonical(record)),
      originalSha256: sha(record.original), sourceSnapshotHash: sha(canonical(source)), messageHash: sha(canonical(rows)),
      runHash: sha(canonical({ runId: run.runId, threadId: run.threadId, inputMessageId: run.inputMessageId,
        resultMessageId: run.resultMessageId, status: run.status, skillVersionIds: run.skillVersionIds })), receiptHash: sha(canonical(receipt)) };
  };
  const review = async question => {
    if (usedEntities.has(question?.entityId) || usedCodes.has(question?.code) || usedEntities.size >= 10) fail('AGENT_QA_INTERVIEW_REPLAYED');
    // Consume the concrete entity/code slot before any validation or asynchronous work, including failures.
    if (typeof question?.entityId === 'string') usedEntities.add(question.entityId);
    if (typeof question?.code === 'string') usedCodes.add(question.code);
    validate(question);
    if (typeof page.on !== 'function' || typeof page.off !== 'function' || typeof page.mainFrame !== 'function') fail('AGENT_QA_INTERVIEW_PORT_REQUIRED');
    let invalidated = false;
    const current = () => { if (invalidated) fail('AGENT_QA_INTERVIEW_PAGE_CHANGED'); live(question); };
    const navigated = frame => { if (frame === page.mainFrame()) invalidated = true; };
    const closed = () => { invalidated = true; };
    const writing = request => {
      try { const url = new URL(request.url()); if (url.origin === ORIGIN && (request.method() === 'POST' && url.pathname === '/api/copilotkit/agent/default/run'
        || request.method() === 'PUT' && url.pathname === `/api/projects/${question.projectId}/aidt/stages/2`)) invalidated = true; }
      catch { invalidated = true; }
    };
    page.on('framenavigated', navigated); page.on('close', closed); page.on('request', writing);
    try {
      const end = Math.min(now() + studentMs, deadlineAt ?? Infinity), original = canonical(question);
      current(); const before = await bounded(() => snapshot(question), end); current();
      const binding = Object.freeze(Object.fromEntries(INTERVIEW_BINDING_KEYS.map(key => [key,
        ['savedRevision','recordSnapshotHash','originalSha256','sourceSnapshotHash'].includes(key) ? before[key] : question[key]])));
      validateAgentQaInterviewBinding(binding);
      const reply = await requestReply('interview', binding, { assistantText: question.assistantText, studentPrompt: question.studentPrompt }, current, end);
      current(); const after = await bounded(() => snapshot(question), end); current();
      if (canonical(question) !== original || canonical(before) !== canonical(after)) fail('AGENT_QA_INTERVIEW_SAVED_VERSION_CHANGED');
      return { ...binding, approved: true, ...reply.work, reviewerKind: 'agent', h03ConversationSignoff: false, teachingQualityAccepted: false };
    } finally { page.off('framenavigated', navigated); page.off('close', closed); page.off('request', writing); }
  };
  return { review, summary: () => ({ attemptedEntities: usedEntities.size, attemptedCodes: usedCodes.size, maximum: 10 }) };
}

/** The deterministic second prompt is restricted to explicit non-agent isolated compatibility. */
export async function agentInterviewRevisionInput({ code, target, initial, confirmedProblem, projectId, proofs, review, required, synthetic }) {
  if (required && typeof review !== 'function') fail('AGENT_QA_INTERVIEW_RESPONSE_REQUIRED');
  if (typeof review !== 'function') return synthetic(`${code}：我想改得更具体，先问「上次到了哪个窗口」，再追问「哪一刻决定继续等或离开」。请据此调整我的问题清单草稿。`);
  const candidates = Array.isArray(proofs) ? proofs.filter(row => row?.status === 'passed' && row.stageId === 2 && row.projectId === projectId
    && row.entityId === target.entityId && row.interviewCode === code && row.prompt === initial && row.syntheticProblemFixture === false) : [];
  if (candidates.length !== 1) fail('AGENT_QA_INTERVIEW_QUESTION_INVALID');
  const proof = candidates[0], revision = proof.sourceRevisions?.find(ref => ref.stageId === 2)?.revision;
  const question = { stageId: 2, code, projectId, entityId: target.entityId, threadId: proof.threadId, runId: proof.runId,
    inputMessageId: proof.inputMessageId, assistantMessageId: proof.assistantMessageId, assistantText: proof.assistantText,
    assistantTextSha256: proof.assistantTextSha256, studentPrompt: initial, studentPromptSha256: proof.studentTextSha256, revision,
    sourceProblemEntityId: confirmedProblem?.entityId, sourceProblemRevision: confirmedProblem?.revision,
    skillId: proof.skillId, skillVersionId: proof.skillVersionId, snapshotHash: proof.snapshotHash, assembledContextHash: proof.assembledContextHash };
  const response = await review(question);
  const keys = [...INTERVIEW_BINDING_KEYS, 'approved','response','choiceReason','reviewerKind','h03ConversationSignoff','teachingQualityAccepted'];
  if (!exact(response, keys) || response.approved !== true || response.reviewerKind !== 'agent' || response.h03ConversationSignoff !== false || response.teachingQualityAccepted !== false
    || INTERVIEW_BINDING_KEYS.some(key => Object.hasOwn(question,key) && response[key] !== question[key])
    || !Number.isSafeInteger(response.savedRevision) || response.savedRevision <= revision
    || response.originalSha256 !== createHash('sha256').update(initial).digest('hex')
    || !['originalSha256','recordSnapshotHash','sourceSnapshotHash'].every(key => HEX.test(response[key] ?? ''))
    || typeof response.response !== 'string' || !response.response.trim() || response.response.length > 3000
    || typeof response.choiceReason !== 'string' || !response.choiceReason.trim() || response.choiceReason.length > 650) fail('AGENT_QA_INTERVIEW_RESPONSE_REQUIRED');
  return synthetic(`${code}：${response.response}\n选择及取舍理由：${response.choiceReason}\n请依据本次学生回应调整已保存的访谈问题清单草稿，保留未知；不代替学生确认，不调用工具。`);
}

/** A later clarification cannot make the first turn's still-visible saved guide a new confirmed output. */
export function assertAgentInterviewGuideRevision({ record, proofs, projectId, code, target, prompt, required }) {
  if (!required) return;
  const matches = Array.isArray(proofs) ? proofs.filter(row => row?.status === 'passed' && row.stageId === 2
    && row.projectId === projectId && row.entityId === target.entityId && row.interviewCode === code && row.prompt === prompt && row.syntheticProblemFixture === false) : [];
  if (matches.length !== 1 || record?.id !== target.entityId || record.code !== code || record.guideConfirmed !== false
    || typeof record.adopted !== 'string' || !record.adopted.trim() || record.draftTurnId !== matches[0].assistantMessageId) fail('S2_GUIDE_AWAITING_STUDENT_RESPONSE');
}
