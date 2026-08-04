import type { IdentityRepository } from "../identity/ports";
import {
  importPayloadDigest,
  InvalidSkillStarterPackError,
  verifySkillStarterPack,
} from "../../domain/skill/starter-pack";
import type { OrgId } from "../../domain/org-id";
import type {
  SkillStarterImportRepository,
  SkillStarterImportResult,
  SkillStarterPackSource,
} from "./ports";

export class SkillStarterPackNotFoundError extends Error {}
export class SkillStarterPackInvalidError extends Error {}
export class SkillStarterPackConflictError extends Error {}
export class SkillStarterImportIdempotencyConflictError extends Error {}
export class SkillStarterImportAdminRequiredError extends Error {}

export interface ImportSkillStarterPackDeps {
  readonly identities: IdentityRepository;
  readonly packs: SkillStarterPackSource;
  readonly imports: SkillStarterImportRepository;
}

export interface ImportSkillStarterPackInput {
  readonly actorId: string;
  readonly orgId: OrgId;
  readonly packId: string;
  readonly packVersion: string;
  readonly idempotencyKey: string;
}

export async function importSkillStarterPack(
  deps: ImportSkillStarterPackDeps,
  input: ImportSkillStarterPackInput,
): Promise<{ readonly created: boolean; readonly result: SkillStarterImportResult }> {
  const membership = await deps.identities.findOrgMembership(input.actorId, input.orgId);
  if (!membership || membership.orgRole !== "admin") {
    throw new SkillStarterImportAdminRequiredError();
  }

  const payloadDigest = importPayloadDigest(input);
  const existing = await deps.imports.findExisting({
    orgId: input.orgId,
    idempotencyKey: input.idempotencyKey,
    payloadDigest,
  });
  if (existing.kind === "replayed") return { created: false, result: existing.result };
  if (existing.kind === "idempotency-conflict") {
    throw new SkillStarterImportIdempotencyConflictError();
  }
  if (existing.kind === "previous-failure") {
    throwRecordedFailure(existing.failureCode);
  }

  const raw = await deps.packs.load(input.packId, input.packVersion);
  if (raw === null) {
    const recorded = await deps.imports.recordFailure({
      orgId: input.orgId,
      actorId: input.actorId,
      idempotencyKey: input.idempotencyKey,
      payloadDigest,
      packId: input.packId,
      packVersion: input.packVersion,
      packDigest: null,
      failureCode: "SKILL_STARTER_PACK_NOT_FOUND",
    });
    return replayOrThrow(recorded);
  }

  let pack;
  try {
    pack = verifySkillStarterPack(raw, input);
  } catch (error) {
    if (!(error instanceof InvalidSkillStarterPackError)) throw error;
    const parsedDigest = typeof raw === "object" && raw !== null &&
      typeof (raw as { packDigest?: unknown }).packDigest === "string"
      ? (raw as { packDigest: string }).packDigest
      : null;
    const recorded = await deps.imports.recordFailure({
      orgId: input.orgId,
      actorId: input.actorId,
      idempotencyKey: input.idempotencyKey,
      payloadDigest,
      packId: input.packId,
      packVersion: input.packVersion,
      packDigest: parsedDigest,
      failureCode: "SKILL_STARTER_PACK_INVALID",
    });
    return replayOrThrow(recorded);
  }

  const outcome = await deps.imports.persistVerified({
    orgId: input.orgId,
    actorId: input.actorId,
    idempotencyKey: input.idempotencyKey,
    payloadDigest,
    pack,
  });
  if (outcome.kind === "created") return { created: true, result: outcome.result };
  if (outcome.kind === "replayed") return { created: false, result: outcome.result };
  if (outcome.kind === "name-conflict") throw new SkillStarterPackConflictError();
  if (outcome.kind === "idempotency-conflict") {
    throw new SkillStarterImportIdempotencyConflictError();
  }
  throwRecordedFailure(outcome.failureCode);
}

function replayOrThrow(
  outcome: Exclude<Awaited<ReturnType<SkillStarterImportRepository["recordFailure"]>>, never>,
): { readonly created: boolean; readonly result: SkillStarterImportResult } {
  if (outcome.kind === "replayed") return { created: false, result: outcome.result };
  if (outcome.kind === "idempotency-conflict") {
    throw new SkillStarterImportIdempotencyConflictError();
  }
  throwRecordedFailure(outcome.failureCode);
}

function throwRecordedFailure(failureCode: string): never {
  if (failureCode === "SKILL_STARTER_PACK_NOT_FOUND") {
    throw new SkillStarterPackNotFoundError();
  }
  if (failureCode === "SKILL_STARTER_PACK_CONFLICT") {
    throw new SkillStarterPackConflictError();
  }
  throw new SkillStarterPackInvalidError();
}
