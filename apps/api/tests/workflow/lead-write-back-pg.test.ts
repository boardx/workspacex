/**
 * CT09 —— W011 写回段走生产合成（createWorkflowRuntime）：真实 PG receipt store / event store /
 * lease store / instance repository / PgEffectCapabilityAuthority；只有租户 CRM 与站内通知是桩
 * （租户 CRM 属租户外部系统，05-content-lines「Workflow 落点」）。
 *
 * 断言：批准路径写 N 条 + 通知 + 实例 succeeded；写第 1 条后杀进程，新进程（新 lease epoch）恢复后
 * 总写入仍为 N；实例被取消时不覆盖成 succeeded；未授权 crm.write（无 grant 行 = 默认只读）→ written_manual。
 */
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ApprovedLead, LeadWriteBackCommand } from "../../src/application/work-content/lead-write-back";
import { EffectCancelledError } from "../../src/application/workflow/effect-gateway";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { createWorkflowRuntime } from "../../src/infrastructure/workflow/create-workflow-runtime";
import { ensureDatabase, migrateOnce, resetOrgs } from "../support/db";
import { CrmStub, Eligibility, NotifyStub, ProcessKilled } from "../work-content/lead-to-qualified-fakes";
import { seedWorkflowOrg } from "./wf03-fixtures";
import { instanceRow, seedWf04Instance, setCapabilityGrant, setInstanceStatus } from "./wf04-fixtures";

const ORG = "org-ct09-pg";
const INITIATOR = "u-ct09-pg";
const AGENT = "agent-ct09-pg";
const INSTANCE = "wi-ct09-pg-1";
const N = 3;

function lead(i: number): ApprovedLead {
  return {
    itemId: `lead-${i}`,
    company: `Acme ${i}`,
    decision: "approve",
    recordVersion: null,
    fields: { company: `Acme ${i}`, stage: "qualified" },
    itemDigest: `${i}`.repeat(64).slice(0, 64),
  };
}

describe("CT09 · W011 写回（生产合成 + 真实 PostgreSQL）", () => {
  let db: PgDatabase;
  let pool: pg.Pool;
  let crm: CrmStub;
  let notify: NotifyStub;

  beforeAll(async () => {
    ensureDatabase();
    await migrateOnce();
    db = new PgDatabase(appConfig());
    pool = new pg.Pool({ ...appConfig(), max: 2 });
  }, 60_000);
  afterAll(async () => {
    await resetOrgs(ORG);
    await db?.close();
    await pool?.end();
  });
  beforeEach(async () => {
    await resetOrgs(ORG);
    await seedWorkflowOrg(ORG, [{ userId: INITIATOR }], AGENT);
    await seedWf04Instance(ORG, INSTANCE, { key: "lead-to-qualified", initiatorUserId: INITIATOR, agentId: AGENT, agentVersionId: `${AGENT}-v1` });
    await setCapabilityGrant(ORG, "crm.write", { sideEffectCap: "write" });
    await setCapabilityGrant(ORG, "notify.inapp", { sideEffectCap: "write" });
    crm = new CrmStub();
    notify = new NotifyStub();
  });

  /** 一次调用 = 一个 worker 进程：新合成 + 新 lease。 */
  async function runProcess(items: ApprovedLead[], ttlMs = 60_000) {
    crm.dead = false;
    const rt = createWorkflowRuntime(db, pool, { leadWriteBack: { crm, notify, eligibility: new Eligibility() } });
    const lease = await rt.leases.acquire({ orgId: ORG, instanceId: INSTANCE, holder: `w-${Math.random()}`, ttlMs });
    const cmd: LeadWriteBackCommand = {
      orgId: ORG,
      instanceId: INSTANCE,
      initiatorUserId: INITIATOR,
      agentId: AGENT,
      agentVersionId: `${AGENT}-v1`,
      approverUserId: INITIATOR,
      approvalRequestId: "req-g1",
      items,
    };
    return rt.leadWriteBack!.run(lease, cmd);
  }

  it("批准路径：写 N 条 + 通知一次，实例 succeeded", async () => {
    const r = await runProcess(Array.from({ length: N }, (_, i) => lead(i + 1)));
    expect(crm.writes).toBe(N);
    expect(r.outcome).toBe("complete");
    expect(notify.sent).toHaveLength(1);
    expect((await instanceRow(ORG, INSTANCE))?.status).toBe("succeeded");
  });

  it("E6：写第 1 条后杀进程 → 新进程恢复总写入仍为 N（PG receipt in_flight → 读回对账）", async () => {
    const items = Array.from({ length: N }, (_, i) => lead(i + 1));
    crm.crashAfterWrites = 1;
    // 进程 1 的 lease 短 TTL：死后过期，新进程才能按 epoch CAS 接管（与生产扫描器同一条路径）。
    await expect(runProcess(items, 1500)).rejects.toBeInstanceOf(ProcessKilled);
    await new Promise((r) => setTimeout(r, 1700));
    const r = await runProcess(items);
    expect(crm.writes).toBe(N);
    expect(r.items.map((x) => x.outcome)).toEqual(Array(N).fill("written"));
    expect((await instanceRow(ORG, INSTANCE))?.status).toBe("succeeded");
  });

  it("R3-10：实例已 cancelling → 不写、不落 succeeded，落 cancelled", async () => {
    await setInstanceStatus(ORG, INSTANCE, "cancelling");
    await expect(runProcess([lead(1)])).rejects.toBeInstanceOf(EffectCancelledError);
    expect(crm.writes).toBe(0);
    expect((await instanceRow(ORG, INSTANCE))?.status).toBe("cancelled");
  });

  it("A5：无 crm.write 授权行（默认只读）→ written_manual，零写入", async () => {
    await resetOrgs(ORG);
    await seedWorkflowOrg(ORG, [{ userId: INITIATOR }], AGENT);
    await seedWf04Instance(ORG, INSTANCE, { key: "lead-to-qualified", initiatorUserId: INITIATOR, agentId: AGENT, agentVersionId: `${AGENT}-v1` });
    const r = await runProcess([lead(1)]);
    expect(crm.writes).toBe(0);
    expect(r.items[0]!.outcome).toBe("written_manual");
    expect(r.manualChecklist).toHaveLength(1);
  });
});
