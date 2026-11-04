import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { GuidedResearchPlanEditor } from "@/components/research-studio/guided-research-plan-editor";
import { ResearchFloatingAssistant } from "@/components/research-studio/research-floating-assistant";
import { GuidedResearchConversation } from "@/components/research-studio/guided-research-conversation";
import { GuidedResearchExecutionTimeline } from "@/components/research-studio/guided-research-execution-timeline";
import { ResearchChaptersWorkspace } from "@/components/research-studio/research-chapters-workspace";
import { GuidedResearchMarkdownWorkspace } from "@/components/research-studio/guided-research-markdown-workspace";
import { serializeGuidedResearchMarkdown } from "@/lib/guided-research-markdown";
import { runtimeFixture } from "../guided-runtime-fixture";
function Language() { const { setLocale } = useI18n(); return <><button onClick={() => setLocale("en")}>English test switch</button><button onClick={() => setLocale("zh-CN")}>中文测试切换</button></>; }
function show(children: React.ReactNode) { return render(<I18nProvider initialLocale="en"><Language />{children}</I18nProvider>); }
function change(locale: "en" | "zh-CN") { fireEvent.click(screen.getByText(locale === "en" ? "English test switch" : "中文测试切换")); }

it("keeps assistant focus and raw draft while localizing labels and prefilling the localized example without sending it", () => {
  const changeMessage = vi.fn(); const send = vi.fn(); const toggle = vi.fn();
  function Assistant() {
    const [draft, setDraft] = React.useState("原消息 {count}");
    return <ResearchFloatingAssistant open onOpenChange={toggle}><GuidedResearchConversation node="report" messages={[]} message={draft} onMessageChange={value => { changeMessage(value); setDraft(value); }} busy={false} processing={false} onSend={send} proposal={null} proposalEdited={false} onApply={vi.fn()} preview={null} embedded /></ResearchFloatingAssistant>;
  }
  show(<Assistant />);
  const close = screen.getByRole("button", { name: "Close research assistant" });
  expect(close).toHaveFocus();
  const input = screen.getByRole("textbox", { name: "Research conversation" });
  expect(input).toHaveValue("原消息 {count}");
  fireEvent.click(screen.getByRole("button", { name: "Improve the report summary and conclusions using the existing evidence, retaining citations" }));
  expect(changeMessage).toHaveBeenCalledWith("Improve the report summary and conclusions using the existing evidence, retaining citations");
  expect(send).not.toHaveBeenCalled();
  expect(input).toHaveValue("Improve the report summary and conclusions using the existing evidence, retaining citations");
  fireEvent.change(input, { target: { value: "原消息 {count}" } });
  change("zh-CN"); change("en"); expect(input).toHaveValue("原消息 {count}");
  fireEvent.compositionStart(input); fireEvent.keyDown(input, { key: "Enter" }); expect(send).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input); fireEvent.click(screen.getByRole("button", { name: "Send research message" }));
  expect(send).toHaveBeenCalledWith("原消息 {count}");
  fireEvent.keyDown(screen.getByRole("complementary", { name: "Research assistant" }), { key: "Escape" });
  expect(toggle).toHaveBeenCalledWith(false);
});

it("translates the execution projection while retaining raw active chapter titles and runtime bytes", () => {
  const state = runtimeFixture("report");
  const original = JSON.stringify(state);
  show(<GuidedResearchExecutionTimeline state={state} />);
  expect(screen.getByRole("heading", { name: "Research execution" })).toBeVisible();
  expect(screen.getByTestId("execution-search")).toHaveTextContent("Search material");
  change("zh-CN"); expect(screen.getByRole("heading", { name: "研究执行过程" })).toBeVisible();
  change("en"); expect(JSON.stringify(state)).toBe(original);
});

it("keeps a chapter draft and selection through locale changes and saves raw chapter text once", () => {
  const state = runtimeFixture("outline"); const save = vi.fn();
  show(<ResearchChaptersWorkspace runtime={state} disabled={false} onSave={save} onOptimize={vi.fn()} />);
  const input = screen.getByRole("textbox", { name: "Chapter title" });
  fireEvent.change(input, { target: { value: "中文章节 {count}" } });
  change("zh-CN"); change("en"); expect(input).toHaveValue("中文章节 {count}");
  fireEvent.click(screen.getByRole("button", { name: "Save chapter structure" }));
  expect(save).toHaveBeenCalledTimes(1); expect(save.mock.calls[0]![0][0].title).toBe("中文章节 {count}");
});

it("preserves raw Markdown during pending save and retranslates its controlled failure", async () => {
  const state = runtimeFixture("report");
  const document = serializeGuidedResearchMarkdown({ node: "report", report: state.report! });
  let finish!: (result: { ok: boolean }) => void;
  const save = vi.fn(() => new Promise<{ ok: boolean }>(resolve => { finish = resolve; }));
  show(<GuidedResearchMarkdownWorkspace document={document} initiallyEditing onSave={save} />);
  const input = screen.getByTestId("guided-research-markdown-editor");
  const raw = `${document.markdown}\n原始 Markdown {count}`;
  fireEvent.change(input, { target: { value: raw } });
  fireEvent.click(screen.getByRole("button", { name: "Save Markdown" }));
  change("zh-CN"); change("en"); expect(input).toHaveValue(raw); expect(save).toHaveBeenCalledTimes(1); expect(save).toHaveBeenCalledWith(raw);
  await act(async () => finish({ ok: false }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Markdown validation failed"));
  change("zh-CN"); expect(screen.getByRole("alert")).toHaveTextContent("Markdown 校验失败");
});

it.each(["en", "zh-CN"] as const)("%s prefills a new editable plan title once and preserves subsequent user edits", locale => {
  const state = runtimeFixture("outline"); const save = vi.fn().mockResolvedValue(true);
  show(<GuidedResearchPlanEditor value={state.outline} disabled={false} onSave={save} />);
  change(locale);
  fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Add plan" : "新增计划" }));
  const editor = screen.getByRole("textbox", { name: locale === "en" ? /^Plan / : /^计划 / });
  expect(editor).toHaveValue(locale === "en" ? "New plan" : "新计划");
  fireEvent.change(editor, { target: { value: "用户确认的计划原文" } });
  change(locale === "en" ? "zh-CN" : "en");
  expect(editor).toHaveValue("用户确认的计划原文"); expect(save).not.toHaveBeenCalled();
});

it.each(["en", "zh-CN"] as const)("%s prefills new chapter and subsection titles once without overwriting edits", locale => {
  const state = runtimeFixture("outline"); const save = vi.fn();
  show(<ResearchChaptersWorkspace runtime={state} disabled={false} onSave={save} onOptimize={vi.fn()} />);
  change(locale);
  fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Add chapter" : "新增章节" }));
  const title = screen.getByRole("textbox", { name: locale === "en" ? "Chapter title" : "章节标题" });
  expect(title).toHaveValue(locale === "en" ? "New chapter" : "新章节");
  fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Add subsection" : "新增小章节" }));
  const subsection = screen.getByRole("textbox", { name: locale === "en" ? /^Subsection / : /^小章节 / });
  expect(subsection).toHaveValue(locale === "en" ? "New subsection" : "新小章节");
  fireEvent.change(title, { target: { value: "用户章节原名" } });
  fireEvent.change(subsection, { target: { value: "用户小章节原名" } });
  change(locale === "en" ? "zh-CN" : "en");
  expect(title).toHaveValue("用户章节原名"); expect(subsection).toHaveValue("用户小章节原名");
  expect(save).not.toHaveBeenCalled();
});
