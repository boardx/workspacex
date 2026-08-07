/**
 * One-time (idempotent, safe to run every deploy) backfill for the image-gen agent -- the
 * same shape as `backfill-deep-research-agent.ts`, for the third system agent added
 * 2026-08-07 (人类直接指令："这里要可以直接看到图片，不是只是文字").
 *
 * `ensureImageGenAgent` only runs at the moment an org is CREATED. Every org that already
 * existed before this landed has no image-gen agent and never will on its own.
 *
 * No provider-repair pass here, for the same reason `backfill-deep-research-agent.ts` has
 * none: `model_provider` is the hardcoded constant `"bailian-image"` (see
 * `ensure-image-gen-agent.ts`), never read from `KERNEL_MODEL_PROVIDER` -- nothing to repair.
 */
import pg from "pg";
import { migrationConfig, appConfig } from "../src/infrastructure/db/pg-config";
import { PgDatabase } from "../src/infrastructure/db/pg-database";
import { PgImageGenAgentRepository } from "../src/infrastructure/agent/pg-image-gen-agent-repository";
import {
  ensureImageGenAgent,
  IMAGE_GEN_AGENT_STABLE_NAME,
} from "../src/application/agent/ensure-image-gen-agent";

export interface ImageGenBackfillReport {
  readonly candidateCount: number;
  readonly skippedNoAdmin: number;
  readonly created: number;
  readonly alreadyExisted: number;
}

export async function backfillImageGenAgent(): Promise<ImageGenBackfillReport> {
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
      [IMAGE_GEN_AGENT_STABLE_NAME],
    );
    candidates = rows
      .filter((r): r is { org_id: string; actor_id: string } => r.actor_id !== null)
      .map((r) => ({ orgId: r.org_id, actorId: r.actor_id }));
    skippedNoAdmin = rows.length - candidates.length;
    if (skippedNoAdmin > 0) {
      console.log(`[backfill-image-gen-agent] skipping ${skippedNoAdmin} org(s) with no admin member yet`);
    }
  } finally {
    await owner.end();
  }

  const db = new PgDatabase(appConfig());
  try {
    const repo = new PgImageGenAgentRepository(db);
    let created = 0;
    for (const { orgId, actorId } of candidates) {
      const r = await ensureImageGenAgent({ repo }, { orgId, actorId });
      if (r.created) created += 1;
      console.log(`[backfill-image-gen-agent] org=${orgId} actor=${actorId} agentId=${r.agentId} created=${r.created}`);
    }
    const alreadyExisted = candidates.length - created;
    if (candidates.length > 0) {
      console.log(`[backfill-image-gen-agent] done: ${created} created, ${alreadyExisted} already existed`);
    } else {
      console.log("[backfill-image-gen-agent] nothing to create -- every org already has an image-gen agent");
    }
    return { candidateCount: candidates.length, skippedNoAdmin, created, alreadyExisted };
  } finally {
    await db.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await backfillImageGenAgent();
}
