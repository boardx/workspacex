/**
 * A6（`docs/agents/team2-acceptance-rubric.md`）—— 规则手册 ↔ 评分引擎一致性。
 *
 * 数值的单一事实源是 `@repo/contracts/postinvest-rating-rules`：引擎按表计算，前端任务书
 * 由 `renderRuleBook()` 渲染。这组断言保证「按表计算」不是一句注释——档位表改了而引擎
 * 没跟上，或有人把某个数字硬编码回引擎里，都会在这里变红。
 *
 * ⚠ 本文件从 `apps/api/tests/postinvest-rating/scoring.test.ts` 搬到控制平面测试目录
 *   （2026-09-15）。原因：`apps/api` 的 vitest globalSetup 无条件要求用 docker 起
 *   pgvector 容器，而这组断言一行 SQL 都不跑。把不需要 DB 的检查挂在需要 DB 的套件下，
 *   等于让它在任何拿不到容器的环境里都跑不了——「有检查等于没检查」。
 *   被评分的对象（`scoring.ts`）是纯函数，import 它没有任何副作用。
 */
import { describe, expect, it } from "vitest";
import {
  cashScore,
  gradeFromTotal,
  profitLevelScore,
  revenueSizeScore,
} from "../../apps/api/src/domain/postinvest-rating/scoring";
import {
  CASH_MONTH_BANDS,
  CASH_MONTH_FLOOR,
  CASH_MONTH_TOP,
  GRADE_BANDS,
  PROFIT_LEVEL_BANDS,
  REVENUE_SIZE_BANDS,
  renderRuleBook,
} from "../../packages/contracts/src/postinvest-rating-rules";

describe("规则手册与评分引擎一致", () => {
  it("每个营收体量档的下沿都得到该档分数", () => {
    for (const band of REVENUE_SIZE_BANDS) {
      if (band.min === Number.NEGATIVE_INFINITY) continue;
      expect(revenueSizeScore(band.min)).toBe(band.score);
    }
    expect(revenueSizeScore(0)).toBe(REVENUE_SIZE_BANDS[REVENUE_SIZE_BANDS.length - 1]!.score);
  });

  it("每个盈利水平档的下沿都得到该档分数", () => {
    for (const band of PROFIT_LEVEL_BANDS) {
      expect(profitLevelScore(band.min)).toBe(band.score);
    }
  });

  it("每个分级带的下沿之上一点点就落进该等级", () => {
    for (const band of GRADE_BANDS) {
      if (band.min === Number.NEGATIVE_INFINITY) continue;
      expect(gradeFromTotal(band.min + 0.001)).toBe(band.grade);
      expect(gradeFromTotal(band.min)).not.toBe(band.grade); // 下沿不含
    }
  });

  it("现金月数分段的端点与手册逐一吻合", () => {
    expect(cashScore(CASH_MONTH_TOP.months)).toBe(CASH_MONTH_TOP.score);
    expect(cashScore(CASH_MONTH_FLOOR.months / 2)).toBe(CASH_MONTH_FLOOR.score);
    for (const band of CASH_MONTH_BANDS) {
      expect(cashScore(band.monthsFrom)).toBeCloseTo(band.scoreFrom, 9);
      expect(cashScore(band.monthsTo)).toBeCloseTo(band.scoreTo, 9);
    }
  });

  it("渲染给模型的任务书包含手册里的每一个等级与档位说明", () => {
    const rendered = renderRuleBook();
    for (const band of GRADE_BANDS) {
      expect(rendered).toContain(band.action); // 投后管理建议逐字来自手册
      expect(rendered).toContain(band.label);
    }
    for (const band of REVENUE_SIZE_BANDS) expect(rendered).toContain(band.label);
  });
});
