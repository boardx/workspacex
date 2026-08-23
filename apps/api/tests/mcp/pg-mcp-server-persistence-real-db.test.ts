/**
 * issue #1928 -- `PgMcpServerStore` + `PgMcpToolStore` against a REAL Postgres.
 *
 * Proves the three things the issue is actually about, not a mock:
 *   ① a discovery's server row + tool rows survive as COMMITTED state, readable from a
 *      fresh transaction (not just visible to the writer's own connection);
 *   ② `listForOrg` is tenant-scoped -- another org's rows never show up, RLS included;
 *   ③ re-discovering the SAME server refreshes `endpoint`/`toolCount`/`lastDiscoveredAt`
 *     but does NOT reset `reviewStatus`/`connectionStatus` once a human has moved them off
 *     the initial values (the whole point of `upsertDiscovered`'s header comment).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { createPgMcpServerStore } from "../../src/infrastructure/mcp/pg-mcp-server-store";
import { createPgMcpToolStore } from "../../src/infrastructure/mcp/pg-mcp-tool-store";
import type { McpServerStore } from "../../src/application/mcp/ports";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";

const ORG_A = "org-i1928-mcp-a";
const ORG_B = "org-i1928-mcp-b";
const ACTOR = "u-i1928-admin";

let db: PgDatabase;
let servers: McpServerStore;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG_A, ORG_B);
  await seedOrg({ orgId: ORG_A, projectId: "proj-i1928-mcp-a" });
  await seedOrg({ orgId: ORG_B, projectId: "proj-i1928-mcp-b" });
  db = new PgDatabase(appConfig());
  servers = createPgMcpServerStore(db);
}, 180_000);

afterAll(async () => {
  await resetOrgs(ORG_A, ORG_B);
});

describe("PgMcpServerStore + PgMcpToolStore：真实数据库", () => {
  it("① 发现结果落库为已提交状态，能从一个全新事务读回", async () => {
    const tools = createPgMcpToolStore(db, ORG_A);
    await tools.replace("mcp-real-1", [
      {
        fullName: "mcp:real-1.search",
        serverId: "mcp-real-1",
        signature: "search(q: string) -> unknown",
        schemaFingerprint: "fp-1",
        sideEffect: "只读",
        authScope: "未开放",
      },
    ]);
    await servers.upsertDiscovered({
      orgId: ORG_A,
      serverId: "mcp-real-1",
      endpoint: "https://mcp.example.com/sse",
      registeredByActorId: ACTOR,
      toolCount: 1,
      discoveredAt: "2026-08-24T00:00:00.000Z",
      sealedCredential: {
        ciphertext: "deadbeef.deadbeef.deadbeef",
        algorithm: "aes-256-gcm",
        keyId: "k-test",
        sealedAt: "2026-08-24T00:00:00.000Z",
        __sealed: true,
      },
      initialStatus: { reviewStatus: "待安全评审", connectionStatus: "已隔离" },
    });

    // 独立读回，不是同一个 store 实例的内存缓存——`createPgMcpServerStore` 本身不持有
    // 任何进程内状态，这里换一个新实例进一步确认。
    const freshRead = await createPgMcpServerStore(db).listForOrg(ORG_A);
    const row = freshRead.find((r) => r.serverId === "mcp-real-1");
    expect(row).toBeDefined();
    expect(row!.endpoint).toBe("https://mcp.example.com/sse");
    expect(row!.toolCount).toBe(1);
    expect(row!.reviewStatus).toBe("待安全评审");
    expect(row!.connectionStatus).toBe("已隔离");
    expect(row!.credentialConfigured).toBe(true);

    const toolRows = await tools.current("mcp-real-1");
    expect(toolRows).toHaveLength(1);
    expect(toolRows[0]!.fullName).toBe("mcp:real-1.search");

    // 密文本身在这张表里存在但不可读回明文——app_rw 对 ciphertext 列没有 SELECT 授权。
    const denied = await asApp(ORG_A, (c) =>
      c
        .query(`SELECT ciphertext FROM mcp_server_secrets WHERE org_id = $1 AND server_id = $2`, [
          ORG_A,
          "mcp-real-1",
        ])
        .then(
          () => "unexpectedly succeeded",
          (err: Error) => err.message,
        ),
    );
    // ⚠ 措辞随 Postgres 版本/上下文在「for column ciphertext」与「for table」间摆动
    // （只授了别的列、`ciphertext` 一列完全没授权时，报的常是后者）——两种措辞都是
    // "读不到密文"这同一件事，断言只咬这一点，不咬具体文案。
    expect(denied).toMatch(/permission denied for (column ciphertext|table mcp_server_secrets)/);
  });

  it("② 跨组织隔离：org-b 的 listForOrg 看不到 org-a 发现的服务器", async () => {
    const rowsForB = await servers.listForOrg(ORG_B);
    expect(rowsForB.find((r) => r.serverId === "mcp-real-1")).toBeUndefined();
  });

  it("③ 重新发现只刷新端点/工具数/时间，不重置已经被人改过的评审与连接状态", async () => {
    // 模拟"已经过评审"：直接推进状态（真实评审流程是 `reviewMcpServer` 用例，这里只
    // 关心 upsertDiscovered 是否尊重既有状态，不重新跑一遍评审判定）。
    await asApp(ORG_A, (c) =>
      c.query(
        `UPDATE mcp_servers SET review_status = '已放行', connection_status = '已连接'
           WHERE org_id = $1 AND server_id = $2`,
        [ORG_A, "mcp-real-1"],
      ),
    );

    await servers.upsertDiscovered({
      orgId: ORG_A,
      serverId: "mcp-real-1",
      endpoint: "https://mcp.example.com/sse/v2",
      registeredByActorId: ACTOR,
      toolCount: 3,
      discoveredAt: "2026-08-24T01:00:00.000Z",
      sealedCredential: null,
      // 若实现错误地在 ON CONFLICT 分支写了这个初始状态，下面的断言会抓到。
      initialStatus: { reviewStatus: "待安全评审", connectionStatus: "已隔离" },
    });

    const rows = await servers.listForOrg(ORG_A);
    const row = rows.find((r) => r.serverId === "mcp-real-1")!;
    expect(row.endpoint).toBe("https://mcp.example.com/sse/v2");
    expect(row.toolCount).toBe(3);
    expect(row.lastDiscoveredAt).toBe("2026-08-24T01:00:00.000Z");
    // 这两条是本用例存在的理由：重新发现没有把人工评审结论打回初始态。
    expect(row.reviewStatus).toBe("已放行");
    expect(row.connectionStatus).toBe("已连接");
  });
});
