/**
 * Phase 18 F14 —— 北极星端到端：「上次聊过的事，这次 AI 记得且说得出出处」。
 *
 * 一条连续的用户旅程，走完整应用（真 HTTP / 真受理 / 真抽取 tick / 真 AGE 投影 / 真执行器召回 / 真写回 /
 * 真读接口），夹具与替身的边界见 kg-e2e-fixtures.ts 文件头。
 *
 *   ① uc-18-2 V1：会话 A 前文说「张三决定下周一上线 v2」「因为客户 A 要求 …」→ 20 轮闲聊之后问
 *      「上线 v2 是谁定的、为什么」→ 模型收到的记忆里有两条、回答里有张三与客户 A；回答下方的两处引用
 *      （getTurnMemory）各带图路径，点开来源（getClaimSources）分别回到那两条原消息。
 *   ② uc-18-4 V1：在会话 A 里确认并「存入个人空间」→ 新会话 B 问「客户 A 有什么要求」→ 召回个人空间那条，
 *      交给模型的材料与回答都标「来自个人空间知识」，引用点回会话 A 的原消息。
 *   ③ S4 删除失效：删掉「客户 A 要求」那条原消息 ⇒ 不等投影 worker，下一轮 A / B 都不再召回（L0 与 L1 副本
 *      一起失效）、旧回答下方的引用也把它去掉、来源抽屉 404；张三那条不受影响。再用真「删除会话」接口
 *      删掉另一个存过个人空间知识的会话 D ⇒ 它的个人空间副本也退出召回。全部在 5 分钟 SLA 之内
 *      （实际与删除同一事务：召回以 canonical 为准，不等投影 worker）。
 *
 * ## 为什么那两句原话不走受理接口（issue #3553）
 *
 * 经 POST /chat/threads/:id/messages 受理的每一条人类消息都挂着一个 agent run；run 的步骤账本
 * （agent_run_steps 等）是 append-only 的，触发器只给「整个组织被删」放行。于是今天删一条**触发过 AI
 * 回答**的消息、或删一个**有过 AI 回答**的会话，都会被账本触发器拒绝（删会话接口回 500）——这是
 * 已登记的开放缺陷 #3553，不在本 feature 范围。为了在同一条路径上证明 S4（删掉的来源不再被召回），
 * 被删的来源用「没有触发 AI 回答」的人类消息落库（与受理接口写的是同一张表、同一个抽取触发器）；
 * 提问、20 轮闲聊与所有回答仍走真受理 + 真执行器。#3553 修好后，这里应改为经受理接口发出原话。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { addOrgMember, asApp, asOwner, resetOrgs, seedOrg } from "../support/db";
import {
  ASK_DEMAND, ASK_WHO_WHY, DECISION, DEMAND, FILLER, NOTHING_FOUND, RELEASE, SAY_DECISION, SAY_DEMAND, SAY_RELEASE,
  client, memoryPath, messageRow, projectGraph, publishAgent, settleKnowledge, sourcesPath, startApp, turn,
  type ClaimSourcesBody, type Client, type E2eApp, type ThreadKnowledgeBody, type Turn, type TurnMemoryBody,
} from "./kg-e2e-fixtures";
import { enableExtraction } from "./kg-extraction-fixtures";

const ORG = "org-kg-f14-north-star";
const A = "thr-f14-ns-a";
const B = "thr-f14-ns-b";
const D = "thr-f14-ns-d";
const OWNER = "u-f14-owner";
const AGENT = "agent-f14-ns";
const S4_SLA_MS = 5 * 60 * 1000;
/** 404 的响应体除了 traceId 应与「根本不存在」逐字相同（失效 / 看不见 / 不存在同一个出口）。 */
const stripTrace = (b: unknown) => ({ ...(b as Record<string, unknown>), traceId: undefined });

let e: E2eApp;
let me: Client;
const say = (threadId: string, text: string) => turn(e, me, ORG, threadId, text, AGENT);

/** 旅程里逐步积累下来的事实，后面的步骤引用前面的结果。 */
const j: {
  decisionMsg?: string; demandMsg?: string; ask?: Turn;
  decisionClaim?: string; demandClaim?: string;
  personalDecision?: string; personalDemand?: string; askB?: Turn;
} = {};

beforeAll(async () => {
  e = await startApp();
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: `${ORG}-p` });
  await enableExtraction(ORG);
  await addOrgMember(ORG, OWNER, "consultant", null);
  await publishAgent(ORG, AGENT, OWNER);
  // 两条个人线程（无项目、仅本人）：A 是「上次」的对话，B 是之后开的新对话
  await addChatThread({ orgId: ORG, id: A, projectId: null, visibilityScope: "private", createdBy: OWNER, title: "v2 上线" });
  await addChatThread({ orgId: ORG, id: B, projectId: null, visibilityScope: "private", createdBy: OWNER, title: "新对话" });
  me = client(e, OWNER, ORG);
}, 180_000);

afterAll(async () => {
  await e?.app.close();
});

describe("F14 北极星 ① uc-18-2 V1：会话内召回，两处引用点回原消息", () => {
  it("会话 A：说出决定与原因，再聊 20 轮无关的事；知识由抽取 worker 真实入图并投影", async () => {
    // 这两句原话以「没有触发 AI 回答」的人类消息落库（见文件头「为什么这两句不走受理接口」）
    j.decisionMsg = "m-f14-ns-decision";
    j.demandMsg = "m-f14-ns-demand";
    await addChatMessage({ orgId: ORG, id: j.decisionMsg, threadId: A, body: SAY_DECISION, authorId: OWNER });
    await addChatMessage({ orgId: ORG, id: j.demandMsg, threadId: A, body: SAY_DEMAND, authorId: OWNER });
    for (const f of FILLER) await say(A, f);
    await settleKnowledge(e, ORG);

    const k = await me.get<ThreadKnowledgeBody>(`/knowledge-graph/threads/${A}`);
    expect(k.status).toBe(200);
    const byText = new Map(k.body.claims.map((c) => [c.statement, c]));
    expect([...byText.keys()].sort()).toEqual([DECISION, DEMAND].sort());
    j.decisionClaim = byText.get(DECISION)!.id;
    j.demandClaim = byText.get(DEMAND)!.id;
    expect(byText.get(DECISION)!.triState).toBe("pending");
  }, 120_000);

  it("20 轮后问「上线 v2 是谁定的、为什么」：模型收到两条记忆，回答里有张三与客户 A", async () => {
    j.ask = await say(A, ASK_WHO_WHY);
    const memory = j.ask.memory;
    expect(memory).not.toBeNull();
    expect(memory).toContain(`[AI 记下的] ${DECISION}`);
    expect(memory).toContain(`[AI 记下的] ${DEMAND}`);
    // 模型只照着记忆作答：回答里的张三与客户 A 来自这一轮真实交给它的材料
    expect(j.ask.answer).toContain("张三");
    expect(j.ask.answer).toContain("客户 A");
    expect(j.ask.answer).not.toContain(NOTHING_FOUND);
    // 回答真的写回了会话（用户在消息流里看得到）
    const page = await me.get<{ messages: Array<{ id: string; text: string; authorKind: string }> }>(`/chat/threads/${A}/messages?limit=100`);
    expect(page.status).toBe(200);
    expect(JSON.stringify(page.body)).toContain(j.ask.answerId);
  });

  it("回答下方的引用：两条都在、带「为什么召回」与图路径（问题里的 v2 → 结论）", async () => {
    const r = await me.get<TurnMemoryBody>(memoryPath(A, j.ask!.answerId));
    expect(r.status).toBe(200);
    expect(r.body.recallDegraded).toBe(false);
    const ids = r.body.recalled.map((m) => m.claimId);
    expect(ids).toEqual(expect.arrayContaining([j.decisionClaim, j.demandClaim]));
    // 问「谁定的」：决定类排第一（F08 查询意图）
    expect(r.body.recalled[0]!.claimId).toBe(j.decisionClaim);
    for (const m of r.body.recalled) {
      expect(m.scope).toBe("chat_session");
      expect(m.channels).toEqual(["fts", "graph"]);
      expect(m.retrievalReasons).toEqual(["recall", "lead"]);
      expect(m.graphPath).not.toBeNull();
      expect(m.graphPath!.some((h) => h.from === "v2" || h.to === "v2")).toBe(true);
    }
  });

  it("点引用 → 来源抽屉：张三那条回到「张三决定…」原消息，客户 A 那条回到「因为客户 A 要求…」原消息", async () => {
    for (const [claimId, messageId, said] of [
      [j.decisionClaim!, j.decisionMsg!, SAY_DECISION], [j.demandClaim!, j.demandMsg!, SAY_DEMAND],
    ] as const) {
      const r = await me.get<ClaimSourcesBody>(sourcesPath(claimId));
      expect(r.status).toBe(200);
      expect(r.body.evidence).toEqual([expect.objectContaining({ sourceKind: "chat_message", sourceRef: messageId, revoked: false })]);
      const msg = await messageRow(ORG, r.body.evidence[0]!.sourceRef);
      expect(msg).toEqual({ thread_id: A, body: said });
      expect(said).toContain(r.body.evidence[0]!.excerpt);
    }
  });
});

describe("F14 北极星 ② uc-18-4 V1：确认并存入个人空间，新会话 B 跨会话召回并标来源", () => {
  it("在会话 A 里确认两条，再「存入个人空间」", async () => {
    const k = await me.get<ThreadKnowledgeBody>(`/knowledge-graph/threads/${A}`);
    const confirm = await me.post<{ revision: number }>(`/knowledge-graph/threads/${A}/actions`, {
      basedOnRevision: k.body.revision, action: { type: "confirmClaims", claimIds: [j.decisionClaim, j.demandClaim] },
    });
    expect(confirm.status, JSON.stringify(confirm.body)).toBe(200);
    const promoted = await me.post<{ results: Array<{ claimId: string; outcome: string; personalClaimId?: string }> }>(
      `/knowledge-graph/threads/${A}/promote`, { claimIds: [j.decisionClaim, j.demandClaim] });
    expect(promoted.status, JSON.stringify(promoted.body)).toBe(200);
    const byId = new Map(promoted.body.results.map((r) => [r.claimId, r]));
    j.personalDecision = byId.get(j.decisionClaim!)!.personalClaimId;
    j.personalDemand = byId.get(j.demandClaim!)!.personalClaimId;
    expect(j.personalDecision).toEqual(expect.any(String));
    expect(j.personalDemand).toEqual(expect.any(String));
    await projectGraph(e);
  });

  it("新会话 B 问「客户 A 有什么要求」：模型收到的材料标「来自个人空间知识」+ 最早那次对话的日期", async () => {
    j.askB = await say(B, ASK_DEMAND);
    const [said] = await asOwner(async (c) => (await c.query<{ d: string }>(
      "SELECT to_char(created_at AT TIME ZONE 'UTC', 'MM/DD') AS d FROM chat_messages WHERE id = $1", [j.demandMsg])).rows);
    expect(j.askB.memory).toContain(`- [你确认过] ${DEMAND}（来自个人空间知识，最早见于你 ${said!.d} 的对话）`);
    expect(j.askB.memory).toContain("标了「来自个人空间知识」的，引用时也照样标出");
    expect(j.askB.answer).toContain(DEMAND);
    expect(j.askB.answer).toContain("来自个人空间知识");
  });

  it("回答下方的引用：scope=personal、你确认过、带日期与图路径；点开回到会话 A 的原消息", async () => {
    const r = await me.get<TurnMemoryBody>(memoryPath(B, j.askB!.answerId));
    expect(r.status).toBe(200);
    const top = r.body.recalled[0]!;
    expect(top).toMatchObject({ claimId: j.personalDemand, statement: DEMAND, scope: "personal", triState: "confirmed" });
    expect(top.saidAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(top.graphPath).toEqual([{ from: "客户 A", relation: "about", to: DEMAND }]);
    const src = await me.get<ClaimSourcesBody>(sourcesPath(j.personalDemand!));
    expect(src.status).toBe(200);
    expect(src.body.claim).toMatchObject({ id: j.personalDemand, scope: { kind: "personal", id: OWNER }, derivedFromClaimId: j.demandClaim });
    expect(src.body.evidence).toEqual([expect.objectContaining({ sourceKind: "chat_message", sourceRef: j.demandMsg, revoked: false })]);
    expect((await messageRow(ORG, j.demandMsg!))?.thread_id).toBe(A);
    expect(src.body.provenance.map((p) => p.action)).toContain("promoteToPersonal");
  });
});

describe("F14 北极星 ③ S4：删原消息 / 删会话后 5 分钟内不再召回", () => {
  it("删掉「因为客户 A 要求…」那条原消息：不等投影 worker，A 与 B 的下一轮都不再召回它，张三那条仍在", async () => {
    const t0 = Date.now();
    await asApp(ORG, (c) => c.query("DELETE FROM chat_messages WHERE org_id = $1 AND id = $2", [ORG, j.demandMsg]));

    const inA = await say(A, ASK_WHO_WHY);
    expect(inA.memory).toContain(DECISION);
    expect(inA.memory).not.toContain(DEMAND);
    expect(inA.answer).not.toContain("客户 A");
    const inB = await say(B, ASK_DEMAND);
    expect(inB.memory ?? "").not.toContain(DEMAND);
    expect(inB.answer).not.toContain(DEMAND);
    // 之前那两条回答下方的引用也把它去掉了
    const oldA = await me.get<TurnMemoryBody>(memoryPath(A, j.ask!.answerId));
    expect(oldA.body.recalled.map((m) => m.claimId)).toEqual([j.decisionClaim]);
    const oldB = await me.get<TurnMemoryBody>(memoryPath(B, j.askB!.answerId));
    expect(oldB.body.recalled.map((m) => m.claimId)).not.toContain(j.personalDemand);
    // 来源抽屉：L0 原结论与它的个人空间副本都与「不存在」同一个出口
    for (const id of [j.demandClaim!, j.personalDemand!]) {
      const r = await me.get(sourcesPath(id));
      expect(r.status).toBe(404);
      expect(stripTrace(r.body)).toEqual(stripTrace((await me.get(sourcesPath("clm-no-such-claim"))).body));
    }
    expect(Date.now() - t0).toBeLessThan(S4_SLA_MS);
    // 投影 worker 跟上之后图里也没有了
    await projectGraph(e);
    const [g] = await asOwner(async (c) => (await c.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM kg_live_vertices($1) WHERE key = ANY($2::text[])",
      [ORG, [`claim:${j.demandClaim}`, `claim:${j.personalDemand}`]])).rows);
    expect(g!.n).toBe("0");
  });

  it("B 里问「上线 v2 是谁定的」：张三那条的个人空间副本仍被召回（删除只影响被删的来源）", async () => {
    const r = await say(B, ASK_WHO_WHY);
    expect(r.memory).toContain(`${DECISION}（来自个人空间知识`);
    expect(r.memory).not.toContain(DEMAND);
    expect(r.answer).toContain("张三");
  });

  it("用真「删除会话」接口删掉会话 D ⇒ 从它存进个人空间的那条退出召回，B 的回答与引用里都没有了", async () => {
    // 会话 D：另一次对话里说过「v2 的发布说明由李四来写」，确认并存入个人空间
    await addChatThread({ orgId: ORG, id: D, projectId: null, visibilityScope: "private", createdBy: OWNER, title: "发布说明" });
    await addChatMessage({ orgId: ORG, id: "m-f14-ns-release", threadId: D, body: SAY_RELEASE, authorId: OWNER });
    await settleKnowledge(e, ORG);
    const k = await me.get<ThreadKnowledgeBody>(`/knowledge-graph/threads/${D}`);
    const releaseClaim = k.body.claims.find((c) => c.statement === RELEASE)!.id;
    const promoted = await me.post<{ results: Array<{ claimId: string; personalClaimId?: string }> }>(
      `/knowledge-graph/threads/${D}/promote`, { claimIds: [releaseClaim] });
    expect(promoted.status, JSON.stringify(promoted.body)).toBe(200);
    const personalRelease = promoted.body.results[0]!.personalClaimId!;
    await projectGraph(e);
    const before = await say(B, "v2 的发布说明谁来写？");
    expect(before.memory).toContain(`${RELEASE}（来自个人空间知识`);
    expect((await me.get<TurnMemoryBody>(memoryPath(B, before.answerId))).body.recalled.map((m) => m.claimId)).toContain(personalRelease);

    const [row] = await asOwner(async (c) => (await c.query<{ version: number }>("SELECT version FROM chat_threads WHERE id = $1", [D])).rows);
    const t0 = Date.now();
    const del = await me.post("/chat/threads/mutate", {
      op: "delete", projectId: null, threadId: D, groupId: null, title: null, visibilityScope: null,
      expectedVersion: row!.version, reason: "F14 S4",
    });
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    const after = await say(B, "v2 的发布说明谁来写？");
    expect(after.memory ?? "").not.toContain(RELEASE);
    expect(after.answer).not.toContain("李四");
    // 之前那条回答下方的引用也去掉了；来源抽屉与「不存在」同一个出口
    expect((await me.get<TurnMemoryBody>(memoryPath(B, before.answerId))).body.recalled.map((m) => m.claimId)).not.toContain(personalRelease);
    const src = await me.get(sourcesPath(personalRelease));
    expect(src.status).toBe(404);
    expect(Date.now() - t0).toBeLessThan(S4_SLA_MS);
    // 数据层：个人空间里只剩张三那条（会话 A 没被删）
    const live = await e.recall.candidates(toOrgId(ORG), OWNER, B);
    expect(live.claims.map((c) => c.id)).toEqual([j.personalDecision]);
  });
});
