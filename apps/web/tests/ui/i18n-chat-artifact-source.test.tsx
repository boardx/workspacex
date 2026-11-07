import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
const api = vi.hoisted(() => vi.fn());
vi.mock("@/lib/live-chat", () => ({ getThreadArtifactSource: api }));
vi.mock("@/components/chat/markdown-message", () => ({ MarkdownMessage: ({ text }: { text: string }) => <pre data-testid="raw-artifact-markdown">{text}</pre> }));
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { ChatArtifactView } from "@/components/chat/chat-artifact-view";
import { ApiError } from "@/lib/api-client";
function LocaleControl() { const { setLocale } = useI18n(); return <button onClick={() => setLocale("zh-CN")}>switch language</button>; }
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("keeps the original source request and exact loaded version through an in-flight locale change", async () => {
  const raw = "# 模型原文 {version}\nconst text = '用户代码';";
  let resolve!: (value: { markdown: string; version: number; savedAt: string }) => void;
  api.mockReturnValue(new Promise(done => { resolve = done; })); const loaded = vi.fn();
  render(<I18nProvider initialLocale="en"><LocaleControl /><ChatArtifactView threadId="raw-thread" projectId="raw-project" artifactId="raw-artifact" bearer="unit-bearer" onLoaded={loaded} /></I18nProvider>);
  expect(screen.getByTestId("chat-artifact-preview-loading").textContent).toBe("Loading artifact…");
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(api).toHaveBeenCalledTimes(1); expect(api).toHaveBeenCalledWith("raw-thread", "raw-artifact", "raw-project", "unit-bearer");
  const value = { markdown: raw, version: 7, savedAt: "2026-11-04T00:00:00Z" };
  await act(async () => { resolve(value); });
  expect(screen.getByTestId("raw-artifact-markdown").textContent).toBe(raw); expect(loaded).toHaveBeenLastCalledWith(value);
  expect(screen.getByTestId("chat-artifact-preview-content").textContent).toContain("版本 7"); expect(api).toHaveBeenCalledTimes(1);
});
it("re-renders a persisted structured visibility failure without retrying or exposing internal details", async () => {
  api.mockRejectedValue(new ApiError(404, "NOT_VISIBLE", { debug: "private internal detail" }));
  render(<I18nProvider initialLocale="en"><LocaleControl /><ChatArtifactView threadId="raw-thread" projectId={null} artifactId="raw-artifact" bearer={undefined} /></I18nProvider>);
  const failure = await screen.findByTestId("chat-artifact-preview-error");
  expect(failure.textContent).toBe("You cannot view this artifact: it may be someone else's draft or may have been deleted");
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByTestId("chat-artifact-preview-error")).toBe(failure); expect(failure.textContent).toBe("这份产物你现在看不到：可能是别人的草稿，也可能已经被删掉");
  expect(failure.textContent).not.toContain("private internal detail"); expect(api).toHaveBeenCalledTimes(1);
});
