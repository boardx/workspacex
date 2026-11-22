import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AidtSavedSyntheticAsrReportPrint } from "@/features/aidt/components/aidt-saved-synthetic-asr-report-print";
import { AidtInterviewSyntheticAsrPortal, AidtInterviewSyntheticAsrSlot } from "@/features/aidt/components/aidt-interview-synthetic-asr";
import { AidtTestSyntheticAsr } from "@/features/aidt/components/aidt-test-synthetic-asr";
import { aidtReviewedInterviewSyntheticAsr, saveAidtInterviewSyntheticAsr } from "@/features/aidt/lib/aidt-interview-synthetic-asr";
import { aidtSavedSyntheticAsr, saveAidtSyntheticAsr } from "@/features/aidt/lib/aidt-test-synthetic-asr";
import { aidtInterviewMaterialKey, writeAidtInterview, type AidtInterview } from "@/features/aidt/lib/aidt-interviews";
import { createAidtTestGroup, readAidtTestGroups, updateAidtTestGroup } from "@/features/aidt/lib/aidt-test-groups";
import { emptyAidtUiDrafts, type AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import type { AidtReviewedAudioTranscription } from "@/features/aidt/lib/aidt-synthetic-audio-transcription";
const mocks = vi.hoisted(() => ({ session: { currentOrgId: "org", userId: "member", sessionToken: "token" }, stage: vi.fn(), source: vi.fn(), thread: vi.fn(), preview: vi.fn(), write: vi.fn() }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => ({ session: mocks.session }) }));
vi.mock("@/features/aidt/lib/live-aidt-stages", () => ({ readAidtStage: mocks.stage }));
vi.mock("@/lib/live-chat", async original => ({ ...await original<typeof import("@/lib/live-chat")>(), getThread: mocks.thread }));
vi.mock("@/features/aidt/lib/aidt-print-preview", async original => ({ ...await original<typeof import("@/features/aidt/lib/aidt-print-preview")>(), previewAidtPdf: mocks.preview }));
vi.mock("@/features/aidt/lib/aidt-synthetic-audio-transcription", async original => ({ ...await original<typeof import("@/features/aidt/lib/aidt-synthetic-audio-transcription")>(), readSavedAidtAudioTranscription: mocks.source }));
const projectId = "qa-project", entityId = "15c7b5e2-9d0e-4b10-bc47-000000000001", materialKey = aidtInterviewMaterialKey(entityId, "audio");
const full = "完整原始转写开始。第一段说明具体过程。第二段保留不确定和分歧。全文结尾独有内容。";
const excerpt = "学生另存的短摘录，不能代替全文。";
const result: AidtReviewedAudioTranscription = { kind: "synthetic-file-asr", audioSource: { projectId, artifactId: "audio", runId: "audio-run", versionId: "audio-v1", name: "qa.wav", mime: "audio/wav", bytes: 2, sha256: "a".repeat(64) },
  nativeAudio: { threadId: "native-thread", attachmentId: "native-audio", messageId: "native-human", sha256: "a".repeat(64) },
  transcript: { artifactId: "transcript", version: 2, attachmentId: "transcript-attachment", producedByRunId: "actual-run", producedByStepId: "actual-step", name: "actual-transcript.json", sha256: "b".repeat(64) },
  recognizedText: full, reviewedText: excerpt, warnings: [], toolProof: { audioTool: "wx_audio_transcribe", publishTool: "wx_artifact_publish", workspacePath: "/workspace/actual-transcript.json", sourceHash: "a".repeat(64), transcriptSha256: "b".repeat(64), receiptOutputDigest: "c".repeat(64) } };
let saved: AidtUiStageDraft;
function draftFor(stageId: 2 | 6) {
  if (stageId === 2) {
    const person: AidtInterview = { id: entityId, version: 1, code: "U01", topicRevision: 1, topic: "合成QA", goal: "理解实际经过", original: "最近怎样选择？", adopted: "请讲一次经历。", guideConfirmed: true,
      consent: { notes: true, audio: true, photos: false, observedAt: "2026-11-22T00:00:00.000Z" } };
    const draft = writeAidtInterview(emptyAidtUiDrafts()[2]!, person); draft.fields[materialKey] = JSON.stringify(result.audioSource);
    return saveAidtInterviewSyntheticAsr(draft, entityId, projectId, materialKey, aidtReviewedInterviewSyntheticAsr(result));
  }
  const group = createAidtTestGroup({ schemaVersion: 1, question: "本轮想知道什么", beforeTestBelief: "仍待真实研究", verificationBasis: "合成软件QA", verificationLimits: "非真人", prototypeRef: "固定原型", sourceStageRevision: 9, prototypeDesignId: "qa-design", prototypeVersionId: "native-v2" }, entityId, "qa-design")!;
  const withAudio = { ...group, researchPath: "offline" as const, audioConsentAt: "2026-11-22T00:00:00.000Z", material: result.audioSource };
  return saveAidtSyntheticAsr(updateAidtTestGroup(emptyAidtUiDrafts()[6]!, withAudio), withAudio, aidtSavedSyntheticAsr(result));
}
function print(stageId: 2 | 6, draft = saved) { return <AidtSavedSyntheticAsrReportPrint projectId={projectId} stageId={stageId} entityId={entityId} materialKey={stageId === 2 ? materialKey : undefined} draft={draft} />; }
const button = () => screen.getByRole("button", { name: "预览合成 ASR 全文报告" });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeEach(() => { vi.clearAllMocks(); Object.assign(mocks.session, { currentOrgId: "org", userId: "member", sessionToken: "token" }); mocks.source.mockResolvedValue(result); mocks.stage.mockImplementation(async () => ({ stage: { revision: 12, content: { draft: saved } } })); mocks.preview.mockResolvedValue("cancelled"); mocks.thread.mockResolvedValue({ thread: { id: "native-thread", projectId, groupId: null, visibilityScope: "plenary", archived: false } }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it.each([2, 6] as const)("S%s renders the host's real saved pin and previews actual ASR full text separately from its short excerpt", async stageId => {
  saved = draftFor(stageId); const before = JSON.stringify(saved);
  if (stageId === 2) render(<><AidtInterviewSyntheticAsrSlot projectId={projectId} entityId={entityId} materialKey={materialKey} /><AidtInterviewSyntheticAsrPortal projectId={projectId} entityId={entityId} materialKey={materialKey} draft={saved} saveDraft={mocks.write} /></>);
  else render(<AidtTestSyntheticAsr projectId={projectId} group={readAidtTestGroups(saved.fields)[0]!} draft={saved} readOnly={false} update={mocks.write} requestSave={mocks.write} />);
  fireEvent.click(await screen.findByRole("button", { name: "预览合成 ASR 全文报告" })); await waitFor(() => expect(mocks.preview).toHaveBeenCalledOnce());
  const root = mocks.preview.mock.calls[0]![0] as HTMLElement;
  expect(root).toHaveTextContent(full); expect(root).toHaveTextContent(excerpt); expect(root).toHaveTextContent("实际发布的原始转写全文"); expect(root).toHaveTextContent("学生校对摘录");
  expect(root).toHaveTextContent("actual-run"); expect(root).toHaveTextContent("wx_audio_transcribe → wx_artifact_publish"); expect(root).toHaveTextContent("这不是任何真人访谈");
  expect(mocks.preview.mock.calls[0]![2]).toEqual(expect.objectContaining({ defaultPaper: "A4", layout: "flow" }));
  expect(mocks.source).toHaveBeenCalledWith(expect.objectContaining({ projectId, entityId, audioSource: result.audioSource, nativeAudio: result.nativeAudio, transcript: result.transcript }), "token", expect.any(AbortSignal));
  expect(JSON.stringify(saved)).toBe(before); expect(mocks.write).not.toHaveBeenCalled();
});
it("does not substitute the excerpt for an unavailable published full transcript or missing tool proof", async () => {
  saved = draftFor(2); mocks.source.mockResolvedValueOnce(null); const view = render(print(2)); fireEvent.click(button());
  await screen.findByRole("alert"); expect(mocks.preview).not.toHaveBeenCalled(); view.unmount();
  mocks.source.mockResolvedValueOnce({ ...result, toolProof: undefined }); render(print(2)); fireEvent.click(button()); await screen.findByRole("alert"); expect(mocks.preview).not.toHaveBeenCalled();
});
it("refuses an actual source read when the saved pin has changed on the server", async () => {
  const original = draftFor(2); saved = { ...original, fields: { ...original.fields, [materialKey]: JSON.stringify({ ...result.audioSource, sha256: "d".repeat(64) }) } };
  render(print(2, original)); fireEvent.click(button()); await screen.findByRole("alert"); expect(mocks.source).not.toHaveBeenCalled(); expect(mocks.preview).not.toHaveBeenCalled();
});
it("ignores a late full transcript after the actor changes and cancels the source signal", async () => {
  saved = draftFor(6); const source = deferred<typeof result>(); mocks.source.mockReturnValueOnce(source.promise); const view = render(print(6));
  fireEvent.click(button()); await waitFor(() => expect(mocks.source).toHaveBeenCalledOnce()); const signal = mocks.source.mock.calls[0]![2] as AbortSignal;
  mocks.session.userId = "other-member"; view.rerender(print(6)); expect(signal.aborted).toBe(true); await act(async () => source.resolve(result)); expect(mocks.preview).not.toHaveBeenCalled();
});
it("invalidates an open preview after normal stage permission checks start failing", async () => {
  vi.useFakeTimers(); saved = draftFor(2); const preview = deferred<"cancelled">(); mocks.preview.mockReturnValueOnce(preview.promise); render(print(2));
  await act(async () => { fireEvent.click(button()); }); expect(mocks.preview).toHaveBeenCalledOnce(); const options = mocks.preview.mock.calls[0]![2]; expect(options.isCurrent()).toBe(true);
  mocks.stage.mockRejectedValueOnce(new Error("403 revoked")); await act(async () => { await vi.advanceTimersByTimeAsync(3000); }); expect(options.isCurrent()).toBe(false);
  await act(async () => preview.resolve("cancelled")); expect(mocks.write).not.toHaveBeenCalled();
});
