/**
 * 2026-09-15 人类实测：「我点击开始；评价没有反应」。
 *
 * 根因不是发起流程坏了，而是**按钮被 disabled 且页面一句解释都没有**。四个条件
 * （会话 / Agent 在能力目录里 / 选中项目 / 至少一份材料）里任何一个不满足都会让它变灰，
 * 而 disabled 的视觉差异很淡——点下去什么都不发生，用户无从知道该改什么。
 *
 * 之前这个组件只有对纯函数（任务书拼接、类型推测）的断言，**从没有人或测试真的点过
 * 那个按钮**。typecheck 和 lint 全绿，行为却是坏的。所以这里渲染真组件、真点击，
 * 只把网络边界（capabilities / projects / 发起线程）换成 mock。
 *
 * 反证：把 `disabledReason` 整段删掉 ⇒ 用例 1、2 必红；
 *       把 `canStart` 改回不看 `disabledReason` ⇒ 用例 3 必红（会在缺材料时也发起）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RATING_AGENT } from "@/lib/postinvest-rating/agent-directory";

const listCapabilities = vi.fn();
const listProjects = vi.fn();
const launchRatingThread = vi.fn();
const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ session: { currentOrgId: "org-1" } }),
}));
vi.mock("@/lib/live-capabilities", () => ({ listCapabilities: (...a: unknown[]) => listCapabilities(...a) }));
vi.mock("@/lib/live-projects", () => ({
  listProjects: (...a: unknown[]) => listProjects(...a),
  createProject: vi.fn(),
}));
vi.mock("@/lib/postinvest-rating/launch-rating-thread", () => ({
  launchRatingThread: (...a: unknown[]) => launchRatingThread(...a),
}));

const { RatingAgentLauncher } = await import("@/components/postinvest-rating/rating-agent-launcher");

const agentRow = { id: "agent-team2", name: RATING_AGENT.name, enabled: true };
const startButton = () => screen.getByTestId("agent-rating-start");
const reason = () => screen.queryByTestId("agent-rating-disabled-reason")?.textContent ?? "";

function addFile(name = "2025年报.pdf") {
  const input = screen.getByLabelText("上传投后项目材料") as HTMLInputElement;
  const file = new File(["x"], name, { type: "application/pdf" });
  fireEvent.change(input, { target: { files: [file] } });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("开始评级按钮不能静默失灵", () => {
  it("Agent 不在能力目录里时，按钮禁用并说明原因", async () => {
    listCapabilities.mockResolvedValue([]);
    listProjects.mockResolvedValue([{ id: "p1", name: "供应链创新" }]);
    render(<RatingAgentLauncher agent={{ ...RATING_AGENT, agentId: null }} />);

    await waitFor(() => expect(reason()).toContain("没有这个 Agent"));
    expect(startButton()).toBeDisabled();
  });

  it("Agent 就绪但没上传材料时，按钮禁用并明说缺材料", async () => {
    listCapabilities.mockResolvedValue([agentRow]);
    listProjects.mockResolvedValue([{ id: "p1", name: "供应链创新" }]);
    render(<RatingAgentLauncher agent={{ ...RATING_AGENT, agentId: null }} />);

    await waitFor(() => expect(reason()).toContain("请先上传至少一份材料"));
    expect(startButton()).toBeDisabled();
  });

  it("条件齐了：按钮可点，点击真的发起并跳进那条线程", async () => {
    listCapabilities.mockResolvedValue([agentRow]);
    listProjects.mockResolvedValue([{ id: "p1", name: "供应链创新" }]);
    launchRatingThread.mockResolvedValue({ threadId: "t1", projectId: "p1" });
    render(<RatingAgentLauncher agent={{ ...RATING_AGENT, agentId: null }} />);

    await waitFor(() => expect(listProjects).toHaveBeenCalled());
    addFile();
    await waitFor(() => expect(startButton()).not.toBeDisabled());
    expect(screen.queryByTestId("agent-rating-disabled-reason")).toBeNull();

    fireEvent.click(startButton());
    await waitFor(() => expect(launchRatingThread).toHaveBeenCalledTimes(1));
    expect(launchRatingThread.mock.calls[0]![0]).toMatchObject({ agentId: "agent-team2", projectId: "p1", projectName: "供应链创新" });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/chat?projectId=p1&threadId=t1"));
  });

  it("发起失败时把真实原因显示出来，不是一句笼统文案", async () => {
    listCapabilities.mockResolvedValue([agentRow]);
    listProjects.mockResolvedValue([{ id: "p1", name: "供应链创新" }]);
    launchRatingThread.mockRejectedValue(new Error("FILE_TYPE_REJECTED"));
    render(<RatingAgentLauncher agent={{ ...RATING_AGENT, agentId: null }} />);

    await waitFor(() => expect(listProjects).toHaveBeenCalled());
    addFile();
    await waitFor(() => expect(startButton()).not.toBeDisabled());
    fireEvent.click(startButton());

    await waitFor(() => expect(screen.getByTestId("agent-rating-error").textContent).toContain("FILE_TYPE_REJECTED"));
  });
});
