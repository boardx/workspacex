import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { DigitalInterviewSetup } from "@/components/itv/digital-interview-setup";
import { createMockDigitalInterviewDraft } from "@/lib/mock/digital-interview-drafts";

type LiveInterview = {
  readonly interviewId: string;
  readonly name: string;
  readonly tags: readonly string[];
  readonly topic: string | null;
  readonly status: string;
  readonly sourceQuickInterviewId: string | null;
  readonly selectedExpertIds: readonly string[];
  readonly reportId: string | null;
  readonly version: number;
};

const topicPendingInterview: LiveInterview = {
  interviewId: "itv-f04-live",
  name: "德国储能采购决策链",
  tags: ["采购", "德国市场"],
  topic: null,
  status: "topic_pending",
  sourceQuickInterviewId: null,
  selectedExpertIds: [],
  reportId: null,
  version: 41,
};

const persistedInterview: LiveInterview = {
  ...topicPendingInterview,
  topic: "服务端恢复：谁拥有最终否决权？",
  status: "experts_pending",
  selectedExpertIds: ["expert-persisted"],
  version: 73,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type FetchCall = { readonly method: string; readonly path: string; readonly body: unknown };

function installLiveFetch(initial: LiveInterview = topicPendingInterview) {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input.toString());
    const method = init?.method ?? "GET";
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
    calls.push({ method, path: url.pathname, body });
    if (method === "POST" && url.pathname.endsWith("/topic/confirm")) {
      return json({ ...topicPendingInterview, topic: body.topic, status: "experts_pending", version: 42 }, 201);
    }
    if (method === "POST" && url.pathname.endsWith("/skill/messages")) {
      return json({ proposalId: "proposal-f04", target: "topic", text: "建议主题：应用后的可验证主题" }, 201);
    }
    if (method === "GET") return json(initial);
    throw new Error(`unexpected fetch: ${method} ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    calls,
    fetchMock,
    requests(method: string, suffix: string) {
      return calls.filter((call) => call.method === method && call.path.endsWith(suffix));
    },
  };
}

describe("F04 可点击 Mock 访谈流程", () => {
  beforeEach(() => {
    push.mockReset();
    localStorage.clear();
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-f04");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("确认主题后可点击完成专家、问题、访谈和报告步骤", async () => {
    const draft = createMockDigitalInterviewDraft({ name: "德国采购决策链", tags: ["采购决策"] });
    render(<DigitalInterviewSetup interviewId={draft.interviewId} />);

    expect(await screen.findByTestId("itv-workflow-step-1")).toHaveAttribute("aria-current", "step");
    fireEvent.change(screen.getByTestId("itv-topic-input"), {
      target: { value: "德国储能采购由谁拥有最终否决权？" },
    });
    fireEvent.click(screen.getByTestId("itv-confirm-topic"));

    expect(await screen.findByTestId("itv-workflow-step-2")).toHaveAttribute("aria-current", "step");
    expect(screen.getAllByTestId("itv-selected-expert").length).toBeGreaterThan(1);
    fireEvent.click(screen.getAllByLabelText(/删除专家/)[0]!);
    fireEvent.click(screen.getByTestId("itv-confirm-experts"));

    expect(await screen.findByTestId("itv-workflow-step-3")).toHaveAttribute("aria-current", "step");
    const question = screen.getAllByTestId("itv-question-input")[0]!;
    fireEvent.change(question, { target: { value: "请解释你在采购否决中的职责边界。" } });
    fireEvent.click(screen.getByTestId("itv-confirm-questions"));

    expect(await screen.findByTestId("itv-workflow-step-4")).toHaveAttribute("aria-current", "step");
    fireEvent.click(screen.getByTestId("itv-run-all"));
    fireEvent.click(screen.getByTestId("itv-workflow-step-5"));
    expect(screen.getByTestId("itv-report-markdown")).toHaveTextContent("# 德国采购决策链");
    expect(screen.getByTestId("itv-report-timeline")).toHaveTextContent("报告已生成");
  });

  it("整个访谈流程始终可以返回历史访谈列表", async () => {
    const draft = createMockDigitalInterviewDraft({ name: "可返回流程", tags: ["采购"] });
    render(<DigitalInterviewSetup interviewId={draft.interviewId} />);

    const backLink = await screen.findByRole("link", { name: "返回访谈列表" });
    expect(backLink).toHaveAttribute("href", "/itv?tab=history");

    fireEvent.change(screen.getByTestId("itv-topic-input"), { target: { value: "验证决策链" } });
    fireEvent.click(screen.getByTestId("itv-confirm-topic"));
    expect(screen.getByRole("link", { name: "返回访谈列表" })).toBeInTheDocument();
  });

  it("从专家目录弹窗搜索并多选添加专家", async () => {
    const draft = createMockDigitalInterviewDraft({ name: "专家选择", tags: ["采购"] });
    render(<DigitalInterviewSetup interviewId={draft.interviewId} />);
    fireEvent.change(await screen.findByTestId("itv-topic-input"), { target: { value: "验证决策链" } });
    fireEvent.click(screen.getByTestId("itv-confirm-topic"));

    fireEvent.click(await screen.findByTestId("itv-add-expert"));
    expect(screen.getByTestId("itv-expert-picker-dialog")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("itv-expert-picker-search"), { target: { value: "陈宇轩" } });
    fireEvent.click(screen.getByLabelText("选择专家 陈宇轩"));
    fireEvent.click(screen.getByTestId("itv-expert-picker-confirm"));

    expect(screen.getByText("陈宇轩")).toBeInTheDocument();
    expect(screen.getAllByText("陈宇轩")).toHaveLength(1);
  });

  it("每位专家默认三问，生成问题与手动问题都可删除", async () => {
    const draft = createMockDigitalInterviewDraft({ name: "问题编辑", tags: ["采购"] });
    render(<DigitalInterviewSetup interviewId={draft.interviewId} />);
    fireEvent.change(await screen.findByTestId("itv-topic-input"), { target: { value: "验证决策链" } });
    fireEvent.click(screen.getByTestId("itv-confirm-topic"));
    fireEvent.click(await screen.findByTestId("itv-confirm-experts"));

    const groups = await screen.findAllByTestId("itv-question-group");
    expect(groups.length).toBeGreaterThan(1);
    expect(screen.getAllByTestId("itv-question-input")).toHaveLength(groups.length * 3);
    expect(screen.getAllByTestId("itv-question-input")[0]).toHaveAttribute("rows", "2");

    fireEvent.click(screen.getAllByTestId("itv-delete-question")[0]!);
    expect(screen.getAllByTestId("itv-question-input")).toHaveLength(groups.length * 3 - 1);

    fireEvent.click(screen.getAllByTestId("itv-add-question")[0]!);
    expect(screen.getAllByTestId("itv-question-input")).toHaveLength(groups.length * 3);
    fireEvent.click(screen.getAllByTestId("itv-delete-question").at(-1)!);
    expect(screen.getAllByTestId("itv-question-input")).toHaveLength(groups.length * 3 - 1);
  });

  it("往返专家步骤时保留编辑，只为新增专家补齐三问", async () => {
    const draft = createMockDigitalInterviewDraft({ name: "往返编辑", tags: ["采购"] });
    render(<DigitalInterviewSetup interviewId={draft.interviewId} />);
    fireEvent.change(await screen.findByTestId("itv-topic-input"), { target: { value: "验证决策链" } });
    fireEvent.click(screen.getByTestId("itv-confirm-topic"));
    fireEvent.click(await screen.findByTestId("itv-confirm-experts"));

    const firstQuestion = (await screen.findAllByTestId("itv-question-input"))[0]!;
    fireEvent.change(firstQuestion, { target: { value: "保留这条用户编辑的问题" } });
    fireEvent.click(screen.getByTestId("itv-workflow-step-2"));
    fireEvent.click(await screen.findByTestId("itv-add-expert"));
    fireEvent.change(screen.getByTestId("itv-expert-picker-search"), { target: { value: "陈宇轩" } });
    fireEvent.click(screen.getByLabelText("选择专家 陈宇轩"));
    fireEvent.click(screen.getByTestId("itv-expert-picker-confirm"));
    fireEvent.click(await screen.findByTestId("itv-confirm-experts"));

    expect(await screen.findByDisplayValue("保留这条用户编辑的问题")).toBeInTheDocument();
    expect(screen.getAllByTestId("itv-question-group")).toHaveLength(4);
    expect(screen.getAllByTestId("itv-question-input")).toHaveLength(12);
  });
});

describe("F04 正式 setup 的显式确认与双层持久化验收门", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-f04-live");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("主题输入只是 dirty buffer，不发 fetch；确认才携带 requestId 与 expectedVersion", async () => {
    const transport = installLiveFetch();
    render(<DigitalInterviewSetup interviewId={topicPendingInterview.interviewId} />);

    await waitFor(() => expect(transport.requests("GET", `/interviews/digital/${topicPendingInterview.interviewId}`)).toHaveLength(1));
    const topic = await screen.findByTestId("itv-topic-input");
    expect(topic).toHaveValue("");
    expect(screen.getByTestId("itv-workflow-status")).toHaveTextContent("topic_pending");
    expect(screen.getByTestId("itv-workflow-version")).toHaveTextContent("41");
    fireEvent.change(topic, { target: { value: "谁拥有最终否决权？" } });
    expect(transport.requests("POST", "/topic/confirm")).toHaveLength(0);
    expect(transport.requests("POST", "/skill/messages")).toHaveLength(0);

    fireEvent.click(screen.getByTestId("itv-confirm-topic"));
    await waitFor(() => expect(transport.requests("POST", "/topic/confirm")).toHaveLength(1));
    expect(transport.requests("POST", `/interviews/digital/${topicPendingInterview.interviewId}/topic/confirm`)[0]!.body).toMatchObject({
      topic: "谁拥有最终否决权？",
      expectedVersion: 41,
      requestId: expect.any(String),
    });
  });

  it("刷新从 GET hydrate 独特的服务端 topic/status/version，而不是本地默认值", async () => {
    const transport = installLiveFetch(persistedInterview);
    const first = render(<DigitalInterviewSetup interviewId={persistedInterview.interviewId} />);
    await waitFor(() => expect(transport.requests("GET", `/interviews/digital/${persistedInterview.interviewId}`)).toHaveLength(1));
    expect(await screen.findByTestId("itv-persisted-topic")).toHaveTextContent(persistedInterview.topic);
    expect(screen.getByTestId("itv-workflow-status")).toHaveTextContent("experts_pending");
    expect(screen.getByTestId("itv-workflow-version")).toHaveTextContent("73");
    first.unmount();

    render(<DigitalInterviewSetup interviewId={persistedInterview.interviewId} />);
    expect(await screen.findByTestId("itv-persisted-topic")).toHaveTextContent(persistedInterview.topic);
    expect(screen.getByTestId("itv-workflow-status")).toHaveTextContent("experts_pending");
    expect(screen.getByTestId("itv-workflow-version")).toHaveTextContent("73");
    expect(transport.requests("GET", `/interviews/digital/${persistedInterview.interviewId}`)).toHaveLength(2);
  });

  it("在未确认主题时切换步骤会警告用户，而不是默默丢弃或保存", async () => {
    const transport = installLiveFetch();
    render(<DigitalInterviewSetup interviewId={topicPendingInterview.interviewId} />);
    await waitFor(() => expect(transport.requests("GET", `/interviews/digital/${topicPendingInterview.interviewId}`)).toHaveLength(1));
    fireEvent.change(await screen.findByTestId("itv-topic-input"), { target: { value: "未确认的主题" } });

    fireEvent.click(screen.getByTestId("itv-workflow-step-2"));
    expect(await screen.findByRole("alert")).toHaveTextContent("未确认");
    expect(transport.requests("POST", "/topic/confirm")).toHaveLength(0);
  });

  it("Skill 发送立即持久化，而应用建议只改本地 dirty buffer，直到步骤确认才写访谈", async () => {
    const transport = installLiveFetch();
    render(<DigitalInterviewSetup interviewId={topicPendingInterview.interviewId} />);
    await waitFor(() => expect(transport.requests("GET", `/interviews/digital/${topicPendingInterview.interviewId}`)).toHaveLength(1));
    await screen.findByTestId("itv-topic-input");

    fireEvent.change(screen.getByTestId("itv-skill-input"), { target: { value: "把主题改得可验证" } });
    fireEvent.click(screen.getByTestId("itv-skill-send"));
    await waitFor(() => expect(transport.requests("POST", "/skill/messages")).toHaveLength(1));
    expect(transport.requests("POST", `/interviews/digital/${topicPendingInterview.interviewId}/skill/messages`)[0]!.body).toMatchObject({
      text: "把主题改得可验证",
    });

    fireEvent.click(await screen.findByTestId("itv-skill-apply"));
    expect(screen.getByTestId("itv-topic-input")).toHaveValue("应用后的可验证主题");
    expect(transport.requests("POST", "/topic/confirm")).toHaveLength(0);
    fireEvent.click(screen.getByTestId("itv-confirm-topic"));
    await waitFor(() => expect(transport.requests("POST", "/topic/confirm")).toHaveLength(1));
    expect(transport.requests("POST", `/interviews/digital/${topicPendingInterview.interviewId}/topic/confirm`)[0]!.body).toMatchObject({
      topic: "应用后的可验证主题",
      expectedVersion: 41,
      requestId: expect.any(String),
    });
  });
});
