/**
 * One-time (idempotent, safe to run every deploy) backfill for the deep-research agent --
 * the same shape as `backfill-default-agents.ts`, for the sibling agent added 2026-08-07.
 *
 * `ensureDeepResearchAgent` only runs at the moment an org is CREATED. Every org that
 * already existed before this landed has no deep-research agent and never will on its
 * own. This is that missing one-time pass.
 *
 * No provider-repair pass here (unlike `backfill-default-agents.ts`): the deep-research
 * agent's `model_provider` is the hardcoded constant `"open-deep-research"` (see
 * `ensure-deep-research-agent.ts`), never read from `KERNEL_MODEL_PROVIDER` -- there is no
 * "unset env at creation time" failure mode to repair here. Whether the service itself is
 * reachable (`KERNEL_DEEP_RESEARCH_BASE_URL`) is checked at RUN time by
 * `DeepResearchModelProvider`, not baked into the stored row.
 */
import pg from "pg";
import { migrationConfig, appConfig } from "../src/infrastructure/db/pg-config";
import { PgDatabase } from "../src/infrastructure/db/pg-database";
import { PgDeepResearchAgentRepository } from "../src/infrastructure/agent/pg-deep-research-agent-repository";
import {
  ensureDeepResearchAgent,
  DEEP_RESEARCH_AGENT_STABLE_NAME,
} from "../src/application/agent/ensure-deep-research-agent";

export interface DeepResearchBackfillReport {
  readonly candidateCount: number;
  readonly skippedNoAdmin: number;
  readonly created: number;
  readonly alreadyExisted: number;
}

export async function backfillDeepResearchAgent(): Promise<DeepResearchBackfillReport> {
  const owner = new pg.Pool({ ...migrationConfig(), max: 2 });
  let candidates: { orgId: string; actorId: string }[];
  let skippedNoAdmin = 0;
  try {
    const { rows } = await owner.query<{ org_id: string; actor_id: string | null }>(
      `SELECT o.id AS org_id,
              (SELECT m.user_id FROM org_memberships m
                WHERE m.org_id = o.id AND m.org_role = 'admin'
                ORDER BY m.user_id ASC LIMIT 1) AS actor_id
         FROM organizations o
        WHERE NOT EXISTS (
                SELECT 1 FROM agents a
                 WHERE a.org_id = o.id AND a.stable_name = $1
              )`,
      [DEEP_RESEARCH_AGENT_STABLE_NAME],
    );
    candidates = rows
      .filter((r): r is { org_id: string; actor_id: string } => r.actor_id !== null)
      .map((r) => ({ orgId: r.org_id, actorId: r.actor_id }));
    skippedNoAdmin = rows.length - candidates.length;
    if (skippedNoAdmin > 0) {
      console.log(`[backfill-deep-research-agent] skipping ${skippedNoAdmin} org(s) with no admin member yet`);
    }
  } finally {
    await owner.end();
  }

  const db = new PgDatabase(appConfig());
  try {
    const repo = new PgDeepResearchAgentRepository(db);
    let created = 0;
    for (const { orgId, actorId } of candidates) {
      const r = await ensureDeepResearchAgent({ repo }, { orgId, actorId });
      if (r.created) created += 1;
      console.log(`[backfill-deep-research-agent] org=${orgId} actor=${actorId} agentId=${r.agentId} created=${r.created}`);
    }
    const alreadyExisted = candidates.length - created;
    if (candidates.length > 0) {
      console.log(`[backfill-deep-research-agent] done: ${created} created, ${alreadyExisted} already existed`);
    } else {
      console.log("[backfill-deep-research-agent] nothing to create -- every org already has a deep-research agent");
    }
    return { candidateCount: candidates.length, skippedNoAdmin, created, alreadyExisted };
  } finally {
    await db.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await backfillDeepResearchAgent();
}
