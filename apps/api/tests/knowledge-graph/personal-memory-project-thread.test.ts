/**
 * issue #4284（人类决定 2026-09-26）—— 个人记忆也用于**项目会话**里提问者本人的回答，但绝不向项目里的其他成员暴露。
 *
 * 走真实链路（kg-e2e-fixtures.ts 文件头：完整应用、真受理、真抽取 tick、生产同款 PgKnowledgeRecall、真写回、真 GET）：
 *   - A、B 同组织、同项目；各自在个人会话里说出一条决定 → 确认 → 存入各自的个人空间；
 *     A 另有一条存入个人空间后又撤掉的决定（F07 级联，个人空间那条随之失效）。
 *   - A 在共享项目会话 S 里说「开始写报告吧」：本人个人空间的决定（决定类强制召回）进了**这一轮**的模型材料、
 *     turn memory 里 scope = personal；B 的不进，撤掉的不进。
 *   - B 读 A 这一轮的记忆（回答下方的引用）、会话知识面板、来源抽屉：拿不到 A 个人结论的原文、id、出处标签；
 *     来源抽屉与「不存在」逐字相同。
 *   - 对称：B 在 S 里问，只召回 B 自己的；A 读 B 那一轮同样干净。
 *
 * 库里 `kg_turn_recalls` 照实记着 A 那一轮用到了 A 的个人结论（A 自己回看要用）；挡住 B 的是**读侧按查看者过滤**
 * （pg-knowledge-read.ts readTurnRecall：个人空间条目只给「这一轮的提问者本人」看，且 RLS 只放本人的 personal 行）。
 *
 * 已知取舍（usecases.md「已决：个人记忆用于项目会话」）：模型写出来的**回答正文**对项目成员可见，可能复述 A 的
 * 个人记忆——这里的回环模型就会照抄，所以本文件不对回答正文做「B 看不到」的断言，只断言结构化的记忆读路径。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { knowledgeGraph as KG } from "@repo/contracts";
import { runExtractionTick } from "../../src/application/knowledge-graph/extract-message-knowledge";
import { toOrgId } from "../../src/domain/org-id";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { addOrgMember, addProjectMember, asOwner, resetOrgs, seedOrg } from "../support/db";
import {
  client, memoryPath, projectGraph, publishAgent, sourcesPath, startApp, turn,
  type Client, type E2eApp, type HttpResult, type ThreadKnowledgeBody, type Turn, type TurnMemoryBody,
} from "./kg-e2e-fixtures";
import { enableExtraction, extractionDeps, loopbackModel } from "./kg-extraction-fixtures";

const ORG = "org-kg-i4284-project-personal";
const PROJECT = `${ORG}-p`;
const USER_A = "u-i4284-a";
const USER_B = "u-i4284-b";
const AGENT = "agent-i4284";
const A1 = "thr-i4284-a1";
const B1 = "thr-i4284-b1";
const S = "thr-i4284-s";

const A_DECISION = "我决定关注 211 高校";
const B_DECISION = "我决定关注 985 高校";
const A_REVOKED = "我决定每周五开例会";
const UNRELATED = "开始写报告吧";

const decisionReply = (statement: string) => JSON.stringify({
  entities: [],
  claims: [{ statement, kind: "decision", confidence: 0.9, about: [], decidedBy: null, quote: statement }],
});

let e: E2eApp;
let a: Client;
let b: Client;
const ids: { aPersonal: string; aSource: string; bPersonal: string; bSource: string; aRevokedPersonal: string } = {
  aPersonal: "", aSource: "", bPersonal: "", bSource: "", aRevokedPersonal: "",
};
let aTurn: Turn;
let bTurn: Turn;

async function settle(): Promise<void> {
  const { model } = loopbackModel([
    [A_DECISION, decisionReply(A_DECISION)], [B_DECISION, decisionReply(B_DECISION)], [A_REVOKED, decisionReply(A_REVOKED)],
  ]);
  const deps = extractionDeps(e.db, model, ORG);
  for (let i = 0; i < 50; i += 1) {
    const r = await runExtractionTick(deps);
    expect(r.failed).toBe(0);
    if (r.processed === 0) break;
  }
  await projectGraph(e);
}

/** 会话里那条结论：确认 → 存入本人个人空间；返回 [会话结论 id, 个人空间副本 id]。 */
async function confirmAndPromote(api: Client, threadId: string, statement: string): Promise<[string, string]> {
  const k = await api.get<ThreadKnowledgeBody>(`/knowledge-graph/threads/${threadId}`);
  expect(k.status, JSON.stringify(k.body)).toBe(200);
  const c = k.body.claims.find((x) => x.statement === statement);
  expect(c, `会话 ${threadId} 里应抽出「${statement}」`).toBeDefined();
  const confirm = await api.post(`/knowledge-graph/threads/${threadId}/actions`, {
    basedOnRevision: k.body.revision, action: { type: "confirmClaims", claimIds: [c!.id] },
  });
  expect(confirm.status, JSON.stringify(confirm.body)).toBe(200);
  const promoted = await api.post<{ results: Array<{ claimId: string; personalClaimId?: string }> }>(
    `/knowledge-graph/threads/${threadId}/promote`, { claimIds: [c!.id] });
  expect(promoted.status, JSON.stringify(promoted.body)).toBe(200);
  const personal = promoted.body.results[0]?.personalClaimId;
  expect(personal).toEqual(expect.any(String));
  return [c!.id, personal!];
}

/** 一段载荷里不得出现的东西：别人个人空间结论的原文、个人空间 id、它来源的会话结论 id、出处标签。 */
function expectNoTrace(label: string, payload: unknown, secrets: readonly string[]): void {
  const text = JSON.stringify(payload ?? null);
  for (const s of secrets) expect(text.includes(s), `${label} 泄漏了「${s}」：${text}`).toBe(false);
}
const stripTrace = (x: unknown) => ({ ...(x as Record<string, unknown>), traceId: undefined });
async function expectSameAsMissing(label: string, got: HttpResult, missing: HttpResult): Promise<void> {
  expect(got.status, label).toBe(404);
  expect(missing.status, `${label}（不存在对照）`).toBe(404);
  expect(stripTrace(got.body), label).toEqual(stripTrace(missing.body));
}

const aSecrets = () => [A_DECISION, ids.aPersonal, ids.aSource, A1, "来自个人空间知识"];
const bSecrets = () => [B_DECISION, ids.bPersonal, ids.bSource, B1, "来自个人空间知识"];

beforeAll(async () => {
  e = await startApp();
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await enableExtraction(ORG);
  for (const u of [USER_A, USER_B]) {
    await addOrgMember(ORG, u, "consultant", null);
    await addProjectMember(ORG, PROJECT, u, "facilitator", null);
  }
  await publishAgent(ORG, AGENT, USER_A);
  await addChatThread({ orgId: ORG, id: A1, projectId: null, visibilityScope: "private", createdBy: USER_A, title: A1 });
  await addChatThread({ orgId: ORG, id: B1, projectId: null, visibilityScope: "private", createdBy: USER_B, title: B1 });
  await addChatThread({ orgId: ORG, id: S, projectId: PROJECT, visibilityScope: "plenary", createdBy: USER_A, title: "项目群聊" });
  a = client(e, USER_A, ORG);
  b = client(e, USER_B, ORG);
}, 180_000);

afterAll(async () => {
  await e?.app.close();
});

describe("issue #4284: 个人记忆用于项目会话里本人的回答，不向其他成员暴露", () => {
  it("准备：A、B 各把一条决定存入个人空间；A 另有一条存入后又撤掉", async () => {
    await addChatMessage({ orgId: ORG, id: "m-i4284-a1", threadId: A1, body: `${A_DECISION}。`, authorId: USER_A });
    await addChatMessage({ orgId: ORG, id: "m-i4284-a1r", threadId: A1, body: `${A_REVOKED}。`, authorId: USER_A });
    await addChatMessage({ orgId: ORG, id: "m-i4284-b1", threadId: B1, body: `${B_DECISION}。`, authorId: USER_B });
    await settle();
    [ids.aSource, ids.aPersonal] = await confirmAndPromote(a, A1, A_DECISION);
    [ids.bSource, ids.bPersonal] = await confirmAndPromote(b, B1, B_DECISION);
    const [revokedSource, revokedPersonal] = await confirmAndPromote(a, A1, A_REVOKED);
    ids.aRevokedPersonal = revokedPersonal;
    // 在原会话里撤掉 ⇒ F07 级联把个人空间那条一起收掉
    const k = await a.get<ThreadKnowledgeBody>(`/knowledge-graph/threads/${A1}`);
    const revoke = await a.post(`/knowledge-graph/threads/${A1}/actions`, {
      basedOnRevision: k.body.revision, action: { type: "revokeClaim", claimId: revokedSource, reason: "不开了" },
    });
    expect(revoke.status, JSON.stringify(revoke.body)).toBe(200);
    await projectGraph(e);
    const rows = await asOwner(async (c) => (await c.query<{ id: string; scope_id: string; live: boolean }>(
      `SELECT id, scope_id, (revoked_at IS NULL AND status <> 'superseded') AS live FROM claims
        WHERE org_id = $1 AND scope_kind = 'personal' ORDER BY id`, [ORG])).rows);
    expect(rows).toEqual(expect.arrayContaining([
      { id: ids.aPersonal, scope_id: USER_A, live: true },
      { id: ids.bPersonal, scope_id: USER_B, live: true },
      { id: ids.aRevokedPersonal, scope_id: USER_A, live: false },
    ]));
  }, 120_000);

  it("候选集：项目会话里 A 只拿到 A 自己的活个人结论，B 只拿到 B 的", async () => {
    const ca = await e.recall.candidates(toOrgId(ORG), USER_A, S);
    const personalA = ca.claims.filter((c) => c.scope === "personal");
    expect(personalA.map((c) => c.id)).toEqual([ids.aPersonal]);
    expect(personalA.every((c) => c.originThreadId === undefined)).toBe(true);
    const cb = await e.recall.candidates(toOrgId(ORG), USER_B, S);
    expect(cb.claims.filter((c) => c.scope === "personal").map((c) => c.id)).toEqual([ids.bPersonal]);
  });

  it("A 在项目会话里说无关的话：A 的个人决定进了这一轮的模型材料与 A 自己的回答引用；B 的、撤掉的都不进", async () => {
    aTurn = await turn(e, a, ORG, S, UNRELATED, AGENT);
    expect(aTurn.memory).toMatch(new RegExp(`- \\[你确认过\\] ${A_DECISION}（来自个人空间知识`));
    expect(aTurn.memory).not.toContain(B_DECISION);
    expect(aTurn.memory).not.toContain(A_REVOKED);

    const r = await a.get<TurnMemoryBody>(memoryPath(S, aTurn.answerId));
    expect(r.status).toBe(200);
    const parsed = KG.knowledgeGraph.getTurnMemory.out.safeParse(r.body);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
    expect(r.body.recalled.map((m) => [m.claimId, m.scope, m.statement, m.channels])).toEqual([[ids.aPersonal, "personal", A_DECISION, ["claim"]]]);
    // 本人点引用 chip 能打开来源抽屉（点回自己个人会话里的原话）
    const src = await a.get<{ claim: { id: string } }>(sourcesPath(ids.aPersonal));
    expect(src.status, JSON.stringify(src.body)).toBe(200);
    expect(src.body.claim.id).toBe(ids.aPersonal);

    // 持久化照实记着（A 自己回看要用）——挡住别人的是读侧，不是「没记」
    const [stored] = await asOwner(async (c) => (await c.query<{ items: Array<{ claimId: string }>; requester_user_id: string }>(
      "SELECT items, requester_user_id FROM kg_turn_recalls WHERE org_id = $1 AND run_id = $2", [ORG, aTurn.runId])).rows);
    expect(stored!.requester_user_id).toBe(USER_A);
    expect(stored!.items.map((i) => i.claimId)).toEqual([ids.aPersonal]);
  }, 120_000);

  it("隐私：B 读 A 这一轮的记忆 / 引用、会话知识面板、来源抽屉 ⇒ 没有 A 个人结论的原文、id、出处标签", async () => {
    const mem = await b.get<TurnMemoryBody>(memoryPath(S, aTurn.answerId));
    expect(mem.status).toBe(200);
    const parsed = KG.knowledgeGraph.getTurnMemory.out.safeParse(mem.body);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
    expect(mem.body.recalled).toEqual([]);
    expectNoTrace("B 读 A 这一轮的记忆", mem.body, aSecrets());

    const panel = await b.get<ThreadKnowledgeBody>(`/knowledge-graph/threads/${S}`);
    expect(panel.status).toBe(200);
    expect(panel.body.claims.every((c) => c.scope.kind === "chat_session")).toBe(true);
    expectNoTrace("B 读 S 的知识面板", panel.body, aSecrets());

    const extraction = await b.get(`/knowledge-graph/threads/${S}/messages/${aTurn.answerId}/extraction`);
    expect(extraction.status).toBe(200);
    expectNoTrace("B 读 A 回答的抽取反馈", extraction.body, aSecrets());

    for (const id of [ids.aPersonal, ids.aSource]) {
      const got = await b.get(sourcesPath(id));
      expectNoTrace(`B 打开来源 ${id}`, got.body, aSecrets());
      await expectSameAsMissing(`B 打开来源 ${id}`, got, await b.get(sourcesPath("clm-no-such")));
    }
  });

  it("对称：B 在项目会话里问，只召回 B 自己的；A 读 B 那一轮同样干净", async () => {
    bTurn = await turn(e, b, ORG, S, UNRELATED, AGENT);
    expect(bTurn.memory).toContain(B_DECISION);
    expect(bTurn.memory).not.toContain(A_DECISION);
    const own = await b.get<TurnMemoryBody>(memoryPath(S, bTurn.answerId));
    expect(own.body.recalled.map((m) => [m.claimId, m.scope])).toEqual([[ids.bPersonal, "personal"]]);
    expectNoTrace("B 读自己这一轮", own.body, aSecrets().filter((s) => s !== "来自个人空间知识"));

    const cross = await a.get<TurnMemoryBody>(memoryPath(S, bTurn.answerId));
    expect(cross.status).toBe(200);
    expect(cross.body.recalled).toEqual([]);
    expectNoTrace("A 读 B 这一轮的记忆", cross.body, bSecrets());
    await expectSameAsMissing("A 打开 B 的个人来源", await a.get(sourcesPath(ids.bPersonal)), await a.get(sourcesPath("clm-no-such")));
  }, 120_000);

  it("被塞进别人那一轮的个人条目（记录层被污染）：连它的主人在别人的回答下也读不到（只给那一轮的提问者）", async () => {
    // 模拟记录层被污染：往 B 那一轮的召回记录里塞 A 的个人结论 id
    const polluted = await asOwner((c) => c.query(
      "UPDATE kg_turn_recalls SET items = items || $2::jsonb WHERE org_id = $1 AND run_id = $3",
      [ORG, JSON.stringify([{ claimId: ids.aPersonal, channels: ["claim"], retrievalReasons: ["recall"], score: 0, graphPath: null }]), bTurn.runId],
    ));
    expect(polluted.rowCount, "B 那一轮必须有召回记录，污染才不是空转").toBe(1);
    const byA = await a.get<TurnMemoryBody>(memoryPath(S, bTurn.answerId));
    expect(byA.body.recalled.map((m) => m.claimId)).not.toContain(ids.aPersonal);
    expectNoTrace("A 读被污染的 B 那一轮", byA.body, [...bSecrets(), A_DECISION, ids.aPersonal]);
    const byB = await b.get<TurnMemoryBody>(memoryPath(S, bTurn.answerId));
    expectNoTrace("B 读被污染的自己那一轮", byB.body, [A_DECISION, ids.aPersonal]);
  });

  it("个人会话行为不变：A 回自己的个人会话问，照常召回个人空间", async () => {
    const t = await turn(e, a, ORG, A1, UNRELATED, AGENT);
    expect(t.memory).toContain(A_DECISION);
    expect(t.memory).not.toContain(B_DECISION);
    expect(t.memory).not.toContain(A_REVOKED);
  }, 120_000);
});
