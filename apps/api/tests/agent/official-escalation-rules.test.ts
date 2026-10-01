/**
 * AG06 × 官方角色包 1.3.0 —— 官方数字人开箱带升级规则，升级卡片在产品里可达。
 *
 * 1. 包内规则形状合法、目标只用 requester / org_admin（project_owner 在项目外无人可裁决）。
 * 2. 回填迁移 20260930124000 的字面量 = 包声明（机械核对的副本），且真库上只改仍为包默认值的行。
 * 3. 生产路径：真导入官方包 → 真执行器 → Agent 以 loopback 剧本缺省事项（`LOOPBACK_ESCALATE_MATTER`
 *    缺省「超出职责范围的事项」）调 `escalate_matter` ⇒ run 挂起等发起人；发起人经真路由裁决后 run 续跑。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { HttpException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentRole } from "@repo/contracts";
import { executeQueuedRuns, type ExecuteAgentRunDeps } from "../../src/application/agent-run/execute-run";
import type { ModelCallCompletion, ModelCallInput, ModelCallPort } from "../../src/application/agent-run/ports";
import { importOfficialAgentRolePack } from "../../src/application/agent-import/import-official-agent-role-pack";
import {
  buildOfficialAgentRolePack,
  OFFICIAL_AGENT_ROLE_PACK_ID,
  OFFICIAL_AGENT_ROLE_PACK_VERSION,
  OFFICIAL_ESCALATION_MATTERS,
  officialRoleEscalationPolicies,
} from "../../src/domain/agent/official-role-packs";
import { toOrgId } from "../../src/domain/org-id";
import { PgEscalationStore } from "../../src/infrastructure/agent-interrupts/pg-escalation-store";
import { PgOfficialAgentRolePackImportRepository } from "../../src/infrastructure/agent/pg-official-agent-role-pack-import-repository";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { EscalationDecisionController } from "../../src/interface/controllers/escalation-decision.controller";
import { addOrgMember, addProjectMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatMessage, addChatThread } from "../support/chat-db";

const MIGRATION = join(__dirname, "../../migrations/20260930124000_ag06_official_escalation_rules.sql");
/** dh-ui-gaps 分支 loopback 替身 `[escalate:<reason>]` 剧本的缺省事项名（`LOOPBACK_ESCALATE_MATTER` 未设时）。 */
const LOOPBACK_DEFAULT_MATTER = "超出职责范围的事项";

describe("AG06 官方角色升级规则（包声明）", () => {
  it("七个官方角色都有非空、合契约的升级规则；目标只用 requester / org_admin；事项名不重复", () => {
    const pack = buildOfficialAgentRolePack();
    expect(pack.agents.map((a) => a.roleRef)).toEqual(["D001", "D002", "D003", "D005", "D006", "D007", "D011"]);
    for (const a of pack.agents) {
      const policy = agentRole.EscalationPolicy.parse(a.role.escalationPolicy);
      expect(policy.rules.length).toBeGreaterThan(0);
      expect(new Set(policy.rules.map((r) => r.matter)).size).toBe(policy.rules.length);
      for (const r of policy.rules) expect(["requester", "org_admin"]).toContain(r.target);
      expect(policy.rules).toContainEqual({ matter: OFFICIAL_ESCALATION_MATTERS.outOfScope, target: "requester" });
      expect(policy.rules).toContainEqual({ matter: OFFICIAL_ESCALATION_MATTERS.dataDeletion, target: "org_admin" });
    }
    const sales = pack.agents.find((a) => a.stableName === "d005-sales-representative")!;
    expect(sales.role.escalationPolicy.rules).toContainEqual({ matter: OFFICIAL_ESCALATION_MATTERS.pricing, target: "org_admin" });
    // D006（rp-b2）：退款/补偿承诺、疑似安全或数据泄露 → org_admin。
    const cs = pack.agents.find((a) => a.stableName === "d006-customer-success-specialist")!;
    expect(cs.role.escalationPolicy.rules).toContainEqual({ matter: OFFICIAL_ESCALATION_MATTERS.refundOrCompensation, target: "org_admin" });
    expect(cs.role.escalationPolicy.rules).toContainEqual({ matter: OFFICIAL_ESCALATION_MATTERS.securityOrDataLeak, target: "org_admin" });
    // D001 / D007 各两条新增事项（矩阵文档 §4）。
    const exec = pack.agents.find((a) => a.stableName === "d001-executive-strategy-partner")!;
    expect(exec.role.escalationPolicy.rules).toContainEqual({ matter: OFFICIAL_ESCALATION_MATTERS.nonPublicDisclosure, target: "org_admin" });
    expect(exec.role.escalationPolicy.rules).toContainEqual({ matter: OFFICIAL_ESCALATION_MATTERS.boardOrRegulatorFinalization, target: "requester" });
    const ops = pack.agents.find((a) => a.stableName === "d007-project-operations-manager")!;
    expect(ops.role.escalationPolicy.rules).toContainEqual({ matter: OFFICIAL_ESCALATION_MATTERS.approvedBaselineEdit, target: "requester" });
    expect(ops.role.escalationPolicy.rules).toContainEqual({ matter: OFFICIAL_ESCALATION_MATTERS.incidentSeverityOrNotice, target: "org_admin" });
  });

  it("loopback 替身的缺省事项名命中官方规则（升级卡片在回环模型上对官方数字人可达）", () => {
    expect(OFFICIAL_ESCALATION_MATTERS.outOfScope).toBe(LOOPBACK_DEFAULT_MATTER);
  });

  it("回填迁移的 stableName → escalationPolicy 字面量 = 包声明（SQL 字面量是被核对的副本）", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const literal = Object.fromEntries([...sql.matchAll(/\('(d\d{3}-[a-z0-9-]+)',\s*'(\{[^']+\})'\)/g)].map((m) => [m[1], JSON.parse(m[2]!) as unknown]));
    const fromPack = Object.fromEntries(buildOfficialAgentRolePack().agents.map((a) => [a.stableName, a.role.escalationPolicy]));
    // 1.3.0 迁移只覆盖当时的四个官方角色；新增角色（D001/D006/D007）随导入带规则，没有旧行可回填。
    expect(Object.keys(literal).sort()).toEqual(["d002-research-knowledge-analyst", "d003-product-manager", "d005-sales-representative", "d011-design-thinking-expert"]);
    expect(literal).toEqual(Object.fromEntries(Object.keys(literal).map((k) => [k, fromPack[k]])));
    expect(fromPack).toEqual(officialRoleEscalationPolicies());
  });
});

describe("AG06 官方数字人升级：真导入 + 真执行器 + 真路由；回填迁移只改默认值行", () => {
  const ORG = toOrgId("org-ag06-official-esc");
  const PROJECT = "proj-ag06-official-esc";
  const ADMIN = "u-ag06-off-admin";
  const REQUESTER = "u-ag06-off-requester";
  const OTHER = "u-ag06-off-other";
  let db: PgDatabase;
  let runs: PgAgentRunRepository;
  let controller: EscalationDecisionController;
  const calls: ModelCallInput[] = [];
  let script: ModelCallCompletion[] = [];
  const model: ModelCallPort = {
    async complete(input) { calls.push(input); const n = script.shift(); if (!n) throw new Error("unexpected model call"); return n; },
  };

  beforeAll(async () => {
    ensureDatabase();
    await migrateOnce();
    db = new PgDatabase(appConfig());
    runs = new PgAgentRunRepository(db);
    controller = new EscalationDecisionController(new PgEscalationStore(db), runs, { kick: () => {} } as never);
    await resetOrgs(ORG);
    await seedOrg({ orgId: ORG, projectId: PROJECT });
    await addOrgMember(ORG, ADMIN, "admin", null);
    await addOrgMember(ORG, REQUESTER, "consultant", null);
    await addProjectMember(ORG, PROJECT, REQUESTER, "member", null);
    await addOrgMember(ORG, OTHER, "consultant", null);
    await addProjectMember(ORG, PROJECT, OTHER, "member", null);
    const pack = buildOfficialAgentRolePack();
    await importOfficialAgentRolePack(
      {
        identities: new PgIdentityRepository(db),
        packs: { load: async () => pack } as never,
        workflows: { isRegistered: async () => true, workflowName: async () => null } as never,
        imports: new PgOfficialAgentRolePackImportRepository(db),
      },
      { actorId: ADMIN, orgId: ORG, packId: OFFICIAL_AGENT_ROLE_PACK_ID, packVersion: OFFICIAL_AGENT_ROLE_PACK_VERSION, idempotencyKey: randomUUID() },
    );
  }, 120_000);

  afterAll(async () => {
    await resetOrgs(ORG);
    await db?.close();
  });

  async function official(stableName: string) {
    return asApp(ORG, async (c) => (await c.query<{ agent_id: string; version_id: string; draft: unknown; published: unknown }>(
      `SELECT a.id AS agent_id, a.published_version_id AS version_id, a.escalation_policy AS draft, v.escalation_policy AS published
         FROM agents a JOIN agent_versions v ON v.id = a.published_version_id AND v.org_id = a.org_id
        WHERE a.org_id = $1 AND a.stable_name = $2`, [ORG, stableName])).rows[0]!);
  }

  async function setPolicy(stableName: string, policy: unknown): Promise<void> {
    await asOwner(async (c) => {
      await c.query("BEGIN");
      await c.query("ALTER TABLE agent_versions DISABLE TRIGGER agent_versions_immutable_trg");
      await c.query(
        `UPDATE agent_versions v SET escalation_policy = $3::jsonb FROM agents a
          WHERE v.agent_id = a.id AND v.org_id = a.org_id AND a.org_id = $1 AND a.stable_name = $2`, [ORG, stableName, JSON.stringify(policy)]);
      await c.query("ALTER TABLE agent_versions ENABLE TRIGGER agent_versions_immutable_trg");
      await c.query("UPDATE agents SET escalation_policy = $3::jsonb WHERE org_id = $1 AND stable_name = $2", [ORG, stableName, JSON.stringify(policy)]);
      await c.query("COMMIT");
    });
  }

  it("导入后草稿与发布快照都带包声明的规则", async () => {
    const d005 = await official("d005-sales-representative");
    const expected = officialRoleEscalationPolicies()["d005-sales-representative"];
    expect(d005.draft).toEqual(expected);
    expect(d005.published).toEqual(expected);
  });

  it("回填迁移：仍为空规则的官方行 ⇒ 补上包规则（草稿 + 快照）；管理员改过的 ⇒ 不碰；重复执行无副作用", async () => {
    const custom = { rules: [{ matter: "管理员自定义事项", target: "org_admin" }] };
    await setPolicy("d005-sales-representative", { rules: [] });
    await setPolicy("d003-product-manager", custom);
    const sql = readFileSync(MIGRATION, "utf8");
    for (let i = 0; i < 2; i += 1) {
      await asOwner(async (c) => { await c.query("BEGIN"); await c.query(sql); await c.query("COMMIT"); });
    }
    const d005 = await official("d005-sales-representative");
    expect(d005.draft).toEqual(officialRoleEscalationPolicies()["d005-sales-representative"]);
    expect(d005.published).toEqual(officialRoleEscalationPolicies()["d005-sales-representative"]);
    const d003 = await official("d003-product-manager");
    expect(d003.draft).toEqual(custom);
    expect(d003.published).toEqual(custom);
    await setPolicy("d003-product-manager", officialRoleEscalationPolicies()["d003-product-manager"]);
  });

  it("官方 D005 调 escalate_matter（loopback 缺省事项）⇒ 挂起等发起人；非目标 404，发起人裁决后同一 run 续跑", async () => {
    const d005 = await official("d005-sales-representative");
    const runId = "run-ag06-official-esc";
    const thread = `thr-${runId}`;
    await addChatThread({ orgId: ORG, id: thread, projectId: PROJECT, visibilityScope: "plenary", createdBy: REQUESTER });
    await addChatMessage({ orgId: ORG, id: `${runId}-in`, threadId: thread, body: "帮我写一份竞品对比 [escalate:这不是销售职责]", authorId: REQUESTER });
    await asApp(ORG, (c) => c.query(
      `INSERT INTO agent_runs (id, org_id, thread_id, input_message_id, agent_id, agent_version_id, skill_version_ids, model_provider, model_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,'[]'::jsonb,'deep-agent','deep-agent','queued')`,
      [runId, ORG, thread, `${runId}-in`, d005.agent_id, d005.version_id]));
    let n = 0;
    const deps = { runs, model, log: () => {}, clock: { now: () => new Date().toISOString(), newStepId: () => `s-${runId}-${n++}` } } as unknown as ExecuteAgentRunDeps;
    // 参数与 loopback 剧本 `[escalate:<reason>]` 发出的形状逐字相同（matter = 缺省事项，target 自报会被忽略）。
    script = [{ text: "", interrupted: { toolName: "escalate_matter", toolCallId: "call-esc", argsSummary: JSON.stringify({ matter: LOOPBACK_DEFAULT_MATTER, reason: "这不是销售职责", target: "org_admin", contextRefs: [] }) } }];
    calls.length = 0;
    await executeQueuedRuns(deps, { orgId: ORG });
    const pending = await asApp(ORG, async (c) => (await c.query<{ status: string; pending_tool_name: string | null; pending_args_summary: string | null; pending_permission_request_id: string | null }>(
      "SELECT status, pending_tool_name, pending_args_summary, pending_permission_request_id FROM agent_runs WHERE id=$1", [runId])).rows[0]!);
    expect(pending.status).toBe("awaiting_tool_permission");
    expect(pending.pending_tool_name).toBe("escalate_matter");
    expect(JSON.parse(pending.pending_args_summary!)).toMatchObject({ matter: LOOPBACK_DEFAULT_MATTER, target: "requester" });

    const interruptId = pending.pending_permission_request_id!;
    const decision = { decision: "resolve", decisionText: "可以，写完发我" };
    // 该规则目标 = 发起人：组织管理员与其他成员都不是目标，也不是请求人 ⇒ 与「不存在」同一个 404（防探测）。
    expect((await decide(ADMIN, interruptId, { interruptId, decision })).status).toBe(404);
    expect((await decide(OTHER, interruptId, { interruptId, decision })).status).toBe(404);
    expect((await decide(REQUESTER, interruptId, { interruptId, decision })).status).toBe(200);
    script = [{ text: "好的，按你的裁决继续。" }];
    await executeQueuedRuns(deps, { orgId: ORG });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.resume).toEqual({ decision: "edit", editedAction: { name: "escalate_matter", argsJson: JSON.stringify(decision) } });
  });

  async function decide(userId: string, interruptId: string, body: unknown): Promise<{ status: number }> {
    try {
      await controller.decide({ userId, orgId: ORG }, interruptId, body);
      return { status: 200 };
    } catch (e) {
      if (e instanceof HttpException) return { status: e.getStatus() };
      throw e;
    }
  }
});
