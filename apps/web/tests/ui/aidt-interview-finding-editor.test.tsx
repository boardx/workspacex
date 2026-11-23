import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AidtInterviewFindingEditor } from "@/features/aidt/components/aidt-interview-finding-editor";
import { AidtInterviewOutput } from "@/features/aidt/components/aidt-interview-output";
import { AidtInterviewWorkspace } from "@/features/aidt/components/aidt-interview-workspace";
import { emptyAidtUiDrafts, type AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import { aidtInterviewMaterialKey, confirmAidtInterviewFinding, getAidtInterviewFinding, readAidtInterviewPhoto, readAidtInterviews, writeAidtInterview, writeAidtInterviewFinding, type AidtInterview } from "@/features/aidt/lib/aidt-interviews";
import type { AidtMaterialReceipt, AidtResearchMaterialReference } from "@/features/aidt/lib/aidt-research-materials";

const mocks = vi.hoisted(() => ({ upload: vi.fn(), read: vi.fn(), list: vi.fn() }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => ({ session: { currentOrgId: "org", userId: "student", sessionToken: "session" } }) }));
vi.mock("@/features/aidt/lib/aidt-module-config", () => ({ isAidtModuleEnabled: () => true }));
vi.mock("@/features/aidt/lib/live-aidt-stages", () => ({ readAidtStage: vi.fn(async () => ({ stage: null })), listAidtStageHistory: vi.fn(async () => ({ items: [] })) }));
vi.mock("@/features/aidt/lib/aidt-research-materials", async original => ({ ...await original<typeof import("@/features/aidt/lib/aidt-research-materials")>(), uploadAidtResearchMaterial: mocks.upload, readAidtResearchMaterial: mocks.read, listAidtResearchMaterials: mocks.list }));

const id = "15c7b5e2-9d0e-4b10-bc47-000000000001";
const siblingId = "15c7b5e2-9d0e-4b10-bc47-000000000002";
const interview: AidtInterview = { id, version: 1, code: "U01", topicRevision: 1, topic: "午休选饮料", goal: "了解实际选择", original: "你上次怎么选？", adopted: "上次选择经过？", guideConfirmed: true,
  consent: { notes: true, audio: false, photos: false, observedAt: "2026-11-22T01:00:00.000Z" } };
const photo: AidtResearchMaterialReference = { projectId: "qa", artifactId: "photo-u01", runId: "run", versionId: "v1", name: "U01现场.png", mime: "image/png", sha256: "a".repeat(64), bytes: 2 };
const receipt: AidtMaterialReceipt = { projectId: "qa", artifactId: photo.artifactId, runId: "run", name: photo.name, sha256: photo.sha256, bytes: photo.bytes, duplicateAction: "use-existing" };
let latest: AidtUiStageDraft;
function initial() {
  let draft = writeAidtInterview(writeAidtInterview(emptyAidtUiDrafts()[2]!, interview), { ...interview, id: siblingId, code: "U02" });
  draft = writeAidtInterviewFinding(draft, interview, { headline: "先看菜单", headlineKind: "student-summary", context: "午休比较饮品。", quote: "我先看口味", sourceRef: "访谈原件 · 00:01" });
  const sourceKey = aidtInterviewMaterialKey(id, "source");
  draft.fields[sourceKey] = JSON.stringify({ ...photo, artifactId: "text-u01", name: "U01.txt", mime: "text/plain" });
  draft.fields["interviewTranscript:" + id] = JSON.stringify({ sourceKey, locator: "00:01", text: "我先看口味", checked: true });
  draft.fields["interviewInterpretation:" + id] = "学生解释，尚待核实。";
  return confirmAidtInterviewFinding(draft, id, "qa");
}
function Host({ draft = initial(), entityId = id, readOnly = false, showOutput = false }: { draft?: AidtUiStageDraft; entityId?: string; readOnly?: boolean; showOutput?: boolean }) {
  const [value, setValue] = React.useState(draft); latest = value;
  const current = readAidtInterviews(value.fields).find(row => row.id === entityId)!;
  return <><AidtInterviewFindingEditor projectId="qa" interview={current} draft={value} update={setValue} readOnly={readOnly} />
    {showOutput && <AidtInterviewOutput projectId="qa" entityId={entityId} draft={value} />}</>;
}
function DoublePanel({ photos = false }: { photos?: boolean }) {
  const [value, setValue] = React.useState(() => writeAidtInterview(initial(), { ...interview, consent: { ...interview.consent!, photos } })); latest = value;
  const current = readAidtInterviews(value.fields).find(row => row.id === id)!;
  return <><AidtInterviewFindingEditor projectId="qa" interview={current} draft={value} update={setValue} readOnly={false} />
    <AidtInterviewWorkspace projectId="qa" entityId={id} draft={value} update={setValue} readOnly={false} surface="materials" /></>;
}
const editor = () => within(screen.getByTestId("aidt-interview-finding-editor"));
const uploadPhoto = () => {
  fireEvent.change(editor().getByLabelText("U01发现卡照片选择文件"), { target: { files: [new File(["ok"], photo.name, { type: "image/png" })] } });
  fireEvent.click(editor().getByRole("button", { name: "保存照片" }));
};
beforeEach(() => {
  vi.clearAllMocks(); mocks.upload.mockResolvedValue(receipt); mocks.read.mockResolvedValue({ reference: photo, blob: new Blob(["ok"]), status: {} }); mocks.list.mockResolvedValue([]);
  vi.stubGlobal("URL", class extends URL { static createObjectURL = vi.fn().mockReturnValue("blob:verified-photo"); static revokeObjectURL = vi.fn(); });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("explains the pending finding requirements without confirming a draft", () => {
  render(<Host entityId={siblingId} />);
  const before = latest;
  fireEvent.click(editor().getByRole("button", { name: "确认人物发现卡" }));
  expect(editor().getByRole("alert")).toHaveTextContent("填写「一句发现」");
  expect(editor().getByRole("alert")).toHaveTextContent("选择原件、填写定位和摘录");
  expect(latest).toBe(before);
});

it("keeps only the finding and situation primary, and preserves evidence when either is revised", () => {
  render(<Host />);
  expect(editor().getByRole("textbox", { name: "一句发现" })).toBeVisible();
  expect(editor().getByRole("textbox", { name: "具体情况" })).toBeVisible();
  expect(editor().getByLabelText("可定位的受访者原话")).not.toBeVisible();
  expect(editor().getByLabelText("学生的解释")).not.toBeVisible();
  const before = JSON.parse(JSON.stringify(latest));
  fireEvent.change(editor().getByRole("textbox", { name: "具体情况" }), { target: { value: "在饮品窗口逐项比较两种口味。" } });
  expect(latest.fields["interviewConfirmed:" + id]).toBe("");
  expect(getAidtInterviewFinding(latest, interview)).toMatchObject({ quote: "我先看口味", context: "在饮品窗口逐项比较两种口味。", headlineKind: "student-summary", sourceRef: "U01.txt · 00:01" });
  expect(latest.fields["interviewInterpretation:" + id]).toBe(before.fields["interviewInterpretation:" + id]);
  fireEvent.click(editor().getByText("原话与来源"));
  expect(editor().getByLabelText("可定位的受访者原话")).toBeVisible();
  expect(editor().getByLabelText("学生的解释")).toHaveValue("学生解释，尚待核实。");
});

it("requires explicit photo consent, binds verified uploaded bytes to this interview, then supports persisted reentry and removal", async () => {
  const view = render(<Host showOutput />);
  expect(editor().queryByLabelText("U01发现卡照片选择文件")).toBeNull();
  fireEvent.click(editor().getByRole("checkbox", { name: "已获受访者授权共享照片" }));
  expect(readAidtInterviews(latest.fields).find(row => row.id === id)?.consent).toMatchObject({ photos: true, notes: true, audio: false });
  uploadPhoto();
  await waitFor(() => expect(readAidtInterviewPhoto(latest, readAidtInterviews(latest.fields)[0]!, "qa")?.reference).toEqual(photo));
  expect(mocks.upload).toHaveBeenCalledOnce();
  expect(mocks.read).toHaveBeenCalledWith(expect.objectContaining({ projectId: "qa" }), receipt);
  expect(readAidtInterviewPhoto(latest, readAidtInterviews(latest.fields)[1]!, "qa")).toBeUndefined();
  expect(screen.getByTestId("aidt-interview-output")).toHaveTextContent("U01现场.png");
  const saved = JSON.parse(JSON.stringify(latest)); view.unmount(); render(<Host draft={saved} />);
  expect(await editor().findByRole("img", { name: "U01 的授权访谈照片" })).toHaveAttribute("src", "blob:verified-photo");
  fireEvent.click(editor().getByRole("button", { name: "移除照片" }));
  expect(latest.fields["discoveryPhoto:" + id]).toBeUndefined();
  expect(Object.keys(latest.fields).some(key => key.startsWith("interviewMaterial:" + id) && latest.fields[key]?.includes(photo.artifactId))).toBe(true);
  expect(getAidtInterviewFinding(latest, interview).headline).toBe("先看菜单");
});

it("keeps a failed upload readback retryable without uploading the same file again", async () => {
  mocks.read.mockRejectedValueOnce(new Error("read denied temporarily"));
  const draft = writeAidtInterview(initial(), { ...interview, consent: { ...interview.consent!, photos: true } });
  render(<Host draft={draft} />); uploadPhoto();
  expect(await editor().findByRole("alert")).toHaveTextContent("尚未关联本次文件");
  expect(latest.fields["discoveryPhoto:" + id]).toBeUndefined();
  fireEvent.click(editor().getByRole("button", { name: "重试读取照片" }));
  await waitFor(() => expect(latest.fields["discoveryPhoto:" + id]).toContain(photo.artifactId));
  expect(mocks.upload).toHaveBeenCalledOnce();
});

it("cancels a pending upload and never associates its late response", async () => {
  let finish!: (value: AidtMaterialReceipt) => void;
  mocks.upload.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<Host draft={writeAidtInterview(initial(), { ...interview, consent: { ...interview.consent!, photos: true } })} />);
  uploadPhoto();
  const signal = mocks.upload.mock.calls[0]![0].signal as AbortSignal;
  fireEvent.click(editor().getByRole("button", { name: "取消" }));
  await act(async () => finish(receipt));
  expect(signal.aborted).toBe(true); expect(mocks.read).not.toHaveBeenCalled();
  expect(latest.fields["discoveryPhoto:" + id]).toBeUndefined();
  expect(editor().getByText("已取消本次关联，原照片与文字仍保留。")).toBeVisible();
});

it("revokes photo consent in the card and ignores an upload that finishes afterwards", async () => {
  let finish!: (value: AidtMaterialReceipt) => void;
  mocks.upload.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<Host draft={writeAidtInterview(initial(), { ...interview, consent: { ...interview.consent!, photos: true } })} />);
  uploadPhoto();
  const signal = mocks.upload.mock.calls[0]![0].signal as AbortSignal;
  fireEvent.click(editor().getByRole("checkbox", { name: "已获受访者授权共享照片" }));
  await act(async () => finish(receipt));
  expect(signal.aborted).toBe(true); expect(mocks.read).not.toHaveBeenCalled();
  expect(editor().queryByRole("button", { name: "保存照片" })).toBeNull();
  expect(latest.fields["discoveryPhoto:" + id]).toBeUndefined();
  expect(readAidtInterviews(latest.fields).find(row => row.id === id)?.consent).toMatchObject({ photos: false, notes: true, audio: false });
  expect(getAidtInterviewFinding(latest, interview)).toMatchObject({ headline: "先看菜单", quote: "我先看口味" });
});

it("does not permit photo or text mutations on the read-only surface", () => {
  render(<Host readOnly draft={writeAidtInterview(initial(), { ...interview, consent: { ...interview.consent!, photos: true } })} />);
  expect(editor().getByRole("checkbox", { name: "已获受访者授权共享照片" })).toBeDisabled();
  expect(editor().getByRole("button", { name: "上传照片" })).toBeDisabled();
  expect(editor().getByRole("textbox", { name: "一句发现" })).toBeDisabled();
  expect(mocks.upload).not.toHaveBeenCalled();
});

it("does not restore photo consent from the materials panel after the card revokes it, and keeps unsaved audio edits", () => {
  render(<DoublePanel photos />);
  const materials = within(screen.getByRole("region", { name: "授权和访谈材料" }));
  fireEvent.click(materials.getByRole("checkbox", { name: "已获授权共享原始录音" }));
  fireEvent.click(editor().getByRole("checkbox", { name: "已获受访者授权共享照片" }));
  expect(materials.getByRole("checkbox", { name: "已获授权共享照片" })).not.toBeChecked();
  expect(materials.getByRole("checkbox", { name: "已获授权共享原始录音" })).toBeChecked();
  fireEvent.click(materials.getByRole("button", { name: "更新授权记录" }));
  expect(readAidtInterviews(latest.fields).find(row => row.id === id)?.consent).toMatchObject({ photos: false, audio: true, notes: true });
  expect(editor().queryByRole("button", { name: "上传照片" })).toBeNull();
});

it("preserves a newly granted inline photo authorization when only text consent is edited elsewhere", () => {
  render(<DoublePanel />);
  const materials = within(screen.getByRole("region", { name: "授权和访谈材料" }));
  fireEvent.click(editor().getByRole("checkbox", { name: "已获受访者授权共享照片" }));
  expect(materials.getByRole("checkbox", { name: "已获授权共享照片" })).toBeChecked();
  fireEvent.click(materials.getByRole("checkbox", { name: "已获授权共享文字记录" }));
  fireEvent.click(materials.getByRole("button", { name: "更新授权记录" }));
  expect(readAidtInterviews(latest.fields).find(row => row.id === id)?.consent).toMatchObject({ photos: true, notes: false, audio: false });
});

it("rejects an older pending photo grant after a newer inline revocation and accepts only a fresh explicit choice", () => {
  render(<DoublePanel />);
  const materials = within(screen.getByRole("region", { name: "授权和访谈材料" }));
  fireEvent.click(materials.getByRole("checkbox", { name: "已获授权共享照片" }));
  const inline = editor().getByRole("checkbox", { name: "已获受访者授权共享照片" });
  fireEvent.click(inline); fireEvent.click(inline);
  expect(materials.getByText("照片授权已在其他位置更新，请重新核对照片选择。")).toBeVisible();
  expect(materials.getByRole("checkbox", { name: "已获授权共享照片" })).not.toBeChecked();
  fireEvent.click(materials.getByRole("checkbox", { name: "已获授权共享原始录音" }));
  fireEvent.click(materials.getByRole("button", { name: "更新授权记录" }));
  expect(readAidtInterviews(latest.fields).find(row => row.id === id)?.consent?.photos).toBe(false);
  fireEvent.click(materials.getByRole("checkbox", { name: "已获授权共享照片" }));
  fireEvent.click(materials.getByRole("button", { name: "更新授权记录" }));
  expect(readAidtInterviews(latest.fields).find(row => row.id === id)?.consent?.photos).toBe(true);
});
