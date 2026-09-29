/**
 * CT10 —— 真实 PostgreSQL：PgBoardRunSource + listBoardRunCards（UC-WC-7 / I-C12 / E10）。
 * 实例、定义标题、seq=1 发起输入（projectId / 发起对象）、Agent 显示名全从库里读。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { workContent } from "@repo/contracts";
import { listBoardRunCards } from "../../src/application/board/list-board-run-cards";
import { allReachableCardIds } from "../../src/domain/board/card-projection";
import { projectBoardWithRunCards } from "../../src/domain/board/workflow-run-card";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { PgBoardRunSource } from "../../src/infrastructure/board/pg-board-run-source";
import { PgWorkflowAccess } from "../../src/infrastructure/workflow/pg-workflow-access";
import { asOwner, ensureDatabase, migrateOnce, resetOrgs } from "../support/db";
import { seedWorkflowOrg, WF03_ADMIN } from "../workflow/wf03-fixtures";
import { seedWf04Instance } from "../workflow/wf04-fixtures";
import { as, startWorkflowApp, type Wf03App } from "../workflow/wf03-http";

const ORG = "org-ct10-board";
const ALICE = "u-ct10-alice";
const BOB = "u-ct10-bob";
const AGENT = "agent-ct10";

async function seedRun(id: string, initiator: string, status: string, input: Record<string, unknown>) {
  await seedWf04Instance(ORG, id, { key: "ct10-demo", initiatorUserId: initiator, agentId: AGENT, agentVersionId: `${AGENT}-v1` });
  await asOwner(async (c) => {
    await c.query("UPDATE workflow_instances SET status = $3, state_version = state_version + 1 WHERE org_id = $1 AND id = $2", [ORG, id, status]);
    await c.query(
      `INSERT INTO workflow_events (instance_id, org_id, seq, type, state_version, data)
       VALUES ($1, $2, 1, 'instance_started', 1, $3::jsonb) ON CONFLICT DO NOTHING`,
      [id, ORG, JSON.stringify({ status, definitionVersion: 1, input })],
    );
  });
}

describe("CT10 PgBoardRunSource + listBoardRunCards（真库）", () => {
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
    await seedWorkflowOrg(ORG, [{ userId: ALICE }, { userId: BOB }], AGENT);
    await seedRun("wi-ct10-a", ALICE, "running", { projectId: "p-1", subjectLabel: "Acme 公司" });
    await seedRun("wi-ct10-b", BOB, "failed", { projectId: "p-1" });
    await seedRun("wi-ct10-c", ALICE, "awaiting_gate_decision", {});
  });

  const deps = () => ({ runs: new PgBoardRunSource(db), access: new PgWorkflowAccess(db) });
  const ids = (cards: { id: string }[]) => cards.map((c) => c.id).sort();

  it("成员只看到自己发起的运行；他人运行卡 ID 不存在（E10）", async () => {
    const { cards } = await listBoardRunCards(deps(), { orgId: ORG, viewerUserId: ALICE });
    expect(ids(cards)).toEqual(["workflow_run:wi-ct10-a", "workflow_run:wi-ct10-c"]);
    expect(() => workContent.operations.listBoardRunCards.out.parse({ cards })).not.toThrow();
    const a = cards.find((c) => c.instanceId === "wi-ct10-a")!;
    expect(a.title).toBe("wf04 demo · Acme 公司");
    expect(a.agents.map((x) => x.displayName)).toEqual([AGENT]);
    expect(a.draggable).toBe(false);
    expect(cards.find((c) => c.instanceId === "wi-ct10-c")!.column).toBe("review");
  });

  it("管理员见全部；projectId 在库里按发起输入过滤", async () => {
    const all = await listBoardRunCards(deps(), { orgId: ORG, viewerUserId: WF03_ADMIN });
    expect(ids(all.cards)).toEqual(["workflow_run:wi-ct10-a", "workflow_run:wi-ct10-b", "workflow_run:wi-ct10-c"]);
    const failed = all.cards.find((c) => c.instanceId === "wi-ct10-b")!;
    expect([failed.column, failed.badge]).toEqual(["done", "failed"]);
    const scoped = await listBoardRunCards(deps(), { orgId: ORG, viewerUserId: WF03_ADMIN, projectId: "p-1" });
    expect(ids(scoped.cards)).toEqual(["workflow_run:wi-ct10-a", "workflow_run:wi-ct10-b"]);
    for (const { cards } of [all, scoped]) {
      const res = projectBoardWithRunCards([], cards);
      expect([...allReachableCardIds(res.projectView)].sort()).toEqual([...allReachableCardIds(res.globalView)].sort());
    }
  });

  it("非组织成员一张都没有", async () => {
    expect((await listBoardRunCards(deps(), { orgId: ORG, viewerUserId: "u-ct10-stranger" })).cards).toEqual([]);
  });

  describe("HTTP GET /board/workflow-run-cards（真实 Nest 应用）", () => {
    let e: Wf03App;
    beforeAll(async () => { e = await startWorkflowApp(); }, 120_000);
    afterAll(async () => { await e?.app.close(); });

    it("成员经路由只拿到自己可见的卡；projectId 查询参数生效；未知参数 400", async () => {
      const alice = await as(e, ALICE, ORG).get<{ cards: { id: string }[] }>("/board/workflow-run-cards");
      expect(alice.status).toBe(200);
      expect(ids(alice.body.cards)).toEqual(["workflow_run:wi-ct10-a", "workflow_run:wi-ct10-c"]);
      const scoped = await as(e, WF03_ADMIN, ORG).get<{ cards: { id: string }[] }>("/board/workflow-run-cards?projectId=p-1");
      expect(ids(scoped.body.cards)).toEqual(["workflow_run:wi-ct10-a", "workflow_run:wi-ct10-b"]);
      expect((await as(e, ALICE, ORG).get("/board/workflow-run-cards?bogus=1")).status).toBe(400);
    });
  });
});
