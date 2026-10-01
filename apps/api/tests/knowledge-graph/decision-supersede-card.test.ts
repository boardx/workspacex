/**
 * Issue #4290 —— 人类决定 2026-09-26「高把握自动、低把握弹卡」：低把握（frame_only）的改口从不自动取代，
 * 会话里弹一张 F16 卡（`kind = possible_change`）「用〈新〉取代〈旧〉？」，选之前两条都照常生效、都召回。
 *
 * 走真实路径（同 decision-supersede-recall.test.ts：完整应用、真抽取 tick（F16 判矛盾 → #4290 判取代 / 开卡 →
 * #4283 自动记入）、生产同款召回、真 GET memory、真 POST actions）：
 *   - A1「我决定关注 211 高校」→ 进个人空间；
 *   - B1「改成关注 985 吧」（frame_only：985 没有类别词）⇒ 不取代；B1 这一轮回答下出 possible_change 卡；两条都不转
 *     contested（985 照常被 #4283 自动记进个人空间）；新会话 C1 两条都召回；
 *   - 隐私：别人读不到这张卡、点不动（同一个 404）；别的会话里拿这张卡的 id 也是同一个 404；
 *   - B1 点 [取代]（resolveConflict{keep_new}）⇒ 211 superseded（连同个人空间那条）、985 转「你确认过」；新会话 C2 只召回 985；
 *   - V1「我决定用 Vue」→ V2「改成用 React 吧」⇒ 卡；点 [两条都保留]（keep_both，不带适用条件）⇒ 卡关掉、两条状态都不动；
 *     新会话 C3 两条都召回；
 *   - 反证：G1「我决定采用 Go」之后，「改成采用 Rust 不现实」「关于周会，改成采用飞书」——既不取代、也不弹卡
 *     （去掉修复这两句都会对「采用 Go」弹卡：frame_only）。
 *   - 第 8 轮第五次评审：复合的旧决定 K1「我决定后端用 Go 语言，前端用 TS 语言」→ K2「前端改用 JS 语言」⇒ 只弹卡、旧决定照常生效
 *     （去掉修复这一句会自动取代整条旧决定，连后端的 Go 一起丢掉）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { knowledgeGraph as KG } from "@repo/contracts";
import { runExtractionTick } from "../../src/application/knowledge-graph/extract-message-knowledge";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { addOrgMember, asOwner, resetOrgs, seedOrg } from "../support/db";
import {
  client, memoryPath, projectGraph, publishAgent, startApp, turn,
  type Client, type E2eApp, type ThreadKnowledgeBody, type TurnMemoryBody,
} from "./kg-e2e-fixtures";
import { enableExtraction, extractionDeps, loopbackModel } from "./kg-extraction-fixtures";

const ORG = "org-kg-i4290-card";
const PROJECT = `${ORG}-p`;
const USER_A = "u-i4290c-a";
const USER_B = "u-i4290c-b";
const AGENT = "agent-i4290c";
const [A1, B1, C1, C2, C3, V1, V2, G1, N1, N2, K1, K2, OTHER] =
  ["a1", "b1", "c1", "c2", "c3", "v1", "v2", "g1", "n1", "n2", "k1", "k2", "other"].map((x) => `thr-i4290c-${x}`) as [string, ...string[]] as string[];

const OLD = "我决定关注 211 高校";
const NEW = "改成关注 985";
const VUE = "我决定用 Vue";
const REACT = "改成用 React";
const GO = "我决定采用 Go";
// 去掉修复：「不现实」被吞进新对象、「周会」这个话题丢了 ⇒ 两句都和「采用 Go」同框架（frame_only）⇒ 各弹一张卡
const JUDGED = "改成采用 Rust 不现实";
const TOPIC = "关于周会，改成采用飞书";
const UNRELATED = "开始写报告吧";
// 复合的旧决定：两个带框架的分句；改口的主语「前端」不在旧框架（「后端用…」）的分句里
const COMPOUND = "我决定后端用 Go 语言，前端用 TS 语言";
const FRONTEND_JS = "前端改用 JS 语言";

const decisionReply = (statement: string) => JSON.stringify({
  entities: [],
  claims: [{ statement, kind: "decision", confidence: 0.9, about: [], decidedBy: null, quote: statement }],
});
const MODEL = () => loopbackModel([
  [COMPOUND, decisionReply(COMPOUND)], [FRONTEND_JS, decisionReply(FRONTEND_JS)],
  [JUDGED, decisionReply(JUDGED)], [TOPIC, decisionReply(TOPIC)], [GO, decisionReply(GO)],
  [OLD, decisionReply(OLD)], [NEW, decisionReply(NEW)], [VUE, decisionReply(VUE)], [REACT, decisionReply(REACT)],
]).model;

interface CardTurnBody extends TurnMemoryBody {
  readonly prompt: { type: string; conflict?: { promptId: string; kind: string; newerClaim: { id: string; statement: string }; olderClaim: { id: string; statement: string } } } | null;
  readonly supersede: unknown;
}

let e: E2eApp;
let a: Client;
let b: Client;

async function settle(): Promise<void> {
  const deps = extractionDeps(e.db, MODEL(), ORG);
  for (let i = 0; i < 50; i += 1) {
    const r = await runExtractionTick(deps);
    expect(r.failed).toBe(0);
    if (r.processed === 0) break;
  }
  await projectGraph(e);
}

async function claimIn(api: Client, threadId: string, statement: string) {
  const k = await api.get<ThreadKnowledgeBody>(`/knowledge-graph/threads/${threadId}`);
  expect(k.status, JSON.stringify(k.body)).toBe(200);
  const c = k.body.claims.find((x) => x.statement === statement);
  expect(c, `会话 ${threadId} 里应抽出「${statement}」`).toBeDefined();
  return { claim: c!, revision: k.body.revision };
}

type Row = { id: string; status: string; revoked: boolean; revocation_reason: string | null };
const claimRow = async (id: string): Promise<Row> => (await asOwner(async (c) => (await c.query<Row>(
  "SELECT id, status, revoked_at IS NOT NULL AS revoked, revocation_reason FROM claims WHERE org_id = $1 AND id = $2", [ORG, id])).rows))[0]!;
/** 本人个人空间里这句话的那一条（活的；#4283 自动记下的或晋升的）。 */
const personalOf = async (statement: string): Promise<Row> => {
  const rows = await asOwner(async (c) => (await c.query<Row>(
    `SELECT id, status, revoked_at IS NOT NULL AS revoked, revocation_reason FROM claims
      WHERE org_id = $1 AND scope_kind = 'personal' AND scope_id = $2 AND statement = $3 ORDER BY created_at, id`,
    [ORG, USER_A, statement])).rows);
  expect(rows.length, `个人空间里应有「${statement}」`).toBe(1);
  return rows[0]!;
};
const noticesIn = (threadId: string) => asOwner(async (c) => (await c.query(
  "SELECT id FROM kg_supersede_notices WHERE org_id = $1 AND thread_id = $2", [ORG, threadId])).rows);
const promptsIn = (threadId: string) => asOwner(async (c) => (await c.query<{ id: string; kind: string; status: string }>(
  "SELECT id, kind, status FROM kg_conflict_prompts WHERE org_id = $1 AND thread_id = $2 ORDER BY id", [ORG, threadId])).rows);

/** 说一句、抽取完，返回这一轮回答的 turn memory（契约 out 校验过）。 */
async function sayAndRead(threadId: string, text: string): Promise<{ answerId: string; body: CardTurnBody }> {
  const t = await turn(e, a, ORG, threadId, text, AGENT);
  await settle();
  const r = await a.get<CardTurnBody>(memoryPath(threadId, t.answerId));
  expect(r.status).toBe(200);
  const parsed = KG.knowledgeGraph.getTurnMemory.out.safeParse(r.body);
  expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  return { answerId: t.answerId, body: r.body };
}

async function recalledIn(threadId: string): Promise<{ memory: string; ids: string[] }> {
  await projectGraph(e);
  const t = await turn(e, a, ORG, threadId, UNRELATED, AGENT);
  const m = await a.get<TurnMemoryBody>(memoryPath(threadId, t.answerId));
  expect(m.status).toBe(200);
  return { memory: t.memory ?? "", ids: m.body.recalled.map((x) => x.claimId).sort() };
}

const ids: { old?: string; newSession?: string; promptId?: string; bAnswer?: string } = {};

beforeAll(async () => {
  e = await startApp();
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await enableExtraction(ORG);
  for (const u of [USER_A, USER_B]) await addOrgMember(ORG, u, "consultant", fx.teams.energy!);
  await publishAgent(ORG, AGENT, USER_A);
  for (const id of [A1, B1, C1, C2, C3, V1, V2, G1, N1, N2, K1, K2]) {
    await addChatThread({ orgId: ORG, id: id!, projectId: null, visibilityScope: "private", createdBy: USER_A, title: id! });
  }
  await addChatThread({ orgId: ORG, id: OTHER!, projectId: null, visibilityScope: "private", createdBy: USER_B, title: OTHER! });
  a = client(e, USER_A, ORG);
  b = client(e, USER_B, ORG);
}, 180_000);

afterAll(async () => {
  await e?.app.close();
});

describe("issue #4290: 低把握改口（frame_only）⇒ 弹卡、不自动取代", () => {
  it("A1「我决定关注 211 高校」→ 自动记进个人空间", async () => {
    await addChatMessage({ orgId: ORG, id: "m-i4290c-a1", threadId: A1!, body: `${OLD}。`, authorId: USER_A });
    await settle();
    const p = await personalOf(OLD);
    ids.old = p.id;
    expect(p).toMatchObject({ revoked: false });
  }, 120_000);

  it("B1「改成关注 985 吧」：不取代；回答下是 possible_change 卡；两条都不转 contested，985 照常自动记入个人空间", async () => {
    const before = await claimRow(ids.old!);
    const { answerId, body } = await sayAndRead(B1!, `${NEW}吧`);
    ids.bAnswer = answerId;
    const { claim } = await claimIn(a, B1!, NEW);
    ids.newSession = claim.id;

    expect(body.supersede).toBeNull();
    expect(await noticesIn(B1!)).toEqual([]);
    expect(body.prompt).toMatchObject({
      type: "conflict",
      conflict: { kind: "possible_change", newerClaim: { id: claim.id, statement: NEW }, olderClaim: { id: ids.old, statement: OLD } },
    });
    ids.promptId = body.prompt!.conflict!.promptId;
    expect(await promptsIn(B1!)).toEqual([{ id: ids.promptId, kind: "possible_change", status: "open" }]);

    // 选之前两条都照常：旧的状态一点没变，新的仍是 proposed（不是 contested）
    expect(await claimRow(ids.old!)).toEqual(before);
    expect(await claimRow(claim.id)).toMatchObject({ status: "proposed", revoked: false });
    expect(await personalOf(NEW)).toMatchObject({ status: "proposed", revoked: false });
  }, 120_000);

  it("卡开着时，新会话 C1 两条都召回", async () => {
    const r = await recalledIn(C1!);
    expect(r.memory).toContain(OLD);
    expect(r.memory).toContain(NEW);
    expect(r.ids).toEqual([ids.old, (await personalOf(NEW)).id].sort());
  }, 120_000);

  it("隐私：别人读不到这张卡、点不动；拿到 id 在自己的会话里点也是同一个 404；所有者点不存在的卡同样 404", async () => {
    const seen = await b.get(memoryPath(B1!, ids.bAnswer!));
    expect(seen.status).toBe(404);
    const theirs = await b.post<{ reasonCode?: string }>(`/knowledge-graph/threads/${B1}/actions`, {
      basedOnRevision: 0, action: { type: "resolveConflict", promptId: ids.promptId, resolution: "keep_new" },
    });
    expect(theirs.status).toBe(404);
    const k = await b.get<ThreadKnowledgeBody>(`/knowledge-graph/threads/${OTHER}`);
    expect(k.status).toBe(200);
    const elsewhere = await b.post<{ reasonCode?: string }>(`/knowledge-graph/threads/${OTHER}/actions`, {
      basedOnRevision: k.body.revision, action: { type: "resolveConflict", promptId: ids.promptId, resolution: "keep_new" },
    });
    expect(elsewhere.status).toBe(404);
    expect(elsewhere.body).toMatchObject({ reasonCode: "KG_PROMPT_NOT_FOUND" });
    const bogus = await a.post<{ reasonCode?: string }>(`/knowledge-graph/threads/${B1}/actions`, {
      basedOnRevision: (await claimIn(a, B1!, NEW)).revision, action: { type: "resolveConflict", promptId: "kgp-nope", resolution: "keep_new" },
    });
    expect(bogus.status).toBe(404);
    expect(bogus.body).toMatchObject({ reasonCode: "KG_PROMPT_NOT_FOUND" });
    expect(await claimRow(ids.old!)).toMatchObject({ revoked: false });
  }, 120_000);

  it("[取代]（keep_new）⇒ 211 superseded、985 转「你确认过」（不晋升出第二份）；新会话 C2 只召回 985", async () => {
    const res = await a.post(`/knowledge-graph/threads/${B1}/actions`, {
      basedOnRevision: (await claimIn(a, B1!, NEW)).revision,
      action: { type: "resolveConflict", promptId: ids.promptId, resolution: "keep_new" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await claimRow(ids.old!)).toMatchObject({ status: "superseded", revoked: true });
    expect(await claimRow(ids.newSession!)).toMatchObject({ status: "accepted", revoked: false });
    const newPersonal = await personalOf(NEW);
    expect(newPersonal).toMatchObject({ status: "accepted", revoked: false });
    expect(await promptsIn(B1!)).toEqual([{ id: ids.promptId, kind: "possible_change", status: "kept_new" }]);
    const turnAfter = await a.get<CardTurnBody>(memoryPath(B1!, ids.bAnswer!));
    expect(turnAfter.body.prompt).toBeNull();

    const r = await recalledIn(C2!);
    expect(r.memory).toContain(NEW);
    expect(r.memory).not.toContain(OLD);
    expect(r.ids).toEqual([newPersonal.id]);
  }, 120_000);

  it("V1「我决定用 Vue」→ V2「改成用 React 吧」⇒ 卡；[两条都保留]（keep_both，不带适用条件）⇒ 卡关掉、两条都不动；C3 两条都召回", async () => {
    await addChatMessage({ orgId: ORG, id: "m-i4290c-v1", threadId: V1!, body: `${VUE}。`, authorId: USER_A });
    await settle();
    const vue = await personalOf(VUE);
    const { body } = await sayAndRead(V2!, `${REACT}吧`);
    expect(body.supersede).toBeNull();
    expect(body.prompt).toMatchObject({ type: "conflict", conflict: { kind: "possible_change", olderClaim: { id: vue.id } } });
    const react = (await claimIn(a, V2!, REACT)).claim;
    const promptId = body.prompt!.conflict!.promptId;
    const res = await a.post(`/knowledge-graph/threads/${V2}/actions`, {
      basedOnRevision: (await claimIn(a, V2!, REACT)).revision,
      action: { type: "resolveConflict", promptId, resolution: "keep_both" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await promptsIn(V2!)).toEqual([{ id: promptId, kind: "possible_change", status: "kept_both" }]);
    expect(await claimRow(vue.id)).toEqual(vue);
    expect(await claimRow(react.id)).toMatchObject({ status: "proposed", revoked: false });

    const r = await recalledIn(C3!);
    expect(r.memory).toContain(VUE);
    expect(r.memory).toContain(REACT);
  }, 120_000);

  it("反证：改口被评判否掉（「改成采用 Rust 不现实」）/ 话题不在旧决定里（「关于周会，改成采用飞书」）⇒ 对「采用 Go」既不取代、也不弹卡", async () => {
    await addChatMessage({ orgId: ORG, id: "m-i4290c-g1", threadId: G1!, body: `${GO}。`, authorId: USER_A });
    await settle();
    const go = await personalOf(GO);
    await addChatMessage({ orgId: ORG, id: "m-i4290c-n1", threadId: N1!, body: `${JUDGED}。`, authorId: USER_A });
    await addChatMessage({ orgId: ORG, id: "m-i4290c-n2", threadId: N2!, body: `${TOPIC}。`, authorId: USER_A });
    await settle();
    await claimIn(a, N1!, JUDGED);
    await claimIn(a, N2!, TOPIC);
    for (const t of [N1!, N2!]) {
      expect(await noticesIn(t)).toEqual([]);
      expect(await promptsIn(t)).toEqual([]);
    }
    expect(await claimRow(go.id)).toEqual(go);
  }, 120_000);

  it("复合的旧决定「后端用 Go 语言，前端用 TS 语言」→「前端改用 JS 语言」⇒ 只弹卡、不自动取代；旧决定照常生效", async () => {
    await addChatMessage({ orgId: ORG, id: "m-i4290c-k1", threadId: K1!, body: `${COMPOUND}。`, authorId: USER_A });
    await settle();
    const compound = await personalOf(COMPOUND);
    const { body } = await sayAndRead(K2!, FRONTEND_JS);
    const js = (await claimIn(a, K2!, FRONTEND_JS)).claim;
    expect(body.supersede).toBeNull();
    expect(await noticesIn(K2!)).toEqual([]);
    expect(body.prompt).toMatchObject({
      type: "conflict",
      conflict: { kind: "possible_change", newerClaim: { id: js.id, statement: FRONTEND_JS }, olderClaim: { id: compound.id, statement: COMPOUND } },
    });
    expect(await promptsIn(K2!)).toEqual([{ id: body.prompt!.conflict!.promptId, kind: "possible_change", status: "open" }]);
    // 旧决定一点没变（没有 superseded、没有 contested），新的仍是 proposed
    expect(await claimRow(compound.id)).toEqual(compound);
    expect(await claimRow(js.id)).toMatchObject({ status: "proposed", revoked: false });
  }, 120_000);
});
