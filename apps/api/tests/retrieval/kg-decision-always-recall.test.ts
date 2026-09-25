/**
 * Ad-hoc（issue #4181，2026-09-25）—— 本会话内「决定类」结论不管字面/图路打分，都额外强制带上
 * （见 `domain/knowledge-graph/decision-claim.ts` 与 `fuseRecall` 的集成注释）。
 *
 * 真实数据库、真实 `recallThreadKnowledge`：验证这条新行为在真正的候选集（`candidates()` 已经做过
 * 的作用域裁剪）之上是「纯粹的排序后处理」，不引入新的读路径，也不破坏零越权 / 零跨线程泄露。
 *   - issue 原始报告的复现：「开始写报告吧」不会字面命中「我决定关注在 211 高校」，旧算法会漏掉；
 *   - 本会话之外（另一个个人对话）记下的决定类，不经这条新路径强制带上（本轮范围只认本会话）；
 *   - 已撤销的决定类，从不出现（`candidates()` 只返回活结论，这条新逻辑不需要也不会绕过它）；
 *   - 超过上限（3 条）时按最近证据时间取，多出来的不进来。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recallThreadKnowledge } from "../../src/application/knowledge-graph/recall-knowledge";
import { lexicalScore, lexicalTokens } from "../../src/domain/knowledge-graph/recall";
import { toOrgId } from "../../src/domain/org-id";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { PgKnowledgeRecall } from "../../src/infrastructure/knowledge-graph/pg-knowledge-recall";
import { addChatThread } from "../support/chat-db";
import { asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const ORG = "org-kg-f4181-decision";
const T1 = "thr-kg-f4181-t1"; // issue 原始场景：本会话有一条决定类，问题跟它字面/图路都不相关
const T2 = "thr-kg-f4181-t2"; // 本人另一个个人对话：验证「本会话之外不强制带上」
const T3 = "thr-kg-f4181-t3"; // 已撤销的决定类
const T4 = "thr-kg-f4181-t4"; // 超过上限（4 条决定类，只留 3 条）
let db: PgDatabase;
let port: PgKnowledgeRecall;
const noLog = () => undefined;
const recall = (threadId: string, query: string) =>
  recallThreadKnowledge(port, { orgId: toOrgId(ORG), userId: "u-owner", threadId, query }, noLog);

/** 直接写一条活结论（跳过抽取管线，只为造边界——同 `kg-own-personal-threads-recall.test.ts` 的写法）。 */
async function insertClaim(id: string, statement: string, scopeId: string): Promise<void> {
  await asOwner((c) => c.query(
    `INSERT INTO claims (id, org_id, statement, status, tsv, claim_kind, confidence, created_by, reviewed_by, scope_kind, scope_id, valid_from)
     VALUES ($1, $2, $3, 'accepted', to_tsvector('simple', $3), 'fact', 1, 'human', 'u-owner', 'chat_session', $4, now())`,
    [id, ORG, statement, scopeId],
  ));
}

/** 撤销一条结论（同 F17「忘掉」落地后的状态：`revoked_at` 非空，`candidates()` 的 LIVE 口径会把它筛掉）。 */
async function revokeClaim(id: string): Promise<void> {
  await asOwner((c) => c.query("UPDATE claims SET revoked_at = now(), revocation_reason = 'user_forgot' WHERE id = $1", [id]));
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: `${ORG}-p` });
  for (const t of [T1, T2, T3, T4]) {
    await addChatThread({ orgId: ORG, id: t, projectId: null, visibilityScope: "private", createdBy: "u-owner" });
  }
  db = new PgDatabase(appConfig());
  port = new PgKnowledgeRecall(db);

  // T1：issue 原始场景那句话，外加基线的一条无关事实（证明「不相关的事实不会被顺带捎上」）。
  await insertClaim("f4181-t1-dec", "我决定关注在 211 高校", T1);
  await insertClaim("f4181-t1-fact", "季度预算已经批下来了", T1);

  // T2：本人另一个个人对话里的决定类——本轮范围只认本会话，这条不该在 T1 的召回里出现。
  await insertClaim("f4181-t2-dec", "我决定把预算全部转给市场部", T2);

  // T3：一条决定类，随后撤销。
  await insertClaim("f4181-t3-dec", "我决定砍掉这个项目", T3);
  await revokeClaim("f4181-t3-dec");

  // T4：四条决定类，证明超过上限（3）只留最新的几条。
  await insertClaim("f4181-t4-a", "我决定优先做 A 项目", T4);
  await insertClaim("f4181-t4-b", "我决定优先做 B 项目", T4);
  await insertClaim("f4181-t4-c", "我决定优先做 C 项目", T4);
  await insertClaim("f4181-t4-d", "我决定优先做 D 项目", T4);
});
afterAll(async () => { await db.close(); });

describe("ad-hoc issue #4181: 本会话决定类结论强制带上，边界与既有不变量都守住", () => {
  it("issue 原始复现：旧算法（纯字面）会漏掉这条决定，新行为下它仍然出现", async () => {
    // 先证明「旧行为会漏掉」：字面分数是 0，压根进不了 minLexical 的门槛。
    expect(lexicalScore(lexicalTokens("开始写报告吧"), "我决定关注在 211 高校")).toBe(0);
    const r = await recall(T1, "开始写报告吧");
    const ids = r.items.map((i) => i.claim.id);
    expect(ids).toContain("f4181-t1-dec");
    expect(r.items.find((i) => i.claim.id === "f4181-t1-dec")!.channels).toEqual(["claim"]);
    // 无关的事实结论不会被这条新逻辑顺带捎上（它不是决定类，字面也不相关）。
    expect(ids).not.toContain("f4181-t1-fact");
  });

  it("本人另一个个人对话里的决定类：不经这条新路径强制带上（本轮范围只认本会话）", async () => {
    const r = await recall(T1, "跟供应商预算完全无关的问题");
    expect(r.items.map((i) => i.claim.id)).not.toContain("f4181-t2-dec");
    // 也确认它确实进了候选集（不是因为候选集里压根没有这条，而是强制召回这一步刻意没选它）：
    const { claims } = await port.candidates(toOrgId(ORG), "u-owner", T1);
    expect(claims.some((c) => c.id === "f4181-t2-dec")).toBe(true);
    expect(claims.find((c) => c.id === "f4181-t2-dec")?.originThreadId).toBe(T2);
  });

  it("已撤销的决定类：candidates() 已经把它筛掉，召回结果里不会出现", async () => {
    const { claims } = await port.candidates(toOrgId(ORG), "u-owner", T3);
    expect(claims.some((c) => c.id === "f4181-t3-dec")).toBe(false);
    const r = await recall(T3, "毫不相关的问题");
    expect(r.items.map((i) => i.claim.id)).not.toContain("f4181-t3-dec");
  });

  it("超过上限（3 条）：四条决定类只留 3 条，多出来的那条不进来", async () => {
    const r = await recall(T4, "跟这四个项目完全无关的问题");
    const ids = r.items.map((i) => i.claim.id).filter((id) => id.startsWith("f4181-t4-"));
    expect(ids).toHaveLength(3);
  });
});
