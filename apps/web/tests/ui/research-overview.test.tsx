/**
 * 项目中枢 B2-S3（#4427）—— 研究总览三块接真实项目记忆：洞察库 / 洞察来源分布 / 尚未验证的假设。
 * 规则全在 `research-overview.tsx` 头注；这里逐条验：计数真实、观察者裁剪、未验证判定与排序、
 * 三个按钮各自打对客户端、403 如实上屏、空数据三处空态。
 */
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiError, SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

const fetchProjectKnowledge = vi.fn();
const fetchClaimSources = vi.fn();
const getProjectTopic = vi.fn();
const saveProjectTopic = vi.fn();
const createDigitalInterviewDraft = vi.fn();
const createTask = vi.fn();
const push = vi.fn();

vi.mock("next/navigation", () => ({ usePathname: () => "/projects/p1", useRouter: () => ({ push, replace: vi.fn() }) }));
vi.mock("@/lib/knowledge-graph-api", async (orig) => ({
  ...(await orig<typeof import("@/lib/knowledge-graph-api")>()),
  fetchProjectKnowledge: (...a: unknown[]) => fetchProjectKnowledge(...a),
  fetchClaimSources: (...a: unknown[]) => fetchClaimSources(...a),
}));
vi.mock("@/lib/live-project-prep", () => ({
  getProjectTopic: (...a: unknown[]) => getProjectTopic(...a),
  saveProjectTopic: (...a: unknown[]) => saveProjectTopic(...a),
}));
vi.mock("@/lib/interview-api", () => ({
  createDigitalInterviewDraft: (...a: unknown[]) => createDigitalInterviewDraft(...a),
}));
vi.mock("@/lib/live-tasks", () => ({
  createTask: (...a: unknown[]) => createTask(...a),
}));
vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => ({ session: { userId: "u-me", currentOrgId: "org-e2e-demo" } }),
  useSession: () => ({ session: { userId: "u-me", currentOrgId: "org-e2e-demo" } }),
}));

import { ResearchOverview } from "@/components/project/research-overview";

const SCOPE = { kind: "project", id: "p1" } as const;
type ClaimOverrides = Partial<{
  kind: string; triState: "pending" | "confirmed" | "conflict"; createdBy: "human" | "model" | "import";
  reviewedBy: string | null; supportingCount: number; contradictingCount: number;
}>;
const claim = (id: string, statement: string, o: ClaimOverrides = {}) => ({
  id, scope: SCOPE, kind: o.kind ?? "fact", statement, status: "accepted", triState: o.triState ?? "confirmed", confidence: 1,
  createdBy: o.createdBy ?? "human", reviewedBy: o.reviewedBy === undefined ? "u1" : o.reviewedBy,
  supersedesClaimId: null, derivedFromClaimId: "c0", aboutObjectIds: [],
  supportingCount: o.supportingCount ?? 2, contradictingCount: o.contradictingCount ?? 0, createdAt: "2026-09-27T00:00:00Z",
});

/** 6 条：3 条强（真人复核 + ≥2 支持 + 0 反对：d1 / f1 / h-ok，f1 是模型记下、真人复核过），3 条未验证猜测（净证据 -1 / 0 / 1）。 */
const KNOWLEDGE = {
  scope: SCOPE, revision: 7, objects: [], edges: [],
  claims: [
    claim("d1", "先做德国工商业", { kind: "decision" }),
    claim("f1", "并网周期是首要阻碍", { kind: "fact", createdBy: "model" }),
    claim("h-ok", "德国业主看重工期承诺", { kind: "hypothesis", supportingCount: 3 }),
    claim("h-mid", "意大利渠道商愿意分销", { kind: "hypothesis", reviewedBy: null, createdBy: "model", triState: "pending", supportingCount: 1, contradictingCount: 1 }),
    claim("h-weak", "业主愿为工期承诺付溢价", { kind: "hypothesis", reviewedBy: null, createdBy: "model", triState: "pending", supportingCount: 0, contradictingCount: 1 }),
    claim("h-conf", "先做德国还是意大利", { kind: "hypothesis", triState: "conflict", createdBy: "import", supportingCount: 2, contradictingCount: 1 }),
  ],
};

describe("B2-S3 研究总览三块", () => {
  beforeEach(() => {
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok");
    for (const m of [fetchProjectKnowledge, fetchClaimSources, getProjectTopic, saveProjectTopic, createDigitalInterviewDraft, createTask, push]) m.mockReset();
    fetchProjectKnowledge.mockResolvedValue(KNOWLEDGE);
  });

  it("三块都用真实计数渲染；洞察库可按类型与来源筛选，「来源」打开抽屉", async () => {
    fetchClaimSources.mockResolvedValue({
      claim: KNOWLEDGE.claims[1], provenance: [],
      evidence: [{ segmentId: "m1", stance: "supporting", sourceKind: "chat_message", sourceRef: "m1", excerpt: "客户说并网要等九个月", locator: null, revoked: false }],
    });
    render(<ResearchOverview view="facilitator" projectId="p1" />);
    const insights = await screen.findByTestId("project-research-insights-list");
    expect(within(insights).getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByTestId("project-research-insight-f1")).toHaveTextContent("+2 / −0");
    expect(screen.getByTestId("project-research-insight-f1")).toHaveTextContent("事实");

    // 来源分布：按谁记下 2 真人 / 3 模型 / 1 导入；按状态 3 确认 / 2 待定 / 1 矛盾 → 强 3（d1、f1、h-ok）弱 3
    const sources = screen.getByTestId("project-research-sources");
    expect(within(sources).getByTestId("project-research-sources-creator-human")).toHaveTextContent("真人 2");
    expect(within(sources).getByTestId("project-research-sources-creator-model")).toHaveTextContent("模型 3");
    expect(within(sources).getByTestId("project-research-sources-creator-import")).toHaveTextContent("导入 1");
    expect(within(sources).getByTestId("project-research-sources-kind-hypothesis")).toHaveTextContent("猜测 4");
    expect(within(sources).getByTestId("project-research-sources-tri-conflict")).toHaveTextContent("有矛盾 1");
    expect(within(sources).getByTestId("project-research-sources-strong")).toHaveTextContent("强 3");
    expect(within(sources).getByTestId("project-research-sources-weak")).toHaveTextContent("弱 3");
    expect(sources).toHaveTextContent("强 = 真人复核过、至少 2 条支持证据、没有反对证据");
    expect(screen.queryByTestId("project-research-sources-empty")).toBeNull();

    // 筛选：类型 = 猜测 → 4；来源 = 真人确认 → 猜测里复核过的 2（h-ok、h-conf）；有矛盾 → 1
    fireEvent.click(screen.getByTestId("project-research-insights-kind-hypothesis"));
    expect(within(screen.getByTestId("project-research-insights-list")).getAllByRole("listitem")).toHaveLength(4);
    fireEvent.click(screen.getByTestId("project-research-insights-source-human"));
    expect(within(screen.getByTestId("project-research-insights-list")).getAllByRole("listitem").map((li) => li.getAttribute("data-testid")))
      .toEqual(["project-research-insight-h-ok", "project-research-insight-h-conf"]);
    fireEvent.click(screen.getByTestId("project-research-insights-source-ai"));
    expect(within(screen.getByTestId("project-research-insights-list")).getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(screen.getByTestId("project-research-insights-kind-all"));
    fireEvent.click(screen.getByTestId("project-research-insights-source-conflict"));
    expect(within(screen.getByTestId("project-research-insights-list")).getAllByRole("listitem")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("project-research-insights-source-all"));

    fireEvent.click(within(screen.getByTestId("project-research-insights")).getByTestId("project-research-sources-f1"));
    expect(fetchClaimSources).toHaveBeenCalledWith("f1");
    expect(await screen.findByText("客户说并网要等九个月")).toBeInTheDocument();
  });

  it("尚未验证的假设：只挑没复核 / 支持不足 2 / 有反对的猜测，按 支持 − 反对 升序", async () => {
    render(<ResearchOverview view="member" projectId="p1" />);
    const list = await screen.findByTestId("project-research-unverified-list");
    expect(within(list).getAllByRole("listitem").map((li) => li.getAttribute("data-testid")))
      .toEqual(["project-research-unverified-h-weak", "project-research-unverified-h-mid", "project-research-unverified-h-conf"]);
    expect(screen.queryByTestId("project-research-unverified-h-ok")).toBeNull();
    expect(screen.getByTestId("project-research-unverified")).toHaveTextContent("没人复核过、支持证据不足 2 条、或有反对证据");
    // 非引导者没有「加入定题」；其余两个按钮在
    expect(screen.queryByTestId("project-research-topic-h-weak")).toBeNull();
    expect(screen.getByTestId("project-research-verify-h-weak")).toBeEnabled();
    expect(screen.getByTestId("project-research-task-h-weak")).toBeEnabled();
  });

  it("观察者：洞察库与未验证假设整块消失，只剩来源分布 + 裁剪说明", async () => {
    render(<ResearchOverview view="observer" projectId="p1" />);
    await screen.findByTestId("project-research-sources-strong");
    expect(screen.getByTestId("project-research-observer-notice")).toBeInTheDocument();
    expect(screen.queryByTestId("project-research-insights")).toBeNull();
    expect(screen.queryByTestId("project-research-unverified")).toBeNull();
    expect(screen.getByTestId("project-research-sources")).toBeInTheDocument();
  });

  it("加入定题（引导者）：读定题 → 背景追加一行 → 带 revision 保存；VERSION_CHANGED 提示重试", async () => {
    getProjectTopic.mockResolvedValue({ topicId: "t1", title: "欧洲进入策略", background: "已有背景", revision: "r9" });
    saveProjectTopic.mockResolvedValue({ topicId: "t1", syncedTo: ["grouping", "agenda", "ai-context"] });
    render(<ResearchOverview view="facilitator" projectId="p1" />);
    fireEvent.click(await screen.findByTestId("project-research-topic-h-weak"));
    expect(await screen.findByTestId("project-research-action-ok-h-weak")).toHaveTextContent("已加入定题背景");
    expect(getProjectTopic).toHaveBeenCalledWith("p1");
    expect(saveProjectTopic).toHaveBeenCalledWith({
      projectId: "p1", title: "欧洲进入策略", background: "已有背景\n业主愿为工期承诺付溢价", expectedTopicRevision: "r9",
    });

    saveProjectTopic.mockRejectedValueOnce(new ApiError(409, "VERSION_CHANGED", {}));
    fireEvent.click(screen.getByTestId("project-research-topic-h-mid"));
    expect(await screen.findByTestId("project-research-action-error-h-mid")).toHaveTextContent("请重试");
  });

  it("安排真人验证：以假设为名建项目下的访谈草稿，然后跳到设置页", async () => {
    createDigitalInterviewDraft.mockResolvedValue({ interviewId: "itv-9" });
    render(<ResearchOverview view="member" projectId="p1" />);
    fireEvent.click(await screen.findByTestId("project-research-verify-h-weak"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/itv/itv-9/setup"));
    expect(createDigitalInterviewDraft).toHaveBeenCalledTimes(1);
    const payload = createDigitalInterviewDraft.mock.calls[0]?.[0] as { name: string; tags: string[]; scope: unknown; requestId: string };
    expect(payload.name).toBe("业主愿为工期承诺付溢价");
    expect(payload.tags).toEqual([]);
    expect(payload.scope).toEqual({ kind: "project", projectId: "p1", researchProjectId: null });
    expect(payload.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("派任务重新核实：负责人 = 当前登录用户，标题带「重新核实：」，成功显示已建待办", async () => {
    createTask.mockResolvedValue({ id: "task-1", status: "todo", sourceKind: "manual" });
    render(<ResearchOverview view="member" projectId="p1" />);
    fireEvent.click(await screen.findByTestId("project-research-task-h-mid"));
    expect(await screen.findByTestId("project-research-action-ok-h-mid")).toHaveTextContent("已建待办");
    expect(createTask).toHaveBeenCalledWith({ projectId: "p1", title: "重新核实：意大利渠道商愿意分销", ownerUserId: "u-me" });
    const sent = createTask.mock.calls[0]?.[0] as { status?: string };
    expect(sent.status).not.toBe("inbox");
  });

  it("按钮 403：如实上屏一句人话，不崩、不显示错误码", async () => {
    createTask.mockRejectedValue(new ApiError(403, "NO_PROJECT_ROLE", {}));
    createDigitalInterviewDraft.mockRejectedValue(new ApiError(403, null, {}));
    render(<ResearchOverview view="member" projectId="p1" />);
    fireEvent.click(await screen.findByTestId("project-research-task-h-weak"));
    const err = await screen.findByTestId("project-research-action-error-h-weak");
    expect(err).toHaveTextContent("登录状态过期了");
    expect(err).not.toHaveTextContent("NO_PROJECT_ROLE");
    fireEvent.click(screen.getByTestId("project-research-verify-h-mid"));
    expect(await screen.findByTestId("project-research-action-error-h-mid")).toHaveTextContent("登录状态过期了");
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByTestId("project-research-unverified-list")).toBeInTheDocument();
  });

  it("readOnly：三个按钮全部禁用", async () => {
    render(<ResearchOverview view="facilitator" readOnly projectId="p1" />);
    expect(await screen.findByTestId("project-research-topic-h-weak")).toBeDisabled();
    expect(screen.getByTestId("project-research-verify-h-weak")).toBeDisabled();
    expect(screen.getByTestId("project-research-task-h-weak")).toBeDisabled();
  });

  it("项目里什么都没记下 ⇒ 三处如实空态", async () => {
    fetchProjectKnowledge.mockResolvedValue({ scope: SCOPE, revision: 0, objects: [], claims: [], edges: [] });
    render(<ResearchOverview view="facilitator" projectId="p1" />);
    expect(await screen.findByTestId("project-research-insights-empty")).toBeInTheDocument();
    expect(screen.getByTestId("project-research-sources-empty")).toBeInTheDocument();
    expect(screen.getByTestId("project-research-unverified-empty")).toBeInTheDocument();
  });

  it("读取被拒（403 KG_NOT_VISIBLE）⇒ 如实显示，可重试", async () => {
    fetchProjectKnowledge.mockRejectedValue(new ApiError(403, "KG_NOT_VISIBLE", {}));
    render(<ResearchOverview view="member" projectId="p1" />);
    expect(await screen.findByTestId("project-research-error")).toHaveTextContent("你不在这个项目里");
    expect(screen.getByTestId("project-research-retry")).toBeInTheDocument();
  });
});
