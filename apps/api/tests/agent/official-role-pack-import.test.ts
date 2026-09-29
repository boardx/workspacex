/**
 * AG03 / UC-3（契约束 `agent-role`，03-agent-role.md R3.3）—— 官方角色包导入。
 *
 * 覆盖 user_visible_behavior：
 *   - 管理员导入后每组织出现 4 个 catalogSource='official' Agent 草稿，workflowAllowlist 逐字
 *     取自 DIGITALHUMAN-COMPOSITION-MATRIX.md（D002/D003/D005/D011），toolPolicy 分类不产生
 *     任何授权（本仓库尚无任何授权/凭证表可写，只断言声明本身落库）。
 *   - 白名单引用未注册 Workflow → 422 UNRESOLVED_WORKFLOW_REF，DB 无新增 agent/agent_version 行。
 *   - 挂载的 skillVersions 无法解析 → 422 UNRESOLVED_SKILL_REF，DB 无新增 agent/agent_version 行。
 *   - 非管理员 → 403，DB 无新增行。
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { buildOfficialAgentRolePack, OFFICIAL_AGENT_ROLE_PACK_ID, OFFICIAL_AGENT_ROLE_PACK_VERSION } from "../../src/domain/agent/official-role-packs";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-ag03-official-roles";
const ADMIN = "u-ag03-admin";
const MEMBER = "u-ag03-member";

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
}

async function roleRows(orgId = ORG): Promise<AgentRoleRow[]> {
  return asApp(orgId, async (client) => {
    const result = await client.query<AgentRoleRow>(
      "SELECT stable_name, catalog_source, role_category, workflow_allowlist, role_label, avatar FROM agents WHERE org_id = $1 ORDER BY stable_name",
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

  writePack(OFFICIAL_AGENT_ROLE_PACK_ID, OFFICIAL_AGENT_ROLE_PACK_VERSION, buildOfficialAgentRolePack());
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
  it("creates 4 catalogSource='official' agent drafts with workflowAllowlist matching the composition matrix, no authorization granted", async () => {
    const response = await postImport(ADMIN, { packId: OFFICIAL_AGENT_ROLE_PACK_ID, packVersion: OFFICIAL_AGENT_ROLE_PACK_VERSION, idempotencyKey: randomUUID() });
    expect(response.status).toBe(201);
    const body = await response.json() as { agentIds: string[]; versionIds: string[] };
    expect(body.agentIds).toHaveLength(4);
    expect(body.versionIds).toHaveLength(4);

    const rows = await roleRows();
    expect(rows.map((r) => r.stable_name)).toEqual([
      "d002-research-knowledge-analyst",
      "d003-product-manager",
      "d005-sales-representative",
      "d011-design-thinking-expert",
    ]);
    for (const row of rows) expect(row.catalog_source).toBe("official");
    expect(rows.find((r) => r.stable_name === "d002-research-knowledge-analyst")).toMatchObject({
      role_category: "research",
      workflow_allowlist: ["W001", "W060", "W009", "W006", "W057"],
      role_label: "Research & Knowledge Analyst",
    });
    expect(rows.find((r) => r.stable_name === "d003-product-manager")?.workflow_allowlist).toEqual(["W027", "W028", "W029", "W030", "W031", "W032"]);
    expect(rows.find((r) => r.stable_name === "d005-sales-representative")?.workflow_allowlist).toEqual(["W011", "W012", "W013", "W014", "W015", "W016", "W018"]);
    expect(rows.find((r) => r.stable_name === "d011-design-thinking-expert")?.workflow_allowlist).toEqual(["W027", "W028", "W029", "W031", "W002"]);

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
