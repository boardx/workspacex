/**
 * F973 —— UC-2 `ingestEnginePlanSnapshot`：引擎快照落账本，永远被接受（I-6），
 * `planStepId` 内容继承启发式，`engineEpoch` 递增，`origin='engine'` 的行 `constraints` 恒空（I-9）。
 *
 * 权威规格：usecases.md UC-2 + domain.md I-6/I-9。真 Postgres，独立重新查库断言
 * （不信用例返回值——同 `update-own-profile.test.ts` 的纪律）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ingestEnginePlanSnapshot } from "../../src/application/plan-control/ingest-engine-plan-snapshot";
import { PgPlanLedgerRepository } from "../../src/infrastructure/plan-control/pg-plan-ledger-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatThread } from "../support/chat-db";
import { toOrgId } from "../../src/domain/org-id";

const ORG = "org-f973-ingest-snapshot";
const PROJECT = "proj-f973-ingest-snapshot";
const THREAD = "thread-f973-ingest-snapshot";
const HOOK_TIMEOUT_MS = 60_000;

let db: PgDatabase;
let repo: PgPlanLedgerRepository;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgPlanLedgerRepository(db);
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG);
  await db.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addChatThread({
    orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: "u-author",
  });
});

async function readLedgerRows(): Promise<Array<{
  revision: number; engine_epoch: number; origin: string; steps: unknown;
}>> {
  const r = await asApp(ORG, (c) =>
    c.query<{ revision: number; engine_epoch: number; origin: string; steps: unknown }>(
      "SELECT revision, engine_epoch, origin, steps FROM chat_plan_ledgers WHERE thread_id = $1 ORDER BY revision",
      [THREAD],
    ),
  );
  return r.rows;
}

describe("UC-2 ingestEnginePlanSnapshot：永远被接受，revision/engineEpoch 递增", () => {
  it("线程从未有账本时，第一次快照落 revision:0 engineEpoch:0", async () => {
    const out = await ingestEnginePlanSnapshot(repo, {
      orgId: toOrgId(ORG), threadId: THREAD,
      todos: [{ content: "调研竞品", status: "pending" }, { content: "写方案", status: "pending" }],
    });
    expect(out.revision).toBe(0);
    expect(out.engineEpoch).toBe(0);

    const rows = await readLedgerRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.origin).toBe("engine");
    const steps = rows[0]!.steps as Array<{ content: string; constraints: unknown[] }>;
    expect(steps.map((s) => s.content)).toEqual(["调研竞品", "写方案"]);
  });

  it("连发两次快照：engineEpoch 各自 +1 递增，账本多两行（append-only，不覆盖）", async () => {
    await ingestEnginePlanSnapshot(repo, {
      orgId: toOrgId(ORG), threadId: THREAD,
      todos: [{ content: "调研竞品", status: "pending" }],
    });
    const second = await ingestEnginePlanSnapshot(repo, {
      orgId: toOrgId(ORG), threadId: THREAD,
      todos: [{ content: "调研竞品", status: "in_progress" }],
    });
    expect(second.revision).toBe(1);
    expect(second.engineEpoch).toBe(1);

    const rows = await readLedgerRows();
    expect(rows.map((r) => r.revision)).toEqual([0, 1]);
    expect(rows.map((r) => r.engine_epoch)).toEqual([0, 1]);
  });

  it("I-6 内容逐字相等即继承 planStepId，内容不同则新发", async () => {
    await ingestEnginePlanSnapshot(repo, {
      orgId: toOrgId(ORG), threadId: THREAD,
      todos: [
        { content: "调研竞品", status: "pending" },
        { content: "写方案", status: "pending" },
      ],
    });
    const first = await readLedgerRows();
    const firstSteps = first[0]!.steps as Array<{ planStepId: string; content: string }>;
    const researchId = firstSteps.find((s) => s.content === "调研竞品")!.planStepId;
    const draftId = firstSteps.find((s) => s.content === "写方案")!.planStepId;

    // 第二次快照：「调研竞品」逐字不变（应继承），「写方案」改成「写方案（含定价）」（应新发）。
    await ingestEnginePlanSnapshot(repo, {
      orgId: toOrgId(ORG), threadId: THREAD,
      todos: [
        { content: "调研竞品", status: "in_progress" },
        { content: "写方案（含定价）", status: "pending" },
      ],
    });
    const second = await readLedgerRows();
    const secondSteps = second[1]!.steps as Array<{ planStepId: string; content: string }>;
    expect(secondSteps.find((s) => s.content === "调研竞品")!.planStepId).toBe(researchId);
    const newDraft = secondSteps.find((s) => s.content === "写方案（含定价）")!;
    expect(newDraft.planStepId).not.toBe(draftId);
  });

  it("I-3：planStepId 集合在生命周期内稳定——继承的条目集合是旧集合的子集", async () => {
    await ingestEnginePlanSnapshot(repo, {
      orgId: toOrgId(ORG), threadId: THREAD,
      todos: [{ content: "A", status: "pending" }, { content: "B", status: "pending" }],
    });
    const first = await readLedgerRows();
    const firstIds = new Set(
      (first[0]!.steps as Array<{ planStepId: string }>).map((s) => s.planStepId),
    );

    await ingestEnginePlanSnapshot(repo, {
      orgId: toOrgId(ORG), threadId: THREAD,
      todos: [{ content: "A", status: "completed" }, { content: "B", status: "in_progress" }],
    });
    const second = await readLedgerRows();
    const secondIds = (second[1]!.steps as Array<{ planStepId: string }>).map((s) => s.planStepId);
    for (const id of secondIds) expect(firstIds.has(id)).toBe(true);
  });

  it("I-9：origin='engine' 的行 constraints 恒为空数组", async () => {
    await ingestEnginePlanSnapshot(repo, {
      orgId: toOrgId(ORG), threadId: THREAD,
      todos: [{ content: "A", status: "pending" }],
    });
    const rows = await readLedgerRows();
    const steps = rows[0]!.steps as Array<{ constraints: unknown[] }>;
    for (const s of steps) expect(s.constraints).toEqual([]);
  });
});
