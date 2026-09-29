// @global-scope-fixture seeder:ensurePlatformSkillCatalogSeeded: 只**调用**它把平台目录种齐（活栈启动时即如此；
//   「每个标准包都能导入」必须在平台行存在的前提下成立），种进去的东西与其它文件调用它的结果逐字节相同（幂等），
//   不新增任何本文件独有的全局行；本文件自己的写入只落在 ORG_A / ORG_B，由 resetOrgs 收敛。
/**
 * 活栈复现（fresh DB + dev-mode 管理员）的 Work Skill 目录问题——真实 HTTP + 真实 PostgreSQL + 仓库里**真实**
 * 发货的 `skills/starter-packs/*`，并且**不设** `SKILL_STARTER_PACK_ROOT`（证明 API 在非生产下默认到仓库目录）。
 *
 *  ① 仓库里每个 starter pack（各取最新版本）都能导入**同一个**新组织，正序、倒序都成功
 *     （修复前：work-research 在 work-product 之后 409 SKILL_STARTER_PACK_CONFLICT——共享的 S063/S017/S157/S161；
 *      work-sales 422 WORK_SKILL_CAPABILITY_UNREGISTERED——销售线分类从未登记；S009 两份副本内容分叉）；
 *  ② 跨包共享的 skill 是幂等复用：同一个 skill id / 版本 id，不新铸；
 *  ③ 导入后门状态不再是六门「未评测」：G0–G5 有门脚本同一判定函数的真实结论（G4/G5 无该版本报告 ⇒ fail，
 *     不默认通过）；非内容线的合成包（仓库里没有对应包源）仍如实「未评测」；
 *  ④ 目录列表的就绪性摘要按授权快照计算（修复前恒为 unknown）：无授权 ⇒ not_ready，授权后 ⇒ ready；
 *  ⑤ 导入后，因此变得可发布的内置 Workflow Definition 被发布（problem-to-prd / research-to-insight）。
 */
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  REPO_SKILL_STARTER_PACK_ROOT,
  resolveSkillStarterPackRoot,
} from "../../src/infrastructure/skill/file-skill-starter-pack-source";
import { addOrgMember, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";
delete process.env.SKILL_STARTER_PACK_ROOT;

const PACK_ROOT = resolve(__dirname, "../../../../skills/starter-packs");
const ORG_A = "org-live-packs-a";
const ORG_B = "org-live-packs-b";
const ADMIN = "u-live-packs-admin";

let app: NestExpressApplication;
let base = "";

function semverKey(v: string): number[] {
  return v.split(".").map((n) => Number(n));
}
function cmp(a: string, b: string): number {
  const x = semverKey(a);
  const y = semverKey(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}
/** 每个 pack 的最新版本（一个组织只装每个包的当前版本）。 */
const LATEST: readonly { packId: string; packVersion: string }[] = readdirSync(PACK_ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => {
    const versions = readdirSync(join(PACK_ROOT, d.name)).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort(cmp);
    return { packId: d.name, packVersion: versions[versions.length - 1]! };
  })
  .sort((a, b) => a.packId.localeCompare(b.packId));

const principal = (org: string) => ({ "x-kernel-test-principal": `${ADMIN}:${org}` });

async function importPack(org: string, packId: string, packVersion: string, idempotencyKey = randomUUID()) {
  const response = await fetch(`${base}/admin/skills/starter-pack-imports`, {
    method: "POST",
    headers: { ...principal(org), "content-type": "application/json" },
    body: JSON.stringify({ packId, packVersion, idempotencyKey }),
  });
  return { status: response.status, body: (await response.json()) as any };
}

async function getJson(org: string, path: string) {
  const response = await fetch(`${base}${path}`, { headers: principal(org) });
  return { status: response.status, body: (await response.json()) as any };
}

async function catalogItems(org: string): Promise<any[]> {
  const items: any[] = [];
  let cursor: string | null = null;
  do {
    const qs = new URLSearchParams({ limit: "100", ...(cursor ? { cursor } : {}) });
    const page = await getJson(org, `/skills/catalog?${qs}`);
    expect(page.status).toBe(200);
    items.push(...page.body.items);
    cursor = page.body.nextCursor;
  } while (cursor);
  return items;
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  // 活栈上平台组织在启动时已种好标准包（platform-owned，对每个组织可见）——这里显式种一遍，
  // 让「每个包都能导入」的断言不依赖同库里别的测试文件有没有先种过。
  const { ensurePlatformSkillCatalogSeeded } = await import("../../src/infrastructure/skill/ensure-platform-skill-catalog");
  const seeded = await ensurePlatformSkillCatalogSeeded();
  expect(seeded.ok).toBe(true);
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}, 300_000);

afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG_A, ORG_B);
});

beforeEach(async () => {
  await resetOrgs(ORG_A, ORG_B);
  for (const org of [ORG_A, ORG_B]) {
    const fixture = await seedOrg({ orgId: org, projectId: `${org}-project` });
    await addOrgMember(org, ADMIN, "admin", fixture.teams.energy!);
  }
});

describe("SKILL_STARTER_PACK_ROOT default", () => {
  it("unset in dev/test → the repo's skills/starter-packs; production → no guess; configured → configured", () => {
    expect(resolveSkillStarterPackRoot({ NODE_ENV: "test" })).toBe(REPO_SKILL_STARTER_PACK_ROOT);
    expect(resolveSkillStarterPackRoot({})).toBe(REPO_SKILL_STARTER_PACK_ROOT);
    expect(resolve(REPO_SKILL_STARTER_PACK_ROOT)).toBe(PACK_ROOT);
    expect(resolveSkillStarterPackRoot({ NODE_ENV: "production" })).toBeUndefined();
    expect(resolveSkillStarterPackRoot({ NODE_ENV: "production", SKILL_STARTER_PACK_ROOT: " /srv/packs " })).toBe("/srv/packs");
  });
});

describe("every shipped starter pack imports into one fresh org", () => {
  it("covers the work content lines", () => {
    expect(LATEST.map((p) => p.packId)).toEqual(expect.arrayContaining(["work-product", "work-research", "work-sales"]));
  });

  it.each([
    ["forward", ORG_A, false],
    ["reverse", ORG_B, true],
  ] as const)("%s order: every pack → 201, no 409/422", async (_label, org, reverse) => {
    const order = reverse ? [...LATEST].reverse() : [...LATEST];
    const failures: string[] = [];
    for (const pack of order) {
      const r = await importPack(org, pack.packId, pack.packVersion);
      if (r.status !== 201) failures.push(`${pack.packId}@${pack.packVersion} → ${r.status} ${JSON.stringify(r.body)}`);
    }
    expect(failures).toEqual([]);
  }, 300_000);
});

describe("shared skills across content-line packs are idempotent", () => {
  it("work-research after work-product reuses the shared skills (same skill + version ids)", async () => {
    const product = await importPack(ORG_A, "work-product", "1.0.0");
    expect(product.status).toBe(201);
    const research = await importPack(ORG_A, "work-research", "1.0.0");
    expect(research.status).toBe(201);
    const ids = await asOwner(async (c) => (await c.query<{ id: string; stable_name: string }>(
      "SELECT id, stable_name FROM skills WHERE org_id = $1 AND stable_name = ANY($2::text[])",
      [ORG_A, ["research-synthesis", "task-extraction", "data-exploration", "statistical-analysis"]],
    )).rows);
    expect(ids).toHaveLength(4);
    for (const { id } of ids) {
      expect(product.body.skillIds).toContain(id);
      expect(research.body.skillIds).toContain(id);
    }
    const versions = await asOwner(async (c) => (await c.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM skill_versions WHERE org_id = $1 AND skill_id = ANY($2::text[])",
      [ORG_A, ids.map((r) => r.id)],
    )).rows[0]!.n);
    expect(versions).toBe(4);
  }, 300_000);
});

describe("gate status is recorded at import (EV04)", () => {
  it("work skills get real G0–G5 outcomes from the gate script; G4/G5 fail without a report for this version", async () => {
    expect((await importPack(ORG_A, "work-product", "1.0.0")).status).toBe(201);
    const items = await catalogItems(ORG_A);
    const s064 = items.find((i) => i.stableId === "S064");
    expect(s064).toBeDefined();
    const gate = await getJson(ORG_A, `/skills/catalog/${s064.skillId}/gate-status`);
    expect(gate.status).toBe(200);
    expect(gate.body.decidedAt).not.toBeNull();
    expect(gate.body.stale).toBe(false);
    expect(gate.body.gates.map((g: any) => g.gate)).toEqual(["G0", "G1", "G2", "G3", "G4", "G5"]);
    expect(gate.body.gates.every((g: any) => g.state !== "not_evaluated")).toBe(true);
    const byGate = Object.fromEntries(gate.body.gates.map((g: any) => [g.gate, g]));
    expect(byGate.G0.state).toBe("pass");
    expect(byGate.G1.state).toBe("pass");
    expect(byGate.G4).toMatchObject({ state: "fail", reasonCode: "NO_SUITE" });
    expect(byGate.G5).toMatchObject({ state: "fail", reasonCode: "PRIOR_GATE_FAILED" });
    // 成员视图不含报告路径 / 夹具细节（R5）。
    expect(JSON.stringify(gate.body)).not.toContain("evidenceReportPath");

    const rows = await asOwner(async (c) => (await c.query<{ written_by: string }>(
      "SELECT written_by FROM skill_gate_records WHERE org_id = $1", [ORG_A],
    )).rows);
    expect(rows.length).toBe(items.length);
    expect(new Set(rows.map((r) => r.written_by))).toEqual(new Set(["system:starter-pack-import"]));
  }, 300_000);

  it("re-import never overwrites an existing gate record (only fills gaps)", async () => {
    expect((await importPack(ORG_A, "work-product", "1.0.0")).status).toBe(201);
    const before = await asOwner(async (c) => (await c.query<{ skill_version_id: string; decided_at: Date }>(
      "SELECT skill_version_id, decided_at FROM skill_gate_records WHERE org_id = $1 ORDER BY skill_version_id", [ORG_A],
    )).rows);
    expect((await importPack(ORG_A, "work-research", "1.0.0")).status).toBe(201);
    const after = await asOwner(async (c) => (await c.query<{ skill_version_id: string; decided_at: Date }>(
      "SELECT skill_version_id, decided_at FROM skill_gate_records WHERE org_id = $1 AND skill_version_id = ANY($2::text[]) ORDER BY skill_version_id",
      [ORG_A, before.map((r) => r.skill_version_id)],
    )).rows);
    expect(after).toEqual(before);
  }, 300_000);
});

describe("catalog readiness summary is computed per row (UC-3)", () => {
  it("no grants → not_ready with a count; granting every required category → ready", async () => {
    expect((await importPack(ORG_A, "work-research", "1.0.0")).status).toBe(201);
    const s003 = (await catalogItems(ORG_A)).find((i) => i.stableId === "S003");
    expect(s003.readiness).toEqual({ overall: "not_ready", missingRequired: 4 });
    await asOwner(async (c) => {
      for (const category of ["knowledge.read", "knowledge.search", "mail.search", "project.read"]) {
        await c.query(
          `INSERT INTO org_tool_capability_grants (org_id, tool_ref, category, enabled, grant_state, updated_by)
           VALUES ($1, $2, $3, true, 'granted', $4)`,
          [ORG_A, `mcp:${category}`, category, ADMIN],
        );
      }
    });
    const after = (await catalogItems(ORG_A)).find((i) => i.stableId === "S003");
    expect(after.readiness).toEqual({ overall: "ready", missingRequired: 0 });
    const detail = await getJson(ORG_A, `/skills/catalog/${s003.skillId}`);
    expect(detail.body.readiness).toEqual({ overall: "ready", missingRequired: 0 });
  }, 300_000);
});

describe("built-in workflow definitions are published once their skills are imported", () => {
  async function published(org: string): Promise<string[]> {
    return asOwner(async (c) => (await c.query<{ key: string }>(
      "SELECT DISTINCT key FROM workflow_definition_versions WHERE org_id = $1 AND status = 'published' ORDER BY key", [org],
    )).rows.map((r) => r.key));
  }

  it("work-product makes problem-to-prd publishable; work-research then unlocks research-to-insight", async () => {
    expect(await published(ORG_A)).toEqual([]);
    expect((await importPack(ORG_A, "work-product", "1.0.0")).status).toBe(201);
    const afterProduct = await published(ORG_A);
    expect(afterProduct).toContain("problem-to-prd");
    expect(afterProduct).not.toContain("research-to-insight"); // 缺 S169/S171（研究线）
    // 仍缺 Skill 的 Definition 不留空的 definition 行。
    const empty = await asOwner(async (c) => (await c.query<{ key: string }>(
      `SELECT d.key FROM workflow_definitions d WHERE d.org_id = $1
         AND NOT EXISTS (SELECT 1 FROM workflow_definition_versions v WHERE v.org_id = d.org_id AND v.key = d.key)`, [ORG_A],
    )).rows);
    expect(empty).toEqual([]);

    expect((await importPack(ORG_A, "work-research", "1.0.0")).status).toBe(201);
    expect(await published(ORG_A)).toEqual(expect.arrayContaining(["problem-to-prd", "research-to-insight"]));
  }, 300_000);
});
