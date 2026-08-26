/**
 * F974 —— 三个编辑动作（UC-3/4/5）+ UC-6 撤约束：正常路径与校验失败路径。
 * 并发/孤儿约束的专项断言见同目录 `plan-edit-concurrency-orphan.test.ts`。
 *
 * 权威规格：usecases.md UC-3/4/5/6 + domain.md I-3/I-4/I-8。真 Postgres。
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addPlanConstraint } from "../../src/application/plan-control/add-plan-constraint";
import { deletePlanStep } from "../../src/application/plan-control/delete-plan-step";
import { removePlanConstraint } from "../../src/application/plan-control/remove-plan-constraint";
import { reorderPlanStep } from "../../src/application/plan-control/reorder-plan-step";
import { ingestEnginePlanSnapshot } from "../../src/application/plan-control/ingest-engine-plan-snapshot";
import { PgPlanLedgerRepository } from "../../src/infrastructure/plan-control/pg-plan-ledger-repository";
import { PgProvenanceRepository } from "../../src/infrastructure/provenance/pg-provenance-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatThread } from "../support/chat-db";
import { toOrgId } from "../../src/domain/org-id";
import type { PlanEditDeps } from "../../src/application/plan-control/plan-edit-support";

const ORG = "org-f974-edit-actions";
const PROJECT = "proj-f974-edit-actions";
const THREAD = "thread-f974-edit-actions";
const ACTOR = "u-f974-editor";
const HOOK_TIMEOUT_MS = 60_000;

let db: PgDatabase;
let repo: PgPlanLedgerRepository;
let provenance: PgProvenanceRepository;
let deps: PlanEditDeps;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgPlanLedgerRepository(db);
  provenance = new PgProvenanceRepository(db);
  deps = { db, repo, runs: repo };
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG);
  await db.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addChatThread({
    orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR,
  });
});

async function seedThreeSteps(): Promise<{ revision: number; planStepIds: string[] }> {
  const out = await ingestEnginePlanSnapshot(repo, {
    orgId: toOrgId(ORG), threadId: THREAD,
    todos: [
      { content: "第一步", status: "pending" },
      { content: "第二步", status: "pending" },
      { content: "第三步", status: "completed" },
    ],
  });
  const latest = await repo.getLatest(toOrgId(ORG), THREAD);
  return { revision: out.revision, planStepIds: latest!.steps.map((s) => s.planStepId) };
}

describe("UC-3 reorderPlanStep", () => {
  it("toIndex 越界钳制到边界，不报错；planStepId 集合不变", async () => {
    const { revision, planStepIds } = await seedThreeSteps();
    const out = await reorderPlanStep(deps, provenance, {
      orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR,
      basedOnRevision: revision, planStepId: planStepIds[0]!, toIndex: 999,
    });
    expect(out.revision).toBe(revision + 1);
    const after = await repo.getLatest(toOrgId(ORG), THREAD);
    const afterIds = after!.steps.map((s) => s.planStepId);
    expect(new Set(afterIds)).toEqual(new Set(planStepIds));
    // moved to the end (clamped to length-1)
    expect(afterIds[afterIds.length - 1]).toBe(planStepIds[0]);
  });

  it("负数 toIndex 钳制到 0", async () => {
    const { revision, planStepIds } = await seedThreeSteps();
    await reorderPlanStep(deps, provenance, {
      orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR,
      basedOnRevision: revision, planStepId: planStepIds[2]!, toIndex: -5,
    });
    const after = await repo.getLatest(toOrgId(ORG), THREAD);
    expect(after!.steps[0]!.planStepId).toBe(planStepIds[2]);
  });

  it("planStepId 不存在 -> PLAN_STEP_NOT_FOUND", async () => {
    const { revision } = await seedThreeSteps();
    await expect(reorderPlanStep(deps, provenance, {
      orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR,
      basedOnRevision: revision, planStepId: "no-such-step", toIndex: 0,
    })).rejects.toMatchObject({ code: "PLAN_STEP_NOT_FOUND" });
  });

  it("线程还没有账本 -> PLAN_NOT_FOUND", async () => {
    await expect(reorderPlanStep(deps, provenance, {
      orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR,
      basedOnRevision: 0, planStepId: "x", toIndex: 0,
    })).rejects.toMatchObject({ code: "PLAN_NOT_FOUND" });
  });
});

describe("UC-4 deletePlanStep", () => {
  it("删到 0 步被拒 PLAN_EMPTY_NOT_ALLOWED", async () => {
    const out = await ingestEnginePlanSnapshot(repo, {
      orgId: toOrgId(ORG), threadId: THREAD, todos: [{ content: "唯一一步", status: "pending" }],
    });
    const latest = await repo.getLatest(toOrgId(ORG), THREAD);
    await expect(deletePlanStep(deps, provenance, {
      orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR,
      basedOnRevision: out.revision, planStepId: latest!.steps[0]!.planStepId,
    })).rejects.toMatchObject({ code: "PLAN_EMPTY_NOT_ALLOWED" });
  });

  it("删 status='completed' 的步骤是允许的（人类已确认）", async () => {
    const { revision, planStepIds } = await seedThreeSteps();
    const out = await deletePlanStep(deps, provenance, {
      orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR,
      basedOnRevision: revision, planStepId: planStepIds[2]!, // status:'completed'
    });
    expect(out.revision).toBe(revision + 1);
    const after = await repo.getLatest(toOrgId(ORG), THREAD);
    expect(after!.steps.map((s) => s.planStepId)).toEqual([planStepIds[0], planStepIds[1]]);
  });

  it("删除后剩余 planStepId 集合 = 原集合 − {被删的那个}", async () => {
    const { revision, planStepIds } = await seedThreeSteps();
    await deletePlanStep(deps, provenance, {
      orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR,
      basedOnRevision: revision, planStepId: planStepIds[1]!,
    });
    const after = await repo.getLatest(toOrgId(ORG), THREAD);
    expect(new Set(after!.steps.map((s) => s.planStepId))).toEqual(
      new Set([planStepIds[0], planStepIds[2]]),
    );
  });
});

describe("UC-5 addPlanConstraint", () => {
  it("空白正文被拒 PLAN_CONSTRAINT_BLANK", async () => {
    const { revision, planStepIds } = await seedThreeSteps();
    await expect(addPlanConstraint(deps, provenance, {
      orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR,
      basedOnRevision: revision, planStepId: planStepIds[0]!, text: "   ",
    })).rejects.toMatchObject({ code: "PLAN_CONSTRAINT_BLANK" });
  });

  it("超过 500 字符被拒 PLAN_CONSTRAINT_TOO_LONG", async () => {
    const { revision, planStepIds } = await seedThreeSteps();
    await expect(addPlanConstraint(deps, provenance, {
      orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR,
      basedOnRevision: revision, planStepId: planStepIds[0]!, text: "字".repeat(501),
    })).rejects.toMatchObject({ code: "PLAN_CONSTRAINT_TOO_LONG" });
  });

  it("合法约束写进目标 step，独立重新查库核实（不信返回值）", async () => {
    const { revision, planStepIds } = await seedThreeSteps();
    const out = await addPlanConstraint(deps, provenance, {
      orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR,
      basedOnRevision: revision, planStepId: planStepIds[0]!, text: "别调用外部 API",
    });
    const after = await repo.getLatest(toOrgId(ORG), THREAD);
    const step = after!.steps.find((s) => s.planStepId === planStepIds[0]);
    expect(step!.constraints.map((c) => c.constraintId)).toContain(out.constraintId);
    expect(step!.constraints.find((c) => c.constraintId === out.constraintId)!.text).toBe("别调用外部 API");
  });
});

describe("UC-6 removePlanConstraint", () => {
  it("撤掉一条挂在现存 step 上的约束", async () => {
    const { revision, planStepIds } = await seedThreeSteps();
    const added = await addPlanConstraint(deps, provenance, {
      orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR,
      basedOnRevision: revision, planStepId: planStepIds[0]!, text: "别调用外部 API",
    });
    const removed = await removePlanConstraint(deps, provenance, {
      orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR,
      basedOnRevision: added.revision, constraintId: added.constraintId,
    });
    expect(removed.revision).toBe(added.revision + 1);
    const after = await repo.getLatest(toOrgId(ORG), THREAD);
    const step = after!.steps.find((s) => s.planStepId === planStepIds[0]);
    expect(step!.constraints.map((c) => c.constraintId)).not.toContain(added.constraintId);
  });

  it("撤掉一个不存在的约束是幂等成功（usecases.md UC-6 的 err 数组没有「未找到」码）", async () => {
    const { revision } = await seedThreeSteps();
    const out = await removePlanConstraint(deps, provenance, {
      orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR,
      basedOnRevision: revision, constraintId: randomUUID(),
    });
    expect(out.revision).toBe(revision);
    expect(out.auditEventId).toBeTruthy();
  });
});

describe("每次编辑都产生一条审计事件（usecases.md 出参 auditEventId）", () => {
  it("reorderPlanStep 的 auditEventId 在 provenance_events 里能查到", async () => {
    const { revision, planStepIds } = await seedThreeSteps();
    const out = await reorderPlanStep(deps, provenance, {
      orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR,
      basedOnRevision: revision, planStepId: planStepIds[0]!, toIndex: 1,
    });
    const row = await asApp(ORG, (c) =>
      c.query("SELECT id, actor_id, target_kind, target_id FROM provenance_events WHERE id = $1", [out.auditEventId]),
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0]).toMatchObject({ actor_id: ACTOR, target_kind: "thread", target_id: THREAD });
  });
});
