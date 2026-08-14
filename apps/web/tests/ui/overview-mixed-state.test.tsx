/**
 * #1182 —— 总览屏是**混合态**，而这件事必须有机械的东西守着。
 *
 * ## 为什么这个文件必须存在
 *
 * 人类对 Q-12 的裁决原话：「落地时请显式标注哪几格是真数据、哪几格还是演示数据——
 * 别让界面看起来『整屏已完成』」。
 *
 * 而 `lint-no-backend-badge` 是**按屏**判定的（`usesMock && !usesRealBackend && !rendersNotice`）。
 * 本屏一旦 import 任何 `live-*`，`usesRealBackend` 变 true，那道门就**不再要求本屏有任何提示**——
 * 于是那些演示标记会只剩人的自觉在守。这正是本仓反复栽的形状：
 * **门还是绿的，但它已经不承担原来那句话了。**
 *
 * 所以这里逐块断言演示标记在场。摘掉任一处 → 当场红。
 *
 * ## 「混合屏」是 lint-no-backend-badge 表达不了的第三态
 *
 * 那道门只有「纯 mock 必须挂 NoBackendNotice」与「有真接线就免检」两态。要不要把第三态
 * 做进门里，是 coord-main 的地盘（已在 #1182 里写明），本文件不改门，只在这一屏补断言。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => null,          // 无会话 ⇒ OverviewLive 不发请求，只渲染骨架
}));

import {
  OverviewScreen, DEMO_BADGE_TEXT, EXPORT_UNAVAILABLE_REASON,
} from "@/components/admin/overview-screen";
import { NoBackendNotice } from "@/components/admin/no-backend-notice";

/** `NoBackendNotice` 文案里最不可能被别处复用的一段（逐字取自该组件）。 */
const NO_BACKEND_TEXT = /尚未接入真实后端/;

afterEach(() => cleanup());

/** 仍读 mock 的每一块，以及它那块的演示标记 testid。 */
const DEMO_BLOCKS: readonly (readonly [string, string])[] = [
  ["异常计数卡", "admin-overview-metric-anomaly-demo"],
  ["异常待处理清单", "admin-overview-anomalies-demo"],
  ["导出与月度报告", "admin-overview-reports-demo"],
];

describe("#1182 总览屏混合态", () => {
  it("每一个仍读 mock 的区块都带演示标记", () => {
    render(<OverviewScreen state="default" />);
    expect(DEMO_BLOCKS.length).toBeGreaterThan(0);   // 反空转：清单空了循环会平凡通过
    for (const [name, testid] of DEMO_BLOCKS) {
      const badge = screen.queryByTestId(testid);
      expect(badge, `${name} 缺演示标记（testid=${testid}）`).not.toBeNull();
      expect(badge!.textContent).toContain(DEMO_BADGE_TEXT);
    }
  });

  it("真数据的两块带「真数据」标记 —— 否则「逐块标注」只标了一半", () => {
    render(<OverviewScreen state="default" />);
    for (const testid of ["admin-overview-metric-tokens", "admin-overview-metric-members"]) {
      expect(screen.getByTestId(testid).textContent, testid).toContain("真数据");
    }
    expect(screen.getByTestId("admin-overview-activity-live").textContent).toContain("真数据");
  });

  it("屏级提示如实说本屏是混合态，且不再是 NoBackendNotice（那句话现在是错的）", () => {
    render(<OverviewScreen state="default" />);
    const notice = screen.getByTestId("admin-overview-mixed-notice");
    expect(notice.textContent).toMatch(/混合/);
    // ⚠ 阳性对照在下一条：单断言「没有这句话」时，把 NoBackendNotice 整个删掉也会绿。
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
    //   阳性对照是上面两条 disabled——按钮还在、还看得见，只是点不动。
    expect(document.body.textContent).not.toMatch(/已导出活动流|月度报告生成中/);
  });

  it("【缺席】演示标记不许出现在真数据那三块上 —— 标反了比不标更糟", () => {
    render(<OverviewScreen state="default" />);
    for (const testid of [
      "admin-overview-metric-tokens", "admin-overview-metric-members", "admin-overview-activity",
    ]) {
      expect(screen.getByTestId(testid).textContent, testid).not.toContain(DEMO_BADGE_TEXT);
    }
  });
});
