import * as React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { survey } from "@repo/contracts";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/locale";
import { FlexibleReportEditor } from "@/components/survey/report/template-editor";
const questions: survey.SurveyWorkflowQuestion[] = [
  { id: "raw-number", title: "原数值题 {count}", type: "number", order: 1, chapterId: "raw-chapter", required: false, options: [] },
  { id: "raw-group", title: "原分组题 {name}", type: "single", order: 2, chapterId: "raw-chapter", required: false, options: ["原甲", "Raw B"], config: { optionIds: ["raw-a", "raw-b"] } },
];
const template: survey.SurveyReportTemplate = { id: "raw-template", title: "原报告标题 {count}", sections: [
  { id: "raw-section-a", title: "原第一章 {count}", blocks: [{ id: "raw-data", title: "原数据标题 {name}", type: "table", questionIds: ["raw-number"], statistic: "mean", samplePolicy: "valid", minGroupSize: 5, caption: "原图注 {count}" }] },
  { id: "raw-section-b", title: "原第二章 {name}", blocks: [{ id: "raw-text", title: "原正文标题 {count}", type: "text", text: "原正文 {name}", questionIds: [], statistic: "mean", samplePolicy: "valid", minGroupSize: 5 }] },
] };
let setLocale: (locale: Locale) => void;
function Driver() { setLocale = useI18n().setLocale; return null; }
function language(locale: Locale) { act(() => setLocale(locale)); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function showEditor(initial = template, readonly = false) {
  const changed = vi.fn();
  function Harness() { const [value, setValue] = React.useState(() => structuredClone(initial)); return <><FlexibleReportEditor template={value} questions={questions} responses={[]} readonly={readonly} onChange={next => { changed(next); setValue(next); }} /><output data-testid="raw-template">{JSON.stringify(value)}</output></>; }
  const view = render(<I18nProvider initialLocale="zh-CN"><Driver /><Harness /></I18nProvider>);
  return { ...view, changed, value: () => JSON.parse(screen.getByTestId("raw-template").textContent!) as survey.SurveyReportTemplate };
}
beforeEach(() => { vi.spyOn(window, "confirm").mockReturnValue(false); vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("retains the selected chapter and authored body, focus and selection without saving on locale change", () => {
  const { value, changed } = showEditor(); fireEvent.click(screen.getByRole("button", { name: /^2\. 原第二章/ })); const field = screen.getByRole("textbox", { name: "正文" }) as HTMLTextAreaElement;
  fireEvent.change(field, { target: { value: "用户原正文 {count}" } }); field.focus(); field.setSelectionRange(2, 6); const before = value(), calls = changed.mock.calls.length; language("en");
  expect(screen.getByRole("textbox", { name: "Body" })).toBe(field); expect(field).toHaveValue("用户原正文 {count}"); expect(field).toHaveFocus(); expect([field.selectionStart, field.selectionEnd]).toEqual([2, 6]);
  expect(screen.getByRole("button", { name: /^2\. 原第二章/ })).toHaveAttribute("aria-current", "true"); expect(screen.getByRole("textbox", { name: "Report title" })).toHaveValue(template.title); expect(value()).toEqual(before); expect(changed).toHaveBeenCalledTimes(calls);
});
it("keeps canonical statistic, grouping and sample-policy values while translating their controls", () => {
  const { value, changed } = showEditor(); const block = screen.getByTestId("template-block-raw-data"), statistic = within(block).getByRole("combobox", { name: "统计口径" }); language("en");
  expect(within(block).getByRole("combobox", { name: "Statistic" })).toBe(statistic); expect(statistic).toHaveValue("mean"); expect(within(block).getByRole("option", { name: "Mean" })).toHaveValue("mean");
  expect(within(block).getByRole("combobox", { name: "Sample range" })).toHaveValue("valid"); expect(within(block).getByRole("spinbutton", { name: "Minimum group sample" })).toHaveValue(5); expect(changed).not.toHaveBeenCalled();
  fireEvent.change(statistic, { target: { value: "count" } }); fireEvent.change(within(block).getByRole("combobox", { name: "Grouping question" }), { target: { value: "raw-group" } }); fireEvent.change(within(block).getByRole("combobox", { name: "Sample range" }), { target: { value: "all" } });
  expect(value().sections[0]!.blocks[0]).toMatchObject({ id: "raw-data", questionIds: ["raw-number"], statistic: "count", groupByQuestionId: "raw-group", samplePolicy: "all", minGroupSize: 5, title: "原数据标题 {name}" });
});
it("retains read-only restrictions and raw fields in both languages", () => {
  const { changed, value } = showEditor(template, true); language("en"); expect(screen.getByRole("textbox", { name: "Report title" })).toHaveProperty("readOnly", true); expect(screen.getByRole("textbox", { name: "Content title" })).toHaveProperty("readOnly", true);
  expect(screen.queryByRole("button", { name: "Add chapter" })).not.toBeInTheDocument(); expect(screen.queryByRole("button", { name: "Copy chapter" })).not.toBeInTheDocument(); expect(screen.getByRole("combobox", { name: "Statistic" })).toBeDisabled(); expect(value()).toEqual(template); expect(changed).not.toHaveBeenCalled();
});
it("localizes new chapter defaults only at the explicit creation action", () => {
  const { value, changed } = showEditor(); language("en"); expect(changed).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "Add chapter" }));
  expect(screen.getByRole("textbox", { name: "Chapter title" })).toHaveValue("New chapter"); const created = value().sections[2]!; expect(created.id).not.toBe(template.sections[0]!.id); language("zh-CN"); expect(screen.getByRole("textbox", { name: "章节标题" })).toHaveValue("New chapter"); expect(value().sections[0]).toEqual(template.sections[0]);
});
it("copies a raw chapter independently and localizes only its new copy suffix", () => {
  const { value } = showEditor(); fireEvent.click(screen.getByRole("button", { name: /^2\. 原第二章/ })); language("en"); fireEvent.click(screen.getByRole("button", { name: "Copy chapter" }));
  const copied = value().sections[2]!; expect(copied.title).toBe("原第二章 {name} copy"); expect(copied.id).not.toBe(template.sections[1]!.id); expect(copied.blocks[0]!.id).not.toBe(template.sections[1]!.blocks[0]!.id); expect(copied.blocks[0]!.text).toBe("原正文 {name}");
  fireEvent.change(screen.getByRole("textbox", { name: "Body" }), { target: { value: "独立新正文 {count}" } }); expect(value().sections[1]).toEqual(template.sections[1]); language("zh-CN"); expect(screen.getByRole("textbox", { name: "章节标题" })).toHaveValue("原第二章 {name} copy");
});
const blockTypes: [survey.SurveyReportBlock["type"], string][] = [["text", "Text note"], ["metric", "Metric card"], ["table", "Data table"], ["bar", "Bar chart"], ["radar", "Radar chart"], ["line", "Time trend"], ["gap", "Gap matrix"], ["image", "Image"], ["page-break", "Page break"]];
it.each(blockTypes)("creates %s with canonical identity and an English default only when explicitly added", (type, label) => {
  const initial = { ...template, sections: [{ id: "raw-empty", title: "原空章节 {count}", blocks: [] }] }; const { value, changed } = showEditor(initial); language("en"); expect(changed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: `Add ${label}` })); const created = value().sections[0]!.blocks[0]!; expect(created).toMatchObject({ type, title: label, statistic: "mean", samplePolicy: "valid", minGroupSize: 5, questionIds: [] }); expect(created.id).toBeTruthy();
  language("zh-CN"); expect(value().sections[0]!.blocks[0]).toEqual(created); expect(initial.sections[0]!.blocks).toEqual([]);
});
it("uses the current language for a late import confirmation, retaining the original parsed template and requiring explicit approval", async () => {
  const { value, changed } = showEditor(), pending = deferred<string>(), file = new File(["{}"], "原模板文件.json", { type: "application/json" }), text = vi.fn(() => pending.promise);
  Object.defineProperty(file, "text", { value: text }); fireEvent.change(screen.getByLabelText("导入模板文件"), { target: { files: [file] } }); language("en"); expect(window.confirm).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled();
  await act(async () => pending.resolve(JSON.stringify({ ...template, title: "原导入标题 {count}" })));
  expect(window.confirm).toHaveBeenCalledTimes(1); expect(window.confirm).toHaveBeenLastCalledWith("Import and replace the current template?"); expect(text).toHaveBeenCalledTimes(1); expect(value()).toEqual(template); expect(changed).not.toHaveBeenCalled();
});
it("retranslates a known invalid-template import error without reparsing or changing raw data", async () => {
  const { value, changed } = showEditor(), file = new File(["{}"], "原无效模板.json", { type: "application/json" }), text = vi.fn().mockResolvedValue("{}"); Object.defineProperty(file, "text", { value: text });
  await act(async () => fireEvent.change(screen.getByLabelText("导入模板文件"), { target: { files: [file] } })); expect(screen.getByRole("alert")).toHaveTextContent("模板格式不正确，请检查章节、内容块和数据配置"); language("en");
  expect(screen.getByRole("alert")).toHaveTextContent("Invalid template format. Check the chapters, blocks, and data configuration."); expect(text).toHaveBeenCalledTimes(1); expect(window.confirm).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled(); expect(value()).toEqual(template);
});
it("retains a real report preview across languages without changing the authored template", () => {
  const { value, changed } = showEditor(); fireEvent.click(screen.getByRole("button", { name: "预览完整报告" })); const document = screen.getByTestId("survey-report-document"); language("en");
  expect(screen.getByTestId("survey-report-document")).toBe(document); expect(screen.getByRole("button", { name: "Back to editing" })).toBeVisible(); expect(within(document).getByRole("heading", { name: template.title })).toBeVisible(); expect(value()).toEqual(template); expect(changed).not.toHaveBeenCalled();
});
it("retains the original template file-size limit and translates its local refusal without reading or importing the file", async () => {
  const { value, changed } = showEditor(), file = new File(["x".repeat(1024 * 1024 + 1)], "原大模板.json", { type: "application/json" }), text = vi.fn().mockResolvedValue("{}"); Object.defineProperty(file, "text", { value: text });
  await act(async () => fireEvent.change(screen.getByLabelText("导入模板文件"), { target: { files: [file] } })); expect(screen.getByRole("alert")).toHaveTextContent("模板文件不能超过 1 MB"); language("en");
  expect(screen.getByRole("alert")).toHaveTextContent("Template files must be 1 MB or smaller."); expect(text).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled(); expect(value()).toEqual(template);
});
it("exports the exact raw template JSON and canonical filename in both languages", async () => {
  const descriptors = { create: Object.getOwnPropertyDescriptor(URL, "createObjectURL"), revoke: Object.getOwnPropertyDescriptor(URL, "revokeObjectURL") }, blobs: Blob[] = [], names: string[] = [];
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn((blob: Blob) => { blobs.push(blob); return "blob:raw-template"; }) }); Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
  const read = (blob: Blob) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsText(blob); });
  try {
    const { changed } = showEditor(); vi.useFakeTimers(); fireEvent.click(screen.getByRole("button", { name: "导出模板" })); act(() => vi.runAllTimers()); vi.useRealTimers(); expect(await read(blobs[0]!)).toBe(JSON.stringify(template, null, 2)); language("en");
    vi.useFakeTimers(); fireEvent.click(screen.getByRole("button", { name: "Export template" })); act(() => vi.runAllTimers()); vi.useRealTimers(); expect(await read(blobs[1]!)).toBe(JSON.stringify(template, null, 2)); expect(names).toEqual(["report-template.json", "report-template.json"]); expect(changed).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers(); if (descriptors.create) Object.defineProperty(URL, "createObjectURL", descriptors.create); else delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
    if (descriptors.revoke) Object.defineProperty(URL, "revokeObjectURL", descriptors.revoke); else delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
  }
});
