/**
 * Phase 18 F03 —— 一批本体写入（实体 / 结论 + 证据 / 边）的形状与纯校验。
 *
 * 校验在这里做一遍、在数据库的 `kg_apply_batch` 里再做一遍（迁移 20260924190000）：
 * 应用层这一遍给出**可读的拒绝码**并留痕；数据库那一遍兜住绕过应用层的调用。
 * 两边判的是同一组不变量（契约束 chat-knowledge-graph I-1 / I-4 / I-5 / I-14），
 * 枚举全部来自契约，不在这里另起一份。
 */
import { contextPack as CP, knowledgeGraph as KG } from "@repo/contracts";
import type { z } from "zod";

export type KgScopeKind = KG.KgScopeKind;
export type OntologyActorKind = "human" | "model" | "system";

/** 本阶段开放的作用域（I-1）。与迁移里 `kg_scope_enabled` 是同一判断，外扩时两处一起改（有测试对账）。 */
export const ENABLED_KG_SCOPES: readonly KgScopeKind[] = ["chat_session", "personal"];

export interface OntologyObjectInput {
  readonly id: string;
  readonly objectKind: KG.KgObjectKind;
  readonly name: string;
  readonly aliases: readonly string[];
}

export interface OntologyEvidenceInput {
  readonly segmentId: string;
  readonly stance: "supporting" | "contradicting";
}

export interface OntologyClaimInput {
  readonly id: string;
  readonly claimKind: KG.KgClaimKind;
  readonly statement: string;
  readonly status: z.infer<typeof CP.ClaimStatus>;
  readonly confidence: number | null;
  readonly evidence: readonly OntologyEvidenceInput[];
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
