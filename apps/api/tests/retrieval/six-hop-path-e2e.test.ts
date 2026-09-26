/**
 * D11 / #4261 —— 播种六跳所需的最小本体边，端到端走 `findSixHopPaths`（SQL 取边 + 纯函数拼路径）。
 * 无库：用一个按 SIX_HOP_SQL 语义（org 过滤 + 从实例起最多 3 层可达 + 关系白名单）的内存 client
 * 代替 pg；真库半边在隔离库 lane（ontology-projection-migration.test.ts）。
 * 另测 D12 投影同步 worker：默认关、失败只记日志不抛。
 */
import { describe, expect, it } from "vitest";
import { findSixHopPaths, SIX_HOP_SQL } from "../../scripts/query-six-hop-path";
import type { GraphEdge } from "../../src/domain/retrieval/six-hop-path";
import type { LoggerPort, LogFields } from "../../src/application/ports/logger.port";
import {
  DevProcessProjectionSyncWorker,
  readDevProjectionSyncConfig,
} from "../../src/infrastructure/retrieval/dev-process-projection-sync-worker";

type Row = GraphEdge & { org_id: string };
const ORG = "org-platform";
const OTHER = "org-other";
const INSTANCE = "c".repeat(64);

function seed(org = ORG): Row[] {
  const e = (src_kind: string, src_id: string, relation: string, dst_kind: string, dst_id: string): Row =>
    ({ org_id: org, src_kind, src_id, relation, dst_kind, dst_id });
  return [
    e("customer_instance", INSTANCE, "running", "release", "v1.2.0"),
    e("release", "v1.2.0", "contains", "pull_request", "101"),
    e("pull_request", "101", "fixes", "defect", "900"),
    e("pull_request", "101", "decided_by", "decision", "ADR-114"),
    e("pull_request", "101", "verified_by", "evidence", "18/F04"),
  ];
}

/** SIX_HOP_SQL 的内存等价：org 限定的可达集（depth<3）+ 取这些节点出发的白名单关系边。 */
function fakeClient(rows: Row[]) {
  return {
    query: async (sql: string, [orgId, instanceId, relations]: [string, string, string[]]) => {
      expect(sql).toBe(SIX_HOP_SQL);
      const inOrg = rows.filter((r) => r.org_id === orgId && relations.includes(r.relation));
      const reach = new Set([`customer_instance|${instanceId}`]);
      let frontier = [...reach];
      for (let depth = 0; depth < 3; depth++) {
        const next = inOrg.filter((r) => frontier.includes(`${r.src_kind}|${r.src_id}`)).map((r) => `${r.dst_kind}|${r.dst_id}`);
        frontier = next.filter((k) => !reach.has(k));
        frontier.forEach((k) => reach.add(k));
      }
      return { rows: inOrg.filter((r) => reach.has(`${r.src_kind}|${r.src_id}`)).map(({ org_id: _o, ...g }) => g) };
    },
  } as never;
}

describe("six-hop path end to end (seeded)", () => {
  it("returns the full path across all six nodes", async () => {
    expect(await findSixHopPaths(fakeClient(seed()), ORG, INSTANCE)).toEqual([
      { customerInstance: INSTANCE, release: "v1.2.0", pullRequest: "101", defect: "900", decision: "ADR-114", evidence: "18/F04" },
    ]);
  });

  it("a missing middle edge (release -contains-> PR) yields no path", async () => {
    const rows = seed().filter((r) => r.relation !== "contains");
    expect(await findSixHopPaths(fakeClient(rows), ORG, INSTANCE)).toEqual([]);
  });

  it("does not traverse an edge that belongs to another org", async () => {
    const rows = seed().map((r) => (r.relation === "contains" ? { ...r, org_id: OTHER } : r));
    expect(await findSixHopPaths(fakeClient(rows), ORG, INSTANCE)).toEqual([]);
    // 整套边都在另一个组织：本组织查询看不到任何东西
    expect(await findSixHopPaths(fakeClient(seed(OTHER)), ORG, INSTANCE)).toEqual([]);
  });

  it("SQL scopes both the recursive step and the final select by org_id", () => {
    expect(SIX_HOP_SQL.match(/e\.org_id = \$1/g)).toHaveLength(2);
  });
});

function recLogger() {
  const entries: { level: string; msg: string; fields: LogFields }[] = [];
  const logger: LoggerPort = {
    info: (msg, fields) => entries.push({ level: "info", msg, fields }),
    error: (msg, fields) => entries.push({ level: "error", msg, fields }),
  };
  return { logger, entries };
}

describe("DevProcessProjectionSyncWorker", () => {
  it("is off by default and does not run", async () => {
    const cfg = readDevProjectionSyncConfig({});
    expect(cfg.orgId).toBeNull();
    let calls = 0;
    const { logger, entries } = recLogger();
    const w = new DevProcessProjectionSyncWorker(cfg, async () => { calls++; return { edges: 0, upserted: 0, removed: 0 }; }, logger);
    w.onModuleInit();
    await w.tick();
    w.onModuleDestroy();
    expect(calls).toBe(0);
    expect(entries[0]?.msg).toMatch(/disabled/);
  });

  it("parses the flag and clamps the interval", () => {
    expect(readDevProjectionSyncConfig({ WSX_DEV_PROJECTION_SYNC_ORG: " org-platform ", WSX_DEV_PROJECTION_SYNC_INTERVAL_SECONDS: "5" }))
      .toEqual({ orgId: "org-platform", intervalSeconds: 3600 });
    expect(readDevProjectionSyncConfig({ WSX_DEV_PROJECTION_SYNC_ORG: "o", WSX_DEV_PROJECTION_SYNC_INTERVAL_SECONDS: "600" }).intervalSeconds).toBe(600);
  });

  it("logs and swallows a failing run", async () => {
    const { logger, entries } = recLogger();
    const w = new DevProcessProjectionSyncWorker({ orgId: ORG, intervalSeconds: 3600 }, async () => { throw new Error("boom"); }, logger);
    await expect(w.tick()).resolves.toBeUndefined();
    expect(entries.map((e) => [e.level, e.fields.orgId])).toEqual([["error", ORG]]);
  });

  it("logs the sync report on success", async () => {
    const { logger, entries } = recLogger();
    const w = new DevProcessProjectionSyncWorker({ orgId: ORG, intervalSeconds: 3600 }, async () => ({ edges: 3, upserted: 1, removed: 0 }), logger);
    await w.tick();
    expect(entries[0]).toMatchObject({ level: "info", fields: { orgId: ORG, edges: 3, upserted: 1, removed: 0 } });
  });
});
