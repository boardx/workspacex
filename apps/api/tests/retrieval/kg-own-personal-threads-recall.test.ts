/**
 * Phase 18 F15 —— 本人其他个人对话里记下的，新会话里零操作就能被记起（06-UX R2 M1 / R3-1，评测 E1）。
 *
 * 「个人空间 = 同一用户全部个人线程」（S0-2=A）：在本人的个人对话里提问，候选集除了本会话与长期记忆，
 * 还有本人**其他个人对话**里记下的活结论（按个人空间报，出处是原会话）。边界逐条钉住：
 *   - 项目里的对话不算个人空间：既不被召回进个人对话，在项目对话里提问也不召回个人对话里的；
 *   - 只在发起人自己创建的个人对话里：别人在这个会话里提问（或不是这个人的对话），不带任何个人空间的东西；
 *   - 记到过长期记忆的那条由长期记忆说了算（见 kg-l1-cross-session-recall.test.ts「只出现一次」）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recallThreadKnowledge } from "../../src/application/knowledge-graph/recall-knowledge";
import { toOrgId } from "../../src/domain/org-id";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { PgKnowledgeRecall } from "../../src/infrastructure/knowledge-graph/pg-knowledge-recall";
import { seedRecallOrg } from "../knowledge-graph/kg-recall-fixtures";

const ORG = "org-kg-f15-own-threads";
const A = "thr-kg-f15-a";
const B = "thr-kg-f15-b";
const P = "thr-kg-f15-p";
let db: PgDatabase;
let port: PgKnowledgeRecall;
const noLog = () => undefined;
const recall = (threadId: string, userId = "u-owner") =>
  recallThreadKnowledge(port, { orgId: toOrgId(ORG), userId, threadId, query: "v2 是谁定的？" }, noLog);

beforeAll(async () => {
  db = new PgDatabase(appConfig());
  // A、B 是 u-owner 的两个个人对话，P 挂在项目下；三处都记下了同样三条（同一句话抽出来的）。
  await seedRecallOrg(db, ORG, [A, B, P], "u-owner", { projectThreads: [P] });
  port = new PgKnowledgeRecall(db);
});
afterAll(async () => { await db.close(); });

describe("F15: 本人其他个人对话里记下的，也在召回范围里", () => {
  it("在个人对话 B 里问：B 自己的 + A 里记下的（按个人空间报、带原会话），项目对话 P 的一条都没有", async () => {
    const { claims } = await port.candidates(toOrgId(ORG), "u-owner", B);
    const fromA = claims.filter((c) => c.originThreadId === A);
    expect(fromA.map((c) => c.statement).sort()).toEqual(["季度预算已经批下来了", "张三决定下周一上线 v2", "测试环境不稳定会拖慢 v2"]);
    expect(fromA.every((c) => c.scope === "personal")).toBe(true);
    expect(claims.some((c) => c.originThreadId === P)).toBe(false);
    expect(claims.filter((c) => c.scope === "chat_session")).toHaveLength(3);
    const r = await recall(B);
    expect(r.items.some((i) => i.claim.originThreadId === A && i.claim.statement === "张三决定下周一上线 v2")).toBe(true);
  });

  it("在项目对话 P 里问：只有 P 自己的，不带任何个人对话里的", async () => {
    const { claims } = await port.candidates(toOrgId(ORG), "u-owner", P);
    expect(claims).toHaveLength(3);
    expect(claims.every((c) => c.scope === "chat_session" && c.originThreadId === undefined)).toBe(true);
  });

  it("别人以自己的身份在 B 里（不是他的个人对话）：一条个人空间的都没有", async () => {
    const { claims } = await port.candidates(toOrgId(ORG), "u-someone-else", B);
    expect(claims.some((c) => c.scope === "personal")).toBe(false);
  });
});
