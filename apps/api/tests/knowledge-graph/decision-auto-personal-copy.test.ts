/**
 * issue #4283（人类决定，2026-09-26）—— 本人说出的「决定」自动记进**说话人自己的**个人空间，可撤销。
 *
 * 走真实路径（kg-e2e-fixtures.ts 文件头：完整应用、真抽取 tick、生产同款召回与读接口、真 HTTP）：
 *   - A 在个人会话里说「我决定关注 211 高校」→ 不点任何晋升 → A 的个人空间里有一份「AI 记下的」副本
 *     （proposed、created_by = model、derived_from 连回原结论、证据是那句话），反馈条说「已记入个人记忆」；
 *   - 项目会话里 B 说的决定只进 B 的空间，绝不进 A 的（A 也读不到 B 的副本存在）；A 说的也不进 B 的；
 *   - 非决定类不复制；同一个决定说两遍 ⇒ 合并成一条，不重复；
 *   - 撤销：只有一个来源 ⇒ 副本失效，新会话无关轮次不再召回；合并过的 ⇒ 只摘掉这一个来源；
 *   - 原话被删 / 会话原结论被忘掉 ⇒ 副本随 F07 级联失效；
 *   - 数据库守卫：人的请求不能替别人触发复制；证据不是作者本人的话 ⇒ 拒绝。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { knowledgeGraph as KG } from "@repo/contracts";
import { runExtractionTick } from "../../src/application/knowledge-graph/extract-message-knowledge";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { addOrgMember, addProjectMember, asApp, asOwner, resetOrgs, seedOrg } from "../support/db";
import {
  client, memoryPath, projectGraph, publishAgent, startApp, turn,
  type Client, type E2eApp, type ThreadKnowledgeBody, type TurnMemoryBody,
} from "./kg-e2e-fixtures";
import { enableExtraction, extractionDeps, loopbackModel } from "./kg-extraction-fixtures";

const ORG = "org-kg-i4283-auto-copy";
const PROJECT = `${ORG}-p`;
const USER_A = "u-i4283-a";
const USER_B = "u-i4283-b";
const AGENT = "agent-i4283";
const A1 = "thr-i4283-a1";
const A2 = "thr-i4283-a2";
const A3 = "thr-i4283-a3";
const A4 = "thr-i4283-a4";
const A5 = "thr-i4283-a5";
const P1 = "thr-i4283-p1";

const A_DECISION = "我决定关注 211 高校";
const A_FACT = "客户 A 的预算是 50 万";
const A_UNDO = "我决定改用周报模板 B";
const A_DELETED = "我决定聚焦华东市场";
const A_FORGOT = "我决定把周会改到周三";
const B_DECISION = "我决定项目用方案 B";
const A_IN_PROJECT = "我决定项目里先做华北区";
const UNRELATED = "开始写报告吧";

const reply = (statement: string, kind: "decision" | "fact") => JSON.stringify({
  entities: [], claims: [{ statement, kind, confidence: 0.9, about: [], decidedBy: null, quote: statement }],
});

let e: E2eApp;
let a: Client;
let b: Client;

async function settle(): Promise<void> {
  const { model } = loopbackModel([
    [A_DECISION, reply(A_DECISION, "decision")], [A_FACT, reply(A_FACT, "fact")], [A_UNDO, reply(A_UNDO, "decision")],
    [A_DELETED, reply(A_DELETED, "decision")], [A_FORGOT, reply(A_FORGOT, "decision")],
    [B_DECISION, reply(B_DECISION, "decision")], [A_IN_PROJECT, reply(A_IN_PROJECT, "decision")],
  ]);
  const deps = extractionDeps(e.db, model, ORG);
  for (let i = 0; i < 50; i += 1) {
    const r = await runExtractionTick(deps);
    expect(r.failed).toBe(0);
    if (r.processed === 0) break;
  }
  await projectGraph(e);
}

interface PersonalRow {
  id: string; scope_id: string; statement: string; status: string; created_by: string; reviewed_by: string | null;
  revoked_at: Date | null; revocation_reason: string | null;
}
async function personalRows(statement: string): Promise<PersonalRow[]> {
  return asOwner(async (c) => (await c.query<PersonalRow>(
    `SELECT id, scope_id, statement, status, created_by, reviewed_by, revoked_at, revocation_reason FROM claims
      WHERE org_id = $1 AND scope_kind = 'personal' AND statement = $2 ORDER BY created_at, id`, [ORG, statement])).rows);
}
async function threadClaim(threadId: string, statement: string): Promise<{ id: string; status: string }> {
  const rows = await asOwner(async (c) => (await c.query<{ id: string; status: string }>(
    `SELECT id, status FROM claims WHERE org_id = $1 AND scope_kind = 'chat_session' AND scope_id = $2 AND statement = $3`,
    [ORG, threadId, statement])).rows);
  expect(rows, `会话 ${threadId} 里应抽出「${statement}」`).toHaveLength(1);
  return rows[0]!;
}
async function derivedFrom(personalId: string): Promise<{ dst_id: string; status: string; created_by: string }[]> {
  return asOwner(async (c) => (await c.query<{ dst_id: string; status: string; created_by: string }>(
    `SELECT dst_id, status, created_by FROM ontology_edges WHERE org_id = $1 AND src_id = $2 AND relation = 'derived_from' ORDER BY dst_id`,
    [ORG, personalId])).rows);
}
const extraction = (api: Client, threadId: string, messageId: string) =>
  api.get<KG.KgMessageExtraction>(`/knowledge-graph/threads/${threadId}/messages/${messageId}/extraction`);
const undoPath = (threadId: string, claimId: string) => `/knowledge-graph/threads/${threadId}/claims/${claimId}/personal-copy/undo`;

beforeAll(async () => {
  e = await startApp();
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await enableExtraction(ORG);
  await addOrgMember(ORG, USER_A, "consultant", null);
  await addOrgMember(ORG, USER_B, "consultant", null);
  for (const u of [USER_A, USER_B]) await addProjectMember(ORG, PROJECT, u, "facilitator", null);
  await publishAgent(ORG, AGENT, USER_A);
  for (const id of [A1, A2, A3, A4, A5]) {
    await addChatThread({ orgId: ORG, id, projectId: null, visibilityScope: "private", createdBy: USER_A, title: id });
  }
  // 项目会话由 A 创建，B 是成员：B 在这里说的话不是 A 的话。
  await addChatThread({ orgId: ORG, id: P1, projectId: PROJECT, visibilityScope: "plenary", createdBy: USER_A, title: "项目群聊" });
  a = client(e, USER_A, ORG);
  b = client(e, USER_B, ORG);

  await addChatMessage({ orgId: ORG, id: "m-i4283-a1", threadId: A1, body: `${A_DECISION}。`, authorId: USER_A });
  await addChatMessage({ orgId: ORG, id: "m-i4283-a1-fact", threadId: A1, body: `${A_FACT}。`, authorId: USER_A });
  await addChatMessage({ orgId: ORG, id: "m-i4283-p1-b", threadId: P1, body: `${B_DECISION}。`, authorId: USER_B });
  await addChatMessage({ orgId: ORG, id: "m-i4283-p1-a", threadId: P1, body: `${A_IN_PROJECT}。`, authorId: USER_A });
  await addChatMessage({ orgId: ORG, id: "m-i4283-a4-undo", threadId: A4, body: `${A_UNDO}。`, authorId: USER_A });
  await addChatMessage({ orgId: ORG, id: "m-i4283-a4-del", threadId: A4, body: `${A_DELETED}。`, authorId: USER_A });
  await addChatMessage({ orgId: ORG, id: "m-i4283-a4-forgot", threadId: A4, body: `${A_FORGOT}。`, authorId: USER_A });
  await settle();
}, 180_000);

afterAll(async () => {
  await e?.app.close();
});

describe("issue #4283: 本人的决定自动记进本人个人空间", () => {
  it("A 说出的决定 ⇒ 不点晋升，A 的个人空间里就有一份「AI 记下的」副本，连回原结论、证据是那句话", async () => {
    const src = await threadClaim(A1, A_DECISION);
    expect(src.status).toBe("proposed");  // 原结论不被悄悄转成「你确认过的」
    const rows = await personalRows(A_DECISION);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ scope_id: USER_A, status: "proposed", created_by: "model", reviewed_by: null, revoked_at: null });
    expect(await derivedFrom(rows[0]!.id)).toEqual([{ dst_id: src.id, status: "active", created_by: "model" }]);
    const ev = await asOwner(async (c) => (await c.query<{ message_id: string }>(
      "SELECT message_id FROM claim_message_evidence WHERE claim_id = $1 AND stance = 'supporting'", [rows[0]!.id])).rows);
    expect(ev).toEqual([{ message_id: "m-i4283-a1" }]);
    const audit = await asOwner(async (c) => (await c.query<{ actor_kind: string; action_type: string; scope_id: string }>(
      "SELECT actor_kind, action_type, scope_id FROM ontology_actions WHERE org_id = $1 AND action_type = 'autoCopyDecision' AND payload->'claims' @> $2::jsonb",
      [ORG, JSON.stringify([{ id: rows[0]!.id }])])).rows);
    expect(audit).toEqual([{ actor_kind: "system", action_type: "autoCopyDecision", scope_id: USER_A }]);

    // 个人空间读接口：本人看到，三态是「AI 记下的」（pending），不冒充「你确认过的」
    const personal = await a.get<{ claims: Array<{ id: string; triState: string }> }>("/knowledge-graph/personal");
    expect(personal.status).toBe(200);
    expect(personal.body.claims.find((c) => c.id === rows[0]!.id)?.triState).toBe("pending");
    // 反馈条的数据源：这条消息的结论带上本人副本 id
    const ex = await extraction(a, A1, "m-i4283-a1");
    expect(ex.status).toBe(200);
    expect(KG.knowledgeGraph.getMessageExtraction.out.safeParse(ex.body).success).toBe(true);
    expect(ex.body.claims).toEqual([{ claimId: src.id, statement: A_DECISION, personalCopyClaimId: rows[0]!.id }]);
  });

  it("非决定类不复制，仍要手动晋升", async () => {
    await threadClaim(A1, A_FACT);
    expect(await personalRows(A_FACT)).toEqual([]);
    const ex = await extraction(a, A1, "m-i4283-a1-fact");
    expect(ex.body.claims.map((c) => c.personalCopyClaimId)).toEqual([null]);
  });

  it("项目会话里的决定不自动进任何人的个人空间（只限个人线程，同 F11；#4291 评审）", async () => {
    // 项目会话的决定属于那个项目：复制进个人空间后会被 #4284 带进别的项目会话的回答，给不在原项目的成员看到。
    const bSrc = await threadClaim(P1, B_DECISION);
    const aSrc = await threadClaim(P1, A_IN_PROJECT);
    expect(await personalRows(B_DECISION)).toEqual([]);
    expect(await personalRows(A_IN_PROJECT)).toEqual([]);
    // 会话结论照常在（项目成员看得到），只是没有个人副本
    for (const [who, msg] of [[a, "m-i4283-p1-b"], [b, "m-i4283-p1-b"], [a, "m-i4283-p1-a"], [b, "m-i4283-p1-a"]] as const) {
      const ex = await extraction(who, P1, msg);
      expect(ex.status).toBe(200);
      expect(ex.body.claims.map((c) => c.personalCopyClaimId)).toEqual([null]);
    }
    // 系统身份（worker）也取不到候选、直接调复制被拒
    const cands = await asApp(ORG, async (c) => (await c.query<{ c: { author: string | null } }>(
      "SELECT kg_auto_copy_candidates($1, $2) AS c", [P1, "m-i4283-p1-a"])).rows[0]!.c);
    expect(cands.author).toBeNull();
    await expect(asApp(ORG, (c) => c.query("SELECT kg_auto_copy_decision($1::jsonb)", [JSON.stringify({
      action_id: "act-i4283-proj", thread_id: P1, message_id: "m-i4283-p1-a", claim_id: aSrc.id, mode: "new",
    })]))).rejects.toThrow(/KG_NOT_AUTHOR/);
    // 撤销入口同样没有东西可撤（同一个 404 出口）
    for (const [who, src] of [[a, aSrc], [b, bSrc]] as const) {
      const r = await who.post(undoPath(P1, src.id), {});
      expect(r.status).toBe(404);
      expect(r.body).toMatchObject({ reasonCode: "KG_CLAIM_NOT_FOUND" });
    }
    const bPersonal = await b.get<{ claims: Array<{ statement: string }> }>("/knowledge-graph/personal");
    expect(bPersonal.body.claims.map((c) => c.statement)).not.toContain(B_DECISION);
  });

  it("同一个决定说两遍（另一个会话）⇒ 合并成一条：两个来源、两条证据，不重复建", async () => {
    await addChatMessage({ orgId: ORG, id: "m-i4283-a3", threadId: A3, body: `${A_DECISION}。`, authorId: USER_A });
    await settle();
    const rows = await personalRows(A_DECISION);
    expect(rows).toHaveLength(1);
    const s1 = await threadClaim(A1, A_DECISION);
    const s3 = await threadClaim(A3, A_DECISION);
    expect((await derivedFrom(rows[0]!.id)).map((d) => d.dst_id).sort()).toEqual([s1.id, s3.id].sort());
    const ex = await extraction(a, A3, "m-i4283-a3");
    expect(ex.body.claims).toEqual([{ claimId: s3.id, statement: A_DECISION, personalCopyClaimId: rows[0]!.id }]);
  });

  it("撤销合并过的那一份里的一个来源 ⇒ 只摘掉这个来源，副本留着（仍由另一次说法支撑）", async () => {
    const s3 = await threadClaim(A3, A_DECISION);
    const r = await a.post<{ personalClaimId: string; outcome: string }>(undoPath(A3, s3.id), {});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.outcome).toBe("detached");
    const rows = await personalRows(A_DECISION);
    expect(rows[0]!.revoked_at).toBeNull();
    const s1 = await threadClaim(A1, A_DECISION);
    expect((await derivedFrom(rows[0]!.id)).filter((d) => d.status === "active").map((d) => d.dst_id)).toEqual([s1.id]);
    const ev = await asOwner(async (c) => (await c.query<{ message_id: string }>(
      "SELECT message_id FROM claim_message_evidence WHERE claim_id = $1", [rows[0]!.id])).rows);
    expect(ev).toEqual([{ message_id: "m-i4283-a1" }]);
    expect((await extraction(a, A3, "m-i4283-a3")).body.claims[0]!.personalCopyClaimId).toBeNull();
  });

  it("F07：原话被删 ⇒ 副本失效；会话原结论被忘掉 ⇒ 只由它而来的副本一并失效", async () => {
    expect((await personalRows(A_DELETED))[0]!.revoked_at).toBeNull();
    await asOwner((c) => c.query("DELETE FROM chat_messages WHERE org_id = $1 AND id = $2", [ORG, "m-i4283-a4-del"]));
    const deleted = await personalRows(A_DELETED);
    expect(deleted[0]).toMatchObject({ status: "superseded", revocation_reason: "source_deleted" });

    const src = await threadClaim(A4, A_FORGOT);
    expect((await personalRows(A_FORGOT))[0]!.revoked_at).toBeNull();
    const k = await a.get<ThreadKnowledgeBody>(`/knowledge-graph/threads/${A4}`);
    const r = await a.post(`/knowledge-graph/threads/${A4}/actions`, { basedOnRevision: k.body.revision, action: { type: "revokeClaim", claimId: src.id } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await personalRows(A_FORGOT))[0]!.revoked_at).not.toBeNull();
  });

  // 放在 F07 之后：决定类强制召回只有 3 个名额、按最新取，前面那两条失效后，这里的正反证才不受名额挤压。
  it("撤销只有一个来源的副本 ⇒ 副本失效（user_revoked）；新会话无关轮次不再召回它，没撤的照样召回", async () => {
    const src = await threadClaim(A4, A_UNDO);
    const before = await personalRows(A_UNDO);
    expect(before).toHaveLength(1);
    const r = await a.post<{ personalClaimId: string; outcome: string }>(undoPath(A4, src.id), {});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(KG.knowledgeGraph.undoAutoPersonalCopy.out.safeParse(r.body).success).toBe(true);
    expect(r.body).toEqual({ personalClaimId: before[0]!.id, outcome: "revoked" });
    const after = await personalRows(A_UNDO);
    expect(after[0]).toMatchObject({ status: "superseded", revocation_reason: "user_revoked" });
    expect(after[0]!.revoked_at).not.toBeNull();
    // 再点一次：已经不在 ⇒ 同一个 404
    const again = await a.post(undoPath(A4, src.id), {});
    expect(again.status).toBe(404);
    // 任务重试不会把撤掉的复制回来
    const cands = await asApp(ORG, async (c) => (await c.query<{ c: { fresh: unknown[] } }>(
      "SELECT kg_auto_copy_candidates($1, $2) AS c", [A4, "m-i4283-a4-undo"])).rows[0]!.c);
    expect(cands.fresh).toEqual([]);

    const t = await turn(e, a, ORG, A2, UNRELATED, AGENT);
    expect(t.memory).not.toBeNull();
    expect(t.memory).not.toContain(A_UNDO);
    expect(t.memory).toMatch(new RegExp(`- \\[AI 记下的\\] ${A_DECISION}（来自个人空间知识`));
    expect(t.memory).not.toContain(B_DECISION);
    const mem = await a.get<TurnMemoryBody>(memoryPath(A2, t.answerId));
    expect(mem.status).toBe(200);
    const hit = mem.body.recalled.find((m) => m.statement === A_DECISION);
    expect(hit).toMatchObject({ scope: "personal", triState: "pending", channels: ["claim"] });
    expect(mem.body.recalled.some((m) => m.statement === A_UNDO)).toBe(false);
  }, 120_000);

  it("手动晋升一条已经自动记下的决定 ⇒ 合并进那一份并转成「你确认过的」，不另建一条", async () => {
    const src = await threadClaim(A1, A_DECISION);
    const personal = (await personalRows(A_DECISION))[0]!;
    const r = await a.post<{ results: Array<{ outcome: string; personalClaimId?: string }> }>(`/knowledge-graph/threads/${A1}/promote`, { claimIds: [src.id] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.results).toEqual([{ claimId: src.id, outcome: "merged_into_existing", personalClaimId: personal.id }]);
    const rows = await personalRows(A_DECISION);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "accepted", reviewed_by: USER_A });
    // 已确认的不再是「AI 记下的」：反馈条不再给个人副本的撤销
    expect((await extraction(a, A1, "m-i4283-a1")).body.claims[0]!.personalCopyClaimId).toBeNull();
    expect((await a.post(undoPath(A1, src.id), {})).status).toBe(404);
  });

  it("数据库守卫：人的请求不能替别人触发复制；证据不是作者本人的话 ⇒ 拒绝；候选对别人为空", async () => {
    // A 个人线程里 A 的话、B 以登录身份去触发 ⇒ KG_NOT_OWNER
    const aSrc = await threadClaim(A1, A_DECISION);
    await expect(asApp(ORG, async (c) => {
      await c.query("SELECT set_config('app.current_user_id', $1, true)", [USER_B]);
      return c.query("SELECT kg_auto_copy_decision($1::jsonb)", [JSON.stringify({
        action_id: "act-i4283-forge", thread_id: A1, message_id: "m-i4283-a1", claim_id: aSrc.id, mode: "new",
      })]);
    })).rejects.toThrow(/KG_NOT_OWNER/);
    const bSrc = await threadClaim(P1, B_DECISION);
    const forCaller = await asApp(ORG, async (c) => {
      await c.query("SELECT set_config('app.current_user_id', $1, true)", [USER_A]);
      return (await c.query<{ c: { author: string | null; personal: unknown[] } }>(
        "SELECT kg_auto_copy_candidates($1, $2) AS c", [P1, "m-i4283-p1-b"])).rows[0]!.c;
    });
    expect(forCaller).toEqual({ author: null, fresh: [], personal: [] });
    // 拿 A 的消息去复制 B 的结论（证据是 B 的话）⇒ KG_NOT_AUTHOR（写进谁的空间只看证据作者）
    await expect(asApp(ORG, (c) => c.query("SELECT kg_auto_copy_decision($1::jsonb)", [JSON.stringify({
      action_id: "act-i4283-mix", thread_id: P1, message_id: "m-i4283-p1-a", claim_id: bSrc.id, mode: "new",
    })]))).rejects.toThrow(/KG_EVIDENCE_REVOKED|KG_NOT_AUTHOR/);
    // agent 说的话不是任何人的话
    await addChatMessage({ orgId: ORG, id: "m-i4283-agent", threadId: A5, body: "我决定替你订周五的会议室。", authorId: AGENT, authorKind: "agent", agentId: AGENT });
    const agentCands = await asApp(ORG, async (c) => (await c.query<{ c: { author: string | null } }>(
      "SELECT kg_auto_copy_candidates($1, $2) AS c", [A5, "m-i4283-agent"])).rows[0]!.c);
    expect(agentCands.author).toBeNull();
    // app_rw 不能直接调判定助手
    await expect(asApp(ORG, (c) => c.query("SELECT kg_auto_copy_author($1, $2, $3)", [ORG, A1, "m-i4283-a1"]))).rejects.toThrow(/permission denied/);
  });
});
