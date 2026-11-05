import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@/lib/live-chat", async original => ({ ...(await original<typeof import("@/lib/live-chat")>()), openCitation: calls.open }));
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { ThreadCitationsProvider, PersistedMessageCitationScope, CitationList } from "@/components/chat/message-citations";
import { MarkdownMessage } from "@/components/chat/markdown-message";
function SwitchLanguage() { const { setLocale } = useI18n(); return <button onClick={() => setLocale("zh-CN")}>switch language</button>; }
beforeEach(() => { calls.open.mockReset(); });
it("localizes a structured page anchor without replacing raw source/code or reporting another open", () => {
  const citations = [{ citationId: "raw-citation", index: 1, sourceFullName: "用户来源全称{count}🌍", anchor: { kind: "page" as const, page: 9, range: null, messageId: null } }];
  render(<I18nProvider initialLocale="en"><SwitchLanguage /><ThreadCitationsProvider messages={[{ id: "raw-message", citations }]}><PersistedMessageCitationScope messageId="raw-message"><MarkdownMessage text="原始正文 [1] 和代码 `x[1] {count}`" /><CitationList /></PersistedMessageCitationScope></ThreadCitationsProvider></I18nProvider>);
  const row = screen.getByTestId("chat-citation-row"); expect(row.textContent).toContain("Page 9"); expect(row.textContent).toContain(citations[0]!.sourceFullName);
  fireEvent.click(row); const detail = screen.getByTestId("chat-citation-anchor"); expect(detail.textContent).toContain("Document page"); const code = screen.getByText("x[1] {count}", { selector: "code" });
  expect(calls.open).toHaveBeenCalledTimes(1); expect(calls.open).toHaveBeenCalledWith("raw-citation");
  fireEvent.click(screen.getByRole("button", { name: "switch language" })); expect(screen.getByTestId("chat-citation-row")).toBe(row); expect(row.getAttribute("aria-expanded")).toBe("true"); expect(row.textContent).toContain("第 9 页");
  expect(screen.getByTestId("chat-citation-anchor")).toBe(detail); expect(screen.getByText("x[1] {count}", { selector: "code" })).toBe(code); expect(calls.open).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByTestId("chat-citation-marker")); expect(calls.open).toHaveBeenCalledTimes(1);
});
it("preserves a transcript's original range while translating only its location chrome", () => {
  const range = "00:01–00:05 {count}";
  const citations = [{ citationId: "raw-transcript-citation", index: 1, sourceFullName: "原始逐字稿🌍", anchor: { kind: "transcript" as const, page: null, range, messageId: null } }];
  render(<I18nProvider initialLocale="en"><SwitchLanguage /><ThreadCitationsProvider messages={[{ id: "raw-message", citations }]}><PersistedMessageCitationScope messageId="raw-message"><CitationList /></PersistedMessageCitationScope></ThreadCitationsProvider></I18nProvider>);
  fireEvent.click(screen.getByTestId("chat-citation-row")); const detail = screen.getByTestId("chat-citation-anchor"); expect(detail.textContent).toContain("Transcript timecode"); expect(detail.textContent).toContain(range);
  fireEvent.click(screen.getByRole("button", { name: "switch language" })); expect(screen.getByTestId("chat-citation-anchor")).toBe(detail); expect(detail.textContent).toContain(range); expect(calls.open).toHaveBeenCalledTimes(1); expect(calls.open).toHaveBeenCalledWith("raw-transcript-citation");
});
