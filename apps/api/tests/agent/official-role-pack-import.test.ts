/**
 * AG03 / UC-3（契约束 `agent-role`，03-agent-role.md R3.3）—— 官方角色包导入。
 *
 * 覆盖 user_visible_behavior：
 *   - 管理员导入后每组织出现 7 个 catalogSource='official' Agent 草稿，workflowAllowlist 逐字
 *     取自 DIGITALHUMAN-COMPOSITION-MATRIX.md（D001/D002/D003/D005/D006/D007/D011），toolPolicy 分类不产生
 *     任何授权（本仓库尚无任何授权/凭证表可写，只断言声明本身落库）。
 *   - 白名单引用未注册 Workflow → 422 UNRESOLVED_WORKFLOW_REF，DB 无新增 agent/agent_version 行。
 *   - 挂载的 skillVersions 无法解析 → 422 UNRESOLVED_SKILL_REF，DB 无新增 agent/agent_version 行。
 *   - 非管理员 → 403，DB 无新增行。
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addOrgMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { FileAgentStarterPackSource } from "../../src/infrastructure/agent/file-agent-starter-pack-source";
import { insertAgentVersionFromDraft } from "../../src/infrastructure/agent/agent-version-insert";
import { buildOfficialAgentRolePack, officialRoleAvatarKeys, officialRoleNames, officialRoleSkillPacks, officialRoleTags, OFFICIAL_AGENT_ROLE_PACK_ID, OFFICIAL_AGENT_ROLE_PACK_VERSION } from "../../src/domain/agent/official-role-packs";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-ag03-official-roles";
const ADMIN = "u-ag03-admin";
const MEMBER = "u-ag03-member";

/**
 * 历史迁移只覆盖当时存在的四个官方角色（1.5.0 起包里还有 D001/D006/D007，新增角色没有旧行可回填）：
 * 这些迁移的字面量与「包里同一批 stableName」核对，而不是与整张包核对。
 */
const LEGACY_ROLES = ["d002-research-knowledge-analyst", "d003-product-manager", "d005-sales-representative", "d011-design-thinking-expert"];
const restrictTo = <T,>(all: Readonly<Record<string, T>>, keys: readonly string[]): Record<string, T> => Object.fromEntries(keys.map((k) => [k, all[k] as T]));

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

let app: NestExpressApplication;
let base = "";
let agentPackRoot = "";

const authFor = (userId: string, orgId = ORG) => ({
  "x-kernel-test-principal": `${userId}:${orgId}`,
  "content-type": "application/json",
});

function postImport(userId: string, body: { packId: string; packVersion: string; idempotencyKey: string }, orgId = ORG): Promise<Response> {
  return fetch(`${base}/admin/agents/starter-pack-imports`, {
    method: "POST",
    headers: authFor(userId, orgId),
    body: JSON.stringify(body),
  });
}

function writePack(packId: string, packVersion: string, pack: unknown): void {
  const dir = join(agentPackRoot, packId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${packVersion}.json`), `${JSON.stringify(pack, null, 2)}\n`);
}

async function counts(orgId = ORG): Promise<Record<string, number>> {
  return asApp(orgId, async (client) => {
    const tables = ["agents", "agent_versions"] as const;
    const result: Record<string, number> = {};
    for (const table of tables) {
      const rows = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table} WHERE org_id = $1`, [orgId]);
      result[table] = Number(rows.rows[0]?.n ?? "0");
    }
    return result;
  });
}

interface AgentRoleRow {
  readonly stable_name: string;
  readonly catalog_source: string;
  readonly role_category: string | null;
  readonly workflow_allowlist: string[];
  readonly role_label: string;
  readonly avatar: unknown;
  readonly tags: string[];
}

async function roleRows(orgId = ORG): Promise<AgentRoleRow[]> {
  return asApp(orgId, async (client) => {
    const result = await client.query<AgentRoleRow>(
      "SELECT stable_name, catalog_source, role_category, workflow_allowlist, role_label, avatar, tags FROM agents WHERE org_id = $1 ORDER BY stable_name",
      [orgId],
    );
    return result.rows;
  });
}

/** 借官方角色包的 seed 生成器造一个只有一条 entry、可注入坏引用的变体包，避免污染真实内容。 */
function buildBrokenPack(input: { readonly packId: string; readonly overrides: Partial<{ workflowAllowlist: readonly string[]; skillVersions: readonly { versionId: string; digest: string }[] }> }) {
  const real = buildOfficialAgentRolePack();
  const base = real.agents[0]!;
  const unsignedAgent = {
    stableName: base.stableName,
    name: base.name,
    semanticVersion: base.semanticVersion,
    instructions: base.instructions,
    instructionDigest: base.instructionDigest,
    skillVersions: input.overrides.skillVersions ?? [],
    modelProvider: base.modelProvider,
    modelId: base.modelId,
    toolPolicy: base.toolPolicy,
    roleRef: base.roleRef,
    roleLabel: base.roleLabel,
    role: {
      avatar: base.role.avatar,
      roleCategory: base.role.roleCategory,
      workflowAllowlist: input.overrides.workflowAllowlist ?? base.role.workflowAllowlist,
      delegationPolicy: base.role.delegationPolicy,
      escalationPolicy: base.role.escalationPolicy,
      kpi: base.role.kpi,
      tags: base.role.tags,
    },
  };
  const unsigned = { schemaVersion: 1 as const, packId: input.packId, packVersion: "1.0.0", agents: [unsignedAgent] };
  return { ...unsigned, packDigest: sha256(JSON.stringify(unsigned)) };
}

beforeAll(async () => {
  agentPackRoot = mkdtempSync(join(tmpdir(), "workspacex-official-agent-packs-"));
  process.env.AGENT_STARTER_PACK_ROOT = agentPackRoot;
  // WORKFLOW_DEFINITIONS_ROOT 故意不设：默认回退到仓库真实的
  // requirements/work-stack-v2/workflows/，D002/D003/D005/D011 的白名单因此用真实注册表校验。

  // 官方包故意**不**写到磁盘：开箱即用路径由 FileAgentStarterPackSource 从代码产出（实测 404 回归）。
  writePack("official-role-pack-bad-workflow", "1.0.0", buildBrokenPack({ packId: "official-role-pack-bad-workflow", overrides: { workflowAllowlist: ["W001", "W999"] } }));
  writePack("official-role-pack-bad-skill", "1.0.0", buildBrokenPack({ packId: "official-role-pack-bad-skill", overrides: { skillVersions: [{ versionId: "agent-skill-version-does-not-exist", digest: "a".repeat(64) }] } }));

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
  await resetOrgs(ORG);
  rmSync(agentPackRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetOrgs(ORG);
  const fixture = await seedOrg({ orgId: ORG, projectId: `${ORG}-project` });
  await addOrgMember(ORG, ADMIN, "admin", fixture.teams.energy!);
  await addOrgMember(ORG, MEMBER, "consultant", fixture.teams.energy!);
});

describe("official role pack import (AG03 / UC-3)", () => {
  it("freezes only exact verified local Skills as executable and leaves candidates transparently pending", async () => {
    // Real starter import creates candidate catalog rows; this fixture marks one trusted version verified
    // to exercise the import boundary, not to claim that its model evaluation was performed here.
    const skillImport = await fetch(`${base}/admin/skills/starter-pack-imports`, {
      method: "POST", headers: authFor(ADMIN),
      body: JSON.stringify({ packId: "work-research", packVersion: "1.0.0", idempotencyKey: randomUUID() }),
    });
    expect(skillImport.status).toBe(201);
    await skillImport.json();
    const verifiedId = await asApp(ORG, async (client) => {
      const row = (await client.query<{skill_id:string;version_id:string}>(
        "SELECT s.id AS skill_id,v.id AS version_id FROM skills s JOIN skill_versions v ON v.skill_id=s.id AND v.org_id=s.org_id WHERE s.org_id=$1 AND s.stable_name='enterprise-search' AND v.published=true", [ORG])).rows[0]!;
      await client.query("UPDATE skill_catalog_entries SET channel='verified' WHERE org_id=$1 AND skill_id=$2", [ORG,row.skill_id]);
      return row.version_id;
    });
    const response = await postImport(ADMIN, { packId: OFFICIAL_AGENT_ROLE_PACK_ID, packVersion: OFFICIAL_AGENT_ROLE_PACK_VERSION, idempotencyKey: randomUUID() });
    expect(response.status).toBe(201);
    const stored = await asApp(ORG, async (client) => (await client.query<{skill_version_ids:string[];pending_skill_bindings:{stableId:string;reason:string;versionId?:string}[]}>(
      "SELECT v.skill_version_ids,v.pending_skill_bindings FROM agents a JOIN agent_versions v ON v.id=a.published_version_id AND v.org_id=a.org_id WHERE a.org_id=$1 AND a.stable_name='d002-research-knowledge-analyst'", [ORG])).rows[0]!);
    expect(stored.skill_version_ids).toEqual([verifiedId]);
    expect(stored.pending_skill_bindings).toHaveLength(9);
    expect(stored.pending_skill_bindings.some((binding) => binding.stableId === "S003")).toBe(false);
    expect(stored.pending_skill_bindings.every((binding) => binding.reason === "awaiting_verification" && binding.versionId)).toBe(true);
    const channels = await asApp(ORG, async (client) => (await client.query<{channel:string;n:string}>("SELECT channel,count(*)::text AS n FROM skill_catalog_entries WHERE org_id=$1 GROUP BY channel", [ORG])).rows);
    expect(channels.find((row) => row.channel === "verified")!.n).toBe("1");
  });

  it("creates 7 catalogSource='official' agent drafts with workflowAllowlist matching the composition matrix, no authorization granted", async () => {
    const response = await postImport(ADMIN, { packId: OFFICIAL_AGENT_ROLE_PACK_ID, packVersion: OFFICIAL_AGENT_ROLE_PACK_VERSION, idempotencyKey: randomUUID() });
    expect(response.status).toBe(201);
    const body = await response.json() as { agentIds: string[]; versionIds: string[] };
    const packSize = buildOfficialAgentRolePack().agents.length;
    expect(body.agentIds).toHaveLength(packSize);
    expect(body.versionIds).toHaveLength(packSize);

    const rows = await roleRows();
    expect(rows.map((r) => r.stable_name)).toEqual([
      "d001-executive-strategy-partner",
      "d002-research-knowledge-analyst",
      "d003-product-manager",
      "d005-sales-representative",
      "d006-customer-success-specialist",
      "d007-project-operations-manager",
      "d011-design-thinking-expert",
    ]);
    for (const row of rows) expect(row.catalog_source).toBe("official");
    // A fresh organization remains usable without inventing verified skills: every gap is frozen explicitly.
    const versions = await asApp(ORG, async (client) => (await client.query<{instructions:string;skill_version_ids:string[];pending_skill_bindings:unknown[]; stable_name:string}>(
      "SELECT a.stable_name,v.instructions,v.skill_version_ids,v.pending_skill_bindings FROM agents a JOIN agent_versions v ON v.org_id=a.org_id AND v.id=a.published_version_id WHERE a.org_id=$1", [ORG])).rows);
    for (const role of buildOfficialAgentRolePack().agents) {
      const version = versions.find((entry) => entry.stable_name === role.stableName)!;
      expect(version.instructions).toBe(role.instructions);
      expect(version.skill_version_ids).toEqual([]);
      expect(version.pending_skill_bindings).toEqual(role.authoredSkillBindings!.map((binding) => ({ ...binding, reason: "missing_version" })));
    }

    expect(rows.find((r) => r.stable_name === "d002-research-knowledge-analyst")).toMatchObject({
      role_category: "research",
      workflow_allowlist: ["W001", "W060", "W009", "W006", "W057"],
      role_label: "研究与知识分析师",
    });
    // 1.5.0 新增三角色：类别 / 中文名 / 白名单逐字取自矩阵（D006 首版有意不含 W017，见 official-role-packs.ts）。
    expect(rows.find((r) => r.stable_name === "d001-executive-strategy-partner")).toMatchObject({ role_category: "executive", workflow_allowlist: ["W001", "W004", "W009", "W003"], role_label: "高管与战略伙伴" });
    expect(rows.find((r) => r.stable_name === "d006-customer-success-specialist")).toMatchObject({ role_category: "customer_success", workflow_allowlist: ["W007", "W018", "W002", "W006"], role_label: "客户成功专员" });
    expect(rows.find((r) => r.stable_name === "d007-project-operations-manager")).toMatchObject({ role_category: "operations", workflow_allowlist: ["W052", "W053", "W055", "W056", "W002", "W003"], role_label: "项目与运营经理" });
    expect(rows.find((r) => r.stable_name === "d003-product-manager")?.workflow_allowlist).toEqual(["W027", "W028", "W029", "W030", "W031", "W032"]);
    expect(rows.find((r) => r.stable_name === "d005-sales-representative")?.workflow_allowlist).toEqual(["W011", "W012", "W013", "W014", "W015", "W016", "W018"]);
    expect(rows.find((r) => r.stable_name === "d011-design-thinking-expert")?.workflow_allowlist).toEqual(["W027", "W028", "W029", "W031", "W002"]);
    // 数字人肖像：每个官方角色落库的 avatar 就是 ROLE_SEEDS 声明的那张（60 格网格按角色名对应）。
    expect(Object.fromEntries(rows.map((r) => [r.stable_name, (r.avatar as { key?: string } | null)?.key ?? null]))).toEqual(officialRoleAvatarKeys());
    expect(Object.fromEntries(rows.map((r) => [r.stable_name, r.tags]))).toEqual(officialRoleTags());
    expect(rows.find((r) => r.stable_name === "d005-sales-representative")?.avatar).toEqual({ kind: "illustration", key: "dh-05-sales-representative", alt: "销售代表" });

    // toolPolicy 分类不产生任何授权：这个仓库目前没有任何工具授权/凭证表可写，落库的只有声明
    // 本身（agent_versions.tool_policy），断言它就是声明而不是别的什么被顺带授予了。
    const toolPolicies = await asApp(ORG, async (client) => {
      const result = await client.query<{ tool_policy: unknown }>(
        "SELECT tool_policy FROM agent_versions WHERE org_id = $1 AND agent_id = ANY($2::text[]) ORDER BY agent_id",
        [ORG, body.agentIds],
      );
      return result.rows.map((r) => r.tool_policy);
    });
    for (const policy of toolPolicies) expect(Array.isArray(policy)).toBe(true);
    expect(toolPolicies.flat()).toEqual(expect.arrayContaining(["knowledge.search", "crm.read"]));
  });

  it("replays the same result on a repeated idempotencyKey without creating new rows", async () => {
    const idempotencyKey = randomUUID();
    const first = await postImport(ADMIN, { packId: OFFICIAL_AGENT_ROLE_PACK_ID, packVersion: OFFICIAL_AGENT_ROLE_PACK_VERSION, idempotencyKey });
    expect(first.status).toBe(201);
    const before = await counts();
    const second = await postImport(ADMIN, { packId: OFFICIAL_AGENT_ROLE_PACK_ID, packVersion: OFFICIAL_AGENT_ROLE_PACK_VERSION, idempotencyKey });
    expect(second.status).toBe(200);
    expect(await first.json()).toEqual(await second.json());
    expect(await counts()).toEqual(before);
  });

  it("rejects a non-administrator before touching the pack, writing nothing", async () => {
    const response = await postImport(MEMBER, { packId: OFFICIAL_AGENT_ROLE_PACK_ID, packVersion: OFFICIAL_AGENT_ROLE_PACK_VERSION, idempotencyKey: randomUUID() });
    expect(response.status).toBe(403);
    expect(await counts()).toEqual({ agents: 0, agent_versions: 0 });
  });

  it("fails UNRESOLVED_WORKFLOW_REF when workflowAllowlist references an unregistered workflow, and writes no agent rows", async () => {
    const response = await postImport(ADMIN, { packId: "official-role-pack-bad-workflow", packVersion: "1.0.0", idempotencyKey: randomUUID() });
    expect(response.status).toBe(422);
    const body = await response.json() as { reasonCode: string; detail: { missingIds: string[] } };
    expect(body.reasonCode).toBe("UNRESOLVED_WORKFLOW_REF");
    expect(body.detail.missingIds).toEqual(["W999"]);
    expect(await counts()).toEqual({ agents: 0, agent_versions: 0 });
  });

  it("fails UNRESOLVED_SKILL_REF when a mounted skillVersion cannot be resolved, and writes no agent rows", async () => {
    const response = await postImport(ADMIN, { packId: "official-role-pack-bad-skill", packVersion: "1.0.0", idempotencyKey: randomUUID() });
    expect(response.status).toBe(422);
    const body = await response.json() as { reasonCode: string; detail: { missingIds: string[] } };
    expect(body.reasonCode).toBe("UNRESOLVED_SKILL_REF");
    expect(body.detail.missingIds).toEqual(["agent-skill-version-does-not-exist"]);
    expect(await counts()).toEqual({ agents: 0, agent_versions: 0 });
  });
});

describe("official role pack availability and failed-import retry", () => {
  it("serves the built-in official pack from code when no pack root is configured", async () => {
    const source = new FileAgentStarterPackSource(undefined);
    expect(await source.load(OFFICIAL_AGENT_ROLE_PACK_ID, OFFICIAL_AGENT_ROLE_PACK_VERSION)).toEqual(buildOfficialAgentRolePack());
    expect(await source.load(OFFICIAL_AGENT_ROLE_PACK_ID, "0.0.1")).toBeNull();
    expect(await source.load("some-other-pack", "1.0.0")).toBeNull();
  });

  it("does not poison the idempotency key: a retry after a 404 succeeds once the pack is available", async () => {
    const packId = "official-role-pack-late";
    const idempotencyKey = randomUUID();
    const missing = await postImport(ADMIN, { packId, packVersion: "1.0.0", idempotencyKey });
    expect(missing.status).toBe(404);
    writePack(packId, "1.0.0", buildBrokenPack({ packId, overrides: {} }));
    const retry = await postImport(ADMIN, { packId, packVersion: "1.0.0", idempotencyKey });
    expect(retry.status).toBe(201);
    const replay = await postImport(ADMIN, { packId, packVersion: "1.0.0", idempotencyKey });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(await retry.json());
    expect(await counts()).toEqual({ agents: 1, agent_versions: 1 });
    const ledger = await asApp(ORG, (client) => client.query<{ status: string }>("SELECT status FROM agent_starter_pack_imports WHERE org_id = $1 AND idempotency_key = $2", [ORG, idempotencyKey]));
    expect(ledger.rows).toEqual([{ status: "succeeded" }]);
  });
});

describe("dh portrait backfill migration (20260929150000)", () => {
  it("backfills exactly the stableName → avatar that the 1.1.0 pack seeds declare (the SQL literal is a checked copy)", () => {
    const sql = readFileSync(join(__dirname, "../../migrations/20260929150000_dh_portrait_avatars.sql"), "utf8");
    // alt 随 1.4.0 改为中文名（历史迁移保留 1.1.0 的英文 alt）；核对的承重事实是 stableName → 肖像 key。
    const literal = Object.fromEntries([...sql.matchAll(/\('(d\d{3}-[a-z0-9-]+)',\s*'(\{[^']+\})'\)/g)].map((m) => { const a = JSON.parse(m[2]!) as { kind: string; key: string }; return [m[1], { kind: a.kind, key: a.key }]; }));
    const fromPack = Object.fromEntries(buildOfficialAgentRolePack().agents.map((a) => [a.stableName, { kind: a.role.avatar?.kind, key: a.role.avatar?.key }]));
    expect(Object.keys(literal).sort()).toEqual(LEGACY_ROLES);
    expect(literal).toEqual(restrictTo(fromPack, Object.keys(literal)));
  });
});

describe("agent tags backfill migration (20260929160000)", () => {
  it("backfills exactly the stableName → tags that the 1.2.0 pack seeds declare (the SQL literal is a checked copy)", () => {
    const sql = readFileSync(join(__dirname, "../../migrations/20260929160000_agent_tags.sql"), "utf8");
    const literal = Object.fromEntries([...sql.matchAll(/\('(d\d{3}-[a-z0-9-]+)',\s*ARRAY\[([^\]]*)\]\)/g)]
      .map((m) => [m[1], [...m[2]!.matchAll(/'([^']+)'/g)].map((t) => t[1])]));
    const fromPack = Object.fromEntries(buildOfficialAgentRolePack().agents.map((a) => [a.stableName, a.role.tags]));
    expect(Object.keys(literal).sort()).toEqual(LEGACY_ROLES);
    expect(literal).toEqual(restrictTo(fromPack, Object.keys(literal)));
  });
});

describe("official names zh migration (20260930123000)", () => {
  it("renames exactly the stableName → 中文名 that the pack seeds declare for the four 1.4.0 roles (the SQL literal is a checked copy)", () => {
    const sql = readFileSync(join(__dirname, "../../migrations/20260930123000_dh_official_names_zh.sql"), "utf8");
    const literal = Object.fromEntries([...sql.matchAll(/\('(d\d{3}-[a-z0-9-]+)',\s*'[^']+',\s*'([^']+)'\)/g)].map((m) => [m[1], m[2]]));
    expect(Object.keys(literal).sort()).toEqual(LEGACY_ROLES);
    expect(literal).toEqual(restrictTo(officialRoleNames(), Object.keys(literal)));
    // 1.5.0 新增角色本来就是中文名，没有英文旧名可改：不在该迁移里。
    expect(Object.keys(officialRoleNames())).toEqual(expect.arrayContaining(["d001-executive-strategy-partner", "d006-customer-success-specialist", "d007-project-operations-manager"]));
  });
});

describe("agent tags round trip (PATCH role draft → publish → GET /agents/directory)", () => {
  it("directory cards carry the pack tags, and an edited + published org agent's normalized tags", async () => {
    const imported = await postImport(ADMIN, { packId: OFFICIAL_AGENT_ROLE_PACK_ID, packVersion: OFFICIAL_AGENT_ROLE_PACK_VERSION, idempotencyKey: randomUUID() });
    expect(imported.status).toBe(201);

    const listed = await fetch(`${base}/agents/directory`, { headers: authFor(MEMBER) });
    expect(listed.status).toBe(200);
    const cards = (await listed.json() as { items: { agentId: string; name: string; tags: string[] }[] }).items;
    expect(Object.fromEntries(cards.map((c) => [c.name, c.tags]))).toMatchObject({ "销售代表": ["销售", "客户", "商机"] });

    // 标签也进搜索：q=商机 只命中销售。
    const searched = await fetch(`${base}/agents/directory?q=${encodeURIComponent("商机")}`, { headers: authFor(MEMBER) });
    expect((await searched.json() as { items: { name: string }[] }).items.map((c) => c.name)).toEqual(["销售代表"]);

    // 官方 Agent 角色字段锁定（须克隆后改）：这里把一行改成组织自有，模拟克隆出的可编辑 Agent。
    const target = cards.find((c) => c.name === "销售代表")!;
    await asApp(ORG, (client) => client.query("UPDATE agents SET catalog_source = 'org' WHERE id = $1 AND org_id = $2", [target.agentId, ORG]));
    const role = await fetch(`${base}/admin/agents/${target.agentId}/role`, { headers: authFor(ADMIN) });
    const { version } = await role.json() as { version: number };

    const tooMany = await fetch(`${base}/admin/agents/${target.agentId}/role`, {
      method: "PATCH", headers: authFor(ADMIN),
      body: JSON.stringify({ agentId: target.agentId, expectedVersion: version, patch: { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) } }),
    });
    expect(tooMany.status).toBe(400);

    const patched = await fetch(`${base}/admin/agents/${target.agentId}/role`, {
      method: "PATCH", headers: authFor(ADMIN),
      body: JSON.stringify({ agentId: target.agentId, expectedVersion: version, patch: { tags: [" 销售 ", "大客户", "销售"] } }),
    });
    expect(patched.status).toBe(200);
    expect((await patched.json() as { draft: { tags: string[] } }).draft.tags).toEqual(["销售", "大客户"]);

    // 目录读已发布快照：发布前仍是旧标签；发布（冻结当前草稿）后才是新标签。
    const versionId = `agent-version-${randomUUID()}`;
    await asApp(ORG, async (client) => {
      const session = { query: (sql: string, params?: unknown[]) => client.query(sql, params) } as never;
      await insertAgentVersionFromDraft(session, { versionId, orgId: ORG, agentId: target.agentId, semanticLabel: "1.2.1", instructionDigest: sha256("i"), instructions: "i", skillVersionIds: [], modelProvider: "dashscope", modelId: "qwen-plus", toolPolicy: [], creatorId: ADMIN, at: new Date().toISOString() });
      await client.query("UPDATE agents SET published_version_id = $3 WHERE id = $1 AND org_id = $2", [target.agentId, ORG, versionId]);
    });
    const card = await fetch(`${base}/agents/directory/${target.agentId}`, { headers: authFor(MEMBER) });
    expect(card.status).toBe(200);
    expect((await card.json() as { tags: string[] }).tags).toEqual(["销售", "大客户"]);
  });
});

describe("official agent tags are org-curated (admin edits tags; other official fields stay locked)", () => {
  it("PATCH tags on an official agent → directory shows them at once; re-import / tags backfill keep them", async () => {
    const imported = await postImport(ADMIN, { packId: OFFICIAL_AGENT_ROLE_PACK_ID, packVersion: OFFICIAL_AGENT_ROLE_PACK_VERSION, idempotencyKey: randomUUID() });
    expect(imported.status).toBe(201);
    const cards = (await (await fetch(`${base}/agents/directory`, { headers: authFor(MEMBER) })).json() as { items: { agentId: string; name: string }[] }).items;
    const target = cards.find((c) => c.name === "研究与知识分析师") ?? cards[0]!;
    const role = await fetch(`${base}/admin/agents/${target.agentId}/role`, { headers: authFor(ADMIN) });
    const { version } = await role.json() as { version: number };
    const patch = (body: unknown) => fetch(`${base}/admin/agents/${target.agentId}/role`, { method: "PATCH", headers: authFor(ADMIN), body: JSON.stringify(body) });

    // 其它官方字段仍锁定（含与 tags 同批提交的情况）。
    const locked = await patch({ agentId: target.agentId, expectedVersion: version, patch: { tags: ["竞品"], roleCategory: "sales" } });
    expect(locked.status).toBe(403);

    const ok = await patch({ agentId: target.agentId, expectedVersion: version, patch: { tags: ["竞品", "行业研究"] } });
    expect(ok.status).toBe(200);
    const view = await ok.json() as { draft: { tags: string[]; catalogSource: string }; editable: boolean };
    expect(view.draft).toMatchObject({ tags: ["竞品", "行业研究"], catalogSource: "official" });
    expect(view.editable).toBe(false);

    // 目录（聊天选人同源 GET /agents/directory）立即可见，无需发布；标签也进搜索。
    const card = await fetch(`${base}/agents/directory/${target.agentId}`, { headers: authFor(MEMBER) });
    expect((await card.json() as { tags: string[] }).tags).toEqual(["竞品", "行业研究"]);
    const searched = await fetch(`${base}/agents/directory?q=${encodeURIComponent("行业研究")}`, { headers: authFor(MEMBER) });
    expect((await searched.json() as { items: { agentId: string }[] }).items.map((c) => c.agentId)).toEqual([target.agentId]);

    // 官方包再次导入（新幂等键）不覆盖；标签回填迁移只填空数组，重跑也不覆盖。
    await postImport(ADMIN, { packId: OFFICIAL_AGENT_ROLE_PACK_ID, packVersion: OFFICIAL_AGENT_ROLE_PACK_VERSION, idempotencyKey: randomUUID() });
    const backfill = readFileSync(join(__dirname, "../../migrations/20260929160000_agent_tags.sql"), "utf8");
    await asOwner((c) => c.query(backfill));
    const again = await fetch(`${base}/agents/directory/${target.agentId}`, { headers: authFor(MEMBER) });
    expect((await again.json() as { tags: string[] }).tags).toEqual(["竞品", "行业研究"]);
  });
});

describe("official role pack offer (GET /agents/official-role-pack/offer — picker 「待启用」)", () => {
  const getOffer = (userId: string) => fetch(`${base}/agents/official-role-pack/offer`, { headers: authFor(userId) });

  it("lists all 7 official roles as pending before import; member sees them but cannot enable", async () => {
    const member = await getOffer(MEMBER);
    expect(member.status).toBe(200);
    const body = await member.json() as { packId: string; packVersion: string; canEnable: boolean; pending: { roleRef: string; avatar: { key: string } | null; tags: string[] }[] };
    expect(body).toMatchObject({ packId: OFFICIAL_AGENT_ROLE_PACK_ID, packVersion: OFFICIAL_AGENT_ROLE_PACK_VERSION, canEnable: false });
    expect(body.pending.map((p) => p.roleRef)).toEqual(["D001", "D002", "D003", "D005", "D006", "D007", "D011"]);
    expect(body.pending.map((p) => p.avatar?.key)).toEqual(Object.values(officialRoleAvatarKeys()));
    expect(body.pending[0]!.tags).toEqual(officialRoleTags()["d001-executive-strategy-partner"]);

    const admin = await (await getOffer(ADMIN)).json() as { canEnable: boolean };
    expect(admin.canEnable).toBe(true);
  });

  it("admin one-click enable (existing import) empties pending; the offer read writes nothing", async () => {
    const before = await counts();
    await getOffer(ADMIN);
    expect(await counts()).toEqual(before);
    const imported = await postImport(ADMIN, { packId: OFFICIAL_AGENT_ROLE_PACK_ID, packVersion: OFFICIAL_AGENT_ROLE_PACK_VERSION, idempotencyKey: randomUUID() });
    expect(imported.status).toBe(201);
    const after = await (await getOffer(MEMBER)).json() as { pending: unknown[] };
    expect(after.pending).toEqual([]);
  });

  it("启用即可用：要约列出所需 Skill 起步包；按序导入它们 + 角色包后，产品线/研究线官方数字人 ready 且有可发起 Workflow", async () => {
    const offer = await (await getOffer(ADMIN)).json() as { requiredSkillPacks: { packId: string; packVersion: string }[] };
    expect(offer.requiredSkillPacks).toEqual(officialRoleSkillPacks().map((p) => ({ ...p })));
    expect(offer.requiredSkillPacks.map((p) => p.packId)).toEqual(expect.arrayContaining(["work-product", "work-research", "work-executive", "work-customer-success", "work-operations", "work-engineering", "work-resolution"]));

    // 启用前：没有任何官方数字人。
    const none = await (await fetch(`${base}/agents/directory`, { headers: authFor(MEMBER) })).json() as { items: unknown[] };
    expect(none.items).toEqual([]);

    // 浮层「一键启用」的同一序列：既有 Skill 起步包导入（幂等键按包坐标固定）→ 角色包导入。
    for (const pack of offer.requiredSkillPacks) {
      const res = await fetch(`${base}/admin/skills/starter-pack-imports`, { method: "POST", headers: authFor(ADMIN), body: JSON.stringify({ ...pack, idempotencyKey: `picker-enable-skill-${pack.packId}@${pack.packVersion}` }) });
      expect(res.status, `${pack.packId}: ${await res.clone().text()}`).toBe(201);
      // 重复点击：同一幂等键回放，不报错。
      const again = await fetch(`${base}/admin/skills/starter-pack-imports`, { method: "POST", headers: authFor(ADMIN), body: JSON.stringify({ ...pack, idempotencyKey: `picker-enable-skill-${pack.packId}@${pack.packVersion}` }) });
      expect(again.status).toBe(200);
    }
    const roles = await postImport(ADMIN, { packId: OFFICIAL_AGENT_ROLE_PACK_ID, packVersion: OFFICIAL_AGENT_ROLE_PACK_VERSION, idempotencyKey: `picker-enable-${OFFICIAL_AGENT_ROLE_PACK_ID}@${OFFICIAL_AGENT_ROLE_PACK_VERSION}` });
    expect(roles.status).toBe(201);

    const cards = (await (await fetch(`${base}/agents/directory`, { headers: authFor(MEMBER) })).json() as { items: { name: string; readiness: string; workflows: { stableId: string; name: string }[] }[] }).items;
    expect(cards.map((c) => c.name).sort()).toEqual(Object.values(officialRoleNames()).sort());
    // 产品线 + 研究线（D001/D002/D003/D006/D007/D011：各有至少一个已发布的产品/研究线 Workflow）：导入即发布 → ready + 可发起非空。销售线（D005）尚无运行时图，
    // 如实仍是 unknown / 无可发起（见 official-role-packs.ts D005 的 skillPacks 注释）。
    const names = officialRoleNames();
    const sales = names["d005-sales-representative"];
    for (const card of cards.filter((c) => c.name !== sales)) {
      expect(card.readiness, card.name).toBe("ready");
      expect(card.workflows.length, `${card.name} 应有可发起的 Workflow`).toBeGreaterThan(0);
    }
    expect(cards.find((c) => c.name === sales)).toMatchObject({ readiness: "unknown", workflows: [] });
    const after = await (await getOffer(MEMBER)).json() as { pending: unknown[] };
    expect(after.pending).toEqual([]);
  }, 120_000);
});

describe("AG07 official delegation backfill migration (20260930121000) + rp-b2 1.5.0 follow-up (20260930141000)", () => {
  const parse = (file: string) => readFileSync(join(__dirname, "../../migrations", file), "utf8");

  it("1.3.0 backfill literal is the historical value (the four roles' targets before D001/D006/D007 existed); the pack no longer matches it", () => {
    const literal = Object.fromEntries([...parse("20260930121000_ag07_official_role_delegation.sql").matchAll(/\('(d\d{3}-[a-z0-9-]+)',\s*'(\{[^']+\})'\)/g)].map((m) => [m[1], JSON.parse(m[2]!) as { allowedTargets: string[]; maxDepth: number; requireApproval: boolean }]));
    expect(Object.keys(literal).sort()).toEqual(LEGACY_ROLES);
    // 历史快照 = 旧四角色互相为目标（只推导自当时的四份白名单）。
    const legacyRefs = { "d002-research-knowledge-analyst": "D002", "d003-product-manager": "D003", "d005-sales-representative": "D005", "d011-design-thinking-expert": "D011" } as const;
    for (const [stable, ref] of Object.entries(legacyRefs)) {
      expect(literal[stable]!.allowedTargets).toEqual(["D002", "D003", "D005", "D011"].filter((r) => r !== ref));
      expect(literal[stable]).toMatchObject({ maxDepth: 1, requireApproval: true });
    }
  });

  it("1.5.0 follow-up migration: old_policy = the 1.3.0 literal, new_policy = officialRoleDelegationTargets() for exactly the four pre-existing roles (SQL literal is a checked copy)", () => {
    const oldLiteral = Object.fromEntries([...parse("20260930121000_ag07_official_role_delegation.sql").matchAll(/\('(d\d{3}-[a-z0-9-]+)',\s*'(\{[^']+\})'\)/g)].map((m) => [m[1], JSON.parse(m[2]!) as unknown]));
    const rows = [...parse("20260930141000_rp_b2_official_role_pack_1_5_0.sql").matchAll(/\('(d\d{3}-[a-z0-9-]+)',\s*'(\{[^']+\})',\s*'(\{[^']+\})'\)/g)];
    const olds = Object.fromEntries(rows.map((m) => [m[1], JSON.parse(m[2]!) as unknown]));
    const news = Object.fromEntries(rows.map((m) => [m[1], JSON.parse(m[3]!) as unknown]));
    expect(Object.keys(news).sort()).toEqual(LEGACY_ROLES);
    expect(olds).toEqual(oldLiteral);
    const fromPack = Object.fromEntries(buildOfficialAgentRolePack().agents.map((a) => [a.stableName, a.role.delegationPolicy]));
    expect(news).toEqual(restrictTo(fromPack, Object.keys(news)));
    for (const p of Object.values(fromPack)) expect(p).toMatchObject({ maxDepth: 1, requireApproval: true });
    expect(buildOfficialAgentRolePack().agents.every((agent) => agent.semanticVersion === OFFICIAL_AGENT_ROLE_PACK_VERSION)).toBe(true);
  });
});
