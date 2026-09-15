/**
 * 投后财务项目评级 Agent — ad-hoc MVP 的唯一 HTTP 入口（issue #3676）。
 *
 * ⚠ 这不是 `packages/contracts/src/postinvest-rating.ts`（束 `postinvest-rating`，
 * `design-signoff.md` status: pending）的接线。那份契约描述的是文件上传 + agent
 * run 编排的完整形态；MVP 跳过文档解析/agent 编排，直接接受调用方已抽取好的
 * 结构化财务字段，只验证「确定性评分引擎算得对不对」这一件事。两者请求形状
 * 因此不同，不要混用——完整契约签核后若要转正，这个端点应被替换而不是保留。
 *
 * 权限：MVP 范围内只要求已登录（有 `Principal`），不做项目成员/角色校验——
 * 那需要 `project` 域的成员关系查询，是明确推迟项（见 issue #3676 BL3）。
 */
import { BadRequestException, Body, Controller, HttpCode, Post } from "@nestjs/common";
import { z } from "zod";
import { rateFinancials } from "../../application/postinvest-rating/rate-financials";
import { assertPrincipal, type Principal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";

const NullableNumber = z.number().finite().nullable();

const FinancialInputSchema = z
  .object({
    revenue: NullableNumber,
    revenuePriorYear: NullableNumber,
    netProfit: NullableNumber,
    netProfitPriorYear: NullableNumber,
    cashAndEquivalents: NullableNumber,
    operatingCashOutflow12m: NullableNumber,
    operatingCashFlowNet: NullableNumber,
    accountsReceivable: NullableNumber,
    inventory: NullableNumber,
    otherReceivables: NullableNumber,
    otherReceivablesPriorYear: NullableNumber,
    totalAssets: NullableNumber,
    netAssets: NullableNumber,
    currentAssets: NullableNumber,
    currentLiabilities: NullableNumber,
  })
  .strict();

const MissingStatementReason = z.enum([
  "confidentiality_period",
  "relationship_broken",
  "major_litigation",
  "lost_contact",
  "suspended",
  "bankrupt",
]);

const HumanConfirmedFactsSchema = z
  .object({
    hasFinancialStatement: z.boolean(),
    standaloneOrOperatingReportOnly: z.boolean(),
    missingStatementReason: MissingStatementReason.nullable(),
  })
  .strict();

const ScoreRequest = z
  .object({
    financials: FinancialInputSchema,
    facts: HumanConfirmedFactsSchema,
  })
  .strict();

@Controller("/postinvest-ratings")
export class PostinvestRatingController {
  @Post("/score")
  @HttpCode(200)
  score(@CurrentPrincipal() principal: Principal | null, @Body() body: unknown) {
    assertPrincipal(principal);
    const parsed = ScoreRequest.safeParse(body);
    if (!parsed.success) throw new BadRequestException("postinvest_rating_score_invalid");
    return rateFinancials(parsed.data.financials, parsed.data.facts);
  }
}
