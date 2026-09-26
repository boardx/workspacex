import { describe, expect, it } from "vitest";
import { buildManifest, parseArgs, planTables, toJsonRow } from "../../scripts/export-org-data";

const cols = (table: string, ...columns: string[]) => columns.map((column) => ({ table, column }));

describe("planTables", () => {
  const plan = planTables([
    ...cols("organizations", "id", "name"),
    ...cols("projects", "id", "org_id", "name"),
    ...cols("artifact_versions", "id", "org_id", "object_storage_key"),
    ...cols("users", "id", "email"),
    ...cols("_kernel_migrations", "name", "applied_at"),
  ]);

  it("导出根表（按 id）与所有带 org_id 的表", () => {
    expect(plan.included).toEqual([
      { table: "artifact_versions", filterColumn: "org_id", hasFileKey: true },
      { table: "organizations", filterColumn: "id", hasFileKey: false },
      { table: "projects", filterColumn: "org_id", hasFileKey: false },
    ]);
  });

  it("其余每张表都进 skipped 且带原因——没有看不见的缺口", () => {
    expect(plan.skipped.map((s) => s.table)).toEqual(["_kernel_migrations", "users"]);
    for (const s of plan.skipped) expect(s.reason.length).toBeGreaterThan(0);
  });

  it("每张表恰好出现一次（included ∪ skipped = 全集，且不相交）", () => {
    const all = [...plan.included.map((t) => t.table), ...plan.skipped.map((t) => t.table)];
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual(["_kernel_migrations", "artifact_versions", "organizations", "projects", "users"]);
  });

  it("新增一张带 org_id 的表会被自动纳入（不是手写清单）", () => {
    const p = planTables(cols("brand_new_table_from_future_migration", "id", "org_id"));
    expect(p.included.map((t) => t.table)).toEqual(["brand_new_table_from_future_migration"]);
  });
});

describe("toJsonRow", () => {
  it("bytea → base64，Date → ISO，数组逐项转换", () => {
    const d = new Date("2026-09-24T00:00:00Z");
    expect(toJsonRow({ b: Buffer.from("hi"), d, a: [d], n: null, s: "x" })).toEqual({
      b: { $base64: "aGk=" }, d: d.toISOString(), a: [d.toISOString()], n: null, s: "x",
    });
  });
});

describe("buildManifest", () => {
  it("按表名排序并汇总行数与跳过数", () => {
    const m = buildManifest({
      orgId: "o1", exportedAt: "2026-09-24T00:00:00.000Z", fileCount: 2,
      tables: [
        { table: "projects", filterColumn: "org_id", rows: 3, file: "tables/projects.ndjson" },
        { table: "organizations", filterColumn: "id", rows: 1, file: "tables/organizations.ndjson" },
      ],
      skipped: [{ table: "users", reason: "r" }],
    });
    expect(m.tables.map((t) => t.table)).toEqual(["organizations", "projects"]);
    expect(m.totals).toEqual({ tables: 2, rows: 4, skippedTables: 1 });
    expect(m.files.count).toBe(2);
    expect(m.tenantColumn).toBe("org_id");
  });
});

describe("parseArgs", () => {
  it("缺 --org 或 --out 即报错（不会默认导出全部组织）", () => {
    expect(() => parseArgs(["--out=/tmp/x"])).toThrow();
    expect(() => parseArgs(["--org=o1"])).toThrow();
    expect(parseArgs(["--org=o1", "--out=/tmp/x", "--tar"])).toEqual({ orgId: "o1", outDir: "/tmp/x", tar: true });
  });
});
