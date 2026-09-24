/**
 * Phase 18 F15 —— 本人其他个人对话里记下的，新会话里零操作就能被记起（06-UX R2 M1 / R3-1，评测 E1）。
 *
 * 「个人空间 = 同一用户全部个人线程」（S0-2=A）：在本人的个人对话里提问，候选集除了本会话与长期记忆，
 * 还有本人**其他个人对话**里记下的活结论（按个人空间报，出处是原会话）。边界逐条钉住，每条都用只在那一处出现的
 * 说法（同样的说法会被「同一件事只出现一次」去重掉，漏了也看不出来）：
 *   - 项目里的对话不算个人空间；归档的对话不算；别人的个人对话不算；
 *   - 只在发起人自己创建的个人对话里：别人以自己的身份在这个会话里，不带任何个人空间的东西；
 *   - 记到过长期记忆的那条由长期记忆说了算（derived_from，哪怕说法改过）；
 *   - 改过的说了算：本人哪个对话里忘掉了同一件事 ⇒ 别处的也不出现；**别人**忘掉同样的说法不影响我的。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recallThreadKnowledge } from "../../src/application/knowledge-graph/recall-knowledge";
import { toOrgId } from "../../src/domain/org-id";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { PgKnowledgeRecall } from "../../src/infrastructure/knowledge-graph/pg-knowledge-recall";
import { seedRecallOrg } from "../knowledge-graph/kg-recall-fixtures";
import { addChatThread } from "../support/chat-db";
import { asOwner } from "../support/db";

const ORG = "org-kg-f15-own-threads";
const A = "thr-kg-f15-a";
const B = "thr-kg-f15-b";
const C = "thr-kg-f15-c";
const P = "thr-kg-f15-p";
/** 归档了的本人个人对话 */
const Z = "thr-kg-f15-z";
/** 别人的个人对话 */
const X = "thr-kg-f15-x";
let db: PgDatabase;
let port: PgKnowledgeRecall;
const noLog = () => undefined;
const recall = (threadId: string, userId = "u-owner") =>
  recallThreadKnowledge(port, { orgId: toOrgId(ORG), userId, threadId, query: "v2 是谁定的？" }, noLog);
const candidates = async (threadId: string, userId = "u-owner") => (await port.candidates(toOrgId(ORG), userId, threadId)).claims;

/** 直接写一条活结论（只为造边界；召回读的是真表）。 */
async function claim(id: string, statement: string, scopeKind: "chat_session" | "personal", scopeId: string, owner = "u-owner"): Promise<void> {
  await asOwner((c) => c.query(
    `INSERT INTO claims (id, org_id, statement, status, tsv, claim_kind, confidence, created_by, reviewed_by, scope_kind, scope_id, valid_from)
     VALUES ($1, $2, $3, 'accepted', to_tsvector('simple', $3), 'fact', 1, 'human', $4, $5, $6, now())`,
    [id, ORG, statement, owner, scopeKind, scopeId]));
}

beforeAll(async () => {
  db = new PgDatabase(appConfig());
  // A、C 是 u-owner 的两个个人对话，P 挂在项目下；三处都记下了同样三条（同一句话抽出来的）。B 是刚开的新对话，什么都没说。
  await seedRecallOrg(db, ORG, [A, C, P], "u-owner", { projectThreads: [P] });
  await addChatThread({ orgId: ORG, id: B, projectId: null, visibilityScope: "private", createdBy: "u-owner" });
  await addChatThread({ orgId: ORG, id: Z, projectId: null, visibilityScope: "private", createdBy: "u-owner" });
  await addChatThread({ orgId: ORG, id: X, projectId: null, visibilityScope: "private", createdBy: "u-other" });
  await asOwner((c) => c.query("UPDATE chat_threads SET archived = true WHERE id = $1", [Z]));
  await claim("clm-f15-p-only", "项目组专属：v2 的采购单归项目组", "chat_session", P);
  await claim("clm-f15-z-only", "归档对话里说过：v2 的旧代号叫青鸟", "chat_session", Z);
  await claim("clm-f15-x-only", "别人的私事：v2 的奖金方案还没定", "chat_session", X, "u-other");
  port = new PgKnowledgeRecall(db);
});
afterAll(async () => { await db.close(); });

describe("F15: 本人其他个人对话里记下的，也在召回范围里", () => {
  it("在新的个人对话 B 里问：A、C 里记下的（同一件事只出现一次，按个人空间报、带原会话）", async () => {
    const claims = await candidates(B);
    expect(claims.map((c) => c.statement).sort()).toEqual(["季度预算已经批下来了", "张三决定下周一上线 v2", "测试环境不稳定会拖慢 v2"]);
    expect(claims.every((c) => c.scope === "personal" && (c.originThreadId === A || c.originThreadId === C))).toBe(true);
    const r = await recall(B);
    expect(r.items[0]).toMatchObject({ claim: { statement: "张三决定下周一上线 v2", scope: "personal" } });
  });

  it("项目对话、归档的对话、别人的个人对话里的一条都不进来", async () => {
    const statements = (await candidates(B)).map((c) => c.statement);
    expect(statements).not.toContain("项目组专属：v2 的采购单归项目组");
    expect(statements).not.toContain("归档对话里说过：v2 的旧代号叫青鸟");
    expect(statements).not.toContain("别人的私事：v2 的奖金方案还没定");
  });

  it("在 A 里问：本会话里有的，不再从 C 拿一份", async () => {
    const claims = await candidates(A);
    expect(claims).toHaveLength(3);
    expect(claims.every((c) => c.scope === "chat_session")).toBe(true);
  });

  it("在项目对话 P 里问：只有 P 自己的，不带任何个人对话里的", async () => {
    const claims = await candidates(P);
    expect(claims.map((c) => c.statement).sort()).toEqual(["季度预算已经批下来了", "张三决定下周一上线 v2", "测试环境不稳定会拖慢 v2", "项目组专属：v2 的采购单归项目组"]);
    expect(claims.every((c) => c.scope === "chat_session" && c.originThreadId === undefined)).toBe(true);
  });

  it("别人以自己的身份在 B 里（不是他的个人对话）：一条个人空间的都没有，他自己个人对话里的也不进来", async () => {
    const claims = await candidates(B, "u-other");
    expect(claims.some((c) => c.scope === "personal")).toBe(false);
    expect(claims.map((c) => c.statement)).not.toContain("别人的私事：v2 的奖金方案还没定");
  });

  it("记到过长期记忆的那条（derived_from，说法已改过）由长期记忆说了算：原对话里的那条不再出现", async () => {
    await claim("clm-f15-c-src", "C 里说过：v2 的发布窗口是周二", "chat_session", C);
    expect((await candidates(B)).map((c) => c.statement)).toContain("C 里说过：v2 的发布窗口是周二");
    await claim("clm-f15-l1", "长期记忆：v2 的发布窗口改在周二晚上", "personal", "u-owner");
    await asOwner((c) => c.query(
      `INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation, created_by, scope_kind, scope_id)
       VALUES ('edg-f15-derived', $1, 'claim', 'clm-f15-l1', 'claim', 'clm-f15-c-src', 'derived_from', 'human', 'personal', 'u-owner')`, [ORG]));
    const statements = (await candidates(B)).map((c) => c.statement);
    expect(statements).toContain("长期记忆：v2 的发布窗口改在周二晚上");
    expect(statements).not.toContain("C 里说过：v2 的发布窗口是周二");
  });

  it("别人忘掉了同样的说法，不影响我的", async () => {
    await claim("clm-f15-mine", "共同的说法：v2 的演示放在周五", "chat_session", C);
    await claim("clm-f15-theirs", "共同的说法：v2 的演示放在周五", "chat_session", X, "u-other");
    await asOwner((c) => c.query("UPDATE claims SET revoked_at = now(), revocation_reason = 'user_forgot' WHERE id = 'clm-f15-theirs'"));
    expect((await candidates(B)).map((c) => c.statement)).toContain("共同的说法：v2 的演示放在周五");
  });

  it("改过的说了算：在 A 里忘掉一条，C 里同样的说法也不再出现在 B 的召回里", async () => {
    await asOwner((c) => c.query(
      "UPDATE claims SET revoked_at = now(), revocation_reason = 'user_forgot' WHERE org_id = $1 AND scope_id = $2 AND statement = '季度预算已经批下来了'", [ORG, A]));
    expect((await candidates(B)).map((c) => c.statement)).not.toContain("季度预算已经批下来了");
  });
});
