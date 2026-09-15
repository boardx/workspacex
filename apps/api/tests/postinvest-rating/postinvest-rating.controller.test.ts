/**
 * No-database unit test (直接实例化 controller，不启动 Nest app / 不连 Postgres)——
 * 同类先例见 `tests/board/board-controller-write-guard.test.ts` 的文件头注释：
 * 这条覆盖的是「controller 层的鉴权与输入校验」，不是真实 HTTP 传输，
 * 让这条即使在没有 docker/Postgres 的沙箱里也能被人读懂它测了什么
 * （尽管 `apps/api` 的 vitest globalSetup 目前对所有测试文件一律要求 docker，
 * 这份文件仍按仓库既有约定书写，交由有 docker 的环境/CI 实际执行）。
 */
import { describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { PostinvestRatingController } from "../../src/interface/controllers/postinvest-rating.controller";
import { toOrgId } from "../../src/domain/org-id";
import type { Principal } from "../../src/domain/principal";

const PRINCIPAL: Principal = { userId: "u1", orgId: toOrgId("org-1") };

const VALID_FINANCIALS = {
  revenue: 6e8,
  revenuePriorYear: 5e8,
  netProfit: 6e7,
  netProfitPriorYear: 5e7,
  cashAndEquivalents: 2e8,
  operatingCashOutflow12m: 1e8,
  operatingCashFlowNet: 3e7,
  accountsReceivable: 5e7,
  inventory: 3e7,
  otherReceivables: 1e7,
  otherReceivablesPriorYear: 8e6,
  totalAssets: 1e9,
  netAssets: 5e8,
  currentAssets: 3e8,
  currentLiabilities: 1e8,
};

const VALID_FACTS = {
  hasFinancialStatement: true,
  standaloneOrOperatingReportOnly: false,
  missingStatementReason: null,
};

describe("PostinvestRatingController", () => {
  it("未登录（principal 为 null）→ 抛出错误，不静默放行", () => {
    const controller = new PostinvestRatingController();
    expect(() => controller.score(null, { financials: VALID_FINANCIALS, facts: VALID_FACTS })).toThrow();
  });

  it("请求体不合法（缺字段）→ BadRequestException", () => {
    const controller = new PostinvestRatingController();
    expect(() => controller.score(PRINCIPAL, { financials: {}, facts: VALID_FACTS })).toThrow(BadRequestException);
  });

  it("请求体不合法（多余字段，strict schema）→ BadRequestException", () => {
    const controller = new PostinvestRatingController();
    const body = { financials: VALID_FINANCIALS, facts: VALID_FACTS, extra: "not allowed" };
    expect(() => controller.score(PRINCIPAL, body)).toThrow(BadRequestException);
  });

  it("合法请求 → 返回评级结果，等级非空", () => {
    const controller = new PostinvestRatingController();
    const result = controller.score(PRINCIPAL, { financials: VALID_FINANCIALS, facts: VALID_FACTS });
    expect(result.grade).not.toBeNull();
    expect(result.scores.total).not.toBeNull();
  });

  it("无财务报表 + 失联 → 直接 E 级 + business_abnormal 标注（端到端穿透到领域层）", () => {
    const controller = new PostinvestRatingController();
    const facts = { hasFinancialStatement: false, standaloneOrOperatingReportOnly: false, missingStatementReason: "lost_contact" as const };
    const result = controller.score(PRINCIPAL, { financials: VALID_FINANCIALS, facts });
    expect(result.grade).toBe("E");
    expect(result.flags).toContain("business_abnormal");
  });
});
