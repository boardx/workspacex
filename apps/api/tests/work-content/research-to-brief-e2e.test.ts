/**
 * Phase 20 CT03 —— 研究线端到端（05 号 R3 步骤 3–4、R4 A4；契约束 work-content V3 / I-C6 / I-C7 / I-C9）。
 * 真实 PostgreSQL：实例、事件、阶段产出、effect receipt、权限重查全走 PG；Skill 用回环执行器 + web.search 桩。
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ResearchBrief } from "@repo/contracts/work-content";
import { runResearchToBrief, type GateDecision, type ResearchGateDecisionPort } from "../../src/application/work-content/research-to-brief";
import { ComposedEffectPermissionRecheck } from "../../src/application/workflow/effect-permission-recheck";
import { EffectGateway } from "../../src/application/workflow/effect-gateway";
import { W001 } from "../../src/domain/work-content/definitions/W001";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { LoopbackResearchSkillExecutor } from "../../src/infrastructure/work-content/loopback-research-skills";
import { PgEffectCapabilityAuthority } from "../../src/infrastructure/workflow/pg-effect-capability-authority";
import { PgWorkflowAccess } from "../../src/infrastructure/workflow/pg-workflow-access";
import { PgWorkflowEventStore, PgWorkflowStageOutputStore } from "../../src/infrastructure/workflow/pg-workflow-event-store";
import { PgWorkflowInstanceRepository } from "../../src/infrastructure/workflow/pg-workflow-instance-repository";
import { PgWorkflowLeaseStore } from "../../src/infrastructure/workflow/pg-workflow-lease-store";
import { PgWorkflowReceiptStore } from "../../src/infrastructure/workflow/pg-workflow-receipt-store";
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs } from "../support/db";
import { eventSeqs, seedWorkflowOrg } from "../workflow/wf03-fixtures";
import { instanceRow, seedWf04Instance, setCapabilityGrant } from "../workflow/wf04-fixtures";

const ORG = "org-ct03-research";
const INITIATOR = "u-ct03-member";
const REVIEWER_A = "u-ct03-reviewer-a";
const REVIEWER_B = "u-ct03-reviewer-b";
const AGENT = "agent-ct03-d002";
const AGENT_VERSION = `${AGENT}-v1`;

const MATERIALS = [
  { ref: "kb:doc-1#p2", text: "市场规模三年翻倍" },
  { ref: "web:example.org/report", text: "头部厂商集中度上升" },
];

function gatesApproving(byGate: Record<string, string[]>): ResearchGateDecisionPort & { seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    decide: async (g): Promise<GateDecision> => {
      seen.push(g.gateId);
      return { decision: "approved", approverUserIds: byGate[g.gateId] ?? [], requestId: `req-${g.gateId}-${randomUUID()}` };
    },
  };
}

describe("CT03 research line e2e: W001 research → brief", () => {
  let db: PgDatabase;
  let instanceId: string;

  beforeAll(async () => {
    ensureDatabase();
    await migrateOnce();
    db = new PgDatabase(appConfig());
  }, 60_000);
  afterAll(async () => {
    await resetOrgs(ORG);
    await db?.close();
  });
  beforeEach(async () => {
    await resetOrgs(ORG);
    await seedWorkflowOrg(ORG, [{ userId: INITIATOR }], AGENT);
    await addOrgMember(ORG, REVIEWER_A, "consultant", null);
    await addOrgMember(ORG, REVIEWER_B, "consultant", null);
    instanceId = `wi-ct03-${randomUUID()}`;
    await seedWf04Instance(ORG, instanceId, { key: W001.key, initiatorUserId: INITIATOR, agentId: AGENT, agentVersionId: AGENT_VERSION });
    await setCapabilityGrant(ORG, "artifact.write", { sideEffectCap: "write" });
  });

  async function run(opts: { materials: typeof MATERIALS; gates: ResearchGateDecisionPort; recipients: string[] }) {
    const leases = new PgWorkflowLeaseStore(db);
    const events = new PgWorkflowEventStore(db);
    const effects = new EffectGateway({
      leases,
      receipts: new PgWorkflowReceiptStore(db),
      events,
      instances: new PgWorkflowInstanceRepository(db),
      permission: new ComposedEffectPermissionRecheck(new PgWorkflowAccess(db), new PgEffectCapabilityAuthority(db)),
    });
    const search = vi.fn(async () => opts.materials);
    const publish = vi.fn(async (args: Record<string, unknown>) => ({ artifactId: "art-1", digest: (args.brief as { digest: string }).digest }));
    const lease = await leases.acquire({ orgId: ORG, instanceId, holder: "ct03", ttlMs: 60_000 });
    const result = await runResearchToBrief(
      {
        skills: new LoopbackResearchSkillExecutor({ search }),
        gates: opts.gates,
        publisher: { publish },
        effects,
        events,
        outputs: new PgWorkflowStageOutputStore(db),
        newId: () => randomUUID(),
      },
      lease,
      { orgId: ORG, instanceId, initiatorUserId: INITIATOR, agentId: AGENT, agentVersionId: AGENT_VERSION, question: "AI 协作工具市场", recipientCategories: opts.recipients },
    );
    return { result, publish, search };
  }

  it("V3: S003→S063→S171→S020→S010 → G2 → G3 dual-sign → effect-gateway publishes exactly once → succeeded/complete with evidenced claims", { timeout: 60_000 }, async () => {
    const gates = gatesApproving({ G2: [REVIEWER_A], G3: [REVIEWER_A, REVIEWER_B] });
    const { result, publish } = await run({ materials: MATERIALS, gates, recipients: ["internal", "external_partner"] });

    expect(result.skillCalls.map((c) => c.skillId)).toEqual(["S003", "S063", "S171", "S020", "S010"]);
    for (const c of result.skillCalls) expect(c.semanticVersion).toBe(W001.skillVersions[c.skillId]); // 固定版本（I-C5）
    expect(gates.seen).toEqual(["G2", "G3"]);
    expect(result).toMatchObject({ status: "succeeded", outcome: "complete", published: true });

    const brief = ResearchBrief.parse(result.output);
    const refs = new Set(MATERIALS.map((m) => m.ref));
    expect(brief.claims.length).toBe(2);
    for (const c of [...brief.claims, ...brief.risks]) {
      expect(c.evidenceRefs.length).toBeGreaterThan(0);
      for (const r of c.evidenceRefs) expect(refs.has(r)).toBe(true);
    }

    expect(publish).toHaveBeenCalledTimes(1);
    const evs = (await eventSeqs(ORG, instanceId)).map((e) => e.type);
    expect(evs.filter((t) => t === "effect_begun")).toHaveLength(1);
    expect(evs.filter((t) => t === "effect_finalized")).toHaveLength(1);
    expect(evs.filter((t) => t === "gate_opened")).toHaveLength(2);
    expect(await instanceRow(ORG, instanceId)).toMatchObject({ status: "succeeded", reason_code: null });
  });

  it("G3 with an external recipient category and only one approver: stays awaiting_gate_decision, nothing published", { timeout: 60_000 }, async () => {
    const gates = gatesApproving({ G2: [REVIEWER_A], G3: [REVIEWER_A] });
    const { result, publish } = await run({ materials: MATERIALS, gates, recipients: ["board"] });
    expect(result.status).toBe("awaiting_gate_decision");
    expect(publish).not.toHaveBeenCalled();
    expect(await instanceRow(ORG, instanceId)).toMatchObject({ status: "awaiting_gate_decision" });
  });

  it("G3 dual-sign does not count the initiator as a second signer", { timeout: 60_000 }, async () => {
    const gates = gatesApproving({ G2: [REVIEWER_A], G3: [REVIEWER_A, INITIATOR] });
    const { result, publish } = await run({ materials: MATERIALS, gates, recipients: ["regulator"] });
    expect(result.status).toBe("awaiting_gate_decision");
    expect(publish).not.toHaveBeenCalled();
  });

  it("effect-gateway rechecks publish permission: revoked artifact.write grant → blocked_permission, publish never called", { timeout: 60_000 }, async () => {
    await setCapabilityGrant(ORG, "artifact.write", { authorized: false });
    const gates = gatesApproving({ G2: [REVIEWER_A], G3: [REVIEWER_A] });
    const err = await run({ materials: MATERIALS, gates, recipients: ["internal"] }).catch((e: unknown) => e);
    expect((err as { reasonCode?: string }).reasonCode).toBe("tool_authorization_revoked");
    expect(await instanceRow(ORG, instanceId)).toMatchObject({ status: "blocked_permission" });
  });

  it("G2 denied → rejected, zero effects", { timeout: 60_000 }, async () => {
    const gates: ResearchGateDecisionPort = { decide: async () => ({ decision: "denied", approverUserIds: [REVIEWER_A], requestId: "req-deny-0001" }) };
    const { result, publish } = await run({ materials: MATERIALS, gates, recipients: ["internal"] });
    expect(result.status).toBe("rejected");
    expect(publish).not.toHaveBeenCalled();
    expect((await eventSeqs(ORG, instanceId)).some((e) => e.type === "effect_begun")).toBe(false);
  });

  it("A4: no retrievable material → data needs statement, succeeded with_holds, no claims, no gates, no publish", { timeout: 60_000 }, async () => {
    const gates = gatesApproving({});
    const { result, publish, search } = await run({ materials: [], gates, recipients: ["internal"] });
    expect(search).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "succeeded", outcome: "with_holds", published: false });
    expect(result.output?.kind).toBe("data_needs_statement");
    expect(result.output).not.toHaveProperty("claims");
    expect(result.skillCalls.map((c) => c.skillId)).toEqual(["S003"]);
    expect(gates.seen).toEqual([]);
    expect(publish).not.toHaveBeenCalled();
    const evs = await eventSeqs(ORG, instanceId);
    expect(evs.some((e) => e.type === "effect_begun")).toBe(false);
    expect(await instanceRow(ORG, instanceId)).toMatchObject({ status: "succeeded" });
  });
});
