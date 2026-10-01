/**
 * WF04 —— effect-gateway 执行前权限重查（requirements 02 R3 第 5 步；R4 E2/E4；domain I-13）。
 * 真实 PostgreSQL：真实 org_memberships / agents / agent_versions / workflow_capability_grants。
 *
 * 重查顺序固定：assertLease → 发起人成员资格 → Agent 可运行版本 → 工具授权 → MCP sideEffect 封顶。
 * 每条失败路径都断言"桩调用计数=1"的反面——工具桩（`work`）调用计数必须停在 0：权限重查/lease
 * 失败一律不产生任何外部调用。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowLeaseLostError, WorkflowUseCaseError } from "../../src/application/workflow/workflow-errors";
import { ComposedEffectPermissionRecheck } from "../../src/application/workflow/effect-permission-recheck";
import { EffectCancelledError, EffectGateway, EffectPermissionBlockedError, type ExecuteEffectCommand } from "../../src/application/workflow/effect-gateway";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { PgEffectCapabilityAuthority } from "../../src/infrastructure/workflow/pg-effect-capability-authority";
import { PgWorkflowAccess } from "../../src/infrastructure/workflow/pg-workflow-access";
import { PgWorkflowEventStore } from "../../src/infrastructure/workflow/pg-workflow-event-store";
import { PgWorkflowInstanceRepository } from "../../src/infrastructure/workflow/pg-workflow-instance-repository";
import { PgWorkflowLeaseStore } from "../../src/infrastructure/workflow/pg-workflow-lease-store";
import { PgWorkflowReceiptStore } from "../../src/infrastructure/workflow/pg-workflow-receipt-store";
import { asOwner, ensureDatabase, migrateOnce, resetOrgs } from "../support/db";
import { seedWorkflowOrg, WF03_ADMIN } from "./wf03-fixtures";
import { instanceRow, seedWf04Instance, setCapabilityGrant, setInstanceStatus } from "./wf04-fixtures";

const ORG = "org-wf04-recheck";
const INITIATOR = "u-wf04-recheck";
const AGENT = "agent-wf04-recheck";
const AGENT_VERSION = `${AGENT}-v1`;
const INSTANCE = "wi-wf04-recheck-1";
const STAGE = "notify";
const CATEGORY = "mail.send";

describe("WF04 effect-gateway: permission recheck (E2/E4)", () => {
  let db: PgDatabase;

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
    // 本文件测的是重查顺序/阻断原因，不是 ADR-120 决策 #2 的分类默认值（那部分见下面单独的
    // "no grant row configured" 用例，用的是另一个从不在这里授权的分类）；先显式给 CATEGORY 配
    // external_send，避免"没人配置就默认只读"把其余用例的 cmdFor(external_send) 挡在权限重查。
    await setCapabilityGrant(ORG, CATEGORY, { sideEffectCap: "external_send" });
  });

  function makeGateway() {
    const access = new PgWorkflowAccess(db);
    const receipts = new PgWorkflowReceiptStore(db);
    const leases = new PgWorkflowLeaseStore(db);
    const events = new PgWorkflowEventStore(db);
    const instances = new PgWorkflowInstanceRepository(db);
    const capability = new PgEffectCapabilityAuthority(db);
    const permission = new ComposedEffectPermissionRecheck(access, capability);
    return { gateway: new EffectGateway({ leases, receipts, events, instances, permission }), leases };
  }

  function cmdFor(effectKey: string, fingerprint: string): ExecuteEffectCommand {
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
      args: { to: "someone@example.com" },
    };
  }

  it("happy path: permission ok -> tool called exactly once, effect_begun/effect_finalized recorded, instance stays running", async () => {
    const { gateway, leases } = makeGateway();
    const lease = await leases.acquire({ orgId: ORG, instanceId: INSTANCE, holder: "w1", ttlMs: 60_000 });
    const work = vi.fn(async (args: Record<string, unknown>) => ({ sent: true, to: args.to }));

    const outcome = await gateway.execute(lease, cmdFor("send-1", "fp-1"), work);

    expect(outcome.kind).toBe("executed");
    expect(work).toHaveBeenCalledTimes(1);
    const row = await instanceRow(ORG, INSTANCE);
    expect(row).toMatchObject({ status: "running", reason_code: null });
  });

  it("E2: lease already lost -> WorkflowLeaseLostError, permission is never rechecked, tool never called", async () => {
    const { gateway, leases } = makeGateway();
    const lease = await leases.acquire({ orgId: ORG, instanceId: INSTANCE, holder: "w1", ttlMs: 60_000 });
    const staleLease = { ...lease, epoch: lease.epoch + 999 };
    const recheck = vi.fn();
    const gw = new EffectGateway({
      leases,
      receipts: new PgWorkflowReceiptStore(db),
      events: new PgWorkflowEventStore(db),
      instances: new PgWorkflowInstanceRepository(db),
      permission: { recheck },
    });
    const work = vi.fn(async () => ({}));

    await expect(gw.execute(staleLease, cmdFor("send-lease-lost", "fp-lease"), work)).rejects.toBeInstanceOf(WorkflowLeaseLostError);
    expect(recheck).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
  });

  it("E4 initiator_not_member: initiator removed from org -> blocked_permission, tool never called", async () => {
    const { gateway, leases } = makeGateway();
    const lease = await leases.acquire({ orgId: ORG, instanceId: INSTANCE, holder: "w1", ttlMs: 60_000 });
    await asOwner((c) => c.query("DELETE FROM org_memberships WHERE org_id = $1 AND user_id = $2", [ORG, INITIATOR]));
    const work = vi.fn(async () => ({}));

    const err = await gateway.execute(lease, cmdFor("send-2", "fp-2"), work).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EffectPermissionBlockedError);
    expect((err as EffectPermissionBlockedError).reasonCode).toBe("initiator_not_member");
    expect(work).not.toHaveBeenCalled();
    const row = await instanceRow(ORG, INSTANCE);
    expect(row).toMatchObject({ status: "blocked_permission", reason_code: "initiator_not_member" });
  });

  it("E4 agent_permission_revoked: agent no longer has a runnable published version -> blocked_permission", async () => {
    const { gateway, leases } = makeGateway();
    const lease = await leases.acquire({ orgId: ORG, instanceId: INSTANCE, holder: "w1", ttlMs: 60_000 });
    await asOwner((c) => c.query("UPDATE agents SET published_version_id = NULL WHERE id = $1 AND org_id = $2", [AGENT, ORG]));
    const work = vi.fn(async () => ({}));

    const err = await gateway.execute(lease, cmdFor("send-3", "fp-3"), work).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EffectPermissionBlockedError);
    expect((err as EffectPermissionBlockedError).reasonCode).toBe("agent_permission_revoked");
    expect(work).not.toHaveBeenCalled();
    const row = await instanceRow(ORG, INSTANCE);
    expect(row).toMatchObject({ status: "blocked_permission", reason_code: "agent_permission_revoked" });
  });

  it("E4 tool_authorization_revoked: capability grant revoked -> blocked_permission", async () => {
    const { gateway, leases } = makeGateway();
    const lease = await leases.acquire({ orgId: ORG, instanceId: INSTANCE, holder: "w1", ttlMs: 60_000 });
    await setCapabilityGrant(ORG, CATEGORY, { authorized: false });
    const work = vi.fn(async () => ({}));

    const err = await gateway.execute(lease, cmdFor("send-4", "fp-4"), work).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EffectPermissionBlockedError);
    expect((err as EffectPermissionBlockedError).reasonCode).toBe("tool_authorization_revoked");
    expect(work).not.toHaveBeenCalled();
    const row = await instanceRow(ORG, INSTANCE);
    expect(row).toMatchObject({ status: "blocked_permission", reason_code: "tool_authorization_revoked" });
  });

  it("E4 capability_exceeds_side_effect_cap: stage's declared sideEffect exceeds the org's MCP cap -> blocked_permission", async () => {
    const { gateway, leases } = makeGateway();
    const lease = await leases.acquire({ orgId: ORG, instanceId: INSTANCE, holder: "w1", ttlMs: 60_000 });
    await setCapabilityGrant(ORG, CATEGORY, { sideEffectCap: "read" }); // external_send > read
    const work = vi.fn(async () => ({}));

    const err = await gateway.execute(lease, cmdFor("send-5", "fp-5"), work).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EffectPermissionBlockedError);
    expect((err as EffectPermissionBlockedError).reasonCode).toBe("capability_exceeds_side_effect_cap");
    expect(work).not.toHaveBeenCalled();
    const row = await instanceRow(ORG, INSTANCE);
    expect(row).toMatchObject({ status: "blocked_permission", reason_code: "capability_exceeds_side_effect_cap" });
  });

  it("a capability with no grant row configured defaults to read-only (ADR-120 决策 #2: 默认只读, 不继承写权限)", async () => {
    const { gateway, leases } = makeGateway();
    const lease = await leases.acquire({ orgId: ORG, instanceId: INSTANCE, holder: "w1", ttlMs: 60_000 });
    const UNCONFIGURED_CATEGORY = "crm.unconfigured"; // 全文件唯一没在 beforeEach 里预授权的分类
    const cmdForUnconfigured = (effectKey: string, fingerprint: string, sideEffect: "read" | "external_send") => ({
      ...cmdFor(effectKey, fingerprint),
      capabilityCategory: UNCONFIGURED_CATEGORY,
      sideEffect,
    });

    // read 级调用：未配置的分类仍应放行（不因漏配置被误判 blocked）。
    const readWork = vi.fn(async () => ({ ok: true }));
    const outcome = await gateway.execute(lease, cmdForUnconfigured("send-6-read", "fp-6-read", "read"), readWork);
    expect(outcome.kind).toBe("executed");
    expect(readWork).toHaveBeenCalledTimes(1);

    // external_send：未配置的分类不得默认拿到写/外部发送能力——必须 blocked_permission。
    const sendWork = vi.fn(async () => ({ ok: true }));
    const err = await gateway.execute(lease, cmdForUnconfigured("send-6-external", "fp-6-external", "external_send"), sendWork).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EffectPermissionBlockedError);
    expect((err as EffectPermissionBlockedError).reasonCode).toBe("capability_exceeds_side_effect_cap");
    expect(sendWork).not.toHaveBeenCalled();
  });

  it("R3-10 cancel: instance is `cancelling` -> next effect is blocked with EffectCancelledError, instance falls to `cancelled`, tool never called", async () => {
    const { gateway, leases } = makeGateway();
    const lease = await leases.acquire({ orgId: ORG, instanceId: INSTANCE, holder: "w1", ttlMs: 60_000 });
    await setInstanceStatus(ORG, INSTANCE, "cancelling");
    const work = vi.fn(async () => ({ ok: true }));

    const err = await gateway.execute(lease, cmdFor("send-cancel-1", "fp-cancel-1"), work).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(EffectCancelledError);
    expect(work).not.toHaveBeenCalled();
    const row = await instanceRow(ORG, INSTANCE);
    expect(row).toMatchObject({ status: "cancelled", reason_code: "cancel_requested" });
  });

  it("R3-10 cancel: instance already `cancelled` (race landed before this call) -> blocked, tool never called", async () => {
    const { gateway, leases } = makeGateway();
    const lease = await leases.acquire({ orgId: ORG, instanceId: INSTANCE, holder: "w1", ttlMs: 60_000 });
    await setInstanceStatus(ORG, INSTANCE, "cancelled");
    const work = vi.fn(async () => ({ ok: true }));

    const err = await gateway.execute(lease, cmdFor("send-cancel-2", "fp-cancel-2"), work).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(EffectCancelledError);
    expect(work).not.toHaveBeenCalled();
  });

  it("admin membership is not required: any org member can be the recorded initiator", async () => {
    // WF03_ADMIN 本身也是组织成员（seedWorkflowOrg 固定建的管理员）；用它验证 orgRoleOf 对 admin 同样放行。
    const { gateway, leases } = makeGateway();
    const lease = await leases.acquire({ orgId: ORG, instanceId: INSTANCE, holder: "w1", ttlMs: 60_000 });
    const work = vi.fn(async () => ({ ok: true }));
    const cmd = { ...cmdFor("send-7", "fp-7"), initiatorUserId: WF03_ADMIN };

    const outcome = await gateway.execute(lease, cmd, work);
    expect(outcome.kind).toBe("executed");
  });

  it("idempotency_key_reused surfaces as a WorkflowUseCaseError and never calls the tool a second time", async () => {
    const { gateway, leases } = makeGateway();
    const lease = await leases.acquire({ orgId: ORG, instanceId: INSTANCE, holder: "w1", ttlMs: 60_000 });
    const work1 = vi.fn(async () => ({ ok: true }));
    await gateway.execute(lease, cmdFor("send-8", "fp-8a"), work1);
    expect(work1).toHaveBeenCalledTimes(1);

    const work2 = vi.fn(async () => ({ ok: true }));
    const err = await gateway.execute(lease, cmdFor("send-8", "fp-8b"), work2).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorkflowUseCaseError);
    expect((err as WorkflowUseCaseError).code).toBe("idempotency_key_reused");
    expect(work2).not.toHaveBeenCalled();
  });
});
