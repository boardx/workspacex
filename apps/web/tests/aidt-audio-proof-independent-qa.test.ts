import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { wave2Runtime } from "@repo/contracts";
import { AUDIO_TRANSCRIBE_TOOL, encodeAudioTranscribedReceiptSummary, readAudioTranscribedReceiptSummary } from "@repo/contracts/standard-audio-tools";
import { NATIVE_ARTIFACT_TOOL } from "@repo/contracts/native-artifact-publish";
import { loadAidtAudioTranscriptions, makeAidtSyntheticAudioRequest, verifySavedAidtAudioTranscription, type AidtSyntheticAudioRequest } from "@/features/aidt/lib/aidt-synthetic-audio-transcription";
import type { AidtResearchMaterialReference } from "@/features/aidt/lib/aidt-research-material-reference";
const mocks = vi.hoisted(() => ({ request: vi.fn(), thread: vi.fn(), attachments: vi.fn(), run: vi.fn(), artifacts: vi.fn(), source: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ apiRequest: mocks.request, apiUrl: (path: string) => path, ApiError: class ApiError extends Error {} }));
vi.mock("@/lib/live-chat", () => ({ getThread: mocks.thread, listThreadAttachments: mocks.attachments }));
vi.mock("@/lib/chat-workbench/read-chat-agent-run", () => ({ readChatAgentRun: mocks.run }));
vi.mock("@/lib/chat-workbench/agent-artifacts", () => ({ listAgentArtifacts: mocks.artifacts }));
vi.mock("@/features/aidt/lib/aidt-research-materials", async original => ({ ...await original<typeof import("@/features/aidt/lib/aidt-research-materials")>(), readAidtResearchMaterial: mocks.source }));
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const audioBytes = new TextEncoder().encode("RIFF synthetic-unit-test-audio-only");
const source: AidtResearchMaterialReference = { projectId: "qa-project", artifactId: "qa-audio", runId: "source-run", versionId: "source-v1", name: "synthetic.wav", mime: "audio/wav", bytes: audioBytes.length, sha256: hash(audioBytes) };
const signal = () => new AbortController().signal;
let request: AidtSyntheticAudioRequest;
let resultBytes: Uint8Array;
let summary: string;
let messages: ReturnType<typeof import("@repo/contracts/chat").operations.listMessages.out.parse>["messages"];
let run: ReturnType<typeof wave2Runtime.AgentRunView.parse>;
let artifacts: Array<{ artifactId: string; threadId: string; name: string; versions: Array<{ version: number; attachmentId: string; producedByRunId: string; producedByStepId: string; sizeBytes: number }> }>;
function tool(toolName: string, args: unknown, result: string | null) {
  return { kind: "tool_call", status: "succeeded", startedAt: "2026-11-22T05:00:00Z", endedAt: "2026-11-22T05:00:01Z", inputDigest: null, outputDigest: result === null ? null : hash(result), failureCode: null,
    toolName, toolArgsSummary: JSON.stringify(args), toolResultSummary: result, planningNote: null };
}
beforeEach(() => {
  vi.clearAllMocks(); request = makeAidtSyntheticAudioRequest(source.projectId, "qa-test-entity", "qa-thread", source);
  const payload = { sourceHash: source.sha256, segments: [{ id: "chunk-1", startMs: 0, endMs: 1000, text: "这是合成测试音频的转写。" }], warnings: ["speaker_identity_unavailable"] };
  resultBytes = new TextEncoder().encode(JSON.stringify(payload));
  const path = `/workspace/transcribed-${source.sha256}.json`;
  summary = encodeAudioTranscribedReceiptSummary({ ...payload, workspacePath: path, sha256: hash(resultBytes) })!;
  const attachment = { id: "native-audio", filename: source.name, mime: source.mime, bytes: source.bytes, createdAt: "2026-11-22T05:00:00Z" };
  messages = [{ id: "human-request", authorKind: "human", authorId: "qa-student", agentId: null, text: request.prompt, clientMessageId: null, agentRunId: "actual-run", replyToMessageId: null, createdAt: "2026-11-22T05:00:00Z", attachments: [attachment] },
    { id: "assistant-result", authorKind: "agent", authorId: "qa-agent", agentId: "qa-agent", text: "转写文件已发布", clientMessageId: null, agentRunId: "actual-run", replyToMessageId: "human-request", createdAt: "2026-11-22T05:00:01Z" }];
  run = wave2Runtime.AgentRunView.parse({ runId: "actual-run", threadId: request.threadId, inputMessageId: "human-request", agentId: "qa-agent", agentVersionId: "qa-agent-v1", skillVersionIds: [], modelProvider: "isolated-unit-fixture", modelId: "not-a-real-model", status: "succeeded", error: null, resultMessageId: "assistant-result", createdAt: "2026-11-22T05:00:00Z",
    steps: [tool(AUDIO_TRANSCRIBE_TOOL, { attachmentId: attachment.id }, summary), tool(NATIVE_ARTIFACT_TOOL, { workspacePath: path, title: request.outputName, mediaType: "application/json", idempotencyKey: "qa-publish-once" }, null)] });
  artifacts = [{ artifactId: "published-transcript", threadId: request.threadId, name: request.outputName, versions: [{ version: 2, attachmentId: "transcript-attachment", producedByRunId: run.runId, producedByStepId: "publish-step", sizeBytes: resultBytes.length }] }];
  mocks.thread.mockResolvedValue({ thread: { id: request.threadId, projectId: request.projectId, groupId: null, visibilityScope: "plenary" }, messages: [] });
  mocks.request.mockImplementation(async () => ({ messages, nextCursor: null }));
  mocks.attachments.mockImplementation(async () => ({ items: [{ ...attachment, messageId: "human-request" }, { id: "transcript-attachment", messageId: "assistant-result", bytes: resultBytes.length, filename: request.outputName, mime: "application/json" }] }));
  mocks.artifacts.mockImplementation(async () => artifacts); mocks.run.mockImplementation(async () => run);
  mocks.source.mockResolvedValue({ reference: source, blob: new Blob([audioBytes]) });
  vi.stubGlobal("fetch", vi.fn(async (path: string) => new Response(new Uint8Array(path.includes("/attachments/") ? audioBytes : resultBytes), { status: 200 })));
});
afterEach(() => vi.unstubAllGlobals());

it("accepts only the same durable human input, successful real-shaped run, canonical proof and exact published bytes", async () => {
  const options = await loadAidtAudioTranscriptions(request, "qa-token", signal());
  expect(options).toHaveLength(1);
  expect(options[0]).toMatchObject({ nativeAudio: { threadId: request.threadId, attachmentId: "native-audio", messageId: "human-request", sha256: source.sha256 }, transcript: { artifactId: "published-transcript", version: 2, producedByRunId: "actual-run", producedByStepId: "publish-step", sha256: hash(resultBytes) }, recognizedText: "[0:00–0:01] 这是合成测试音频的转写。" });
  expect(mocks.request).toHaveBeenCalledWith("/chat/threads/qa-thread/messages", expect.objectContaining({ method: "GET", query: { limit: "100" }, sessionToken: "qa-token" }));
  expect(mocks.source).toHaveBeenCalledWith(expect.objectContaining({ projectId: request.projectId }), source);
});

it.each(["run", "input", "tool-source", "digest", "artifact-bytes", "publish", "proof-source", "raw-summary", "failed-tool"] as const)("rejects mismatched %s rather than trusting an assistant's claimed success", async fault => {
  if (fault === "run") run.threadId = "another-thread";
  if (fault === "input") run.inputMessageId = "other-human";
  if (fault === "tool-source") run.steps[0]!.toolArgsSummary = JSON.stringify({ attachmentId: "other-audio" });
  if (fault === "digest") run.steps[0]!.outputDigest = "f".repeat(64);
  if (fault === "artifact-bytes") { resultBytes = new TextEncoder().encode(JSON.stringify({ sourceHash: source.sha256, segments: [{ id: "chunk-1", startMs: 0, endMs: 1000, text: "替换过的转写" }], warnings: [] })); artifacts[0]!.versions[0]!.sizeBytes = resultBytes.length; }
  if (fault === "publish") run.steps = run.steps.filter(step => step.toolName !== NATIVE_ARTIFACT_TOOL);
  if (fault === "proof-source") { const proof = readAudioTranscribedReceiptSummary(summary)!; summary = "audio-transcription-receipt:v1 " + JSON.stringify({ ...proof, sourceHash: "f".repeat(64) }); run.steps[0]!.toolResultSummary = summary; run.steps[0]!.outputDigest = hash(summary); }
  if (fault === "raw-summary") { run.steps[0]!.toolResultSummary = JSON.stringify({ status: "succeeded", sourceHash: source.sha256 }); run.steps[0]!.outputDigest = hash(run.steps[0]!.toolResultSummary!); }
  if (fault === "failed-tool") run.steps[0]!.status = "failed";
  expect(await loadAidtAudioTranscriptions(request, "qa-token", signal())).toEqual([]);
});

it("refuses an assistant-only request or duplicate original human messages", async () => {
  messages[0]!.authorKind = "agent";
  await expect(loadAidtAudioTranscriptions(request, "qa-token", signal())).rejects.toThrow("AIDT_ASR_REQUEST_NOT_SENT_OR_CHANGED");
  messages[0]!.authorKind = "human"; messages.push({ ...messages[0]!, id: "duplicate-human" });
  await expect(loadAidtAudioTranscriptions(request, "qa-token", signal())).rejects.toThrow("AIDT_ASR_REQUEST_NOT_SENT_OR_CHANGED");
});

it("does not accept copied source metadata if the native attachment's bytes changed", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(audioBytes.length).fill(9), { status: 200 })));
  await expect(loadAidtAudioTranscriptions(request, "qa-token", signal())).rejects.toThrow("AIDT_ASR_AUDIO_HASH_MISMATCH");
});

it("rechecks a saved numeric artifact version and rejects a substituted version", async () => {
  const option = (await loadAidtAudioTranscriptions(request, "qa-token", signal()))[0]!;
  const saved = { projectId: request.projectId, entityId: request.entityId, audioSource: option.audioSource, nativeAudio: option.nativeAudio, transcript: option.transcript };
  expect(await verifySavedAidtAudioTranscription(saved, "qa-token", signal())).toBe(true);
  expect(await verifySavedAidtAudioTranscription({ ...saved, transcript: { ...saved.transcript, version: 3 } }, "qa-token", signal())).toBe(false);
});

it("matches saved receipt fields semantically even after harmless JSON object-key reordering", async () => {
  const option = (await loadAidtAudioTranscriptions(request, "qa-token", signal()))[0]!;
  const reversedNative = Object.fromEntries(Object.entries(option.nativeAudio).reverse()) as typeof option.nativeAudio;
  const reversedTranscript = Object.fromEntries(Object.entries(option.transcript).reverse()) as typeof option.transcript;
  expect(await verifySavedAidtAudioTranscription({ projectId: request.projectId, entityId: request.entityId, audioSource: option.audioSource, nativeAudio: reversedNative, transcript: reversedTranscript }, "qa-token", signal())).toBe(true);
});

it("keeps canonical proof bounded, complete, and distinct from arbitrary JSON or truncated tool text", () => {
  expect(summary.length).toBeLessThanOrEqual(500); expect(readAudioTranscribedReceiptSummary(summary)).toMatchObject({ status: "succeeded", sourceHash: source.sha256 });
  expect(readAudioTranscribedReceiptSummary(summary.slice(0, -1))).toBeNull();
  expect(readAudioTranscribedReceiptSummary(JSON.stringify({ status: "succeeded", sourceHash: source.sha256 }))).toBeNull();
  expect(encodeAudioTranscribedReceiptSummary({ status: "succeeded", sourceHash: source.sha256 })).toBeNull();
});


it("stops on a repeated cursor instead of reading an unbounded or duplicated message history", async () => {
  mocks.request.mockResolvedValue({ messages: [], nextCursor: "repeated-cursor" });
  await expect(loadAidtAudioTranscriptions(request, "qa-token", signal())).rejects.toThrow("AIDT_ASR_MESSAGE_CURSOR_REPEATED");
  expect(mocks.request).toHaveBeenCalledTimes(2);
  expect(mocks.artifacts).not.toHaveBeenCalled();
});

it("does not read or accept a source after cancellation or a revoked original", async () => {
  const abort = new AbortController(); abort.abort();
  await expect(loadAidtAudioTranscriptions(request, "qa-token", abort.signal)).rejects.toThrow();
  expect(mocks.thread).not.toHaveBeenCalled();
  mocks.source.mockRejectedValue(new Error("SOURCE_ACCESS_REVOKED"));
  await expect(loadAidtAudioTranscriptions(request, "qa-token", signal())).rejects.toThrow("SOURCE_ACCESS_REVOKED");
  expect(mocks.artifacts).not.toHaveBeenCalled();
});

it("rejects a run read whose returned id differs from the published artifact's exact producer", async () => {
  run = { ...run, runId: "unexpected-run" };
  expect(await loadAidtAudioTranscriptions(request, "qa-token", signal())).toEqual([]);
});
