/**
 * WF02 —— lease 以 epoch CAS 获取（I-16 / R4-E2）。真实 PostgreSQL，真实并发。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { PgWorkflowLeaseStore } from "../../src/infrastructure/workflow/pg-workflow-lease-store";
import { WorkflowLeaseLostError, WorkflowUseCaseError } from "../../src/application/workflow/workflow-errors";
import type { WorkflowLease, WorkflowLeaseStore } from "../../src/application/workflow/workflow-ports";
import { asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { seedWorkflowInstance } from "./wf02-fixtures";

const ORG = "org-wf02-lease";
const OTHER = "org-wf02-lease-other";
const INSTANCE = "wi-wf02-lease-1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function codeOf(p: Promise<unknown>): Promise<string | null> {
  const e = await p.then(() => null, (x: unknown) => x);
  return e instanceof WorkflowUseCaseError ? e.code : e instanceof WorkflowLeaseLostError ? e.reasonCode : e === null ? null : String(e);
}

/** 副作用前 assertLease 的调用形状：lease 丢失时 effect 不得被调用。 */
async function guardedEffect(store: WorkflowLeaseStore, lease: WorkflowLease, effect: () => void): Promise<void> {
  await store.assertLease(lease);
  effect();
}

describe("WF02 lease epoch CAS", () => {
  let db: PgDatabase;
  let dbB: PgDatabase;
  beforeAll(async () => {
    ensureDatabase();
    await migrateOnce();
    db = new PgDatabase(appConfig());
    dbB = new PgDatabase(appConfig()); // 第二个 worker：独立连接池
  }, 60_000);
  afterAll(async () => {
    await resetOrgs(ORG, OTHER);
    await db?.close();
    await dbB?.close();
  });
  beforeEach(async () => {
    await resetOrgs(ORG, OTHER);
    await seedOrg({ orgId: ORG, projectId: "proj-wf02-lease" });
    await seedOrg({ orgId: OTHER, projectId: "proj-wf02-lease-other" });
    await seedWorkflowInstance(ORG, INSTANCE);
  });

  it("two workers resuming concurrently: exactly one gets the lease, the other gets lease_conflict", async () => {
    const a = new PgWorkflowLeaseStore(db);
    const b = new PgWorkflowLeaseStore(dbB);
    for (let round = 0; round < 5; round++) {
      const results = await Promise.allSettled([
        a.acquire({ orgId: ORG, instanceId: INSTANCE, holder: "worker-a", ttlMs: 60_000 }),
        b.acquire({ orgId: ORG, instanceId: INSTANCE, holder: "worker-b", ttlMs: 60_000 }),
      ]);
      const won = results.filter((r): r is PromiseFulfilledResult<WorkflowLease> => r.status === "fulfilled");
      const lost = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect((lost[0]!.reason as WorkflowUseCaseError).code).toBe("lease_conflict");
      expect(won[0]!.value.epoch).toBe(round + 1);
      await (won[0]!.value.holder === "worker-a" ? a : b).release(won[0]!.value);
    }
    const rows = await asApp(ORG, (c) => c.query<{ epoch: string }>("SELECT epoch FROM workflow_leases WHERE instance_id = $1", [INSTANCE]));
    expect(rows.rows).toEqual([{ epoch: "5" }]);
  });

  it("a live lease cannot be taken over; after expiry the takeover bumps epoch and the old holder's assertLease throws workflow_lease_lost before any effect", async () => {
    const a = new PgWorkflowLeaseStore(db);
    const b = new PgWorkflowLeaseStore(dbB);
    const la = await a.acquire({ orgId: ORG, instanceId: INSTANCE, holder: "worker-a", ttlMs: 300 });
    expect(la.epoch).toBe(1);
    await a.assertLease(la);
    expect(await codeOf(b.acquire({ orgId: ORG, instanceId: INSTANCE, holder: "worker-b", ttlMs: 60_000 }))).toBe("lease_conflict");

    await sleep(450);
    // 过期后自己的 epoch 也不再有效：副作用前被拦
    let calls = 0;
    expect(await codeOf(guardedEffect(a, la, () => calls++))).toBe("workflow_lease_lost");

    const lb = await b.acquire({ orgId: ORG, instanceId: INSTANCE, holder: "worker-b", ttlMs: 60_000 });
    expect(lb.epoch).toBe(2);
    await guardedEffect(b, lb, () => calls++);
    const lost = await guardedEffect(a, la, () => calls++).then(() => null, (e: unknown) => e);
    expect(lost).toBeInstanceOf(WorkflowLeaseLostError);
    expect(lost).toMatchObject({ reasonCode: "workflow_lease_lost", heldEpoch: 1, currentEpoch: 2 });
    expect(calls).toBe(1); // 只有持有者的那一次

    // 旧持有者的 release 不影响新持有者
    await a.release(la);
    await b.assertLease(lb);
  });

  it("release lets the next worker in with epoch+1; other orgs cannot see or take the lease", async () => {
    const a = new PgWorkflowLeaseStore(db);
    const la = await a.acquire({ orgId: ORG, instanceId: INSTANCE, holder: "worker-a", ttlMs: 60_000 });
    await a.release(la);
    expect(await codeOf(a.assertLease(la))).toBe("workflow_lease_lost");
    const lb = await a.acquire({ orgId: ORG, instanceId: INSTANCE, holder: "worker-b", ttlMs: 60_000 });
    expect(lb.epoch).toBe(2);
    // 他组织：RLS 下看不到那行，也不能插同 instance_id 的行
    expect(await codeOf(a.acquire({ orgId: OTHER, instanceId: INSTANCE, holder: "intruder", ttlMs: 60_000 }))).toBe("lease_conflict");
    await a.assertLease(lb); // 新持有者不受他组织尝试影响
  });

  it("another org acquiring FIRST is rejected and cannot lock out the owner (tenant-consistent FK)", async () => {
    const a = new PgWorkflowLeaseStore(db);
    expect(await codeOf(a.acquire({ orgId: OTHER, instanceId: INSTANCE, holder: "intruder", ttlMs: 60_000 }))).toBe(
      "workflow_not_found",
    );
    // 直接以 app_rw 插（绕过适配器）也被复合 FK 拒绝
    const raw = await asApp(OTHER, (c) =>
      c.query(
        `INSERT INTO workflow_leases (instance_id, org_id, holder, epoch, expires_at)
         VALUES ($1, $2, 'intruder', 1, now() + interval '100 years')`,
        [INSTANCE, OTHER],
      ),
    ).then(() => null, (e: { code?: string }) => e.code ?? "error");
    expect(raw).toBe("23503");
    const la = await a.acquire({ orgId: ORG, instanceId: INSTANCE, holder: "owner", ttlMs: 60_000 });
    expect(la.epoch).toBe(1);
  });

  it("the database refuses an epoch rewrite that is not a single-step takeover (I-16)", async () => {
    const a = new PgWorkflowLeaseStore(db);
    await a.acquire({ orgId: ORG, instanceId: INSTANCE, holder: "worker-a", ttlMs: 60_000 });
    await expect(
      db.withTenant(toOrgId(ORG), (s) => s.query("UPDATE workflow_leases SET epoch = 1, holder = 'x' WHERE instance_id = $1", [INSTANCE])),
    ).rejects.toThrow(/I-16/);
    await expect(
      db.withTenant(toOrgId(ORG), (s) => s.query("UPDATE workflow_leases SET epoch = epoch + 5 WHERE instance_id = $1", [INSTANCE])),
    ).rejects.toThrow(/I-16/);
  });
});
