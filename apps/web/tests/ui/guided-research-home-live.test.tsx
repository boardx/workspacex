import { runtimeFixture } from "../guided-runtime-fixture";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GuidedResearchFlow } from "@/components/research-studio/guided-research-flow";

const { executeResearchRuntime, getResearchRuntime, listGuidedResearchSessions, createGuidedResearchSession, getGuidedResearchSession, finishGuidedResearchCollection, completeGuidedResearchSession, updateGuidedResearchMetadata } = vi.hoisted(() => ({
  executeResearchRuntime: vi.fn(),
  getResearchRuntime: vi.fn(),
  listGuidedResearchSessions: vi.fn(),
  createGuidedResearchSession: vi.fn(),
  getGuidedResearchSession: vi.fn(),
  finishGuidedResearchCollection: vi.fn(),
  completeGuidedResearchSession: vi.fn(),
  updateGuidedResearchMetadata: vi.fn(),
}));

vi.mock("@/lib/guided-research-api", () => ({
  executeResearchRuntime,
  getResearchRuntime,  listGuidedResearchSessions,
  createGuidedResearchSession,
  getGuidedResearchSession,
  finishGuidedResearchCollection,
  completeGuidedResearchSession,
  updateGuidedResearchMetadata,
}));

function createdSession(sessionId: string) {
  return {
    sessionId,
    title: "欧洲储能进入研究",
    tags: ["欧洲", "储能"],
    brief: {
      topic: "新的研究主题",
      goal: "判断市场机会",
      timeRange: "2025",
      region: "欧洲",
      focus: "储能",
    },
    briefVersion: 1,
    briefConfirmedAt: "2026-08-13T00:00:00.000Z",
    directions: { candidateVersion: null, confirmedVersion: null, versions: [] },
    outline: { candidateVersion: null, confirmedVersion: null, versions: [] },
    stage: "directions",
    resumeStage: "directions",
    status: "active",
    progress: 20,
    sourceCount: 0,
    reportId: null,
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
  };
}

function unstartedRuntime(sessionId: string) {
  const state = runtimeFixture("brief", sessionId);
  if (!state.sourcePolicy) throw new Error("fixture_requires_source_policy");
  return { ...state, sourcePolicy: state.sourcePolicy, version: 0, directions: [], outline: [], generatedNodes: [], modelCalls: [], tasks: [], sources: [] };
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  listGuidedResearchSessions.mockReset();
  createGuidedResearchSession.mockReset();
  getGuidedResearchSession.mockReset();
  getResearchRuntime.mockReset();
  executeResearchRuntime.mockReset();
  getResearchRuntime.mockImplementation(async (sessionId: string) => unstartedRuntime(sessionId));
  executeResearchRuntime.mockImplementation(async ({ sessionId, action, sourcePolicy }: { sessionId: string; action?: string; sourcePolicy?: ReturnType<typeof runtimeFixture>["sourcePolicy"] }) => {
    if (action === "refine_source_policy") {
      const previous = await getResearchRuntime.mock.results.at(-1)?.value;
      return { ...previous, version: previous.version + 1, sourcePolicy, errorCode: null };
    }
    return runtimeFixture("directions", sessionId);
  });
  finishGuidedResearchCollection.mockReset();
  completeGuidedResearchSession.mockReset();
  updateGuidedResearchMetadata.mockReset();
  updateGuidedResearchMetadata.mockResolvedValue(undefined);
  listGuidedResearchSessions.mockResolvedValue({ items: [] });
});

describe("F168 guided research home live data", () => {
  it("keeps creation in the header for both empty and populated history", async () => {
    const change = vi.fn();
    render(<GuidedResearchFlow step="home" onStepChange={change} />);
    const empty = await screen.findByTestId("research-history-empty");
    expect(empty.querySelector("a,button")).toBeNull();
    expect(screen.queryByTestId("research-create-card")).toBeNull();
    fireEvent.click(screen.getByTestId("research-create"));
    expect(screen.getByTestId("research-create")).toHaveAttribute("href", "/research/new");
    expect(change).not.toHaveBeenCalled();
  });

  it("enters intake directly without a metadata dialog or stale creation draft", () => {
    const onStepChange = vi.fn();
    render(<GuidedResearchFlow step="home" onStepChange={onStepChange} />);

    sessionStorage.setItem("wsx.guidedResearch.createDraft", JSON.stringify({ title: "旧草稿", tags: ["旧标签"] }));
    fireEvent.click(screen.getByTestId("research-create"));
    expect(screen.getByTestId("research-create")).toHaveAttribute("href", "/research/new");
    expect(screen.queryByTestId("research-create-dialog")).not.toBeInTheDocument();
    expect(sessionStorage.getItem("wsx.guidedResearch.createDraft")).toBeNull();
    expect(onStepChange).not.toHaveBeenCalled();
  });

  it("renders server history and resumes from the server-authored stage", async () => {
    listGuidedResearchSessions.mockResolvedValueOnce({
      items: [
        {
          sessionId: "grs-running", title: "德国工商储电价机制", tags: [], brief: {
            topic: "德国工商储电价机制", goal: "判断市场机会", timeRange: "2025", region: "德国", focus: "电价",
          }, stage: "researching", resumeStage: "researching", status: "active", progress: 64, sourceCount: 19, reportId: null,
          createdAt: "2026-08-11T09:00:00.000Z", updatedAt: "2026-08-12T09:00:00.000Z",
        },
        {
          sessionId: "grs-done", title: "欧洲并网审批流程", tags: [], brief: {
            topic: "欧洲并网审批流程", goal: "形成报告", timeRange: "2025", region: "欧洲", focus: "审批",
          }, stage: "report", resumeStage: "report", status: "completed", progress: 100, sourceCount: 33, reportId: "report-1",
          createdAt: "2026-08-10T09:00:00.000Z", updatedAt: "2026-08-12T08:00:00.000Z",
        },
      ],
    });
    const onStepChange = vi.fn();
    render(<GuidedResearchFlow step="home" onStepChange={onStepChange} />);

    await waitFor(() => expect(screen.getByTestId("research-history-grs-running")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("research-continue-grs-running"));
    expect(onStepChange).toHaveBeenCalledWith("search", "grs-running");
    fireEvent.click(screen.getByTestId("research-view-grs-done"));
    expect(onStepChange).toHaveBeenCalledWith("report", "grs-done");
  });

  it("shows the real workflow stage and a specific next action instead of an opaque percentage", async () => {
    listGuidedResearchSessions.mockResolvedValueOnce({
      items: [{
        ...createdSession("grs-outline"),
        stage: "outline",
        resumeStage: "outline",
        progress: 40,
      }],
    });
    const onStepChange = vi.fn();
    render(<GuidedResearchFlow step="home" onStepChange={onStepChange} />);

    const card = await screen.findByTestId("research-history-grs-outline");
    expect(card).toHaveTextContent("研究计划");
    expect(card).toHaveTextContent("第 2 / 3 步");
    fireEvent.click(screen.getByRole("button", { name: "查看研究计划" }));
    expect(onStepChange).toHaveBeenCalledWith("outline", "grs-outline");
  });

  it("warns when evidence is missing and never presents high progress as healthy", async () => {
    listGuidedResearchSessions.mockResolvedValueOnce({
      items: [{
        ...createdSession("grs-evidence-gap"),
        stage: "report",
        resumeStage: "report",
        progress: 90,
        sourceCount: 0,
      }],
    });
    render(<GuidedResearchFlow step="home" onStepChange={vi.fn()} />);

    const card = await screen.findByTestId("research-history-grs-evidence-gap");
    expect(card).toHaveTextContent("证据缺口");
    expect(card).toHaveTextContent("报告阶段尚无可用来源");
    expect(card).not.toHaveTextContent("90%");
    expect(screen.getByRole("button", { name: "查看研究报告" })).toBeInTheDocument();
  });

  it("does not flag a fresh researching run with zero sources as an evidence gap", async () => {
    listGuidedResearchSessions.mockResolvedValueOnce({
      items: [{
        ...createdSession("grs-collecting"),
        stage: "researching",
        resumeStage: "researching",
        progress: 60,
        sourceCount: 0,
      }],
    });
    render(<GuidedResearchFlow step="home" onStepChange={vi.fn()} />);

    const card = await screen.findByTestId("research-history-grs-collecting");
    expect(card).not.toHaveTextContent("证据缺口");
    expect(card).toHaveTextContent("0 个来源");
    expect(card).not.toHaveTextContent("正在收集证据，尚无来源");
    expect(screen.getByTestId("research-home-summary")).toHaveTextContent("需要处理0");
  });

  it("summarizes work that needs attention before the full research library", async () => {
    listGuidedResearchSessions.mockResolvedValueOnce({ items: [
      { ...createdSession("grs-active"), stage: "researching", resumeStage: "researching", progress: 70, sourceCount: 12 },
      { ...createdSession("grs-risk"), title: "缺少证据的报告", stage: "report", resumeStage: "report", progress: 90, sourceCount: 0 },
      { ...createdSession("grs-complete"), title: "已完成研究", stage: "report", resumeStage: "report", status: "completed", progress: 100, sourceCount: 18, reportId: "report-1" },
    ] });
    render(<GuidedResearchFlow step="home" onStepChange={vi.fn()} />);

    expect(await screen.findByTestId("research-home-summary")).toHaveTextContent("进行中2");
    expect(screen.getByTestId("research-home-summary")).toHaveTextContent("需要处理1");
    expect(screen.getByTestId("research-home-summary")).toHaveTextContent("已完成1");
    expect(screen.getByTestId("research-stage-grs-complete")).toHaveTextContent("第 3 / 3 步");
  });

  it("uses the status summary to filter the library and composes it with search", async () => {
    listGuidedResearchSessions.mockResolvedValueOnce({ items: [
      { ...createdSession("grs-active"), title: "欧洲活跃研究", stage: "researching", resumeStage: "researching", progress: 70, sourceCount: 12 },
      { ...createdSession("grs-risk"), title: "欧洲证据缺口", stage: "report", resumeStage: "report", progress: 90, sourceCount: 0 },
      { ...createdSession("grs-complete"), title: "亚洲已完成研究", stage: "report", resumeStage: "report", status: "completed", progress: 100, sourceCount: 18, reportId: "report-1" },
    ] });
    render(<GuidedResearchFlow step="home" onStepChange={vi.fn()} />);

    await screen.findByTestId("research-history-grs-active");
    const attention = screen.getByRole("button", { name: /需要处理 1 项研究/ });
    fireEvent.click(attention);
    expect(attention).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("research-history-grs-risk")).toBeInTheDocument();
    expect(screen.queryByTestId("research-history-grs-active")).not.toBeInTheDocument();
    expect(screen.queryByTestId("research-history-grs-complete")).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId("research-history-search"), { target: { value: "亚洲" } });
    expect(screen.getByTestId("research-history-empty")).toHaveTextContent("当前状态筛选与搜索条件下没有研究");
    fireEvent.click(screen.getByRole("button", { name: "清除状态筛选" }));
    expect(screen.getByTestId("research-history-grs-complete")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "清除状态筛选" })).not.toBeInTheDocument();
  });

  it("combines tag and content filters and changes history sort order", async () => {
    listGuidedResearchSessions.mockResolvedValueOnce({ items: [
      { ...createdSession("grs-old"), updatedAt: "2026-08-10T00:00:00.000Z" },
      { ...createdSession("grs-new"), title: "采购访谈研究", tags: ["采购"], updatedAt: "2026-08-15T00:00:00.000Z" },
    ] });
    render(<GuidedResearchFlow step="home" onStepChange={vi.fn()} />);
    await screen.findByTestId("research-history-grs-old");
    const cards = () => screen.getAllByTestId(/^research-history-grs-/).map(card => card.dataset.testid);
    expect(cards()).toEqual(["research-history-grs-new", "research-history-grs-old"]);
    fireEvent.click(screen.getByTestId("research-history-sort"));
    expect(cards()).toEqual(["research-history-grs-old", "research-history-grs-new"]);
    fireEvent.click(screen.getByTestId("research-history-tag-欧洲"));
    expect(cards()).toEqual(["research-history-grs-old"]);
    fireEvent.change(screen.getByTestId("research-history-search"), { target: { value: "采购" } });
    expect(screen.getByTestId("research-history-empty")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(screen.getByTestId("research-history-search")).toHaveValue("");
    expect(cards()).toEqual(["research-history-grs-old", "research-history-grs-new"]);
  });

  it("uses the shared Studio list-page width and card density", async () => {
    listGuidedResearchSessions.mockResolvedValueOnce({
      items: [{
        sessionId: "grs-style", title: "欧洲储能进入研究", tags: ["欧洲"], brief: {
          topic: "欧洲储能进入研究", goal: "判断市场机会", timeRange: "2025", region: "欧洲", focus: "储能",
        }, stage: "directions", resumeStage: "directions", status: "active", progress: 20, sourceCount: 3, reportId: null,
        createdAt: "2026-08-10T09:00:00.000Z", updatedAt: "2026-08-12T08:00:00.000Z",
      }],
    });
    render(<GuidedResearchFlow step="home" onStepChange={vi.fn()} />);

    const page = screen.getByTestId("research-home-page");
    expect(page).toHaveClass("max-w-7xl", "p-4");
    expect(screen.queryByTestId("research-create-card")).toBeNull();
    expect(await screen.findByTestId("research-history-grs-style")).toHaveClass("rounded-card", "hover:border-input", "h-full");
  });

  it("keeps an active report-stage session resumable until its persisted status is completed", async () => {
    listGuidedResearchSessions.mockResolvedValueOnce({
      items: [{
        sessionId: "grs-report-active", title: "仍待完成的报告", tags: [], brief: {
          topic: "仍待完成的报告", goal: "确认结论", timeRange: "2025", region: "欧洲", focus: "政策",
        }, stage: "report", resumeStage: "report", status: "active", progress: 95, sourceCount: 12, reportId: null,
        createdAt: "2026-08-10T09:00:00.000Z", updatedAt: "2026-08-12T08:00:00.000Z",
      }],
    });
    const onStepChange = vi.fn();
    render(<GuidedResearchFlow step="home" onStepChange={onStepChange} />);

    await screen.findByTestId("research-history-grs-report-active");
    expect(screen.getByTestId("research-stage-grs-report-active")).toHaveTextContent("生成报告");
    fireEvent.click(screen.getByTestId("research-continue-grs-report-active"));
    expect(onStepChange).toHaveBeenCalledWith("report", "grs-report-active");
  });

  it("creates a concise default title without deriving it from a long requirement", async () => {
    createGuidedResearchSession.mockResolvedValueOnce(createdSession("grs-concise"));
    const goal = "公开合成长需求。".repeat(5000);
    render(<GuidedResearchFlow step="brief" onStepChange={vi.fn()} />);
    fireEvent.change(screen.getByTestId("research-brief-topic"), { target: { value: "" } });
    fireEvent.change(screen.getByTestId("research-brief-goal"), { target: { value: goal } });
    fireEvent.click(screen.getByTestId("research-confirm-brief"));
    await waitFor(() => expect(createGuidedResearchSession).toHaveBeenCalledTimes(1));
    expect(createGuidedResearchSession).toHaveBeenCalledWith(expect.objectContaining({ title: "新建研究", brief: expect.objectContaining({ topic: "新建研究", goal }) }));
  });
  it("creates a persisted session before entering directions", async () => {
    createGuidedResearchSession.mockResolvedValueOnce(createdSession("grs-new"));
    const persisted = unstartedRuntime("grs-new");
    executeResearchRuntime.mockResolvedValueOnce({ ...persisted, version: 1,
      sourcePolicy: { ...persisted.sourcePolicy, mode: "open", revision: persisted.sourcePolicy.revision + 1 } });
    const onStepChange = vi.fn();
    window.sessionStorage.setItem("wsx.guidedResearch.createDraft", JSON.stringify({
      title: "欧洲储能进入研究", tags: ["欧洲", "储能"],
    }));
    render(<GuidedResearchFlow step="brief" onStepChange={onStepChange} />);

    fireEvent.change(screen.getByTestId("research-brief-topic"), { target: { value: "新的研究主题" } });
    fireEvent.click(screen.getByTestId("research-confirm-brief"));

    await waitFor(() => expect(createGuidedResearchSession).toHaveBeenCalledTimes(1));
    expect(createGuidedResearchSession).toHaveBeenCalledWith(expect.objectContaining({
      title: "欧洲储能进入研究",
      tags: ["欧洲", "储能"],
      idempotencyKey: expect.any(String),
      brief: expect.objectContaining({ topic: "新的研究主题" }),
    }));
    await waitFor(() => expect(onStepChange).toHaveBeenCalledWith("outline", "grs-new"));
    expect(executeResearchRuntime).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "grs-new", node: "brief", action: "refine_source_policy", expectedVersion: 0,
      expectedRevision: persisted.planRevision,
      sourcePolicy: { ...persisted.sourcePolicy, mode: "open", revision: persisted.sourcePolicy.revision + 1 },
    }));
    expect(executeResearchRuntime.mock.invocationCallOrder[0]!).toBeLessThan(onStepChange.mock.invocationCallOrder[0]!);
  });

  it("persists source policy before preparing the plan once and keeps the model response pending", async () => {
    createGuidedResearchSession.mockResolvedValueOnce(createdSession("grs-entry"));
    const initial = { ...unstartedRuntime("grs-entry"), brief: { ...runtimeFixture("brief").brief, goal: "核对具体政策" } };
    const persisted = { ...initial, version: 1, sourcePolicy: { ...initial.sourcePolicy, mode: "open" as const, revision: 2 } };
    getResearchRuntime.mockResolvedValue(initial);
    let resolve!: (value: ReturnType<typeof runtimeFixture>) => void;
    executeResearchRuntime.mockImplementationOnce(async () => { getResearchRuntime.mockResolvedValue(persisted); return persisted; })
      .mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    render(<GuidedResearchFlow step="brief" />);
    fireEvent.change(screen.getByTestId("research-brief-goal"), { target: { value: "核对具体政策" } });
    fireEvent.click(screen.getByTestId("research-confirm-brief"));
    expect(screen.getByText("正在分析研究需求…")).toBeInTheDocument();
    expect(screen.getByTestId("research-step-plan")).toHaveAttribute("aria-current", "step");
    expect(screen.getByTestId("research-step-plan")).toHaveAttribute("aria-disabled", "true");
    await waitFor(() => expect(executeResearchRuntime).toHaveBeenCalledTimes(2));
    expect(executeResearchRuntime.mock.calls[0]![0]).toMatchObject({
      sessionId: "grs-entry", node: "brief", action: "refine_source_policy", expectedVersion: 0,
      sourcePolicy: persisted.sourcePolicy,
    });
    expect(executeResearchRuntime.mock.calls[1]![0]).toMatchObject({
      sessionId: "grs-entry", node: "brief", action: "prepare_plan", expectedVersion: 1,
      draft: { node: "brief", value: expect.objectContaining({ goal: "核对具体政策" }) },
    });
    expect(window.location.pathname).toBe("/research/grs-entry/plan");
    resolve({ ...runtimeFixture("outline", "grs-entry"), sourcePolicy: persisted.sourcePolicy });
    await screen.findByTestId("guided-research-plan-panel");
  });

  it("opens the progressed session from an idempotent create replay without another confirmation", async () => {
    createGuidedResearchSession.mockResolvedValueOnce(createdSession("grs-existing"));
    getResearchRuntime.mockResolvedValueOnce(runtimeFixture("research", "grs-existing"));
    const navigate = vi.fn();
    render(<GuidedResearchFlow step="brief" onStepChange={navigate} />);
    fireEvent.click(screen.getByTestId("research-confirm-brief"));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("search", "grs-existing"));
    expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
    expect(executeResearchRuntime.mock.calls[0]![0]).toMatchObject({ node: "research", action: "refine_source_policy", sourcePolicy: { mode: "open" } });
    expect(executeResearchRuntime.mock.calls.some(([input]) => input.action === "prepare_plan")).toBe(false);
  });

  it("recovers a lost model response after persisting policy without replaying the model", async () => {
    createGuidedResearchSession.mockResolvedValueOnce(createdSession("grs-lost"));
    const initial = unstartedRuntime("grs-lost");
    const persisted = { ...initial, version: 1, sourcePolicy: { ...initial.sourcePolicy, mode: "open" as const, revision: 2 } };
    getResearchRuntime.mockResolvedValueOnce(initial).mockResolvedValueOnce(persisted)
      .mockResolvedValueOnce({ ...runtimeFixture("directions", "grs-lost"), sourcePolicy: persisted.sourcePolicy, errorCode: "RESEARCH_MODEL_UNAVAILABLE" });
    executeResearchRuntime.mockResolvedValueOnce(persisted).mockRejectedValueOnce(new Error("response lost"));
    render(<GuidedResearchFlow step="brief" />);
    fireEvent.click(screen.getByTestId("research-confirm-brief"));
    await screen.findByRole("alert");
    expect(window.location.pathname).toBe("/research/grs-lost/plan");
    expect(createGuidedResearchSession).toHaveBeenCalledTimes(1);
    expect(executeResearchRuntime.mock.calls.map(([input]) => input.action)).toEqual(["refine_source_policy", "prepare_plan"]);
    expect(getResearchRuntime).toHaveBeenCalledTimes(3);
  });

  it("retains the create identity when runtime reads fail and retries policy before navigating", async () => {
    createGuidedResearchSession.mockResolvedValue(createdSession("grs-offline"));
    getResearchRuntime.mockRejectedValue(new Error("offline"));
    const navigate = vi.fn();
    render(<GuidedResearchFlow step="brief" onStepChange={navigate} />);
    fireEvent.click(screen.getByTestId("research-confirm-brief"));
    await screen.findByRole("alert");
    expect(navigate).not.toHaveBeenCalled();
    expect(createGuidedResearchSession).toHaveBeenCalledTimes(1);
    expect(executeResearchRuntime).not.toHaveBeenCalled();
    const key = createGuidedResearchSession.mock.calls[0]![0].idempotencyKey;
    getResearchRuntime.mockResolvedValue({ ...runtimeFixture("brief", "grs-offline"), version: 0 });
    fireEvent.click(screen.getByTestId("research-confirm-brief"));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("outline", "grs-offline"));
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(createGuidedResearchSession.mock.calls.map(([input]) => input.idempotencyKey)).toEqual([key, key]);
    expect(executeResearchRuntime.mock.calls.map(([input]) => input.action)).toEqual(["refine_source_policy"]);
  });

  it.each(["create", "confirm"] as const)("ignores a delayed %s after leaving the entry screen", async (phase) => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise((done) => { resolve = done; });
    if (phase === "create") createGuidedResearchSession.mockReturnValueOnce(pending);
    else {
      createGuidedResearchSession.mockResolvedValueOnce(createdSession("grs-abandoned"));
      executeResearchRuntime.mockReturnValueOnce(pending);
    }
    render(<GuidedResearchFlow step="brief" />);
    fireEvent.click(screen.getByTestId("research-confirm-brief"));
    if (phase === "confirm") await waitFor(() => expect(executeResearchRuntime).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId("research-flow-back"));
    expect(await screen.findByTestId("research-flow-home")).toBeInTheDocument();
    await act(async () => { resolve(phase === "create" ? createdSession("grs-abandoned") : { ...runtimeFixture("brief", "grs-abandoned"), version: 1, sourcePolicy: { ...runtimeFixture().sourcePolicy, mode: "open", revision: 2 } }); });
    await waitFor(() => expect(screen.getByTestId("research-flow-home")).toBeInTheDocument());
    expect(executeResearchRuntime).toHaveBeenCalledTimes(phase === "create" ? 0 : 1);
    // No navigation published this identity: keep its key for an idempotent retry.
    expect(Object.keys(window.localStorage).some((key) => key.startsWith("wsx.guidedResearch.createIdempotencyKey."))).toBe(true);
  });

  it("uses the session URL to restore the server-authored stage", async () => {
    getGuidedResearchSession.mockResolvedValueOnce({
      sessionId: "grs-recover", title: "恢复中的研究", tags: [], brief: {
        topic: "恢复中的研究", goal: "继续检索", timeRange: "2026", region: "欧洲", focus: "政策",
      }, stage: "researching", resumeStage: "researching", status: "active", progress: 68, sourceCount: 27,
      reportId: null, createdAt: "2026-08-10T09:00:00.000Z", updatedAt: "2026-08-12T09:00:00.000Z",
    });

    getResearchRuntime.mockResolvedValueOnce(runtimeFixture("research", "grs-recover"));
    render(<GuidedResearchFlow step="search" sessionId="grs-recover" />);

    await waitFor(() => expect(getResearchRuntime).toHaveBeenCalledWith("grs-recover"));
    expect(await screen.findByTestId("research-flow-search")).toBeInTheDocument();
  });

  it("reuses the create idempotency key after remount and clears it only after success", async () => {
    createGuidedResearchSession
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce(createdSession("grs-replayed"));
    const first = render(<GuidedResearchFlow step="brief" onStepChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("research-confirm-brief"));
    await waitFor(() => expect(createGuidedResearchSession).toHaveBeenCalledTimes(1));
    const firstKey = createGuidedResearchSession.mock.calls[0]![0].idempotencyKey;
    expect(Object.values(window.localStorage).some((value) => value.includes(firstKey))).toBe(true);

    first.unmount();
    const onStepChange = vi.fn();
    render(<GuidedResearchFlow step="brief" onStepChange={onStepChange} />);
    fireEvent.click(screen.getByTestId("research-confirm-brief"));

    await waitFor(() => expect(createGuidedResearchSession).toHaveBeenCalledTimes(2));
    expect(createGuidedResearchSession.mock.calls[1]![0].idempotencyKey).toBe(firstKey);
    await waitFor(() => expect(onStepChange).toHaveBeenCalledWith("outline", "grs-replayed"));
    expect(Object.values(window.localStorage).some((value) => value.includes(firstKey))).toBe(false);
  });

  it("does not reuse an idempotency key after the brief changes into a different create intent", async () => {
    createGuidedResearchSession
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce(createdSession("grs-other"));
    const first = render(<GuidedResearchFlow step="brief" onStepChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("research-confirm-brief"));
    await waitFor(() => expect(createGuidedResearchSession).toHaveBeenCalledTimes(1));
    const firstKey = createGuidedResearchSession.mock.calls[0]![0].idempotencyKey;
    first.unmount();

    render(<GuidedResearchFlow step="brief" onStepChange={vi.fn()} />);
    fireEvent.change(screen.getByTestId("research-brief-topic"), { target: { value: "另一个研究主题" } });
    fireEvent.click(screen.getByTestId("research-confirm-brief"));
    await waitFor(() => expect(createGuidedResearchSession).toHaveBeenCalledTimes(2));
    expect(createGuidedResearchSession.mock.calls[1]![0].idempotencyKey).not.toBe(firstKey);
  });

  it("garbage-collects stale pending create keys", async () => {
    window.localStorage.setItem("wsx.guidedResearch.createIdempotencyKey.old-tab.old-intent", JSON.stringify({
      key: "guided-stale", createdAt: Date.now() - 25 * 60 * 60 * 1000,
    }));
    createGuidedResearchSession.mockRejectedValueOnce(new Error("offline"));
    render(<GuidedResearchFlow step="brief" onStepChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("research-confirm-brief"));
    await waitFor(() => expect(createGuidedResearchSession).toHaveBeenCalledTimes(1));
    expect(window.localStorage.getItem("wsx.guidedResearch.createIdempotencyKey.old-tab.old-intent")).toBeNull();
  });
});

it("returns a URL-opened report to history without reopening the stale session prop", async () => {
  window.history.replaceState({}, "", "/research?session=grs-opened");
  getResearchRuntime.mockImplementation(async (sessionId: string) => runtimeFixture("report", sessionId));
  const view = render(<GuidedResearchFlow step="home" sessionId="grs-opened" />);
  await screen.findByTestId("research-report-document");
  fireEvent.click(screen.getByRole("button", { name: "返回研究列表" }));
  expect(await screen.findByTestId("research-home-page")).toBeInTheDocument();
  expect(window.location.pathname + window.location.search).toBe("/research");
  view.rerender(<GuidedResearchFlow step="home" sessionId="grs-opened" />);
  expect(screen.queryByTestId("research-report-document")).not.toBeInTheDocument();
  expect(screen.queryByTestId("research-session-restore-loading")).not.toBeInTheDocument();
  view.rerender(<GuidedResearchFlow step="home" sessionId="grs-next" />);
  await waitFor(() => expect(getResearchRuntime).toHaveBeenLastCalledWith("grs-next"));
  expect(await screen.findByTestId("research-report-document")).toBeInTheDocument();
});

it("shows and searches the canonical generated topic for default-named list entries", async () => {
  const item = { ...createdSession("generated-name"), title: "已生成的独特主题" };
  listGuidedResearchSessions.mockResolvedValue({ items: [item] });
  getResearchRuntime.mockResolvedValue({ ...runtimeFixture("directions", item.sessionId), brief: { ...runtimeFixture().brief, topic: "已生成的独特主题" } });
  render(<GuidedResearchFlow step="home" onStepChange={vi.fn()} />);
  expect(await screen.findByText("已生成的独特主题")).toBeInTheDocument();
  fireEvent.change(screen.getByTestId("research-history-search"), { target: { value: "独特主题" } });
  expect(screen.getByTestId("research-history-generated-name")).toBeInTheDocument();
});

const legacyGoal = "公开合成需求。".repeat(30);
function legacyListItem(id: string) {
  return { ...createdSession(id), title: legacyGoal.slice(0, 100), brief: { ...createdSession(id).brief, goal: legacyGoal } };
}
it("keeps ambiguous historical names and renders default metadata fallback without hydration", async () => {
  const legacy = legacyListItem("legacy-name");
  const fallback = { ...createdSession("fallback"), title: "新建研究" };
  listGuidedResearchSessions.mockResolvedValue({ items: [legacy, fallback] });
  render(<GuidedResearchFlow step="home" />);
  expect(await screen.findByText(legacy.title)).toBeInTheDocument();
  expect(screen.getByTestId("research-history-fallback")).toHaveTextContent("新建研究");
  expect(getResearchRuntime).not.toHaveBeenCalled();
});
it("ignores a projected list response after unmount", async () => {
  let resolve!: (value: { items: ReturnType<typeof createdSession>[] }) => void;
  listGuidedResearchSessions.mockImplementation(() => new Promise(done => { resolve = done; }));
  const view = render(<GuidedResearchFlow step="home" />);
  view.unmount();
  await act(async () => resolve({ items: [{ ...createdSession("late"), title: "迟到标题" }] }));
  expect(screen.queryByText("迟到标题")).not.toBeInTheDocument();
  expect(getResearchRuntime).not.toHaveBeenCalled();
});
it("keeps a newly saved explicit name after refreshing the projected list", async () => {
  const item = { ...createdSession("renamed-runtime"), title: "旧生成名称" };
  listGuidedResearchSessions.mockResolvedValueOnce({ items: [item] }).mockResolvedValue({ items: [{ ...item, title: "新显式名称" }] });
  render(<GuidedResearchFlow step="home" />);
  const trigger = await screen.findByTestId("research-history-actions-renamed-runtime");
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.pointerUp(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByTestId("research-history-edit-renamed-runtime"));
  fireEvent.change(screen.getByTestId("research-edit-name"), { target: { value: "新显式名称" } });
  fireEvent.click(screen.getByTestId("research-edit-submit"));
  expect(await screen.findByText("新显式名称")).toBeInTheDocument();
  expect(screen.getByTestId("research-history-renamed-runtime")).toHaveTextContent("新显式名称");
  expect(screen.queryByText("旧生成名称")).not.toBeInTheDocument();
  expect(getResearchRuntime).not.toHaveBeenCalled();
});

it("preserves explicitly renamed goal-prefix titles and makes no per-card runtime requests", async () => {
  const item = legacyListItem("explicit-prefix");
  listGuidedResearchSessions.mockResolvedValue({ items: [item] });
  render(<GuidedResearchFlow step="home" />);
  expect(await screen.findByText(item.title)).toBeInTheDocument();
  expect(getResearchRuntime).not.toHaveBeenCalled();
});
it("renders projected default-name topics without full runtime fan-out", async () => {
  const items = Array.from({ length: 50 }, (_, i) => ({ ...createdSession(`projected-${i}`), title: `保存的主题${i}` }));
  listGuidedResearchSessions.mockResolvedValue({ items });
  render(<GuidedResearchFlow step="home" />);
  expect(await screen.findByText("保存的主题49")).toBeInTheDocument();
  expect(getResearchRuntime).not.toHaveBeenCalled();
});

it("reuses an already persisted matching policy after leaving without replaying policy or model work", async () => {
  const initial = unstartedRuntime("grs-policy-replay");
  const persisted = { ...initial, version: 1, planRevision: initial.planRevision! + 1,
    sourcePolicy: { ...initial.sourcePolicy, mode: "open" as const, revision: initial.sourcePolicy.revision + 1 } };
  createGuidedResearchSession.mockResolvedValue(createdSession("grs-policy-replay"));
  getResearchRuntime.mockResolvedValue(initial);
  let finish!: (value: typeof persisted) => void;
  executeResearchRuntime.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockRejectedValueOnce(new Error("RESEARCH_IDEMPOTENCY_REPLAY_MISMATCH"));
  const abandoned = vi.fn();
  const first = render(<GuidedResearchFlow step="brief" onStepChange={abandoned} />);
  fireEvent.click(screen.getByTestId("research-confirm-brief"));
  await waitFor(() => expect(executeResearchRuntime).toHaveBeenCalledTimes(1));
  const key = createGuidedResearchSession.mock.calls[0]![0].idempotencyKey;
  first.unmount();
  await act(async () => { finish(persisted); });
  expect(abandoned).not.toHaveBeenCalled();
  getResearchRuntime.mockResolvedValue(persisted);
  const next = vi.fn();
  render(<GuidedResearchFlow step="brief" onStepChange={next} />);
  fireEvent.click(screen.getByTestId("research-confirm-brief"));
  await waitFor(() => expect(next).toHaveBeenCalledWith("outline", "grs-policy-replay"));
  expect(next).toHaveBeenCalledTimes(1);
  expect(createGuidedResearchSession.mock.calls.map(([input]) => input.idempotencyKey)).toEqual([key, key]);
  expect(executeResearchRuntime).toHaveBeenCalledTimes(1);
  expect(executeResearchRuntime.mock.calls[0]![0].action).toBe("refine_source_policy");
});

it("binds policy command identity to the restored version and selection without replaying model work", async () => {
  const initial = unstartedRuntime("grs-policy-mode");
  const savedOpen = { ...initial, version: 1, planRevision: initial.planRevision! + 1,
    sourcePolicy: { ...initial.sourcePolicy, mode: "open" as const, revision: 2 } };
  const savedMaterials = { ...savedOpen, version: 2, planRevision: savedOpen.planRevision + 1,
    sourcePolicy: { ...savedOpen.sourcePolicy, mode: "materials" as const, revision: 3 } };
  // A restored identity can be returned by the idempotent create API for each mount.
  createGuidedResearchSession.mockResolvedValue(createdSession("grs-policy-mode"));
  getResearchRuntime.mockResolvedValue(initial);
  executeResearchRuntime.mockResolvedValueOnce(savedOpen)
    .mockRejectedValueOnce(new Error("transport response lost"))
    .mockResolvedValueOnce(savedMaterials);
  const next = vi.fn();
  const first = render(<GuidedResearchFlow step="brief" onStepChange={next} />);
  fireEvent.click(screen.getByTestId("research-confirm-brief"));
  await waitFor(() => expect(next).toHaveBeenCalledTimes(1));
  first.unmount();
  getResearchRuntime.mockResolvedValue(savedOpen);
  const second = render(<GuidedResearchFlow step="brief" onStepChange={next} />);
  fireEvent.click(screen.getByRole("radio", { name: "仅使用本次材料" }));
  fireEvent.click(screen.getByTestId("research-confirm-brief"));
  await screen.findByRole("alert");
  expect(next).toHaveBeenCalledTimes(1);
  second.unmount();
  const third = render(<GuidedResearchFlow step="brief" onStepChange={next} />);
  fireEvent.click(screen.getByRole("radio", { name: "仅使用本次材料" }));
  fireEvent.click(screen.getByTestId("research-confirm-brief"));
  await waitFor(() => expect(next).toHaveBeenCalledTimes(2));
  const commands = executeResearchRuntime.mock.calls.map(([input]) => input);
  expect(commands.map(command => command.action)).toEqual(["refine_source_policy", "refine_source_policy", "refine_source_policy"]);
  expect(commands[0]).toMatchObject({ expectedVersion: 0, expectedRevision: initial.planRevision, sourcePolicy: { mode: "open" } });
  expect(commands[1]).toMatchObject({ expectedVersion: 1, expectedRevision: savedOpen.planRevision, sourcePolicy: { mode: "materials" } });
  expect(commands[1].requestId).not.toBe(commands[0].requestId);
  expect(commands[1].idempotencyKey).not.toBe(commands[0].idempotencyKey);
  expect(commands[2].requestId).toBe(commands[1].requestId);
  expect(commands[2].idempotencyKey).toBe(commands[1].idempotencyKey);
  expect(createGuidedResearchSession.mock.calls[2]![0].idempotencyKey).toBe(createGuidedResearchSession.mock.calls[1]![0].idempotencyKey);
  third.unmount();
});

it("keeps a restored model failure reachable when its source policy already matches", async () => {
  createGuidedResearchSession.mockResolvedValueOnce(createdSession("grs-failed-model"));
  getResearchRuntime.mockResolvedValueOnce({ ...runtimeFixture("research", "grs-failed-model"),
    sourcePolicy: { ...runtimeFixture().sourcePolicy, mode: "open" }, errorCode: "RESEARCH_MODEL_UNAVAILABLE" });
  const next = vi.fn();
  render(<GuidedResearchFlow step="brief" onStepChange={next} />);
  fireEvent.click(screen.getByTestId("research-confirm-brief"));
  await waitFor(() => expect(next).toHaveBeenCalledWith("search", "grs-failed-model"));
  expect(executeResearchRuntime).not.toHaveBeenCalled();
});
