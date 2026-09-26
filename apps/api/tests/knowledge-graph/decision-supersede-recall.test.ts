/**
 * Issue #4290 —— 跨会话改口：本人明确改口时新决定自动取代旧决定（可撤销），召回不再同时给出矛盾的两条。
 *
 * 走真实路径（kg-e2e-fixtures.ts 文件头：完整应用、真受理、真抽取 tick（含 F16 判矛盾 + #4290 判取代）、
 * 生产同款 PgKnowledgeRecall、真写回、真 GET memory、真 POST actions）：
 *   - 用户 A 在个人会话 A1 说「我决定关注 211 高校」→ 确认 → 存入个人空间；
 *   - A 在个人会话 B1 说「改成关注 985 高校吧」→ 抽取任务里判出明确改口：个人空间的 211 转 superseded
 *     （decision_changed），这一轮回答下出「已用〈新〉取代〈旧〉」提示；A 把 985 存入个人空间；
 *   - A 开新会话 C1 说「开始写报告吧」：只召回 985，不召回 211（**去掉修复这一条会失败**：两条都被强制召回）；
 *   - A 在 B1 点「撤销」（applyHumanAction{undoSupersede}）：211 恢复为生效、985 仍在；提示读作 undone；
 *     再开新会话 C2：两条都召回；抽取任务重试不会再次取代（同一条新决定只取代一次）。
 *   - 反证：并列补充（「也关注 985 高校」）不取代；项目会话里别人的改口不取代我的决定（只作用于同一作者）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { knowledgeGraph as KG } from "@repo/contracts";
import { detectSupersedes } from "../../src/application/knowledge-graph/detect-conflicts";
import { runExtractionTick } from "../../src/application/knowledge-graph/extract-message-knowledge";
import { newKgId } from "../../src/application/knowledge-graph/ids";
import { toOrgId } from "../../src/domain/org-id";
import { PgKgConflict } from "../../src/infrastructure/knowledge-graph/pg-kg-conflict";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { addOrgMember, addProjectMember, asOwner, resetOrgs, seedOrg } from "../support/db";
import {
  client, memoryPath, projectGraph, publishAgent, startApp, turn,
  type Client, type E2eApp, type ThreadKnowledgeBody, type TurnMemoryBody,
} from "./kg-e2e-fixtures";
import { enableExtraction, extractionDeps, loopbackModel } from "./kg-extraction-fixtures";

const ORG = "org-kg-i4290-supersede";
const PROJECT = `${ORG}-p`;
const USER_A = "u-i4290-a";
const USER_B = "u-i4290-b";
const AGENT = "agent-i4290";
const A1 = "thr-i4290-a1";
const B1 = "thr-i4290-b1";
const C1 = "thr-i4290-c1";
const C2 = "thr-i4290-c2";
const ADD = "thr-i4290-add";
const SHARED = "thr-i4290-shared";

const OLD = "我决定关注 211 高校";
const NEW = "改成关注 985 高校";
const SAY_NEW = `${NEW}吧`;
const ALSO = "也关注 985 高校";
const SHARED_OLD = "我决定关注 C9 高校";
const SHARED_NEW = "改成关注 双一流 高校";
const UNRELATED = "开始写报告吧";

const decisionReply = (statement: string) => JSON.stringify({
  entities: [],
  claims: [{ statement, kind: "decision", confidence: 0.9, about: [], decidedBy: null, quote: statement }],
});
const MODEL = () => loopbackModel([
  [OLD, decisionReply(OLD)], [NEW, decisionReply(NEW)], [ALSO, decisionReply(ALSO)],
  [SHARED_OLD, decisionReply(SHARED_OLD)], [SHARED_NEW, decisionReply(SHARED_NEW)],
]).model;

interface SupersedeTurnBody extends TurnMemoryBody {
  readonly supersede: { noticeId: string; newerClaim: { id: string; statement: string }; olderClaim: { id: string; statement: string }; state: string } | null;
}

let e: E2eApp;
let a: Client;

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

/** 会话里那条结论：确认 → 存入本人个人空间，返回个人空间副本的 id。 */
async function confirmAndPromote(api: Client, threadId: string, statement: string): Promise<string> {
  const { claim, revision } = await claimIn(api, threadId, statement);
  const confirm = await api.post(`/knowledge-graph/threads/${threadId}/actions`, {
    basedOnRevision: revision, action: { type: "confirmClaims", claimIds: [claim.id] },
  });
  expect(confirm.status, JSON.stringify(confirm.body)).toBe(200);
  const promoted = await api.post<{ results: Array<{ claimId: string; personalClaimId?: string }> }>(
    `/knowledge-graph/threads/${threadId}/promote`, { claimIds: [claim.id] });
  expect(promoted.status, JSON.stringify(promoted.body)).toBe(200);
  const personal = promoted.body.results[0]?.personalClaimId;
  expect(personal).toEqual(expect.any(String));
  return personal!;
}

const claimRow = async (id: string) => (await asOwner(async (c) => (await c.query<{
  status: string; revoked: boolean; revocation_reason: string | null; supersedes_claim_id: string | null;
}>("SELECT status, revoked_at IS NOT NULL AS revoked, revocation_reason, supersedes_claim_id FROM claims WHERE org_id = $1 AND id = $2",
  [ORG, id])).rows))[0]!;

const ids: { oldPersonal?: string; newSession?: string; newPersonal?: string; bAnswer?: string; bQuestion?: string; noticeId?: string } = {};

beforeAll(async () => {
  e = await startApp();
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await enableExtraction(ORG);
  for (const u of [USER_A, USER_B]) {
    await addOrgMember(ORG, u, "consultant", fx.teams.energy!);
    await addProjectMember(ORG, PROJECT, u, "facilitator", null);
  }
  await publishAgent(ORG, AGENT, USER_A);
  for (const id of [A1, B1, C1, C2, ADD]) {
    await addChatThread({ orgId: ORG, id, projectId: null, visibilityScope: "private", createdBy: USER_A, title: id });
  }
  await addChatThread({ orgId: ORG, id: SHARED, projectId: PROJECT, visibilityScope: "plenary", createdBy: USER_A, title: SHARED });
  a = client(e, USER_A, ORG);
}, 180_000);

afterAll(async () => {
  await e?.app.close();
});

describe("issue #4290: 本人明确改口 ⇒ 新决定取代旧决定（可撤销）", () => {
  it("A1 说「我决定关注 211 高校」→ 存入个人空间", async () => {
    await addChatMessage({ orgId: ORG, id: "m-i4290-a1", threadId: A1, body: `${OLD}。`, authorId: USER_A });
    await settle();
    ids.oldPersonal = await confirmAndPromote(a, A1, OLD);
    expect(await claimRow(ids.oldPersonal)).toMatchObject({ status: "accepted", revoked: false });
  }, 120_000);

  it("B1 说「改成关注 985 高校吧」：个人空间的 211 被取代（decision_changed），回答下出取代提示", async () => {
    const t = await turn(e, a, ORG, B1, SAY_NEW, AGENT);
    ids.bAnswer = t.answerId;
    ids.bQuestion = t.questionId;
    await settle();
    const { claim } = await claimIn(a, B1, NEW);
    ids.newSession = claim.id;
    // 985 存入个人空间（#4283 合入后由自动记入代替这一步）；放在断言之前，C1 那条测试不依赖这里的断言是否通过
    ids.newPersonal = await confirmAndPromote(a, B1, NEW);
    await projectGraph(e);
    expect(await claimRow(ids.oldPersonal!)).toMatchObject({ status: "superseded", revoked: true, revocation_reason: "decision_changed" });
    // 个人线程只有所有者本人看得到新结论 ⇒ 新决定指回被取代的个人空间那条
    expect(await claimRow(ids.newSession)).toMatchObject({ status: "accepted", revoked: false, supersedes_claim_id: ids.oldPersonal });

    const r = await a.get<SupersedeTurnBody>(memoryPath(B1, t.answerId));
    expect(r.status).toBe(200);
    const parsed = KG.knowledgeGraph.getTurnMemory.out.safeParse(r.body);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
    expect(r.body.supersede).toMatchObject({
      newerClaim: { id: ids.newSession, statement: NEW }, olderClaim: { id: ids.oldPersonal, statement: OLD }, state: "applied",
    });
    ids.noticeId = r.body.supersede!.noticeId;
  }, 120_000);

  it("新会话 C1 说「开始写报告吧」：只召回 985，不再召回被取代的 211", async () => {
    const t = await turn(e, a, ORG, C1, UNRELATED, AGENT);
    expect(t.memory).not.toBeNull();
    expect(t.memory).toContain(NEW);
    expect(t.memory).not.toContain(OLD);
    expect(t.answer).toContain(NEW);
    expect(t.answer).not.toContain(OLD);
    const r = await a.get<TurnMemoryBody>(memoryPath(C1, t.answerId));
    expect(r.status).toBe(200);
    expect(r.body.recalled.map((m) => m.claimId)).toEqual([ids.newPersonal]);
  }, 120_000);

  it("撤销：211 恢复为生效、985 仍在；提示读作 undone；新会话 C2 两条都召回；抽取任务重试不再取代", async () => {
    const { revision } = await claimIn(a, B1, NEW);
    const undo = await a.post<{ revision: number }>(`/knowledge-graph/threads/${B1}/actions`, {
      basedOnRevision: revision, action: { type: "undoSupersede", noticeId: ids.noticeId },
    });
    expect(undo.status, JSON.stringify(undo.body)).toBe(200);
    expect(await claimRow(ids.oldPersonal!)).toMatchObject({ status: "accepted", revoked: false, revocation_reason: null });
    expect(await claimRow(ids.newSession!)).toMatchObject({ revoked: false, supersedes_claim_id: null });
    expect(await claimRow(ids.newPersonal!)).toMatchObject({ status: "accepted", revoked: false });
    // 级联收掉的边放回来了：个人空间的 211 仍 derived_from A1 里的原结论
    const [edge] = await asOwner(async (c) => (await c.query<{ n: string }>(
      `SELECT count(*) AS n FROM ontology_edges WHERE org_id = $1 AND src_kind = 'claim' AND src_id = $2
          AND relation = 'derived_from' AND status = 'active'`, [ORG, ids.oldPersonal])).rows);
    expect(Number(edge!.n)).toBe(1);

    const r = await a.get<SupersedeTurnBody>(memoryPath(B1, ids.bAnswer!));
    expect(r.body.supersede).toMatchObject({ noticeId: ids.noticeId, state: "undone" });
    // 同一个提示不能撤两次
    const again = await a.post(`/knowledge-graph/threads/${B1}/actions`, {
      basedOnRevision: (await claimIn(a, B1, NEW)).revision, action: { type: "undoSupersede", noticeId: ids.noticeId },
    });
    expect(again.status).toBe(404);
    expect(again.body).toMatchObject({ reasonCode: "KG_PROMPT_NOT_FOUND" });

    // 抽取任务重试（同一条消息再判一次）：撤销过的一对不再被取代
    const n = await detectSupersedes({ conflicts: new PgKgConflict(e.db), newId: newKgId },
      { orgId: toOrgId(ORG), threadId: B1, messageId: ids.bQuestion! });
    expect(n).toBe(0);
    expect(await claimRow(ids.oldPersonal!)).toMatchObject({ revoked: false });

    await projectGraph(e);
    const t = await turn(e, a, ORG, C2, UNRELATED, AGENT);
    expect(t.memory).toContain(NEW);
    expect(t.memory).toContain(OLD);
    const m = await a.get<TurnMemoryBody>(memoryPath(C2, t.answerId));
    expect(m.body.recalled.map((x) => x.claimId).sort()).toEqual([ids.newPersonal, ids.oldPersonal].sort());
  }, 120_000);

  it("反证：并列补充「也关注 985 高校」不取代任何决定", async () => {
    await addChatMessage({ orgId: ORG, id: "m-i4290-add", threadId: ADD, body: `${ALSO}。`, authorId: USER_A });
    await settle();
    expect(await claimRow(ids.oldPersonal!)).toMatchObject({ status: "accepted", revoked: false });
    const notices = await asOwner(async (c) => (await c.query(
      "SELECT id FROM kg_supersede_notices WHERE org_id = $1 AND thread_id = $2", [ORG, ADD])).rows);
    expect(notices).toEqual([]);
  }, 120_000);

  it("反证：项目会话里别人（B）的改口不取代我（A）的决定；我自己的改口才取代", async () => {
    await addChatMessage({ orgId: ORG, id: "m-i4290-s1", threadId: SHARED, body: `${SHARED_OLD}。`, authorId: USER_A });
    await settle();
    await addChatMessage({ orgId: ORG, id: "m-i4290-s2", threadId: SHARED, body: `${SHARED_NEW}吧。`, authorId: USER_B });
    await settle();
    const { claim: mine } = await claimIn(a, SHARED, SHARED_OLD);
    expect(await claimRow(mine.id)).toMatchObject({ revoked: false });
    // 同一句改口由 A 自己说 ⇒ 取代（同一作者，本会话里的旧条；supersedes 指向本会话那条）
    await addChatMessage({ orgId: ORG, id: "m-i4290-s3", threadId: SHARED, body: `还是${SHARED_NEW}吧。`, authorId: USER_A });
    await settle();
    expect(await claimRow(mine.id)).toMatchObject({ status: "superseded", revoked: true, revocation_reason: "decision_changed" });
  }, 120_000);
});
