/**
 * #662 直接后续 —— `backfillDeepResearchAgent`（`scripts/backfill-deep-research-agent.ts`）。
 * 同 `default-agent-backfill.test.ts` 的形状：直接在数据库里造一个"这次改动落地之前
 * 就存在、从未走过 bootstrap/register"的组织，验证脚本补得对、补得幂等，且不动没有
 * admin 的组织。
 *
 * 独立数据库：脚本扫描 `organizations` 全表，不带任何租户过滤——绝不能在共享测试库上跑。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { migrate } from "../../src/infrastructure/db/migrator";
import { migrationConfig } from "../../src/infrastructure/db/pg-config";
import { dropDatabaseAfterDraining } from "../support/drop-database";

process.env.KERNEL_QUIET = "1";

const ORIGINAL_DATABASE = process.env.PGDATABASE;
const DATABASE = `wsx_i662_dr_backfill_${process.pid}_${Date.now()}`;

const ORG_WITH_ADMIN = "org-i662-dr-backfill-with-admin";
const ADMIN_USER = "u-i662-dr-backfill-admin";
const ORG_NO_ADMIN = "org-i662-dr-backfill-no-admin";

function ownerConfig(database: string) {
  return { ...migrationConfig(), database };
}

async function adminClient(database = "postgres") {
  const client = new pg.Client(ownerConfig(database));
  await client.connect();
  return client;
}

beforeAll(async () => {
  const admin = await adminClient();
  try { await admin.query(`CREATE DATABASE ${DATABASE}`); } finally { await admin.end(); }
  process.env.PGDATABASE = DATABASE;
  await migrate(ownerConfig(DATABASE));

  const owner = new pg.Client(ownerConfig(DATABASE));
  await owner.connect();
  try {
    await owner.query(
      "INSERT INTO organizations (id, name, kind) VALUES ($1, '有管理员的老组织', 'organization')",
      [ORG_WITH_ADMIN],
    );
    await owner.query(
      "INSERT INTO org_memberships (user_id, org_id, org_role, team_id) VALUES ($1, $2, 'admin', NULL)",
      [ADMIN_USER, ORG_WITH_ADMIN],
    );
    await owner.query(
      "INSERT INTO organizations (id, name, kind) VALUES ($1, '没有管理员的老组织', 'organization')",
      [ORG_NO_ADMIN],
    );
  } finally {
    await owner.end();
  }
}, 60_000);

afterAll(async () => {
  const admin = await adminClient();
  try { await dropDatabaseAfterDraining(admin, DATABASE); }
  finally {
    await admin.end();
    if (ORIGINAL_DATABASE === undefined) delete process.env.PGDATABASE;
    else process.env.PGDATABASE = ORIGINAL_DATABASE;
  }
}, 30_000);

describe("#662 backfillDeepResearchAgent：补种既有组织", () => {
  it("有 admin 的老组织补出一个真实已发布的 Deep Research agent；没有 admin 的老组织被如实跳过", async () => {
    const { backfillDeepResearchAgent } = await import("../../scripts/backfill-deep-research-agent");

    const first = await backfillDeepResearchAgent();
    expect(first.candidateCount).toBe(1);
    expect(first.skippedNoAdmin).toBe(1);
    expect(first.created).toBe(1);

    const owner = new pg.Client(ownerConfig(DATABASE));
    await owner.connect();
    try {
      const agentRow = await owner.query<{ id: string; published_version_id: string | null }>(
        "SELECT id, published_version_id FROM agents WHERE org_id = $1 AND stable_name = 'deep-research-agent'",
        [ORG_WITH_ADMIN],
      );
      expect(agentRow.rows).toHaveLength(1);
      expect(agentRow.rows[0]!.published_version_id).not.toBeNull();

      const versionRow = await owner.query<{ model_provider: string }>(
        `SELECT av.model_provider FROM agent_versions av
           JOIN agents a ON a.id = av.agent_id AND a.published_version_id = av.id
          WHERE a.org_id = $1 AND a.stable_name = 'deep-research-agent'`,
        [ORG_WITH_ADMIN],
      );
      expect(versionRow.rows[0]!.model_provider).toBe("open-deep-research");

      const listing = await owner.query<{ id: string; enabled: boolean }>(
        "SELECT id, enabled FROM capability_listings WHERE org_id = $1 AND kind = 'agent'",
        [ORG_WITH_ADMIN],
      );
      expect(listing.rows).toHaveLength(1);
      expect(listing.rows[0]!.enabled).toBe(true);
      expect(listing.rows[0]!.id).toBe(agentRow.rows[0]!.id);

      const noAdminAgent = await owner.query("SELECT 1 FROM agents WHERE org_id = $1", [ORG_NO_ADMIN]);
      expect(noAdminAgent.rows).toHaveLength(0);
    } finally {
      await owner.end();
    }

    const second = await backfillDeepResearchAgent();
    expect(second.candidateCount).toBe(0);
    expect(second.created).toBe(0);
  });
});
