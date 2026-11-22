import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AidtResearchMaterialControl, AidtResearchMaterialPreview } from "@/features/aidt/components/aidt-research-material";
import type { AidtMaterialReceipt, AidtResearchMaterialReference } from "@/features/aidt/lib/aidt-research-materials";
const mocks = vi.hoisted(() => ({ upload: vi.fn(), read: vi.fn(), list: vi.fn(), session: { currentOrgId: "org", userId: "student", sessionToken: "captured" } }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => ({ session: mocks.session }) }));
vi.mock("@/features/aidt/lib/aidt-module-config", () => ({ isAidtModuleEnabled: () => true }));
vi.mock("@/features/aidt/lib/aidt-research-materials", async original => ({ ...await original<typeof import("@/features/aidt/lib/aidt-research-materials")>(), uploadAidtResearchMaterial: mocks.upload, readAidtResearchMaterial: mocks.read, listAidtResearchMaterials: mocks.list }));
const reference: AidtResearchMaterialReference = { projectId: "p", artifactId: "artifact", runId: "run", versionId: "version", mime: "image/png", name: "教学夹具.png", sha256: "a".repeat(64), bytes: 1 };
const receipt: AidtMaterialReceipt = { projectId: "p", artifactId: "artifact", runId: "run", name: reference.name, sha256: reference.sha256, bytes: 1, duplicateAction: "use-existing" };
const choose = () => fireEvent.change(screen.getByLabelText("研究原始材料选择文件"), { target: { files: [new File(["x"], reference.name, { type: "image/png" })] } });
beforeEach(() => {
  vi.clearAllMocks(); mocks.session = { currentOrgId: "org", userId: "student", sessionToken: "captured" };
  mocks.upload.mockResolvedValue(receipt); mocks.read.mockResolvedValue({ reference, blob: new Blob(["x"]), status: { status: "STORED", retrievable: false } }); mocks.list.mockResolvedValue([]);
  vi.stubGlobal("URL", class extends URL { static createObjectURL = vi.fn().mockReturnValue("blob:verified-original"); static revokeObjectURL = vi.fn(); });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("keeps an accepted receipt for read-only retry, blocks duplicate submits and never calls it a saved stage", async () => {
  mocks.read.mockRejectedValueOnce(new Error("temporary download outage")); const changed = vi.fn();
  render(<AidtResearchMaterialControl projectId="p" label="研究原始材料" onChange={changed} />);
  choose(); fireEvent.click(screen.getByRole("button", { name: "保存原始材料" })); fireEvent.click(screen.getByRole("button", { name: "保存原始材料" }));
  await screen.findByRole("button", { name: "重试读取上传回执" }); await waitFor(() => expect(screen.getByRole("button", { name: "重试读取上传回执" })).toBeEnabled());
  expect(changed).not.toHaveBeenCalled(); expect(mocks.upload).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "重试读取上传回执" }));
  await waitFor(() => expect(changed).toHaveBeenCalledWith(reference));
  expect(mocks.upload).toHaveBeenCalledOnce(); expect(mocks.read).toHaveBeenCalledTimes(2);
  expect(screen.getByText(/重复文件已复用原版本/)).toHaveTextContent("已加入草稿；请保存到小组");
});
it("does not bind a late upload to another project or identity", async () => {
  let finish!: (receipt: AidtMaterialReceipt) => void; mocks.upload.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const changed = vi.fn(); const view = render(<AidtResearchMaterialControl projectId="p" label="研究原始材料" onChange={changed} />);
  choose(); fireEvent.click(screen.getByRole("button", { name: "保存原始材料" }));
  const signal = mocks.upload.mock.calls[0]![0].signal as AbortSignal;
  mocks.session = { currentOrgId: "org", userId: "other", sessionToken: "other-token" };
  view.rerender(<AidtResearchMaterialControl projectId="q" label="研究原始材料" onChange={changed} />);
  await act(async () => finish(receipt));
  expect(signal.aborted).toBe(true); expect(changed).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
});
it("does not overwrite a student's newer picture choice when an earlier upload finishes", async () => {
  let finish!: (receipt: AidtMaterialReceipt) => void; mocks.upload.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const changed = vi.fn(); const view = render(<AidtResearchMaterialControl projectId="p" label="研究原始材料" selectionScope="unselected" onChange={changed} />);
  choose(); fireEvent.click(screen.getByRole("button", { name: "保存原始材料" }));
  view.rerender(<AidtResearchMaterialControl projectId="p" label="研究原始材料" selectionScope="student-picked-native-chat-picture" onChange={changed} />);
  await act(async () => finish(receipt));
  expect(changed).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
});
it("does not overwrite a freshly reloaded file reference when an older read completes in the same project", async () => {
  let finish!: (value: unknown) => void; mocks.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const changed = vi.fn(); const view = render(<AidtResearchMaterialControl projectId="p" label="研究原始材料" value={null} onChange={changed} />);
  choose(); fireEvent.click(screen.getByRole("button", { name: "保存原始材料" }));
  await waitFor(() => expect(mocks.read).toHaveBeenCalledOnce());
  view.rerender(<AidtResearchMaterialControl projectId="p" label="研究原始材料" value={{ ...reference, artifactId: "newer", versionId: "newer-version" }} onChange={changed} />);
  await act(async () => finish({ reference, blob: new Blob(["x"]), status: {} }));
  expect(changed).not.toHaveBeenCalled();
});
it("retains the upload-success and stage-unsaved feedback after its own parent commits the selected reference", async () => {
  mocks.read.mockResolvedValueOnce({ reference, blob: new Blob(["x"]), status: null, processingFailed: true });
  function Parent() { const [selected, setSelected] = React.useState<AidtResearchMaterialReference | null>(null); return <AidtResearchMaterialControl projectId="p" label="研究原始材料" value={selected} selectionScope={JSON.stringify(selected)} onChange={setSelected} />; }
  render(<Parent />); choose(); fireEvent.click(screen.getByRole("button", { name: "保存原始材料" }));
  expect(await screen.findByText(/已加入草稿；请保存到小组/)).toHaveTextContent("后续材料处理失败");
  await waitFor(() => expect(screen.getByRole("button", { name: "移除原始材料引用" })).toBeEnabled());
});
it("reports denied source lists distinctly and preserves an existing reference under readonly", async () => {
  mocks.list.mockRejectedValueOnce(new Error("404")); const changed = vi.fn(); const view = render(<AidtResearchMaterialControl projectId="p" label="研究原始材料" value={reference} onChange={changed} />);
  fireEvent.click(screen.getByRole("button", { name: "选择本组已保存原始材料" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("未判定为无材料");
  view.rerender(<AidtResearchMaterialControl projectId="p" label="研究原始材料" value={reference} readOnly onChange={changed} />);
  expect(screen.getByRole("button", { name: "移除原始材料引用" })).toBeDisabled(); choose();
  fireEvent.click(screen.getByRole("button", { name: "保存原始材料" })); expect(mocks.upload).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled();
});
it("only exposes a decoded real source image to the PDF flow and revokes that readiness on corruption", async () => {
  const ready = vi.fn(); render(<AidtResearchMaterialPreview projectId="p" reference={reference} onImageState={ready} />);
  const image = await screen.findByRole("img", { name: reference.name }); expect(image).toHaveAttribute("src", "blob:verified-original");
  expect(ready).toHaveBeenLastCalledWith({ src: null, failed: false });
  Object.defineProperties(image, { naturalWidth: { value: 2 }, naturalHeight: { value: 2 } }); fireEvent.load(image);
  expect(ready).toHaveBeenLastCalledWith({ src: "blob:verified-original", failed: false });
  fireEvent.error(image); expect(ready).toHaveBeenLastCalledWith({ src: null, failed: true });
  expect(screen.queryByRole("link", { name: "下载真实原件" })).not.toBeInTheDocument();
});
it("shows the actual uploader inside collapsed source details without calling them the current reader or document author", async () => {
  mocks.read.mockResolvedValueOnce({ reference: { ...reference, submittedBy: "another-submitter", submittedAt: "2026-11-16T00:30:00.000Z" }, blob: new Blob(["x"]), status: {} });
  render(<AidtResearchMaterialPreview projectId="p" reference={reference} />);
  await screen.findByRole("img", { name: reference.name });
  const detail = screen.getByText("来源与版本").closest("details")!; expect(detail.open).toBe(false);
  fireEvent.click(screen.getByText("来源与版本"));
  expect(detail).toHaveTextContent("本次上传提交者：another-submitter"); expect(detail).toHaveTextContent("2026-11-16T00:30:00.000Z");
  expect(detail).toHaveTextContent("这不是阶段关联保存者或文件原作者");
});
it("never promotes edited stage metadata to a verified submitter after the source is denied", async () => {
  mocks.read.mockRejectedValueOnce(new Error("404"));
  render(<AidtResearchMaterialPreview projectId="p" reference={{ ...reference, submittedBy: "伪造提交者", submittedAt: "2026-11-16T00:30:00.000Z" }} />);
  await screen.findByRole("alert"); fireEvent.click(screen.getByText("来源与版本"));
  expect(screen.queryByText(/伪造提交者/)).not.toBeInTheDocument();
  expect(screen.getByText(/本次上传提交者：无法核对/)).toBeVisible();
});
it("keeps photo metadata and original download in one closed disclosure without issuing another read", async () => {
  render(<AidtResearchMaterialPreview projectId="p" reference={reference} alt="授权访谈照片" compact />);
  expect(await screen.findByRole("img", { name: "授权访谈照片" })).toBeVisible();
  const detail = screen.getByText("照片来源").closest("details")!;
  expect(detail.open).toBe(false);
  expect(screen.getByText(reference.name)).not.toBeVisible();
  expect(within(detail).getByText("下载真实原件")).not.toBeVisible();
  fireEvent.click(screen.getByText("照片来源"));
  expect(within(detail).getByRole("link", { name: "下载真实原件" })).toHaveAttribute("download", reference.name);
  expect(detail).toHaveTextContent(reference.sha256);
  expect(detail).toHaveTextContent("版本 version");
  expect(mocks.read).toHaveBeenCalledOnce();
});
it("never hides a photo read error or its retry inside collapsed photo metadata", async () => {
  mocks.read.mockRejectedValueOnce(new Error("temporary photo outage"));
  render(<AidtResearchMaterialPreview projectId="p" reference={reference} compact />);
  expect(await screen.findByRole("alert")).toBeVisible();
  const detail = screen.getByText("照片来源").closest("details")!;
  expect(detail.open).toBe(false);
  expect(screen.getByRole("button", { name: "重试读取原件" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "重试读取原件" }));
  expect(await screen.findByRole("img", { name: reference.name })).toBeVisible();
  expect(mocks.read).toHaveBeenCalledTimes(2);
});
