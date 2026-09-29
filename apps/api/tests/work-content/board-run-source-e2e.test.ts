/**
 * CT10 —— 真实 PostgreSQL：PgBoardRunSource + listBoardRunCards（UC-WC-7 / I-C12 / E10）。
 * 实例、定义标题、seq=1 发起输入（projectId / 发起对象）、参与 Agent 链（副作用 receipt provenance）、
 * Agent 显示名 / 插画头像 / 官方数字人编号全从库里读。
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
import { addProjectMember, asOwner, ensureDatabase, migrateOnce, resetOrgs } from "../support/db";
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

  it("他人 >500 条更新的运行不会把成员自己的卡挤出（LIMIT 前按发起人收窄）", async () => {
    const cols = await asOwner(async (c) =>
      (await c.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'workflow_instances' ORDER BY ordinal_position",
      )).rows.map((r) => r.column_name));
    const sel = cols.map((col) =>
      col === "id" ? "'wi-ct10-bulk-' || g" : col === "initiator_user_id" ? "$3" : col === "created_at" ? "now() + g * interval '1 second'" : `i.${col}`);
    await asOwner((c) => c.query(
      `INSERT INTO workflow_instances (${cols.join(",")})
         SELECT ${sel.join(",")} FROM workflow_instances i, generate_series(1, 520) g
          WHERE i.org_id = $1 AND i.id = $2`,
      [ORG, "wi-ct10-b", BOB],
    ));
    const { cards } = await listBoardRunCards(deps(), { orgId: ORG, viewerUserId: ALICE });
    expect(ids(cards)).toEqual(["workflow_run:wi-ct10-a", "workflow_run:wi-ct10-c"]);
  });

  it("参与 Agent 链与头像来自真实数据：发起 Agent（插画头像 + 官方数字人编号）+ 已 finalize 副作用 provenance 里的 Agent", async () => {
    const HELPER = "agent-ct10-helper";
    const GHOST = "agent-ct10-ghost";
    await asOwner(async (c) => {
      for (const id of [HELPER, GHOST]) {
        await c.query(
          `INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
           VALUES ($1,$2,$1,$3,'enabled',$4,now(),now())`,
          [id, ORG, id === HELPER ? "研究助理" : "未完成者", WF03_ADMIN],
        );
      }
      await c.query(
        `UPDATE agents SET avatar = '{"kind":"illustration","key":"person-7","alt":"销售"}'::jsonb, catalog_source = 'official'
          WHERE org_id = $1 AND id = $2`,
        [ORG, AGENT],
      );
      await c.query(
        `INSERT INTO capability_listings (id,org_id,kind,name,scope,enabled,abbr,duty,role_label) VALUES ($1,$2,'agent',$1,'org-wide',true,'D005','Sales Representative','Sales Representative')`,
        [AGENT, ORG],
      );
      const receipt = (key: string, agentId: string, finalized: boolean, at: string) =>
        c.query(
          `INSERT INTO workflow_receipts (org_id, scope, request_key, fingerprint, status, instance_id, stable_response, created_at, finalized_at)
           VALUES ($1,'effect',$2,'fp',$3,'wi-ct10-a',$4::jsonb,$5::timestamptz,$6::timestamptz)`,
          [ORG, key, finalized ? "finalized" : "begun",
            finalized ? JSON.stringify({ result: {}, provenance: { initiatorUserId: ALICE, agentId, agentVersionId: "v", approvalRequestId: null } }) : null,
            at, finalized ? at : null],
        );
      await receipt("wi-ct10-a/s2/e1", HELPER, true, "2026-09-29T01:00:00Z");
      await receipt("wi-ct10-a/s1/e1", AGENT, true, "2026-09-29T00:30:00Z");
      await receipt("wi-ct10-a/s3/e1", GHOST, false, "2026-09-29T02:00:00Z");
    });
    const { cards } = await listBoardRunCards(deps(), { orgId: ORG, viewerUserId: ALICE });
    expect(() => workContent.operations.listBoardRunCards.out.parse({ cards })).not.toThrow();
    const a = cards.find((c) => c.instanceId === "wi-ct10-a")!;
    expect(a.agents).toEqual([
      { agentId: AGENT, digitalHumanId: "D005", displayName: AGENT, avatarKey: "person-7", avatarUrl: null },
      { agentId: HELPER, digitalHumanId: null, displayName: "研究助理", avatarKey: null, avatarUrl: null },
    ]);
    // 没有副作用 receipt 的运行只剩发起 Agent
    expect(cards.find((c) => c.instanceId === "wi-ct10-c")!.agents.map((x) => x.agentId)).toEqual([AGENT]);
  });

  it("伪造 projectId 不放大可见集：他人把运行挂到成员能看的项目上，成员仍看不到（可见边界是 canView）", async () => {
    await seedRun("wi-ct10-forged", BOB, "running", { projectId: "p-1" });
    const { cards } = await listBoardRunCards(deps(), { orgId: ORG, viewerUserId: ALICE, projectId: "p-1" });
    expect(ids(cards)).toEqual(["workflow_run:wi-ct10-a"]);
    const unknown = await listBoardRunCards(deps(), { orgId: ORG, viewerUserId: ALICE, projectId: "p-does-not-exist" });
    expect(unknown.cards).toEqual([]);
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

    it("任务 Board GET /tasks 的项目视图与全局视图都合并了运行卡，两视图卡 ID 集合相同，他人运行卡不存在", async () => {
      const PROJECT = `proj-${ORG}`;
      await addProjectMember(ORG, PROJECT, ALICE, "member", null);
      await seedRun("wi-ct10-proj-mine", ALICE, "awaiting_gate_decision", { projectId: PROJECT });
      await seedRun("wi-ct10-proj-bob", BOB, "running", { projectId: PROJECT });
      type Out = { runCards: { id: string }[]; columns: { status: string; cardIds: string[] }[]; cards: { id: string; status: string }[] };
      const get = (scope: string) => as(e, ALICE, ORG).get<Out>(`/tasks?scope=${scope}&projectId=${PROJECT}`);
      const [proj, glob] = [await get("project"), await get("global")];
      expect([proj.status, glob.status]).toEqual([200, 200]);
      const reach = (o: Out, withInbox: boolean) =>
        [...o.columns.flatMap((c) => c.cardIds), ...(withInbox ? o.cards.filter((c) => c.status === "inbox").map((c) => c.id) : [])].sort();
      expect(ids(proj.body.runCards)).toEqual(["workflow_run:wi-ct10-proj-mine"]);
      expect(reach(proj.body, true)).toEqual(reach(glob.body, false));
      expect(reach(glob.body, false)).toContain("workflow_run:wi-ct10-proj-mine");
      expect(reach(glob.body, false)).not.toContain("workflow_run:wi-ct10-proj-bob");
      expect(proj.body.columns.find((c) => c.status === "review")!.cardIds).toContain("workflow_run:wi-ct10-proj-mine");
    });
  });
});
