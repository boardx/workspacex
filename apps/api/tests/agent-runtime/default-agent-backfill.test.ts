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
    // 本文件默认没设 KERNEL_MODEL_PROVIDER——第二遍（provider-repair）应该如实跳过，
    // 不是把 model_provider 悄悄改成空字符串。
    expect(first.providerRepaired).toBe(0);

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

  it("2026-08-07 devapp 真实复现：env 缺失时创建的默认 agent，事后补上 env 要能被追认修好", async () => {
    // 复刻 devapp 事故的确切顺序：先在 KERNEL_MODEL_PROVIDER 完全未设置的情况下跑一遍
    // （agent_versions.model_provider 落成 ''），再"事后"把 env 补上，第二遍必须把那一行
    // 追认成真实可用的 provider——不是"下次创建的新组织才对"，而是"已经创建的这一个也
    // 要被修好"，否则 devapp 上那个用户会永远卡在 MODEL_PROVIDER_NOT_CONFIGURED。
    delete process.env.KERNEL_MODEL_PROVIDER;
    delete process.env.KERNEL_MODEL_BASE_URL;
    delete process.env.KERNEL_MODEL_API_KEY;
    delete process.env.KERNEL_DEFAULT_AGENT_MODEL_ID;
    const { backfillDefaultAgents } = await import("../../scripts/backfill-default-agents");

    const ORG = "org-i662-provider-repair";
    const ADMIN = "u-i662-provider-repair-admin";
    const owner = new pg.Client(ownerConfig(DATABASE));
    await owner.connect();
    try {
      await owner.query(
        "INSERT INTO organizations (id, name, kind) VALUES ($1, '待修复 provider 的组织', 'organization')",
        [ORG],
      );
      await owner.query(
        "INSERT INTO org_memberships (user_id, org_id, org_role, team_id) VALUES ($1, $2, 'admin', NULL)",
        [ADMIN, ORG],
      );
    } finally {
      await owner.end();
    }

    try {
      // ① env 缺失时跑一遍——落库的 model_provider 是空字符串。
      const beforeEnv = await backfillDefaultAgents();
      expect(beforeEnv.created).toBe(1);
      expect(beforeEnv.providerRepaired).toBe(0); // provider 都还没配，没有"活的值"可修

      const check1 = new pg.Client(ownerConfig(DATABASE));
      await check1.connect();
      try {
        const r = await check1.query<{ model_provider: string }>(
          `SELECT av.model_provider FROM agent_versions av
             JOIN agents a ON a.id = av.agent_id AND a.published_version_id = av.id
            WHERE a.org_id = $1 AND a.stable_name = 'default-assistant'`,
          [ORG],
        );
        expect(r.rows[0]!.model_provider).toBe("");
      } finally {
        await check1.end();
      }

      // ② 事后把 env 补上，再跑一遍——不再创建新的，但要把①那一行追认修好。
      // ⚠ 不断言 providerRepaired 的绝对值：这份测试和上一个 it() 共用同一个数据库
      // （文件级 beforeAll 只建一次库），上一个 it() 造的 ORG_WITH_ADMIN 那一行同样带着
      // 空 provider，这一遍会被一并修好——那是正确行为，不是本用例的失败。断言收窄到
      // "至少修好了本用例自己的这一行"，用直接查库核实，而不是信一个会被平行状态污染
      // 的聚合计数。
      process.env.KERNEL_MODEL_PROVIDER = "dashscope";
      process.env.KERNEL_MODEL_BASE_URL = "https://example-repair-test.invalid/v1";
      process.env.KERNEL_MODEL_API_KEY = "sk-repair-test-do-not-echo";
      process.env.KERNEL_DEFAULT_AGENT_MODEL_ID = "qwen-repair-test";

      const afterEnv = await backfillDefaultAgents();
      expect(afterEnv.created).toBe(0); // 组织已经有默认 agent 了，不重复创建
      expect(afterEnv.providerRepaired).toBeGreaterThanOrEqual(1); // 至少修好了本用例这一行

      const check2 = new pg.Client(ownerConfig(DATABASE));
      await check2.connect();
      try {
        const r = await check2.query<{ model_provider: string; model_id: string }>(
          `SELECT av.model_provider, av.model_id FROM agent_versions av
             JOIN agents a ON a.id = av.agent_id AND a.published_version_id = av.id
            WHERE a.org_id = $1 AND a.stable_name = 'default-assistant'`,
          [ORG],
        );
        expect(r.rows[0]!.model_provider).toBe("dashscope");
        expect(r.rows[0]!.model_id).toBe("qwen-repair-test");
      } finally {
        await check2.end();
      }

      // 幂等：provider 没变的情况下再跑一遍，不重复"修复"同一行。
      const third = await backfillDefaultAgents();
      expect(third.providerRepaired).toBe(0);
    } finally {
      delete process.env.KERNEL_MODEL_PROVIDER;
      delete process.env.KERNEL_MODEL_BASE_URL;
      delete process.env.KERNEL_MODEL_API_KEY;
      delete process.env.KERNEL_DEFAULT_AGENT_MODEL_ID;
    }
  });
});
