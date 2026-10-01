import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { createSurveyQuestion } from "@repo/contracts/survey-question-types";
import { SurveyQuestionEditor } from "@/components/survey/live/question-editor";
import { ResponsiveDesignerPanel } from "@/components/survey/live/responsive-designer-panel";

afterEach(() => vi.unstubAllGlobals());

it("keeps the selected question in reading mode until its title is clicked and exits editing on blur", () => {
  const first = { ...createSurveyQuestion("single", "q1", 1), title: "所属行业", options: ["制造业", "服务业"] };
  function Designer() {
    const [value, setValue] = React.useState([first]);
    return <SurveyQuestionEditor studioLayout questions={value} onChange={setValue} />;
  }
  render(<Designer />);
  const canvas = screen.getByRole("region", { name: "问卷设计画布" });
  expect(within(canvas).queryByRole("textbox", { name: "问题内容" })).not.toBeInTheDocument();
  fireEvent.click(within(canvas).getByRole("button", { name: "编辑第 1 题：所属行业" }));
  const title = within(canvas).getByRole("textbox", { name: "问题内容" });
  expect(title).toHaveFocus();
  fireEvent.change(title, { target: { value: "行业类型" } });
  fireEvent.blur(title);
  expect(within(canvas).queryByRole("textbox", { name: "问题内容" })).not.toBeInTheDocument();
  expect(within(canvas).getByRole("button", { name: "编辑第 1 题：行业类型" })).toBeInTheDocument();
  fireEvent.click(within(canvas).getByRole("button", { name: "编辑选项 1：制造业" }));
  const option = within(canvas).getByRole("textbox", { name: "选项 1" });
  fireEvent.change(option, { target: { value: "教育行业" } });
  fireEvent.blur(option);
  expect(within(canvas).getByRole("button", { name: "编辑选项 1：教育行业" })).toBeInTheDocument();
});

it("edits an unselected question without overwriting its neighbour and keeps contextual actions undoable", () => {
  function Designer() {
    const [value, setValue] = React.useState([
      { ...createSurveyQuestion("single", "q1", 1), title: "第一题", options: ["甲", "乙"] },
      { ...createSurveyQuestion("single", "q2", 2), title: "第二题", options: ["丙", "丁"] },
    ]);
    return <SurveyQuestionEditor studioLayout questions={value} onChange={setValue} />;
  }
  render(<Designer />);
  fireEvent.click(screen.getByRole("button", { name: "编辑选项 1：丙" }));
  fireEvent.change(screen.getByRole("textbox", { name: "选项 1" }), { target: { value: "改后的丙" } });
  fireEvent.blur(screen.getByRole("textbox", { name: "选项 1" }));
  expect(screen.getByRole("button", { name: "编辑选项 1：甲" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "编辑选项 1：改后的丙" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "复制第 2 题" }));
  expect(screen.getByRole("button", { name: "编辑第 3 题：第二题" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "删除第 3 题" }));
  expect(screen.queryByRole("button", { name: "编辑第 3 题：第二题" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "撤销最近修改" }));
  expect(screen.getByRole("button", { name: "编辑第 3 题：第二题" })).toBeInTheDocument();
});

it("disables portaled inputs while a save is in flight", () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  const view = render(<ResponsiveDesignerPanel title="题目设置" enabled disabled={false}><input aria-label="面板输入" /></ResponsiveDesignerPanel>);
  fireEvent.click(screen.getByRole("button", { name: "打开题目设置" }));
  expect(screen.getByRole("textbox", { name: "面板输入" })).toBeEnabled();
  view.rerender(<ResponsiveDesignerPanel title="题目设置" enabled disabled><input aria-label="面板输入" /></ResponsiveDesignerPanel>);
  expect(screen.getByRole("textbox", { name: "面板输入" })).toBeDisabled();
});

it("opens mobile outline/settings on demand without duplicating question content", () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  function Designer() {
    const [questions, setQuestions] = React.useState([
      { ...createSurveyQuestion("short", "q1", 1), title: "第一题" },
      { ...createSurveyQuestion("short", "q2", 2), title: "第二题" },
    ]);
    return <SurveyQuestionEditor studioLayout questions={questions} onChange={setQuestions} />;
  }
  render(<Designer />);
  fireEvent.click(screen.getByRole("button", { name: "打开题目大纲" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "题目大纲" })).getByRole("button", { name: "选择题目 2：第二题" }));
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  fireEvent.click(screen.getByRole("button", { name: "打开题目设置" }));
  const settings = screen.getByRole("dialog", { name: "题目设置" });
  expect(within(settings).queryByRole("textbox", { name: "问题内容" })).not.toBeInTheDocument();
  expect(within(settings).getByRole("combobox", { name: "题型" })).toHaveValue("short");
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
});

it("shows the prototype's question toolbox in the desktop designer", () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  render(<SurveyQuestionEditor studioLayout questions={[]} onChange={vi.fn()} />);
  expect(screen.getByRole("heading", { name: "题型工具箱" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^单选$/ })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "题目大纲" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "问卷设计画布" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "收起实时预览" })).not.toBeInTheDocument();
});

it("edits question content in the center canvas while the right panel only exposes settings", () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  const questions = [
    { ...createSurveyQuestion("single", "q1", 1), title: "所属行业", chapterId: "基本信息", options: ["制造业", "服务业"] },
    { ...createSurveyQuestion("short", "q2", 2), title: "其他建议", chapterId: "反馈" },
  ];
  function Designer() {
    const [value, setValue] = React.useState(questions);
    return <SurveyQuestionEditor studioLayout surveyTitle="客户调研" questions={value} onChange={setValue} />;
  }
  render(<Designer />);
  const canvas = screen.getByRole("region", { name: "问卷设计画布" });
  expect(within(canvas).getByRole("heading", { name: "客户调研" })).toBeInTheDocument();
  expect(within(canvas).getByRole("heading", { name: "基本信息" })).toBeInTheDocument();
  expect(within(canvas).getByRole("heading", { name: "反馈" })).toBeInTheDocument();
  fireEvent.click(within(canvas).getByRole("button", { name: "编辑第 2 题：其他建议" }));
  const inlineTitle = within(canvas).getByRole("textbox", { name: "问题内容" });
  expect(inlineTitle).toHaveValue("其他建议");
  fireEvent.change(inlineTitle, { target: { value: "更新后的建议" } });
  expect(inlineTitle).toHaveValue("更新后的建议");
  const settings = screen.getByRole("region", { name: "题目设置" });
  expect(within(settings).queryByRole("textbox", { name: "问题内容" })).not.toBeInTheDocument();
  expect(within(settings).getByRole("combobox", { name: "题型" })).toHaveValue("short");
});

it("adds a real question when a toolbox item is dropped on the center canvas", () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  function Designer() {
    const [value, setValue] = React.useState<ReturnType<typeof createSurveyQuestion>[]>([]);
    return <SurveyQuestionEditor studioLayout questions={value} onChange={setValue} />;
  }
  render(<Designer />);
  const typeButton = screen.getByRole("button", { name: "单选" });
  const canvas = screen.getByRole("region", { name: "问卷设计画布" });
  const dataTransfer = {
    effectAllowed: "copy",
    dropEffect: "copy",
    setData: vi.fn(),
    getData: vi.fn(() => "single"),
  };
  fireEvent.dragStart(typeButton, { dataTransfer });
  const dropZone = screen.getByTestId("survey-question-drop-zone");
  fireEvent.dragOver(dropZone, { dataTransfer });
  fireEvent.drop(dropZone, { dataTransfer });
  fireEvent.click(within(canvas).getByRole("button", { name: "编辑第 1 题：单选" }));
  expect(within(canvas).getByRole("textbox", { name: "问题内容" })).toHaveValue("单选");
});

it("keeps desktop side panels fixed and makes the center canvas the primary scroll surface", () => {
  const matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal("matchMedia", matchMedia);
  render(<SurveyQuestionEditor studioLayout questions={[createSurveyQuestion("short", "q1", 1)]} onChange={vi.fn()} />);
  expect(matchMedia).toHaveBeenCalledWith("(max-width: 1023px)");
  expect(screen.getByTestId("survey-designer-grid")).toHaveClass("lg:h-full", "lg:overflow-hidden");
  expect(screen.getByTestId("survey-designer-outline")).toHaveClass("lg:h-full");
  expect(screen.getByTestId("survey-designer-settings")).toHaveClass("lg:h-full");
  expect(screen.getByTestId("survey-designer-canvas-scroll")).toHaveClass("lg:h-full", "lg:overflow-y-auto");
});

it("offers a focused trial fill that follows respondent visibility without editing the draft", () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  const first = { ...createSurveyQuestion("single", "q1", 1), title: "是否继续", options: ["是", "否"] };
  const follow = { ...createSurveyQuestion("short", "q2", 2), title: "补充说明" };
  follow.config = {
    ...follow.config,
    visibleWhen: [{ questionId: "q1", operator: "equals", value: first.config!.optionIds![0]! }],
  };
  const onChange = vi.fn();
  render(<SurveyQuestionEditor studioLayout surveyTitle="试填问卷" questions={[first, follow]} onChange={onChange} />);

  fireEvent.click(screen.getByRole("button", { name: "试填问卷" }));
  const trial = screen.getByRole("region", { name: "问卷试填" });
  expect(within(trial).getByRole("heading", { name: "试填问卷" })).toBeInTheDocument();
  expect(within(trial).getByRole("group", { name: "是否继续 *" })).toBeInTheDocument();
  expect(within(trial).queryByRole("group", { name: "补充说明 *" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "题型工具箱" })).not.toBeInTheDocument();

  fireEvent.click(within(trial).getByLabelText("是"));
  expect(within(trial).getByRole("group", { name: "补充说明 *" })).toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "退出试填" }));
  expect(screen.getByRole("heading", { name: "题型工具箱" })).toBeInTheDocument();
});

it("paginates focused trial fill like the respondent form", () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  const first = { ...createSurveyQuestion("short", "q1", 1), title: "第一页问题" };
  const divider = createSurveyQuestion("page_break", "page-2", 2);
  const second = { ...createSurveyQuestion("short", "q2", 3), title: "第二页问题" };
  render(<SurveyQuestionEditor studioLayout questions={[first, divider, second]} onChange={vi.fn()} />);

  fireEvent.click(screen.getByRole("button", { name: "试填问卷" }));
  const trial = screen.getByRole("region", { name: "问卷试填" });
  expect(within(trial).getByText("第 1 / 2 页")).toBeInTheDocument();
  expect(within(trial).getByRole("group", { name: "第一页问题 *" })).toBeInTheDocument();
  expect(within(trial).queryByRole("group", { name: "第二页问题 *" })).not.toBeInTheDocument();
  expect(within(trial).queryByText("分页")).not.toBeInTheDocument();

  fireEvent.click(within(trial).getByRole("button", { name: "下一页" }));
  expect(within(trial).getByText("第 2 / 2 页")).toBeInTheDocument();
  expect(within(trial).getByRole("group", { name: "第二页问题 *" })).toBeInTheDocument();
  expect(within(trial).queryByRole("group", { name: "第一页问题 *" })).not.toBeInTheDocument();
  fireEvent.click(within(trial).getByRole("button", { name: "上一页" }));
  expect(within(trial).getByText("第 1 / 2 页")).toBeInTheDocument();
});

it("searches and reorders long questionnaires from the outline", () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  function Designer() {
    const [questions, setQuestions] = React.useState([
      { ...createSurveyQuestion("short", "q1", 1), title: "姓名", chapterId: "基本信息" },
      { ...createSurveyQuestion("short", "q2", 2), title: "居住城市", chapterId: "基本信息" },
      { ...createSurveyQuestion("open", "q3", 3), title: "其他建议", chapterId: "反馈" },
    ]);
    return <SurveyQuestionEditor studioLayout questions={questions} onChange={setQuestions} />;
  }
  render(<Designer />);
  const outline = screen.getByTestId("survey-designer-outline");
  const search = within(outline).getByRole("searchbox", { name: "搜索题目" });
  fireEvent.change(search, { target: { value: "城市" } });
  expect(within(outline).getByRole("button", { name: "选择题目 2：居住城市" })).toBeInTheDocument();
  expect(within(outline).queryByRole("button", { name: "选择题目 1：姓名" })).not.toBeInTheDocument();
  fireEvent.change(search, { target: { value: "" } });
  fireEvent.click(within(outline).getByRole("button", { name: "上移题目：居住城市" }));
  expect(within(outline).getAllByRole("button", { name: /选择题目/ })[0]).toHaveAccessibleName("选择题目 1：居住城市");
});

it("undoes and redoes designer changes with accessible toolbar controls", () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  function Designer() {
    const [questions, setQuestions] = React.useState([
      { ...createSurveyQuestion("short", "q1", 1), title: "原问题" },
    ]);
    return <SurveyQuestionEditor studioLayout questions={questions} onChange={setQuestions} />;
  }
  render(<Designer />);
  fireEvent.click(screen.getByRole("button", { name: "编辑第 1 题：原问题" }));
  fireEvent.change(screen.getByRole("textbox", { name: "问题内容" }), { target: { value: "修改后的问题" } });
  fireEvent.click(screen.getByRole("button", { name: "撤销最近修改" }));
  expect(screen.getByRole("textbox", { name: "问题内容" })).toHaveValue("原问题");
  fireEvent.click(screen.getByRole("button", { name: "重做最近修改" }));
  expect(screen.getByRole("textbox", { name: "问题内容" })).toHaveValue("修改后的问题");
});

it("clears local undo history when a template replaces the question set", () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  function Designer() {
    const [questions, setQuestions] = React.useState([
      { ...createSurveyQuestion("short", "q1", 1), title: "原问题" },
    ]);
    return <>
      <button type="button" onClick={() => setQuestions([{ ...createSurveyQuestion("single", "template-q1", 1), title: "模板问题" }])}>应用外部模板</button>
      <SurveyQuestionEditor studioLayout questions={questions} onChange={setQuestions} />
    </>;
  }
  render(<Designer />);
  fireEvent.click(screen.getByRole("button", { name: "编辑第 1 题：原问题" }));
  fireEvent.change(screen.getByRole("textbox", { name: "问题内容" }), { target: { value: "本地修改" } });
  expect(screen.getByRole("button", { name: "撤销最近修改" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "应用外部模板" }));
  expect(screen.getByRole("button", { name: "编辑第 1 题：模板问题" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "撤销最近修改" })).toBeDisabled();
});
