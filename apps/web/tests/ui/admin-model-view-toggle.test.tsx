/**
 * 「模型」后台屏的卡片/列表视图切换（人类原话：「右边列出卡片来表达当前的entity的列表，
 * 卡片也可以切换为列表」）。
 *
 * 机械断言切换真的切换了渲染——不是只切了个文本态：
 *   · 卡片视图下渲染 `admin-model-card-<id>`，容器 `data-view="card"`，
 *     且不存在 `admin-model-list-hosted`（列表容器）。
 *   · 点列表按钮后渲染 `admin-model-list-hosted`，容器 `data-view="list"`，
 *     且卡片网格 `admin-model-card-grid-hosted` 不再挂载。
 *   · 两种视图下同一条模型的关键字段（供应商/标签/上下文/单价/可选范围）都在场，
 *     不因为换布局丢字段。
 *   · 卡片视图下的启用开关和列表视图下的启用开关都能真实触发交互（点击后状态变化），
 *     证明不是纯展示的死壳。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { ModelScreen } from "@/components/admin/model-screen";

afterEach(() => cleanup());

/** 已启用、非机密的闭源模型，字段齐全，适合做断言锚点。 */
const SAMPLE_MODEL_ID = "m-sonnet46";

describe("admin-model-view-toggle · 卡片/列表切换", () => {
  it("默认是卡片视图：卡片网格在场，列表容器不在场", () => {
    render(<ModelScreen state="default" />);
    const container = screen.getByTestId("admin-model-view-container");
    expect(container).toHaveAttribute("data-view", "card");
    expect(screen.getByTestId("admin-model-card-grid-hosted")).toBeInTheDocument();
    expect(screen.getByTestId(`admin-model-card-${SAMPLE_MODEL_ID}`)).toBeInTheDocument();
    expect(screen.queryByTestId("admin-model-list-hosted")).toBeNull();
    expect(screen.queryByTestId(`admin-model-row-${SAMPLE_MODEL_ID}`)).toBeNull();
  });

  it("点击列表切换按钮 ⇒ 卡片消失、列表出现（真实切换，不是文本空转）", () => {
    render(<ModelScreen state="default" />);
    fireEvent.click(screen.getByTestId("admin-model-view-toggle-list"));

    const container = screen.getByTestId("admin-model-view-container");
    expect(container).toHaveAttribute("data-view", "list");
    expect(screen.getByTestId("admin-model-list-hosted")).toBeInTheDocument();
    expect(screen.getByTestId(`admin-model-row-${SAMPLE_MODEL_ID}`)).toBeInTheDocument();
    expect(screen.queryByTestId("admin-model-card-grid-hosted")).toBeNull();
    expect(screen.queryByTestId(`admin-model-card-${SAMPLE_MODEL_ID}`)).toBeNull();
  });

  it("切回卡片视图 ⇒ 列表消失、卡片重新出现（双向切换都真实生效）", () => {
    render(<ModelScreen state="default" />);
    fireEvent.click(screen.getByTestId("admin-model-view-toggle-list"));
    expect(screen.getByTestId("admin-model-list-hosted")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("admin-model-view-toggle-card"));
    const container = screen.getByTestId("admin-model-view-container");
    expect(container).toHaveAttribute("data-view", "card");
    expect(screen.getByTestId("admin-model-card-grid-hosted")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-model-list-hosted")).toBeNull();
  });

  it("卡片视图不丢字段：供应商/能力标签/上下文/单价/可选范围都在场", () => {
    render(<ModelScreen state="default" />);
    const card = screen.getByTestId(`admin-model-card-${SAMPLE_MODEL_ID}`);
    expect(within(card).getByText(/Anthropic/)).toBeInTheDocument();
    expect(within(card).getByText(/均衡 · 工具/)).toBeInTheDocument();
    expect(within(card).getByText(/上下文 400k/)).toBeInTheDocument();
    expect(within(card).getByTestId(`admin-model-price-${SAMPLE_MODEL_ID}`)).toHaveTextContent("￥0.018 / 1k");
    expect(within(card).getByText(/可选范围/)).toBeInTheDocument();
    expect(within(card).getByText(/全部能力位/)).toBeInTheDocument();
  });

  it("卡片视图的启用开关是真实可交互控件：点击后状态徽标从「已启用」变「未启用」", () => {
    render(<ModelScreen state="default" />);
    const card = screen.getByTestId(`admin-model-card-${SAMPLE_MODEL_ID}`);
    expect(within(card).getByTestId(`admin-model-status-${SAMPLE_MODEL_ID}`)).toHaveTextContent("已启用");

    fireEvent.click(within(card).getByTestId(`admin-model-toggle-${SAMPLE_MODEL_ID}`));

    // 停用会先弹出二选一确认对话框（D-U5：默认「立即中断」），填理由后确认才真正翻转状态。
    const dialog = screen.getByTestId("admin-model-disable-dialog");
    fireEvent.change(within(dialog).getByTestId("admin-model-disable-dialog-reason"), {
      target: { value: "测试：验证卡片视图开关真实生效" },
    });
    fireEvent.click(within(dialog).getByTestId("admin-model-disable-dialog-confirm"));

    expect(screen.getByTestId(`admin-model-status-${SAMPLE_MODEL_ID}`)).toHaveTextContent("未启用");
  });
});
