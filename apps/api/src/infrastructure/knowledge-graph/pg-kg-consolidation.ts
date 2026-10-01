/**
 * Phase 18 S8（#4365）—— `KgConsolidationPort` 与 `KgExtractionSloCountsPort` 的 Postgres 实现：只调迁移 20260928180000 的
 * kg_* 函数，不写一行表名 SQL（同 pg-kg-conflict.ts / pg-kg-embedding.ts）。
 *
 * 系统写（候选、合并、开卡、收尾）一律先以「本人」身份声明 `app.current_user_id`（同 F16 asThreadOwner）：数据库函数
 * 只在声明的就是这个空间的主人时才动它的个人空间（`kg_consolidation_actor`），忘了声明 ⇒ 抛，不会碰任何人的记忆。
 * 读（本人的整合记录）经 `guard(personalSpaceRef)` 出门：调用方（application/knowledge-graph/consolidate-memory.ts）
 * 与个人空间读口同一个判定（`decidePersonalSpace`）才放行。
 */
import { knowledgeGraph as KG } from "@repo/contracts";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import {
  KgConsolidationError, type KgConsolidationCandidates, type KgConsolidationPort, type KgConsolidationRunView,
  type KgExtractionQueueCounts, type KgExtractionSloCountsPort,
} from "../../application/knowledge-graph/s8-ports";
import { guard, type Guarded } from "../../application/security/permission-filter";
import type {
  ClaimMergePlan, ConsolidationClaim, ConsolidationObject, EntityMergePlan, SimilarClaimPair, UndonePair,
} from "../../domain/knowledge-graph/consolidation";
import { toOrgId, type OrgId } from "../../domain/org-id";
import { retryOnceOnDeadlock } from "./kg-deadlock-retry";
import { personalSpaceRef } from "./pg-knowledge-read";
import { KG_EXTRACTION_LEASE_SECONDS, KG_EXTRACTION_MAX_ATTEMPTS } from "./pg-kg-extraction";

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const iso = (v: unknown): string => {
  const d = new Date(typeof v === "string" || v instanceof Date ? v : 0);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
};

async function asUser(s: TenantSession, userId: string): Promise<void> {
  await s.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
}

function sqlCode(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class PgKgConsolidation implements KgConsolidationPort {
  constructor(private readonly db: DatabasePort) {}

  async getEnabled(): Promise<boolean> {
    // 部署级单行开关（无租户数据，同 kg_extraction_state）：直接读那一行。
    const r = await this.db.withoutTenant((s) => s.query<{ enabled: boolean }>("SELECT enabled FROM kg_consolidation_state WHERE singleton"));
    return r.rows[0]?.enabled ?? false;
  }

  async setEnabled(enabled: boolean): Promise<boolean> {
    const r = await this.db.withoutTenant((s) => s.query<{ enabled: boolean }>("SELECT kg_consolidation_set_enabled($1) AS enabled", [enabled]));
    const v = r.rows[0]?.enabled;
    if (typeof v !== "boolean") throw new Error("kg_consolidation_set_enabled returned no row");
    return v;
  }

  async pendingUsers(limit: number) {
    // 只回 (org, user) 两个 id，不回任何内容：同 kg_extraction_pending_orgs。
    const r = await this.db.withoutTenant((s) => s.query<{ org_id: string; user_id: string }>(
      "SELECT org_id, user_id FROM kg_consolidation_pending_users($1)", [limit],
    ));
    return r.rows.map((x) => ({ orgId: toOrgId(x.org_id), userId: x.user_id }));
  }

  async candidates(orgId: OrgId, userId: string, limit: number): Promise<KgConsolidationCandidates> {
    const r = await this.db.withTenant(orgId, async (s) => {
      await asUser(s, userId);
      return s.query<{ c: { claims?: Row[]; objects?: Row[]; similar?: Row[]; undone?: Row[] } }>("SELECT kg_consolidation_candidates($1, $2) AS c", [userId, limit]);
    });
    const out = r.rows[0]?.c ?? {};
    const claims: ConsolidationClaim[] = [];
    for (const x of out.claims ?? []) {
      const kind = KG.KgClaimKind.safeParse(x.kind);
      const status = x.status;
      if (!kind.success || (status !== "proposed" && status !== "reviewed" && status !== "accepted" && status !== "contested")) continue;
      claims.push({
        id: str(x.id), kind: kind.data, statement: str(x.statement), status, reviewed: x.reviewed === true,
        createdAt: iso(x.createdAt), aboutObjectIds: Array.isArray(x.about) ? x.about.filter((a): a is string => typeof a === "string") : [],
      });
    }
    const objects: ConsolidationObject[] = (out.objects ?? []).map((x) => ({
      id: str(x.id), kind: str(x.kind), name: str(x.name), createdAt: iso(x.createdAt),
      aliases: Array.isArray(x.aliases) ? x.aliases.filter((a): a is string => typeof a === "string") : [],
    }));
    const similar: SimilarClaimPair[] = (out.similar ?? [])
      .map((x) => ({ a: str(x.a), b: str(x.b), cosine: Number(x.cosine) }))
      .filter((p) => p.a !== "" && p.b !== "" && Number.isFinite(p.cosine));
    const undone: UndonePair[] = (out.undone ?? [])
      .map((x) => ({ a: str(x.a), b: str(x.b) }))
      .filter((p) => p.a !== "" && p.b !== "");
    return { claims, objects, similar, undone };
  }

  async begin(orgId: OrgId, userId: string, runId: string): Promise<void> {
    await this.db.withTenant(orgId, async (s) => {
      await asUser(s, userId);
      await s.query("SELECT kg_consolidation_begin($1, $2)", [runId, userId]);
    });
  }

  async applyMerges(orgId: OrgId, userId: string, runId: string, plan: {
    readonly entityMerges: readonly EntityMergePlan[]; readonly claimMerges: readonly ClaimMergePlan[];
  }) {
    const r = await retryOnceOnDeadlock(() => this.db.withTenant(orgId, async (s) => {
      await asUser(s, userId);
      return s.query<{ n: { claim_merges?: number; entity_merges?: number } }>("SELECT kg_consolidation_apply_merges($1::jsonb) AS n", [JSON.stringify({
        run_id: runId, user_id: userId,
        entity_merges: plan.entityMerges.map((m) => ({ keep: m.keepId, merge: m.mergeId })),
        claim_merges: plan.claimMerges.map((m) => ({ keep: m.keepId, merge: m.mergeId, basis: m.basis, score: m.score })),
      })]);
    }));
    const n = r.rows[0]?.n ?? {};
    return { claimMerges: Number(n.claim_merges ?? 0), entityMerges: Number(n.entity_merges ?? 0) };
  }

  async openConflict(orgId: OrgId, userId: string, runId: string, pair: { readonly newerId: string; readonly olderId: string }) {
    const r = await retryOnceOnDeadlock(() => this.db.withTenant(orgId, async (s) => {
      await asUser(s, userId);
      return s.query<{ outcome: string }>("SELECT kg_consolidation_open_conflict($1::jsonb) AS outcome", [JSON.stringify({
        run_id: runId, user_id: userId, newer: pair.newerId, older: pair.olderId,
      })]);
    }));
    const o = r.rows[0]?.outcome;
    if (o === "opened" || o === "unsurfaced" || o === "skipped") return o;
    throw new Error(`kg_consolidation_open_conflict returned an unknown outcome: ${String(o)}`);
  }

  async finish(orgId: OrgId, userId: string, runId: string): Promise<boolean> {
    const r = await this.db.withTenant(orgId, async (s) => {
      await asUser(s, userId);
      return s.query<{ kept: boolean }>("SELECT kg_consolidation_finish($1, $2) AS kept", [runId, userId]);
    });
    return r.rows[0]?.kept === true;
  }

  async listRuns(orgId: OrgId, userId: string, limit: number, runId?: string): Promise<Guarded<readonly KgConsolidationRunView[]>> {
    const r = await this.db.withTenant(orgId, async (s) => {
      await asUser(s, userId);
      return s.query<{ runs: Row[] }>("SELECT kg_consolidation_list($1, $2) AS runs", [limit, runId ?? null]);
    });
    const runs = (r.rows[0]?.runs ?? []).map((x): KgConsolidationRunView => ({
      runId: str(x.runId), createdAt: iso(x.createdAt), state: x.status === "undone" || x.status === "partially_undone" ? x.status : "applied",
      undoneAt: x.undoneAt === null || x.undoneAt === undefined ? null : iso(x.undoneAt),
      conflictsUnsurfaced: Number(x.conflictsUnsurfaced ?? 0),
      changes: (Array.isArray(x.changes) ? x.changes as Row[] : []).flatMap((c) => {
        const kind = KG.KgConsolidationChangeKind.safeParse(c.kind);
        if (!kind.success) return [];
        const state = c.status === "undone" || c.status === "undo_skipped" ? c.status : "applied";
        return [{
          changeId: str(c.changeId), kind: kind.data, state, basis: strOrNull(c.basis),
          kept: { id: str(c.keptId), text: strOrNull(c.keptText) }, other: { id: str(c.otherId), text: strOrNull(c.otherText) },
          threadId: strOrNull(c.threadId), undoNote: strOrNull(c.undoNote),
        }];
      }),
    }));
    return guard(personalSpaceRef(userId), runs);
  }

  async undo(orgId: OrgId, userId: string, runId: string, actionId: string) {
    try {
      const r = await retryOnceOnDeadlock(() => this.db.withTenant(orgId, async (s) => {
        await asUser(s, userId);
        return s.query<{ r: { undone?: number; skipped?: number } }>("SELECT kg_consolidation_undo($1, $2) AS r", [runId, actionId]);
      }));
      const out = r.rows[0]?.r ?? {};
      return { undone: Number(out.undone ?? 0), skipped: Number(out.skipped ?? 0) };
    } catch (err) {
      if (sqlCode(err).includes("KG_CONSOLIDATION_RUN_NOT_FOUND")) throw new KgConsolidationError("KG_CONSOLIDATION_RUN_NOT_FOUND");
      throw err;
    }
  }
}

/** 抽取队列的全库现数（只有数字）。租约秒数与重试上限从 pg-kg-extraction.ts 取，不在迁移里写第二份。 */
export class PgKgExtractionSloCounts implements KgExtractionSloCountsPort {
  constructor(private readonly db: DatabasePort) {}

  async counts(): Promise<KgExtractionQueueCounts> {
    const r = await this.db.withoutTenant((s) => s.query<{ stuck_leases: string; dead_letters: string; backlog: string; oldest_pending_seconds: string }>(
      "SELECT stuck_leases::text, dead_letters::text, backlog::text, oldest_pending_seconds::text FROM kg_extraction_slo_counts($1, $2)",
      [KG_EXTRACTION_LEASE_SECONDS, KG_EXTRACTION_MAX_ATTEMPTS],
    ));
    const row = r.rows[0];
    return {
      stuckLeases: Number(row?.stuck_leases ?? 0), deadLetters: Number(row?.dead_letters ?? 0),
      backlog: Number(row?.backlog ?? 0), oldestPendingSeconds: Number(row?.oldest_pending_seconds ?? 0),
    };
  }
}
