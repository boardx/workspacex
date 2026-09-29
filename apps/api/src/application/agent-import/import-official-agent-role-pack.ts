/**
 * AG03 / UC-3 —— 官方角色包导入。控制流镜像 `import-agent-starter-pack.ts`
 * （findExisting → packs.load → verify → [workflow 引用解析] → persistVerified），保持管理员
 * 决策先于任何依赖调用这条既有纪律；两个用例分开成文件是因为失败码、端口与落库形状都不同
 * （官方包多出 roleRef/roleLabel/role，且 catalogSource 恒为 'official'），同一个函数里
 * if/else 两条完全不同的落库路径不会比两个文件更清楚。HTTP 层在同一个端点里按 pack 内容形状
 * （entries 是否带 `roleRef`）分流到这个函数还是原函数，见 `agent-starter-import.controller.ts`。
 */
import type { IdentityRepository } from "../identity/ports";
import { agentImportPayloadDigest, InvalidOfficialAgentStarterPackError, verifyOfficialAgentStarterPack, type StarterToolPolicyViolation } from "../../domain/agent/starter-pack";
import type { OrgId } from "../../domain/org-id";
import type {
  AgentStarterImportResult,
  AgentStarterPackSource,
  ExistingAgentImportOutcome,
  OfficialAgentRolePackImportRepository,
  WorkflowDefinitionStore,
} from "./ports";

export class OfficialAgentRolePackNotFoundError extends Error {}
export class OfficialAgentRolePackInvalidError extends Error {}
/** UC-2/UC-3 E1：官方包同样只能声明能力分类（`violation` 只在首次判定时可得，幂等重放不回放路径）。 */
export class OfficialAgentRoleToolPolicyInvalidError extends Error {
  constructor(readonly violation: StarterToolPolicyViolation | null) { super("official agent role pack toolPolicy is invalid"); }
}
export class OfficialAgentRolePackConflictError extends Error {}
export class OfficialAgentRolePackIdempotencyConflictError extends Error {}
export class OfficialAgentRolePackAdminRequiredError extends Error {}
/** UC-3 E2：白名单引用了未注册的 Workflow；`missingIds` 只在首次判定时可得。 */
export class OfficialAgentRoleWorkflowRefUnresolvedError extends Error {
  constructor(readonly missingIds: readonly string[]) { super("official agent role pack references unregistered workflows"); }
}
/** UC-3 E2：挂载的 skillVersions 在本组织不存在或摘要不符；`missingIds` 只在首次判定时可得。 */
export class OfficialAgentRoleSkillRefUnresolvedError extends Error {
  constructor(readonly missingIds: readonly string[]) { super("official agent role pack references unresolvable skill versions"); }
}

const UNRESOLVED_WORKFLOW_REF = "UNRESOLVED_WORKFLOW_REF" as const;
const UNRESOLVED_SKILL_REF = "UNRESOLVED_SKILL_REF" as const;
const TOOL_POLICY_INVALID = "AGENT_STARTER_TOOL_POLICY_INVALID" as const;

export async function importOfficialAgentRolePack(
  deps: {
    readonly identities: IdentityRepository;
    readonly packs: AgentStarterPackSource;
    readonly workflows: WorkflowDefinitionStore;
    readonly imports: OfficialAgentRolePackImportRepository;
  },
  input: { readonly actorId: string; readonly orgId: OrgId; readonly packId: string; readonly packVersion: string; readonly idempotencyKey: string },
): Promise<{ readonly created: boolean; readonly result: AgentStarterImportResult }> {
  const membership = await deps.identities.findOrgMembership(input.actorId, input.orgId);
  if (!membership || membership.orgRole !== "admin") throw new OfficialAgentRolePackAdminRequiredError();
  const payloadDigest = agentImportPayloadDigest(input);
  const existing = await deps.imports.findExisting({ orgId: input.orgId, idempotencyKey: input.idempotencyKey, payloadDigest });
  if (existing.kind === "replayed") return { created: false, result: existing.result };
  if (existing.kind === "idempotency-conflict") throw new OfficialAgentRolePackIdempotencyConflictError();
  if (existing.kind === "previous-failure") throwFailure(existing.failureCode);

  const raw = await deps.packs.load(input.packId, input.packVersion);
  if (raw === null) {
    return replayOrThrow(await deps.imports.recordFailure({ ...input, payloadDigest, packDigest: null, failureCode: "AGENT_STARTER_PACK_NOT_FOUND" }));
  }

  let pack;
  try {
    pack = verifyOfficialAgentStarterPack(raw, input);
  } catch (error) {
    if (!(error instanceof InvalidOfficialAgentStarterPackError)) throw error;
    const packDigest = typeof raw === "object" && raw !== null && typeof (raw as { packDigest?: unknown }).packDigest === "string" ? (raw as { packDigest: string }).packDigest : null;
    const violation = error.toolPolicyViolation;
    const failureCode = violation ? TOOL_POLICY_INVALID : "AGENT_STARTER_PACK_INVALID";
    const outcome = await deps.imports.recordFailure({ ...input, payloadDigest, packDigest, failureCode });
    if (outcome.kind === "previous-failure" && violation) throw new OfficialAgentRoleToolPolicyInvalidError(violation);
    return replayOrThrow(outcome);
  }

  // E2 前半：白名单引用未注册 Workflow —— 在任何落库发生之前判定，命中即整包失败、DB 无新增行。
  const requestedWorkflowIds = [...new Set(pack.agents.flatMap((agent) => agent.role.workflowAllowlist))];
  const missingWorkflowIds: string[] = [];
  for (const stableId of requestedWorkflowIds) {
    if (!(await deps.workflows.isRegistered(stableId))) missingWorkflowIds.push(stableId);
  }
  if (missingWorkflowIds.length > 0) {
    const outcome = await deps.imports.recordFailure({ ...input, payloadDigest, packDigest: pack.packDigest, failureCode: UNRESOLVED_WORKFLOW_REF });
    if (outcome.kind === "previous-failure") throw new OfficialAgentRoleWorkflowRefUnresolvedError(missingWorkflowIds);
    return replayOrThrow(outcome, missingWorkflowIds);
  }

  // E2 后半（挂载 skillVersions 是否可解析）在同一事务内由 persistVerified 判定，
  // 与「事务里查一遍已存在的行、事务里写新行」共用同一把锁，避免 TOCTOU。
  const outcome = await deps.imports.persistVerified({ orgId: input.orgId, actorId: input.actorId, idempotencyKey: input.idempotencyKey, payloadDigest, pack });
  if (outcome.kind === "created") return { created: true, result: outcome.result };
  if (outcome.kind === "replayed") return { created: false, result: outcome.result };
  if (outcome.kind === "idempotency-conflict") throw new OfficialAgentRolePackIdempotencyConflictError();
  if (outcome.kind === "name-conflict") throw new OfficialAgentRolePackConflictError();
  if (outcome.kind === "skill-unresolved") throw new OfficialAgentRoleSkillRefUnresolvedError(outcome.missingIds);
  throwFailure(outcome.failureCode);
}

function replayOrThrow(
  outcome: Exclude<ExistingAgentImportOutcome, { readonly kind: "missing" }>,
  missingWorkflowIds: readonly string[] = [],
): { readonly created: boolean; readonly result: AgentStarterImportResult } {
  if (outcome.kind === "idempotency-conflict") throw new OfficialAgentRolePackIdempotencyConflictError();
  if (outcome.kind === "replayed") return { created: false, result: outcome.result };
  if (outcome.failureCode === UNRESOLVED_WORKFLOW_REF) throw new OfficialAgentRoleWorkflowRefUnresolvedError(missingWorkflowIds);
  throwFailure(outcome.failureCode);
}

function throwFailure(code: string): never {
  if (code === TOOL_POLICY_INVALID) throw new OfficialAgentRoleToolPolicyInvalidError(null);
  if (code === "AGENT_STARTER_PACK_NOT_FOUND") throw new OfficialAgentRolePackNotFoundError();
  if (code === "AGENT_STARTER_PACK_CONFLICT") throw new OfficialAgentRolePackConflictError();
  if (code === UNRESOLVED_WORKFLOW_REF) throw new OfficialAgentRoleWorkflowRefUnresolvedError([]);
  if (code === UNRESOLVED_SKILL_REF) throw new OfficialAgentRoleSkillRefUnresolvedError([]);
  throw new OfficialAgentRolePackInvalidError();
}
