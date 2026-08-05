/**
 * `submitSkillForReview` —— `草稿 → 待审核`（#552；契约 `submitSkillForReview`）。
 *
 * 双重门禁是**并列**的，不是「先提交再补扫描」（`usecases.md` 逐字）。所以本用例
 * 不做扫描，只**读**扫描结论并把它交给状态机：没扫过 ⇒ `SECURITY_SCAN_REJECTED`，
 * 判拒 ⇒ 同码。这条判定不在这里写第二遍，它在 `security-gate.ts` 的
 * `scanAllowsSubmission` 里，由 `advanceSkillStatus` 唯一那条状态机入口调用。
 *
 * ## 为什么这个文件这么薄
 *
 * 薄是结论，不是省事。状态机只有一个写入口（`advance-skill-status.ts` 文件头逐字：
 * 「一个状态机若有第二个写入口，那个入口就是同一条直达路由，只是没写在路由表上」），
 * 而门禁判定住在 domain。本用例只负责把「哪一版、谁提交的、扫描结论是什么」这三件
 * **来自库的**事实凑齐，然后交给那一个入口。
 *
 * ⚠ `expectedVersion`（契约入参）在这里对应版本自身的 `state`：调用方以为自己在提交一份
 *   `草稿`，而它可能已经被别人提交过了。不比对就会出现两次提交、两条边、一条被静默吞掉。
 */
import { advanceSkillStatus, type AdvanceSkillStatusResult } from "./advance-skill-status";
import type { SkillLifecycleStatus } from "../../domain/skill/skill-status";
import type { SecurityScanResult } from "../../domain/skill/security-gate";
import type { SecurityAuditPort } from "./ports";

export interface SubmitSkillForReviewInput {
  readonly skillId: string;
  readonly versionId: string;
  /** 已由 Guard 认证过的调用者。 */
  readonly principalId: string;
  /** 该 skill **此刻**的状态，来自库；不是调用方的假设（同 `disable-skill` 的既定纪律）。 */
  readonly from: SkillLifecycleStatus;
  /** 门禁第一道的结论。⚠ `null` ＝ 从未扫过 ⇒ 拒，见文件头。 */
  readonly scan: SecurityScanResult | null;
}

export type SubmitSkillForReviewResult = AdvanceSkillStatusResult;

export async function submitSkillForReview(
  input: SubmitSkillForReviewInput,
  deps: { readonly audit: SecurityAuditPort },
): Promise<SubmitSkillForReviewResult> {
  return advanceSkillStatus(
    {
      skillId: input.skillId,
      principalId: input.principalId,
      from: input.from,
      to: "待审核",
      gates: {
        scan: input.scan,
        // ⚠ 恒为 `null`：提交这一步**还没有人审**。写 `{ approved: false }` 会让
        //   「还没人审」与「审了没过」在门禁记录里变成同一件事（`security-gate.ts` 逐字）。
        methodologyReview: null,
        // 逐条确认发生在评审那一步，不是提交这一步。
        acknowledgedRiskItemIds: [],
      },
    },
    { audit: deps.audit },
  );
}
