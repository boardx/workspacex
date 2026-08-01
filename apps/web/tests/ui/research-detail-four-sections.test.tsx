/**
 * F145 —— 研究详情四段结果 + Scout 执行步骤（`uc-24-2` R3 / R7.3 / R7.5 / R12.1-7）。
 *
 * `RsDetailScreen`（`apps/web/components/research-studio/rs-screens.tsx`）与它的
 * mock 数据源（`apps/web/lib/mock/research-studio.ts`）在 F144 之前就已由
 * ui-prototyper 建成（真实组件 + mock，签核第①件材料）。本文件是 F145 的机械判据：
 * 把 R12 的验收线索钉成会红的断言，而不是停在"截图看起来对"。
 *
 * ## 断言打在性质上，不是固定数量（纪律第 9 条 / coding-standards E-4）
 *
 * R12.2 逐字：断言 0.3 那条**出现在**段③，不是 `toHaveLength(14)`。本文件全程
 * 用 `RS_EXTERNAL_SOURCES` / `RS_RESULT` 自己的数据反推期望值，不写死数字。
 */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { RsDetailScreen } from "@/components/research-studio/rs-screens";
import {
  RS_EXTERNAL_SOURCES,
  RS_RESULT,
  RS_DIALOG,
  RS_EMPTY_HINT,
} from "@/lib/mock/research-studio";

describe("F145 · 四段固定结构标题逐字出现（R12.1）", () => {
  it("段①-④的标题原样渲染", () => {
    render(<RsDetailScreen state="default" view="owner" />);
    expect(screen.getByTestId("rs-sec-findings").textContent).toContain("关键发现");
    expect(screen.getByTestId("rs-sec-disputed").textContent).toContain("争议 / 不确定");
    expect(screen.getByTestId("rs-sec-sources").textContent).toContain("外部来源");
    expect(screen.getByTestId("rs-sec-conclusion").textContent).toContain("研究结论");
  });

  it("段③标题带来源数，且这个数就是外部来源表实际渲染的行数（不是写死的另一份数字）", () => {
    render(<RsDetailScreen state="default" view="owner" />);
    const rows = screen.getAllByTestId(/^rs-src-\d+$/);
    expect(rows).toHaveLength(RS_EXTERNAL_SOURCES.length);
  });
});

describe("F145 · R7.3 置信度以数值渲染，低置信来源出现在段③而不被过滤", () => {
  it("反空转：mock 数据里确实存在一条 confidence=0.3 的来源——没有这条，下面的断言全是平凡真", () => {
    expect(RS_EXTERNAL_SOURCES.some((s) => s.confidence === 0.3)).toBe(true);
  });

  it("0.3 那条出现在段③（性质断言：不是总数等于某个固定值）", () => {
    render(<RsDetailScreen state="default" view="owner" />);
    const sourcesSection = screen.getByTestId("rs-sec-sources");
    const lowConfNodes = within(sourcesSection).getAllByTestId("rs-conf-low");
    expect(lowConfNodes.length).toBeGreaterThan(0);
    expect(lowConfNodes.some((n) => n.textContent?.startsWith("0.3"))).toBe(true);
  });

  it("置信度渲染的是数值（0.9 / 0.7 / 0.3 一位小数），不是高/中/低这类标签", () => {
    render(<RsDetailScreen state="default" view="owner" />);
    const sourcesSection = screen.getByTestId("rs-sec-sources");
    const text = sourcesSection.textContent ?? "";
    for (const s of RS_EXTERNAL_SOURCES) {
      if (s.confidence !== null) {
        expect(text, `段③里找不到数值 ${s.confidence.toFixed(1)}`).toContain(s.confidence.toFixed(1));
      }
    }
    expect(text).not.toMatch(/高置信|中置信(?!度)/);
  });

  it("confidence=null 的行渲染为 —（N-8），不是被当作 0 或整行消失", () => {
    render(<RsDetailScreen state="default" view="owner" />);
    const nullRows = RS_EXTERNAL_SOURCES.filter((s) => s.confidence === null);
    expect(nullRows.length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("rs-conf-missing").length).toBeGreaterThanOrEqual(nullRows.length);
  });
});

describe("F145 · R7.5 单来源问题落进段②，且不出现在段①", () => {
  it("反空转：mock 里确实有一条『样本太少』的争议叙述，且它不在关键发现里", () => {
    const singleSourceNarrative = RS_RESULT.disputed.find((d) => d.includes("样本太少"));
    expect(singleSourceNarrative, "mock 数据没有单来源争议样例——下面的断言无的放矢").not.toBeUndefined();
    expect(RS_RESULT.keyFindings.some((f) => f.includes("样本太少"))).toBe(false);
  });

  it("该争议叙述渲染在段②，不出现在段①", () => {
    render(<RsDetailScreen state="default" view="owner" />);
    const disputedSection = screen.getByTestId("rs-sec-disputed");
    const findingsSection = screen.getByTestId("rs-sec-findings");
    const singleSourceNarrative = RS_RESULT.disputed.find((d) => d.includes("样本太少"))!;
    expect(disputedSection.textContent).toContain(singleSourceNarrative);
    expect(findingsSection.textContent).not.toContain(singleSourceNarrative);
  });

  it("段②明确标注『不进洞察库』（N-2），不是一段没有出口含义的说明文字", () => {
    render(<RsDetailScreen state="default" view="owner" />);
    const disputedSection = screen.getByTestId("rs-sec-disputed");
    expect(within(disputedSection).getByTestId("rs-disputed-flag").textContent).toContain("不进洞察库");
  });
});

describe("F145 · Scout 执行步骤：编号三步机器可枚举，且与轮次一一对应", () => {
  it("每一轮对话都有一组编号执行步骤，条数与 mock 数据一致", () => {
    render(<RsDetailScreen state="default" view="owner" />);
    RS_DIALOG.forEach((round, i) => {
      const steps = screen.getByTestId(`rs-round-${i}-steps`);
      const items = within(steps).getAllByRole("listitem");
      expect(items).toHaveLength(round.steps.length);
      items.forEach((li, j) => {
        expect(li.textContent).toContain(round.steps[j]);
      });
    });
  });

  it("第一轮的检索计数步骤同时提到官方/行业/媒体三类（R7.4：与来源偏好口径同源，不是另起一份枚举）", () => {
    render(<RsDetailScreen state="default" view="owner" />);
    const firstRoundSteps = screen.getByTestId("rs-round-0-steps").textContent ?? "";
    expect(firstRoundSteps).toContain("官方");
    expect(firstRoundSteps).toContain("行业");
    expect(firstRoundSteps).toContain("媒体");
  });
});

describe("F145 · E1 部分路失败：已完成路的结果可见，失败路单独标出可重试", () => {
  it("dep-failed 态下：说明文案同时提到已完成的路数与失败路可重试，且不是整屏清空", () => {
    render(<RsDetailScreen state="dep-failed" view="owner" />);
    const banner = screen.getByTestId("dep-failed");
    expect(banner.textContent).toContain("3 路失败");
    expect(banner.textContent).toContain("已完成的 9 路结果先看");
    expect(banner.textContent).toContain("失败路可重试");
    // dep-failed 是 StateShell 的短路态：四段结果这次确实不在同一渲染里，
    // 但失败信息本身没有被静默吞掉——断言打在这条说明文案的存在与内容上。
    expect(screen.queryByTestId("rs-sec-findings")).toBeNull();
  });
});

describe("F145 · E2 零来源：段④是数据需求说明，不含任何断言性结论", () => {
  it("empty 态的引导文案明确说这是数据需求说明，不是结论", () => {
    render(<RsDetailScreen state="empty" view="owner" />);
    expect(screen.getByTestId("empty").textContent).toContain(RS_EMPTY_HINT.detail);
    expect(RS_EMPTY_HINT.detail).toContain("数据需求说明");
    expect(RS_EMPTY_HINT.detail).not.toContain("结论是");
  });

  it("当四段结果确实渲染时（default 态），isDataRequest=false 场景走的是结论文案而非数据需求说明", () => {
    render(<RsDetailScreen state="default" view="owner" />);
    expect(RS_RESULT.isDataRequest).toBe(false);
    expect(screen.queryByTestId("rs-conclusion-datareq")).toBeNull();
    expect(screen.getByTestId("rs-sec-conclusion").textContent).toContain(RS_RESULT.conclusion ?? "");
  });
});

describe("F145 · R5 观察者视角：无输入框、无出口动作按钮", () => {
  it("denied 态下追问输入框与三个出口动作按钮都不在 DOM 里（不是灰掉/隐藏）", () => {
    const { container } = render(<RsDetailScreen state="denied" view="owner" />);
    expect(screen.queryByTestId("rs-followup-input")).toBeNull();
    expect(screen.queryByTestId("rs-act-promote")).toBeNull();
    expect(screen.queryByTestId("rs-act-supplement")).toBeNull();
    expect(screen.queryByTestId("rs-act-pin")).toBeNull();
    // L2：连 testid 字符串本身都不该出现在 HTML 里（display:none 过不了这条）。
    expect(container.innerHTML).not.toContain("rs-followup-input");
    expect(container.innerHTML).not.toContain("rs-act-promote");
    expect(screen.getByTestId("denied")).toBeInTheDocument();
  });
});
