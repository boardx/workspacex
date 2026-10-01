/**
 * Phase 18 F03 —— 一批本体写入（实体 / 结论 + 证据 / 边）的形状与纯校验。
 *
 * 校验在这里做一遍、在数据库的 `kg_apply_batch` 里再做一遍（迁移 20260924190000）：
 * 应用层这一遍给出**可读的拒绝码**并留痕；数据库那一遍兜住绕过应用层的调用。
 * 两边判的是同一组不变量（契约束 chat-knowledge-graph I-1 / I-4 / I-5 / I-14），
 * 枚举全部来自契约，不在这里另起一份。
 */
import { contextPack as CP, knowledgeGraph as KG, projectEvidence as PE } from "@repo/contracts";
import type { z } from "zod";

export type KgScopeKind = KG.KgScopeKind;
export type OntologyActorKind = "human" | "model" | "system";

/**
 * 本阶段开放的作用域（I-1）。与迁移里 `kg_scope_enabled` 是同一判断，外扩时两处一起改（有测试对账）。
 * B2-S4（issue #4428）放开 `org`（L3）：组织记忆只经晋升（`kg_promote_claim_to_org`）进入，见下面的执行者规则。
 */
export const ENABLED_KG_SCOPES: readonly KgScopeKind[] = ["chat_session", "personal", "project", "org"];

export interface OntologyObjectInput {
  readonly id: string;
  readonly objectKind: KG.KgObjectKind;
  readonly name: string;
  readonly aliases: readonly string[];
}

/**
 * 证据：附件片段（segments）、会话消息（chat_messages，F06），或 B3-T2 的**项目证据单元**
 * （`project_evidence`，六类归一来源）。三种都算 I-5 的「证据」。
 * 消息 / 证据单元的证据带一句可读摘录（≤ 280 字），面板直接展示原话。
 *
 * `evidenceId`（B3-T1，#4495）在片段 / 消息变体上可选：归一后的证据单元 `project_evidence.id`——项目作用域线程的
 * 消息锚点在写入前由 `collect-evidence/chat.ts` 回填；没有（个人线程 / 旧数据）就不带，执行器落 NULL。
 * 证据单元变体（B3-T2，#4496）只给项目作用域的入图批次用（`kg_insert_claim_evidence` 对非 project 作用域拒收）：
 * `evidenceId` 必填指向证据单元，`sourceKind` / `sourceRef` 冗余存下来是为了锚点（`KgEvidenceAnchor`）
 * 不必回表就能渲染；来源枚举与契约 `ProjectEvidenceSourceKind` 同一份。
 */
export type OntologyEvidenceInput =
  | { readonly segmentId: string; readonly stance: "supporting" | "contradicting"; readonly evidenceId?: string }
  | { readonly messageId: string; readonly stance: "supporting" | "contradicting"; readonly excerpt: string; readonly evidenceId?: string }
  | {
      readonly evidenceId: string;
      readonly sourceKind: PE.ProjectEvidenceSourceKind;
      readonly sourceRef: string;
      readonly stance: "supporting" | "contradicting";
      readonly excerpt: string;
    };

export interface OntologyClaimInput {
  readonly id: string;
  readonly claimKind: KG.KgClaimKind;
  readonly statement: string;
  readonly status: z.infer<typeof CP.ClaimStatus>;
  readonly confidence: number | null;
  readonly evidence: readonly OntologyEvidenceInput[];
  /** issue #4363（S6）：有效期（ISO，左闭右开；落在 claims.valid_from / valid_to）。省略 ⇒ 从写入时起长期有效。 */
  readonly validFrom?: string;
  readonly validUntil?: string;
  /** issue #4363（S6）：待办的截止日期（ISO；claims.due_at）。 */
  readonly dueAt?: string;
}

export type OntologyEndpointKind = "object" | "claim" | "segment" | "chat_message";

export interface OntologyEdgeInput {
  readonly id: string;
  readonly srcKind: OntologyEndpointKind;
  readonly srcId: string;
  readonly dstKind: OntologyEndpointKind;
  readonly dstId: string;
  readonly relation: KG.KgRelation;
}

export interface OntologyBatch {
  readonly actionId: string;
  readonly scope: { readonly kind: KgScopeKind; readonly id: string };
  readonly actor: { readonly kind: OntologyActorKind; readonly id: string };
  /** 例：`extract`、`confirmClaims`。审计里按它分类。 */
  readonly actionType: string;
  /** 幂等键的一半：抽取任务的来源（消息 id / 附件版本 id）。人工动作可为 null。 */
  readonly sourceRef: string | null;
  /** 幂等键的另一半：抽取流水线版本。 */
  readonly pipelineVersion: string | null;
  readonly objects: readonly OntologyObjectInput[];
  readonly claims: readonly OntologyClaimInput[];
  readonly edges: readonly OntologyEdgeInput[];
}

/**
 * 执行器拒绝码。对外的 `KgErrorCode` 能表达的用它；另外三个是流水线内部的
 * （抽取产物不合格），只进 `ontology_actions.reject_code`，不出现在 HTTP 响应里。
 */
export type OntologyRejectCode =
  | Extract<KG.KgErrorCode, "KG_SCOPE_NOT_ENABLED" | "KG_ACTOR_NOT_HUMAN" | "KG_NOT_OWNER">
  | "KG_EVIDENCE_REQUIRED"
  | "KG_EVIDENCE_NOT_FOUND"
  | "KG_INVALID_BATCH";

export type BatchVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: OntologyRejectCode; readonly reason: string };

const reject = (code: OntologyRejectCode, reason: string): BatchVerdict => ({ ok: false, code, reason });

/**
 * 纯校验。`currentUserId` 是发起这次写入的登录用户（个人空间只有本人能写，I-14）；
 * 后台抽取没有登录用户时传 null ——那它就写不了任何人的个人空间。
 */
export function validateOntologyBatch(batch: OntologyBatch, currentUserId: string | null): BatchVerdict {
  if (!ENABLED_KG_SCOPES.includes(batch.scope.kind)) {
    return reject("KG_SCOPE_NOT_ENABLED", `scope ${batch.scope.kind} is not enabled in this phase`);
  }
  if (batch.scope.kind === "personal" && batch.scope.id !== currentUserId) {
    return reject("KG_NOT_OWNER", "personal scope can only be written by its owner");
  }
  // B2-S4：组织记忆（L3）只由人替组织记下（组织 lead / admin 经 `kg_promote_claim_to_org` 晋升，落库判定在那里）；
  // 模型 / 系统批次不能直接写进组织层——抽取流水线只写会话作用域，这里兜住任何绕到 org 的批次。
  if (batch.scope.kind === "org" && batch.actor.kind !== "human") {
    return reject("KG_ACTOR_NOT_HUMAN", `org scope is written by people only, got ${batch.actor.kind}`);
  }
  // I-15：人工动作的执行身份就是登录用户本人，不能代别人「确认」。
  if (batch.actor.kind === "human" && batch.actor.id !== currentUserId) {
    return reject("KG_NOT_OWNER", "a human action must be performed by the signed-in user");
  }
  for (const o of batch.objects) {
    if (!KG.KgObjectKind.safeParse(o.objectKind).success || o.name.trim() === "") {
      return reject("KG_INVALID_BATCH", `object ${o.id} has an invalid kind or empty name`);
    }
  }
  for (const c of batch.claims) {
    if (!KG.KgClaimKind.safeParse(c.claimKind).success || c.statement.trim() === "") {
      return reject("KG_INVALID_BATCH", `claim ${c.id} has an invalid kind or empty statement`);
    }
    if (c.confidence !== null && (c.confidence < 0 || c.confidence > 1)) {
      return reject("KG_INVALID_BATCH", `claim ${c.id} confidence out of [0,1]`);
    }
    // issue #4363（S6）：有效期左闭右开（与 claims_validity_chk 同一条）；时间要能解析
    const t = (s: string | undefined) => (s === undefined ? null : Date.parse(s));
    const [from, until, due] = [t(c.validFrom), t(c.validUntil), t(c.dueAt)];
    if ([from, until, due].some((x) => x !== null && !Number.isFinite(x)) || (from !== null && until !== null && from >= until)) {
      return reject("KG_INVALID_BATCH", `claim ${c.id} has an invalid validity window`);
    }
    // I-4：模型 / 系统只能提出，确认是人的动作
    if (batch.actor.kind !== "human" && c.status !== "proposed") {
      return reject("KG_ACTOR_NOT_HUMAN", `claim ${c.id}: ${batch.actor.kind} may only propose, got ${c.status}`);
    }
    // I-5：没有出处的结论不入图
    if (!c.evidence.some((e) => e.stance === "supporting")) {
      return reject("KG_EVIDENCE_REQUIRED", `claim ${c.id} has no supporting evidence`);
    }
  }
  for (const e of batch.edges) {
    if (!KG.KgRelation.safeParse(e.relation).success) {
      return reject("KG_INVALID_BATCH", `edge ${e.id} has relation ${e.relation} outside the closed set`);
    }
  }
  return { ok: true };
}
