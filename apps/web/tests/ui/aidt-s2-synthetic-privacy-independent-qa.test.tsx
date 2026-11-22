import * as React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AIDT_INTERVIEW_SYNTHETIC_ASR_PREFIX, AidtSavedSyntheticAsrSchema } from "@repo/contracts/aidt-test-research";
import { AidtInterviewOutput } from "@/features/aidt/components/aidt-interview-output";
import { AidtInterviewFindingEditor } from "@/features/aidt/components/aidt-interview-finding-editor";
import { aidtInterviewMaterialKey, confirmAidtInterviewFinding, getAidtInterviewFinding, readAidtInterviews, writeAidtInterview, writeAidtInterviewFinding, writeAidtInterviewTranscript, type AidtInterview } from "@/features/aidt/lib/aidt-interviews";
import { aidtInterviewSyntheticAsrSourceKey, readAidtSavedInterviewSyntheticAsr, saveAidtInterviewSyntheticAsr } from "@/features/aidt/lib/aidt-interview-synthetic-asr";
import { aidtEntityReportLines } from "@/features/aidt/lib/aidt-entity-report";
import { aidtUiReportMarkdown, aidtUiStageMarkdown, emptyAidtUiDrafts, type AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
const mocks = vi.hoisted(() => ({ preview: vi.fn() }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => ({ session: { currentOrgId: "qa-org", userId: "qa-student", sessionToken: "qa-token" } }) }));
vi.mock("@/features/aidt/lib/aidt-print-preview", () => ({ previewAidtPdf: mocks.preview }));
const projectId = "qa-project", id = "15c7b5e2-9d0e-4b10-bc47-000000000001", sibling = "15c7b5e2-9d0e-4b10-bc47-000000000002";
const body = "SYNTHETIC_TRANSCRIPT_PRIVATE_BODY_她先看口味再考虑时间";
const interpretation = "SYNTHETIC_INTERPRETATION_PRIVATE_BODY_学生还未验证的解释";
const context = "SYNTHETIC_CONTEXT_PRIVATE_BODY_合成购物情境";
const materialKey = aidtInterviewMaterialKey(id, "qa-audio");
const pin = AidtSavedSyntheticAsrSchema.parse({ kind: "synthetic-file-asr", audio: { artifactId: "qa-synthetic-audio", versionId: "audio-v1", runId: "audio-upload", sha256: "a".repeat(64) },
  nativeAudio: { threadId: "qa-thread", attachmentId: "native-audio", messageId: "qa-human", sha256: "a".repeat(64) },
  transcript: { artifactId: "qa-transcript", version: 2, attachmentId: "native-transcript", producedByRunId: "qa-run", producedByStepId: "qa-publish-step", name: "qa-transcript.json", sha256: "b".repeat(64) }, reviewedText: body, warnings: ["speaker_identity_unavailable"] });
const person: AidtInterview = { id, version: 1, code: "U01", topicRevision: 1, topic: "理解选择经过", goal: "了解故事", original: "说说上次经过", adopted: "说说上次实际经过", guideConfirmed: true, consent: { notes: true, audio: true, photos: false, observedAt: "2026-11-22T06:47:00Z" } };
function fixture() {
  let draft = writeAidtInterview(writeAidtInterview(emptyAidtUiDrafts()[2]!, person), { ...person, id: sibling, code: "U02" });
  draft.fields[materialKey] = JSON.stringify({ projectId, artifactId: pin.audio.artifactId, versionId: pin.audio.versionId, runId: pin.audio.runId, name: "synthetic-qa.wav", mime: "audio/wav", bytes: 42, sha256: pin.audio.sha256 });
  draft = saveAidtInterviewSyntheticAsr(draft, id, projectId, materialKey, pin);
  draft = writeAidtInterviewFinding(draft, person, { headlineKind: "quote", headline: body, quote: body, context, sourceRef: "synthetic-qa.wav · 合成软件测试 ASR V2" });
  draft = writeAidtInterviewTranscript(draft, id, { sourceKey: materialKey, text: body, checked: true, locator: "合成软件测试 ASR V2" }, projectId);
  draft.fields[`interviewInterpretation:${id}`] = interpretation;
  return confirmAidtInterviewFinding(draft, id, projectId);
}
const reports = (draft: AidtUiStageDraft) => {
  const all = emptyAidtUiDrafts(); all[2] = draft;
  return [aidtEntityReportLines(2, draft, [], projectId).join("\n"), aidtUiStageMarkdown(2, draft), aidtUiReportMarkdown(all)];
};
beforeEach(() => { vi.clearAllMocks(); mocks.preview.mockResolvedValue("cancelled"); });
afterEach(cleanup);

it("marks the actual discovery output and report Markdown as synthetic, with a synthetic quotation label", () => {
  const draft = fixture();
  render(<AidtInterviewOutput projectId={projectId} entityId={id} draft={draft} />);
  const article = screen.getByTestId("aidt-interview-finding").querySelector("article")!;
  expect(article).toHaveTextContent("合成音频软件测试"); expect(article).toHaveTextContent("非真人访谈");
  expect(within(article).getByText(/合成转写摘录/)).toBeVisible();
  expect(within(article).queryByText("受访者原话", { exact: true })).toBeNull();
  for (const text of reports(draft)) { expect(text).toMatch(/合成/); expect(text).toMatch(/不是真人|不得.*真人|非真人/); expect(text).not.toContain("受访者原话："); }
});

it.each(["", "{broken", "{}"])("keeps the synthetic notice for a damaged saved pin %j instead of downgrading it to participant evidence", raw => {
  const draft = fixture(); draft.fields[AIDT_INTERVIEW_SYNTHETIC_ASR_PREFIX + id] = raw;
  render(<><AidtInterviewFindingEditor projectId={projectId} interview={person} draft={draft} readOnly update={() => undefined} />
    <AidtInterviewOutput projectId={projectId} entityId={id} draft={draft} /></>);
  expect(screen.getByTestId("aidt-interview-finding-editor")).toHaveTextContent("合成音频软件测试");
  expect(screen.getByTestId("aidt-interview-output")).toHaveTextContent("合成音频软件测试");
  expect(readAidtSavedInterviewSyntheticAsr(draft, id, projectId)).toBeNull();
  for (const text of reports(draft)) expect(text).toMatch(/合成/);
});

it("omits all discovery, quotation, interpretation and material body from every report when notes consent is revoked", () => {
  const original = fixture(); const draft = writeAidtInterview(original, { ...person, consent: { ...person.consent!, notes: false } });
  for (const text of reports(draft)) {
    expect(text).not.toContain(body); expect(text).not.toContain(context); expect(text).not.toContain(interpretation);
    expect(text).not.toContain("synthetic-qa.wav"); expect(text).toMatch(/授权未确认|授权|不引用/); expect(text).toMatch(/合成/);
  }
  expect(aidtInterviewSyntheticAsrSourceKey(draft, id, projectId, materialKey)).toBeNull();
  expect(readAidtSavedInterviewSyntheticAsr(draft, id, projectId)).toBeNull();
});

it("requires current audio consent, the same entity and the same project before exposing the saved ASR source", () => {
  const draft = fixture();
  expect(readAidtSavedInterviewSyntheticAsr(draft, id, projectId)?.transcript.version).toBe(2);
  expect(readAidtSavedInterviewSyntheticAsr(draft, id, "another-project")).toBeNull();
  expect(readAidtSavedInterviewSyntheticAsr(draft, sibling, projectId)).toBeNull();
  const revoked = writeAidtInterview(draft, { ...person, consent: { ...person.consent!, audio: false } });
  expect(aidtInterviewSyntheticAsrSourceKey(revoked, id, projectId, materialKey)).toBeNull();
  expect(readAidtSavedInterviewSyntheticAsr(revoked, id, projectId)).toBeNull();
  expect(saveAidtInterviewSyntheticAsr(revoked, id, projectId, materialKey, pin)).toBe(revoked);
  expect(saveAidtInterviewSyntheticAsr(draft, sibling, projectId, materialKey, pin)).toBe(draft);
});

it("does not expose revoked notes through disabled discovery editor controls", () => {
  const revokedPerson = { ...person, consent: { ...person.consent!, notes: false } };
  const draft = writeAidtInterview(fixture(), revokedPerson);
  render(<AidtInterviewFindingEditor projectId={projectId} interview={revokedPerson} draft={draft} readOnly update={() => undefined} />);
  const editor = screen.getByTestId("aidt-interview-finding-editor");
  for (const element of editor.querySelectorAll("input, textarea")) {
    expect((element as HTMLInputElement).value).not.toContain(body);
    expect((element as HTMLInputElement).value).not.toContain(context);
    expect((element as HTMLInputElement).value).not.toContain(interpretation);
  }
  expect(editor).not.toHaveTextContent("synthetic-qa.wav");
});

it("does not expose revoked notes through the actual output card or export entry", () => {
  const draft = writeAidtInterview(fixture(), { ...person, consent: { ...person.consent!, notes: false } });
  render(<AidtInterviewOutput projectId={projectId} entityId={id} draft={draft} />);
  const output = screen.getByTestId("aidt-interview-output");
  expect(output).toHaveTextContent("合成音频软件测试");
  expect(output).not.toHaveTextContent(body);
  expect(output).not.toHaveTextContent(context);
  expect(output).not.toHaveTextContent(interpretation);
  expect(output).not.toHaveTextContent("synthetic-qa.wav");
  expect(within(output).queryByRole("button", { name: "导出人物发现卡 PDF" })).toBeNull();
});

it("includes the synthetic label inside the actual card clone sent to the print preview", async () => {
  const draft = fixture(); render(<AidtInterviewOutput projectId={projectId} entityId={id} draft={draft} />);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "导出人物发现卡 PDF" })); });
  expect(mocks.preview).toHaveBeenCalledOnce();
  const clone = mocks.preview.mock.calls[0]![0] as HTMLElement;
  expect(clone).toHaveTextContent("合成音频软件测试"); expect(clone).toHaveTextContent("非真人访谈");
  expect(clone).toHaveTextContent(body); expect(clone.querySelector("button")).toBeNull();
});

it("preserves normal real-material quotation labels when no synthetic marker exists", () => {
  const draft = fixture(); delete draft.fields[AIDT_INTERVIEW_SYNTHETIC_ASR_PREFIX + id];
  const transcript = JSON.parse(draft.fields[`interviewTranscript:${id}`]!); transcript.locator = "00:03";
  draft.fields[`interviewTranscript:${id}`] = JSON.stringify(transcript);
  render(<AidtInterviewOutput projectId={projectId} entityId={id} draft={draft} />);
  expect(within(screen.getByTestId("aidt-interview-finding")).getByText("受访者原话", { exact: true })).toBeVisible();
  expect(screen.queryByText(/合成音频软件测试/)).toBeNull();
  expect(getAidtInterviewFinding(draft, readAidtInterviews(draft.fields)[0]!).quote).toBe(body);
});
