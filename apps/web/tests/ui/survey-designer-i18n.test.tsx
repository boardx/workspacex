import * as React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSurveyQuestion, type SurveyQuestionType, type SurveyWorkflowQuestion } from "@repo/contracts/survey-question-types";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/locale";
import { SurveyQuestionEditor } from "@/components/survey/live/question-editor";
import { MarkdownSurveyEditor } from "@/components/survey/live/markdown-survey-editor";
import { InlineQuestionText } from "@/components/survey/live/inline-question-text";
import { ResponsiveDesignerPanel } from "@/components/survey/live/responsive-designer-panel";

const rawTitle = "原始题干 {count}";
const rawChapter = "原章节 {name}";
const rawDescription = "原说明 {count}";
function authored(patch: Partial<SurveyWorkflowQuestion> = {}): SurveyWorkflowQuestion {
  return {
    ...createSurveyQuestion("single", "raw-q", 1), title: rawTitle, chapterId: rawChapter,
    options: ["原选项 {count}", "Other 原选项"],
    config: { optionIds: ["raw-a", "raw-b"], description: rawDescription }, ...patch,
  };
}
type EditorOptions = Omit<React.ComponentProps<typeof SurveyQuestionEditor>, "questions" | "onChange">;
function ControlledEditor({ initial = [authored()], changed, ...options }: EditorOptions & {
  initial?: SurveyWorkflowQuestion[]; changed: (value: SurveyWorkflowQuestion[]) => void;
}) {
  const [questions, setQuestions] = React.useState(initial);
  return <SurveyQuestionEditor {...options} questions={questions} onChange={next => { changed(next); setQuestions(next); }} />;
}
let setLocale: (locale: Locale) => void;
function Driver() { setLocale = useI18n().setLocale; return null; }
function show(children: React.ReactNode, locale: Locale = "zh-CN") {
  return render(<I18nProvider initialLocale={locale}><Driver />{children}</I18nProvider>);
}
function language(locale: Locale) { act(() => setLocale(locale)); }
beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const types = [
  ["single", "Single choice", "Choose one option"],
  ["multi", "Multiple choice", "Choose several options"],
  ["dropdown", "Dropdown", "Choose from a dropdown list"],
  ["image_single", "Image single choice", "Choose one image"],
  ["image_multi", "Image multiple choice", "Choose several images"],
  ["short", "Short text", "A brief text answer"],
  ["open", "Long text", "A detailed text answer"],
  ["multiple_text", "Multiple text fields", "Complete several fields separately"],
  ["number", "Number", "A number within a range"],
  ["date", "Date", "Choose a valid date"],
  ["time", "Time", "Choose a time of day"],
  ["datetime", "Date and time", "Enter a date and time"],
  ["email", "Email", "Enter an email address"],
  ["phone", "Phone", "Enter a contact phone number"],
  ["address", "Address", "Complete separate address fields"],
  ["cascade", "Cascading choice", "Choose a complete path level by level"],
  ["scale", "Scale", "Choose a scale value"],
  ["rating", "Star rating", "Rate satisfaction with stars"],
  ["nps", "NPS", "Likelihood to recommend from 0 to 10"],
  ["slider", "Slider", "Choose within a numeric range"],
  ["matrix_single", "Matrix single choice", "Choose one option per row"],
  ["matrix_multi", "Matrix multiple choice", "Choose several options per row"],
  ["matrix_scale", "Matrix scale", "Rate each row"],
  ["matrix_input", "Matrix text", "Enter text for each row"],
  ["matrix_dropdown", "Matrix dropdown", "Choose from a dropdown for each row"],
  ["ranking", "Ranking", "Arrange by priority"],
  ["allocation", "Allocation", "Allocate a fixed total"],
  ["file", "File upload", "Submit attachment references"],
  ["signature", "Signature", "Submit a signature image reference"],
  ["description", "Description text/image", "Description without an answer"],
  ["page_break", "Section and page break", "Split a long survey into pages"],
] as const satisfies readonly (readonly [SurveyQuestionType, string, string])[];

it.each(types)("translates %s metadata and creates only its new defaults without rewriting an authored question", (type, label, description) => {
  const nextId = "00000000-0000-4000-8000-000000000031";
  vi.spyOn(crypto, "randomUUID").mockReturnValue(nextId);
  const changed = vi.fn(); show(<ControlledEditor changed={changed} />);
  fireEvent.click(screen.getByRole("button", { name: "新增题目" })); language("en");
  const add = screen.getByTestId(`add-question-${type}`);
  expect(add).toHaveAccessibleName(expect.stringContaining(label));
  expect(add).toHaveTextContent(description);
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(add);
  expect(changed).toHaveBeenCalledTimes(1);
  const questions = changed.mock.calls[0]![0] as SurveyWorkflowQuestion[];
  expect(questions).toHaveLength(2);
  expect(questions[0]).toMatchObject({ id: "raw-q", type: "single", title: rawTitle, chapterId: rawChapter, options: ["原选项 {count}", "Other 原选项"] });
  expect(questions[1]).toMatchObject({ id: nextId, type, title: label, order: 2 });
  if (type === "single") {
    expect(questions[1]!.options).toEqual(["Option 1", "Option 2"]);
    expect(questions[1]!.config?.optionIds).toEqual([`${nextId}-option-1`, `${nextId}-option-2`]);
  }
  if (type === "matrix_single") expect(questions[1]!.config?.rows).toEqual([{ id: `${nextId}-row-1`, label: "Item 1" }, { id: `${nextId}-row-2`, label: "Item 2" }]);
  if (type === "address") expect(questions[1]!.config?.fields?.map(field => field.label)).toEqual(["Province/region", "City", "Street address"]);
  if (type === "cascade") expect(questions[1]!.config?.cascadePaths).toEqual([["Region 1", "City 1"], ["Region 1", "City 2"], ["Region 2", "City 3"]]);
  if (type === "scale") expect(questions[1]!.options).toEqual(["1", "2", "3", "4", "5"]);
  language("zh-CN");
  expect(changed).toHaveBeenCalledTimes(1);
  expect(questions[1]!.title).toBe(label);
});

it("retains an English type query and canonical category when switching back to Chinese", () => {
  const changed = vi.fn(); show(<ControlledEditor changed={changed} />);
  fireEvent.click(screen.getByRole("button", { name: "新增题目" })); language("en");
  fireEvent.click(screen.getByRole("button", { name: "Rating" }));
  const input = screen.getByRole("textbox", { name: "Search question types" });
  fireEvent.change(input, { target: { value: "slider" } }); language("zh-CN");
  expect(screen.getByRole("textbox", { name: "搜索题型" })).toBe(input);
  expect(input).toHaveValue("slider");
  expect(screen.getByRole("button", { name: "评分" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("add-question-slider")).toBeVisible();
  expect(changed).not.toHaveBeenCalled();
});

it("keeps the authored title editor, selection and canonical type/chapter across language changes", () => {
  const changed = vi.fn(); show(<ControlledEditor changed={changed} />);
  const title = screen.getByRole("textbox", { name: "问题内容" }) as HTMLTextAreaElement;
  fireEvent.change(title, { target: { value: "用户修改 {count}\n原文" } });
  title.focus(); title.setSelectionRange(2, 6); language("en");
  expect(screen.getByRole("textbox", { name: "Question content" })).toBe(title);
  expect(title).toHaveFocus(); expect(title).toHaveValue("用户修改 {count}\n原文");
  expect([title.selectionStart, title.selectionEnd]).toEqual([2, 6]);
  expect(screen.getByRole("combobox", { name: "Question type" })).toHaveValue("single");
  expect(screen.getByRole("textbox", { name: "Chapter" })).toHaveValue(rawChapter);
  expect(changed).toHaveBeenCalledTimes(1);
  expect(changed.mock.calls[0]![0][0].config).toEqual({ optionIds: ["raw-a", "raw-b"], description: rawDescription });
});

it("keeps a pending type confirmation and only changes canonical data after explicit confirmation", () => {
  const changed = vi.fn(); show(<ControlledEditor changed={changed} />);
  fireEvent.change(screen.getByRole("combobox", { name: "题型" }), { target: { value: "rating" } });
  const dialog = screen.getByRole("alertdialog", { name: "确认切换题型" }); language("en");
  expect(screen.getByRole("alertdialog", { name: "Confirm question type change" })).toBe(dialog);
  expect(dialog).toHaveTextContent("Star rating"); expect(dialog).toHaveTextContent("options (2)");
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel change" }));
  expect(changed).not.toHaveBeenCalled();
  expect(screen.getByRole("combobox", { name: "Question type" })).toHaveValue("single");
  fireEvent.change(screen.getByRole("combobox", { name: "Question type" }), { target: { value: "rating" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm change" }));
  expect(changed).toHaveBeenCalledTimes(1);
  expect(changed.mock.calls[0]![0][0]).toMatchObject({ id: "raw-q", type: "rating", title: rawTitle, chapterId: rawChapter, options: [], config: { description: rawDescription, min: 1, max: 5, step: 1 } });
});

it("keeps trial answers and pagination without emitting any question save across locales", () => {
  const changed = vi.fn();
  const questions = [
    authored({ type: "short", options: [], config: { maxLength: 200 } }),
    { ...createSurveyQuestion("page_break", "page", 2), title: "原分页" },
    authored({ id: "raw-second", order: 3, type: "dropdown", title: "原始第二题" }),
  ];
  show(<ControlledEditor studioLayout surveyTitle="原始问卷 {count}" initial={questions} changed={changed} />);
  fireEvent.click(screen.getByRole("button", { name: "试填问卷" }));
  fireEvent.change(screen.getByRole("textbox", { name: rawTitle }), { target: { value: "原始答案 {count}" } }); language("en");
  expect(screen.getByRole("region", { name: "Survey trial" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Trial mode" })).toBeVisible();
  expect(screen.getByRole("textbox", { name: rawTitle })).toHaveValue("原始答案 {count}");
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  fireEvent.change(screen.getByRole("combobox", { name: "原始第二题" }), { target: { value: "raw-b" } }); language("zh-CN");
  expect(screen.getByRole("combobox", { name: "原始第二题" })).toHaveValue("raw-b");
  fireEvent.click(screen.getByRole("button", { name: "上一页" }));
  expect(screen.getByRole("textbox", { name: rawTitle })).toHaveValue("原始答案 {count}");
  fireEvent.click(screen.getByRole("button", { name: "退出试填" }));
  expect(changed).not.toHaveBeenCalled();
});

it("retains device choice and undo history through locale changes", () => {
  const changed = vi.fn(); show(<ControlledEditor studioLayout changed={changed} />);
  const canvas = screen.getByRole("region", { name: "问卷设计画布" });
  fireEvent.click(within(canvas).getByRole("button", { name: "编辑第 1 题：原始题干 {count}" }));
  const input = within(canvas).getByRole("textbox", { name: "问题内容" });
  fireEvent.change(input, { target: { value: "用户新题干 {count}" } }); fireEvent.blur(input);
  fireEvent.click(screen.getByRole("button", { name: "手机预览" })); language("en");
  expect(screen.getByRole("button", { name: "Mobile preview" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Undo last change" })).toBeEnabled();
  expect(changed).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Undo last change" }));
  expect(changed).toHaveBeenCalledTimes(2);
  expect(changed.mock.calls[1]![0][0].title).toBe(rawTitle);
});

it("localizes overview controls while keeping authored content literal", () => {
  const changed = vi.fn(); show(<ControlledEditor overviewFirst changed={changed} />, "en");
  expect(screen.getByRole("heading", { name: "Survey at a glance" })).toBeVisible();
  expect(screen.getByRole("group", { name: "原始题干 {count} *" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Edit question 1" }));
  expect(screen.getByRole("textbox", { name: "Question content" })).toHaveValue(rawTitle);
  expect(changed).not.toHaveBeenCalled();
});

it("translates an empty inline field without resetting an active raw draft or focus", () => {
  function Field() { const [value, setValue] = React.useState(""); return <InlineQuestionText value={value} label="raw-label" onChange={setValue} />; }
  show(<Field />, "en");
  const reading = screen.getByRole("button", { name: "raw-label" }); expect(reading).toHaveTextContent("Untitled question");
  fireEvent.click(reading); const field = screen.getByRole("textbox", { name: "raw-label" }) as HTMLInputElement;
  fireEvent.change(field, { target: { value: "原字段 {count}" } }); field.setSelectionRange(1, 3); language("zh-CN");
  expect(screen.getByRole("textbox", { name: "raw-label" })).toBe(field);
  expect(field).toHaveFocus(); expect(field).toHaveValue("原字段 {count}"); expect([field.selectionStart, field.selectionEnd]).toEqual([1, 3]);
});

it("keeps a narrow panel and its controlled draft mounted during a locale change", () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  function Panel() { const [value, setValue] = React.useState(""); return <ResponsiveDesignerPanel title="原面板 {count}" enabled><input aria-label="raw-panel-field" value={value} onChange={event => setValue(event.target.value)} /></ResponsiveDesignerPanel>; }
  show(<Panel />); fireEvent.click(screen.getByRole("button", { name: "打开原面板 {count}" }));
  const dialog = screen.getByRole("dialog", { name: "原面板 {count}" });
  const field = within(dialog).getByRole("textbox", { name: "raw-panel-field" }); fireEvent.change(field, { target: { value: "原草稿 {name}" } }); language("en");
  expect(screen.getByRole("dialog", { name: "原面板 {count}" })).toBe(dialog);
  expect(dialog).toHaveTextContent("Changes update the current design. Closing this panel keeps your changes.");
  expect(within(dialog).getByRole("textbox", { name: "raw-panel-field" })).toBe(field); expect(field).toHaveValue("原草稿 {name}");
});

const markdown = "# 原问卷 {count}\n\n## raw [open]\n原题干 {name}\n";
function Markdown({ initial = markdown, changed, preview }: { initial?: string; changed: (value: string) => void; preview: () => void }) {
  const [value, setValue] = React.useState(initial);
  return <MarkdownSurveyEditor value={value} locked={false} onChange={next => { changed(next); setValue(next); }} onPreview={preview} />;
}
it("keeps reviewed Markdown and applies only after the explicit current-language action", () => {
  const changed = vi.fn(), preview = vi.fn(); show(<Markdown changed={changed} preview={preview} />);
  fireEvent.click(screen.getByRole("button", { name: "校对并预览题目" }));
  const editor = screen.getByRole("textbox", { name: "校对 Markdown" });
  const edited = markdown.replace("原题干", "用户改题干"); fireEvent.change(editor, { target: { value: edited } }); language("en");
  expect(screen.getByRole("textbox", { name: "Review Markdown" })).toBe(editor); expect(editor).toHaveValue(edited);
  expect(screen.getByRole("region", { name: "Rendered survey preview" })).toHaveTextContent("用户改题干 {name}");
  expect(preview).not.toHaveBeenCalled(); expect(changed).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Apply to survey" })); expect(preview).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("textbox", { name: "Survey Markdown" })).toHaveValue(edited);
});

it.each([
  ["# 原题\n\n## raw [constructor]\n原问题\n", "不支持的题型：constructor", "Unsupported question type: constructor"],
  ["# 原题\n\n## same [open]\n原问题一\n\n## same [open]\n原问题二\n", "题目编号重复：same", "Duplicate question ID: same"],
])("translates canonical parser diagnostic while retaining raw identifiers and blocking application: %s", (source, canonical, translated) => {
  const changed = vi.fn(), preview = vi.fn();
  show(<Markdown initial={source} changed={changed} preview={preview} />);
  fireEvent.click(screen.getByRole("button", { name: "校对并预览题目" }));
  const alert = within(screen.getByRole("dialog")).getByRole("alert");
  expect(alert).toHaveTextContent(canonical); language("en");
  expect(alert).toHaveTextContent(translated);
  expect(screen.getByRole("button", { name: "Apply to survey" })).toBeDisabled();
  expect(changed).not.toHaveBeenCalled(); expect(preview).not.toHaveBeenCalled();
});

it("retranslates a local Markdown file error without changing the source", () => {
  const changed = vi.fn(); show(<Markdown changed={changed} preview={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("上传 Markdown 文件"), { target: { files: [new File(["原文"], "原文件.pdf")] } }); language("en");
  expect(screen.getByRole("alert")).toHaveTextContent("Choose a Markdown file up to 256 KB.");
  expect(screen.getByRole("textbox", { name: "Survey Markdown" })).toHaveValue(markdown);
  expect(changed).not.toHaveBeenCalled();
});
