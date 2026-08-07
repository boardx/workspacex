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
 *
 * ## Second pass: repair a stale `model_provider`
 *
 * 2026-08-07 devapp incident: this script ran on devapp BEFORE `KERNEL_MODEL_PROVIDER`/
 * `KERNEL_MODEL_BASE_URL`/`KERNEL_MODEL_API_KEY` were ever set on that deployment (a
 * separate, pre-existing gap -- this deployment had never had a real model provider
 * configured at all). `readModelProviderConfig()` returns `provider: ""` when unset, and
 * `PgDefaultAgentRepository.ensure()` bakes that value into the new row's
 * `agent_versions.model_provider` at creation time (see that file's own header). Once the
 * env was fixed, those two already-created rows still carried `""` forever -- the
 * first-pass `NOT EXISTS` check skips them because the row already exists, and nothing
 * else ever revisits `model_provider` after creation. Every run against them failed
 * `MODEL_PROVIDER_NOT_CONFIGURED` even though the deployment was, by then, correctly
 * configured. This second pass finds exactly that shape (a default-agent row whose stored
 * provider doesn't match the live one) and re-points it -- NOT by `UPDATE`ing the stale
 * `agent_versions` row. `agent_versions` is deliberately append-only for the application
 * role (`GRANT SELECT,INSERT ON agent_versions TO app_rw` -- no `UPDATE`, see
 * `wave2_agent_starter_import.sql`): versions are immutable once published, the same
 * invariant every other publish path in this codebase respects. So this INSERTs a fresh
 * version (bumped `semantic_label`) carrying the live provider and re-points
 * `agents.published_version_id` at it -- exactly the same two statements
 * `PgDefaultAgentRepository.ensure()` already runs to create the FIRST version, just run a
 * second time for a corrected one.
 */
import { randomUUID, createHash } from "node:crypto";
import pg from "pg";
import { migrationConfig, appConfig } from "../src/infrastructure/db/pg-config";
import { PgDatabase } from "../src/infrastructure/db/pg-database";
import { PgDefaultAgentRepository } from "../src/infrastructure/agent/pg-default-agent-repository";
import {
  ensureDefaultAgent,
  DEFAULT_AGENT_STABLE_NAME,
  DEFAULT_AGENT_INSTRUCTIONS,
} from "../src/application/agent/ensure-default-agent";
import { readModelProviderConfig } from "../src/infrastructure/agent-run/configured-model-provider";
import { toOrgId } from "../src/domain/org-id";

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

export interface BackfillReport {
  readonly candidateCount: number;
  readonly skippedNoAdmin: number;
  readonly created: number;
  readonly alreadyExisted: number;
  readonly providerRepaired: number;
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
    if (candidates.length > 0) {
      console.log(`[backfill-default-agents] done: ${created} created, ${alreadyExisted} already existed`);
    } else {
      console.log("[backfill-default-agents] nothing to create -- every org already has a default agent");
    }

    const providerRepaired = await repairStaleModelProvider(db);

    return { candidateCount: candidates.length, skippedNoAdmin, created, alreadyExisted, providerRepaired };
  } finally {
    await db.close();
  }
}

/**
 * See the "Second pass" header comment above. Owner connection again -- finding every
 * default-agent row with a stale provider is a cross-tenant read, same as the first pass.
 */
async function repairStaleModelProvider(db: PgDatabase): Promise<number> {
  const { provider } = readModelProviderConfig();
  if (provider === "") {
    console.log("[backfill-default-agents] KERNEL_MODEL_PROVIDER unset -- skipping provider-repair pass");
    return 0;
  }
  const modelId = (process.env.KERNEL_DEFAULT_AGENT_MODEL_ID ?? "").trim() || "default";

  const owner = new pg.Pool({ ...migrationConfig(), max: 2 });
  let stale: { agentId: string; orgId: string; creatorId: string; versionCount: number }[];
  try {
    const { rows } = await owner.query<{ agent_id: string; org_id: string; creator_id: string; version_count: string }>(
      `SELECT av.agent_id, av.org_id, a.creator_id,
              (SELECT count(*) FROM agent_versions v WHERE v.agent_id = av.agent_id) AS version_count
         FROM agent_versions av
         JOIN agents a ON a.id = av.agent_id AND a.published_version_id = av.id
        WHERE a.stable_name = $1 AND av.model_provider <> $2`,
      [DEFAULT_AGENT_STABLE_NAME, provider],
    );
    stale = rows.map((r) => ({
      agentId: r.agent_id, orgId: r.org_id, creatorId: r.creator_id, versionCount: Number(r.version_count),
    }));
  } finally {
    await owner.end();
  }

  const instructions = DEFAULT_AGENT_INSTRUCTIONS;
  const instructionDigest = sha256(instructions);
  for (const { agentId, orgId, creatorId, versionCount } of stale) {
    const versionId = `agent-version-${randomUUID()}`;
    const nowIso = new Date().toISOString();
    const semanticLabel = `v${versionCount + 1}`;
    // `withTenant` already runs its callback inside one transaction (see `PgDatabase.inTx`)
    // -- the INSERT and the `published_version_id` UPDATE below commit or roll back together
    // without a second, nested transaction wrapper.
    await db.withTenant(toOrgId(orgId), async (s) => {
      await s.query(
        `INSERT INTO agent_versions (id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at)
         VALUES ($1,$2,$3,$4,$5,$6,'{}'::text[],$7,$8,'[]'::jsonb,$9,$10,$10)`,
        [versionId, orgId, agentId, semanticLabel, instructionDigest, instructions, provider, modelId, creatorId, nowIso],
      );
      await s.query(
        "UPDATE agents SET published_version_id=$3, updated_at=$4 WHERE id=$1 AND org_id=$2",
        [agentId, orgId, versionId, nowIso],
      );
    });
    console.log(`[backfill-default-agents] repaired stale provider: org=${orgId} agent=${agentId} -> provider=${provider} (published ${semanticLabel})`);
  }
  return stale.length;
}

// Only run as a CLI entry point -- `import.meta.url === entry script` guards against this
// firing a second time when the test file imports `backfillDefaultAgents` directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  await backfillDefaultAgents();
}
