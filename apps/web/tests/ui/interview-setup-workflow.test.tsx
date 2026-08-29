import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { interview } from "@repo/contracts";
import type { z } from "zod";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { DigitalInterviewSetup } from "@/components/itv/digital-interview-setup";
import { createMockDigitalInterviewDraft } from "@/lib/mock/digital-interview-drafts";
import { MOCK_DIGITAL_EXPERTS } from "@/lib/mock/digital-expert-personas";

type LiveInterview = z.infer<typeof interview.DigitalInterviewWorkflowView>;

type PersistedLiveInterview = Omit<LiveInterview, "topic"> & {
  readonly topic: string;
};

const expertCandidate = {
  expertId: "catalog-expert-f04",
  agentDefinitionId: "agent-definition-f04",
  agentVersion: "agent-version-f04",
  initials: "EP",
  displayName: "服务端候选专家",
  role: "采购决策顾问",
  domains: ["采购"],
  materialContextPackId: "context-pack-f04",
  materialVersion: "material-version-f04",
  materialBoundary: "仅使用当前有权读取的材料",
  exploratory: true as const,
};

const defaultQuestion = {
  questionId: "catalog-question-f04",
  expertId: expertCandidate.expertId,
  order: 1,
  text: "服务端为候选专家生成的默认问题",
  purpose: "决策流程",
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
  scope: { kind: "none", projectId: null, researchProjectId: null },
  currentStep: "topic",
  revisionId: "revision-f04",
  topicVersionId: null,
  expertSnapshotVersionId: null,
  questionVersionId: null,
  expertCandidates: [],
  questions: [],
  questionCandidates: [],
  skillThreadId: "thread-f04",
  skillMessages: [],
  skillProposals: [],
};

const persistedInterview: PersistedLiveInterview = {
  ...topicPendingInterview,
  topic: "服务端恢复：谁拥有最终否决权？",
  status: "experts_pending",
  selectedExpertIds: [expertCandidate.expertId],
  version: 73,
  currentStep: "experts",
  revisionId: "revision-persisted",
  topicVersionId: "topic-version-persisted",
  expertSnapshotVersionId: null,
  expertCandidates: [expertCandidate],
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type FetchCall = { readonly method: string; readonly path: string; readonly body: unknown };

function proposal(status: z.infer<typeof interview.DigitalInterviewSkillProposal>["status"] = "proposed") {
  return {
    proposalId: "proposal-f04",
    sourceMessageId: "skill-assistant-f04",
    targetStep: "topic" as const,
    baseRevisionId: "revision-f04",
    patch: { topic: "应用后的可验证主题" },
    createdAt: "2026-08-15T00:00:00.000Z",
    status,
    appliedAt: status === "applied_to_draft" || status === "committed" ? "2026-08-15T00:01:00.000Z" : null,
    rejectedAt: status === "rejected" ? "2026-08-15T00:01:00.000Z" : null,
    committedVersionId: status === "committed" ? "topic-version-committed" : null,
  } as z.infer<typeof interview.DigitalInterviewSkillProposal>;
}

function installLiveFetch(initial: LiveInterview = topicPendingInterview, options: { readonly failTopicOnce?: boolean } = {}) {
  const calls: FetchCall[] = [];
  let view = initial;
  let failTopicOnce = options.failTopicOnce ?? false;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input.toString());
    const method = init?.method ?? "GET";
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
    calls.push({ method, path: url.pathname, body });
    if (method === "POST" && url.pathname.endsWith("/topic/confirm")) {
      if (failTopicOnce) {
        failTopicOnce = false;
        return json({ reasonCode: "DEPENDENCY_UNAVAILABLE" }, 503);
      }
      view = {
        ...view,
        topic: body.topic,
        status: "experts_pending",
        currentStep: "experts",
        topicVersionId: "topic-version-f04",
        selectedExpertIds: [],
        expertCandidates: [expertCandidate],
        version: view.version + 1,
      };
      return json(view, 201);
    }
    if (method === "POST" && url.pathname.endsWith("/experts/confirm")) {
      view = {
        ...view,
        expertCandidates: [...view.expertCandidates, ...(body.addedExperts ?? [])],
        selectedExpertIds: body.expertIds,
        status: "questions_pending",
        currentStep: "questions",
        expertSnapshotVersionId: "expert-version-f04",
        questionCandidates: [defaultQuestion],
        version: view.version + 1,
      };
      return json(view, 201);
    }
    if (method === "POST" && url.pathname.endsWith("/questions/confirm")) {
      view = {
        ...view,
        questions: body.questions,
        status: "running",
        currentStep: "runs",
        questionVersionId: "question-version-f04",
        version: view.version + 1,
      };
      return json(view, 201);
    }
    if (method === "POST" && url.pathname.endsWith("/skill/messages")) {
      view = {
        ...view,
        version: view.version + 1,
        skillMessages: [
          ...view.skillMessages,
          { messageId: "skill-user-f04", skillThreadId: view.skillThreadId, role: "user", text: body.text, createdAt: "2026-08-15T00:00:00.000Z" },
          { messageId: "skill-assistant-f04", skillThreadId: view.skillThreadId, role: "assistant", text: "我整理了一条建议。", createdAt: "2026-08-15T00:00:01.000Z" },
        ],
        skillProposals: [proposal()],
      };
      return json(view, 201);
    }
    if (method === "POST" && url.pathname.endsWith("/proposals/proposal-f04/apply")) {
      view = { ...view, version: view.version + 1, skillProposals: [proposal("applied_to_draft")] };
      return json(view, 201);
    }
    if (method === "POST" && url.pathname.endsWith("/proposals/proposal-f04/reject")) {
      view = { ...view, version: view.version + 1, skillProposals: [proposal("rejected")] };
      return json(view, 201);
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
    push.mockReset();
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

  it("添加专家展示静态专家列表，并把勾选快照随确认命令提交", async () => {
    const transport = installLiveFetch();
    render(<DigitalInterviewSetup interviewId={topicPendingInterview.interviewId} />);
    fireEvent.change(await screen.findByTestId("itv-topic-input"), { target: { value: "验证服务端候选" } });
    fireEvent.click(screen.getByTestId("itv-confirm-topic"));

    expect(await screen.findByText(expertCandidate.displayName)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("itv-add-expert"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("添加访谈专家")).toBeInTheDocument();
    expect(screen.queryAllByText(expertCandidate.displayName)).toHaveLength(1);
    fireEvent.change(screen.getByTestId("itv-expert-picker-search"), { target: { value: "陈宇轩" } });
    fireEvent.click(screen.getByLabelText("选择专家 陈宇轩"));
    fireEvent.click(screen.getByTestId("itv-expert-picker-confirm"));
    expect(await screen.findByText("陈宇轩")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("itv-confirm-experts"));
    expect(await screen.findByDisplayValue(defaultQuestion.text)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("itv-confirm-questions"));

    await waitFor(() => expect(transport.requests("POST", "/experts/confirm")).toHaveLength(1));
    const confirmBody = interview.operations.confirmDigitalInterviewExperts.in.parse({
      interviewId: topicPendingInterview.interviewId,
      ...transport.requests("POST", "/experts/confirm")[0]!.body as Record<string, unknown>,
    });
    expect(confirmBody).toMatchObject({
      expertIds: [expertCandidate.expertId, expect.stringMatching(/^mock-persona:/)],
      addedExperts: [expect.objectContaining({ displayName: "陈宇轩", expertId: expect.stringMatching(/^mock-persona:/) })],
    });
    expect(Object.keys(confirmBody.addedExperts[0]!)).toEqual([
      "expertId", "agentDefinitionId", "agentVersion", "initials", "displayName", "role", "domains",
      "materialContextPackId", "materialVersion", "materialBoundary", "exploratory",
    ]);
    expect(confirmBody.addedExperts[0]).not.toHaveProperty("category");
    expect(confirmBody.addedExperts[0]).not.toHaveProperty("bio");
    expect(confirmBody.addedExperts[0]).not.toHaveProperty("location");
    expect(confirmBody.addedExperts[0]).not.toHaveProperty("typicalAdvice");
    expect(transport.requests("POST", "/questions/confirm")[0]!.body).toMatchObject({ questions: [defaultQuestion] });
  });

  it("模型生成专家和静态专家都可查看详情，且查看操作不触发删除", async () => {
    installLiveFetch();
    render(<DigitalInterviewSetup interviewId={topicPendingInterview.interviewId} />);
    fireEvent.change(await screen.findByTestId("itv-topic-input"), { target: { value: "验证专家详情" } });
    fireEvent.click(screen.getByTestId("itv-confirm-topic"));

    fireEvent.click(await screen.findByLabelText(`查看专家详情 ${expertCandidate.displayName}`));
    let dialog = await screen.findByTestId("itv-expert-detail-dialog");
    expect(within(dialog).getByText(expertCandidate.displayName)).toBeInTheDocument();
    expect(within(dialog).getByTestId("itv-expert-detail-role")).toHaveTextContent(expertCandidate.role);
    expect(within(dialog).getByTestId("itv-expert-detail-domains")).toHaveTextContent("采购");
    expect(within(dialog).getByTestId("itv-expert-detail-boundary")).toHaveTextContent(expertCandidate.materialBoundary);
    expect(within(dialog).getByText("模型生成专家快照")).toBeInTheDocument();
    expect(screen.getByLabelText(`删除专家 ${expertCandidate.displayName}`)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("itv-expert-detail-close"));

    const staticExpert = MOCK_DIGITAL_EXPERTS.find((expert) => expert.displayName === "陈宇轩")!;
    fireEvent.click(screen.getByTestId("itv-add-expert"));
    fireEvent.change(screen.getByTestId("itv-expert-picker-search"), { target: { value: staticExpert.displayName } });
    fireEvent.click(screen.getByLabelText(`选择专家 ${staticExpert.displayName}`));
    fireEvent.click(screen.getByTestId("itv-expert-picker-confirm"));
    fireEvent.click(await screen.findByLabelText(`查看专家详情 ${staticExpert.displayName}`));

    dialog = await screen.findByTestId("itv-expert-detail-dialog");
    expect(within(dialog).getByText("静态专家档案")).toBeInTheDocument();
    expect(within(dialog).getByTestId("itv-expert-detail-location")).toHaveTextContent(staticExpert.location);
    expect(within(dialog).getByTestId("itv-expert-detail-bio")).toHaveTextContent(staticExpert.bio);
    expect(within(dialog).getByTestId("itv-expert-detail-advice")).toHaveTextContent(staticExpert.typicalAdvice);
    fireEvent.click(screen.getByTestId("itv-expert-detail-close"));
    expect(screen.getByLabelText(`删除专家 ${staticExpert.displayName}`)).toBeInTheDocument();
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

    fireEvent.change(screen.getByTestId("itv-topic-input"), { target: { value: "当前未确认主题" } });
    fireEvent.change(screen.getByTestId("itv-skill-input"), { target: { value: "把主题改得可验证" } });
    fireEvent.click(screen.getByTestId("itv-skill-send"));
    await waitFor(() => expect(transport.requests("POST", "/skill/messages")).toHaveLength(1));
    expect(transport.requests("POST", `/interviews/digital/${topicPendingInterview.interviewId}/skill/messages`)[0]!.body).toMatchObject({
      text: "把主题改得可验证",
      currentStep: "topic",
      draftContext: { step: "topic", topic: "当前未确认主题" },
    });

    fireEvent.click(await screen.findByTestId("itv-skill-apply"));
    await waitFor(() => expect(screen.getByTestId("itv-topic-input")).toHaveValue("应用后的可验证主题"));
    expect(transport.requests("POST", "/topic/confirm")).toHaveLength(0);
    fireEvent.click(screen.getByTestId("itv-confirm-topic"));
    await waitFor(() => expect(transport.requests("POST", "/topic/confirm")).toHaveLength(1));
    expect(transport.requests("POST", `/interviews/digital/${topicPendingInterview.interviewId}/topic/confirm`)[0]!.body).toMatchObject({
      topic: "应用后的可验证主题",
      expectedVersion: 43,
      requestId: expect.any(String),
    });
  });

  it("dirty navigation can be cancelled or discarded without persisting the buffer", async () => {
    const transport = installLiveFetch();
    render(<DigitalInterviewSetup interviewId={topicPendingInterview.interviewId} />);
    await screen.findByTestId("itv-topic-input");
    fireEvent.change(screen.getByTestId("itv-topic-input"), { target: { value: "暂存主题" } });

    fireEvent.click(screen.getByTestId("itv-workflow-step-2"));
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(screen.getByTestId("itv-topic-input")).toHaveValue("暂存主题");

    fireEvent.click(screen.getByTestId("itv-workflow-step-2"));
    fireEvent.click(screen.getByRole("button", { name: "放弃更改" }));
    expect(await screen.findByTestId("itv-expert-step")).toBeInTheDocument();
    expect(transport.requests("POST", "/topic/confirm")).toHaveLength(0);
  });

  it("top-right return warns for dirty content and only navigates after discard", async () => {
    installLiveFetch();
    render(<DigitalInterviewSetup interviewId={topicPendingInterview.interviewId} />);
    fireEvent.change(await screen.findByTestId("itv-topic-input"), { target: { value: "返回前的草稿" } });

    fireEvent.click(screen.getByTestId("itv-return-history"));
    expect(await screen.findByRole("alert")).toHaveTextContent("未确认");
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    fireEvent.click(screen.getByTestId("itv-return-history"));
    fireEvent.click(screen.getByRole("button", { name: "放弃更改" }));
    expect(push).toHaveBeenCalledWith("/itv?tab=history");
  });

  it("retries a failed explicit confirmation with the same request id and preserves the buffer", async () => {
    const transport = installLiveFetch(topicPendingInterview, { failTopicOnce: true });
    render(<DigitalInterviewSetup interviewId={topicPendingInterview.interviewId} />);
    fireEvent.change(await screen.findByTestId("itv-topic-input"), { target: { value: "重试时不得丢失" } });
    fireEvent.click(screen.getByTestId("itv-confirm-topic"));
    expect(await screen.findByRole("alert")).toHaveTextContent("DEPENDENCY_UNAVAILABLE");
    expect(screen.getByTestId("itv-topic-input")).toHaveValue("重试时不得丢失");

    fireEvent.click(screen.getByTestId("itv-confirm-topic"));
    await waitFor(() => expect(transport.requests("POST", "/topic/confirm")).toHaveLength(2));
    const writes = transport.requests("POST", "/topic/confirm");
    expect((writes[0]!.body as { requestId: string }).requestId).toBe((writes[1]!.body as { requestId: string }).requestId);
  });

  it("rejects a Skill proposal persistently and does not offer stale proposals for application", async () => {
    const transport = installLiveFetch({ ...topicPendingInterview, skillProposals: [proposal("stale")] });
    render(<DigitalInterviewSetup interviewId={topicPendingInterview.interviewId} />);
    await screen.findByTestId("itv-topic-input");
    expect(screen.queryByTestId("itv-skill-apply")).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId("itv-skill-input"), { target: { value: "请给建议" } });
    fireEvent.click(screen.getByTestId("itv-skill-send"));
    fireEvent.click(await screen.findByTestId("itv-skill-reject"));
    await waitFor(() => expect(transport.requests("POST", "/proposals/proposal-f04/reject")).toHaveLength(1));
    expect(screen.getByTestId("itv-skill-proposal-proposal-f04")).toHaveTextContent("已拒绝");
  });

  it("warns before browser unload while a live step buffer is dirty", async () => {
    installLiveFetch();
    render(<DigitalInterviewSetup interviewId={topicPendingInterview.interviewId} />);
    fireEvent.change(await screen.findByTestId("itv-topic-input"), { target: { value: "不能静默丢失" } });
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
