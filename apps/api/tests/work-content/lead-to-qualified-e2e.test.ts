/**
 * lead-to-qualified-e2e.test.ts —— Phase 20 CT09（`05-content-lines.md` R3 步骤 8；V5；A5/E4/E5/E6/E7）。
 *
 * W011 G1 之后的写回段走真实 EffectGateway（P3 重查、receipt 三态、reconcile），端口是进程内替身：
 * - 批准路径：租户 CRM 桩恰好写 N 条 + notify.inapp 一次，实例 succeeded/complete。
 * - 驳回路径：CRM 写入 0 次，实例 rejected。
 * - 写第 1 条后杀进程，恢复后总写入仍为 N（E6 幂等重放 / 读回对账）。
 * - 版本冲突：该条 conflict、未覆盖、带差异；其它条继续 → with_holds（E4）。
 * - G1 后撤销审批人资格：该条 forbidden、未写（E5）。
 * - 未授权 crm.write：written_manual + 人工核对清单、零写入（A5）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { EffectCancelledError, EffectInstanceUnavailableError } from "../../src/application/workflow/effect-gateway";
import { WorkflowLeaseLostError } from "../../src/application/workflow/workflow-errors";
import { CrmWriteItemOutcome } from "@repo/contracts/work-content";
import { LeadWriteBackService, type ApprovedLead, type LeadWriteBackCommand } from "../../src/application/work-content/lead-write-back";
import { CrmStub, Eligibility, Grants, makeGateway, MemInstances, MemLeases, MemReceipts, NotifyStub, ProcessKilled } from "./lead-to-qualified-fakes";

const ORG = "org-ct09";
const INSTANCE = "wi-ct09";
const N = 3;

function lead(i: number, over: Partial<ApprovedLead> = {}): ApprovedLead {
  return {
    itemId: `lead-${i}`,
    company: `Acme ${i}`,
    decision: "approve",
    recordVersion: null,
    fields: { company: `Acme ${i}`, tier: "A", stage: "qualified" },
    itemDigest: `${i}`.repeat(64).slice(0, 64),
    ...over,
  };
}

describe("CT09 · W011 线索到合格：CRM 写入审批/驳回/幂等重放", () => {
  let receipts: MemReceipts;
  let leases: MemLeases;
  let instances: MemInstances;
  let grants: Grants;
  let crm: CrmStub;
  let eligibility: Eligibility;
  let notify: NotifyStub;

  beforeEach(async () => {
    receipts = new MemReceipts();
    leases = new MemLeases();
    instances = new MemInstances();
    grants = new Grants();
    grants.map.set("crm.write", { authorized: true, sideEffectCap: "write" });
    grants.map.set("notify.inapp", { authorized: true, sideEffectCap: "write" });
    crm = new CrmStub();
    eligibility = new Eligibility();
    notify = new NotifyStub();
    await instances.create({
      instanceId: INSTANCE,
      orgId: ORG,
      workflowKey: "lead-to-qualified",
      definitionVersion: 1,
      graphRef: "lead-to-qualified:1",
      pinnedSkills: [],
      agentId: "agent-d005",
      agentVersionId: "agent-d005-v1",
      initiatorUserId: "u-rep",
      triggerKind: "manual",
      status: "running",
      stateVersion: 1,
    });
  });

  /** 每次调用 = 一个新 worker 进程：新服务实例 + 新 lease（epoch+1），store 与 CRM 桩保持。 */
  async function runProcess(items: ApprovedLead[], beforeRun?: () => Promise<void>) {
    crm.dead = false; // 新进程：CRM 连接重新可用
    const gateway = makeGateway(receipts, leases, instances, grants);
    const svc = new LeadWriteBackService({ gateway, capability: grants, eligibility, crm, notify, events: instances as never, leases, instances });
    const lease = await leases.acquire({ orgId: ORG, instanceId: INSTANCE, holder: `w-${Math.random()}` });
    const cmd: LeadWriteBackCommand = {
      orgId: ORG,
      instanceId: INSTANCE,
      initiatorUserId: "u-rep",
      agentId: "agent-d005",
      agentVersionId: "agent-d005-v1",
      approverUserId: "u-queue-mgr",
      approvalRequestId: "req-g1",
      items,
    };
    await beforeRun?.();
    return svc.run(lease, cmd);
  }

  const status = () => instances.instances.get(INSTANCE)!.status;

  it("批准路径：CRM 恰好写 N 条，notify.inapp 一次，实例 succeeded + complete", async () => {
    const items = Array.from({ length: N }, (_, i) => lead(i + 1));
    const r = await runProcess(items);
    expect(crm.writes).toBe(N);
    expect(r.items.map((x) => x.outcome)).toEqual(Array(N).fill("written"));
    for (const x of r.items) expect(CrmWriteItemOutcome.safeParse(x.outcome).success).toBe(true);
    expect(r.outcome).toBe("complete");
    expect(status()).toBe("succeeded");
    expect(notify.sent).toHaveLength(1);
    expect(notify.sent[0]!.summary).toEqual({ written: N });
    expect(instances.events.filter((e) => e.type === "effect_finalized")).toHaveLength(N + 1);
  });

  it("驳回路径：CRM 写入 0 次，实例 rejected（gate_denied），不通知", async () => {
    const r = await runProcess(Array.from({ length: N }, (_, i) => lead(i + 1, { decision: "reject" })));
    expect(crm.writes).toBe(0);
    expect(r.status).toBe("rejected");
    expect(r.items.every((x) => x.outcome === "rejected")).toBe(true);
    expect(status()).toBe("rejected");
    expect(notify.sent).toHaveLength(0);
    expect(receipts.rows.size).toBe(0);
  });

  it("E6：写入第 1 条后杀进程，恢复后总写入仍为 N（读回对账，不二次写入）", async () => {
    const items = Array.from({ length: N }, (_, i) => lead(i + 1));
    crm.crashAfterWrites = 1;
    await expect(runProcess(items)).rejects.toBeInstanceOf(ProcessKilled);
    expect(crm.writes).toBe(1);
    expect(status()).toBe("running");

    const r = await runProcess(items);
    expect(crm.writes).toBe(N);
    expect(r.items.map((x) => x.outcome)).toEqual(Array(N).fill("written"));
    expect(r.outcome).toBe("complete");
    expect(status()).toBe("succeeded");
    expect(crm.records.get("lead-1")!.writeKeys).toHaveLength(1);
    expect(notify.sent).toHaveLength(1);
  });

  it("P3：两条写之间撤销 crm.write → 该条 forbidden、未写；其它条照写，实例 succeeded + with_holds", async () => {
    // crm.write 查询序：#1 服务入口，#2/#3/#4 = 网关对 lead-1/2/3 的逐条 P3 重查；只在 #3 撤销。
    grants.override = (category, n) => (category === "crm.write" && n === 3 ? { authorized: false, sideEffectCap: "read" } : undefined);
    const r = await runProcess(Array.from({ length: N }, (_, i) => lead(i + 1)));
    expect(grants.calls.get("crm.write")).toBe(N + 1);
    expect(r.items.map((x) => x.outcome)).toEqual(["written", "forbidden", "written"]);
    expect(crm.records.has("lead-2")).toBe(false);
    expect(crm.writes).toBe(N - 1);
    expect(instances.events.some((e) => e.type === "effect_blocked" && e.data.effectKey === "crm:lead-2")).toBe(true);
    expect(r.status).toBe("succeeded");
    expect(r.outcome).toBe("with_holds");
    expect(status()).toBe("succeeded");
  });

  it("E11：单条工具异常但写已落库 → 读回对账确认 written，实例 succeeded（held 分支见下一条）", async () => {
    crm.failNext = { afterWrite: true };
    const r1 = await runProcess([lead(1)]);
    expect(r1.items[0]!.outcome).toBe("written");
    expect(crm.writes).toBe(1);
    expect(r1.status).toBe("succeeded");
    expect(status()).toBe("succeeded");
  });

  it("E11/held：对账无结论 → held、不抛错；实例停在 needs_attention（终态），余条不再尝试同记 held，不追加 succeeded", async () => {
    crm.failNext = { afterWrite: false };
    const r2 = await runProcess([lead(2), lead(3)]);
    expect(r2.items.map((x) => x.outcome)).toEqual(["held", "held"]);
    expect(crm.writes).toBe(0);
    expect(notify.sent).toHaveLength(0);
    expect(r2.notified).toBe(false);
    expect(r2.status).toBe("needs_attention");
    expect(r2.outcome).toBe("with_holds");
    expect(status()).toBe("needs_attention");
    expect(instances.instances.get(INSTANCE)!.reasonCode).toBe("effect_unreconciled");
    expect(instances.events.some((e) => e.type === "status_changed" && e.data.status === "succeeded")).toBe(false);
  });

  it("P4：发起人已无读权限 → 不发通知，但落 effect_blocked 事件可审计", async () => {
    notify.readable = false;
    const r = await runProcess([lead(1)]);
    expect(r.notified).toBe(false);
    expect(notify.sent).toHaveLength(0);
    expect(instances.events.some((e) => e.type === "effect_blocked" && e.data.skipped === "recipient_cannot_read")).toBe(true);
  });

  it("E4：版本冲突 → 该条 conflict、未覆盖、带差异；其它条照写 → completed_with_holds", async () => {
    crm.seed("lead-2", "v7", { company: "Acme 2", tier: "C", stage: "new" }); // 阶段读到 v6，此后被他人改成 v7
    const items = [lead(1), lead(2, { recordVersion: "v6" }), lead(3)];
    const r = await runProcess(items);
    expect(crm.writes).toBe(2);
    const c = r.items.find((x) => x.itemId === "lead-2")!;
    expect(c.outcome).toBe("conflict");
    expect(c.conflictDiff).toEqual({ tier: { before: "A", current: "C" }, stage: { before: "qualified", current: "new" } });
    expect(crm.records.get("lead-2")).toMatchObject({ version: "v7", fields: { tier: "C", stage: "new" } });
    expect(r.outcome).toBe("with_holds");
    expect(status()).toBe("succeeded");
  });

  it("E5：G1 后撤销审批人资格 → 该条 forbidden、未写、落事件；其它条照写", async () => {
    eligibility.revoked.add("lead-2");
    const r = await runProcess(Array.from({ length: N }, (_, i) => lead(i + 1)));
    expect(r.items.find((x) => x.itemId === "lead-2")!.outcome).toBe("forbidden");
    expect(crm.records.has("lead-2")).toBe(false);
    expect(crm.writes).toBe(N - 1);
    expect(instances.events.some((e) => e.type === "effect_blocked" && e.data.itemOutcome === "forbidden")).toBe(true);
    expect(r.outcome).toBe("with_holds");
  });

  it("A5：组织未授权 crm.write（默认只读）→ written_manual + 人工核对清单，零写入、不报错", async () => {
    grants.map.delete("crm.write");
    const items = Array.from({ length: N }, (_, i) => lead(i + 1));
    const r = await runProcess(items);
    expect(crm.writes).toBe(0);
    expect(r.items.map((x) => x.outcome)).toEqual(Array(N).fill("written_manual"));
    expect(r.manualChecklist.map((m) => m.itemId)).toEqual(items.map((i) => i.itemId));
    expect(r.status).toBe("succeeded");
    expect(r.outcome).toBe("with_holds");
    expect(status()).toBe("succeeded");
  });
  it("R3-10：写回过程中实例被取消 → 不覆盖成 succeeded，落 cancelled 并抛 EffectCancelledError", async () => {
    // 最后一条 effect_finalized（通知）之后、终局追加之前，取消请求落下。
    instances.beforeAppend = (e) => {
      if (e.type === "effect_finalized" && e.data.effectKey === "notify:initiator") instances.instances.get(INSTANCE)!.status = "cancelling";
    };
    await expect(runProcess([lead(1)])).rejects.toBeInstanceOf(EffectCancelledError);
    expect(status()).toBe("cancelled");
    expect(instances.events.some((e) => e.type === "status_changed" && e.data.status === "succeeded")).toBe(false);
  });

  it("I-12：终局追加前实例已被他人落 needs_attention → 不覆盖，抛 EffectInstanceUnavailableError", async () => {
    instances.beforeAppend = (e) => {
      if (e.type === "effect_finalized" && e.data.effectKey === "notify:initiator") {
        const inst = instances.instances.get(INSTANCE)!;
        inst.status = "needs_attention";
      }
    };
    await expect(runProcess([lead(1)])).rejects.toBeInstanceOf(EffectInstanceUnavailableError);
    expect(status()).toBe("needs_attention");
  });

  it("驳回路径同样不覆盖取消：实例 cancelling → 落 cancelled，不落 rejected", async () => {
    instances.instances.get(INSTANCE)!.status = "cancelling";
    await expect(runProcess([lead(1, { decision: "reject" })])).rejects.toBeInstanceOf(EffectCancelledError);
    expect(status()).toBe("cancelled");
  });

  it("僵尸 worker：lease 被新持有者接管后 → 不得落终态（WorkflowLeaseLostError），实例保持 running", async () => {
    const r = runProcess([lead(1, { decision: "reject" })], async () => {
      await leases.acquire({ orgId: ORG, instanceId: INSTANCE, holder: "w-new" });
    });
    await expect(r).rejects.toBeInstanceOf(WorkflowLeaseLostError);
    expect(status()).toBe("running");
  });

  it("E5×E6：进程 1 已写 lead-1 后崩溃，恢复前撤销审批人资格 → lead-1 仍报 written（读回对账），无 P2 forbidden 审计", async () => {
    const items = Array.from({ length: N }, (_, i) => lead(i + 1));
    crm.crashAfterWrites = 1;
    await expect(runProcess(items)).rejects.toBeInstanceOf(ProcessKilled);
    eligibility.revoked.add("lead-1");
    const r = await runProcess(items);
    expect(r.items.find((x) => x.itemId === "lead-1")!.outcome).toBe("written");
    expect(crm.writes).toBe(N);
    expect(instances.events.some((e) => e.type === "effect_blocked" && e.data.effectKey === "crm:lead-1")).toBe(false);
    expect(status()).toBe("succeeded");
  });

  it("E5：P2 与 P3 的 effect_blocked 使用同一 effectKey（crm:<itemId>）", async () => {
    eligibility.revoked.add("lead-1");
    await runProcess([lead(1)]);
    const blocked = instances.events.filter((e) => e.type === "effect_blocked");
    expect(blocked.map((e) => e.data.effectKey)).toEqual(["crm:lead-1"]);
  });

  it("E6/通知：通知已发、终局前崩溃；恢复时汇总变化（P3 改判）→ 通知 replay 不抛 idempotency_key_reused，不重发，实例落终态", async () => {
    const items = [lead(1), lead(2)];
    instances.crashBeforeStatus = "succeeded";
    await expect(runProcess(items)).rejects.toBeInstanceOf(ProcessKilled);
    expect(notify.sent).toHaveLength(1);
    // 恢复进程：lead-2 的 P3 重查被拒 → 汇总与首次不同。
    const before = grants.calls.get("crm.write") ?? 0;
    grants.override = (category, n) => (category === "crm.write" && n === before + 3 ? { authorized: false, sideEffectCap: "read" } : undefined);
    const r = await runProcess(items);
    expect(r.status).toBe("succeeded");
    expect(r.notified).toBe(true);
    expect(notify.sent).toHaveLength(1);
    expect(status()).toBe("succeeded");
  });

  it("E6/通知：发送后、receipt finalize 前崩溃 → 恢复只读对账（已发），不重发，实例 succeeded", async () => {
    notify.crashAfterSend = true;
    await expect(runProcess([lead(1)])).rejects.toBeInstanceOf(ProcessKilled);
    const r = await runProcess([lead(1)]);
    expect(r.notified).toBe(true);
    expect(notify.sent).toHaveLength(1);
    expect(status()).toBe("succeeded");
  });
});
