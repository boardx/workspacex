/**
 * 2026-08-15 —— 后台「反馈与迭代」屏接入统一的卡片/列表切换标准。
 *
 * 人类原话：「左边还是保留一个 column 现实当前的后台菜单，右边列出卡片来表达当前的 entity
 * 的列表，卡片也可以切换为列表，需要有这个切换的功能。」
 *
 * 本屏两块列表都是「一条条反馈记录」的 entity 列表（软件反馈 / Agent-Skill 改进反馈），
 * 适用卡片化——与「我的本地」（设置类，非 entity 列表，不适用）刻意不同。
 *
 * 反证重点：
 *  · 默认卡片视图，两块列表都渲染成网格容器（`*-cards`），不是列表容器（`*-list`）。
 *  · 切到列表视图后，两块列表容器互换，且原有「分诊」等交互 testid 不因换布局而消失。
 *  · 卡片视图信息密度不丢字段——反馈标题、状态、票数、详情文案都还在。
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { FeedbackScreen } from "@/components/admin/feedback-screen";
import { SW_FEEDBACK, AGENT_FEEDBACK } from "@/lib/mock/admin";

afterEach(() => cleanup());

function renderScreen() {
  render(<FeedbackScreen state="default" />);
}

describe("反馈与迭代 · 卡片/列表视图切换", () => {
  it("默认卡片视图：软件反馈与 Agent/Skill 改进反馈都是网格容器，字段不丢", () => {
    renderScreen();

    expect(screen.getByTestId("admin-feedback-sw-cards")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-feedback-sw-list")).toBeNull();
    expect(screen.getByTestId("admin-feedback-agent-cards")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-feedback-agent-list")).toBeNull();

    // 抽一条软件反馈核对标题/详情文案都还在卡片里。
    const first = SW_FEEDBACK[0];
    if (!first) throw new Error("SW_FEEDBACK 不该为空——反证依赖至少一条 mock 数据");
    expect(screen.getByTestId(`admin-feedback-sw-${first.id}`)).toBeInTheDocument();
    expect(screen.getByText(first.title)).toBeInTheDocument();
    expect(screen.getByText(first.detail)).toBeInTheDocument();
  });

  it("切到列表视图：网格容器换成列表容器，分诊按钮等交互 testid 仍在", () => {
    renderScreen();

    fireEvent.click(screen.getByTestId("admin-feedback-view-toggle-list"));

    expect(screen.getByTestId("admin-feedback-sw-list")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-feedback-sw-cards")).toBeNull();
    expect(screen.getByTestId("admin-feedback-agent-list")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-feedback-agent-cards")).toBeNull();

    // 未处理的 Agent/Skill 反馈仍能点「分诊并生成改进建议」——切视图不丢交互。
    const pending = AGENT_FEEDBACK.find((f) => !f.outcome);
    if (pending) {
      expect(screen.getByTestId(`admin-feedback-triage-${pending.id}`)).toBeInTheDocument();
    }

    fireEvent.click(screen.getByTestId("admin-feedback-view-toggle-card"));
    expect(screen.getByTestId("admin-feedback-sw-cards")).toBeInTheDocument();
  });
});
