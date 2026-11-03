import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { TranscriptionHistory } from "@/components/rec/transcription-history";
import { RealtimeTranscriptionWorkspace } from "@/components/rec/realtime-transcription-workspace";
type AsrHandlers = { onState: (state: "recording") => void; onError: (reason: string) => void };
const api = vi.hoisted(() => ({ list: vi.fn(), tags: vi.fn(), read: vi.fn(), create: vi.fn(), update: vi.fn(), metadata: vi.fn(), remove: vi.fn(), stop: vi.fn(), open: vi.fn(), stopAsr: vi.fn(), handlers: null as null | { onState: (state: "recording") => void; onError: (reason: string) => void } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/rec" }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => ({ session: { sessionToken: "raw-token", currentOrgId: "org-raw" } }) }));
vi.mock("@/lib/live-personal-transcriptions", () => ({ listPersonalTranscriptions: api.list, listPersonalTranscriptionTags: api.tags, readPersonalTranscription: api.read, createPersonalTranscription: api.create, updatePersonalTranscriptionContent: api.update, updatePersonalTranscriptionMetadata: api.metadata, deletePersonalTranscription: api.remove, stopPersonalTranscription: api.stop }));
vi.mock("@/lib/BoardxRealtimeAsrClient", () => ({ openBoardxRealtimeAsr: api.open }));
const summary = { sessionId: "rec-raw", name: "原始转录 {count}", tags: ["原标签"], status: "idle" as const, durationMs: 1200, createdAt: "2026-11-03T00:00:00.000Z", updatedAt: "2026-11-03T00:00:00.000Z" };
const detail = { ...summary, content: "逐字稿原文 {count}。" };
function Language() { const { setLocale } = useI18n(); return <><button onClick={() => setLocale("en")}>EN test</button><button onClick={() => setLocale("zh-CN")}>ZH test</button></>; }
function show(children: React.ReactNode) { render(<I18nProvider initialLocale="en"><Language />{children}</I18nProvider>); }
function swap() { fireEvent.click(screen.getByText("ZH test")); fireEvent.click(screen.getByText("EN test")); }
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); api.handlers = null;
  api.list.mockResolvedValue({ items: [summary], nextCursor: null }); api.tags.mockResolvedValue({ tags: summary.tags }); api.read.mockResolvedValue(detail); api.create.mockResolvedValue({ ...summary, sessionId: "rec-created" }); api.stopAsr.mockResolvedValue(undefined);
  api.open.mockImplementation(async (_id: string, options: { handlers: AsrHandlers }) => { api.handlers = options.handlers; options.handlers.onState("recording"); return { captureId: "capture-raw", stop: api.stopAsr }; });
});
it("localizes the real history and preserves its raw query without locale-driven reads", async () => {
  show(<TranscriptionHistory uiState="default" />); expect(await screen.findByRole("heading", { name: "Transcription history" })).toBeVisible();
  const input = screen.getByRole("textbox", { name: "Search transcriptions" }); fireEvent.change(input, { target: { value: "用户查询 {count}" } });
  await waitFor(() => expect(api.list.mock.calls.some(([value]) => value.query === "用户查询 {count}")).toBe(true)); const reads = api.list.mock.calls.length; swap(); expect(input).toHaveValue("用户查询 {count}"); expect(api.list).toHaveBeenCalledTimes(reads);
});
it("retranslates a created notice without changing the created name or starting capture", async () => {
  show(<TranscriptionHistory uiState="default" />); fireEvent.click(await screen.findByTestId("rec-create-open")); fireEvent.change(screen.getByTestId("rec-create-name"), { target: { value: summary.name } }); fireEvent.click(screen.getByTestId("rec-create-submit"));
  await screen.findByTestId("rec-live-workspace"); expect(api.open).not.toHaveBeenCalled(); fireEvent.click(screen.getByTestId("rec-live-back"));
  expect(await screen.findByTestId("saved")).toHaveTextContent(`Created “${summary.name}”`); swap(); expect(screen.getByTestId("saved")).toHaveTextContent(`Created “${summary.name}”`); expect(api.create).toHaveBeenCalledTimes(1);
});
it("renders a controlled ASR reason in the active locale without reopening the transport", async () => {
  show(<TranscriptionHistory uiState="default" />); fireEvent.click(await screen.findByTestId("rec-history-open-rec-raw")); await screen.findByTestId("rec-live-workspace"); fireEvent.click(screen.getByTestId("rec-live-toggle")); await waitFor(() => expect(api.open).toHaveBeenCalledTimes(1));
  act(() => api.handlers!.onError("QUOTA_EXCEEDED")); expect(screen.getByTestId("rec-live-error")).toHaveTextContent("The current live transcription quota is insufficient."); swap(); expect(api.open).toHaveBeenCalledTimes(1); expect(screen.getByTestId("rec-live-content")).toHaveTextContent(detail.content);
});
it("keeps a dismissed error dialog closed when only the error display language changes", () => {
  function ErrorView() { const { locale } = useI18n(); return <RealtimeTranscriptionWorkspace session={detail} onBack={vi.fn()} onStart={vi.fn()} onStop={vi.fn()} reconnectableError errorIdentity="stable-failure" errorMessage={locale === "en" ? "Controlled English error" : "受控中文错误"} />; }
  show(<ErrorView />); fireEvent.click(screen.getByRole("button", { name: "Not now" })); expect(screen.queryByTestId("rec-live-reconnect-dialog")).not.toBeInTheDocument(); swap(); expect(screen.queryByTestId("rec-live-reconnect-dialog")).not.toBeInTheDocument();
});
it("treats a prototype-named unknown startup failure as an ordinary generic error", async () => {
  api.open.mockRejectedValueOnce(Error("constructor")); show(<TranscriptionHistory uiState="default" />); fireEvent.click(await screen.findByTestId("rec-history-open-rec-raw")); await screen.findByTestId("rec-live-workspace"); fireEvent.click(screen.getByTestId("rec-live-toggle"));
  expect(await screen.findByTestId("rec-live-error")).toHaveTextContent("Live transcription could not start. Try again later."); swap(); expect(api.open).toHaveBeenCalledTimes(1);
});
