import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { TodayBoard } from "@/components/tasks/today-board";
import { TasksLeftRail } from "@/components/tasks/left-rail";

/**
 * 「任务 · 我的今天」原型保真度回归（无 issue 前缀，本文件本身就是本轮审计的机械证据）。
 *
 * 钉的是这轮审计发现并修复的四条具体漂移，全部可用原型字节偏移复核
 * （`phases/requirements/WorkspaceX Standalone.html`）：
 *   1. `按行动方`/`按项目` 分组切换在原型里是**中栏内容头**的按钮（字节 15926918 / 15927141，
 *      与 `{{tkTitle}}` 标题、`＋ 新建任务` 同一条 56px 顶条），不在 272px 左栏——
 *      之前挂反了，现在钉死它只出现在 TodayBoard 的内容头。
 *   2. 左栏顶部应有「任务」标题 + 「人和 AI 共用同一种任务对象」副标题 + 黑底
 *      「＋ 新建任务」主按钮（字节 15920518 起），之前整块缺失。
 *   3. R1（授权）卡片：原型里只有「小字上下文行 + 一行加粗问句」两行，没有等待时长、
 *      没有到期时间——之前编了「等待 12 分钟」「今天」，且把加粗标题错放成上下文行的
 *      重复文案而不是问句本身。
 *   4. 「等我判断」区的「AI 停在这里，不会绕过你继续」是**分区级**提示（原型字节
 *      15920388 附近，紧跟在「等我判断」标题与计数后面），R3 卡片内部不应重复它。
 */
describe("任务 · 我的今天 —— 原型保真度回归", () => {
  it("按行动方/按项目分组切换只出现在内容头（TodayBoard），不在左栏（TasksLeftRail）", () => {
    const board = render(<TodayBoard state="default" />);
    expect(within(board.container).getByTestId("tasks-grouping-switch")).toBeTruthy();
    expect(within(board.container).getByTestId("tasks-grouping-by-actor")).toBeTruthy();
    expect(within(board.container).getByTestId("tasks-grouping-by-project")).toBeTruthy();
    expect(within(board.container).getByTestId("tasks-new-task-header")).toBeTruthy();

    const rail = render(<TasksLeftRail />);
    expect(within(rail.container).queryByTestId("tasks-grouping-switch")).toBeNull();
  });

  it("左栏顶部有「任务」标题、「人和 AI 共用同一种任务对象」副标题与「＋ 新建任务」主按钮", () => {
    render(<TasksLeftRail />);
    const heading = screen.getByTestId("tasks-left-heading");
    expect(heading).toHaveTextContent("任务");
    expect(heading).toHaveTextContent("人和 AI 共用同一种任务对象");
    expect(screen.getByTestId("tasks-new-task-rail")).toHaveTextContent("新建任务");
  });

  it("R1（授权）卡片没有编造的等待时长/到期时间，加粗标题就是那句问句", () => {
    render(<TodayBoard state="default" />);
    const card = screen.getByTestId("tasks-judgment-card-jc-authz-crm");
    expect(card).toHaveTextContent("是否把 CRM 读取权限加入这次任务的权限包？");
    expect(card).not.toHaveTextContent("等待 12 分钟");
    // 到期徽标不渲染（card.due 未定义时整个 span 不出现）
    expect(card.textContent).not.toMatch(/今天(?!18)/);
  });

  it("R3 卡片内部不重复「AI 停在这里」——那句只在分区标题旁出现一次", () => {
    render(<TodayBoard state="default" />);
    const section = screen.getByTestId("tasks-section-awaiting-judgment");
    const occurrences = (section.textContent?.match(/AI 停在这里，不会绕过你继续/g) ?? []).length;
    expect(occurrences).toBe(1);

    const card = screen.getByTestId("tasks-judgment-card-jc-approve-path-b");
    expect(card).not.toHaveTextContent("AI 停在这里");
  });
});
