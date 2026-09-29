/**
 * Phase 20 WS03 —— Work Skill 目录：列表/搜索、详情、通道/后继变更（契约 `work-skill-meta` operations
 * listWorkSkillCatalog / getWorkSkillCatalogEntry / updateWorkSkillCatalogEntry；R3.5–R3.10，E3/E4/E9，R5）。
 *
 * 权限：读 = 本组织成员（RLS 按 org_id；非成员 / 跨组织 / 不存在一律 NotFound）；写 = 本组织管理员，
 * 鉴权**先于**任何仓储调用（E9）。列表/详情的就绪性摘要按 WS04 同一纯函数计算（UC-3「每行附就绪性
 * 摘要，批量计算，禁止 N+1」：整页只读一次授权快照）；授权读取失败 → `unknown`（I-11：未知 ≠ 就绪）。
 */
import type {
  WorkSkillCatalogDetail,
  WorkSkillCatalogItem,
  WorkSkillChannel,
  WorkSkillManifest,
} from "@repo/contracts/work-skill-meta";
import type { IdentityRepository } from "../identity/ports";
import type { OrgId } from "../../domain/org-id";
import { isRegisteredCapabilityCategory } from "../../domain/skill/capability-category-registry";
import { computeSkillReadiness, type ToolGrantSnapshot } from "../../domain/skill/work-skill-readiness";
import type { ToolGrantReader } from "./work-skill-readiness";
import {
  decideCatalogEntryChange,
  type CatalogChangeDecision,
  type CatalogEntryChange,
  type CatalogEntryState,
  type CurrentVersionG5,
} from "../../domain/skill/work-skill-catalog";

export const WORK_SKILL_CATALOG_REPOSITORY = Symbol("WorkSkillCatalogRepository");

/** 契约 Item 的形状，但 id 为本仓 `skill-<uuid>` 文本 id（契约 Id=uuid 与现存 id 形状不一致，见 controller 注释）。 */
export type CatalogItem = Omit<WorkSkillCatalogItem, "skillId" | "currentVersionId" | "successorSkillId"> & {
  readonly skillId: string;
  readonly currentVersionId: string;
  readonly successorSkillId: string | null;
};

export type CatalogDetail = CatalogItem &
  Pick<WorkSkillCatalogDetail, "description" | "gates" | "canManageChannel"> & {
    readonly manifest: WorkSkillManifest;
    readonly versions: ReadonlyArray<{ skillVersionId: string; semanticLabel: string; publishedAt: string; current: boolean }>;
    readonly successor: { skillId: string; name: string; stableId: string } | null;
  };

export type CatalogRow = Omit<CatalogItem, "readiness">;
/** 列表行 + 当前版本依赖（只供就绪性摘要计算，不进响应）。 */
export type CatalogListRow = CatalogRow & { readonly dependencies: WorkSkillManifest["dependencies"] };

export interface CatalogListQuery {
  readonly domain?: string;
  readonly channel?: WorkSkillChannel;
  readonly q?: string;
  readonly includeDeprecated: boolean;
  readonly offset: number;
  readonly limit: number;
}

export interface CatalogDetailRow extends CatalogRow {
  readonly description: string;
  readonly manifest: WorkSkillManifest;
  readonly versions: CatalogDetail["versions"];
  readonly successor: CatalogDetail["successor"];
}

export type CatalogUpdateOutcome =
  | { readonly kind: "updated" | "replayed"; readonly row: CatalogRow }
  | { readonly kind: "not-found" }
  | { readonly kind: "idempotency-conflict" }
  | Exclude<CatalogChangeDecision, { readonly kind: "ok" }>;

export interface WorkSkillCatalogRepository {
  list(orgId: OrgId, query: CatalogListQuery): Promise<readonly CatalogListRow[]>;
  /** versionId 给定时 manifest 取该版本（A2）；版本不属于该 skill → null */
  get(orgId: OrgId, skillId: string, versionId?: string): Promise<CatalogDetailRow | null>;
  /**
   * 同一事务：幂等键查重 → 锁目录行 → 读后继图 → `decide` → 写行 + 审计事件。
   * `decide` 由应用层注入（领域规则），仓储只负责持久化与并发。
   */
  update(input: {
    readonly orgId: OrgId;
    readonly actorId: string;
    readonly skillId: string;
    readonly idempotencyKey: string;
    readonly requestDigest: string;
    readonly gateEvidenceRef: string | null;
    /** currentG5：同一事务内读到的「当前版本」门状态记录的 G5（无记录 = null，EV05）。 */
    readonly decide: (
      current: CatalogEntryState,
      successorOf: ReadonlyMap<string, string | null>,
      currentG5: CurrentVersionG5 | null,
    ) => CatalogChangeDecision;
  }): Promise<CatalogUpdateOutcome>;
}

export interface WorkSkillCatalogDeps {
  readonly identities: IdentityRepository;
  readonly catalog: WorkSkillCatalogRepository;
  /** 就绪性摘要的授权快照来源；缺省（如写路径）→ 摘要为 unknown。 */
  readonly grants?: ToolGrantReader;
}

export class WorkSkillCatalogNotFoundError extends Error {}
export class WorkSkillCatalogAdminRequiredError extends Error {}
export class WorkSkillCatalogIdempotencyConflictError extends Error {}
export class WorkSkillChannelTransitionInvalidError extends Error {
  constructor(readonly allowed: readonly WorkSkillChannel[], readonly reason: string) {
    super(reason);
  }
}
/** EV05：candidate→verified 时当前版本 G5 未过 → 409 WORK_EVAL_G5_NOT_PASSED。 */
export class WorkSkillG5NotPassedError extends Error {
  constructor(readonly reasonCode: string | null, readonly reason: string) {
    super(reason);
  }
}
export class WorkSkillSuccessorInvalidError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/** 没有授权快照可用时的摘要：不伪造 ready（I-11）。 */
const READINESS_NOT_COMPUTED = { overall: "unknown", missingRequired: null } as const;

/** 整页只读一次授权快照（禁止 N+1）；读取失败 → { ok: false } ⇒ 各行 unknown（E5）。 */
async function grantSnapshot(deps: WorkSkillCatalogDeps, orgId: OrgId): Promise<ToolGrantSnapshot | null> {
  if (!deps.grants) return null;
  try {
    return { ok: true, grants: await deps.grants.listForOrg(orgId) };
  } catch {
    return { ok: false };
  }
}

function readinessSummary(
  dependencies: WorkSkillManifest["dependencies"],
  snapshot: ToolGrantSnapshot | null,
): CatalogItem["readiness"] {
  if (snapshot === null) return READINESS_NOT_COMPUTED;
  const r = computeSkillReadiness(dependencies, snapshot, isRegisteredCapabilityCategory);
  return { overall: r.overall, missingRequired: r.missingRequired };
}

/** ADR-119 G0–G6 门状态占位（第 6 轮 eval runner 写回）。 */
const GATE_PLACEHOLDERS = (["G0", "G1", "G2", "G3", "G4", "G5", "G6"] as const).map((gate) => ({
  gate, state: "not_run" as const, evidenceRef: null,
}));

async function membershipOf(deps: WorkSkillCatalogDeps, actorId: string, orgId: OrgId) {
  return deps.identities.findOrgMembership(actorId, orgId);
}

export async function listWorkSkillCatalog(
  deps: WorkSkillCatalogDeps,
  input: { readonly actorId: string; readonly orgId: OrgId; readonly query: CatalogListQuery },
): Promise<{ items: CatalogItem[]; nextOffset: number | null }> {
  if (!(await membershipOf(deps, input.actorId, input.orgId))) throw new WorkSkillCatalogNotFoundError();
  const rows = await deps.catalog.list(input.orgId, { ...input.query, limit: input.query.limit + 1 });
  const page = rows.slice(0, input.query.limit);
  const snapshot = page.length > 0 ? await grantSnapshot(deps, input.orgId) : null;
  return {
    items: page.map(({ dependencies, ...row }) => ({ ...row, readiness: readinessSummary(dependencies, snapshot) })),
    nextOffset: rows.length > input.query.limit ? input.query.offset + input.query.limit : null,
  };
}

export async function getWorkSkillCatalogEntry(
  deps: WorkSkillCatalogDeps,
  input: { readonly actorId: string; readonly orgId: OrgId; readonly skillId: string; readonly versionId?: string },
): Promise<CatalogDetail> {
  const membership = await membershipOf(deps, input.actorId, input.orgId);
  if (!membership) throw new WorkSkillCatalogNotFoundError();
  const row = await deps.catalog.get(input.orgId, input.skillId, input.versionId);
  if (!row) throw new WorkSkillCatalogNotFoundError();
  return {
    ...row,
    readiness: readinessSummary(row.manifest.dependencies, await grantSnapshot(deps, input.orgId)),
    gates: GATE_PLACEHOLDERS,
    canManageChannel: membership.orgRole === "admin",
  };
}

export async function updateWorkSkillCatalogEntry(
  deps: WorkSkillCatalogDeps,
  input: {
    readonly actorId: string;
    readonly orgId: OrgId;
    readonly skillId: string;
    readonly idempotencyKey: string;
    readonly requestDigest: string;
    readonly change: CatalogEntryChange;
  },
): Promise<{ item: CatalogItem; replayed: boolean }> {
  const membership = await membershipOf(deps, input.actorId, input.orgId);
  // 跨组织/非成员：不泄露存在性（404）；本组织非管理员：403（E9）。
  if (!membership) throw new WorkSkillCatalogNotFoundError();
  if (membership.orgRole !== "admin") throw new WorkSkillCatalogAdminRequiredError();

  const outcome = await deps.catalog.update({
    orgId: input.orgId,
    actorId: input.actorId,
    skillId: input.skillId,
    idempotencyKey: input.idempotencyKey,
    requestDigest: input.requestDigest,
    gateEvidenceRef: input.change.gateEvidenceRef ?? null,
    decide: (current, successorOf, currentG5) => decideCatalogEntryChange(current, input.change, successorOf, currentG5),
  });
  switch (outcome.kind) {
    case "updated":
    case "replayed":
      return { item: { ...outcome.row, readiness: READINESS_NOT_COMPUTED }, replayed: outcome.kind === "replayed" };
    case "not-found":
      throw new WorkSkillCatalogNotFoundError();
    case "idempotency-conflict":
      throw new WorkSkillCatalogIdempotencyConflictError();
    case "transition-invalid":
      throw new WorkSkillChannelTransitionInvalidError(outcome.allowed, outcome.reason);
    case "successor-invalid":
      throw new WorkSkillSuccessorInvalidError(outcome.reason);
    case "g5-not-passed":
      throw new WorkSkillG5NotPassedError(outcome.reasonCode, outcome.reason);
  }
}
