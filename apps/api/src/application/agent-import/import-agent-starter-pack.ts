import type { IdentityRepository } from "../identity/ports";
import { agentImportPayloadDigest, InvalidAgentStarterPackError, verifyAgentStarterPack } from "../../domain/agent/starter-pack";
import type { OrgId } from "../../domain/org-id";
import type { AgentStarterImportRepository, AgentStarterImportResult, AgentStarterPackSource } from "./ports";

export class AgentStarterPackNotFoundError extends Error {}
export class AgentStarterPackInvalidError extends Error {}
export class AgentStarterPackConflictError extends Error {}
export class AgentStarterImportIdempotencyConflictError extends Error {}
export class AgentStarterImportAdminRequiredError extends Error {}
export class AgentStarterSkillVersionMissingError extends Error {}
export class AgentStarterSkillVersionMismatchError extends Error {}

export async function importAgentStarterPack(
  deps: { readonly identities: IdentityRepository; readonly packs: AgentStarterPackSource; readonly imports: AgentStarterImportRepository },
  input: { readonly actorId: string; readonly orgId: OrgId; readonly packId: string; readonly packVersion: string; readonly idempotencyKey: string },
): Promise<{ readonly created: boolean; readonly result: AgentStarterImportResult }> {
  const membership = await deps.identities.findOrgMembership(input.actorId, input.orgId);
  if (!membership || membership.orgRole !== "admin") throw new AgentStarterImportAdminRequiredError();
  const payloadDigest = agentImportPayloadDigest(input);
  const existing = await deps.imports.findExisting({ orgId: input.orgId, idempotencyKey: input.idempotencyKey, payloadDigest });
  if (existing.kind === "replayed") return { created: false, result: existing.result };
  if (existing.kind === "idempotency-conflict") throw new AgentStarterImportIdempotencyConflictError();
  if (existing.kind === "previous-failure") throwFailure(existing.failureCode);
  const raw = await deps.packs.load(input.packId, input.packVersion);
  if (raw === null) return replayOrThrow(await deps.imports.recordFailure({ ...input, payloadDigest, packDigest: null, failureCode: "AGENT_STARTER_PACK_NOT_FOUND" }));
  let pack;
  try { pack = verifyAgentStarterPack(raw, input); }
  catch (error) {
    if (!(error instanceof InvalidAgentStarterPackError)) throw error;
    const packDigest = typeof raw === "object" && raw !== null && typeof (raw as { packDigest?: unknown }).packDigest === "string" ? (raw as { packDigest: string }).packDigest : null;
    return replayOrThrow(await deps.imports.recordFailure({ ...input, payloadDigest, packDigest, failureCode: "AGENT_STARTER_PACK_INVALID" }));
  }
  const outcome = await deps.imports.persistVerified({ orgId: input.orgId, actorId: input.actorId, idempotencyKey: input.idempotencyKey, payloadDigest, pack });
  if (outcome.kind === "created") return { created: true, result: outcome.result };
  if (outcome.kind === "replayed") return { created: false, result: outcome.result };
  if (outcome.kind === "idempotency-conflict") throw new AgentStarterImportIdempotencyConflictError();
  if (outcome.kind === "name-conflict") throw new AgentStarterPackConflictError();
  if (outcome.kind === "skill-missing") throw new AgentStarterSkillVersionMissingError();
  if (outcome.kind === "skill-mismatch") throw new AgentStarterSkillVersionMismatchError();
  throwFailure(outcome.failureCode);
}

function replayOrThrow(outcome: Exclude<Awaited<ReturnType<AgentStarterImportRepository["recordFailure"]>>, never>): { readonly created: boolean; readonly result: AgentStarterImportResult } {
  if (outcome.kind === "idempotency-conflict") throw new AgentStarterImportIdempotencyConflictError();
  if (outcome.kind === "replayed") return { created: false, result: outcome.result };
  throwFailure(outcome.failureCode);
}
function throwFailure(code: string): never {
  if (code === "AGENT_STARTER_PACK_NOT_FOUND") throw new AgentStarterPackNotFoundError();
  if (code === "AGENT_STARTER_PACK_CONFLICT") throw new AgentStarterPackConflictError();
  if (code === "AGENT_STARTER_SKILL_VERSION_MISSING") throw new AgentStarterSkillVersionMissingError();
  if (code === "AGENT_STARTER_SKILL_VERSION_MISMATCH") throw new AgentStarterSkillVersionMismatchError();
  throw new AgentStarterPackInvalidError();
}
