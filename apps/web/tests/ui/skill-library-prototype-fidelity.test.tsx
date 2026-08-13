/**
 * Skill 库与市场原型（`screen=library-prototype`，ADR-023 签核材料）保真度回归。
 *
 * 背景：人类给了两张生产截图核对，核对过程中用字节偏移取证法重新核实了
 * `phases/requirements/WorkspaceX Standalone.html` 与本组件的差异，发现三处
 * 遗漏（均已用同一份原型逐字核对，见 `skill-library.tsx` 对应注释里的偏移量）：
 *   ① 「新建 Skill」缺「或从市场挑一个改」三市场网格（偏移 15726036 起）。
 *   ② 全部 skill 行缺「删除」按钮（偏移 15711167 起，内置 skill 除外）。
 *   ③ 待审核卡片「来源」写成粗粒度 `SKILL_SOURCE_LABEL`（「社区」），
 *      丢了原型逐字的子来源（「Codex 社区」）与正文描述句（偏移 15719900 起）。
 * 这个文件把三处都钉成机械断言，防止再次静默丢失。
 */
import * as React from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { SkillLibrary } from "@/components/skill/skill-library";
import { MARKET_PICKS, SKILLS } from "@/lib/mock/skill";

describe("skill-library 原型保真度", () => {
  it("①「新建 Skill」面板展示原型逐字的三市场网格，且遵守 D-06 置灰规则", () => {
    render(<SkillLibrary state="default" view="maintainer" />);
    fireOpenCreatePanel();

    const panel = screen.getByTestId("skill-market-picks");
    expect(within(panel).getByText("或从市场挑一个改")).toBeInTheDocument();
    expect(MARKET_PICKS).toHaveLength(3);
    for (const market of MARKET_PICKS) {
      const card = screen.getByTestId(`skill-market-${market.id}`);
      expect(within(card).getByText(market.name)).toBeInTheDocument();
      expect(within(card).getByText(market.countLabel)).toBeInTheDocument();
      // D-06：社区市场浏览 phase-1 不实现，按钮必须置灰，不能悄悄变成可点。
      expect(screen.getByTestId(`skill-market-browse-${market.id}`)).toBeDisabled();
    }
    // 原型逐字核对（偏移 15726036 起）：三个名字与文案必须一字不差。
    expect(MARKET_PICKS.map((m) => m.name)).toEqual(["Claude Code 社区", "Codex 社区", "咨询方法库"]);
    expect(MARKET_PICKS.map((m) => m.countLabel)).toEqual([
      "1,842 个 · 已同步 34",
      "903 个 · 已同步 12",
      "官方精选 · 已同步 28",
    ]);
  });

  it("② 全部 skill 行都有「删除」，内置 skill 除外", () => {
    render(<SkillLibrary state="default" view="maintainer" />);
    const builtinIds = SKILLS.filter((s) => s.builtin).map((s) => s.id);
    const deletableIds = SKILLS.filter((s) => !s.builtin).map((s) => s.id);
    expect(deletableIds.length).toBeGreaterThan(0);
    for (const id of deletableIds) {
      expect(screen.getByTestId(`skill-delete-${id}`)).toBeInTheDocument();
    }
    for (const id of builtinIds) {
      expect(screen.queryByTestId(`skill-delete-${id}`)).not.toBeInTheDocument();
    }
  });

  it("③ 待审核卡片的「来源」用原型子来源与正文描述句，不是粗粒度五值标签", () => {
    render(<SkillLibrary state="default" view="maintainer" />);
    const summary = screen.getByTestId("skill-review-summary-rv-jtbd");
    expect(summary).toHaveTextContent("高琳 18 分钟前从 Codex 社区导入，安全扫描通过，等待方法论审核");
    const row = screen.getByTestId("skill-review-row-rv-jtbd");
    // 元数据行必须显示细分来源「Codex 社区」，不能退化成粗粒度的「社区」。
    expect(within(row).getByText(/来源 Codex 社区/)).toBeInTheDocument();
    expect(within(row).queryByText(/来源 社区(?!$)/)).not.toBeInTheDocument();
  });
});

function fireOpenCreatePanel() {
  const addButton = screen.getByTestId("skill-lib-add");
  fireEvent.click(addButton);
}
