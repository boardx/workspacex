/**
 * WF04 —— effect-gateway 崩溃恢复不重放对账（requirements 02 R4 E1；domain I-14；UC-WR-I3）。
 * 真实 PostgreSQL：真实 workflow_receipts（begun/finalized/reconciled/unresolved 状态机 + 触发器锁）。
 *
 * 核心断言：一次 begin 之后，任何"看起来像重试"的调用都不得让工具桩（`work`）的调用计数超过 1——
 * 无论是命中未 finalize 的 in-flight receipt（E1，本文件模拟"进程在 begin 后崩溃"：work 抛错，
 * receipt 停在 begun），还是命中已 finalize 的 receipt（正常幂等重放，A1 同款语义）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ComposedEffectPermissionRecheck } from "../../src/application/workflow/effect-permission-recheck";
import { EffectGateway, EffectInFlightError, type ExecuteEffectCommand } from "../../src/application/workflow/effect-gateway";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { PgEffectCapabilityAuthority } from "../../src/infrastructure/workflow/pg-effect-capability-authority";
import { PgWorkflowAccess } from "../../src/infrastructure/workflow/pg-workflow-access";
import { PgWorkflowEventStore } from "../../src/infrastructure/workflow/pg-workflow-event-store";
import { PgWorkflowInstanceRepository } from "../../src/infrastructure/workflow/pg-workflow-instance-repository";
import { PgWorkflowLeaseStore } from "../../src/infrastructure/workflow/pg-workflow-lease-store";
import { PgWorkflowReceiptStore } from "../../src/infrastructure/workflow/pg-workflow-receipt-store";
import { ensureDatabase, migrateOnce, resetOrgs } from "../support/db";
import { seedWorkflowOrg } from "./wf03-fixtures";
import { instanceRow, seedWf04Instance, setCapabilityGrant } from "./wf04-fixtures";

const ORG = "org-wf04-noreplay";
const INITIATOR = "u-wf04-noreplay";
const AGENT = "agent-wf04-noreplay";
const AGENT_VERSION = `${AGENT}-v1`;
const INSTANCE = "wi-wf04-noreplay-1";
const STAGE = "notify";
const CATEGORY = "mail.send";

describe("WF04 effect-gateway: crash-recovery reconciliation, no replay (E1)", () => {
  let db: PgDatabase;
  let receipts: PgWorkflowReceiptStore;
  let leaseStore: PgWorkflowLeaseStore;
  let events: PgWorkflowEventStore;
  let gateway: EffectGateway;

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
    await seedWf04Instance(ORG, INSTANCE, { initiatorUserId: INITIATOR, agentId: AGENT, agentVersionId: AGENT_VERSION });
    // 本文件测的是 receipt/replay 语义，不是能力分类默认值（那部分见 effect-gateway-recheck.test.ts）；
    // 显式配 external_send，避免 ADR-120 决策 #2 的「默认只读」把 cmdFor 的 external_send 挡在权限重查。
    await setCapabilityGrant(ORG, CATEGORY, { sideEffectCap: "external_send" });
    receipts = new PgWorkflowReceiptStore(db);
    leaseStore = new PgWorkflowLeaseStore(db);
    events = new PgWorkflowEventStore(db);
    const permission = new ComposedEffectPermissionRecheck(new PgWorkflowAccess(db), new PgEffectCapabilityAuthority(db));
    gateway = new EffectGateway({ leases: leaseStore, receipts, events, instances: new PgWorkflowInstanceRepository(db), permission });
  });

  function cmdFor(effectKey: string, fingerprint: string, args: Record<string, unknown> = {}): ExecuteEffectCommand {
    return {
      orgId: ORG,
      instanceId: INSTANCE,
      stageId: STAGE,
      workflowKey: "wf04-demo",
      effectKey,
      capabilityCategory: CATEGORY,
      sideEffect: "external_send",
      initiatorUserId: INITIATOR,
      agentId: AGENT,
      agentVersionId: AGENT_VERSION,
      fingerprint,
      args,
    };
  }

  it("E1: crash between begin and finalize leaves the receipt 'begun'; retrying does not call the tool again; reconcile(true) resolves it without a second call", async () => {
    const lease = await leaseStore.acquire({ orgId: ORG, instanceId: INSTANCE, holder: "w1", ttlMs: 60_000 });
    const work = vi.fn(async () => {
      throw new Error("simulated crash: process died after receipt begin, before finalize");
    });

    await expect(gateway.execute(lease, cmdFor("eff-crash", "fp-crash"), work)).rejects.toThrow(/simulated crash/);
    expect(work).toHaveBeenCalledTimes(1); // 桩调用计数=1：崩溃发生在这一次调用之后，不是之前

    const key = `${INSTANCE}/${STAGE}/eff-crash`;
    const beforeRetry = await receipts.find(ORG, "effect", key);
    expect(beforeRetry?.status).toBe("begun");
    const evsBefore = await eventTypes();
    expect(evsBefore.filter((t) => t === "effect_begun")).toHaveLength(1);
    expect(evsBefore.filter((t) => t === "effect_finalized")).toHaveLength(0);

    // "重试"命中同一把未 finalize 的 receipt：绝不重放调用。
    const retryWork = vi.fn(async () => ({ should: "never run" }));
    await expect(gateway.execute(lease, cmdFor("eff-crash", "fp-crash"), retryWork)).rejects.toBeInstanceOf(EffectInFlightError);
    expect(retryWork).toHaveBeenCalledTimes(0);
    expect(work).toHaveBeenCalledTimes(1); // 全流程至今，真正的外部调用总计仍然是 1 次

    // 对账确认已生效 -> reconciled；不产生第三次调用；实例保持 running（不是 needs_attention）。
    const reconciler = { reconcile: vi.fn(async () => true) };
    const outcome = await gateway.reconcile({ orgId: ORG, instanceId: INSTANCE, stageId: STAGE, effectKey: "eff-crash", capabilityCategory: CATEGORY }, reconciler);
    expect(outcome).toBe("reconciled");
    expect(reconciler.reconcile).toHaveBeenCalledTimes(1);
    const resolved = await receipts.find(ORG, "effect", key);
    expect(resolved?.status).toBe("reconciled");
    expect(await instanceRow(ORG, INSTANCE)).toMatchObject({ status: "running" });

    // 再次对账已终态的 receipt：幂等，不重新调对账实现。
    const secondReconciler = { reconcile: vi.fn(async () => true) };
    const idempotent = await gateway.reconcile({ orgId: ORG, instanceId: INSTANCE, stageId: STAGE, effectKey: "eff-crash", capabilityCategory: CATEGORY }, secondReconciler);
    expect(idempotent).toBe("already_resolved");
    expect(secondReconciler.reconcile).not.toHaveBeenCalled();
  });

  it("E1: no reconcile implementation (or it cannot confirm) -> unresolved, instance moves to needs_attention with effect_unreconciled", async () => {
    const lease = await leaseStore.acquire({ orgId: ORG, instanceId: INSTANCE, holder: "w1", ttlMs: 60_000 });
    const work = vi.fn(async () => {
      throw new Error("simulated crash 2");
    });
    await expect(gateway.execute(lease, cmdFor("eff-unresolved", "fp-u"), work)).rejects.toThrow();
    expect(work).toHaveBeenCalledTimes(1);

    // 没有传 reconciler，网关自己也没配置默认实现 -> 视为查不到结论。
    const outcome = await gateway.reconcile({ orgId: ORG, instanceId: INSTANCE, stageId: STAGE, effectKey: "eff-unresolved", capabilityCategory: CATEGORY });
    expect(outcome).toBe("unresolved");
    expect(await instanceRow(ORG, INSTANCE)).toMatchObject({ status: "needs_attention", reason_code: "effect_unreconciled" });

    const key = `${INSTANCE}/${STAGE}/eff-unresolved`;
    expect((await receipts.find(ORG, "effect", key))?.status).toBe("unresolved");
  });

  it("reconcile on a receipt that was never begun is a no-op ('not_begun'), no reconciler call", async () => {
    const reconciler = { reconcile: vi.fn(async () => true) };
    const outcome = await gateway.reconcile({ orgId: ORG, instanceId: INSTANCE, stageId: STAGE, effectKey: "never-begun", capabilityCategory: CATEGORY }, reconciler);
    expect(outcome).toBe("not_begun");
    expect(reconciler.reconcile).not.toHaveBeenCalled();
  });

  it("A1-style replay: a successful effect's second execute() call with the same key returns the cached result and never calls the tool twice", async () => {
    const lease = await leaseStore.acquire({ orgId: ORG, instanceId: INSTANCE, holder: "w1", ttlMs: 60_000 });
    const work = vi.fn(async (args: Record<string, unknown>) => ({ sent: true, echo: args.echo }));

    const first = await gateway.execute(lease, cmdFor("eff-replay", "fp-replay", { echo: "hi" }), work);
    expect(first.kind).toBe("executed");
    expect(work).toHaveBeenCalledTimes(1);

    const second = await gateway.execute(lease, cmdFor("eff-replay", "fp-replay", { echo: "hi" }), work);
    expect(second.kind).toBe("replayed");
    expect(second.result).toEqual(first.result);
    expect(work).toHaveBeenCalledTimes(1); // 第二次调用没有让桩再跑一次

    const evs = await eventTypes();
    expect(evs.filter((t) => t === "effect_begun")).toHaveLength(1);
    expect(evs.filter((t) => t === "effect_finalized")).toHaveLength(1);
  });

  async function eventTypes(): Promise<string[]> {
    const log = await events.listAfter(ORG, INSTANCE, 0, 10_000);
    return log.map((e) => e.type);
  }
});
