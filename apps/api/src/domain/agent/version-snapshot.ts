/**
 * F55 / I-31 / O-22⑤ / D-30 -- 「批准发布」freezes an `AgentVersion`, and a project freezes
 * WHICH version it runs at kickoff.
 *
 * ## The two halves, and why one without the other proves nothing
 *
 *   immutability   a published version's bytes never change afterwards
 *   locking        a project resolves to the version it locked, not to the agent's head
 *
 * A system with immutable versions but no lock still drifts: every call reads the head, so
 * "当时跑的是哪一版" is answered with today's version. A system with locks but mutable
 * versions drifts too, silently and worse: the lock still points at `v1`, and `v1` now says
 * something else. UC-4.4 needs both, so both are here and both are asserted in both
 * directions.
 *
 * ## Why `Object.freeze` and not "we just never write to it"
 *
 * The repository layer is where a snapshot would be mutated -- by an ORM re-hydrating a row,
 * by a `sort()` on a shared array, by a well-meaning normaliser. In a strict-mode ES module
 * a write to a frozen object THROWS, which turns that class of bug from a silent data
 * change into a stack trace. The database CHECK/trigger is the other enforcement point; this
 * is not a second declaration of the fact, it is the same rule enforced where it is decided.
 */
import type { AgentDefinition } from "./definition";

/**
 * What a version freezes (domain.md §C `AgentVersion`): 定义 + skill 挂载版本 + 工具白名单 +
 * 模型 + 并发 + 降级策略 + 可见性范围.
 */
export const SNAPSHOT_FROZEN_FIELDS = [
  "name",
  "initials",
  "role",
  /**
   * #660 —— **必须冻结**。它就是「这一版到底跑什么」本身；不冻结的话，UC-4.4 的
   * 「当时跑的是哪一版」还能答出版本号，却答不出那一版的行为（作者事后改了指令，
   * 历史 run 的解释就跟着变了）。同 `agent_versions.instructions` 一列不可变。
   */
  "instructions",
  "visibility",
  "modelId",
  "skillMounts",
  "toolWhitelist",
  "concurrencyLimit",
  "degradePolicy",
] as const satisfies readonly (keyof AgentDefinition)[];

/**
 * What a version deliberately does NOT freeze.
 *
 *   agentId / orgId  identity of the owning record; carried on the snapshot's own header
 *   publishState     a LIFECYCLE fact about the agent, not about this version. Freezing it
 *                    would make a locked project's snapshot say 运行中 forever, which is the
 *                    exact opposite of I-32 (disabling must be observable on the agent).
 *   cloneFrom        provenance of the definition, not part of what runs
 */
export const SNAPSHOT_EXCLUDED_FIELDS = [
  "agentId",
  "orgId",
  "publishState",
  "cloneFrom",
  "source",
] as const satisfies readonly (keyof AgentDefinition)[];

type FrozenKey = (typeof SNAPSHOT_FROZEN_FIELDS)[number];
type ExcludedKey = (typeof SNAPSHOT_EXCLUDED_FIELDS)[number];

/** Same totality discipline as `clone.ts`: a new field must be classified, not defaulted. */
type _SnapshotKeysAreTotal =
  Exclude<keyof AgentDefinition, FrozenKey | ExcludedKey> extends never ? true : never;
type _SnapshotKeysAreDisjoint = Extract<FrozenKey, ExcludedKey> extends never ? true : never;
const _snapshotKeysAreTotal: _SnapshotKeysAreTotal = true;
const _snapshotKeysAreDisjoint: _SnapshotKeysAreDisjoint = true;
void _snapshotKeysAreTotal;
void _snapshotKeysAreDisjoint;

export interface AgentVersionSnapshot {
  readonly agentVersionId: string;
  readonly agentId: string;
  readonly orgId: string;
  readonly frozenAt: string;
  readonly definition: Readonly<Pick<AgentDefinition, FrozenKey>>;
}

function deepFreezeSnapshot(snapshot: AgentVersionSnapshot): AgentVersionSnapshot {
  // Arrays and their elements too: freezing only the outer object leaves
  // `snapshot.definition.toolWhitelist.push(...)` working, and the whitelist is the part an
  // attacker would want to widen.
  snapshot.definition.skillMounts.forEach((m) => Object.freeze(m));
  snapshot.definition.toolWhitelist.forEach((e) => {
    if (e.elevationDecision) Object.freeze(e.elevationDecision);
    Object.freeze(e);
  });
  Object.freeze(snapshot.definition.skillMounts);
  Object.freeze(snapshot.definition.toolWhitelist);
  Object.freeze(snapshot.definition);
  return Object.freeze(snapshot);
}

/**
 * 「批准发布」-> one immutable `AgentVersion` (I-31).
 *
 * Copies the frozen fields off `SNAPSHOT_FROZEN_FIELDS`, so the list is load-bearing rather
 * than a comment, and clones the two arrays: a snapshot that ALIASES the live agent's arrays
 * is not a snapshot, and `Object.freeze` on an alias would freeze the live agent instead.
 */
export function freezeAgentVersion(
  agent: AgentDefinition,
  meta: { agentVersionId: string; frozenAt: string },
): AgentVersionSnapshot {
  const definition = Object.fromEntries(
    SNAPSHOT_FROZEN_FIELDS.map((key) => [key, agent[key]]),
  ) as Pick<AgentDefinition, FrozenKey>;

  return deepFreezeSnapshot({
    agentVersionId: meta.agentVersionId,
    agentId: agent.agentId,
    orgId: agent.orgId,
    frozenAt: meta.frozenAt,
    definition: {
      ...definition,
      skillMounts: agent.skillMounts.map((m) => ({ ...m })),
      toolWhitelist: agent.toolWhitelist.map((e) => ({ ...e })),
    },
  });
}

/** Append-only history for one org. Keyed by `agentVersionId`, which is never reused. */
export type AgentVersionCatalog = ReadonlyMap<string, AgentVersionSnapshot>;

/**
 * Publish a new version into the catalog. Reusing an existing `agentVersionId` is refused
 * rather than overwritten -- an overwrite is exactly the drift I-31 forbids, and it is
 * indistinguishable from a legitimate publish once it has happened.
 */
export function appendAgentVersion(
  catalog: AgentVersionCatalog,
  snapshot: AgentVersionSnapshot,
): { ok: true; catalog: AgentVersionCatalog } | { ok: false; reason: "VERSION_CHANGED" } {
  if (catalog.has(snapshot.agentVersionId)) return { ok: false, reason: "VERSION_CHANGED" };
  const next = new Map(catalog);
  next.set(snapshot.agentVersionId, snapshot);
  return { ok: true, catalog: next };
}

/** Head = the most recently frozen version of an agent. What a project must NOT read. */
export function headVersionOf(
  catalog: AgentVersionCatalog,
  agentId: string,
): AgentVersionSnapshot | null {
  let head: AgentVersionSnapshot | null = null;
  for (const snapshot of catalog.values()) {
    if (snapshot.agentId !== agentId) continue;
    if (head === null || snapshot.frozenAt > head.frozenAt) head = snapshot;
  }
  return head;
}

export interface AgentVersionLock {
  readonly projectId: string;
  readonly agentId: string;
  readonly agentVersionId: string;
}

/**
 * D-30: project kickoff pins each agent to a version.
 *
 * Failure codes are the contract's own (`lockAgentVersionForProject.err` is exactly
 * `AGENT_NOT_FOUND | AGENT_DISABLED`), not private strings.
 *
 * ⚠ 已停用 agents cannot be locked into a NEW project (I-32, first half) -- and that is a
 * different statement from "existing locks break", which is the second half and is why
 * `resolveLockedAgentVersion` below does not consult `publishState` at all.
 */
export function lockAgentVersionsForProject(
  projectId: string,
  requested: readonly { agent: AgentDefinition; catalog: AgentVersionCatalog }[],
):
  | { ok: true; locks: readonly AgentVersionLock[] }
  | { ok: false; reason: "AGENT_NOT_FOUND" | "AGENT_DISABLED"; agentId: string } {
  const locks: AgentVersionLock[] = [];
  for (const { agent, catalog } of requested) {
    if (agent.publishState === "已停用") {
      return { ok: false, reason: "AGENT_DISABLED", agentId: agent.agentId };
    }
    const head = headVersionOf(catalog, agent.agentId);
    // No published version => nothing to lock. 404 semantics, per I-52's principle: the
    // project side cannot distinguish "never published" from "not yours".
    if (head === null) return { ok: false, reason: "AGENT_NOT_FOUND", agentId: agent.agentId };
    locks.push({ projectId, agentId: agent.agentId, agentVersionId: head.agentVersionId });
  }
  return { ok: true, locks };
}

/**
 * What a running project actually executes.
 *
 * ⚠ Reads the lock, then the catalog by id. It never looks at the agent's current
 * definition and never calls `headVersionOf` -- those two lines ARE the invariant. It also
 * never looks at `publishState`: a project already under way keeps running its locked
 * version after the agent is disabled (I-32, second half).
 */
export function resolveLockedAgentVersion(
  locks: readonly AgentVersionLock[],
  catalog: AgentVersionCatalog,
  query: { projectId: string; agentId: string },
): AgentVersionSnapshot | null {
  const lock = locks.find(
    (l) => l.projectId === query.projectId && l.agentId === query.agentId,
  );
  if (!lock) return null;
  return catalog.get(lock.agentVersionId) ?? null;
}
