import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  createSurveyQuestion,
  SURVEY_QUESTION_TYPES,
  surveyChoices,
  validateSurveyAnswer,
  type SurveyWorkflowQuestion,
  type SurveyAnswerValue,
} from "@repo/contracts/survey-question-types";
import { SurveyQuestionRenderer } from "@/components/survey/live/question-renderer";
import { SurveyQuestionEditor } from "@/components/survey/live/question-editor";
import { QuestionMaterial } from "@/components/survey/live/question-material";
import { PublicSurveyForm } from "@/components/survey/live/public-survey-form";
const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/survey/runtime-client", () => ({ surveyRequest: request }));
beforeEach(() => request.mockReset());
function Answer({
  question,
  change = vi.fn(),
}: {
  question: SurveyWorkflowQuestion;
  change?: (value: SurveyAnswerValue) => void;
}) {
  const [value, setValue] = React.useState<SurveyAnswerValue>();
  return (
    <SurveyQuestionRenderer
      question={question}
      value={value}
      onChange={(next) => {
        setValue(next);
        change(next);
      }}
    />
  );
}
function Editor({ initial = [] }: { initial?: SurveyWorkflowQuestion[] }) {
  const [questions, setQuestions] = React.useState(initial);
  return (
    <>
      <SurveyQuestionEditor questions={questions} onChange={setQuestions} />
      <output data-testid="questions">{JSON.stringify(questions)}</output>
    </>
  );
}
describe("question registry renders and configures every supported form", () => {
  it.each(SURVEY_QUESTION_TYPES)(
    "adds $type with valid defaults and a shared preview",
    ({ type, label }) => {
      render(<Editor />);
      fireEvent.click(screen.getByRole("button", { name: /^新增题目$/ }));
      fireEvent.click(screen.getByTestId(`add-question-${type}`));
      expect(screen.getByRole("textbox", { name: "问题内容" })).toHaveValue(
        label,
      );
      expect(screen.getByRole("combobox", { name: "题型" })).toHaveValue(type);
      const questions = JSON.parse(
        screen.getByTestId("questions").textContent!,
      ) as SurveyWorkflowQuestion[];
      expect(questions[0]!.type).toBe(type);
      fireEvent.click(screen.getByRole("button", { name: "展开实时预览" }));
      expect(
        screen.getByRole("complementary", { name: "实时预览" }),
      ).toHaveTextContent(label);
      fireEvent.click(screen.getByRole("button", { name: "手机预览" }));
      expect(screen.getByRole("button", { name: "手机预览" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    },
  );
  it("cancels destructive type switches, preserves choice IDs while editing, and can undo deletion", () => {
    const question = createSurveyQuestion("single", "q", 1);
    render(<Editor initial={[question]} />);
    fireEvent.change(screen.getByRole("textbox", { name: "选项 1" }), {
      target: { value: "新名称" },
    });
    expect(
      JSON.parse(screen.getByTestId("questions").textContent!)[0].config
        .optionIds,
    ).toEqual(question.config!.optionIds);
    fireEvent.change(screen.getByRole("combobox", { name: "题型" }), {
      target: { value: "open" },
    });
    expect(screen.getByRole("alertdialog")).toHaveTextContent("重置 2 个选项");
    fireEvent.click(screen.getByRole("button", { name: "取消切换" }));
    expect(screen.getByRole("textbox", { name: "选项 1" })).toHaveValue(
      "新名称",
    );
    fireEvent.click(screen.getByRole("button", { name: "复制题目" }));
    expect(
      JSON.parse(screen.getByTestId("questions").textContent!),
    ).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "删除题目" }));
    expect(
      JSON.parse(screen.getByTestId("questions").textContent!),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "撤销删除" }));
    expect(
      JSON.parse(screen.getByTestId("questions").textContent!),
    ).toHaveLength(2);
  });
  it("uses real type search and locks published controls", () => {
    const first = render(<Editor />);
    fireEvent.click(screen.getByRole("button", { name: /^新增题目$/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "搜索题型" }), {
      target: { value: "邮箱" },
    });
    expect(screen.getByTestId("add-question-email")).toBeInTheDocument();
    expect(screen.queryByTestId("add-question-single")).not.toBeInTheDocument();
    first.unmount();
    render(
      <SurveyQuestionEditor
        questions={[createSurveyQuestion("single", "q", 1)]}
        locked
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("textbox", { name: "问题内容" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "新增题目" }),
    ).not.toBeInTheDocument();
  });
});
describe("real answer interactions", () => {
  it.each(["single", "multi", "image_single", "image_multi", "scale"] as const)(
    "selects %s using stable choice IDs",
    (type) => {
      const question = createSurveyQuestion(type, "q", 1),
        change = vi.fn();
      render(<Answer question={question} change={change} />);
      const choice = surveyChoices(question)[0]!;
      fireEvent.click(screen.getByLabelText(choice.label));
      expect(validateSurveyAnswer(question, change.mock.lastCall![0])).toEqual(
        [],
      );
      expect(JSON.stringify(change.mock.lastCall![0])).toContain(choice.id);
    },
  );
  it.each([
    "short",
    "open",
    "number",
    "date",
    "time",
    "datetime",
    "email",
    "phone",
  ] as const)("edits %s values without coercing blanks", (type) => {
    const question = createSurveyQuestion(type, "q", 1),
      change = vi.fn();
    const values = {
      short: "文字",
      open: "较长文字",
      number: "12",
      date: "2026-09-21",
      time: "09:30",
      datetime: "2026-09-21T09:30",
      email: "owner@example.com",
      phone: "13800138000",
    };
    render(<Answer question={question} change={change} />);
    expect(change).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(question.title), {
      target: { value: values[type] },
    });
    expect(change).toHaveBeenLastCalledWith(values[type]);
    expect(validateSurveyAnswer(question, values[type])).toEqual([]);
  });
  it.each([
    "matrix_single",
    "matrix_multi",
    "matrix_scale",
    "matrix_input",
    "matrix_dropdown",
  ] as const)("captures %s per row in accessible row cards", (type) => {
    const question = createSurveyQuestion(type, "q", 1),
      change = vi.fn();
    render(<Answer question={question} change={change} />);
    for (const row of question.config!.rows!) {
      if (type === "matrix_input")
        fireEvent.change(
          screen.getByLabelText(`${question.title}：${row.label}`),
          { target: { value: "回答" } },
        );
      else if (type === "matrix_dropdown")
        fireEvent.change(
          screen.getByLabelText(`${question.title}：${row.label}`),
          { target: { value: surveyChoices(question)[0]!.id } },
        );
      else
        fireEvent.click(
          within(screen.getByRole("group", { name: row.label })).getByLabelText(
            surveyChoices(question)[0]!.label,
          ),
        );
    }
    expect(validateSurveyAnswer(question, change.mock.lastCall![0])).toEqual(
      [],
    );
    expect(Object.keys(change.mock.lastCall![0])).toEqual(
      question.config!.rows!.map((row) => row.id),
    );
  });
  it.each(["multiple_text", "address"] as const)(
    "fills every %s field",
    (type) => {
      const question = createSurveyQuestion(type, "q", 1),
        change = vi.fn();
      render(<Answer question={question} change={change} />);
      for (const field of question.config!.fields!)
        fireEvent.change(
          screen.getByLabelText(`${question.title}：${field.label}`),
          { target: { value: "测试" } },
        );
      expect(validateSurveyAnswer(question, change.mock.lastCall![0])).toEqual(
        [],
      );
    },
  );
  it("requires interaction for sliders and ranking, and provides keyboard reordering", () => {
    const change = vi.fn();
    const first = render(
      <Answer
        question={createSurveyQuestion("slider", "q", 1)}
        change={change}
      />,
    );
    expect(change).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("slider"), { target: { value: "25" } });
    expect(change).toHaveBeenLastCalledWith("25");
    first.unmount();
    change.mockClear();
    const rank = createSurveyQuestion("ranking", "r", 1);
    render(<Answer question={rank} change={change} />);
    expect(change).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("listitem", { name: /选项二/ }), {
      key: "ArrowUp",
    });
    expect(change).toHaveBeenLastCalledWith(
      [...surveyChoices(rank).map((choice) => choice.id)].reverse(),
    );
  });
  it("resets child cascade values when parent changes", () => {
    const question = createSurveyQuestion("cascade", "q", 1),
      change = vi.fn();
    render(<Answer question={question} change={change} />);
    fireEvent.change(screen.getByLabelText(`${question.title}：第 1 级`), {
      target: { value: "区域一" },
    });
    fireEvent.change(screen.getByLabelText(`${question.title}：第 2 级`), {
      target: { value: "城市一" },
    });
    fireEvent.change(screen.getByLabelText(`${question.title}：第 1 级`), {
      target: { value: "区域二" },
    });
    expect(change).toHaveBeenLastCalledWith(["区域二"]);
    expect(screen.getByLabelText(`${question.title}：第 2 级`)).toHaveValue("");
  });
  it("supports dropdown other text and exclusive multiple choices", () => {
    const question = createSurveyQuestion("dropdown", "q", 1);
    question.config!.other = true;
    const change = vi.fn(),
      first = render(<Answer question={question} change={change} />);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "__other__" },
    });
    fireEvent.change(screen.getByLabelText(`${question.title}：其他说明`), {
      target: { value: "自定义" },
    });
    expect(change).toHaveBeenLastCalledWith({
      selected: "__other__",
      other: "自定义",
    });
    first.unmount();
    const multi = createSurveyQuestion("multi", "m", 1);
    multi.config!.exclusiveOptionIds = [surveyChoices(multi)[0]!.id];
    render(<Answer question={multi} change={change} />);
    fireEvent.click(screen.getByLabelText("选项二"));
    fireEvent.click(screen.getByLabelText("选项一"));
    expect(change).toHaveBeenLastCalledWith([surveyChoices(multi)[0]!.id]);
  });
  it.each(["rating", "nps"] as const)("selects %s numeric scores", (type) => {
    const q = createSurveyQuestion(type, "q", 1),
      change = vi.fn();
    render(<Answer question={q} change={change} />);
    fireEvent.click(screen.getAllByRole("radio")[2]!);
    expect(validateSurveyAnswer(q, change.mock.lastCall![0])).toEqual([]);
  });
  it("shows allocation remainder as values change", () => {
    const q = createSurveyQuestion("allocation", "q", 1),
      change = vi.fn();
    render(<Answer question={q} change={change} />);
    fireEvent.change(screen.getByLabelText(`${q.title}：选项一`), {
      target: { value: "40" },
    });
    expect(screen.getByText("已分配 40，还差 60")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(`${q.title}：选项二`), {
      target: { value: "60" },
    });
    expect(validateSurveyAnswer(q, change.mock.lastCall![0])).toEqual([]);
  });
});
describe("materials and public page rules", () => {
  it("retries real File uploads and never stores a URL or local filename as an answer", async () => {
    const upload = vi
        .fn()
        .mockRejectedValueOnce(new Error("network"))
        .mockResolvedValueOnce({ id: "attachment-1", name: "evidence.txt" }),
      change = vi.fn();
    render(
      <QuestionMaterial
        questionId="file"
        value={[]}
        onChange={change}
        upload={upload}
      />,
    );
    const file = new File(["evidence"], "evidence.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("选择文件"), {
      target: { files: [file] },
    });
    await screen.findByRole("alert");
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "重试上传" }));
    await waitFor(() => expect(change).toHaveBeenCalledWith(["attachment-1"]));
    expect(upload).toHaveBeenNthCalledWith(2, file, "file");
  });
  it("generates and uploads a PNG from accessible typed signature", async () => {
    const fillText = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      fillText,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback) => callback(new Blob(["png"], { type: "image/png" })),
    );
    const upload = vi
        .fn()
        .mockResolvedValue({ id: "signature-1", name: "signature.png" }),
      change = vi.fn();
    render(
      <QuestionMaterial
        signature
        questionId="signature"
        value={[]}
        onChange={change}
        upload={upload}
      />,
    );
    fireEvent.change(screen.getByLabelText("键入签名"), {
      target: { value: "张三" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存签名" }));
    await waitFor(() => expect(change).toHaveBeenCalledWith(["signature-1"]));
    expect(upload.mock.calls[0]![0]).toBeInstanceOf(File);
    expect(upload.mock.calls[0]![0].type).toBe("image/png");
    expect(fillText).toHaveBeenCalled();
    vi.restoreAllMocks();
  });
  it("hides conditional required questions and excludes their stale answers from submission", async () => {
    const single = createSurveyQuestion("single", "q", 1),
      follow = createSurveyQuestion("short", "follow", 2),
      page = createSurveyQuestion("page_break", "page", 3),
      last = createSurveyQuestion("short", "last", 4);
    follow.config!.visibleWhen = [
      {
        questionId: "q",
        operator: "equals",
        value: surveyChoices(single)[0]!.id,
      },
    ];
    request
      .mockResolvedValueOnce({
        id: "survey",
        title: "条件问卷",
        questions: [single, follow, page, last],
      })
      .mockResolvedValueOnce({ accepted: true });
    render(<PublicSurveyForm token="token" />);
    fireEvent.click(await screen.findByLabelText("选项一"));
    fireEvent.change(screen.getByLabelText(follow.title), {
      target: { value: "隐藏旧值" },
    });
    fireEvent.click(screen.getByLabelText("选项二"));
    expect(screen.queryByLabelText(follow.title)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(last.title), {
      target: { value: "末页" },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交答卷" }));
    await screen.findByText("提交成功，感谢您的参与。");
    expect(
      request.mock.calls[1]![1].body.answers.map(
        (item: { questionId: string }) => item.questionId,
      ),
    ).toEqual(["q", "last"]);
  });
  it("binds material upload and final answers to the same submission session", async () => {
    const question = createSurveyQuestion("file", "file", 1);
    request
      .mockResolvedValueOnce({
        id: "survey",
        title: "材料问卷",
        questions: [question],
      })
      .mockResolvedValueOnce({ uploadSessionToken: "session-1" })
      .mockResolvedValueOnce({ accepted: true });
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ attachmentId: "attachment-1", name: "file.txt" }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetch);
    render(<PublicSurveyForm token="public-token" />);
    const file = new File(["actual content"], "file.txt", {
      type: "text/plain",
    });
    fireEvent.change(await screen.findByLabelText("选择文件"), {
      target: { files: [file] },
    });
    await screen.findByText("file.txt");
    expect(fetch.mock.calls[0]![0]).toContain(
      "/public/surveys/public-token/upload-sessions/session-1/questions/file/attachments",
    );
    expect(fetch.mock.calls[0]![1].body).toBeInstanceOf(FormData);
    expect(fetch.mock.calls[0]![1].body.get("file")).toBeInstanceOf(File);
    fireEvent.click(screen.getByRole("button", { name: "提交答卷" }));
    await screen.findByText("提交成功，感谢您的参与。");
    const uploadSessionBody = request.mock.calls[1]![1].body;
    expect(request.mock.calls[2]![1].body).toMatchObject({
      submissionId: uploadSessionBody.submissionId,
      uploadSessionToken: "session-1",
      answers: [{ questionId: "file", value: ["attachment-1"] }],
    });
    vi.unstubAllGlobals();
  });
  it("a forward jump skips required questions without submitting their values", async () => {
    const first = createSurveyQuestion("single", "first", 1),
      skipped = createSurveyQuestion("short", "skipped", 2),
      last = createSurveyQuestion("short", "last", 3);
    first.config!.jumpTo = [
      { optionId: surveyChoices(first)[0]!.id, targetId: "last" },
    ];
    skipped.title = "被跳过的必答题";
    last.title = "最后一题";
    request
      .mockResolvedValueOnce({
        id: "survey",
        title: "跳转问卷",
        questions: [first, skipped, last],
      })
      .mockResolvedValueOnce({ accepted: true });
    render(<PublicSurveyForm token="token" />);
    fireEvent.change(await screen.findByLabelText(skipped.title), {
      target: { value: "旧值" },
    });
    fireEvent.click(screen.getByLabelText("选项一"));
    expect(screen.queryByLabelText(skipped.title)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(last.title), {
      target: { value: "有效答案" },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交答卷" }));
    await screen.findByText("提交成功，感谢您的参与。");
    expect(
      request.mock.calls[1]![1].body.answers.some(
        (answer: { questionId: string }) => answer.questionId === "skipped",
      ),
    ).toBe(false);
  });
});

describe("review regressions", () => {
  it.each(["single", "multi", "dropdown"] as const)(
    "clears obsolete other text for %s before submission",
    (type) => {
      const question = createSurveyQuestion(type, "q", 1);
      question.config!.other = true;
      const change = vi.fn();
      render(<Answer question={question} change={change} />);
      if (type === "dropdown")
        fireEvent.change(screen.getByRole("combobox"), {
          target: { value: "__other__" },
        });
      else fireEvent.click(screen.getByLabelText("其他", { exact: true }));
      fireEvent.change(screen.getByLabelText(`${question.title}：其他说明`), {
        target: { value: "旧的其他说明" },
      });
      if (type === "dropdown")
        fireEvent.change(screen.getByRole("combobox"), {
          target: { value: surveyChoices(question)[0]!.id },
        });
      else {
        if (type === "multi")
          fireEvent.click(screen.getByLabelText("其他", { exact: true }));
        fireEvent.click(screen.getByLabelText("选项一"));
      }
      expect(change.mock.lastCall![0].other).toBe("");
      expect(validateSurveyAnswer(question, change.mock.lastCall![0])).toEqual(
        [],
      );
      expect(
        screen.queryByLabelText(`${question.title}：其他说明`),
      ).not.toBeInTheDocument();
    },
  );
  it.each([2, 0.5])(
    "only presents rating scores consistent with step %s",
    (step) => {
      const question = createSurveyQuestion("rating", "q", 1);
      question.config!.step = step;
      const change = vi.fn();
      render(<Answer question={question} change={change} />);
      expect(screen.getAllByRole("radio")).toHaveLength(
        Math.floor(4 / step) + 1,
      );
      for (const control of screen.getAllByRole("radio")) {
        fireEvent.click(control);
        expect(
          validateSurveyAnswer(question, change.mock.lastCall![0]),
        ).toEqual([]);
      }
      if (step === 0.5)
        expect(screen.getByLabelText("1.5 星")).toBeInTheDocument();
      else expect(screen.queryByLabelText("2 星")).not.toBeInTheDocument();
    },
  );
  it("keeps shuffled option order after leaving a page and coming back", async () => {
    const first = createSurveyQuestion("single", "q", 1);
    first.config!.shuffleOptions = true;
    first.options = ["A", "B", "C", "D", "E", "F"];
    first.config!.optionIds = first.options.map((item) => `option-${item}`);
    request.mockResolvedValueOnce({
      id: "s",
      title: "随机问卷",
      questions: [
        first,
        createSurveyQuestion("page_break", "p", 2),
        createSurveyQuestion("short", "last", 3),
      ],
    });
    render(<PublicSurveyForm token="shuffle" />);
    await screen.findByLabelText("A");
    const before = screen
      .getAllByRole("radio")
      .map((control) => control.closest("label")!.textContent);
    fireEvent.click(screen.getByLabelText("A"));
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "上一页" }));
    expect(
      screen
        .getAllByRole("radio")
        .map((control) => control.closest("label")!.textContent),
    ).toEqual(before);
    expect(screen.getByLabelText("A")).toBeChecked();
  });
});
