/**
 * **晋升生成接收端**（F67；契约 `receivePromotedSkill`，UC-3.5 R3 步骤 4–5、
 * R6 AC1/AC2/AC4、R10 处置②：phase-1 只做接收端，触发端在 14-brain / phase-3）。
 *
 * 顺序（与 `create-skill-draft.ts` 同构，同一套纪律——见该文件头注释）：
 *   ① AI 不能自行晋升（E2/V5）
 *   ② 来源标记不可由调用方携带（I-11，同 F61 `create-skill-draft.ts` 的①）
 *   ③ 严格准入两项存在性检查（D-32/V3）
 *   ④ 批准前三项必填（V4，**skill 生成一并阻断**）
 *   ⑤ 脱敏闸门（D-16/V7）
 *   ⑥ 转写：留空标待补，不臆造；数据范围默认最小必要
 *   ⑦ 落 `待审核`（不是 `草稿`）＋ ⑧ 建立双向关联（I-22）
 *
 * ⚠ AC2「自动生成 ≠ 自动发布」不在本文件里断言——它由 `security-gate.ts` /
 *   `advance-skill-status.ts`（F61 已实现且已测）保证：`savePendingReview` 产出的
 *   版本没有门禁记录，任何把它推到 `已启用` 的尝试都会在那条唯一写入口上被
 *   `GATE_NOT_PASSED` 挡下并写审计。本文件只保证**永远不会**自己调用那条写入口。
 */
import {
  assignSourceByEntry,
  rejectCallerSuppliedSource,
} from "../../domain/skill/source-tag";
import {
  checkPromotionAdmission,
  checkPromotionRequiredFields,
  transcribeToDeclarativeContract,
  type PromotionLink,
} from "../../domain/skill/promotion-link";
import type { DeclarativeContract, SkillErrorCode } from "../../domain/skill/declarative-contract";
import type { SkillOriginTag } from "../../domain/skill/source-tag";
import type {
  PromoterKindPort,
  PromotionLinkStorePort,
  PromotionSkillStorePort,
  RedactionGatePort,
  SecurityAuditPort,
} from "./ports";

export interface ReceivePromotedSkillInput {
  readonly orgId: string;
  readonly knowledgeItemId: string;
  /** ⚠ 严格准入两项依据之一（D-32）——存在性由本用例检查，判定本身属 14-brain */
  readonly signedDecisionId: string;
  readonly reviewConclusionId: string;
  /** ⚠ **可以是残缺的**——转写不完整处留空并标待补，**不臆造**（契约 `.partial()`） */
  readonly draftContract: Partial<DeclarativeContract>;
  readonly applicableScope: string;
  readonly validUntil: string;
  readonly reviewOwnerId: string;
  readonly redactedOnly: boolean;
  /**
   * 晋升审批人。⚠ **不在 wire 契约里**（那份 `in` 是 `.strict()` 的）——
   * 与 `create-skill-draft.ts` 的 `submitterId` 同一处置：谁在操作，
   * 由认证上下文传入，不是请求体里的一个字段。
   */
  readonly approverPrincipalId: string;
  /** 未经契约解析的原始体，供来源标记写入尝试检测（同 `create-skill-draft.ts`）。 */
  readonly rawBody?: unknown;
}

export type ReceivePromotedSkillResult =
  | {
      readonly ok: true;
      readonly skillId: string;
      readonly versionId: string;
      readonly status: "待审核";
      readonly source: SkillOriginTag;
      /** 转写时靠占位符补的字段——供审核人/维护者知道「哪些还需要人工补全」 */
      readonly incompleteFields: readonly (keyof DeclarativeContract)[];
    }
  | { readonly ok: false; readonly code: SkillErrorCode; readonly reason: string };

export interface ReceivePromotedSkillDeps {
  readonly promoterKind: PromoterKindPort;
  readonly redactionGate: RedactionGatePort;
  readonly store: PromotionSkillStorePort;
  readonly links: PromotionLinkStorePort;
  readonly audit: SecurityAuditPort;
}

export async function receivePromotedSkill(
  input: ReceivePromotedSkillInput,
  deps: ReceivePromotedSkillDeps,
): Promise<ReceivePromotedSkillResult> {
  /* ① AI 不能自行晋升——AI 可提名，入库必须人工确认（E2/V5） */
  const kind = await deps.promoterKind.kindOf(input.approverPrincipalId);
  if (kind === "ai") {
    await deps.audit.record({
      kind: "skill-ai-self-promotion-attempt",
      principalId: input.approverPrincipalId,
      detail: `knowledgeItemId=${input.knowledgeItemId}：AI 不能自行晋升入库`,
    });
    return {
      ok: false,
      code: "AI_SELF_PROMOTION_FORBIDDEN",
      reason: "AI 可提名，但入库必须人工确认；任何自动入库路径必须被服务端拒绝",
    };
  }

  /* ② 来源标记不可由调用方携带（I-11，同 create-skill-draft.ts 的①） */
  const supplied = rejectCallerSuppliedSource(input.rawBody);
  if (supplied.rejected && supplied.code !== null) {
    await deps.audit.record({
      kind: "skill-source-tag-write-attempt",
      principalId: input.approverPrincipalId,
      detail: supplied.reason ?? "",
    });
    return { ok: false, code: supplied.code, reason: supplied.reason ?? "" };
  }

  /* ③ 严格准入两项存在性（D-32/V3） */
  const admission = checkPromotionAdmission({
    signedDecisionId: input.signedDecisionId,
    reviewConclusionId: input.reviewConclusionId,
  });
  if (!admission.ok) {
    return {
      ok: false,
      code: "PROMOTION_ADMISSION_FAILED",
      reason: `严格准入未满足，缺：${admission.missing.join("、")}`,
    };
  }

  /* ④ 批准前三项必填（V4） */
  const required = checkPromotionRequiredFields({
    applicableScope: input.applicableScope,
    validUntil: input.validUntil,
    reviewOwnerId: input.reviewOwnerId,
  });
  if (!required.ok) {
    return {
      ok: false,
      code: "PROMOTION_REQUIRED_FIELDS_MISSING",
      reason: `批准前必填缺项：${required.missing.join("、")}`,
    };
  }

  /* ⑤ 脱敏闸门（D-16/V7） */
  const needsRedaction = await deps.redactionGate.requiresRedaction(input.knowledgeItemId);
  if (needsRedaction && !input.redactedOnly) {
    return {
      ok: false,
      code: "REDACTION_GATE_REQUIRED",
      reason: "含客户机密的方法未过脱敏闸门；生成的 skill 只能引用脱敏稿",
    };
  }

  /* ⑥ 转写：留空标待补，不臆造；数据范围默认最小必要（结构性，见 promotion-link.ts） */
  const transcribed = transcribeToDeclarativeContract(input.draftContract);

  /* ⑦ 落待审核 ＋ ⑧ 建立双向关联。⚠ 不静默失败：store 抛出 ⇒ DEPENDENCY_UNAVAILABLE（E8/V11） */
  try {
    const source = assignSourceByEntry("promotion");
    const saved = await deps.store.savePendingReview({
      orgId: input.orgId,
      knowledgeItemId: input.knowledgeItemId,
      contract: transcribed.contract,
      source,
    });

    const link: PromotionLink = {
      skillId: saved.skillId,
      knowledgeItemId: input.knowledgeItemId,
      signedDecisionId: input.signedDecisionId,
      reviewConclusionId: input.reviewConclusionId,
      applicableScope: input.applicableScope,
      validUntil: input.validUntil,
      reviewOwnerId: input.reviewOwnerId,
    };
    await deps.links.save(link);

    return {
      ok: true,
      skillId: saved.skillId,
      versionId: saved.versionId,
      status: "待审核",
      source,
      incompleteFields: transcribed.incompleteFields,
    };
  } catch {
    return {
      ok: false,
      code: "DEPENDENCY_UNAVAILABLE",
      reason: "Skill 库不可写：晋升操作未生成 skill，请重试（不得静默失败，E8/V11）",
    };
  }
}
