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
/** 发货包改了正文却重用了同一个 `semanticVersion`——发货内容的错，不是数据库抖动。 */
export class SkillStarterPackVersionLabelReusedError extends Error {
  constructor(readonly stableName: string, readonly semanticVersion: string) {
    super(`starter pack skill "${stableName}" reuses semantic version ${semanticVersion} for different content`);
  }
}
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

export interface ImportSkillStarterPackOutcome {
  readonly created: boolean;
  readonly result: SkillStarterImportResult;
  /**
   * 本次导入顺带下线的、**这个包上一版装进来但这一版不再发货**的 skill（issue #3733）。
   *
   * 事故：`maau-diagnostics` 1.0.0 → 2.0.1 换了 stableName（`maau-recursive-asset-report`
   * → `maau-venture-valuation`），升级路径只认同名，旧 skill 于是与新 skill 并排留在
   * 目录里，模型按描述自选时会挑到旧的那个（旧流程正是超时的那套）。
   *
   * 下线在**导入成功之后单独跑**，重放（幂等键命中）同样跑：devapp 在本改动部署之前
   * 就已经装过 2.0.1，若只在「首次落库」那条路径里下线，它永远轮不到。
   */
  readonly retiredSkillIds: readonly string[];
}

export async function importSkillStarterPack(
  deps: ImportSkillStarterPackDeps,
  input: ImportSkillStarterPackInput,
): Promise<ImportSkillStarterPackOutcome> {
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
  if (existing.kind === "replayed") {
    return { created: false, result: existing.result, retiredSkillIds: await retireSuperseded(deps, input, existing.result) };
  }
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
  if (outcome.kind === "created" || outcome.kind === "replayed") {
    return { created: outcome.kind === "created", result: outcome.result, retiredSkillIds: await retireSuperseded(deps, input, outcome.result, pack) };
  }
  if (outcome.kind === "name-conflict") throw new SkillStarterPackConflictError();
  if (outcome.kind === "version-label-reused") {
    throw new SkillStarterPackVersionLabelReusedError(outcome.stableName, outcome.semanticVersion);
  }
  if (outcome.kind === "idempotency-conflict") {
    throw new SkillStarterImportIdempotencyConflictError();
  }
  throwRecordedFailure(outcome.failureCode);
}

/**
 * 发货全集来自包文件本身；重放路径没有解析过包，这里按坐标再读一次（读不到 / 不合规就不下线——
 * 宁可留着也不误杀）。⚠ 只有当前读到的包与这次导入记录的 `packDigest` **一致**才下线：
 * 同坐标、同幂等键却换了正文的重放（`import-skill-artifact.ts` 随后判 idempotency 冲突）
 * 不许先产生任何副作用——`tests/skills/skill-artifact-import.test.ts` 锁的就是这个顺序。
 */
async function retireSuperseded(
  deps: ImportSkillStarterPackDeps,
  input: ImportSkillStarterPackInput,
  recorded: { readonly packDigest: string },
  verified?: { readonly packDigest: string; readonly skills: readonly { readonly stableName: string }[] },
): Promise<readonly string[]> {
  let pack = verified;
  if (pack === undefined) {
    const raw = await deps.packs.load(input.packId, input.packVersion);
    if (raw === null) return [];
    try {
      pack = verifySkillStarterPack(raw, input);
    } catch (error) {
      if (error instanceof InvalidSkillStarterPackError) return [];
      throw error;
    }
  }
  if (pack.packDigest !== recorded.packDigest) return [];
  const keep = pack.skills.map((skill) => skill.stableName);
  return deps.imports.retireSuperseded({ orgId: input.orgId, packId: input.packId, keepStableNames: keep });
}

function replayOrThrow(
  outcome: Exclude<Awaited<ReturnType<SkillStarterImportRepository["recordFailure"]>>, never>,
): ImportSkillStarterPackOutcome {
  if (outcome.kind === "replayed") return { created: false, result: outcome.result, retiredSkillIds: [] };
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
  if (failureCode === "SKILL_STARTER_PACK_VERSION_LABEL_REUSED") {
    throw new SkillStarterPackVersionLabelReusedError("<recorded>", "<recorded>");
  }
  throw new SkillStarterPackInvalidError();
}
