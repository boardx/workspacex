/**
 * `createSkillDraft` —— UC-3.1 R3 步骤 1–2（F61）。
 *
 * 顺序**是规格的一部分**，不是实现细节：
 *   ① 来源标记：调用方带了 `source` ⇒ `SOURCE_TAG_IMMUTABLE` **并写审计**（I-11 / V10）
 *   ② 静态契约校验：必填 / schema 可解析且自洽 / 失败兜底 ⇒ `CONTRACT_VALIDATION_FAILED`
 *   ③ 数据范围越权检查（提交人权限为上界）⇒ `DATA_SCOPE_EXCEEDS_SUBMITTER`
 *                                        / `RAW_TRANSCRIPT_NOT_AUTHORIZED`
 *   ④ 落 `草稿`
 *
 * ⚠ ②③ 任一失败 ⇒ **不入库、不进待审核队列**（R3 步骤 2 / E1）。
 *   所以 `saveDraft` 在失败路径上一次都不会被调用——
 *   `scope-not-exceed-submitter.test.ts` 直接断言这一点，而不是断言返回码。
 *   一个「写进去了但标成失败」的实现，返回码看起来是一样的。
 */
import {
  validateDeclarativeContract,
  type DeclarativeContract,
  type SkillErrorCode,
  type ValidationIssue,
} from "../../domain/skill/declarative-contract";
import { checkDataScopeWithinSubmitter, type DataScopeKey } from "../../domain/skill/data-scope";
import {
  assignSourceByEntry,
  entrySourceWithinContract,
  isCommunityEntryAvailable,
  rejectCallerSuppliedSource,
  uncontractedSourceReason,
  type SkillCreationEntry,
  type SkillOriginTag,
} from "../../domain/skill/source-tag";
import type { SkillLifecycleStatus } from "../../domain/skill/skill-status";
import type {
  SecurityAuditPort,
  SkillDraftStorePort,
  SubmitterGrantsPort,
} from "./ports";

export interface CreateSkillDraftInput {
  readonly orgId: string;
  readonly submitterId: string;
  readonly name: string;
  readonly duty: string;
  readonly contract: DeclarativeContract;
  /** ⚠ **入口**，不是「调用方声称的来源」 */
  readonly entry: SkillCreationEntry;
  /**
   * 契约 `createSkillDraft.in.visibility` / `modelRef`（#459 补齐）。
   *
   * ⚠ 这两个字段在契约里是**必填**的，而本用例此前把它们丢掉了——于是
   *   `SkillListItem.visibility` 无处可取，落库时只能猜一个默认值。
   *   「契约要求的入参在实现里没有落点」是 ADR-020 要防的漂移方向，补齐而不是给默认值。
   * ⚠ `visibility = team-only` 时 `ownerTeamId` 必须非空；DB 侧
   *   `skill_contracts_team_only_needs_team` 同判，两道都要（应用层给得出好错误，
   *   DB 那道保证绕过应用层也进不来）。
   */
  readonly visibility: "org-wide" | "team-only";
  readonly ownerTeamId: string | null;
  readonly modelRef: string;
  /**
   * 未经契约解析的原始请求体。
   * 契约的 `createSkillDraft.in` 是 `.strict()` 的，所以解析后永远看不到 `source`——
   * 真实的写入尝试只在这一层可见（`source-tag.ts` 头部有完整理由）。
   */
  readonly rawBody?: unknown;
}

export type CreateSkillDraftResult =
  | {
      readonly ok: true;
      readonly skillId: string;
      readonly versionId: string;
      readonly source: SkillOriginTag;
      readonly status: SkillLifecycleStatus;
    }
  | {
      readonly ok: false;
      readonly code: SkillErrorCode;
      readonly reason: string;
      /** 静态校验失败时逐条；其它失败为空数组 */
      readonly issues: readonly ValidationIssue[];
      /** 越权失败时逐条；其它失败为空数组 */
      readonly exceeded: readonly DataScopeKey[];
      /** ⚠ 恒 false —— 「不进待审核队列」是行为，不是文案 */
      readonly enteredReviewQueue: false;
    };

export interface CreateSkillDraftDeps {
  readonly grants: SubmitterGrantsPort;
  readonly store: SkillDraftStorePort;
  readonly audit: SecurityAuditPort;
}

export async function createSkillDraft(
  input: CreateSkillDraftInput,
  deps: CreateSkillDraftDeps,
): Promise<CreateSkillDraftResult> {
  /* ① 来源标记不可写 —— 拒 + 审计 */
  const supplied = rejectCallerSuppliedSource(input.rawBody);
  if (supplied.rejected && supplied.code !== null) {
    await deps.audit.record({
      kind: "skill-source-tag-write-attempt",
      principalId: input.submitterId,
      detail: supplied.reason ?? "",
    });
    return {
      ok: false,
      code: supplied.code,
      reason: supplied.reason ?? "",
      issues: [],
      exceeded: [],
      enteredReviewQueue: false,
    };
  }

  /* phase-1 社区导入入口置灰（D-06 / DECISION-Q0）。
     ⚠ 服务端拒，不是前端隐藏：一个只在界面上灰掉的入口，直调依然通。 */
  if (!isCommunityEntryAvailable(input.entry)) {
    return {
      ok: false,
      code: "DEPENDENCY_UNAVAILABLE",
      reason: "外部社区导入 phase-1 不实现（D-06 / DECISION-Q0：留 phase-2），入口置灰",
      issues: [],
      exceeded: [],
      enteredReviewQueue: false,
    };
  }

  /* ①b #514：入口打出的来源标记契约收不下 ⇒ fail-closed，**不入库**。
     顺序在社区门之后：`community-import` 两条都命中，而「phase-1 不实现」比
     「D09 未裁」更具体，先到的那道门给的理由更有用。
     ⚠ 不在这里把 `画布` 映射成契约内的取值——见 `entrySourceWithinContract` 的理由。 */
  if (!entrySourceWithinContract(input.entry)) {
    return {
      ok: false,
      code: "DEPENDENCY_UNAVAILABLE",
      reason: uncontractedSourceReason(input.entry),
      issues: [],
      exceeded: [],
      enteredReviewQueue: false,
    };
  }

  /* ② 静态契约校验 —— 失败不入库 */
  const validation = validateDeclarativeContract(input.contract);
  if (!validation.ok && validation.code !== null) {
    return {
      ok: false,
      code: validation.code,
      reason: `静态契约校验失败，共 ${validation.issues.length} 条`,
      issues: validation.issues,
      exceeded: [],
      enteredReviewQueue: false,
    };
  }

  /* ③ 数据范围越权 —— 以提交人当时的权限为上界，失败不入库、不进队列 */
  const scope = checkDataScopeWithinSubmitter({
    declared: input.contract.dataScope,
    readsRawTranscript: input.contract.readsRawTranscript,
    submitterGrants: await deps.grants.grantsOf(input.submitterId),
  });
  if (!scope.ok && scope.code !== null) {
    return {
      ok: false,
      code: scope.code,
      reason: scope.reason ?? "",
      issues: [],
      exceeded: scope.exceeded,
      enteredReviewQueue: false,
    };
  }

  /* ④ 落草稿 */
  const source = assignSourceByEntry(input.entry);
  const saved = await deps.store.saveDraft({
    orgId: input.orgId,
    name: input.name,
    duty: input.duty,
    contract: input.contract,
    source,
    submitterId: input.submitterId,
    visibility: input.visibility,
    ownerTeamId: input.ownerTeamId,
    modelRef: input.modelRef,
  });

  return { ok: true, skillId: saved.skillId, versionId: saved.versionId, source, status: "草稿" };
}
