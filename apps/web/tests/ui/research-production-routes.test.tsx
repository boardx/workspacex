import * as React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ResearchNewRoute } from "@/components/research-studio/research-new-route";
import { ResearchIntake } from "@/components/research-studio/research-intake";
import { ResearchStageRoute } from "@/components/research-studio/research-stage-route";
import { createGuidedResearchSession, getGuidedResearchSession, getResearchRuntime, runGuidedResearchSkillTurn } from "@/lib/guided-research-api";
import { updateGuidedResearchMetadata } from "@/lib/live-guided-research-api";
import { apiRequest, getStoredSessionToken } from "@/lib/api-client";
import { readResearchMemory, writeResearchMemory } from "@/lib/guided-research-memory";
import { research } from "@repo/contracts";

vi.mock("@/lib/api-client", async (original) => ({ ...await original<typeof import("@/lib/api-client")>(), getStoredSessionToken: vi.fn(), apiRequest: vi.fn() }));

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/research-studio/guided-research-live", () => ({ GuidedResearchLive: ({ sessionId, researchName, visualStage, initialNode, onBack, onLoadRetry }: { sessionId: string; researchName: string; visualStage: string; initialNode: string; onBack: () => void; onLoadRetry?: () => void }) => <div data-testid="production-live" data-session={sessionId} data-name={researchName} data-stage={visualStage} data-node={initialNode}><button onClick={onBack}>返回列表</button><button onClick={onLoadRetry}>重试加载</button></div> }));
vi.mock("@/lib/guided-research-api", () => ({ createGuidedResearchSession: vi.fn(), getResearchRuntime: vi.fn(), executeResearchRuntime: vi.fn(), confirmResearchBrief: vi.fn(), executeGuidedResearchNodeCommand: vi.fn(), getGuidedResearchSession: vi.fn(), runGuidedResearchSkillTurn: vi.fn() }));

beforeEach(() => { vi.resetAllMocks(); vi.mocked(getGuidedResearchSession).mockResolvedValue({ title: "创建时的研究名称" } as never); sessionStorage.clear(); localStorage.clear(); });

it("imports a text file into the requirement while preserving existing input", async () => {
  render(<ResearchNewRoute />);
  fireEvent.change(screen.getByRole("textbox", { name: "研究目标" }), { target: { value: "已有需求" } });
  expect(screen.getByRole("button", { name: "上传文件" })).toBeEnabled();
  const file = new File(["补充研究材料"], "research.txt", { type: "text/plain" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => new TextEncoder().encode("补充研究材料").buffer });
  fireEvent.change(screen.getByLabelText("上传需求文件"), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByRole("textbox", { name: "研究目标" })).toHaveValue("已有需求\n\n补充研究材料"));
  expect(screen.getByTestId("research-confirm-brief")).toBeEnabled();
});

it("reports unsupported files without losing the requirement", async () => {
  render(<ResearchNewRoute />);
  fireEvent.change(screen.getByRole("textbox", { name: "研究目标" }), { target: { value: "已有需求" } });
  fireEvent.change(screen.getByLabelText("上传需求文件"), { target: { files: [new File(["binary"], "file.pdf")] } });
  expect(await screen.findByRole("alert")).toHaveTextContent("请选择 TXT");
  expect(screen.getByRole("textbox", { name: "研究目标" })).toHaveValue("已有需求");
});

it("lets a visual embedding own confirmation without creating persisted research", () => {
  const confirm = vi.fn();
  render(<ResearchIntake session={null} workflow={null} onSession={vi.fn()} onWorkflow={vi.fn()} onPending={vi.fn()} onNavigate={vi.fn()} renderAssistant={() => null} onConfirmBrief={confirm} />);
  fireEvent.change(screen.getByRole("textbox", { name: "研究目标" }), { target: { value: "视觉样本需求" } });
  fireEvent.click(screen.getByTestId("research-confirm-brief"));
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ topic: "新建研究", goal: "视觉样本需求" }));
  expect(createGuidedResearchSession).not.toHaveBeenCalled();
  expect(runGuidedResearchSkillTurn).not.toHaveBeenCalled();
});

it("routes every stage to the real runtime and returns to the Workspace list", () => {
  const { unmount } = render(<ResearchStageRoute sessionId="real-session" stage="chapters" />);
  expect(screen.getByTestId("production-live")).toHaveAttribute("data-node", "report");
  expect(screen.getByTestId("production-live")).toHaveAttribute("data-stage", "chapters");
  fireEvent.click(screen.getByRole("button", { name: "返回列表" }));
  expect(push).toHaveBeenCalledWith("/research");
  unmount();
});

it("starts intake empty instead of loading a demonstration brief", () => {
  render(<ResearchNewRoute />);
  expect(screen.getByRole("textbox", { name: "研究目标" })).toHaveValue("");
  expect(screen.getByRole("textbox", { name: "研究主题" })).toHaveValue("");
  expect(screen.getByTestId("research-confirm-brief")).toBeDisabled();
  fireEvent.click(screen.getByTestId("research-flow-back"));
  expect(push).toHaveBeenCalledWith("/research");
});

it("keeps a typed intake when returning to the list is cancelled", () => {
  render(<ResearchNewRoute />);
  fireEvent.change(screen.getByRole("textbox", { name: "研究目标" }), { target: { value: "尚未提交的需求" } });
  fireEvent.click(screen.getByTestId("research-flow-back"));
  expect(push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
  expect(screen.getByRole("textbox", { name: "研究目标" })).toHaveValue("尚未提交的需求");
  fireEvent.click(screen.getByTestId("research-flow-back"));
  fireEvent.click(screen.getByRole("button", { name: "放弃修改并离开" }));
  expect(push).toHaveBeenCalledWith("/research");
});

it("preserves the creation key on failure and resumes the actual server node", async () => {
  vi.mocked(createGuidedResearchSession).mockRejectedValueOnce(new Error("connection lost")).mockResolvedValueOnce({ sessionId: "created-session" } as never);
  vi.mocked(getResearchRuntime).mockResolvedValue({ version: 3, currentNode: "directions" } as never);
  render(<ResearchNewRoute />);
  fireEvent.change(screen.getByRole("textbox", { name: "研究主题" }), { target: { value: "User topic" } });
  fireEvent.change(screen.getByRole("textbox", { name: "研究目标" }), { target: { value: "User objective" } });
  fireEvent.click(screen.getByTestId("research-confirm-brief"));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByTestId("research-confirm-brief"));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/research/created-session/plan"));
  const [first, second] = vi.mocked(createGuidedResearchSession).mock.calls;
  expect(second?.[0].idempotencyKey).toBe(first?.[0].idempotencyKey);
  expect(second?.[0]).toMatchObject({ title: "新建研究", brief: { topic: "User topic", goal: "User objective" } });
});

it("accepts the prototype's single description without requiring a hidden topic field", async () => {
  vi.mocked(createGuidedResearchSession).mockResolvedValue({ sessionId: "description-session" } as never);
  vi.mocked(getResearchRuntime).mockResolvedValue({ version: 3, currentNode: "directions" } as never);
  render(<ResearchNewRoute />);
  const description = "研究欧洲储能市场，比较政策、竞争和进入机会";
  fireEvent.change(screen.getByRole("textbox", { name: "研究目标" }), { target: { value: description } });
  expect(screen.getByTestId("research-confirm-brief")).toBeEnabled();
  fireEvent.click(screen.getByTestId("research-confirm-brief"));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/research/description-session/plan"));
  expect(vi.mocked(createGuidedResearchSession).mock.calls[0]?.[0]).toMatchObject({
    title: "新建研究", brief: { topic: "新建研究", goal: description },
  });
});

it("only applies a real assistant proposal after explicit user adoption", async () => {
  const brief = { topic: "Suggested topic", goal: "Suggested objective", timeRange: "2026", region: "Europe", focus: "Policy" };
  vi.mocked(runGuidedResearchSkillTurn).mockResolvedValue({ assistantMessage: "Please review", proposal: { node: "brief", value: brief } } as never);
  render(<ResearchNewRoute />);
  fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
  fireEvent.change(screen.getByRole("textbox", { name: "和研究助手讨论" }), { target: { value: "Help refine this question" } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await screen.findByRole("button", { name: "应用建议" });
  expect(() => research.operations.runGuidedResearchSkillTurn.in.parse(vi.mocked(runGuidedResearchSkillTurn).mock.calls[0]?.[0])).not.toThrow();
  expect(screen.getByRole("textbox", { name: "研究目标" })).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
  fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
  expect(screen.getByRole("textbox", { name: "和研究助手讨论" })).toHaveValue("Help refine this question");
  fireEvent.click(screen.getByRole("button", { name: "应用建议" }));
  expect(screen.getByRole("textbox", { name: "研究目标" })).toHaveValue("Suggested objective");
});

it.each([101, 123, 200, 2000, 11540, 40000])("creates research from a %i-character requirement using a contract-valid default title", async (length) => {
  vi.mocked(createGuidedResearchSession).mockImplementation(async (input) => {
    research.operations.createGuidedResearchSession.in.parse(input);
    return { sessionId: "long-description" } as never;
  });
  vi.mocked(getResearchRuntime).mockResolvedValue({ version: 3, currentNode: "directions" } as never);
  render(<ResearchNewRoute />);
  const description = "研".repeat(length);
  fireEvent.change(screen.getByRole("textbox", { name: "研究目标" }), { target: { value: description } });
  fireEvent.click(screen.getByTestId("research-confirm-brief"));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/research/long-description/plan"));
  const input = vi.mocked(createGuidedResearchSession).mock.calls[0]![0];
  expect(input.brief?.goal).toBe(description);
  expect(input.title).toBe("新建研究");
});

it("bounds a default title derived from a prefilled topic while preserving the topic", async () => {
  vi.mocked(createGuidedResearchSession).mockImplementation(async (input) => {
    research.operations.createGuidedResearchSession.in.parse(input);
    return { sessionId: "prefilled-topic" } as never;
  });
  vi.mocked(getResearchRuntime).mockResolvedValue({ version: 3, currentNode: "directions" } as never);
  const navigate = vi.fn();
  const topic = "研".repeat(120);
  render(<ResearchIntake initialBrief={{ topic, goal: "研究无障碍标准", timeRange: "", region: "", focus: "" }} session={null} workflow={null} onSession={vi.fn()} onWorkflow={vi.fn()} onPending={vi.fn()} onNavigate={navigate} renderAssistant={() => null} />);
  fireEvent.click(screen.getByTestId("research-confirm-brief"));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith("directions", "prefilled-topic"));
  expect(vi.mocked(createGuidedResearchSession).mock.calls[0]![0].brief?.topic).toBe(topic);
});

it("uses the persisted creation name rather than the research description on stage routes", async () => {
  render(<ResearchStageRoute sessionId="named-session" stage="import" />);
  await waitFor(() => expect(screen.getByTestId("production-live")).toHaveAttribute("data-name", "创建时的研究名称"));
  expect(getGuidedResearchSession).toHaveBeenCalledWith("named-session");
});

it("preserves an over-limit requirement and prevents submission", () => {
  const goal = "研".repeat(40001);
  render(<ResearchIntake initialBrief={{ topic: "研究", goal, timeRange: "", region: "", focus: "" }} session={null} workflow={null} onSession={vi.fn()} onWorkflow={vi.fn()} onPending={vi.fn()} onNavigate={vi.fn()} renderAssistant={() => null} />);
  expect(screen.getByRole("textbox", { name: "研究目标" })).toHaveValue(goal);
  expect(screen.getByRole("alert")).toHaveTextContent("需求超过 40000 字");
  expect(screen.getByTestId("research-confirm-brief")).toBeDisabled();
  fireEvent.click(screen.getByTestId("research-confirm-brief"));
  expect(createGuidedResearchSession).not.toHaveBeenCalled();
});

it("retries failed metadata when runtime loading is retried", async () => {
  vi.mocked(getGuidedResearchSession).mockRejectedValueOnce(new Error("temporary network error"));
  render(<ResearchStageRoute sessionId="real-session" stage="chapters" />);
  await waitFor(() => expect(getGuidedResearchSession).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "重试加载" }));
  await waitFor(() => expect(screen.getByTestId("production-live")).toHaveAttribute("data-name", "创建时的研究名称"));
  expect(getGuidedResearchSession).toHaveBeenCalledTimes(2);
});

it("does not supply a placeholder title when stage metadata fails", async () => {
  vi.mocked(getGuidedResearchSession).mockRejectedValue(new Error("offline"));
  render(<ResearchStageRoute sessionId="metadata-offline" stage="import" />);
  await waitFor(() => expect(getGuidedResearchSession).toHaveBeenCalled());
  expect(screen.getByTestId("production-live")).not.toHaveAttribute("data-name");
});


it("retains invalid restored optional input and blocks submission until corrected", () => {
  const confirm = vi.fn();
  render(<ResearchIntake initialBrief={{ topic: "研究", goal: "核对输入边界", timeRange: "甲".repeat(201), region: "", focus: "" }} session={null} workflow={null} onSession={vi.fn()} onWorkflow={vi.fn()} onPending={vi.fn()} onNavigate={vi.fn()} renderAssistant={() => null} onConfirmBrief={confirm} />);
  expect(screen.getByLabelText("时间范围")).toHaveValue("甲".repeat(201));
  expect(screen.getByRole("alert")).toHaveTextContent("时间范围最多 200 字");
  expect(screen.getByTestId("research-confirm-brief")).toBeDisabled();
  fireEvent.change(screen.getByLabelText("时间范围"), { target: { value: "近三年" } });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByTestId("research-confirm-brief")).toBeEnabled();
  fireEvent.click(screen.getByTestId("research-confirm-brief"));
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ timeRange: "近三年", goal: "核对输入边界" }));
});

it("keeps one primary intake action while retaining all optional research fields", () => {
  render(<ResearchNewRoute />);
  const goal = screen.getByRole("textbox", { name: "研究目标" });
  expect(goal.getAttribute("placeholder")).not.toContain("•");
  for (const name of ["研究主题", "时间范围", "地域范围", "重点关注"]) {
    expect(screen.getByLabelText(name)).toBeInTheDocument();
  }
  expect(screen.queryByRole("heading", { name: "小提示" })).not.toBeInTheDocument();
  expect(screen.getByTestId("research-confirm-brief")).toHaveAttribute("data-workflow-action-role", "primary");
  expect(screen.getByRole("button", { name: "上传文件" })).toHaveAttribute("data-workflow-action-role", "secondary");
});

it("reveals invalid optional research fields and associates overlong requirements with their error", () => {
  render(<ResearchIntake initialBrief={{ topic: "研究", goal: "甲".repeat(40001), timeRange: "甲".repeat(201), region: "", focus: "" }} session={null} workflow={null} onSession={vi.fn()} onWorkflow={vi.fn()} onPending={vi.fn()} onNavigate={vi.fn()} renderAssistant={() => null} />);
  const time = screen.getByRole("textbox", { name: "时间范围" });
  expect(time.closest("details")).toHaveAttribute("open");
  const goal = screen.getByRole("textbox", { name: "研究目标" });
  expect(goal).toHaveAttribute("aria-invalid", "true");
  expect(document.getElementById(goal.getAttribute("aria-describedby")!)).toHaveTextContent("需求超过");
});

it("shows a single named assistant heading when the intake panel is open", () => {
  render(<ResearchIntake session={null} workflow={null} onSession={vi.fn()} onWorkflow={vi.fn()} onPending={vi.fn()} onNavigate={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
  expect(screen.getAllByRole("heading", { name: "研究助手" })).toHaveLength(1);
});

it("shows a cached name immediately and validates it against the backend", async () => {
  vi.mocked(getStoredSessionToken).mockReturnValue("name-account");
  writeResearchMemory("renamed", { name: "原研究名" }, "name-account");
  let finish!: (value: Awaited<ReturnType<typeof getGuidedResearchSession>>) => void;
  vi.mocked(getGuidedResearchSession).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<ResearchStageRoute sessionId="renamed" stage="import" />);
  expect(screen.getByTestId("production-live")).toHaveAttribute("data-name", "原研究名");
  await waitFor(() => expect(getGuidedResearchSession).toHaveBeenCalledWith("renamed"));
  finish({ title: "新研究名" } as never);
  await waitFor(() => expect(screen.getByTestId("production-live")).toHaveAttribute("data-name", "新研究名"));
  expect(readResearchMemory("renamed")?.name).toBe("新研究名");
});

it("does not roll back a successful rename when an earlier metadata read resolves", async () => {
  vi.mocked(getStoredSessionToken).mockReturnValue("rename-account");
  writeResearchMemory("rename-race", { name: "名称A" }, "rename-account");
  let finish!: (value: Awaited<ReturnType<typeof getGuidedResearchSession>>) => void;
  vi.mocked(getGuidedResearchSession).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<ResearchStageRoute sessionId="rename-race" stage="import" />);
  vi.mocked(apiRequest).mockResolvedValue({ sessionId: "rename-race", title: "改名成功B", brief: { topic: "主题", goal: "需求", timeRange: "", region: "", focus: "" }, stage: "report", resumeStage: "report", status: "active", progress: 100, sourceCount: 1, reportId: null, createdAt: "2026-10-28", updatedAt: "2026-10-28" });
  await updateGuidedResearchMetadata("rename-race", { title: "改名成功B", tags: [] });
  finish({ title: "名称A" } as never);
  await waitFor(() => expect(screen.getByTestId("production-live")).toHaveAttribute("data-name", "改名成功B"));
  expect(readResearchMemory("rename-race")?.name).toBe("改名成功B");
});
