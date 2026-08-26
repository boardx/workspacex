/**
 * `backfillCanvasBuiltinTemplates`（`scripts/backfill-canvas-builtin-templates.ts`）。
 *
 * 人类 2026-08-15 原话（对着 `/admin/canvasadmin` 真实截图，boardx 组织当时只有一条
 * "ABC"）：「需要加载初始化的19个模板」。本文件钉住三件事：
 *   1. 显式传入的那**一个**组织真的被填满 19 条、且全部是 published（不是留在 draft）；
 *   2. 幂等——重跑不产生第二份、不重复计入 created；
 *   3. **没有 admin 的组织被如实拒绝，不是静默跳过**（与 `backfillDefaultAgents` 对
 *      "没有 admin" 的处理刻意不同——那边 backfill 的对象是"所有组织"，此处只对
 *      调用方明确指定的那一个组织负责，没有 admin 就该让调用方知道，而不是悄悄放行）。
 *
 * 独立数据库：直接造一个真实组织形状（org + admin 成员 + 一条既有自建模板，复刻截图里
 * "ABC" 那种"组织已经在用这个功能"的状态），不通过 HTTP，理由同 `default-agent-backfill`
 * 测试头注——这里验的是脚本本身的编排与幂等，不是走一遍完整鉴权中间件。
 */
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { migrate } from "../../src/infrastructure/db/migrator";
import { migrationConfig } from "../../src/infrastructure/db/pg-config";
import { dropDatabaseAfterDraining } from "../support/drop-database";

process.env.KERNEL_QUIET = "1";

const ORIGINAL_DATABASE = process.env.PGDATABASE;
const DATABASE = `wsx_tplseed_${process.pid}_${Date.now()}`;

const ORG_WITH_ADMIN = "org-tplseed-with-admin";
const ADMIN_USER = "u-tplseed-admin";
const ORG_NO_ADMIN = "org-tplseed-no-admin";

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
      "INSERT INTO organizations (id, name, kind) VALUES ($1, 'boardx', 'organization')",
      [ORG_WITH_ADMIN],
    );
    await owner.query(
      "INSERT INTO org_memberships (user_id, org_id, org_role, team_id) VALUES ($1, $2, 'admin', NULL)",
      [ADMIN_USER, ORG_WITH_ADMIN],
    );
    // 复刻截图里的"ABC"：这个组织已经在用画布模板功能，本 key 不在 19 个内置里，
    // backfill 不该碰它、也不该因为它的存在而以为自己重复了。
    await owner.query(
      `INSERT INTO canvas_templates
         (org_id, key, version, display_name, status, builtin, visibility, underlying_type, sections)
       VALUES ($1, 'ABC', 1, 'ABC', 'published', false, 'org-wide', 'canvas', '[]'::jsonb)`,
      [ORG_WITH_ADMIN],
    );
    await owner.query(
      "INSERT INTO organizations (id, name, kind) VALUES ($1, '没有管理员的组织', 'organization')",
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

describe("backfillCanvasBuiltinTemplates：给一个明确指定的组织加载 19 个内置画布模板", () => {
  it("有 admin 的组织：19 个内置模板全部真实创建并发布；既有的 'ABC' 不受影响", async () => {
    const { backfillCanvasBuiltinTemplates } = await import("../../scripts/backfill-canvas-builtin-templates");
    const { listTemplates } = await import("@repo/fabric-markdown/templates");

    const specCount = listTemplates().length;
    expect(specCount).toBe(19); // 与契约 I-36 断言的既有事实一致，不是本文件另猜一个数

    const first = await backfillCanvasBuiltinTemplates(ORG_WITH_ADMIN);
    expect(first.total).toBe(19);
    expect(first.created).toBe(19);
    expect(first.published).toBe(19);
    expect(first.alreadyExisted).toBe(0);
    expect(first.actorId).toBe(ADMIN_USER);

    const owner = new pg.Client(ownerConfig(DATABASE));
    await owner.connect();
    try {
      const rows = await owner.query<{ key: string; status: string; builtin: boolean; version: number }>(
        `SELECT key, status, builtin, version FROM canvas_templates
          WHERE org_id = $1 AND key <> 'ABC'`,
        [ORG_WITH_ADMIN],
      );
      expect(rows.rows).toHaveLength(19);
      for (const row of rows.rows) {
        // 服务端恒定：created 后必须再发布，本脚本的第二步 publish 应该已经把它推到 published。
        expect(row.status).toBe("published");
        expect(row.version).toBe(1);
        // 契约 `create()` 恒 builtin=false（内置清单的权威是 BUILTIN_CANVAS_TEMPLATES，
        // 不是这一列）——本脚本不该也不能改写这条既有裁决。
        expect(row.builtin).toBe(false);
      }

      // 既有的 'ABC' 毫发无损：没被本脚本重复创建、状态没被改动。
      const abc = await owner.query(
        "SELECT status, version FROM canvas_templates WHERE org_id = $1 AND key = 'ABC'",
        [ORG_WITH_ADMIN],
      );
      expect(abc.rows).toHaveLength(1);
      expect(abc.rows[0]!.status).toBe("published");
    } finally {
      await owner.end();
    }

    // 幂等：重跑不产生第二份、不重复计入 created ——TEMPLATE_KEY_CONFLICT 分支被真的走到。
    const second = await backfillCanvasBuiltinTemplates(ORG_WITH_ADMIN);
    expect(second.created).toBe(0);
    expect(second.published).toBe(0);
    expect(second.alreadyExisted).toBe(19);
  });

  it("没有 admin 的组织：如实抛错，不是静默跳过（脚本只对调用方指定的那一个组织负责）", async () => {
    const { backfillCanvasBuiltinTemplates } = await import("../../scripts/backfill-canvas-builtin-templates");
    await expect(backfillCanvasBuiltinTemplates(ORG_NO_ADMIN)).rejects.toThrow(/没有任何 admin 成员/);
  });
});

/**
 * `pickCurrentRowByKey`——2026-08-26 devapp 实测事故的反证。
 *
 * 原判据按纯版本号最大选「当前行」，devapp 上 `ai-bmc` 真的撞上：v4 是发布中的，
 * v6 是一次早前测试留下的、从没发布过的草稿。脚本选中 v6 写了标题/提示词，自己
 * 打印「完成」，真正在用的 v4 一个字没变——库里查证过，19 个 key 里只有它一个中招。
 *
 * 这里直接**复刻 devapp 的真实数据形状**（键名、版本号、状态一一对应），不是编一个
 * 简化过的假场景。
 */
describe("pickCurrentRowByKey：按状态优先级选「当前行」，不是按版本号最大", () => {
  it("复刻 devapp ai-bmc 的真实撞车：v6 草稿必须让位给 v4 已发布", async () => {
    const { pickCurrentRowByKey } = await import("../../scripts/backfill-canvas-builtin-templates");
    const rows = [
      { key: "ai-bmc", version: 1, status: "archived" },
      { key: "ai-bmc", version: 2, status: "draft" },
      { key: "ai-bmc", version: 3, status: "archived" },
      { key: "ai-bmc", version: 4, status: "published" },
      { key: "ai-bmc", version: 5, status: "archived" },
      { key: "ai-bmc", version: 6, status: "draft" },
    ];
    const picked = pickCurrentRowByKey(rows);
    expect(picked.get("ai-bmc")).toEqual({ key: "ai-bmc", version: 4, status: "published" });
  });

  it("没有已发布版本时退而求其次：trial > draft > archived", async () => {
    const { pickCurrentRowByKey } = await import("../../scripts/backfill-canvas-builtin-templates");
    expect(
      pickCurrentRowByKey([
        { key: "k", version: 1, status: "archived" },
        { key: "k", version: 5, status: "draft" },
        { key: "k", version: 3, status: "trial" },
      ]).get("k"),
    ).toEqual({ key: "k", version: 3, status: "trial" });
  });

  it("同优先级内取版本号最大——同一状态出现多次时不是「先到先得」", async () => {
    const { pickCurrentRowByKey } = await import("../../scripts/backfill-canvas-builtin-templates");
    expect(
      pickCurrentRowByKey([
        { key: "k", version: 2, status: "archived" },
        { key: "k", version: 7, status: "archived" },
        { key: "k", version: 5, status: "archived" },
      ]).get("k"),
    ).toEqual({ key: "k", version: 7, status: "archived" });
  });
});
