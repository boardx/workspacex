/**
 * WS04（Phase 20，R3.8 / UC-6，A4 / E5 / E6 / R5）：Work Skill 依赖就绪性计算与 API。
 *
 * 一、纯函数：逐项 satisfied / missing / denied、optional 不阻断、查询失败 = unknown、未登记分类。
 * 二、真实 HTTP + 真实 PostgreSQL：目录行由真实 starter-pack 导入产生（required knowledge.search，
 *     optional web.fetch）；授权事实写入 `org_tool_capability_grants`，就绪性随授权实时变化（不缓存）。
 * 三、E5：授权读取端口抛错 → 用例返回 overall=unknown（不抛、不显示 ready）。
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { SkillReadiness } from "@repo/contracts/work-skill-meta";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { computeSkillReadiness, type OrgToolCapabilityGrant } from "../../src/domain/skill/work-skill-readiness";
import { isRegisteredCapabilityCategory } from "../../src/domain/skill/capability-category-registry";
import { getWorkSkillReadiness } from "../../src/application/skill/work-skill-readiness";
import { addOrgMember, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { importWorkPack, RESEARCH, writeWorkPack } from "./support/catalog-fixture";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const g = (category: string, grant: "granted" | "denied", enabled = true, toolRef = `tool-${category}`): OrgToolCapabilityGrant =>
  ({ category, grant, enabled, toolRef });

describe("WS04 computeSkillReadiness (pure)", () => {
  const deps = { required: ["knowledge.search", "crm.read"], optional: ["web.fetch"] };

  it("all required granted → ready, optional missing still ready (A4)", () => {
    const r = computeSkillReadiness(deps, { ok: true, grants: [g("knowledge.search", "granted"), g("crm.read", "granted")] }, isRegisteredCapabilityCategory);
    expect(r.overall).toBe("ready");
    expect(r.missingRequired).toBe(0);
    expect(r.items).toEqual([
      { category: "knowledge.search", kind: "required", state: "satisfied", reasonCode: "OK" },
      { category: "crm.read", kind: "required", state: "satisfied", reasonCode: "OK" },
      { category: "web.fetch", kind: "optional", state: "missing", reasonCode: "NO_ENABLED_TOOL" },
    ]);
  });

  it("denied grant → denied/GRANT_DENIED; disabled tool does not count; not ready", () => {
    const r = computeSkillReadiness(deps, {
      ok: true, grants: [g("knowledge.search", "denied"), g("crm.read", "granted", false)],
    }, isRegisteredCapabilityCategory);
    expect(r.overall).toBe("not_ready");
    expect(r.missingRequired).toBe(2);
    expect(r.items[0]).toMatchObject({ state: "denied", reasonCode: "GRANT_DENIED" });
    expect(r.items[1]).toMatchObject({ state: "missing", reasonCode: "NO_ENABLED_TOOL" });
  });

  it("lookup failure → unknown, never ready (E5)", () => {
    const r = computeSkillReadiness(deps, { ok: false }, isRegisteredCapabilityCategory);
    expect(r.overall).toBe("unknown");
    expect(r.missingRequired).toBeNull();
    expect(r.items.every((i) => i.state === "unknown" && i.reasonCode === "GRANT_LOOKUP_FAILED")).toBe(true);
  });

  it("unregistered category → missing/CATEGORY_UNREGISTERED even if a tool claims it (E6)", () => {
    const r = computeSkillReadiness({ required: ["legacy.retired"], optional: [] },
      { ok: true, grants: [g("legacy.retired", "granted")] }, isRegisteredCapabilityCategory);
    expect(r.overall).toBe("not_ready");
    expect(r.items[0]).toMatchObject({ state: "missing", reasonCode: "CATEGORY_UNREGISTERED" });
  });
});

const ORG = "org-ws04-ready";
const OTHER_ORG = "org-ws04-ready-other";
const ADMIN = "u-ws04-admin";
const MEMBER = "u-ws04-member";
const OUTSIDER = "u-ws04-outsider";
const PACK = "ws04-ready-pack";

let app: NestExpressApplication;
let base = "";
let packRoot = "";
let skillId = "";

async function readiness(user = MEMBER, org = ORG, id = skillId) {
  const response = await fetch(`${base}/skills/catalog/${id}/readiness`, { headers: { "x-kernel-test-principal": `${user}:${org}` } });
  return { status: response.status, body: await response.json() as any };
}

async function setGrant(category: string, grant: "granted" | "denied" | null, enabled = true) {
  await asOwner(async (c) => {
    if (grant === null) {
      await c.query("DELETE FROM org_tool_capability_grants WHERE org_id = $1 AND category = $2", [ORG, category]);
      return;
    }
    await c.query(
      `INSERT INTO org_tool_capability_grants (org_id, tool_ref, category, enabled, grant_state, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (org_id, tool_ref, category) DO UPDATE SET enabled = EXCLUDED.enabled, grant_state = EXCLUDED.grant_state`,
      [ORG, `mcp:${category}`, category, enabled, grant, ADMIN],
    );
  });
}

beforeAll(async () => {
  packRoot = mkdtempSync(join(tmpdir(), "ws04-packs-"));
  process.env.SKILL_STARTER_PACK_ROOT = packRoot;
  writeWorkPack(packRoot, PACK, "1.0.0", [RESEARCH]);
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG, OTHER_ORG);
  rmSync(packRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetOrgs(ORG, OTHER_ORG);
  const fixture = await seedOrg({ orgId: ORG, projectId: `${ORG}-project` });
  await addOrgMember(ORG, ADMIN, "admin", fixture.teams.energy!);
  await addOrgMember(ORG, MEMBER, "consultant", fixture.teams.energy!);
  const other = await seedOrg({ orgId: OTHER_ORG, projectId: `${OTHER_ORG}-project` });
  await addOrgMember(OTHER_ORG, OUTSIDER, "admin", other.teams.energy!);
  skillId = (await importWorkPack(base, `${ADMIN}:${ORG}`, PACK, "1.0.0")).skillIds[0]!;
});

describe("WS04 GET /skills/catalog/:skillId/readiness", () => {
  it("required granted → ready with contract shape; optional missing stays ready (A4)", async () => {
    await setGrant("knowledge.search", "granted");
    const { status, body } = await readiness();
    expect(status).toBe(200);
    // 契约 Id=uuid 与本仓 `skill-<uuid>` 形状偏差（见 controller 注释）：id 之外的字段按契约 schema 校验。
    expect(SkillReadiness.omit({ skillId: true, skillVersionId: true }).strict().safeParse(
      (({ skillId: _s, skillVersionId: _v, ...rest }) => rest)(body),
    ).success).toBe(true);
    expect(body.skillId).toBe(skillId);
    expect(body.overall).toBe("ready");
    expect(body.missingRequired).toBe(0);
    expect(body.items).toEqual([
      { category: "knowledge.search", kind: "required", state: "satisfied", reasonCode: "OK", grantHref: null },
      { category: "web.fetch", kind: "optional", state: "missing", reasonCode: "NO_ENABLED_TOOL", grantHref: null },
    ]);
  });

  it("recomputes live: revoking the grant → missing, denying → denied; admin sees grantHref", async () => {
    await setGrant("knowledge.search", "granted");
    expect((await readiness()).body.overall).toBe("ready");
    await setGrant("knowledge.search", null);
    let { body } = await readiness();
    expect(body.overall).toBe("not_ready");
    expect(body.missingRequired).toBe(1);
    expect(body.items[0]).toMatchObject({ state: "missing", reasonCode: "NO_ENABLED_TOOL", grantHref: null });
    await setGrant("knowledge.search", "denied");
    ({ body } = await readiness(ADMIN));
    expect(body.overall).toBe("not_ready");
    expect(body.items[0]).toMatchObject({ state: "denied", reasonCode: "GRANT_DENIED" });
    expect(body.items[0].grantHref).toContain("knowledge.search");
  });

  it("other org's grants do not count; cross-org / unknown skill → 404 (R5)", async () => {
    await asOwner((c) => c.query(
      `INSERT INTO org_tool_capability_grants (org_id, tool_ref, category, grant_state, updated_by) VALUES ($1,'t','knowledge.search','granted','x')`,
      [OTHER_ORG],
    ));
    expect((await readiness()).body.overall).toBe("not_ready");
    expect((await readiness(OUTSIDER, OTHER_ORG)).status).toBe(404);
    expect((await readiness(MEMBER, ORG, "skill-does-not-exist")).status).toBe(404);
  });

  it("grant lookup failure → overall unknown, not ready and not 5xx (E5)", async () => {
    const view = await getWorkSkillReadiness({
      identities: app.get((await import("../../src/application/identity/ports")).IDENTITY_REPOSITORY),
      catalog: app.get((await import("../../src/application/skill/work-skill-catalog")).WORK_SKILL_CATALOG_REPOSITORY),
      grants: { listForOrg: async () => { throw new Error("grant service down"); } },
    }, { actorId: MEMBER, orgId: ORG as never, skillId });
    expect(view.overall).toBe("unknown");
    expect(view.missingRequired).toBeNull();
    expect(view.items.find((i) => i.kind === "required")).toMatchObject({ state: "unknown", reasonCode: "GRANT_LOOKUP_FAILED" });
  });
});

describe("WS04 repo-guard (lint-permission-paths allowlist entry for pg-tool-grant-reader.ts)", () => {
  const src = (rel: string) => readFileSync(join(__dirname, "../../src", rel), "utf8");

  it("reader names only org_tool_capability_grants and never uses withoutTenant", () => {
    const reader = src("infrastructure/skill/pg-tool-grant-reader.ts");
    expect(reader).not.toMatch(/withoutTenant/);
    const tables = [...reader.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_]+)/g)].map((m) => m[1]);
    expect(new Set(tables)).toEqual(new Set(["org_tool_capability_grants"]));
  });

  it("use case checks membership before reading grants and never returns toolRef", () => {
    const useCase = src("application/skill/work-skill-readiness.ts");
    const membership = useCase.indexOf("findOrgMembership(");
    const grants = useCase.indexOf("grants.listForOrg(");
    expect(membership).toBeGreaterThan(-1);
    expect(grants).toBeGreaterThan(membership);
    expect(useCase.slice(useCase.indexOf("return {", grants))).not.toMatch(/toolRef/);
  });
});
