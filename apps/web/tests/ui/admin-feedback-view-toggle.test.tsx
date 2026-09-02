/**
 * 2026-08-15 —— 后台「反馈与迭代」屏接入统一的卡片/列表切换标准。
 *
 * 人类原话：「左边还是保留一个 column 现实当前的后台菜单，右边列出卡片来表达当前的 entity
 * 的列表，卡片也可以切换为列表，需要有这个切换的功能。」
 *
 * 反证重点：
 *  · 默认卡片视图，各状态列都渲染成卡片容器（`*-cards`），不是列表容器（`*-list`）。
 *  · 切到列表视图后，容器互换，且原有「分诊」等交互 testid 不因换布局而消失。
 *  · 卡片视图信息密度不丢字段——反馈标题、状态、票数、详情文案都还在。
 *
 * ## ⚠ 2026-09-02 改了本文件的**分列依据**，没有改它的意图
 *
 * FB-3 时两块列表按 target（产品 / agent·skill）分列；2026-09-02 起合并成一个
 * 按状态分列的看板，来源变成筛选条件（见 `feedback-screen.tsx` 头注）。
 * **断言的三条（默认卡片 / 切换后容器互换 / 交互 testid 不丢）一条没动**，
 * 只是容器 testid 从 `admin-feedback-sw-*` / `admin-feedback-agent-*` 换成
 * `admin-feedback-column-<状态>-*`。
 *
 * ⚠ 一个开关管**全部四列**，不是每列一个：四列是同一种 entity 的四个状态分组，
 *   各自有视图态会出现某几列卡片、某几列列表这种没人想要的状态。
 *   所以切换按钮的 testid 仍然是模块级的 `admin-feedback-view-toggle-*`。
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
  githubIssueUrl: null, githubIssueNumber: null,
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
  it("默认卡片视图：待处理列是卡片容器，字段不丢，两条反馈都在同一列（都是待处理）", async () => {
    await renderScreen();

    expect(screen.getByTestId("admin-feedback-column-待处理-cards")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-feedback-column-待处理-list")).toBeNull();

    // 卡片视图不丢字段：标题、正文、票数、状态。
    expect(screen.getByText(SOFTWARE.title)).toBeInTheDocument();
    expect(screen.getByText(SOFTWARE.detail)).toBeInTheDocument();
    expect(screen.getByTestId("admin-feedback-status-fb-sw").textContent).toBe("待处理");
    expect(screen.getByTestId("admin-feedback-vote-fb-sw").textContent).toContain("4");
  });

  it("两条都在「待处理」列，来源筛选不影响它们同列（分列依据是状态，不是来源）", async () => {
    await renderScreen();

    expect(screen.getByTestId("admin-feedback-column-待处理-cards").textContent).toContain(SOFTWARE.title);
    expect(screen.getByTestId("admin-feedback-column-待处理-cards").textContent).toContain(CAPABILITY.title);
    expect(screen.queryByTestId("admin-feedback-column-已进入迭代-cards")).toBeNull();

    fireEvent.click(screen.getByTestId("admin-feedback-filter-source-skill"));
    expect(screen.queryByTestId("admin-feedback-item-fb-sw")).toBeNull();
    expect(screen.getByTestId("admin-feedback-item-fb-cap")).toBeInTheDocument();
  });

  it("切到列表视图：卡片容器换成列表容器，分诊按钮等交互 testid 仍在", async () => {
    await renderScreen();

    fireEvent.click(screen.getByTestId("admin-feedback-view-toggle-list"));

    expect(screen.getByTestId("admin-feedback-column-待处理-list")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-feedback-column-待处理-cards")).toBeNull();

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
    expect(screen.getByTestId("admin-feedback-column-待处理-cards")).toBeInTheDocument();
  });

  it("反证：同一列的卡片容器与列表容器不会同时存在 —— 否则「切换」什么都没切", async () => {
    await renderScreen();
    const bothPresent = () =>
      screen.queryByTestId("admin-feedback-column-待处理-cards") !== null &&
      screen.queryByTestId("admin-feedback-column-待处理-list") !== null;

    expect(bothPresent()).toBe(false);
    fireEvent.click(screen.getByTestId("admin-feedback-view-toggle-list"));
    expect(bothPresent()).toBe(false);
  });
});
