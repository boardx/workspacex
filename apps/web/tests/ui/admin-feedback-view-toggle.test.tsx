/**
 * 2026-08-15 —— 后台「反馈与迭代」屏接入统一的卡片/列表切换标准。
 *
 * 人类原话：「左边还是保留一个 column 现实当前的后台菜单，右边列出卡片来表达当前的 entity
 * 的列表，卡片也可以切换为列表，需要有这个切换的功能。」
 *
 * 本屏两块列表都是「一条条反馈记录」的 entity 列表（软件反馈 / Agent-Skill 反馈），
 * 适用卡片化——与「我的本地」（设置类，非 entity 列表，不适用）刻意不同。
 *
 * 反证重点：
 *  · 默认卡片视图，两块列表都渲染成网格容器（`*-cards`），不是列表容器（`*-list`）。
 *  · 切到列表视图后，两块列表容器互换，且原有「分诊」等交互 testid 不因换布局而消失。
 *  · 卡片视图信息密度不丢字段——反馈标题、状态、票数、详情文案都还在。
 *
 * ## ⚠ FB-3（2026-08-15）改了本文件的**数据来源**，没有改它的意图
 *
 * 这块屏此前吃 `lib/mock/admin` 的 `SW_FEEDBACK` / `AGENT_FEEDBACK` 两个静态常量；
 * FB-3 之后它吃 `GET /feedback`。所以本文件改成用 mock 掉的 `apiRequest` 喂数据——
 * **断言的三条（默认卡片 / 切换后容器互换 / 交互 testid 不丢）一条没动**。
 *
 * ⚠ 一个开关管**两列**，不是每列一个：两列是同一种 entity 的两个分组，
 *   让它们各自有视图态会出现「左列卡片、右列列表」这种没人想要的状态。
 *   所以切换按钮的 testid 是模块级的 `admin-feedback-view-toggle-*`。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const apiRequest = vi.fn();
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return { ...actual, apiRequest: (...a: unknown[]) => apiRequest(...a) };
});

import { FeedbackScreen } from "@/components/admin/feedback-screen";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const base = {
  targetLabel: null, statusReason: null, votes: 4, votedByMe: false, submittedByMe: false,
  occurredRoute: "/chat", appVersion: "2026.08.15", createdAt: "2026-08-15T00:00:00.000Z",
};
const SOFTWARE = {
  ...base, id: "fb-sw", kind: "缺陷" as const, target: { kind: "product" },
  title: "批准卡不记得上次的 token 预算", detail: "每次都要重填，第三次之后就不想用了。",
  status: "待处理" as const,
};
const CAPABILITY = {
  ...base, id: "fb-cap", kind: "需求" as const,
  target: { kind: "skill", skillId: "skill-3" }, targetLabel: "会议纪要",
  title: "输出格式希望固定成表格", detail: "有时候表格有时候段落。", status: "待处理" as const,
};

async function renderScreen() {
  apiRequest.mockImplementation(async (path: string) => {
    if (path === "/feedback/counts") return { total: 2, 待处理: 2, 已进入迭代: 0, 已修复: 0, 不做: 0 };
    return { items: [SOFTWARE, CAPABILITY] };
  });
  render(<FeedbackScreen state="default" />);
  await screen.findByTestId("admin-feedback-item-fb-sw");
}

describe("反馈与迭代 · 卡片/列表视图切换", () => {
  it("默认卡片视图：软件反馈与 Agent/Skill 反馈都是网格容器，字段不丢", async () => {
    await renderScreen();

    expect(screen.getByTestId("admin-feedback-sw-cards")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-feedback-sw-list")).toBeNull();
    expect(screen.getByTestId("admin-feedback-agent-cards")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-feedback-agent-list")).toBeNull();

    // 卡片视图不丢字段：标题、正文、票数、状态。
    expect(screen.getByText(SOFTWARE.title)).toBeInTheDocument();
    expect(screen.getByText(SOFTWARE.detail)).toBeInTheDocument();
    expect(screen.getByTestId("admin-feedback-status-fb-sw").textContent).toBe("待处理");
    expect(screen.getByTestId("admin-feedback-vote-fb-sw").textContent).toContain("4");
  });

  it("两列分组正确：产品级进 sw 容器，skill 进 agent 容器", async () => {
    await renderScreen();

    expect(screen.getByTestId("admin-feedback-sw-cards").textContent).toContain(SOFTWARE.title);
    expect(screen.getByTestId("admin-feedback-sw-cards").textContent).not.toContain(CAPABILITY.title);
    expect(screen.getByTestId("admin-feedback-agent-cards").textContent).toContain(CAPABILITY.title);
  });

  it("切到列表视图：网格容器换成列表容器，分诊按钮等交互 testid 仍在", async () => {
    await renderScreen();

    fireEvent.click(screen.getByTestId("admin-feedback-view-toggle-list"));

    expect(screen.getByTestId("admin-feedback-sw-list")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-feedback-sw-cards")).toBeNull();
    expect(screen.getByTestId("admin-feedback-agent-list")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-feedback-agent-cards")).toBeNull();

    // 换布局不丢交互：分诊按钮与投票按钮都还在。转「已进入迭代」2026-08-30 起先展开
    // 一个可编辑的 issue 草稿框（见 `admin-feedback-live.test.tsx`），这里确认那个
    // 展开动作本身在列表视图下依然可用，再走完剩下一步确认它确实还能发出请求。
    expect(screen.getByTestId("admin-feedback-to-已进入迭代-fb-sw")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("admin-feedback-to-已进入迭代-fb-sw"));
    expect(screen.getByTestId("admin-feedback-issue-fb-sw")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("admin-feedback-issue-submit-fb-sw"));
    await waitFor(() =>
      expect(apiRequest.mock.calls.some((c) => (c[1] as { method?: string })?.method === "PUT")).toBe(true),
    );

    fireEvent.click(screen.getByTestId("admin-feedback-view-toggle-card"));
    expect(screen.getByTestId("admin-feedback-sw-cards")).toBeInTheDocument();
  });

  it("反证：两个容器 testid 不会同时存在 —— 否则「切换」什么都没切", async () => {
    await renderScreen();
    const bothPresent = () =>
      screen.queryByTestId("admin-feedback-sw-cards") !== null &&
      screen.queryByTestId("admin-feedback-sw-list") !== null;

    expect(bothPresent()).toBe(false);
    fireEvent.click(screen.getByTestId("admin-feedback-view-toggle-list"));
    expect(bothPresent()).toBe(false);
  });
});
