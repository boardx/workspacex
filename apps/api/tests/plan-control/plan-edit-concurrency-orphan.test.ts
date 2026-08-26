/**
 * F974 —— 并发不静默覆盖（I-5）+ 孤儿约束可见（I-8）+ mid-run 编辑只落账本（I-11）。
 *
 * 权威规格：usecases.md B 组头 + domain.md I-5/I-8/I-11。真 Postgres。
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addPlanConstraint } from "../../src/application/plan-control/add-plan-constraint";
import { deletePlanStep } from "../../src/application/plan-control/delete-plan-step";
import { reorderPlanStep } from "../../src/application/plan-control/reorder-plan-step";
import { ingestEnginePlanSnapshot } from "../../src/application/plan-control/ingest-engine-plan-snapshot";
import { PgPlanLedgerRepository } from "../../src/infrastructure/plan-control/pg-plan-ledger-repository";
import { PgProvenanceRepository } from "../../src/infrastructure/provenance/pg-provenance-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatThread, addChatMessage } from "../support/chat-db";
import { toOrgId } from "../../src/domain/org-id";
import type { PlanEditDeps } from "../../src/application/plan-control/plan-edit-support";

const ORG = "org-f974-concurrency-orphan";
const PROJECT = "proj-f974-concurrency-orphan";
const THREAD = "thread-f974-concurrency-orphan";
const ACTOR = "u-f974-editor-2";
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

async function seedTwoSteps(): Promise<{ revision: number; planStepIds: string[] }> {
  const out = await ingestEnginePlanSnapshot(repo, {
    orgId: toOrgId(ORG), threadId: THREAD,
    todos: [{ content: "第一步", status: "pending" }, { content: "第二步", status: "pending" }],
  });
  const latest = await repo.getLatest(toOrgId(ORG), THREAD);
  return { revision: out.revision, planStepIds: latest!.steps.map((s) => s.planStepId) };
}

async function countLedgerRows(): Promise<number> {
  const r = await asApp(ORG, (c) =>
    c.query<{ n: string }>("SELECT count(*) AS n FROM chat_plan_ledgers WHERE thread_id = $1", [THREAD]),
  );
  return Number(r.rows[0]!.n);
}

async function insertRun(status: string): Promise<string> {
  const runId = `run-${randomUUID()}`;
  const messageId = `msg-${randomUUID()}`;
  await addChatMessage({ orgId: ORG, id: messageId, threadId: THREAD, body: "hi", authorId: ACTOR });
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO agent_runs
         (id, org_id, thread_id, input_message_id, agent_id, agent_version_id, skill_version_ids,
          model_provider, model_id, status)
       VALUES ($1,$2,$3,$4,'a-1','av-1','[]','openai','gpt',$5)`,
      [runId, ORG, THREAD, messageId, status],
    ),
  );
  return runId;
}

describe("I-5：并发两次编辑同一 basedOnRevision，第二次必须拒绝，账本只多一行", () => {
  it("reorderPlanStep 两次并发提交同一 basedOnRevision -> 第二次 PLAN_REVISION_CHANGED", async () => {
    const { revision, planStepIds } = await seedTwoSteps();
    const before = await countLedgerRows();

    const first = reorderPlanStep(deps, provenance, {
      orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR,
      basedOnRevision: revision, planStepId: planStepIds[0]!, toIndex: 1,
    });
    const second = reorderPlanStep(deps, provenance, {
      orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR,
      basedOnRevision: revision, planStepId: planStepIds[1]!, toIndex: 0,
    });

    const results = await Promise.allSettled([first, second]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: "PLAN_REVISION_CHANGED" });

    // 账本只多一行——不是静默覆盖出两行 racing 的结果，也不是丢失了那次成功的写入。
    expect(await countLedgerRows()).toBe(before + 1);
  });

  it("basedOnRevision 落后于当前最大 revision（陈旧提交）-> PLAN_REVISION_CHANGED，不静默覆盖", async () => {
    const { revision, planStepIds } = await seedTwoSteps();
    // 先成功推进一版
    await reorderPlanStep(deps, provenance, {
      orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR,
      basedOnRevision: revision, planStepId: planStepIds[0]!, toIndex: 1,
    });
    const before = await countLedgerRows();
    // 再用旧的 basedOnRevision 提交一次
    await expect(deletePlanStep(deps, provenance, {
      orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR,
      basedOnRevision: revision, planStepId: planStepIds[1]!,
    })).rejects.toMatchObject({ code: "PLAN_REVISION_CHANGED" });
    expect(await countLedgerRows()).toBe(before);
  });
});

describe("I-8：删掉带约束的步骤，约束转孤儿，orphanedConstraintIds 如实返回，不静默删除", () => {
  it("删除后查约束仍在孤儿表，UI 可读的 listOrphanedConstraints 能看到", async () => {
    const { revision, planStepIds } = await seedTwoSteps();
    const added = await addPlanConstraint(deps, provenance, {
      orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR,
      basedOnRevision: revision, planStepId: planStepIds[0]!, text: "务必用中文回复",
    });
    const deleted = await deletePlanStep(deps, provenance, {
      orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR,
      basedOnRevision: added.revision, planStepId: planStepIds[0]!,
    });

    expect(deleted.orphanedConstraintIds).toEqual([added.constraintId]);

    const orphans = await repo.listOrphanedConstraints(toOrgId(ORG), THREAD);
    expect(orphans.map((o) => o.constraintId)).toContain(added.constraintId);
    const orphan = orphans.find((o) => o.constraintId === added.constraintId)!;
    expect(orphan.text).toBe("务必用中文回复");
    expect(orphan.formerStepContent).toBe("第一步");
    expect(orphan.orphanedAtRevision).toBe(deleted.revision);

    // 独立查库核实——不是「返回值撒谎」类型的假绿。
    const row = await asApp(ORG, (c) =>
      c.query("SELECT * FROM chat_plan_orphan_constraints WHERE constraint_id = $1", [added.constraintId]),
    );
    expect(row.rows).toHaveLength(1);
  });

  it("删除不带约束的步骤 -> orphanedConstraintIds 是空数组，没有孤儿产生", async () => {
    const { revision, planStepIds } = await seedTwoSteps();
    const out = await deletePlanStep(deps, provenance, {
      orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR,
      basedOnRevision: revision, planStepId: planStepIds[0]!,
    });
    expect(out.orphanedConstraintIds).toEqual([]);
    expect(await repo.listOrphanedConstraints(toOrgId(ORG), THREAD)).toEqual([]);
  });
});

describe("I-11：有活跃 run 时编辑只落账本，appliedTo='ledger-only'", () => {
  it("run.status='running' 期间提交编辑 -> appliedTo='ledger-only'", async () => {
    const { revision, planStepIds } = await seedTwoSteps();
    await insertRun("running");
    const out = await reorderPlanStep(deps, provenance, {
      orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR,
      basedOnRevision: revision, planStepId: planStepIds[0]!, toIndex: 1,
    });
    expect(out.appliedTo).toBe("ledger-only");
  });

  it("没有活跃 run 时提交编辑 -> appliedTo='ledger-and-engine'", async () => {
    const { revision, planStepIds } = await seedTwoSteps();
    const out = await reorderPlanStep(deps, provenance, {
      orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR,
      basedOnRevision: revision, planStepId: planStepIds[0]!, toIndex: 1,
    });
    expect(out.appliedTo).toBe("ledger-and-engine");
  });

  it("run.status='succeeded'（已终态）不算活跃 -> appliedTo='ledger-and-engine'", async () => {
    const { revision, planStepIds } = await seedTwoSteps();
    await insertRun("succeeded");
    const out = await reorderPlanStep(deps, provenance, {
      orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR,
      basedOnRevision: revision, planStepId: planStepIds[0]!, toIndex: 1,
    });
    expect(out.appliedTo).toBe("ledger-and-engine");
  });

  it("结构性断言：本束的编辑动作源码里没有出现 POST /threads/:id/state 的调用" +
     "（mid-run 写引擎 state 不可靠，domain.md 三·③；I-11 的静态一半）", () => {
    for (const file of [
      "../../src/application/plan-control/reorder-plan-step.ts",
      "../../src/application/plan-control/delete-plan-step.ts",
      "../../src/application/plan-control/add-plan-constraint.ts",
      "../../src/application/plan-control/remove-plan-constraint.ts",
      "../../src/application/plan-control/plan-edit-support.ts",
    ]) {
      const src = readFileSync(new URL(file, import.meta.url), "utf8");
      // Strip comments first -- the doc comments explaining WHY this bundle never calls
      // `POST /threads/:id/state` themselves contain that string, which would otherwise
      // make this assertion vacuously fail on its own explanation.
      const withoutComments = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(withoutComments.includes("/state")).toBe(false);
    }
  });
});
