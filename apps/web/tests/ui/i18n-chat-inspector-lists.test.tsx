import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { ChatMaterialsPanel } from "@/components/chat/chat-materials-panel";
import { ChatArtifactsPanel } from "@/components/chat/chat-artifacts-panel";
import { onOpenFileInRightPanel } from "@/lib/chat-workbench/panel-document";
import type { ListThreadAttachmentsOut, ListThreadArtifactsOut } from "@/lib/live-chat";
function LocaleControl() { const { setLocale } = useI18n(); return <button onClick={() => setLocale("zh-CN")}>switch language</button>; }
afterEach(cleanup);
const material: ListThreadAttachmentsOut["items"][number] = { id: "raw-row", messageId: "raw-human-message", filename: "用户文件 {count}.pdf", mime: "application/pdf", bytes: 1024, createdAt: "2026-11-04T00:00:00Z" };
it("keeps material row identity, shared pending counts and explicit open payload across locale", () => {
  const onOpen = vi.fn(); const stop = onOpenFileInRightPanel(onOpen);
  try {
    render(<I18nProvider initialLocale="en"><LocaleControl /><ChatMaterialsPanel uploadCtl={null} hasSelection threadId="raw-thread" materials={{ items: [material] }} loading={false} error={null} onRetry={vi.fn()} uploadingCount={1} pendingCount={2} /></I18nProvider>);
    const row = screen.getByTestId("chat-material-raw-row");
    expect(screen.getByRole("heading", { name: "Materials (1)" })).toBeTruthy();
    expect(screen.getByTestId("chat-materials-uploading-count").textContent).toContain("Uploading 1 file");
    expect(screen.getByTestId("chat-materials-pending-count").textContent).toContain("2 attachments added to the next message");
    expect(row.textContent).toContain(material.filename);
    fireEvent.click(screen.getByRole("button", { name: "switch language" }));
    expect(screen.getByTestId("chat-material-raw-row")).toBe(row); expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith({ id: "material:raw-row", title: material.filename, threadId: "raw-thread", attachmentId: "raw-row", mime: material.mime });
  } finally { stop(); }
});
it("renders selection, loading and retry chrome without changing caller-owned failure text", () => {
  const retry = vi.fn();
  const app = (hasSelection: boolean, loading: boolean, error: string | null) => <I18nProvider initialLocale="en"><ChatMaterialsPanel uploadCtl={null} hasSelection={hasSelection} threadId={null} materials={null} loading={loading} error={error} onRetry={retry} /></I18nProvider>;
  const view = render(app(false, false, null));
  expect(screen.getByTestId("chat-materials-no-selection").textContent).toContain("Select a conversation");
  view.rerender(app(true, true, "错误原文 {reason}"));
  expect(within(screen.getByTestId("chat-task-workbench-skeleton")).getByText("Loading materials")).toBeTruthy();
  expect(screen.getByTestId("chat-materials-error").textContent).toContain("错误原文 {reason}");
  expect(retry).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "Retry" })); expect(retry).toHaveBeenCalledTimes(1);
});
it("keeps artifact source/version and exact explicit-open identity while translating list chrome", () => {
  const item: ListThreadArtifactsOut["items"][number] = { artifactId: "raw-artifact", title: "模型产物 {title}", mode: "live", pinnedBy: null, pinnedAt: null, version: 2, messageId: "raw-message", hasSource: true };
  const open = vi.fn(); const retry = vi.fn();
  render(<I18nProvider initialLocale="en"><LocaleControl /><ChatArtifactsPanel hasSelection artifacts={{ items: [item] }} loading={false} error={null} onRetry={retry} onOpen={open} /></I18nProvider>);
  const row = screen.getByTestId("chat-artifact-raw-artifact");
  expect(screen.getByRole("heading", { name: "Artifact preview (1)" })).toBeTruthy();
  expect(within(row).getByText("Live")).toBeTruthy(); expect(row.textContent).toContain("Source attached · Version 2");
  expect(row.textContent).toContain(item.title);
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByTestId("chat-artifact-raw-artifact")).toBe(row); expect(open).not.toHaveBeenCalled(); expect(retry).not.toHaveBeenCalled();
  fireEvent.click(row); expect(open).toHaveBeenCalledTimes(1); expect(open).toHaveBeenCalledWith(item);
});
