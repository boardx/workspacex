import { ATTACHMENT_LIMITS } from "@repo/contracts/chat-file-upload";
import { wave2Runtime } from "@repo/contracts";
import * as chat from "@repo/contracts/chat";
import { AudioTranscribeInput, AudioTranscribed, AUDIO_TRANSCRIBE_TOOL, AUDIO_TRANSCRIBE_LIMITS, readAudioTranscribedReceiptSummary } from "@repo/contracts/standard-audio-tools";
import { NATIVE_ARTIFACT_TOOL, NativeArtifactPublishInput } from "@repo/contracts/native-artifact-publish";
import { AIDT_CANDIDATE_ACTIONS } from "@repo/contracts/aidt-candidate-request";
import { apiRequest, apiUrl } from "@/lib/api-client";
import { getThread, listThreadAttachments } from "@/lib/live-chat";
import { readChatAgentRun } from "@/lib/chat-workbench/read-chat-agent-run";
import { listAgentArtifacts } from "@/lib/chat-workbench/agent-artifacts";
import { hashAidtResearchBytes, readAidtResearchMaterial, type AidtResearchMaterialReference } from "./aidt-research-materials";

const audioMimes = new Set(["audio/wav", "audio/x-wav", "audio/wave", "audio/mpeg"]);
const TranscriptPayload = AudioTranscribed.omit({ workspacePath: true, sha256: true });
export type AidtAudioAsrWarnings = typeof AudioTranscribed._type.warnings;
export type AidtSyntheticAudioRequest = { requestId: string; projectId: string; entityId: string; threadId: string; prompt: string; outputName: string; audioSource: AidtResearchMaterialReference };
export type AidtAudioTranscriptionOption = {
  kind: "synthetic-file-asr";
  audioSource: AidtResearchMaterialReference;
  nativeAudio: { threadId: string; attachmentId: string; messageId: string; sha256: string };
  transcript: { artifactId: string; version: number; attachmentId: string; producedByRunId: string; producedByStepId: string; name: string; sha256: string };
  recognizedText: string;
  warnings: AidtAudioAsrWarnings;
  /** Derived only from the actual succeeded tool receipt and matching published bytes. */
  toolProof?: { audioTool: typeof AUDIO_TRANSCRIBE_TOOL; publishTool: typeof NATIVE_ARTIFACT_TOOL;
    workspacePath: string; sourceHash: string; transcriptSha256: string; receiptOutputDigest: string };
};
export type AidtReviewedAudioTranscription = AidtAudioTranscriptionOption & { reviewedText: string };
const identifier = (value: string) => !!value && value.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(value) && value !== "." && value !== "..";
function current(signal: AbortSignal) { signal.throwIfAborted(); }
function parseJson(value: string | null): unknown { try { return value ? JSON.parse(value) : null; } catch { return null; } }

export function makeAidtSyntheticAudioRequest(projectId: string, entityId: string, threadId: string, audioSource: AidtResearchMaterialReference): AidtSyntheticAudioRequest {
  if (![projectId, entityId, threadId].every(identifier) || audioSource.projectId !== projectId || !audioMimes.has(audioSource.mime) || audioSource.bytes < 1 || audioSource.bytes > ATTACHMENT_LIMITS.maxBytesPerFile) throw new Error("AIDT_SYNTHETIC_AUDIO_SCOPE_INVALID");
  const requestId = crypto.randomUUID(), outputName = `aidt-asr-${requestId}.json`;
  const prompt = `${AIDT_CANDIDATE_ACTIONS.test}\n合成音频转写请求：${requestId}\n当前测试实体：${entityId}\n仅处理本条消息附带的合成 WAV/MP3 测试音频，原文件 SHA256=${audioSource.sha256}。这不是任何真人访谈，也不是已发生的用户测试。请使用 ${AUDIO_TRANSCRIBE_TOOL} 对该实际附件转写；不要使用猜测、示例台词或你生成的文字替代 ASR。工具成功后，将它返回的原始 workspace JSON 文件原样使用 ${NATIVE_ARTIFACT_TOOL} 发布，文件名必须为 ${JSON.stringify(outputName)}、mediaType 为 application/json；不要编辑这个转写 JSON。若工具缺失、未配置、拒绝或失败，请明确说明，不编文件、不自动重跑未知结果。不填写或确认本步测试结论，不把临时 WS 草稿说成 recording_segments。`;
  return { requestId, projectId, entityId, threadId, prompt, outputName, audioSource };
}

/** Read the actual saved original; a second native upload must use these identical bytes. */
export async function readAidtSyntheticAudioFile(source: AidtResearchMaterialReference, sessionToken: string, signal: AbortSignal): Promise<File> {
  if (!audioMimes.has(source.mime) || source.bytes < 1 || source.bytes > ATTACHMENT_LIMITS.maxBytesPerFile) throw new Error("AIDT_AUDIO_FORMAT_UNSUPPORTED");
  const result = await readAidtResearchMaterial({ projectId: source.projectId, sessionToken, signal }, source);
  current(signal);
  return new File([result.blob], source.name, { type: source.mime });
}

async function readBytes(path: string, token: string, max: number, signal: AbortSignal): Promise<Uint8Array> {
  current(signal);
  const response = await fetch(apiUrl(path), { headers: { Authorization: `Bearer ${token}` }, credentials: "include", redirect: "error", signal });
  if (!response.ok || !response.body) throw new Error("AIDT_ASR_SOURCE_UNAVAILABLE");
  const declared = response.headers.get("Content-Length");
  if (declared && Number(declared) > max) { await response.body.cancel(); throw new Error("AIDT_ASR_RESULT_TOO_LARGE"); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { current(signal); const { value, done } = await reader.read(); if (done) break; if (!value) continue; size += value.length; if (size > max) { await reader.cancel(); throw new Error("AIDT_ASR_RESULT_TOO_LARGE"); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
function time(ms: number) { const seconds = Math.floor(ms / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }

/** Full durable messages come from listMessages, not getThread's presentation projection. */
async function readAudioMessages(threadId: string, token: string, signal: AbortSignal) {
  const messages: ReturnType<typeof chat.operations.listMessages.out.parse>["messages"] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    current(signal);
    const operation = chat.operations.listMessages;
    const result = operation.out.parse(await apiRequest<unknown>(operation.path.replace(":threadId", encodeURIComponent(threadId)), {
      method: "GET", sessionToken: token, signal, query: { limit: "100", ...(cursor ? { cursor } : {}) },
    }));
    messages.push(...result.messages);
    if (result.nextCursor === null) return messages;
    if (seen.has(result.nextCursor)) throw new Error("AIDT_ASR_MESSAGE_CURSOR_REPEATED");
    seen.add(result.nextCursor); cursor = result.nextCursor;
  }
  throw new Error("AIDT_ASR_MESSAGE_HISTORY_TOO_LARGE");
}

/** Only actual tool ledger proof + the same committed run's exact published bytes are selectable. */
export async function loadAidtAudioTranscriptions(request: AidtSyntheticAudioRequest, token: string, signal: AbortSignal): Promise<readonly AidtAudioTranscriptionOption[]> {
  current(signal);
  const detail = await getThread(request.threadId, request.projectId, token); current(signal);
  if (detail.thread.id !== request.threadId || detail.thread.projectId !== request.projectId || detail.thread.groupId !== null || detail.thread.visibilityScope !== "plenary") throw new Error("AIDT_ASR_THREAD_SCOPE_CHANGED");
  const messages = await readAudioMessages(request.threadId, token, signal); current(signal);
  const humans = messages.filter(message => message.authorKind === "human" && message.text === request.prompt);
  if (humans.length !== 1) throw new Error("AIDT_ASR_REQUEST_NOT_SENT_OR_CHANGED");
  const human = humans[0]!;
  if (human.attachments?.length !== 1) throw new Error("AIDT_ASR_SINGLE_AUDIO_REQUIRED");
  const audio = human.attachments[0]!;
  if (!audioMimes.has(audio.mime) || audio.bytes !== request.audioSource.bytes || audio.filename !== request.audioSource.name) throw new Error("AIDT_ASR_AUDIO_SOURCE_CHANGED");
  const listed = await listThreadAttachments(request.threadId, request.projectId, token); current(signal);
  if (!listed.items.some(item => item.id === audio.id && item.messageId === human.id && item.bytes === audio.bytes && item.mime === audio.mime)) throw new Error("AIDT_ASR_AUDIO_NOT_ATTACHED");
  const nativeBytes = await readBytes(`/chat/threads/${encodeURIComponent(request.threadId)}/attachments/${encodeURIComponent(audio.id)}/content`, token, request.audioSource.bytes, signal);
  if (nativeBytes.length !== request.audioSource.bytes || await hashAidtResearchBytes(nativeBytes.buffer as ArrayBuffer) !== request.audioSource.sha256) throw new Error("AIDT_ASR_AUDIO_HASH_MISMATCH");
  await readAidtResearchMaterial({ projectId: request.projectId, sessionToken: token, signal }, request.audioSource); current(signal);
  const artifacts = await listAgentArtifacts(request.threadId, request.projectId, token, signal); current(signal);
  const records = artifacts.filter(artifact => artifact.threadId === request.threadId && artifact.name === request.outputName);
  const versions = records.flatMap(artifact => artifact.versions.map(version => ({ artifact, version })));
  if (versions.length > 4) throw new Error("AIDT_ASR_AMBIGUOUS_PUBLISHED_RESULT");
  const result: AidtAudioTranscriptionOption[] = [];
  for (const { artifact, version } of versions) {
    current(signal);
    if (!identifier(artifact.artifactId) || !version.attachmentId || !identifier(version.attachmentId) || !identifier(version.producedByRunId) || !identifier(version.producedByStepId) || version.sizeBytes < 1 || version.sizeBytes > AUDIO_TRANSCRIBE_LIMITS.maxTextBytes) continue;
    const run = wave2Runtime.AgentRunView.parse(await readChatAgentRun(version.producedByRunId, token, signal)); current(signal);
    if (run.runId !== version.producedByRunId || run.threadId !== request.threadId || run.inputMessageId !== human.id || run.status !== "succeeded" || !run.resultMessageId || !messages.some(message => message.id === run.resultMessageId && message.authorKind === "agent" && message.agentRunId === run.runId)) continue;
    if (!listed.items.some(item => item.id === version.attachmentId && item.messageId === run.resultMessageId && item.bytes === version.sizeBytes && item.filename === request.outputName)) continue;
    const calls = run.steps.filter(step => step.kind === "tool_call" && step.status === "succeeded" && step.toolName === AUDIO_TRANSCRIBE_TOOL && AudioTranscribeInput.safeParse(parseJson(step.toolArgsSummary)).success
      && AudioTranscribeInput.parse(parseJson(step.toolArgsSummary)).attachmentId === audio.id);
    if (calls.length !== 1) continue;
    const proof = readAudioTranscribedReceiptSummary(calls[0]!.toolResultSummary);
    if (!proof || proof.sourceHash !== request.audioSource.sha256 || !calls[0]!.outputDigest || await hashAidtResearchBytes(new TextEncoder().encode(calls[0]!.toolResultSummary!).buffer as ArrayBuffer) !== calls[0]!.outputDigest) continue;
    const published = run.steps.some(step => {
      if (step.kind !== "tool_call" || step.status !== "succeeded" || step.toolName !== NATIVE_ARTIFACT_TOOL) return false;
      const args = NativeArtifactPublishInput.safeParse(parseJson(step.toolArgsSummary));
      return args.success && args.data.workspacePath === proof.workspacePath && args.data.title === request.outputName && args.data.mediaType === "application/json";
    });
    if (!published) continue;
    const bytes = await readBytes(`/artifacts/${encodeURIComponent(artifact.artifactId)}/versions/${version.version}/content`, token, AUDIO_TRANSCRIBE_LIMITS.maxTextBytes, signal);
    const sha256 = await hashAidtResearchBytes(bytes.buffer as ArrayBuffer); current(signal);
    if (bytes.length !== version.sizeBytes || sha256 !== proof.sha256) continue;
    let payload: typeof TranscriptPayload._type;
    try { payload = TranscriptPayload.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))); } catch { continue; }
    if (payload.sourceHash !== proof.sourceHash) continue;
    result.push({ kind: "synthetic-file-asr", audioSource: request.audioSource,
      nativeAudio: { threadId: request.threadId, attachmentId: audio.id, messageId: human.id, sha256: proof.sourceHash },
      transcript: { artifactId: artifact.artifactId, version: version.version, attachmentId: version.attachmentId, producedByRunId: run.runId, producedByStepId: version.producedByStepId, name: artifact.name, sha256 },
      recognizedText: payload.segments.filter(segment => segment.text.trim()).map(segment => `[${time(segment.startMs)}–${time(segment.endMs)}] ${segment.text}`).join("\n"), warnings: payload.warnings,
      toolProof: { audioTool: AUDIO_TRANSCRIBE_TOOL, publishTool: NATIVE_ARTIFACT_TOOL, workspacePath: proof.workspacePath,
        sourceHash: proof.sourceHash, transcriptSha256: proof.sha256, receiptOutputDigest: calls[0]!.outputDigest! } });
  }
  current(signal);
  return result;
}

/** Re-read saved application references against the real original human request and actual tool/artifact ledger. */
export async function readSavedAidtAudioTranscription(saved: Pick<AidtReviewedAudioTranscription, "audioSource" | "nativeAudio" | "transcript"> & { projectId: string; entityId: string }, token: string, signal: AbortSignal): Promise<AidtAudioTranscriptionOption | null> {
  const messages = await readAudioMessages(saved.nativeAudio.threadId, token, signal);
  const human = messages.find(message => message.id === saved.nativeAudio.messageId && message.authorKind === "human");
  if (!human || human.attachments?.length !== 1 || human.attachments[0]?.id !== saved.nativeAudio.attachmentId) return null;
  const requestId = /^合成音频转写请求：([0-9a-f-]{36})$/mu.exec(human.text)?.[1];
  if (!requestId) return null;
  const request = { requestId, projectId: saved.projectId, entityId: saved.entityId, threadId: saved.nativeAudio.threadId,
    prompt: human.text, outputName: `aidt-asr-${requestId}.json`, audioSource: saved.audioSource };
  const expectedMarker = `当前测试实体：${saved.entityId}`;
  if (!human.text.split("\n").includes(expectedMarker)) return null;
  const options = await loadAidtAudioTranscriptions(request, token, signal);
  return options.find(option => option.nativeAudio.threadId === saved.nativeAudio.threadId
    && option.nativeAudio.attachmentId === saved.nativeAudio.attachmentId && option.nativeAudio.messageId === saved.nativeAudio.messageId
    && option.nativeAudio.sha256 === saved.nativeAudio.sha256 && option.transcript.artifactId === saved.transcript.artifactId
    && option.transcript.version === saved.transcript.version && option.transcript.attachmentId === saved.transcript.attachmentId
    && option.transcript.producedByRunId === saved.transcript.producedByRunId && option.transcript.producedByStepId === saved.transcript.producedByStepId
    && option.transcript.name === saved.transcript.name && option.transcript.sha256 === saved.transcript.sha256) ?? null;
}

/** Compatibility boolean; uses the same complete real-file/receipt verification. */
export async function verifySavedAidtAudioTranscription(saved: Pick<AidtReviewedAudioTranscription, "audioSource" | "nativeAudio" | "transcript"> & { projectId: string; entityId: string }, token: string, signal: AbortSignal): Promise<boolean> {
  return Boolean(await readSavedAidtAudioTranscription(saved,token,signal));
}
