/**
 * One-time (idempotent, safe to run every deploy) cleanup for a duplication bug: the three
 * system agents (default-assistant / deep-research-agent / image-gen-agent) were, before
 * this fix, also created under the platform organization (`PLATFORM_ORG_ID`,
 * `org-platform`) by `backfill-{default-agents,deep-research-agent,image-gen-agent}.ts` --
 * those scripts' candidate query treated every organization without the agent as eligible,
 * never excluding the platform org, and the platform org's sole member
 * (`svc-platform-templates`) is `org_role='admin'` (see `ensure-platform-skill-catalog.ts`),
 * so it matched.
 *
 * `pg-capability-repository.ts`'s `listByKind`/`listAll` merge `PLATFORM_ORG_ID` rows into
 * every organization's capability listing (originally, and still, for `kind='skill'` --
 * design-delta `platform-owned-skills`). Before this fix that merge was not restricted by
 * `kind`, so the platform org's stray agent rows leaked into every organization's capability
 * picker as a second, same-named entry alongside that organization's own copy -- the visible
 * bug (see the PR this script ships with).
 *
 * The read-path fix (`kind = 'skill'` restriction on the platform-org merge) and the
 * backfill-script fix (exclude `PLATFORM_ORG_ID` from candidates) stop this from recurring
 * and, by themselves, already stop the duplicate from being visible -- an agent-kind row
 * under `org-platform` is no longer read for any other org. This script additionally removes
 * the stray rows themselves, because the platform org owning agent data at all is not a
 * state any code path should have produced, and leaving it around is exactly the kind of
 * static trace this codebase has been burned by before (AGENTS.md: "静态痕迹 ≠ 动态事实").
 *
 * Deletes, in order (children first, matching `agents`/`agent_versions`' FK direction):
 *   1. `capability_listings` rows (`id = agents.id`, per `ensureSystemAgent`'s write shape)
 *   2. `agent_versions` rows (append-only for the app role -- `GRANT SELECT,INSERT` only, see
 *      `wave2_agent_starter_import.sql` -- so this must run on the OWNER connection, which
 *      bypasses RLS and owns the tables, same as every migration)
 *   3. `agents` rows
 * all scoped to `org_id = PLATFORM_ORG_ID AND stable_name = ANY(<the three stable names>)`.
 *
 * Idempotent: a second run finds nothing and reports zero deletions.
 *
 * Usage: `pnpm --filter api exec tsx scripts/cleanup-platform-org-agent-duplicates.ts`
 */
import { isCliEntry } from "./cli-entry";
import pg from "pg";
import { agentDefaults } from "@repo/contracts";
import { migrationConfig } from "../src/infrastructure/db/pg-config";
import { PLATFORM_ORG_ID } from "../src/domain/org-id";

const SYSTEM_AGENT_STABLE_NAMES = [
  agentDefaults.DEFAULT_AGENT_STABLE_NAME,
  agentDefaults.DEEP_RESEARCH_AGENT_STABLE_NAME,
  agentDefaults.IMAGE_GEN_AGENT_STABLE_NAME,
];

export interface PlatformOrgAgentCleanupReport {
  readonly foundAgentIds: readonly string[];
  readonly deletedCapabilityListings: number;
  readonly deletedAgentVersions: number;
  readonly deletedAgents: number;
}

export async function cleanupPlatformOrgAgentDuplicates(): Promise<PlatformOrgAgentCleanupReport> {
  const owner = new pg.Pool({ ...migrationConfig(), max: 2 });
  try {
    const found = await owner.query<{ id: string }>(
      "SELECT id FROM agents WHERE org_id = $1 AND stable_name = ANY($2::text[])",
      [PLATFORM_ORG_ID, SYSTEM_AGENT_STABLE_NAMES],
    );
    const foundAgentIds = found.rows.map((r) => r.id);
    if (foundAgentIds.length === 0) {
      console.log("[cleanup-platform-org-agent-duplicates] nothing to clean -- no stray system agent under org-platform");
      return { foundAgentIds: [], deletedCapabilityListings: 0, deletedAgentVersions: 0, deletedAgents: 0 };
    }

    console.log(
      `[cleanup-platform-org-agent-duplicates] found ${foundAgentIds.length} stray agent(s) under org-platform: ${foundAgentIds.join(", ")}`,
    );

    const client = await owner.connect();
    try {
      await client.query("BEGIN");
      const listings = await client.query(
        "DELETE FROM capability_listings WHERE org_id = $1 AND kind = 'agent' AND id = ANY($2::text[])",
        [PLATFORM_ORG_ID, foundAgentIds],
      );
      const versions = await client.query(
        "DELETE FROM agent_versions WHERE org_id = $1 AND agent_id = ANY($2::text[])",
        [PLATFORM_ORG_ID, foundAgentIds],
      );
      const agents = await client.query(
        "DELETE FROM agents WHERE org_id = $1 AND id = ANY($2::text[])",
        [PLATFORM_ORG_ID, foundAgentIds],
      );
      await client.query("COMMIT");
      console.log(
        `[cleanup-platform-org-agent-duplicates] deleted ${listings.rowCount ?? 0} capability_listings, ` +
        `${versions.rowCount ?? 0} agent_versions, ${agents.rowCount ?? 0} agents`,
      );
      return {
        foundAgentIds,
        deletedCapabilityListings: listings.rowCount ?? 0,
        deletedAgentVersions: versions.rowCount ?? 0,
        deletedAgents: agents.rowCount ?? 0,
      };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } finally {
    await owner.end();
  }
}

if (isCliEntry(import.meta.url)) {
  await cleanupPlatformOrgAgentDuplicates();
}
