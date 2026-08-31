/**
 * #1182 / 2026-08-30 —— 总览屏曾经是**混合态**（部分真数据 + 部分演示数据），
 * F162 的「限额规则触发记录」落地后不再是了：全部内容都读真库
 * （见 `overview-live.tsx` 与 `overview-screen.tsx` 的头注）。
 *
 * 这个文件从「逐块断言演示标记在场」改成「逐块断言真数据标记在场、演示标记不再出现」——
 * 同一条纪律（别让界面看起来比实际更完成/更没完成），换了个方向断言。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => null,          // 无会话 ⇒ OverviewLive 不发请求，只渲染骨架
}));

import { OverviewScreen, EXPORT_UNAVAILABLE_REASON } from "@/components/admin/overview-screen";
import { NoBackendNotice } from "@/components/admin/no-backend-notice";

/** `NoBackendNotice` 文案里最不可能被别处复用的一段（逐字取自该组件）。 */
const NO_BACKEND_TEXT = /尚未接入真实后端/;
/** 之前挂在演示区块上的那个标记，本屏现在不该再出现它。 */
const DEMO_BADGE_TEXT = "演示数据 · 等 phase-03 F15";

afterEach(() => cleanup());

describe("总览屏：F162 落地后整屏真数据", () => {
  it("四块真指标 + 活动流都带「真数据」标记", () => {
    render(<OverviewScreen state="default" />);
    for (const testid of [
      "admin-overview-metric-tokens", "admin-overview-metric-members", "admin-overview-metric-anomaly",
    ]) {
      expect(screen.getByTestId(testid).textContent, testid).toContain("真数据");
    }
    expect(screen.getByTestId("admin-overview-activity-live").textContent).toContain("真数据");
    expect(screen.getByTestId("admin-overview-anomalies-live").textContent).toContain("真数据");
  });

  it("不再出现演示数据标记 —— 那正是这次要摘掉的东西", () => {
    render(<OverviewScreen state="default" />);
    expect(document.body.textContent).not.toContain(DEMO_BADGE_TEXT);
  });

  it("屏级不再渲染 NoBackendNotice 或示例组织配置提示（liveBacked 生效）", () => {
    render(<OverviewScreen state="default" />);
    expect(document.body.textContent).not.toMatch(NO_BACKEND_TEXT);
  });

  it("【阳性对照】NoBackendNotice 本身仍然渲染得出那句话 —— 否则上一条是空转", () => {
    render(<NoBackendNotice />);
    expect(document.body.textContent).toMatch(NO_BACKEND_TEXT);
  });

  it("#1178 导出与月度报告显式禁用，且原因摆在屏上不只藏在 title 里", () => {
    render(<OverviewScreen state="default" />);
    for (const testid of ["admin-activity-export", "admin-activity-report"]) {
      const btn = screen.getByTestId(testid) as HTMLButtonElement;
      // 「显式禁用是设计，静默无反应是缺陷」（lint-dead-controls 判词逐字）。
      expect(btn.disabled, `${testid} 没有 disabled`).toBe(true);
      expect(btn.getAttribute("title")).toBe(EXPORT_UNAVAILABLE_REASON);
    }
    // 只禁用不说为什么，和藏起来一样让人读作「产品做不到」。
    expect(screen.getByTestId("admin-overview-reports-disabled-reason").textContent)
      .toBe(EXPORT_UNAVAILABLE_REASON);
    // ⚠ 缺席断言：不许再弹那条「已导出 12,408 条」的假成功 Toast。
    expect(document.body.textContent).not.toMatch(/已导出活动流|月度报告生成中/);
  });
});
