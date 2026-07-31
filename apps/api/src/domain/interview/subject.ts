/**
 * `Subject` 访谈/观察对象 —— 洋葱最内层（F97，uc-6-7 R3-2，domain.md 「Subject」）。
 *
 * ## 这个文件唯一要证明的事
 *
 * 项目侧组卡与访谈侧受访者名单是**同一条记录的两个投影**（AC5），且第六列「状态」
 * **不是存出来的，是算出来的**（I-19/I-20）：`deriveConsentStatus` 是那条派生规则
 * 唯一的实现，两处投影都必须调它，不得各自维护一份状态判断。
 *
 * ⚠ 与 `recording` 束的三项授权矩阵是**故意不合并**的两套同意位（见
 * `packages/contracts/src/interview.ts` 的 `KNOWN_CONTRACT_GAPS.C_ITV_2`）——
 * 这里只处理访谈侧四位 `ConsentBits`，不 import recording 的那一套。
 *
 * ## 三态而不是七态
 *
 * uc-6-7/R3 第 4 步写的完整状态机是
 * `待确认 → 已邀约 → 待签 → 已授权/拒绝AI分析 → 已完成/已放弃`，
 * 但同一段明确说「**待签 / 已授权 / 拒绝 AI 分析** 三态直接取自 UC-6.3 的同意书状态」——
 * 只有这三态是 `ConsentBits` 的纯函数。其余四态（已邀约/已完成/已放弃）依赖预约
 * 与访谈生命周期（F99/F88 的输入），且 R4/R3 自己把完整状态机标为 [待确认]。
 * 编出另外四态会是在替产品裁决一个 UC 自己都没敢裁的枚举，所以本文件只实现
 * 这三态，其余留空并在 PR 里如实报告为缺口，而不是自造字面量填满七态的样子。
 */

import { interview } from "@repo/contracts";
import type { z } from "zod";

/** 六列之一「方式」：观察 / 访谈 / 多人访谈（R3-2 备注列）。 */
export type SubjectMode = "observation" | "interview" | "group_interview";

/** 四位同意位。派生自契约的 `interview.ConsentBits`，不重新声明结构（single-source）。 */
export type ConsentBits = z.infer<typeof interview.ConsentBits>;

/**
 * 三态子集（见文件头「三态而不是七态」）。
 *
 * · `pending_consent`       —— 尚无任何提交 ≈ R3 的「待签」（尚未签署完成）
 * · `authorized`            —— 已提交且 `ai_analysis = true` ≈ 「已授权」
 * · `ai_analysis_declined`  —— 已提交且 `ai_analysis = false` ≈ 「拒绝 AI 分析」
 */
export type SubjectConsentStatus = "pending_consent" | "authorized" | "ai_analysis_declined";

/**
 * `Subject.consentStatus` 的唯一派生实现（I-19/I-20）。
 *
 * ⚠ 纯函数，不接触数据库：调用方负责从 `interview_consent_submissions` 取出
 * "该 (interviewSessionId, subjectId) 组合下最新一条"再传进来。这里不做"取最新"
 * 这件事，是为了让"哪一份是最新"的规则（`submitted_at` 最大）只写在仓储的一处 SQL
 * 里，不在这个纯函数里重复一遍取数逻辑。
 *
 * @param bits `null` = 该受访者尚无任何同意提交。
 */
export function deriveConsentStatus(bits: ConsentBits | null): SubjectConsentStatus {
  if (bits === null) return "pending_consent";
  return bits.ai_analysis ? "authorized" : "ai_analysis_declined";
}

/** 访谈/观察对象实体的存储形态（六列中五列 + 关联键）。第六列「状态」不在这里——见文件头。 */
export interface SubjectRecord {
  readonly subjectId: string;
  readonly groupId: string | null;
  readonly displayName: string;
  readonly roleTitle: string;
  readonly orgName: string | null;
  readonly backgroundAndQuestions: string;
  readonly mode: SubjectMode;
  readonly sourceKind: "human" | "virtual";
  /** 恒掩码。O-39：接口默认只返回这个，明文只有 F98 的 `revealContact` 一条路。 */
  readonly contactMask: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
}

export const SUBJECT_MODES: readonly SubjectMode[] = ["observation", "interview", "group_interview"];
