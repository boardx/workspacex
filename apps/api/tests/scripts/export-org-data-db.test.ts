import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrationConfig } from "../../src/infrastructure/db/pg-config";
import { exportOrg, type Manifest } from "../../scripts/export-org-data";
import { migrateOnce, resetOrgs, seedOrg } from "../support/db";

const A = "org-export-a";
const B = "org-export-b";

describe("export-org-data（真实 PG）", () => {
  let root: string;
  let dir: string;
  let manifest: Manifest;

  beforeAll(async () => {
    await migrateOnce();
    await resetOrgs(A, B);
    await seedOrg({ orgId: A, projectId: "proj-export-a", teamNames: ["ta"], groupNames: ["ga"] });
    await seedOrg({ orgId: B, projectId: "proj-export-b", teamNames: ["tb"], groupNames: ["gb"] });
    root = mkdtempSync(join(tmpdir(), "wsx-export-"));
    dir = join(root, "out");
    const c = new pg.Client(migrationConfig());
    await c.connect();
    try {
      manifest = await exportOrg(c, A, dir);
    } finally {
      await c.end();
    }
  });

  afterAll(async () => {
    await resetOrgs(A, B);
    rmSync(root, { recursive: true, force: true });
  });

  it("导出目标组织自己的行，行数与 manifest 一致", () => {
    const byName = new Map(manifest.tables.map((t) => [t.table, t]));
    expect(byName.get("organizations")?.rows).toBe(1);
    expect(byName.get("projects")?.rows).toBe(1);
    for (const t of manifest.tables) {
      const lines = readFileSync(join(dir, t.file), "utf8").split("\n").filter(Boolean);
      expect(lines.length, t.table).toBe(t.rows);
    }
  });

  it("任何导出文件里都没有另一个组织的数据", () => {
    for (const t of manifest.tables) {
      const body = readFileSync(join(dir, t.file), "utf8");
      expect(body.includes(B), t.table).toBe(false);
      expect(body.includes("proj-export-b"), t.table).toBe(false);
    }
  });

  it("manifest 覆盖全部表：导出 + 跳过（带原因），迁移账本在跳过里", () => {
    expect(manifest.totals.tables).toBeGreaterThan(20);
    expect(manifest.skipped.find((s) => s.table === "_kernel_migrations")?.reason).toBeTruthy();
    const onDisk = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as Manifest;
    expect(onDisk.totals).toEqual(manifest.totals);
  });
});
