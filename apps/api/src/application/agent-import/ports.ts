import type { z } from "zod";
import type { wave2Runtime } from "@repo/contracts";
import type { OrgId } from "../../domain/org-id";
import type { AgentStarterPack, OfficialAgentStarterPack } from "../../domain/agent/starter-pack";

export type AgentStarterImportResult = z.infer<typeof wave2Runtime.AgentStarterImportResult>;
export interface AgentStarterPackSource { load(packId: string, packVersion: string): Promise<unknown | null>; }
export const AGENT_STARTER_PACK_SOURCE = Symbol("AgentStarterPackSource");

export type ExistingAgentImportOutcome =
  | { readonly kind: "missing" }
  | { readonly kind: "replayed"; readonly result: AgentStarterImportResult }
  | { readonly kind: "idempotency-conflict" }
  | { readonly kind: "previous-failure"; readonly failureCode: string };
export type PersistVerifiedAgentImportOutcome =
  | { readonly kind: "created"; readonly result: AgentStarterImportResult }
  | Exclude<ExistingAgentImportOutcome, { readonly kind: "missing" }>
  | { readonly kind: "name-conflict" }
  | { readonly kind: "skill-missing" }
  | { readonly kind: "skill-mismatch" };

export interface AgentStarterImportRepository {
  findExisting(input: { readonly orgId: OrgId; readonly idempotencyKey: string; readonly payloadDigest: string }): Promise<ExistingAgentImportOutcome>;
  persistVerified(input: { readonly orgId: OrgId; readonly actorId: string; readonly idempotencyKey: string; readonly payloadDigest: string; readonly pack: AgentStarterPack }): Promise<PersistVerifiedAgentImportOutcome>;
  recordFailure(input: { readonly orgId: OrgId; readonly actorId: string; readonly idempotencyKey: string; readonly payloadDigest: string; readonly packId: string; readonly packVersion: string; readonly packDigest: string | null; readonly failureCode: string }): Promise<Exclude<ExistingAgentImportOutcome, { readonly kind: "missing" }>>;
}
export const AGENT_STARTER_IMPORT_REPOSITORY = Symbol("AgentStarterImportRepository");

/**
 * AG03 / UC-3 E2：`workflowAllowlist` 引用解析 port——「已注册」的单一事实源见
 * `infrastructure/agent/file-workflow-definition-store.ts` 头注（`requirements/work-stack-v2/
 * workflows/` 实体文档目录，不另开一张复述同一件事的 DB 表）。
 */
export interface WorkflowDefinitionStore {
  isRegistered(stableId: string): Promise<boolean>;
  /**
   * AG04 · 目录卡片需要展示 Workflow 名字，而不仅仅是 stableId（ui.md 「可发起 Workflow 列表」）。
   * 同一份单一事实源（实体文档目录）里取，不另建一张复述名字的表。未注册 / 读取失败 → null，
   * 调用方回退显示 stableId 本身，不整卡报错（同 `isRegistered` 的 fail-soft 纪律）。
   */
  resolveName(stableId: string): Promise<string | null>;
}
export const WORKFLOW_DEFINITION_STORE = Symbol("WorkflowDefinitionStore");

export type PersistVerifiedOfficialAgentRolePackOutcome =
  | { readonly kind: "created"; readonly result: AgentStarterImportResult }
  | Exclude<ExistingAgentImportOutcome, { readonly kind: "missing" }>
  | { readonly kind: "name-conflict" }
  | { readonly kind: "skill-unresolved"; readonly missingIds: readonly string[] };

/**
 * AG03：与 `AgentStarterImportRepository` 同构但落库时多写 7 个角色列
 * （`catalogSource='official'`，见 `infrastructure/agent/pg-official-agent-role-pack-import-repository.ts`）。
 * 沿用同一张 `agent_starter_pack_imports` 幂等台账表（同一个 HTTP 端点分流出来的两条导入路径，
 * 没有理由各开一张台账）。
 */
export interface OfficialAgentRolePackImportRepository {
  findExisting(input: { readonly orgId: OrgId; readonly idempotencyKey: string; readonly payloadDigest: string }): Promise<ExistingAgentImportOutcome>;
  persistVerified(input: { readonly orgId: OrgId; readonly actorId: string; readonly idempotencyKey: string; readonly payloadDigest: string; readonly pack: OfficialAgentStarterPack }): Promise<PersistVerifiedOfficialAgentRolePackOutcome>;
  recordFailure(input: { readonly orgId: OrgId; readonly actorId: string; readonly idempotencyKey: string; readonly payloadDigest: string; readonly packId: string; readonly packVersion: string; readonly packDigest: string | null; readonly failureCode: string }): Promise<Exclude<ExistingAgentImportOutcome, { readonly kind: "missing" }>>;
}
export const OFFICIAL_AGENT_ROLE_PACK_IMPORT_REPOSITORY = Symbol("OfficialAgentRolePackImportRepository");
