import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatHostTextActionContext } from "@/components/chat/chat-host-panel";
import { AidtInterviewSyntheticAsrPortal, AidtInterviewSyntheticAsrSlot } from "@/features/aidt/components/aidt-interview-synthetic-asr";
import { readAidtSavedInterviewSyntheticAsr } from "@/features/aidt/lib/aidt-interview-synthetic-asr";
import { aidtInterviewMaterialKey, readAidtInterviewTranscript, writeAidtInterview, type AidtInterview } from "@/features/aidt/lib/aidt-interviews";
import { emptyAidtUiDrafts, type AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import type { AidtAudioTranscriptionOption } from "@/features/aidt/lib/aidt-synthetic-audio-transcription";
import type { AidtResearchMaterialReference } from "@/features/aidt/lib/aidt-research-materials";
const mocks = vi.hoisted(() => ({ session: { currentOrgId: "qa-org", userId: "qa-member", sessionToken: "qa-token" }, readStage: vi.fn(), readMaterial: vi.fn(), readAudio: vi.fn(), transcripts: vi.fn(), verify: vi.fn(), save: vi.fn(), offer: vi.fn(), send: vi.fn() }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => ({ session: mocks.session }) }));
vi.mock("@/features/aidt/lib/live-aidt-stages", () => ({ readAidtStage: mocks.readStage }));
vi.mock("@/features/aidt/lib/aidt-research-materials", async original => ({ ...await original<typeof import("@/features/aidt/lib/aidt-research-materials")>(), readAidtResearchMaterial: mocks.readMaterial }));
vi.mock("@/features/aidt/lib/aidt-synthetic-audio-transcription", async original => ({ ...await original<typeof import("@/features/aidt/lib/aidt-synthetic-audio-transcription")>(), readAidtSyntheticAudioFile: mocks.readAudio, loadAidtAudioTranscriptions: mocks.transcripts, verifySavedAidtAudioTranscription: mocks.verify }));
const projectId = "qa-project", entityId = "15c7b5e2-9d0e-4b10-bc47-000000000001";
const materialKey = aidtInterviewMaterialKey(entityId, "synthetic-audio");
const audio: AidtResearchMaterialReference = { projectId, artifactId: "synthetic-audio", runId: "source-run", versionId: "audio-v1", name: "synthetic-qa.wav", mime: "audio/wav", sha256: "a".repeat(64), bytes: 2 };
const person: AidtInterview = { id: entityId, version: 1, code: "U01", topicRevision: 1, topic: "合成访谈软件测试", goal: "了解具体选择经过", original: "最近怎样选择？", adopted: "请讲最近一次经过。", guideConfirmed: true,
  consent: { notes: true, audio: true, photos: false, observedAt: "2026-11-22T00:00:00.000Z" } };
const result: AidtAudioTranscriptionOption = { kind: "synthetic-file-asr", audioSource: audio,
  nativeAudio: { threadId: "native-thread", attachmentId: "native-audio", messageId: "native-human", sha256: audio.sha256 },
  transcript: { artifactId: "transcript-artifact", version: 2, attachmentId: "transcript-attachment", producedByRunId: "transcript-run", producedByStepId: "transcript-step", name: "actual-transcript.json", sha256: "b".repeat(64) },
  recognizedText: "这是软件验收用合成转写，原文来自实际工具回执。", warnings: [] };
let server: AidtUiStageDraft;
function initial() {
  const draft = writeAidtInterview(emptyAidtUiDrafts()[2]!, person);
  draft.fields[materialKey] = JSON.stringify(audio);
  draft.fields["interviewTranscript:" + entityId] = JSON.stringify({ sourceKey: materialKey, locator: "旧定位", text: "原有已保存摘录", checked: true });
  draft.fields["interviewConfirmed:" + entityId] = "true";
  return draft;
}
function Host({ slot = true, thread = "native-thread", override }: { slot?: boolean; thread?: string; override?: AidtUiStageDraft }) {
  const [local, setLocal] = React.useState(server);
  const draft = override ?? local;
  const action = { projectId, threadId: thread, available: true, occupied: false, running: false, failed: false, offerAudioDraft: mocks.offer, sendText: mocks.send };
  return <ChatHostTextActionContext.Provider value={action}>
    {slot && <AidtInterviewSyntheticAsrSlot projectId={projectId} entityId={entityId} materialKey={materialKey} />}
    <AidtInterviewSyntheticAsrPortal projectId={projectId} entityId={entityId} materialKey={materialKey} draft={draft} saveDraft={async mutate => { mocks.save(); const next = mutate(server); server = next; setLocal(next); return true; }} />
  </ChatHostTextActionContext.Provider>;
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
const prepareButton = () => screen.getByRole("button", { name: "将同一音频附到 Chat 并准备转写" });
async function prepare() {
  await screen.findByText("合成音频文件转写（软件验收）"); fireEvent.click(screen.getByText("合成音频文件转写（软件验收）"));
  fireEvent.click(screen.getByRole("checkbox", { name: /这是获准用于本次 QA/ }));
  await act(async () => fireEvent.click(prepareButton()));
  await screen.findByRole("button", { name: "读取本次已发布转写" });
}
async function adoptToBuffer() {
  await prepare();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "读取本次已发布转写" })));
  fireEvent.click(await screen.findByRole("radio", { name: "actual-transcript.json · V2" }));
  fireEvent.click(screen.getByRole("checkbox", { name: /已核对合成音频内容/ }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "采用校对摘录到本地草稿" })));
  await screen.findByRole("textbox", { name: "校对后的合成摘录" });
}
async function saveBuffer() {
  fireEvent.click(screen.getByRole("checkbox", { name: /同意将这段文字保存为本访谈的待校对摘录/ }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "保存访谈合成转写摘录" })));
}
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(mocks.session, { currentOrgId: "qa-org", userId: "qa-member", sessionToken: "qa-token" }); server = initial();
  mocks.readStage.mockImplementation(async () => ({ stage: { content: { draft: server } } })); mocks.readMaterial.mockResolvedValue({ reference: audio, blob: new Blob(["ok"]) });
  mocks.readAudio.mockResolvedValue(new File(["ok"], audio.name, { type: audio.mime })); mocks.transcripts.mockResolvedValue([result]); mocks.verify.mockResolvedValue(true); mocks.offer.mockReturnValue("accepted"); mocks.send.mockResolvedValue(true);
});
afterEach(cleanup);

it("keeps the owned request and independent edited buffer across real material-slot detach/re-attach", async () => {
  const view = render(<Host />); const before = JSON.stringify(server); await prepare(); expect(mocks.offer).toHaveBeenCalledOnce();
  view.rerender(<Host slot={false} />); expect(screen.queryByRole("button", { name: "读取本次已发布转写" })).toBeNull();
  view.rerender(<Host />); await screen.findByRole("button", { name: "读取本次已发布转写" }); expect(mocks.offer).toHaveBeenCalledOnce();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "读取本次已发布转写" })));
  fireEvent.click(await screen.findByRole("radio", { name: "actual-transcript.json · V2" })); fireEvent.click(screen.getByRole("checkbox", { name: /已核对合成音频内容/ }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "采用校对摘录到本地草稿" })));
  fireEvent.change(await screen.findByRole("textbox", { name: "校对后的合成摘录" }), { target: { value: "学生编辑但尚未保存的合成摘录" } });
  view.rerender(<Host slot={false} />); view.rerender(<Host />);
  expect(await screen.findByRole("textbox", { name: "校对后的合成摘录" })).toHaveValue("学生编辑但尚未保存的合成摘录");
  expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled(); expect(JSON.stringify(server)).toBe(before);
});
it("requires explicit replacement consent, then saves the actual pin and an independently unchecked excerpt exactly once", async () => {
  render(<Host />); await adoptToBuffer(); expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox", { name: "校对后的合成摘录" }), { target: { value: "学生最终校对的合成摘录" } });
  expect(screen.getByRole("button", { name: "保存访谈合成转写摘录" })).toBeDisabled(); expect(readAidtInterviewTranscript(server.fields, entityId)?.text).toBe("原有已保存摘录");
  await saveBuffer(); expect(mocks.save).toHaveBeenCalledOnce();
  expect(readAidtInterviewTranscript(server.fields, entityId)).toEqual({ sourceKey: materialKey, locator: "合成软件测试 ASR V2", text: "学生最终校对的合成摘录", checked: false });
  const pin = readAidtSavedInterviewSyntheticAsr(server, entityId, projectId);
  expect(pin).toMatchObject({ kind: "synthetic-file-asr", nativeAudio: result.nativeAudio, transcript: result.transcript, reviewedText: "学生最终校对的合成摘录" });
  expect(server.fields["interviewConfirmed:" + entityId]).toBeFalsy(); expect(server.fields[materialKey]).toBe(JSON.stringify(audio));
  expect(mocks.verify).toHaveBeenCalledWith(expect.objectContaining({ projectId, entityId, audioSource: audio, nativeAudio: result.nativeAudio, transcript: result.transcript }), "qa-token", expect.any(AbortSignal));
});
it("does not overwrite a different excerpt saved by a collaborator after local adoption", async () => {
  render(<Host />); await adoptToBuffer(); server = { ...server, fields: { ...server.fields, ["interviewTranscript:" + entityId]: JSON.stringify({ sourceKey: materialKey, locator: "协作者定位", text: "协作者的新摘录", checked: false }) } };
  await saveBuffer(); expect(mocks.save).not.toHaveBeenCalled(); expect(readAidtInterviewTranscript(server.fields, entityId)?.text).toBe("协作者的新摘录");
  expect(screen.getByRole("textbox", { name: "校对后的合成摘录" })).toHaveValue(result.recognizedText); expect(screen.getByText(/未保存：原件、权限/)).toBeVisible();
});
it("rejects a save after audio permission was revoked without altering the previous excerpt", async () => {
  render(<Host />); await adoptToBuffer(); server = writeAidtInterview(server, { ...person, consent: { ...person.consent!, audio: false } });
  await saveBuffer(); expect(mocks.save).not.toHaveBeenCalled(); expect(readAidtInterviewTranscript(server.fields, entityId)?.text).toBe("原有已保存摘录");
});
it.each(["actor", "thread", "source"])("cleans a local buffer when its %s scope changes", async change => {
  const view = render(<Host />); await adoptToBuffer();
  if (change === "actor") { mocks.session.userId = "different-member"; view.rerender(<Host />); }
  if (change === "thread") view.rerender(<Host thread="other-native-thread" />);
  if (change === "source") { const changed = { ...server, fields: { ...server.fields, [materialKey]: JSON.stringify({ ...audio, versionId: "audio-v2", sha256: "c".repeat(64) }) } }; view.rerender(<Host override={changed} />); }
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "校对后的合成摘录" })).toBeNull()); expect(mocks.save).not.toHaveBeenCalled();
});
it("ignores a late verified save after an actor change and aborts its verification signal", async () => {
  const proof = deferred<boolean>(); const view = render(<Host />); await adoptToBuffer(); mocks.verify.mockReturnValueOnce(proof.promise);
  fireEvent.click(screen.getByRole("checkbox", { name: /同意将这段文字保存为本访谈的待校对摘录/ })); fireEvent.click(screen.getByRole("button", { name: "保存访谈合成转写摘录" }));
  await waitFor(() => expect(mocks.verify).toHaveBeenCalledOnce()); const signal = mocks.verify.mock.calls[0]![2] as AbortSignal;
  mocks.session.userId = "different-member"; view.rerender(<Host />); expect(signal.aborted).toBe(true); await act(async () => proof.resolve(true)); expect(mocks.save).not.toHaveBeenCalled();
});
it("keeps saved references visibly pending verification until the actual proof is explicitly rechecked", async () => {
  const view = render(<Host />); await adoptToBuffer(); await saveBuffer(); expect(mocks.verify).toHaveBeenCalledOnce();
  view.unmount(); render(<Host />);
  expect(await screen.findByText("已保存合成 ASR 来源（尚待重新核对）")).toBeVisible(); expect(mocks.verify).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByText("已保存合成 ASR 来源（尚待重新核对）"));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "重新核对实际转写来源" })));
  expect(mocks.verify).toHaveBeenCalledTimes(2); expect(await screen.findByText("已保存合成 ASR 来源（本次已核对）")).toBeVisible();
});
it("retains an edited original when cancelling the independent synthetic draft", async () => {
  render(<Host />); const before = JSON.stringify(server); await adoptToBuffer(); fireEvent.change(screen.getByRole("textbox", { name: "校对后的合成摘录" }), { target: { value: "尚未采纳的编辑" } });
  fireEvent.click(screen.getByRole("button", { name: "取消，保留原摘录" })); expect(mocks.save).not.toHaveBeenCalled(); expect(JSON.stringify(server)).toBe(before); expect(screen.queryByRole("textbox", { name: "校对后的合成摘录" })).toBeNull();
});
