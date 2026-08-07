/**
 * One-time (but idempotent, safe to run every deploy) backfill for #662.
 *
 * `ensureDefaultAgent` only runs at the moment an org is CREATED (`/auth/bootstrap` and,
 * as of this same change, `/auth/register`). Every org that already existed before #662
 * landed has no default agent and never will on its own -- there is no cron, no lazy
 * "first chat" trigger, nothing. This script is that missing one-time pass: for every
 * existing org without a default agent, run the exact same `ensureDefaultAgent` use case
 * a fresh bootstrap would have run, using that org's oldest admin as the actor.
 *
 * Wired into `deploy.sh` (after migrations, before restart) so it self-heals on every
 * deploy without a human ever having to SSH in and run it by hand -- the same reasoning
 * as "migrations run before every deploy, idempotently" one step up in that file.
 *
 * Uses the OWNER connection only to enumerate orgs/admins (that requires reading across
 * every tenant, which RLS deliberately blocks for the application role -- see
 * `pg-config.ts`'s table). The actual write goes through `PgDatabase` + `ensureDefaultAgent`
 * exactly as production traffic would, so this script cannot drift from the real write path.
 */
import pg from "pg";
import { migrationConfig, appConfig } from "../src/infrastructure/db/pg-config";
import { PgDatabase } from "../src/infrastructure/db/pg-database";
import { PgDefaultAgentRepository } from "../src/infrastructure/agent/pg-default-agent-repository";
import { ensureDefaultAgent, DEFAULT_AGENT_STABLE_NAME } from "../src/application/agent/ensure-default-agent";

export interface BackfillReport {
  readonly candidateCount: number;
  readonly skippedNoAdmin: number;
  readonly created: number;
  readonly alreadyExisted: number;
}

/**
 * Exported (rather than inlined into a bare top-level `await`) so
 * `tests/agent-runtime/default-agent-backfill.test.ts` can run this exact function against
 * a real, isolated test database instead of re-implementing its SQL as a second copy.
 */
export async function backfillDefaultAgents(): Promise<BackfillReport> {
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
      [DEFAULT_AGENT_STABLE_NAME],
    );
    candidates = rows
      .filter((r): r is { org_id: string; actor_id: string } => r.actor_id !== null)
      .map((r) => ({ orgId: r.org_id, actorId: r.actor_id }));
    skippedNoAdmin = rows.length - candidates.length;
    if (skippedNoAdmin > 0) {
      console.log(`[backfill-default-agents] skipping ${skippedNoAdmin} org(s) with no admin member yet`);
    }
  } finally {
    await owner.end();
  }

  if (candidates.length === 0) {
    console.log("[backfill-default-agents] nothing to do -- every org already has a default agent");
    return { candidateCount: 0, skippedNoAdmin, created: 0, alreadyExisted: 0 };
  }

  const db = new PgDatabase(appConfig());
  try {
    const repo = new PgDefaultAgentRepository(db);
    let created = 0;
    for (const { orgId, actorId } of candidates) {
      const r = await ensureDefaultAgent({ repo }, { orgId, actorId });
      if (r.created) created += 1;
      console.log(`[backfill-default-agents] org=${orgId} actor=${actorId} agentId=${r.agentId} created=${r.created}`);
    }
    const alreadyExisted = candidates.length - created;
    console.log(`[backfill-default-agents] done: ${created} created, ${alreadyExisted} already existed`);
    return { candidateCount: candidates.length, skippedNoAdmin, created, alreadyExisted };
  } finally {
    await db.close();
  }
}

// Only run as a CLI entry point -- `import.meta.url === entry script` guards against this
// firing a second time when the test file imports `backfillDefaultAgents` directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  await backfillDefaultAgents();
}
