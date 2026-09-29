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
  async function runProcess(items: ApprovedLead[]) {
    const gateway = makeGateway(receipts, leases, instances, grants);
    const svc = new LeadWriteBackService({ gateway, capability: grants, eligibility, crm, notify, events: instances as never });
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
});
