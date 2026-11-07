import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { personalRealtimeTranscription as C } from "@repo/contracts";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { CreateTranscriptionDialog } from "@/components/rec/create-transcription-dialog";
import { EditTranscriptionDialog } from "@/components/rec/edit-transcription-dialog";
import { DeleteTranscriptionDialog } from "@/components/rec/delete-transcription-dialog";
import { RealtimeTranscriptionWorkspace } from "@/components/rec/realtime-transcription-workspace";
const session = C.PersonalTranscriptionDetail.parse({ sessionId: "rec-raw", name: "用户录音 {count}", tags: ["原标签"], status: "idle", durationMs: 1200, createdAt: "2026-11-03T00:00:00.000Z", updatedAt: "2026-11-03T00:00:00.000Z", content: "原始逐字稿。标点、换行与 {count}\n必须保留。" });
function Language() { const { setLocale } = useI18n(); return <><button onClick={() => setLocale("en")}>EN test</button><button onClick={() => setLocale("zh-CN")}>ZH test</button></>; }
function show(children: React.ReactNode) { return render(<I18nProvider initialLocale="en"><Language />{children}</I18nProvider>); }
function swap() { fireEvent.click(screen.getByText("ZH test")); fireEvent.click(screen.getByText("EN test")); }
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });
it("localizes creation and keeps the edited name and uncommitted tag through locale changes", async () => {
  const create = vi.fn(); show(<CreateTranscriptionDialog open onOpenChange={vi.fn()} onCreate={create} />);
  expect(screen.getByRole("heading", { name: "New transcription" })).toBeVisible();
  fireEvent.change(screen.getByTestId("rec-create-name"), { target: { value: "用户编辑名称 {count}" } });
  fireEvent.change(screen.getByTestId("rec-create-tag-input"), { target: { value: "用户草稿标签" } }); swap();
  expect(screen.getByTestId("rec-create-name")).toHaveValue("用户编辑名称 {count}"); expect(screen.getByTestId("rec-create-tag-input")).toHaveValue("用户草稿标签"); expect(create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Create and open" }));
  expect(create).toHaveBeenCalledWith({ name: "用户编辑名称 {count}", tags: ["用户草稿标签"] });
});
it("retains a single pending creation and retranslates its failure after the request rejects", async () => {
  let reject!: (error: Error) => void; const create = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
  show(<CreateTranscriptionDialog open onOpenChange={vi.fn()} onCreate={create} />);
  fireEvent.click(screen.getByTestId("rec-create-submit")); swap(); expect(create).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Creating" })).toBeDisabled();
  await act(async () => reject(Error("PRIVATE_CREATE_DETAIL"))); expect(screen.getByRole("alert")).toHaveTextContent("Creation failed. Try again later."); swap(); expect(create).toHaveBeenCalledTimes(1);
});
it("localizes workspace controls while preserving saved and interim transcript text without starting capture", () => {
  const start = vi.fn(); const stop = vi.fn(); show(<RealtimeTranscriptionWorkspace session={session} interimSegment="临时识别原文" onBack={vi.fn()} onStart={start} onStop={stop} />);
  expect(screen.getByRole("heading", { name: "Live transcript" })).toBeVisible(); swap();
  expect(screen.getByTestId("rec-live-content").textContent).toContain(session.content); expect(screen.getByTestId("rec-live-interim")).toHaveTextContent("临时识别原文"); expect(start).not.toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled();
});
it("keeps a transcript editing draft and the same pending save through locale changes", async () => {
  let finish!: () => void; const save = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  show(<RealtimeTranscriptionWorkspace session={session} onBack={vi.fn()} onStart={vi.fn()} onStop={vi.fn()} onSaveContent={save} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit" })); fireEvent.change(screen.getByRole("textbox", { name: "Transcript text" }), { target: { value: "用户编辑正文 {count}\n仍保留。" } }); swap();
  expect(screen.getByTestId("rec-live-editor")).toHaveValue("用户编辑正文 {count}\n仍保留。");
  fireEvent.click(screen.getByTestId("rec-live-save")); swap(); expect(save).toHaveBeenCalledTimes(1); expect(save).toHaveBeenCalledWith("用户编辑正文 {count}\n仍保留。"); expect(screen.getByTestId("rec-live-save")).toBeDisabled();
  await act(async () => finish()); expect(document.activeElement).toBe(screen.getByTestId("rec-live-edit"));
});
it("retranslates a rejected content save without discarding the edited transcript", async () => {
  const save = vi.fn(async () => { throw Error("PRIVATE_SAVE_DETAIL"); }); show(<RealtimeTranscriptionWorkspace session={session} onBack={vi.fn()} onStart={vi.fn()} onStop={vi.fn()} onSaveContent={save} />);
  fireEvent.click(screen.getByTestId("rec-live-edit")); fireEvent.change(screen.getByTestId("rec-live-editor"), { target: { value: "失败后保留原文" } }); fireEvent.click(screen.getByTestId("rec-live-save"));
  expect(await screen.findByText("Transcript could not be saved. Try again later.")).toBeVisible(); swap(); expect(screen.getByTestId("rec-live-editor")).toHaveValue("失败后保留原文"); expect(save).toHaveBeenCalledTimes(1);
});
it("retains an edited name and a single pending rename across locale changes", async () => {
  let finish!: () => void; const rename = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  show(<RealtimeTranscriptionWorkspace session={session} onBack={vi.fn()} onStart={vi.fn()} onStop={vi.fn()} onRename={rename} />);
  fireEvent.doubleClick(screen.getByTestId("rec-live-title")); const input = screen.getByRole("textbox", { name: "Recording name" }); fireEvent.change(input, { target: { value: "用户改名 {count}" } }); swap();
  expect(input).toHaveValue("用户改名 {count}"); fireEvent.click(screen.getByRole("button", { name: "Save recording name" })); swap(); expect(rename).toHaveBeenCalledTimes(1); expect(rename).toHaveBeenCalledWith("用户改名 {count}"); await act(async () => finish());
});
it("keeps connecting cancellation available and does not restart capture on locale changes", () => {
  const stop = vi.fn(); const start = vi.fn(); show(<RealtimeTranscriptionWorkspace session={session} streamState="connecting" onBack={vi.fn()} onStart={start} onStop={stop} />);
  expect(screen.getByRole("button", { name: "Cancel connection" })).toBeEnabled(); swap(); expect(start).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "Cancel connection" })); expect(stop).toHaveBeenCalledTimes(1);
});
it("localizes reconnect overlay chrome while preserving the provided diagnostic and explicit reconnect action", () => {
  const reconnect = vi.fn(); show(<RealtimeTranscriptionWorkspace session={session} errorMessage="原始诊断 {count}" reconnectableError onBack={vi.fn()} onStart={vi.fn()} onStop={vi.fn()} onReconnect={reconnect} />);
  expect(screen.getByRole("heading", { name: "Live transcription connection error" })).toBeVisible(); swap(); expect(screen.getByTestId("rec-live-error")).toHaveTextContent("原始诊断 {count}"); expect(reconnect).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "Reconnect" })); expect(reconnect).toHaveBeenCalledTimes(1);
});

it("keeps metadata drafts while translating the complete metadata dialog", () => {
 const save = vi.fn(); show(<EditTranscriptionDialog open initialName="用户标题" initialTags={session.tags} onOpenChange={vi.fn()} onSave={save} />);
 expect(screen.getByRole("heading", { name: "Edit transcription" })).toBeVisible(); fireEvent.change(screen.getByTestId("rec-edit-name"), { target: { value: "新标题 {count}" } }); swap(); expect(screen.getByTestId("rec-edit-name")).toHaveValue("新标题 {count}"); expect(save).not.toHaveBeenCalled();
});
it("translates the irreversible deletion explanation while retaining the literal name and explicit confirmation", () => {
 const remove = vi.fn(); show(<DeleteTranscriptionDialog open name="用户标题 {count}" onOpenChange={vi.fn()} onConfirm={remove} />);
 expect(screen.getByRole("heading", { name: "Delete transcription?" })).toBeVisible(); expect(screen.getByTestId("rec-delete-dialog")).toHaveTextContent("The transcript and all recording batches will be permanently deleted and cannot be recovered."); swap(); expect(screen.getByTestId("rec-delete-dialog")).toHaveTextContent("用户标题 {count}"); expect(remove).not.toHaveBeenCalled();
});
it("updates only an untouched creation default when switching locale", () => {
 show(<CreateTranscriptionDialog open onOpenChange={vi.fn()} onCreate={vi.fn()} />);
 expect(screen.getByTestId("rec-create-name")).toHaveValue("Untitled transcription"); fireEvent.click(screen.getByText("ZH test")); expect(screen.getByTestId("rec-create-name")).toHaveValue("未命名转录");
 fireEvent.change(screen.getByTestId("rec-create-name"), { target: { value: "Untitled transcription" } }); fireEvent.click(screen.getByText("EN test")); fireEvent.click(screen.getByText("ZH test")); expect(screen.getByTestId("rec-create-name")).toHaveValue("Untitled transcription");
});
