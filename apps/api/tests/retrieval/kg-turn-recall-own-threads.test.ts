/**
 * Phase 18 F15 —— 回答下方的引用（getTurnMemory 的读模型）里，「本人其他个人对话里记下的」这一路按查看者复核。
 *
 * 执行器只会把候选集里的 id 记进 kg_turn_recalls；读的时候**再判一次**（F13 的纪律：记录可能被写脏 / 图里是全 org 的 id）。
 * 这里往记录里硬塞三种不该出现的 id，逐条断言读的时候被丢掉，另塞一条该出现的作对照：
 *   - 对照：本人另一个个人对话里的 ⇒ 出现，按个人空间报；
 *   (a) 别人个人对话里的 ⇒ 丢（t.created_by = 查看者）；
 *   (b) 项目对话里的（哪怕是本人建的）⇒ 丢（t.project_id IS NULL）；
 *   (c) 查看者不是当前这个会话的创建者 ⇒ 他自己个人对话里的也丢（here.created_by = 查看者）。
 * 直接调 `PgKnowledgeRead.turnMemory`（读路径本身），不经会话可见性判定——(c) 这种「看得见别人的个人对话」在应用层
 * 本来就进不来，但读路径的这道条件不能依赖上一层，这里单独钉住它。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { discloseDecided, isDisclosed } from "../../src/application/security/permission-filter";
import type { PermissionDecision } from "../../src/domain/identity/permission-decision";
import { toOrgId } from "../../src/domain/org-id";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { PgKnowledgeRead } from "../../src/infrastructure/knowledge-graph/pg-knowledge-read";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const ORG = "org-kg-f15-turn-own";
const ORG_ID = toOrgId(ORG);
const HERE = "thr-f15t-here";       // u-owner 的个人对话（这一轮所在）
const MINE = "thr-f15t-mine";       // u-owner 的另一个个人对话
const THEIRS = "thr-f15t-theirs";   // u-other 的个人对话
const PROJ = "thr-f15t-proj";       // u-owner 建的项目对话
let db: PgDatabase;
let read: PgKnowledgeRead;

async function claim(id: string, statement: string, threadId: string, owner: string): Promise<void> {
  await asOwner((c) => c.query(
    `INSERT INTO claims (id, org_id, statement, status, tsv, claim_kind, confidence, created_by, reviewed_by, scope_kind, scope_id, valid_from)
     VALUES ($1, $2, $3, 'accepted', to_tsvector('simple', $3), 'fact', 1, 'human', $4, 'chat_session', $5, now())`,
    [id, ORG, statement, owner, threadId]));
}

const item = (claimId: string) => ({ claimId, channels: ["fts"], retrievalReasons: ["recall"], score: 0.02, graphPath: null });

/** 这一轮：回答挂在 run 上，记录里放进给定的 id。 */
async function forgedTurn(runId: string, ids: readonly string[]): Promise<string> {
  const answerId = `ans-${runId}`;
  await addChatMessage({ orgId: ORG, id: answerId, threadId: HERE, body: "（回答）", authorId: "agent-1", authorKind: "agent", agentId: "agent-1" });
  await asOwner(async (c) => {
    await c.query("UPDATE chat_messages SET agent_run_id = $1 WHERE id = $2", [runId, answerId]);
    await c.query(
      `INSERT INTO kg_turn_recalls (run_id, org_id, thread_id, requester_user_id, items, graph_degraded) VALUES ($1, $2, $3, 'u-owner', $4::jsonb, false)`,
      [runId, ORG, HERE, JSON.stringify(ids.map(item))]);
  });
  return answerId;
}

const ALLOW = { allowed: true, decisionId: "test-allow" } as unknown as PermissionDecision;
async function recalledAs(viewer: string, answerId: string) {
  const guarded = await read.turnMemory(ORG_ID, viewer, { threadId: HERE, projectId: null }, answerId);
  const d = discloseDecided(guarded, ALLOW);
  if (!isDisclosed(d)) throw new Error("not disclosed");
  return d.payload.recalled;
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: `${ORG}-p` });
  db = new PgDatabase(appConfig());
  read = new PgKnowledgeRead(db);
  await addChatThread({ orgId: ORG, id: HERE, projectId: null, visibilityScope: "private", createdBy: "u-owner" });
  await addChatThread({ orgId: ORG, id: MINE, projectId: null, visibilityScope: "private", createdBy: "u-owner" });
  await addChatThread({ orgId: ORG, id: THEIRS, projectId: null, visibilityScope: "private", createdBy: "u-other" });
  await addChatThread({ orgId: ORG, id: PROJ, projectId: `${ORG}-p`, visibilityScope: "plenary", createdBy: "u-owner" });
  await claim("clm-f15t-mine", "我另一个对话里说的：周报改周四交", MINE, "u-owner");
  await claim("clm-f15t-theirs", "别人的私事：他下周请假", THEIRS, "u-other");
  await claim("clm-f15t-proj", "项目里的：采购单归项目组", PROJ, "u-owner");
});
afterAll(async () => { await db.close(); });

describe("F15: 回答下方的引用，本人其他个人对话这一路按查看者复核", () => {
  it("对照：本人另一个个人对话里的出现，按个人空间报；(a) 别人个人对话里的、(b) 项目对话里的被丢掉", async () => {
    const answerId = await forgedTurn("run-f15t-1", ["clm-f15t-mine", "clm-f15t-theirs", "clm-f15t-proj"]);
    const recalled = await recalledAs("u-owner", answerId);
    expect(recalled.map((r) => [r.claimId, r.scope])).toEqual([["clm-f15t-mine", "personal"]]);
    expect(JSON.stringify(recalled)).not.toMatch(/他下周请假|采购单/);
  });

  it("(c) 查看者不是这个会话的创建者：连他自己个人对话里的也不出现", async () => {
    const answerId = await forgedTurn("run-f15t-2", ["clm-f15t-theirs", "clm-f15t-mine"]);
    const recalled = await recalledAs("u-other", answerId);
    expect(recalled).toEqual([]);
  });
});
