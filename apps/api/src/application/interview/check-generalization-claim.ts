/**
 * `checkGeneralizationClaim` —— 普遍性断言写作约束（F05，uc-6-5 R3 step7 / R4 E9,
 * AC7/V7，`packages/contracts/src/interview.ts` `checkGeneralizationClaim`）。
 *
 * ⚠ **只接线，不重算**：独立受访者计数口径（同一人多条只算 1、附和与
 *   `sourceKind=virtual` 不计入）与门槛判定全部落在
 *   `domain/interview/generality-claim.ts` 的纯函数（`checkGeneralizationClaim` /
 *   `countIndependentSubjects`），阈值 5 全仓单一来源
 *   `packages/contracts/src/thresholds.ts`——本文件只负责"从持久化引述真实取数喂给
 *   它 + 落到契约的 err 码"这两件编排层的事。
 *
 * ⚠ **`themeId` 在本仓当前实现下取值就是 `rqId`**：`mergeThemes`/`splitThemes`
 *   引入的独立 theme 身份（F04）尚未接线，`rqId` 是 `extractQuotes`/
 *   `generateCandidateInsights` 已经在用的唯一持久化"主题式"分组键（见
 *   `insight-ports.ts` `QuoteRepository.listByOrgAndRqId` 端口头注）——不是本文件
 *   新发明的口径，等 F04 落地后由 `mergeThemes`/`splitThemes` 的编排层决定要不要
 *   把 theme 身份重新指回 rqId 分组或另开一张表，本文件不预判。
 *
 * ⚠ **已知缺口，如实登记不假装做了**：`interview_quotes` 目前没有持久化「附和」
 *   标记（`is_appeasement`）——那是证据矩阵（F02/F94）读路径的信号来源，本域写路径
 *   （F01）建表时没有引入这一列。本函数因此把每条持久化引述的 `isAppeasement`
 *   恒置为 `false` 喂给 `countIndependentSubjects`：这不会让计数虚高（附和被误计入
 *   独立人数），只会让"某条本该被附和覆盖排除的引述"仍被计入独立受访者——
 *   在当前没有该信号的情况下这是唯一诚实的默认值，不是静默丢弃业务规则。
 *   `sourceKind=virtual` 排除与"同一人多条只算 1"两条口径不受这个缺口影响，
 *   因为它们的信号（`sourceKind`/`subjectId`）确实持久化在 `interview_quotes`。
 */
import type { OrgId } from "../../domain/org-id";
import {
  checkGeneralizationClaim as checkGeneralizationClaimPure,
  type QuoteForIndependentCount,
} from "../../domain/interview/generality-claim";
import { GeneralizationUnsupportedError } from "./errors";
import type { QuoteRepository } from "./insight-ports";

export interface CheckGeneralizationClaimDeps {
  readonly quotes: QuoteRepository;
}

export interface CheckGeneralizationClaimInput {
  readonly orgId: OrgId;
  readonly themeId: string;
  readonly draftText: string;
}

export interface CheckGeneralizationClaimResult {
  readonly blocked: false;
  readonly independentSubjects: number;
  readonly suggestion: null;
}

export async function checkGeneralizationClaim(
  deps: CheckGeneralizationClaimDeps,
  input: CheckGeneralizationClaimInput,
): Promise<CheckGeneralizationClaimResult> {
  const stored = await deps.quotes.listByOrgAndRqId(input.orgId, input.themeId);

  // subjectId 为 null（片段没有已解析出的说话人）没有意义作为"某个独立受访者"的信号，
  // 不计入——与 `extractQuotes` 对空说话人的既有立场一致，不新发明第二套规则。
  const quotes: QuoteForIndependentCount[] = stored
    .filter((q): q is typeof q & { subjectId: string } => q.subjectId !== null)
    .map((q) => ({
      subjectId: q.subjectId,
      sourceKind: q.sourceKind,
      // ⚠ 见文件头「已知缺口」——`interview_quotes` 尚未持久化附和标记。
      isAppeasement: false,
    }));

  const result = checkGeneralizationClaimPure(input.draftText, quotes);

  if (result.blocked) {
    // suggestion 在 blocked=true 时恒非 null（domain 层保证，见其文件头注释）。
    throw new GeneralizationUnsupportedError(result.independentSubjects, result.suggestion ?? "");
  }

  return { blocked: false, independentSubjects: result.independentSubjects, suggestion: null };
}
