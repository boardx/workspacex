/**
 * #662 直接后续 —— `backfillDefaultAgents`（`scripts/backfill-default-agents.ts`）。
 *
 * `ensureDefaultAgent` 只在组织**创建那一刻**触发。#662 落地之前就存在的每一个组织
 * （包括 devapp 上真实在用的那些）永远不会自己补上——这个脚本就是补那个缺口的一次性
 * （但幂等、每次部署都跑）扫描。这份测试不通过真实 HTTP 走一遍注册（那是
 * `default-agent-register-path.test.ts` 的职责），而是直接在数据库里造一个"#662 之前
 * 就存在、从未走过 bootstrap/register"的组织形状，验证脚本本身补得对、补得幂等，且
 * 不动没有 admin 的组织。
 *
 * 独立数据库：脚本会扫描 `organizations` 全表，不带任何租户过滤——绝不能在共享测试库上
 * 跑，否则会把并发跑着的其他测试文件的组织也一起改了。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { migrate } from "../../src/infrastructure/db/migrator";
import { migrationConfig } from "../../src/infrastructure/db/pg-config";
import { dropDatabaseAfterDraining } from "../support/drop-database";

process.env.KERNEL_QUIET = "1";

const ORIGINAL_DATABASE = process.env.PGDATABASE;
const DATABASE = `wsx_i662_backfill_${process.pid}_${Date.now()}`;

const ORG_WITH_ADMIN = "org-i662-backfill-with-admin";
const ADMIN_USER = "u-i662-backfill-admin";
const ORG_NO_ADMIN = "org-i662-backfill-no-admin";

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

  // 直接造两个"#662 之前就存在"的组织——都没有走 bootstrap/register，所以都没有
  // agents.stable_name='default-assistant' 那一行。一个有 admin 成员，一个没有。
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

describe("#662 backfillDefaultAgents：补种 #662 之前就存在的组织", () => {
  it("有 admin 的老组织补出一个真实已发布的默认 agent；没有 admin 的老组织被如实跳过", async () => {
    const { backfillDefaultAgents } = await import("../../scripts/backfill-default-agents");

    const first = await backfillDefaultAgents();
    expect(first.candidateCount).toBe(1); // 只有 ORG_WITH_ADMIN 进了候选（有 admin 才行）
    expect(first.skippedNoAdmin).toBe(1); // ORG_NO_ADMIN 被如实跳过，不是被吞掉
    expect(first.created).toBe(1);

    const owner = new pg.Client(ownerConfig(DATABASE));
    await owner.connect();
    try {
      const agentRow = await owner.query<{ id: string; published_version_id: string | null }>(
        "SELECT id, published_version_id FROM agents WHERE org_id = $1 AND stable_name = 'default-assistant'",
        [ORG_WITH_ADMIN],
      );
      expect(agentRow.rows).toHaveLength(1);
      expect(agentRow.rows[0]!.published_version_id).not.toBeNull();

      const listing = await owner.query<{ id: string; enabled: boolean }>(
        "SELECT id, enabled FROM capability_listings WHERE org_id = $1 AND kind = 'agent'",
        [ORG_WITH_ADMIN],
      );
      expect(listing.rows).toHaveLength(1);
      expect(listing.rows[0]!.enabled).toBe(true);
      // #662 头注钉住的那条：capability_listings.id 必须等于 agents.id，前端选择器
      // 直接把这个 id 当 agentId 发消息，两边不等就是又一次 422。
      expect(listing.rows[0]!.id).toBe(agentRow.rows[0]!.id);

      const noAdminAgent = await owner.query(
        "SELECT 1 FROM agents WHERE org_id = $1",
        [ORG_NO_ADMIN],
      );
      expect(noAdminAgent.rows).toHaveLength(0);
    } finally {
      await owner.end();
    }

    // 幂等：再跑一次不产生第二个默认 agent，也不重复计入"新建"。
    const second = await backfillDefaultAgents();
    expect(second.candidateCount).toBe(0); // 已经不是候选了
    expect(second.created).toBe(0);
  });
});
