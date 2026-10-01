/**
 * CT10 —— 钉住 lint-permission-paths.mjs 对 pg-board-run-source.ts 的豁免条件。本文件删除时该豁免必须一并删除。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const API = fileURLToPath(new URL("../..", import.meta.url));
const FILE = "src/infrastructure/board/pg-board-run-source.ts";
const TABLES = new Set([
  "workflow_instances", "workflow_definition_versions", "workflow_events", "workflow_receipts", "agents", "capability_listings",
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("CT10 board run source permission boundary", () => {
  const src = readFileSync(join(API, FILE), "utf8");

  it("只读六张表、从不 withoutTenant、不取 Agent 指令或阶段产出", () => {
    expect(src).not.toMatch(/withoutTenant/);
    const tables = [...src.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_]+)/g)].map((m) => m[1]);
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) expect(TABLES.has(t!), t).toBe(true);
    expect(src).not.toMatch(/\binstructions\b|\btool_policy\b|workflow_stage_outputs/);
  });

  it("interface 层不直接引用该适配器", () => {
    for (const f of walk(join(API, "src/interface"))) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/pg-board-run-source/);
    }
  });
});
