/**
 * AG01 —— 角色冻结字段进入版本快照 + agent_versions 迁移回填（03-agent-role.md R3 ①/⑤）。
 *
 * 两半都要：domain 快照冻结新字段且与草稿解耦；DB 列存在、旧行按契约默认值回填、
 * CHECK 判定与契约 enum 一致。
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agentRole as R } from "@repo/contracts";
import type { AgentDefinition } from "../../src/domain/agent/definition";
import { SNAPSHOT_FROZEN_FIELDS, freezeAgentVersion } from "../../src/domain/agent/version-snapshot";
import { cloneAgentDefinition } from "../../src/domain/agent/clone";
import { agent } from "../capability/agent/fixtures";
import { asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

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

describe("AG01 agent_versions migration", () => {
  beforeAll(async () => {
    ensureDatabase();
    await migrateOnce();
  });
  beforeEach(async () => {
    await resetOrgs(ORG);
    await seedOrg({ orgId: ORG, projectId: "proj-ag01" });
  });

  async function insertVersion(id: string, extraCols = "", extraVals: unknown[] = []): Promise<void> {
    await asOwner(async (c) => {
      await c.query(
        `INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
         VALUES ($1,$2,$1,$1,'enabled','u',now(),now()) ON CONFLICT DO NOTHING`, [`agt-${id}`, ORG]);
      const base = [id, ORG, `agt-${id}`, "1.0.0", "a".repeat(64), "i", "{}", "p", "m", "[]", "u"];
      const ph = [...base, ...extraVals].map((_, i) => `$${i + 1}`).join(",");
      await c.query(
        `INSERT INTO agent_versions (id,org_id,agent_id,semantic_label,instruction_digest,instructions,
           skill_version_ids,model_provider,model_id,tool_policy,creator_id${extraCols},created_at,published_at)
         VALUES (${ph},now(),now())`, [...base, ...extraVals]);
    });
  }

  it("legacy-shaped insert is backfilled with the contract defaults", async () => {
    await insertVersion("av-legacy");
    const row = await asOwner(async (c) => (await c.query(
      `SELECT avatar,role_category,catalog_source,workflow_allowlist,delegation_policy,escalation_policy,kpi
         FROM agent_versions WHERE id='av-legacy'`)).rows[0]);
    const d = R.AGENT_ROLE_FIELD_DEFAULTS;
    expect(row).toEqual({
      avatar: d.avatar,
      role_category: d.roleCategory,
      catalog_source: d.catalogSource,
      workflow_allowlist: d.workflowAllowlist,
      delegation_policy: d.delegationPolicy,
      escalation_policy: d.escalationPolicy,
      kpi: d.kpi,
    });
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

  it("published role columns stay immutable", async () => {
    await insertVersion("av-imm", ",workflow_allowlist", [["W001"]]);
    await expect(asOwner((c) => c.query(
      "UPDATE agent_versions SET workflow_allowlist='{W002}' WHERE id='av-imm'"))).rejects.toThrow(/immutable/);
  });
});
