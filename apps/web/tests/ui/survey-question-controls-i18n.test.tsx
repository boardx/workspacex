import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createSurveyQuestion, type SurveyWorkflowQuestion, type SurveyAnswerValue } from "@repo/contracts/survey-question-types";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/locale";
import { SurveyQuestionEditor } from "@/components/survey/live/question-editor";
import { SurveyQuestionSettings } from "@/components/survey/live/question-settings";
import { SurveyQuestionRenderer } from "@/components/survey/live/question-renderer";
import { QuestionMaterial, type SurveyUpload, type SurveyRemoveUpload } from "@/components/survey/live/question-material";

const rawTitle = "原题 {count}";
function question(patch: Partial<SurveyWorkflowQuestion> = {}): SurveyWorkflowQuestion {
  return { ...createSurveyQuestion("single", "raw-q", 1), title: rawTitle,
    options: ["原选项 {count}", "第二原选项"], config: { optionIds: ["raw-a", "raw-b"] }, ...patch };
}
let setLocale: (locale: Locale) => void;
function Driver() { setLocale = useI18n().setLocale; return null; }
function show(children: React.ReactNode, locale: Locale = "zh-CN") { return render(<I18nProvider initialLocale={locale}><Driver />{children}</I18nProvider>); }
function language(locale: Locale) { act(() => setLocale(locale)); }
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function Settings({ initial, changed, before = [], after = [] }: {
  initial: SurveyWorkflowQuestion; changed: (q: SurveyWorkflowQuestion) => void;
  before?: SurveyWorkflowQuestion[]; after?: SurveyWorkflowQuestion[];
}) {
  const [value, setValue] = React.useState(initial);
  return <SurveyQuestionSettings question={value} questions={[...before, value, ...after]} onChange={next => { changed(next); setValue(next); }} />;
}
function Answer({ initial, value, changed }: { initial: SurveyWorkflowQuestion; value?: SurveyAnswerValue; changed: (value: SurveyAnswerValue) => void }) {
  const [answer, setAnswer] = React.useState(value);
  return <SurveyQuestionRenderer question={initial} value={answer} onChange={next => { changed(next); setAnswer(next); }} />;
}

it("keeps a bulk option draft and stable option IDs while localizing its controls", () => {
  const changed = vi.fn(); show(<Settings initial={question()} changed={changed} />);
  fireEvent.click(screen.getByText("批量粘贴选项"));
  const field = screen.getByRole("textbox", { name: "批量选项，每行一个" });
  fireEvent.change(field, { target: { value: "用户选项 {count}\nSecond raw option" } }); language("en");
  expect(screen.getByRole("textbox", { name: "Bulk options, one per line" })).toBe(field);
  expect(field).toHaveValue("用户选项 {count}\nSecond raw option"); expect(changed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Apply options" }));
  expect(changed).toHaveBeenCalledTimes(1);
  expect(changed.mock.calls[0]![0]).toMatchObject({ options: ["用户选项 {count}", "Second raw option"], config: { optionIds: ["raw-a", "raw-b"] } });
});

it("keeps raw matrix labels and adds only a new current-language row on explicit action", () => {
  vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001");
  const changed = vi.fn();
  show(<Settings initial={question({ type: "matrix_single", config: { optionIds: ["raw-a", "raw-b"], rows: [{ id: "row-raw", label: "原矩阵行 {count}", required: true }] } })} changed={changed} />);
  const field = screen.getByRole("textbox", { name: "矩阵行 1" }); language("en");
  expect(screen.getByRole("textbox", { name: "Matrix row 1" })).toBe(field); expect(field).toHaveValue("原矩阵行 {count}");
  expect(changed).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "Add matrix row" }));
  expect(changed.mock.calls[0]![0].config.rows).toEqual([{ id: "row-raw", label: "原矩阵行 {count}", required: true }, { id: "00000000-0000-4000-8000-000000000001", label: "New matrix row", required: true }]);
  language("zh-CN"); expect(changed).toHaveBeenCalledTimes(1);
});

it("localizes rule operators without changing raw references, answers or jump enums", () => {
  const before = question({ id: "raw-before", title: "原前题", config: { optionIds: ["before-a", "before-b"] } });
  const after = question({ id: "raw-after", order: 3, title: "原后题" });
  const changed = vi.fn();
  show(<Settings before={[before]} after={[after]} initial={question({ order: 2, type: "multi", config: {
    optionIds: ["raw-a", "raw-b"], visibleWhen: [{ questionId: "raw-before", operator: "equals", value: "before-a" }], jumpTo: [{ optionId: "raw-a", targetId: "raw-after" }],
  } })} changed={changed} />);
  fireEvent.click(screen.getByText("高级规则")); language("en");
  expect(screen.getByRole("combobox", { name: "Condition question 1" })).toHaveValue("raw-before");
  expect(screen.getByRole("combobox", { name: "Condition operator 1" })).toHaveValue("equals");
  expect(screen.getByRole("textbox", { name: "Condition answer 1" })).toHaveValue("before-a");
  expect(screen.getByRole("combobox", { name: "Jump option 1" })).toHaveValue("raw-a");
  expect(screen.getByRole("combobox", { name: "Jump target 1" })).toHaveValue("raw-after");
  expect(changed).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("combobox", { name: "Condition operator 1" }), { target: { value: "includes" } });
  expect(changed.mock.calls[0]![0].config).toMatchObject({ visibleWhen: [{ questionId: "raw-before", operator: "includes", value: "before-a" }], jumpTo: [{ optionId: "raw-a", targetId: "raw-after" }] });
});

it("retains raw image URL/alt and upload-format choices when only chrome changes", () => {
  const changed = vi.fn();
  show(<Settings initial={question({ type: "image_single", config: { optionIds: ["raw-a", "raw-b"], images: { "raw-a": { url: "https://example.test/raw.png", alt: "原图片 {count}" } } } })} changed={changed} />);
  const alt = screen.getByRole("textbox", { name: "图片替代文字 raw-a" }); language("en");
  expect(screen.getByRole("textbox", { name: "Image alternative text raw-a" })).toBe(alt);
  expect(alt).toHaveValue("原图片 {count}");
  expect(screen.getByRole("textbox", { name: "Image URL raw-a" })).toHaveValue("https://example.test/raw.png");
  expect(changed).not.toHaveBeenCalled();
});

const invalidConfigurations: [Partial<SurveyWorkflowQuestion>, string, string][] = [
  [{ title: " " }, "请填写题目标题", "Enter a question title."],
  [{ options: ["only"], config: { optionIds: ["one"] } }, "至少配置两个选项", "Configure at least two options."],
  [{ config: { optionIds: ["same", "same"] } }, "选项 ID 必须唯一且不能使用保留 ID", "Option IDs must be unique and cannot use reserved IDs."],
  [{ config: { optionIds: ["one"] } }, "选项 ID 与选项数量不一致", "Option IDs must match the number of options."],
  [{ options: ["原选项", "原选项"] }, "选项文字不能重复", "Option text must be unique."],
  [{ options: [" ", "原选项"] }, "选项不能为空", "Options cannot be empty."],
  [{ type: "number", options: [], config: { min: 2, max: 1 } }, "数值下限不能超过上限", "Number minimum cannot exceed its maximum."],
  [{ type: "short", options: [], config: { minLength: 3, maxLength: 2 } }, "文字长度下限不能超过上限", "Text length minimum cannot exceed its maximum."],
  [{ type: "multi", config: { optionIds: ["raw-a", "raw-b"], minSelections: 2, maxSelections: 1 } }, "选择数量下限不能超过上限", "Minimum selections cannot exceed maximum selections."],
  [{ type: "multi", config: { optionIds: ["raw-a", "raw-b"], maxSelections: 3 } }, "最大选择数不能超过选项数", "Maximum selections cannot exceed the option count."],
  [{ type: "multi", config: { optionIds: ["raw-a", "raw-b"], minSelections: 3 } }, "最小选择数不能超过选项数", "Minimum selections cannot exceed the option count."],
  [{ type: "multi", config: { optionIds: ["raw-a", "raw-b"], exclusiveOptionIds: ["absent"] } }, "互斥选项引用不存在", "An exclusive option reference does not exist."],
  [{ type: "scale", options: ["1", "2"], config: { other: true, optionIds: ["one", "two"] } }, "此题型不支持其他选项", "This question type does not support an Other option."],
  [{ type: "matrix_single", config: { optionIds: ["raw-a", "raw-b"], rows: [{ id: "same", label: "原行一" }, { id: "same", label: "原行二" }] } }, "矩阵行标识必须唯一且名称不能为空", "Matrix row IDs must be unique and names must not be empty."],
  [{ type: "address", options: [], config: { fields: [{ id: "same", label: "原字段一" }, { id: "same", label: "原字段二" }] } }, "字段标识必须唯一且名称不能为空", "Field IDs must be unique and names must not be empty."],
  [{ type: "matrix_single", config: { optionIds: ["raw-a", "raw-b"], rows: [] } }, "至少配置一行矩阵", "Configure at least one matrix row."],
  [{ type: "multiple_text", options: [], config: { fields: [] } }, "至少配置一个字段", "Configure at least one field."],
  [{ type: "cascade", options: [], config: { cascadePaths: [] } }, "级联路径不能为空且不能重复", "Cascading paths must be nonempty and unique."],
  [{ type: "scale", options: ["bad", "2"], config: { optionIds: ["one", "two"] } }, "量表选项必须是有效数字", "Scale options must be valid numbers."],
  [{ type: "nps", options: [], config: { min: 1, max: 10, step: 1 } }, "NPS 必须使用 0 至 10 的整数", "NPS must use integers from 0 to 10."],
  [{ type: "rating", options: [], config: { min: 1, max: 1 } }, "评分范围必须有不同的最小值和最大值", "The rating range must have different minimum and maximum values."],
  [{ type: "image_single" }, "请为每个图片选项配置图片和替代文字", "Provide an image and alternative text for every image option."],
  [{ type: "image_single", config: { optionIds: ["raw-a", "raw-b"], images: { "raw-a": { url: "http://example.test/raw.png", alt: "原图一" }, "raw-b": { url: "https://example.test/raw.png", alt: "原图二" } } } }, "图片需有效选项、HTTPS/站内地址和替代文字", "Images need a valid option, an HTTPS or same-site URL, and alternative text."],
  [{ type: "allocation", config: { optionIds: ["raw-a", "raw-b"], min: 0 } }, "请设置分配总额", "Set an allocation total."],
  [{ type: "description", options: [], config: {}, required: true }, "页面元素不能设为必答", "Page elements cannot be required."],
  [{ type: "number", options: [], config: { step: 0 } }, "题目配置格式不正确", "Question configuration is invalid."],
];
it.each(invalidConfigurations)("renders canonical configuration diagnostics in the active language: %s", (patch, source, translated) => {
  // Deliberately invalid duplicate-ID fixtures exercise canonical diagnostics;
  // account for React's expected duplicate-key warning without hiding other errors.
  const expectedWarning = (message: unknown, ...args: unknown[]) => typeof message === "string" && message.startsWith("Warning: Encountered two children with the same key") && args[0] === "same";
  const errors = vi.spyOn(console, "error").mockImplementation((message, ...args) => {
    if (!expectedWarning(message, ...args)) throw new Error(`Unexpected React error: ${String(message)}`);
  });
  show(<SurveyQuestionEditor questions={[question(patch)]} onChange={vi.fn()} />);
  const messages = screen.getByRole("list", { name: "配置检查" });
  expect(messages).toHaveTextContent(source); language("en"); expect(messages).toHaveTextContent(translated);
  expect(errors.mock.calls.every(([message, ...args]) => expectedWarning(message, ...args))).toBe(true);
});

it("localizes Other chrome while submitting the original reserved choice ID and raw explanation", () => {
  const changed = vi.fn(); show(<Answer initial={question({ config: { optionIds: ["raw-a", "raw-b"], other: true } })} changed={changed} />, "en");
  fireEvent.click(screen.getByRole("radio", { name: "Other" }));
  fireEvent.change(screen.getByRole("textbox", { name: "原题 {count}: Other details" }), { target: { value: "原始补充 {name}" } }); language("zh-CN");
  expect(screen.getByRole("textbox", { name: "原题 {count}：其他说明" })).toHaveValue("原始补充 {name}");
  expect(changed).toHaveBeenCalledTimes(2);
  expect(changed.mock.calls[1]![0]).toEqual({ selected: "__other__", other: "原始补充 {name}" });
});

it("retains structured raw row labels, answers and field DOM across language changes", () => {
  const changed = vi.fn(); show(<Answer initial={question({ type: "matrix_input", options: [], config: { rows: [{ id: "raw-row", label: "原行 {name}" }] } })} changed={changed} />);
  const field = screen.getByRole("textbox", { name: "原题 {count}：原行 {name}" });
  fireEvent.change(field, { target: { value: "原答案 {count}" } }); language("en");
  expect(screen.getByRole("textbox", { name: "原题 {count}: 原行 {name}" })).toBe(field);
  expect(field).toHaveValue("原答案 {count}"); expect(changed).toHaveBeenCalledTimes(1);
  expect(changed.mock.calls[0]![0]).toEqual({ "raw-row": "原答案 {count}" });
});

it("localizes cascade level controls while keeping the authored path values", () => {
  const changed = vi.fn(); show(<Answer initial={question({ type: "cascade", options: [], config: { cascadePaths: [["原地区 {count}", "原城市 {name}"]] } })} changed={changed} />);
  fireEvent.change(screen.getByRole("combobox", { name: "原题 {count}：第 1 级" }), { target: { value: "原地区 {count}" } }); language("en");
  expect(screen.getByRole("combobox", { name: "原题 {count}: Level 1" })).toHaveValue("原地区 {count}");
  fireEvent.change(screen.getByRole("combobox", { name: "原题 {count}: Level 2" }), { target: { value: "原城市 {name}" } });
  expect(changed.mock.calls[1]![0]).toEqual(["原地区 {count}", "原城市 {name}"]);
});

it("localizes star labels without changing numeric answer strings or raw endpoints", () => {
  const changed = vi.fn(); show(<Answer initial={question({ type: "rating", options: [], config: { min: 1, max: 3, step: 1, lowLabel: "低分原文 {count}", highLabel: "高分原文" } })} changed={changed} />, "en");
  expect(screen.getByRole("radio", { name: "1 star" })).toBeVisible();
  fireEvent.click(screen.getByRole("radio", { name: "2 stars" })); language("zh-CN");
  expect(screen.getByRole("radio", { name: "2 星" })).toBeChecked();
  expect(screen.getByText("低分原文 {count}")).toBeVisible();
  expect(changed).toHaveBeenCalledTimes(1); expect(changed).toHaveBeenCalledWith("2");
});

it("keeps ranking IDs and row DOM when localizing movement and confirmation controls", () => {
  const changed = vi.fn(); show(<Answer initial={question({ type: "ranking" })} changed={changed} />, "en");
  const item = screen.getByRole("listitem", { name: "原选项 {count}, position 1" });
  fireEvent.click(screen.getByRole("button", { name: "Move down 原选项 {count}" }));
  expect(changed).toHaveBeenCalledWith(["raw-b", "raw-a"]); language("zh-CN");
  expect(screen.getByRole("listitem", { name: "原选项 {count}，第 2 位" })).toBe(item);
  expect(changed).toHaveBeenCalledTimes(1);
});

it("localizes slider and allocation status without changing raw units or arithmetic", () => {
  const sliderChanged = vi.fn(); const view = show(<Answer initial={question({ type: "slider", options: [], config: { min: 0, max: 100, unit: "原单位" } })} changed={sliderChanged} />, "en");
  expect(screen.getByText("Not selected. Drag the slider.")).toBeVisible();
  fireEvent.change(screen.getByRole("slider", { name: rawTitle }), { target: { value: "25" } }); language("zh-CN");
  expect(screen.getByText("25原单位")).toBeVisible(); expect(sliderChanged).toHaveBeenCalledWith("25");
  view.unmount(); const allocationChanged = vi.fn();
  show(<Answer initial={question({ type: "allocation", config: { optionIds: ["raw-a", "raw-b"], total: 100 } })} value={{ "raw-a": "40", "raw-b": "10" }} changed={allocationChanged} />, "en");
  expect(screen.getByText("Allocated: 50 · Remaining: 50")).toBeVisible();
  expect(allocationChanged).not.toHaveBeenCalled();
});

function Material({ upload, removeUpload, signature = false, changed }: { upload: SurveyUpload; removeUpload?: SurveyRemoveUpload; signature?: boolean; changed: (value: string[]) => void }) {
  const [value, setValue] = React.useState<string[]>([]);
  return <QuestionMaterial questionId="raw-q" signature={signature} value={value} onChange={next => { changed(next); setValue(next); }} upload={upload} removeUpload={removeUpload} />;
}
it("keeps a single pending upload and its raw name while translating busy/delete controls", async () => {
  let finish!: (value: { id: string; name: string }) => void;
  const upload = vi.fn(() => new Promise<{ id: string; name: string }>(resolve => { finish = resolve; }));
  const remove = vi.fn(async () => {}), changed = vi.fn();
  show(<Material upload={upload} removeUpload={remove} changed={changed} />);
  const file = new File(["原文件内容"], "原文件 {count}.pdf", { type: "application/pdf" });
  fireEvent.change(screen.getByLabelText("选择文件"), { target: { files: [file] } }); language("en");
  expect(screen.getByRole("status")).toHaveTextContent("Uploading. Please wait…");
  expect(screen.getByLabelText("Choose file")).toBeDisabled(); expect(upload).toHaveBeenCalledTimes(1);
  expect(upload).toHaveBeenCalledWith(file, "raw-q");
  await act(async () => finish({ id: "asset-raw", name: "原文件 {count}.pdf" }));
  expect(screen.getByText("原文件 {count}.pdf")).toBeVisible(); expect(changed).toHaveBeenCalledWith(["asset-raw"]);
  language("zh-CN"); language("en"); expect(upload).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Delete material" }));
  await waitFor(() => expect(remove).toHaveBeenCalledWith("asset-raw", "raw-q"));
});

it("retranslates an existing failed upload and retries the exact same File only explicitly", async () => {
  const upload = vi.fn().mockRejectedValueOnce(new Error("raw network diagnostic")).mockResolvedValueOnce({ id: "asset-raw", name: "原文件.pdf" });
  const changed = vi.fn(); show(<Material upload={upload} changed={changed} />);
  const file = new File(["原文"], "原文件.pdf"); fireEvent.change(screen.getByLabelText("选择文件"), { target: { files: [file] } });
  await screen.findByRole("alert"); language("en");
  expect(screen.getByRole("alert")).toHaveTextContent("Upload failed. The file has not been submitted. Try again.");
  expect(upload).toHaveBeenCalledTimes(1); expect(changed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Retry upload" }));
  await waitFor(() => expect(changed).toHaveBeenCalledWith(["asset-raw"]));
  expect(upload).toHaveBeenNthCalledWith(2, file, "raw-q");
});

it("keeps the same signature canvas and typed raw draft across locale changes", () => {
  const upload = vi.fn(), changed = vi.fn(); show(<Material signature upload={upload} changed={changed} />);
  expect(screen.getByText("可以手写或键入签名。签名不代表电子合同认证。", { exact: true })).toBeVisible();
  const canvas = screen.getByLabelText("手写签名画布，也可以使用下方键入签名");
  const field = screen.getByRole("textbox", { name: "键入签名" }); fireEvent.change(field, { target: { value: "原签名 {count}" } }); language("en");
  expect(screen.getByText("Draw or type a signature. A signature does not certify an electronic contract.", { exact: true })).toBeVisible();
  expect(screen.getByLabelText("Draw a signature, or type it below")).toBe(canvas);
  expect(screen.getByRole("textbox", { name: "Type signature" })).toBe(field); expect(field).toHaveValue("原签名 {count}");
  expect(screen.getByRole("button", { name: "Save signature" })).toBeEnabled();
  expect(upload).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled();
});

it.each(["image_single", "description"] as const)("keeps an incomplete %s image out of preview and renders repeated diagnostics without React errors", type => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const changed = vi.fn();
  const initial = type === "image_single" ? question({ type, config: { optionIds: ["raw-a", "raw-b"], images: {
    "raw-a": { url: "", alt: "空图一 {count}" }, "raw-b": { url: "", alt: "空图二 {name}" },
  } } }) : question({ type, required: false, options: [], config: { images: { description: { url: "", alt: "空图说明 {count}" } } } });
  show(<SurveyQuestionEditor studioLayout questions={[initial]} onChange={changed} />);
  expect.soft(screen.queryAllByRole("img", { name: /空图/ })).toHaveLength(0);
  const list = screen.getByRole("list", { name: "配置检查" });
  const rows = within(list).getAllByRole("listitem");
  expect(within(list).getAllByText("图片需有效选项、HTTPS/站内地址和替代文字")).toHaveLength(type === "image_single" ? 2 : 1);
  language("en");
  expect(within(list).getAllByText("Images need a valid option, an HTTPS or same-site URL, and alternative text.")).toHaveLength(type === "image_single" ? 2 : 1);
  expect(within(list).getAllByRole("listitem")).toEqual(rows);
  expect.soft(errors).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled();
});
