/**
 * AG01 —— 角色冻结字段进入版本快照 + agent_versions 迁移回填（03-agent-role.md R3 ①/⑤）。
 *
 * 三部分：
 *   ① domain 快照冻结新字段且与草稿解耦；
 *   ② 迁移：两张表 7 列的列默认值逐字等于 AGENT_ROLE_FIELD_DEFAULTS（从 information_schema 读出求值），
 *      CHECK 与契约 safeParse 对同一组样本判定一致，DB 比契约宽的部分被钉住；
 *   ③ 产品路径：createAgent → updateAgentRoleDraft（真库仓储）→ 自助发布 → 读 agent_versions，
 *      以及 UC-1 的错误路径（ROLE_INSUFFICIENT / OFFICIAL_ROLE_FIELDS_LOCKED / VERSION_CHANGED /
 *      VALIDATION_FAILED）与「改草稿不影响已发布版本」。
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agentRole as R } from "@repo/contracts";
import type { AgentDefinition } from "../../src/domain/agent/definition";
import { SNAPSHOT_FROZEN_FIELDS, freezeAgentVersion } from "../../src/domain/agent/version-snapshot";
import { cloneAgentDefinition } from "../../src/domain/agent/clone";
import { agent } from "../capability/agent/fixtures";
import { asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import {
  PgCreateAgentRepository,
  PgSetAgentInstructionsRepository,
} from "../../src/infrastructure/agent/pg-create-agent-repository";
import { PgAgentRoleDraftRepository } from "../../src/infrastructure/agent/pg-agent-role-draft-repository";
import { PgSelfPublishAgentRepository } from "../../src/infrastructure/agent/pg-self-publish-agent-repository";
import { createAgent } from "../../src/application/agent/create-agent";
import { setAgentInstructions } from "../../src/application/agent/set-agent-instructions";
import { selfPublishToollessAgent } from "../../src/application/agent/self-publish-toolless-agent";
import { updateAgentRoleDraft } from "../../src/application/agent/update-agent-role-draft";

const role = {
  avatar: { kind: "illustration", key: "robot", alt: "研究员" },
  roleCategory: "research",
  catalogSource: "official",
  workflowAllowlist: ["W001", "W060"],
  delegationPolicy: { allowedTargets: ["D003"], maxDepth: 1, requireApproval: true },
  escalationPolicy: { rules: [{ matter: "预算超限", target: "org_admin" }] },
  kpi: [{ metric: "research.cycle_time", description: "单次调研周期" }],
} as const satisfies R.AgentRoleFields;

function draft(): AgentDefinition {
  return agent(structuredClone(role) as unknown as Partial<AgentDefinition>);
}

describe("AG01 snapshot freezes role fields", () => {
  it("every contract role field is in SNAPSHOT_FROZEN_FIELDS", () => {
    for (const f of R.AGENT_ROLE_FROZEN_FIELDS) expect(SNAPSHOT_FROZEN_FIELDS).toContain(f);
  });

  it("published snapshot JSON carries all new fields", () => {
    const snap = freezeAgentVersion(draft(), { agentVersionId: "av-1", frozenAt: "2026-09-28T00:00:00Z" });
    const json = JSON.parse(JSON.stringify(snap)) as { definition: Record<string, unknown> };
    for (const f of R.AGENT_ROLE_FROZEN_FIELDS) expect(json.definition[f]).toEqual(role[f]);
  });

  it("editing the draft after publish does not change the snapshot", () => {
    const d = draft() as { -readonly [K in keyof AgentDefinition]: AgentDefinition[K] };
    const snap = freezeAgentVersion(d, { agentVersionId: "av-2", frozenAt: "2026-09-28T00:00:00Z" });
    (d.workflowAllowlist as string[]).push("W999");
    d.delegationPolicy.allowedTargets.push("D099");
    d.escalationPolicy.rules.push({ matter: "x", target: "requester" });
    d.kpi.push({ metric: "x", description: "x" });
    (d.avatar as { alt: string }).alt = "changed";
    d.catalogSource = "org";
    expect(snap.definition.workflowAllowlist).toEqual(role.workflowAllowlist);
    expect(snap.definition.delegationPolicy).toEqual(role.delegationPolicy);
    expect(snap.definition.escalationPolicy).toEqual(role.escalationPolicy);
    expect(snap.definition.kpi).toEqual(role.kpi);
    expect(snap.definition.avatar).toEqual(role.avatar);
    expect(snap.definition.catalogSource).toBe("official");
  });

  it("snapshot role fields are deeply frozen", () => {
    const snap = freezeAgentVersion(draft(), { agentVersionId: "av-3", frozenAt: "2026-09-28T00:00:00Z" });
    expect(() => (snap.definition.workflowAllowlist as string[]).push("W002")).toThrow();
    expect(() => (snap.definition.delegationPolicy.allowedTargets as string[]).push("D004")).toThrow();
    expect(() => { (snap.definition.kpi[0] as { metric: string }).metric = "y"; }).toThrow();
  });

  it("a clone cannot inherit catalogSource=official", () => {
    expect(cloneAgentDefinition(draft(), { agentId: "agt-copy" }).catalogSource).toBe("org");
  });
});

const ORG = "org-ag01-frozen";
const ROLE_COLS = [
  ["avatar", "avatar"], ["roleCategory", "role_category"], ["catalogSource", "catalog_source"],
  ["workflowAllowlist", "workflow_allowlist"], ["delegationPolicy", "delegation_policy"],
  ["escalationPolicy", "escalation_policy"], ["kpi", "kpi"],
] as const;
const SELECT_ROLE = ROLE_COLS.map(([, c]) => c).join(",");

function rowToFields(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(ROLE_COLS.map(([f, c]) => [f, row[c]]));
}

describe("AG01 agent_versions / agents migration", () => {
  beforeAll(async () => {
    ensureDatabase();
    await migrateOnce();
  });
  beforeEach(async () => {
    await resetOrgs(ORG);
    await seedOrg({ orgId: ORG, projectId: "proj-ag01" });
  });

  async function insertAgent(id: string): Promise<void> {
    await asOwner((c) => c.query(
      `INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
       VALUES ($1,$2,$1,$1,'enabled','u',now(),now()) ON CONFLICT DO NOTHING`, [id, ORG]));
  }

  async function insertVersion(id: string, extraCols = "", extraVals: unknown[] = []): Promise<void> {
    await insertAgent(`agt-${id}`);
    await asOwner(async (c) => {
      const base = [id, ORG, `agt-${id}`, "1.0.0", "a".repeat(64), "i", "{}", "p", "m", "[]", "u"];
      const ph = [...base, ...extraVals].map((_, i) => `$${i + 1}`).join(",");
      await c.query(
        `INSERT INTO agent_versions (id,org_id,agent_id,semantic_label,instruction_digest,instructions,
           skill_version_ids,model_provider,model_id,tool_policy,creator_id${extraCols},created_at,published_at)
         VALUES (${ph},now(),now())`, [...base, ...extraVals]);
    });
  }

  it("column defaults of both tables are, verbatim, AGENT_ROLE_FIELD_DEFAULTS", async () => {
    for (const table of ["agents", "agent_versions"]) {
      const defaults = await asOwner(async (c) => (await c.query<{ column_name: string; column_default: string | null }>(
        `SELECT column_name, column_default FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = $1 AND column_name = ANY($2::text[])`,
        [table, ROLE_COLS.map(([, col]) => col)])).rows);
      expect(defaults).toHaveLength(ROLE_COLS.length);
      const evaluated: Record<string, unknown> = {};
      for (const { column_name, column_default } of defaults) {
        evaluated[column_name] = column_default === null
          ? null
          : await asOwner(async (c) => (await c.query(`SELECT (${column_default}) AS v`)).rows[0].v);
      }
      expect(rowToFields(evaluated)).toEqual(R.AGENT_ROLE_FIELD_DEFAULTS);
    }
  });

  it("legacy-shaped insert is backfilled with the contract defaults", async () => {
    await insertVersion("av-legacy");
    const row = await asOwner(async (c) => (await c.query(
      `SELECT ${SELECT_ROLE} FROM agent_versions WHERE id='av-legacy'`)).rows[0]);
    expect(rowToFields(row)).toEqual(R.AGENT_ROLE_FIELD_DEFAULTS);
  });

  it("role_category / catalog_source CHECKs agree with the contract enums", async () => {
    const cats = [...R.AgentRoleCategory.options, "astrology"];
    for (const [i, cat] of cats.entries()) {
      const ok = R.AgentRoleCategory.safeParse(cat).success;
      const p = insertVersion(`av-cat-${i}`, ",role_category", [cat]);
      if (ok) await expect(p).resolves.toBeUndefined(); else await expect(p).rejects.toThrow(/check/i);
    }
    const srcs = [...R.AgentCatalogSource.options, "vendor"];
    for (const [i, src] of srcs.entries()) {
      const ok = R.AgentCatalogSource.safeParse(src).success;
      const p = insertVersion(`av-src-${i}`, ",catalog_source", [src]);
      if (ok) await expect(p).resolves.toBeUndefined(); else await expect(p).rejects.toThrow(/check/i);
    }
  });

  /** 对同一个样本：契约 safeParse 与两张表的 CHECK 判定必须一致。 */
  const d = R.AGENT_ROLE_FIELD_DEFAULTS;
  const avatar = (key: string) => ({ kind: "illustration", key, alt: "头像" });
  const parity: Array<[string, Record<string, unknown>]> = [
    ...R.AgentAvatar.shape.key.options.map((k): [string, Record<string, unknown>] => [`avatar ${k}`, { avatar: avatar(k) }]),
    ["avatar person-25", { avatar: avatar("person-25") }],
    ["avatar svg", { avatar: avatar("<svg/>") }],
    ["avatar kind artifact", { avatar: { kind: "artifact", key: "robot", alt: "x" } }],
    ["workflow W001,W060", { workflowAllowlist: ["W001", "W060"] }],
    ["workflow w001", { workflowAllowlist: ["w001"] }],
    ["workflow W1", { workflowAllowlist: ["W1"] }],
    ["workflow W0001", { workflowAllowlist: ["W0001"] }],
    ["workflow 65 items", { workflowAllowlist: Array.from({ length: 65 }, (_, i) => `W${String(i).padStart(3, "0")}`) }],
    ...[0, 1, 2, 3, -1, 1.5].map((n): [string, Record<string, unknown>] => [`maxDepth ${n}`, { delegationPolicy: { ...d.delegationPolicy, maxDepth: n } }]),
    ["target D003", { delegationPolicy: { ...d.delegationPolicy, allowedTargets: ["D003"] } }],
    ["target agent-x", { delegationPolicy: { ...d.delegationPolicy, allowedTargets: ["agent-x"] } }],
    ["target number", { delegationPolicy: { ...d.delegationPolicy, allowedTargets: [3] } }],
    ["requireApproval string", { delegationPolicy: { ...d.delegationPolicy, requireApproval: "yes" } }],
    ...[...R.EscalationTarget.options, "ceo"].map((t): [string, Record<string, unknown>] => [`escalate ${t}`, { escalationPolicy: { rules: [{ matter: "m", target: t }] } }]),
    ["escalation rules object", { escalationPolicy: { rules: {} } }],
    ["kpi object", { kpi: {} }],
    ["kpi 17 items", { kpi: Array.from({ length: 17 }, (_, i) => ({ metric: `m${i}`, description: "x" })) }],
  ];

  async function dbAccepts(table: "agents" | "agent_versions", id: string, f: Record<string, unknown>): Promise<boolean> {
    const vals = ROLE_COLS.map(([k, c]) => (c === "workflow_allowlist" ? f[k]
      : f[k] === null || c === "role_category" || c === "catalog_source" ? f[k] : JSON.stringify(f[k])));
    const cols = ROLE_COLS.map(([, c]) => c);
    try {
      if (table === "agents") {
        await insertAgent(id);
        await asOwner((c) => c.query(
          `UPDATE agents SET ${cols.map((col, i) => `${col}=$${i + 2}`).join(",")} WHERE id=$1`, [id, ...vals]));
      } else {
        await insertVersion(id, `,${cols.join(",")}`, vals);
      }
      return true;
    } catch (e) {
      if (/check|violates/i.test(String(e))) return false;
      throw e;
    }
  }

  it("agents and agent_versions CHECKs agree with the contract on every sample", async () => {
    for (const [i, [label, over]] of parity.entries()) {
      const fields = { ...d, ...over };
      const contract = R.AgentRoleFields.safeParse(fields).success;
      expect({ label, table: "agents", ok: await dbAccepts("agents", `agt-par-${i}`, fields) })
        .toEqual({ label, table: "agents", ok: contract });
      expect({ label, table: "agent_versions", ok: await dbAccepts("agent_versions", `av-par-${i}`, fields) })
        .toEqual({ label, table: "agent_versions", ok: contract });
    }
  });

  it("pins where the DB is deliberately wider than the contract (Zod guards the write path)", async () => {
    const wider: Array<[string, Record<string, unknown>]> = [
      ["avatar alt too long", { avatar: { kind: "illustration", key: "robot", alt: "x".repeat(121) } }],
      ["avatar extra key", { avatar: { kind: "illustration", key: "robot", alt: "x", svg: "<svg/>" } }],
      ["kpi metric uppercase", { kpi: [{ metric: "Bad Metric", description: "x" }] }],
      ["escalation matter empty", { escalationPolicy: { rules: [{ matter: "", target: "requester" }] } }],
    ];
    for (const [i, [label, over]] of wider.entries()) {
      const fields = { ...d, ...over };
      expect({ label, contract: R.AgentRoleFields.safeParse(fields).success }).toEqual({ label, contract: false });
      expect({ label, db: await dbAccepts("agents", `agt-wide-${i}`, fields) }).toEqual({ label, db: true });
    }
  });

  it("published role columns stay immutable", async () => {
    await insertVersion("av-imm", ",workflow_allowlist", [["W001"]]);
    await expect(asOwner((c) => c.query(
      "UPDATE agent_versions SET workflow_allowlist='{W002}' WHERE id='av-imm'"))).rejects.toThrow(/immutable/);
  });
});

describe("AG01 product path: updateAgentRoleDraft → publish → agent_versions", () => {
  const ADMIN_ID = "u-ag01-admin";
  const MEMBER_ID = "u-ag01-member";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const identities: any = {
    findOrgMembership: async (userId: string) =>
      userId === ADMIN_ID ? { orgRole: "admin" } : userId === MEMBER_ID ? { orgRole: "member" } : null,
  };
  let db: PgDatabase;
  let agents: PgCreateAgentRepository;
  let roles: PgAgentRoleDraftRepository;

  beforeAll(async () => {
    ensureDatabase();
    await migrateOnce();
    db = new PgDatabase(appConfig());
    agents = new PgCreateAgentRepository(db);
    roles = new PgAgentRoleDraftRepository(db);
  });
  beforeEach(async () => {
    await resetOrgs(ORG);
    await seedOrg({ orgId: ORG, projectId: "proj-ag01" });
  });

  async function newDraft(): Promise<string> {
    const def = await createAgent(
      { orgId: ORG, actorId: ADMIN_ID, name: `研究员-${Math.random().toString(36).slice(2, 8)}`,
        initials: "研", role: "调研", roleLabel: "研究员", visibility: "全组织可用", cloneFrom: null, source: "self" },
      { identities, repository: agents },
    );
    await setAgentInstructions(
      { orgId: ORG, actorId: ADMIN_ID, agentId: def.agentId, instructions: "整理要点。" },
      { identities, repository: new PgSetAgentInstructionsRepository(db) },
    );
    return def.agentId;
  }

  const patch = {
    avatar: role.avatar, roleCategory: role.roleCategory, workflowAllowlist: [...role.workflowAllowlist],
    delegationPolicy: structuredClone(role.delegationPolicy), escalationPolicy: structuredClone(role.escalationPolicy),
    kpi: structuredClone(role.kpi),
  } as unknown as Parameters<typeof updateAgentRoleDraft>[0]["patch"];
  const expectedOrg = { ...structuredClone(role), catalogSource: "org" };

  async function versionRow(versionId: string): Promise<Record<string, unknown>> {
    return asOwner(async (c) => rowToFields((await c.query(
      `SELECT ${SELECT_ROLE} FROM agent_versions WHERE id=$1`, [versionId])).rows[0]));
  }

  it("draft edit persists, publish freezes all 7 fields, later draft edits leave the version alone", async () => {
    const agentId = await newDraft();
    const view = await updateAgentRoleDraft(
      { orgId: ORG, actorId: ADMIN_ID, agentId, expectedVersion: 0, patch }, { identities, repository: roles });
    expect(R.AgentRoleAdminView.parse(view)).toMatchObject({ draft: expectedOrg, published: null, editable: true, version: 1 });
    // 草稿真的落库：新连接读回，不是用例内存里的值。
    expect((await agents.findForClone(ORG, agentId))).toMatchObject(expectedOrg);

    const { agentVersionId } = await selfPublishToollessAgent(
      { orgId: ORG, actorId: ADMIN_ID, agentId }, { identities, repository: new PgSelfPublishAgentRepository(db) });
    expect(await versionRow(agentVersionId)).toEqual(expectedOrg);

    const after = await updateAgentRoleDraft(
      { orgId: ORG, actorId: ADMIN_ID, agentId, expectedVersion: 1,
        patch: { workflowAllowlist: ["W999"], roleCategory: "sales", avatar: null } },
      { identities, repository: roles });
    expect(after.draft).toMatchObject({ workflowAllowlist: ["W999"], roleCategory: "sales", avatar: null });
    expect(after.published).toEqual(expectedOrg);
    expect(await versionRow(agentVersionId)).toEqual(expectedOrg);
  });

  it("non-admin → ROLE_INSUFFICIENT, nothing written", async () => {
    const agentId = await newDraft();
    await expect(updateAgentRoleDraft(
      { orgId: ORG, actorId: MEMBER_ID, agentId, expectedVersion: 0, patch }, { identities, repository: roles }))
      .rejects.toMatchObject({ code: "ROLE_INSUFFICIENT" });
    expect((await roles.find(ORG, agentId))?.draft).toEqual(R.AGENT_ROLE_FIELD_DEFAULTS);
  });

  it("unknown agent → AGENT_NOT_FOUND", async () => {
    await expect(updateAgentRoleDraft(
      { orgId: ORG, actorId: ADMIN_ID, agentId: "agent-missing", expectedVersion: 0, patch }, { identities, repository: roles }))
      .rejects.toMatchObject({ code: "AGENT_NOT_FOUND" });
  });

  it("catalogSource=official → OFFICIAL_ROLE_FIELDS_LOCKED, nothing written", async () => {
    const agentId = await newDraft();
    await asOwner((c) => c.query("UPDATE agents SET catalog_source='official' WHERE id=$1", [agentId]));
    await expect(updateAgentRoleDraft(
      { orgId: ORG, actorId: ADMIN_ID, agentId, expectedVersion: 0, patch }, { identities, repository: roles }))
      .rejects.toMatchObject({ code: "OFFICIAL_ROLE_FIELDS_LOCKED" });
    expect((await roles.find(ORG, agentId))?.draft).toEqual({ ...R.AGENT_ROLE_FIELD_DEFAULTS, catalogSource: "official" });
  });

  it("stale expectedVersion → VERSION_CHANGED; repository write is conditional too", async () => {
    const agentId = await newDraft();
    await updateAgentRoleDraft(
      { orgId: ORG, actorId: ADMIN_ID, agentId, expectedVersion: 0, patch: { roleCategory: "design" } },
      { identities, repository: roles });
    await expect(updateAgentRoleDraft(
      { orgId: ORG, actorId: ADMIN_ID, agentId, expectedVersion: 0, patch }, { identities, repository: roles }))
      .rejects.toMatchObject({ code: "VERSION_CHANGED" });
    // 读后被改的窗口：仓储条件写本身拒绝旧版本号。
    await expect(roles.save({ orgId: ORG, agentId, expectedVersion: 0, fields: R.AGENT_ROLE_FIELD_DEFAULTS }))
      .resolves.toBeNull();
    expect((await roles.find(ORG, agentId))?.draft.roleCategory).toBe("design");
  });

  it("contract-invalid merge → VALIDATION_FAILED, nothing written", async () => {
    const agentId = await newDraft();
    const bad = { delegationPolicy: { allowedTargets: [], maxDepth: 5, requireApproval: true } };
    await expect(updateAgentRoleDraft(
      { orgId: ORG, actorId: ADMIN_ID, agentId, expectedVersion: 0, patch: bad }, { identities, repository: roles }))
      .rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect((await roles.find(ORG, agentId))?.version).toBe(0);
  });
});
