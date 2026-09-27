/**
 * Issue #4363（S6）—— 大脑页的**链式**取代历史（R9 #4302 只折叠一层）。走真实路径（真抽取 tick：#4290 判取代 +
 * #4283 自动记入长期记忆；真 HTTP）：
 *
 *   用户 A（人类原话的例子 211 → 985 → 清华）：
 *     A1「我决定关注 211 高校」→ B1「改成关注 985 高校吧」（自动取代）→ C1「改成关注清华高校吧」
 *     （清华对 985 是汉字对 ASCII 的限定语，#4290 只到「弹卡」一档）→ 卡上点 [取代]。
 *     修之前：985 被取代后 211 找不到活的挂靠点，从大脑页上消失（只剩「清华 ← 985」一层）。
 *     修之后：清华下面从新到旧：985（step 1）、211（step 2，说明是被 985 取代的）；两环都不给撤销
 *     （卡上的「以新的为准」本来就没有撤销；更早的一环要先撤销后一环）。
 *   用户 U（全自动的链，看撤销）：211 → 985 → C9（两次都自动取代）：
 *     C9 下面 985（step 1，带撤销）、211（step 2，不带）；撤销 985 那一环 ⇒ 985 又活了，211 回到 985 下面、带撤销。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { knowledgeGraph as KG } from "@repo/contracts";
import { runExtractionTick } from "../../src/application/knowledge-graph/extract-message-knowledge";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { addOrgMember, asOwner, resetOrgs, seedOrg } from "../support/db";
import { client, startApp, type Client, type E2eApp, type ThreadKnowledgeBody } from "./kg-e2e-fixtures";
import { enableExtraction, extractionDeps, loopbackModel } from "./kg-extraction-fixtures";

const ORG = "org-kg-i4363-chain";
const USER_A = "u-i4363c-a";
const USER_U = "u-i4363c-u";
const S211 = "我决定关注 211 高校";
const S985 = "改成关注 985 高校";
const SQH = "改成关注清华高校";
const SC9 = "改成关注 C9 高校";

const decisionReply = (statement: string) => JSON.stringify({
  entities: [],
  claims: [{ statement, kind: "decision", confidence: 0.9, about: [], decidedBy: null, quote: statement, timeExpr: null }],
});
const MODEL = () => loopbackModel([[S211, decisionReply(S211)], [S985, decisionReply(S985)], [SQH, decisionReply(SQH)], [SC9, decisionReply(SC9)]]).model;

type Personal = import("zod").infer<typeof KG.knowledgeGraph.getPersonalKnowledge.out>;

let e: E2eApp;

async function settle(): Promise<void> {
  const deps = extractionDeps(e.db, MODEL(), ORG);
  for (let i = 0; i < 50; i += 1) {
    const r = await runExtractionTick(deps);
    expect(r.failed).toBe(0);
    if (r.processed === 0) break;
  }
}

async function say(user: string, id: string, threadId: string, body: string): Promise<void> {
  await addChatThread({ orgId: ORG, id: threadId, projectId: null, visibilityScope: "private", createdBy: user, title: threadId });
  await addChatMessage({ orgId: ORG, id, threadId, body, authorId: user });
  await settle();
}

async function personal(api: Client): Promise<Personal> {
  const r = await api.get<Personal>("/knowledge-graph/personal");
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const parsed = KG.knowledgeGraph.getPersonalKnowledge.out.safeParse(r.body);
  expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  return r.body;
}
const idOf = (p: Personal, statement: string) => {
  const c = p.claims.find((x) => x.statement === statement);
  expect(c, `长期记忆里应有「${statement}」：${JSON.stringify(p.claims.map((x) => x.statement))}`).toBeDefined();
  return c!.id;
};
/** 大脑页上某条活记忆下面折叠的历史：[说法, step, 能不能撤销]，按服务端给的顺序。 */
const history = (p: Personal, byClaimId: string) => p.replaced
  .filter((r) => r.byClaimId === byClaimId)
  .map((r) => [r.replaces.statement, r.step ?? 1, r.undo !== null] as const);

beforeAll(async () => {
  e = await startApp();
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: `${ORG}-p` });
  await enableExtraction(ORG);
  for (const u of [USER_A, USER_U]) await addOrgMember(ORG, u, "consultant", fx.teams.energy!);
}, 180_000);

afterAll(async () => {
  await e?.app.close();
});

describe("issue #4363：大脑页完整展示链式取代历史", () => {
  it("211 → 985 → 清华（最后一环是卡上点 [取代]）：清华下面从新到旧 985、211", async () => {
    const a = client(e, USER_A, ORG);
    await say(USER_A, "m-i4363c-a1", "thr-i4363c-a1", `${S211}。`);
    await say(USER_A, "m-i4363c-b1", "thr-i4363c-b1", `${S985}吧`);
    let p = await personal(a);
    expect(history(p, idOf(p, S985))).toEqual([[S211, 1, true]]);

    await say(USER_A, "m-i4363c-c1", "thr-i4363c-c1", `${SQH}吧`);
    const [card] = await asOwner(async (c) => (await c.query<{ id: string }>(
      "SELECT id FROM kg_conflict_prompts WHERE org_id = $1 AND thread_id = $2 AND kind = 'possible_change' AND status = 'open'",
      [ORG, "thr-i4363c-c1"])).rows);
    expect(card, "清华对 985 应当弹「可能改主意了」卡").toBeDefined();
    const k = await a.get<ThreadKnowledgeBody>("/knowledge-graph/threads/thr-i4363c-c1");
    const keep = await a.post("/knowledge-graph/threads/thr-i4363c-c1/actions", {
      basedOnRevision: k.body.revision, action: { type: "resolveConflict", promptId: card!.id, resolution: "keep_new" },
    });
    expect(keep.status, JSON.stringify(keep.body)).toBe(200);

    p = await personal(a);
    const qh = idOf(p, SQH);
    expect(p.claims.map((c) => c.statement)).toEqual([SQH]);
    // 修之前：[[S985, 1, false]]——211 从大脑页上消失
    expect(history(p, qh)).toEqual([[S985, 1, false], [S211, 2, false]]);
    const deeper = p.replaced.find((r) => r.replaces.statement === S211)!;
    expect(deeper.replacedBy).toEqual({ claimId: p.replaced.find((r) => r.replaces.statement === S985)!.replaces.claimId, statement: S985 });
  }, 300_000);

  it("全自动的链 211 → 985 → C9：只有最近一环能撤销；撤销后 211 回到 985 下面、可撤销", async () => {
    const u = client(e, USER_U, ORG);
    await say(USER_U, "m-i4363c-u1", "thr-i4363c-u1", `${S211}。`);
    await say(USER_U, "m-i4363c-u2", "thr-i4363c-u2", `${S985}吧`);
    await say(USER_U, "m-i4363c-u3", "thr-i4363c-u3", `${SC9}吧`);
    let p = await personal(u);
    const c9 = idOf(p, SC9);
    expect(p.claims.map((c) => c.statement)).toEqual([SC9]);
    expect(history(p, c9)).toEqual([[S985, 1, true], [S211, 2, false]]);

    const top = p.replaced.find((r) => r.replaces.statement === S985)!;
    expect(top.undo?.threadId).toBe("thr-i4363c-u3");
    const k = await u.get<ThreadKnowledgeBody>(`/knowledge-graph/threads/${top.undo!.threadId}`);
    const undo = await u.post(`/knowledge-graph/threads/${top.undo!.threadId}/actions`, {
      basedOnRevision: k.body.revision, action: { type: "undoSupersede", noticeId: top.undo!.noticeId },
    });
    expect(undo.status, JSON.stringify(undo.body)).toBe(200);

    p = await personal(u);
    expect(p.claims.map((c) => c.statement).sort()).toEqual([SC9, S985].sort());
    expect(history(p, c9)).toEqual([]);
    expect(history(p, idOf(p, S985))).toEqual([[S211, 1, true]]);
  }, 300_000);

  it("别人读不到这条链", async () => {
    const other = await personal(client(e, USER_U, ORG));
    expect(JSON.stringify(other)).not.toContain(SQH);
  }, 60_000);
});
