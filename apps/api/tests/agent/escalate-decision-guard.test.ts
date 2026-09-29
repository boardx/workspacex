/**
 * AG06 —— escalate 中断经 decision-guard 校验 kind 与决策人身份（03-agent-role.md R3 ⑧、E6、E7）。
 *
 * 1. 纯 guard：kind / 身份 / 错形载荷的判定顺序。
 * 2. 真库 + 真路由（`EscalationDecisionController` → `decideEscalation` → `PgEscalationStore`
 *    / `PgAgentRunRepository`）：命中 policy 的 run 挂起；决策人集合从持久化的 pending 中断与
 *    版本 policy 解析；非目标人 403、错形载荷 INTERRUPT_KIND_MISMATCH、目标人裁决后 run 恢复。
 * 3. E7：真实超时路径（`sweepOrphanedRuns`）跑过之后，过期的 escalate 中断仍 pending、无裁决落账。
 * 4. `pg-escalation-store.ts` 的豁免条件（lint-permission-paths 条目）。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HttpException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { guardAgentInterruptDecision, type DecisionGuardInput } from "../../src/application/agent-interrupts/decision-guard";
import { parseEscalateResumePayload } from "../../src/application/agent-interrupts/escalate-decision";
import { raiseEscalation } from "../../src/application/agent-interrupts/decide-escalation";
import { toOrgId } from "../../src/domain/org-id";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import { PgEscalationStore } from "../../src/infrastructure/agent-interrupts/pg-escalation-store";
import { sweepOrphanedRuns } from "../../src/infrastructure/agent-run/sweep-orphaned-runs";
import { EscalationDecisionController } from "../../src/interface/controllers/escalation-decision.controller";
import { addOrgMember, addProjectMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatMessage, addChatThread } from "../support/chat-db";

const PENDING = { kind: "escalate" as const, requestId: "esc-1" };
const RESOLVE = JSON.stringify({ decision: "resolve", decisionText: "同意追加预算" });

function input(raw: string, deciderId: string, overrides: Partial<DecisionGuardInput> = {}): DecisionGuardInput {
  return {
    visible: true,
    canWrite: true,
    pendingInterrupt: PENDING,
    payload: parseEscalateResumePayload(raw, "esc-1"),
    auditWritable: true,
    escalation: { deciderId, eligibleDeciderIds: ["owner-1"] },
    ...overrides,
  };
}

describe("AG06 escalate decision guard (pure)", () => {
  it("target person resolve / reject pass", () => {
    expect(guardAgentInterruptDecision(input(RESOLVE, "owner-1"))).toBeNull();
    const raw = JSON.stringify({ decision: "reject", reason: "不在预算内" });
    expect(guardAgentInterruptDecision(input(raw, "owner-1"))).toBeNull();
  });

  it("E6: non-target decider is refused; missing identity fails closed", () => {
    expect(guardAgentInterruptDecision(input(RESOLVE, "member-9"))).toBe("ESCALATION_DECIDER_FORBIDDEN");
    expect(guardAgentInterruptDecision(input(RESOLVE, "owner-1", { escalation: undefined }))).toBe(
      "ESCALATION_DECIDER_FORBIDDEN",
    );
  });

  it("E6: choose_option-shaped payload against escalate ⇒ INTERRUPT_KIND_MISMATCH (and vice versa)", () => {
    const raw = JSON.stringify({ decision: "edit", editedArgs: { selectedOptionId: "opt-a" } });
    expect(parseEscalateResumePayload(raw, "esc-1")?.impliedKind).toBe("choose_option");
    expect(guardAgentInterruptDecision(input(raw, "owner-1"))).toBe("INTERRUPT_KIND_MISMATCH");
    expect(
      guardAgentInterruptDecision(input(RESOLVE, "owner-1", { pendingInterrupt: { kind: "choose_option", requestId: "esc-1" } })),
    ).toBe("INTERRUPT_KIND_MISMATCH");
  });

  it("garbage payload ⇒ MALFORMED_RESUME_PAYLOAD", () => {
    expect(guardAgentInterruptDecision(input("not json", "owner-1"))).toBe("MALFORMED_RESUME_PAYLOAD");
    expect(guardAgentInterruptDecision(input(JSON.stringify({ decision: "resolve" }), "owner-1"))).toBe(
      "MALFORMED_RESUME_PAYLOAD",
    );
  });
});

const ORG = toOrgId("org-ag06-escalate");
const PROJECT = "proj-ag06-escalate";
const THREAD = "thread-ag06-escalate";
const REQUESTER = "u-ag06-requester";
const OWNER = "u-ag06-owner";
const MEMBER = "u-ag06-member";
const AGENT = "agt-ag06";
const VERSION = "agv-ag06";
const POLICY = { rules: [{ matter: "budget_overrun", target: "project_owner" }] };

describe("AG06 escalate end-to-end (real DB, real route)", () => {
  let db: PgDatabase;
  let runs: PgAgentRunRepository;
  let controller: EscalationDecisionController;
  const kick = vi.fn();

  beforeAll(async () => {
    ensureDatabase();
    await migrateOnce();
    db = new PgDatabase(appConfig());
    runs = new PgAgentRunRepository(db);
    controller = new EscalationDecisionController(new PgEscalationStore(db), runs, { kick } as never);
    await resetOrgs(ORG);
    await seedOrg({ orgId: ORG, projectId: PROJECT });
    for (const u of [REQUESTER, OWNER, MEMBER]) await addOrgMember(ORG, u, "consultant", null);
    await addProjectMember(ORG, PROJECT, REQUESTER, "member", null);
    await addProjectMember(ORG, PROJECT, MEMBER, "member", null);
    await addProjectMember(ORG, PROJECT, OWNER, "facilitator", null, true);
    await addChatThread({ orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: REQUESTER });
    await asOwner(async (c) => {
      await c.query(
        `INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
         VALUES ($1,$2,$1,$1,'enabled','u',now(),now())`, [AGENT, ORG]);
      await c.query(
        `INSERT INTO agent_versions (id,org_id,agent_id,semantic_label,instruction_digest,instructions,
           skill_version_ids,model_provider,model_id,tool_policy,creator_id,escalation_policy,created_at,published_at)
         VALUES ($1,$2,$3,'1.0.0',$4,'i','{}','p','m','[]','u',$5::jsonb,now(),now())`,
        [VERSION, ORG, AGENT, "a".repeat(64), JSON.stringify(POLICY)]);
    });
  });

  afterAll(async () => {
    await resetOrgs(ORG);
    await db.close();
  });

  async function seedRunningRun(id: string): Promise<string> {
    await addChatMessage({ orgId: ORG, id: `${id}-in`, threadId: THREAD, body: "帮我做预算", authorId: REQUESTER });
    await asApp(ORG, (c) => c.query(
      `INSERT INTO agent_runs (id, org_id, thread_id, input_message_id, agent_id, agent_version_id,
         skill_version_ids, model_provider, model_id, status, started_at)
       VALUES ($1,$2,$3,$4,$5,$6,'[]'::jsonb,'deep-agent','test-model','running', now() - interval '30 minutes')`,
      [id, ORG, THREAD, `${id}-in`, AGENT, VERSION]));
    return id;
  }

  async function runRow(id: string) {
    return asApp(ORG, async (c) => (await c.query<{
      status: string; pending_permission_request_id: string | null; pending_decision: string | null;
      pending_edited_args: string | null; permission_decision_count: number;
    }>(`SELECT status, pending_permission_request_id, pending_decision, pending_edited_args, permission_decision_count
          FROM agent_runs WHERE id=$1`, [id])).rows[0]!);
  }

  async function call(userId: string, interruptId: string, body: unknown): Promise<{ status: number; body: unknown }> {
    try {
      return { status: 200, body: await controller.decide({ userId, orgId: ORG }, interruptId, body) };
    } catch (e) {
      if (e instanceof HttpException) return { status: e.getStatus(), body: e.getResponse() };
      throw e;
    }
  }

  it("matter not in policy ⇒ no pending; matter in policy ⇒ thread goes pending with target from policy", async () => {
    const id = await seedRunningRun("run-ag06-raise");
    const deps = { runs };
    expect(await raiseEscalation(deps, { orgId: ORG, runId: id, policy: POLICY, matter: "other", reason: "r", contextRefs: [] })).toBeNull();
    expect((await runRow(id)).status).toBe("running");
    const payload = await raiseEscalation(deps, { orgId: ORG, runId: id, policy: POLICY, matter: "budget_overrun", reason: "超预算 20%", contextRefs: [] });
    expect(payload?.target).toBe("project_owner");
    const row = await runRow(id);
    expect(row.status).toBe("awaiting_tool_permission");
    expect(row.pending_permission_request_id).toBeTruthy();
  });

  it("E6 over HTTP: non-target 403, mis-shaped 409 INTERRUPT_KIND_MISMATCH, malformed 422, target resolves and the run resumes", async () => {
    const id = await seedRunningRun("run-ag06-decide");
    await raiseEscalation({ runs }, { orgId: ORG, runId: id, policy: POLICY, matter: "budget_overrun", reason: "超预算", contextRefs: [] });
    const interruptId = (await runRow(id)).pending_permission_request_id!;
    const resolve = { interruptId, decision: { decision: "resolve", decisionText: "同意" } };

    // 请求人本人也不是 target（policy 说 project_owner）；客户端无法自报 eligibleDeciderIds。
    for (const who of [MEMBER, REQUESTER]) {
      expect(await call(who, interruptId, { ...resolve, eligibleDeciderIds: [who] })).toEqual({
        status: 403, body: { reasonCode: "ESCALATION_DECIDER_FORBIDDEN" },
      });
    }
    expect(await call(OWNER, interruptId, { interruptId, decision: { decision: "edit", editedArgs: { selectedOptionId: "a" } } }))
      .toEqual({ status: 409, body: { reasonCode: "INTERRUPT_KIND_MISMATCH" } });
    expect(await call(OWNER, interruptId, { interruptId, decision: { decision: "resolve" } }))
      .toEqual({ status: 422, body: { reasonCode: "VALIDATION_FAILED" } });
    expect(await call(OWNER, "00000000-0000-0000-0000-000000000000", resolve))
      .toEqual({ status: 404, body: { reasonCode: "AGENT_NOT_FOUND" } });
    // 被拒的尝试一条都没落账。
    expect((await runRow(id)).permission_decision_count).toBe(0);
    expect((await runRow(id)).status).toBe("awaiting_tool_permission");

    expect(await call(OWNER, interruptId, resolve)).toEqual({ status: 200, body: { interruptId, status: "resolved" } });
    const after = await runRow(id);
    expect(after.status).toBe("queued");
    expect(after.pending_decision).toBe("edit");
    expect(JSON.parse(after.pending_edited_args!)).toEqual(resolve.decision);
    expect(kick).toHaveBeenCalledWith(ORG);
    // 已决的中断不能再被裁决一次。
    expect((await call(OWNER, interruptId, resolve)).status).toBe(404);
  });

  it("target reject also resumes the run (Agent learns the answer), status=rejected", async () => {
    const id = await seedRunningRun("run-ag06-reject");
    await raiseEscalation({ runs }, { orgId: ORG, runId: id, policy: POLICY, matter: "budget_overrun", reason: "超预算", contextRefs: [] });
    const interruptId = (await runRow(id)).pending_permission_request_id!;
    expect(await call(OWNER, interruptId, { interruptId, decision: { decision: "reject", reason: "不批" } }))
      .toEqual({ status: 200, body: { interruptId, status: "rejected" } });
    expect((await runRow(id)).status).toBe("queued");
  });

  it("E7: the real timeout sweeper leaves an expired escalate pending and records no decision", async () => {
    const id = await seedRunningRun("run-ag06-timeout");
    await raiseEscalation({ runs }, { orgId: ORG, runId: id, policy: POLICY, matter: "budget_overrun", reason: "超预算", contextRefs: [] });
    const before = await runRow(id);
    await asApp(ORG, (c) => c.query(`UPDATE agent_runs SET started_at = now() - interval '2 days' WHERE id=$1`, [id]));
    await sweepOrphanedRuns(db, { olderThanMs: 60_000 });
    await runs.reclaimStaleRunning(ORG, 60_000);
    const after = await runRow(id);
    expect(after.status).toBe("awaiting_tool_permission");
    expect(after.pending_permission_request_id).toBe(before.pending_permission_request_id);
    expect(after.pending_decision).toBeNull();
    expect(after.permission_decision_count).toBe(0);
  });
});

describe("pg-escalation-store.ts exemption conditions (lint-permission-paths entry)", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../../src/infrastructure/agent-interrupts/pg-escalation-store.ts", import.meta.url)), "utf8",
  );
  const code = src.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
  it("names only the six allowed tables, never withoutTenant, never writes", () => {
    const tables = new Set([...code.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)/g)].map((m) => m[1]));
    expect([...tables].sort()).toEqual(
      ["agent_runs", "agent_versions", "chat_messages", "chat_threads", "org_memberships", "project_memberships"],
    );
    expect(code).not.toMatch(/withoutTenant/);
    expect(code).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });
});
