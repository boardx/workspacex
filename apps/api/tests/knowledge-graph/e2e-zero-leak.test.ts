/**
 * Phase 18 F14 —— 北极星同一条路径上的零越权（S2 = 0；uc-18-2 R5 / V2，uc-18-4 R5 / V2）。
 *
 * 与 e2e-north-star-recall 同一套完整应用与真链路（见 kg-e2e-fixtures.ts 文件头）：所有者 u-owner 在个人会话 A
 * 里说过「张三决定下周一上线 v2」「因为客户 A 要求 …」，抽取入图、确认并存入个人空间。然后换人、换组织、
 * 换会话，用同样的问题去问、用同样的接口去读、再往图路里硬掺所有者的 id：
 *
 *   - 另一用户（同组织，自己的个人会话）：模型收到的上下文里没有记忆、回答说「没有找到」、回答下方引用为空；
 *     读所有者的会话知识 / 回答引用 / 来源抽屉 / 消息流、往所有者会话发消息或晋升 ⇒ 一律 404，且与「不存在」
 *     逐字相同（除 traceId）。
 *   - 项目成员（同组织，共享项目会话 S）：只召回会话 S 里的 L0，看不到所有者的 L0（会话 A）与 L1；
 *     所有者本人在共享项目会话里提问**带**自己的 L1（issue #4284 人类决定 2026-09-26），但成员读那一轮的引用 / 来源
 *     拿不到它（读侧按查看者过滤）。回答正文本身可能复述 L1，是已记录的产品取舍（usecases.md），不在本扫描之内——
 *     所以所有者那一轮放在另一个共享会话 S_OWN 里问，免得它的回答进了 S 的对话历史、被成员后续几轮的模型上下文带上。
 *   - 另一组织、同一个用户 id：召回为空；拿本组织的会话 / 结论 / 回答 id 去读 ⇒ 404；RLS 下 0 行。
 *   - 图路径尝试：执行器的图路把所有者的 L0 / L1 结论 id（连同经过所有者实体的路径）递给别人 ⇒ 召回与候选集
 *     求交后丢掉，模型上下文与回答引用里都没有；伪造别人的回答引用记录混进所有者的 id 与图路径 ⇒ 读接口按查看者
 *     复核后丢掉。
 *
 * 每个探针的输出都过同一个「秘密扫描」（所有者的原话、结论 id、个人空间 id、实体名以外的私有原文）；
 * 最后断言泄漏条数 = 0（S2）。对照组（所有者本人）必须能召回，保证扫描不是空转。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KnowledgeRecallPort } from "../../src/application/knowledge-graph/ports";
import { toOrgId } from "../../src/domain/org-id";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { addOrgMember, addProjectMember, asApp, asOwner, resetOrgs, seedOrg } from "../support/db";
import {
  ASK_DEMAND, ASK_WHO_WHY, CONTRACT, DECISION, DEMAND, NOTHING_FOUND, RELEASE, SAY_DECISION, SAY_DEMAND, SAY_RELEASE,
  client, memoryPath, projectGraph, publishAgent, settleKnowledge, sourcesPath, startApp, turn,
  type Client, type E2eApp, type HttpResult, type ThreadKnowledgeBody, type Turn, type TurnMemoryBody,
} from "./kg-e2e-fixtures";
import { enableExtraction } from "./kg-extraction-fixtures";

const ORG = "org-kg-f14-zero-leak";
const ORG2 = "org-kg-f14-zero-leak2";
const OWNER = "u-f14-zl-owner";
const MEMBER = "u-f14-zl-member";
const OTHER = "u-f14-zl-other";
const AGENT = "agent-f14-zl";
const AGENT2 = "agent-f14-zl2";
const agentOf = (org: string) => (org === ORG2 ? AGENT2 : AGENT);
const A = "thr-f14-zl-a";
const B = "thr-f14-zl-b";
const S = "thr-f14-zl-s";
const S_OWN = "thr-f14-zl-s-own";
const O = "thr-f14-zl-o";
const X = "thr-f14-zl-x";

let e: E2eApp;
let api: { owner: Client; member: Client; other: Client; owner2: Client };
/** 所有者私有的一切：原话、L0 / L1 结论 id、会话 A 里的实体 id、所有者回答的 id。 */
const secrets = new Set<string>([SAY_DECISION, SAY_DEMAND, DECISION, DEMAND, "张三"]);
const leaks: string[] = [];
const probes: string[] = [];
let ownerAnswerB: Turn;
let ids: { decision: string; demand: string; pDecision: string; pDemand: string; objects: string[] };

/** 秘密扫描：payload 里出现任何一条所有者私有内容 ⇒ 记一条泄漏。 */
function scan(label: string, payload: unknown): void {
  probes.push(label);
  const text = typeof payload === "string" ? payload : JSON.stringify(payload ?? null);
  for (const s of secrets) if (text.includes(s)) leaks.push(`${label}: ${s}`);
}
const stripTrace = (b: unknown) => ({ ...(b as Record<string, unknown>), traceId: undefined });

/** 越权读：必须 404，且响应体与「根本不存在」的同一个接口逐字相同（除 traceId）。 */
async function expectSameAsMissing(label: string, got: HttpResult, missing: HttpResult): Promise<void> {
  scan(label, got.body);
  expect(got.status, label).toBe(404);
  expect(missing.status, `${label}（不存在对照）`).toBe(404);
  expect(stripTrace(got.body), label).toEqual(stripTrace(missing.body));
}

/** 以某人身份问一轮，扫描模型上下文、回答、回答下方的引用。 */
async function ask(label: string, who: Client, org: string, threadId: string, q: string, knowledge?: KnowledgeRecallPort): Promise<Turn> {
  const t = await turn(e, who, org, threadId, q, agentOf(org), knowledge ? { knowledge } : {});
  scan(`${label} · 模型上下文`, t.input);
  scan(`${label} · 回答`, t.answer);
  const mem = await who.get<TurnMemoryBody>(memoryPath(threadId, t.answerId));
  expect(mem.status, label).toBe(200);
  scan(`${label} · 回答下方引用`, mem.body);
  return t;
}

/** 图路径尝试：在真实图路结果之后，硬掺所有者的 L0 / L1 结论 id，路径经过所有者会话 A 的实体。 */
let leakyCalls = 0;
function leakyGraph(): KnowledgeRecallPort {
  return {
    recordTurn: (...a) => e.recall.recordTurn(...a),
    candidates: (...a) => e.recall.candidates(...a),
    graphNeighbors: async (o, seeds) => [
      ...(leakyCalls += 1, await e.recall.graphNeighbors(o, seeds)),
      ...[ids.decision, ids.demand, ids.pDecision, ids.pDemand].map((claimId) => ({
        claimId, path: [{ src: `object:${ids.objects[0]!}`, relation: "about", dst: `claim:${claimId}` }],
      })),
    ],
  };
}

beforeAll(async () => {
  e = await startApp();
  await resetOrgs(ORG, ORG2);
  const fx = await seedOrg({ orgId: ORG, projectId: `${ORG}-p` });
  for (const u of [OWNER, MEMBER, OTHER]) await addOrgMember(ORG, u, "consultant", fx.teams.energy!);
  for (const u of [OWNER, MEMBER]) await addProjectMember(ORG, `${ORG}-p`, u, "facilitator", null);
  await publishAgent(ORG, AGENT, OWNER);
  await addChatThread({ orgId: ORG, id: A, projectId: null, visibilityScope: "private", createdBy: OWNER, title: "v2 上线" });
  await addChatThread({ orgId: ORG, id: B, projectId: null, visibilityScope: "private", createdBy: OWNER, title: "新对话" });
  await addChatThread({ orgId: ORG, id: S, projectId: `${ORG}-p`, visibilityScope: "plenary", createdBy: OWNER, title: "项目群聊" });
  await addChatThread({ orgId: ORG, id: S_OWN, projectId: `${ORG}-p`, visibilityScope: "plenary", createdBy: OWNER, title: "项目群聊 2" });
  await addChatThread({ orgId: ORG, id: O, projectId: null, visibilityScope: "private", createdBy: OTHER, title: "我的对话" });
  // 另一个组织：同一个用户 id 也是成员，有自己的个人会话
  await seedOrg({ orgId: ORG2, projectId: `${ORG2}-p` });
  await enableExtraction(ORG, ORG2);
  await addOrgMember(ORG2, OWNER, "consultant", null);
  await publishAgent(ORG2, AGENT2, OWNER);
  await addChatThread({ orgId: ORG2, id: X, projectId: null, visibilityScope: "private", createdBy: OWNER, title: "另一个组织" });
  api = { owner: client(e, OWNER, ORG), member: client(e, MEMBER, ORG), other: client(e, OTHER, ORG), owner2: client(e, OWNER, ORG2) };

  // 所有者在个人会话 A 里说过的话（见 e2e-north-star-recall 文件头 #3553 一节），项目会话 S 里说过合同那句（真受理）
  await addChatMessage({ orgId: ORG, id: "m-f14-zl-decision", threadId: A, body: SAY_DECISION, authorId: OWNER });
  await addChatMessage({ orgId: ORG, id: "m-f14-zl-demand", threadId: A, body: SAY_DEMAND, authorId: OWNER });
  await turn(e, api.owner, ORG, S, `${CONTRACT}。`, AGENT);
  await settleKnowledge(e, ORG);
  const k = await api.owner.get<ThreadKnowledgeBody>(`/knowledge-graph/threads/${A}`);
  const decision = k.body.claims.find((c) => c.statement === DECISION)!.id;
  const demand = k.body.claims.find((c) => c.statement === DEMAND)!.id;
  const confirm = await api.owner.post(`/knowledge-graph/threads/${A}/actions`, {
    basedOnRevision: k.body.revision, action: { type: "confirmClaims", claimIds: [decision, demand] },
  });
  expect(confirm.status).toBe(200);
  const promoted = await api.owner.post<{ results: Array<{ claimId: string; personalClaimId: string }> }>(
    `/knowledge-graph/threads/${A}/promote`, { claimIds: [decision, demand] });
  expect(promoted.status).toBe(200);
  const p = new Map(promoted.body.results.map((r) => [r.claimId, r.personalClaimId]));
  const objects = (await asOwner(async (c) => (await c.query<{ id: string }>(
    "SELECT id FROM ontology_objects WHERE org_id = $1 AND scope_kind = 'chat_session' AND scope_id = $2 ORDER BY id", [ORG, A])).rows)).map((r) => r.id);
  ids = { decision, demand, pDecision: p.get(decision)!, pDemand: p.get(demand)!, objects };
  for (const s of [decision, demand, ids.pDecision, ids.pDemand, ...objects]) secrets.add(s);
  await projectGraph(e);
}, 180_000);

afterAll(async () => {
  await e?.app.close();
});

describe("F14 零越权：对照组（所有者本人必须召回得到，扫描才不是空转）", () => {
  it("所有者在自己的新会话 B 里问 ⇒ 召回两条个人空间知识，扫描能抓到它们", async () => {
    ownerAnswerB = await turn(e, api.owner, ORG, B, ASK_WHO_WHY, AGENT);
    expect(ownerAnswerB.memory).toContain(`${DECISION}（来自个人空间知识`);
    expect(ownerAnswerB.memory).toContain(`${DEMAND}（来自个人空间知识`);
    const mem = await api.owner.get<TurnMemoryBody>(memoryPath(B, ownerAnswerB.answerId));
    expect(mem.body.recalled.map((m) => m.claimId).sort()).toEqual([ids.pDecision, ids.pDemand].sort());
    secrets.add(ownerAnswerB.answerId);
    // 扫描器自检：对所有者自己的结果扫描必须报出泄漏（随后清掉，不计入 S2）
    scan("自检", ownerAnswerB.input);
    expect(leaks.length).toBeGreaterThan(0);
    leaks.length = 0;
    probes.length = 0;
  });
});

describe("F14 零越权：另一用户（同组织）", () => {
  it("在自己的个人会话里问同样的问题 ⇒ 模型没有记忆、回答「没有找到」、引用为空、候选集为空", async () => {
    for (const q of [ASK_WHO_WHY, ASK_DEMAND]) {
      const t = await ask(`other@O「${q}」`, api.other, ORG, O, q);
      expect(t.memory).toBeNull();
      expect(t.answer).toContain(NOTHING_FOUND);
    }
    const c = await e.recall.candidates(toOrgId(ORG), OTHER, O);
    expect(c.claims).toEqual([]);
    expect(c.objects).toEqual([]);
  });

  it("读所有者的会话知识 / 回答引用 / 来源抽屉 / 消息流，往所有者会话发消息或晋升 ⇒ 404，与不存在逐字相同", async () => {
    const o = api.other;
    await expectSameAsMissing("other 读 A 的知识", await o.get(`/knowledge-graph/threads/${A}`), await o.get("/knowledge-graph/threads/thr-no-such"));
    await expectSameAsMissing("other 读 B 的回答引用", await o.get(memoryPath(B, ownerAnswerB.answerId)), await o.get(memoryPath("thr-no-such", "msg-no-such")));
    for (const id of [ids.decision, ids.demand, ids.pDecision, ids.pDemand]) {
      await expectSameAsMissing(`other 打开来源 ${id}`, await o.get(sourcesPath(id)), await o.get(sourcesPath("clm-no-such")));
    }
    await expectSameAsMissing("other 晋升 A 的结论", await o.post(`/knowledge-graph/threads/${A}/promote`, { claimIds: [ids.decision] }),
      await o.post("/knowledge-graph/threads/thr-no-such/promote", { claimIds: [ids.decision] }));
    await expectSameAsMissing("other 读 A 的消息流", await o.get(`/chat/threads/${A}/messages`), await o.get("/chat/threads/thr-no-such/messages"));
    const posted = await o.post(`/chat/threads/${A}/messages`, { clientMessageId: "00000000-0000-4000-8000-00000000f14a", text: ASK_WHO_WHY, agentId: AGENT });
    scan("other 往 A 发消息", posted.body);
    expect(posted.status).toBe(404);
  });

  it("图路径尝试：图路把所有者的 L0 / L1 id 与经过所有者实体的路径递过来 ⇒ 求交后丢掉", async () => {
    // 让另一用户的会话里有自己的 v2 实体，问题才会解析出图种子、图路才真的执行
    await addChatMessage({ orgId: ORG, id: "m-f14-zl-other-release", threadId: O, body: SAY_RELEASE, authorId: OTHER });
    await settleKnowledge(e, ORG);
    const before = leakyCalls;
    const t = await ask("other@O 掺图路", api.other, ORG, O, ASK_WHO_WHY, leakyGraph());
    expect(leakyCalls).toBe(before + 1);
    expect(t.memory).toContain(RELEASE);
    // 执行器记下的这一轮也没有任何所有者的 id
    const [rec] = await asOwner(async (c) => (await c.query("SELECT items FROM kg_turn_recalls WHERE run_id = $1", [t.runId])).rows);
    scan("other 掺图路 · 召回记录", rec ?? null);
  });
});

describe("F14 零越权：项目成员（共享项目会话 S）", () => {
  let memberTurn: Turn;

  it("成员在 S 里问 ⇒ 只召回 S 里的合同那条（L0），看不到所有者会话 A 的 L0 与个人空间 L1", async () => {
    memberTurn = await ask("member@S", api.member, ORG, S, ASK_DEMAND);
    expect(memberTurn.memory).toContain(CONTRACT);
    const mem = await api.member.get<TurnMemoryBody>(memoryPath(S, memberTurn.answerId));
    expect(mem.body.recalled.map((m) => m.scope)).toEqual(["chat_session"]);
    expect(mem.body.recalled.map((m) => m.statement)).toEqual([CONTRACT]);
  });

  it("所有者本人在共享项目会话里问 ⇒ 带自己的个人空间 L1（issue #4284）；成员读那一轮的引用与来源 ⇒ 干净", async () => {
    // 所有者自己的这一轮不过扫描（那是他本人的记忆）；扫描的是成员能读到的结构化读路径。
    const t = await turn(e, api.owner, ORG, S_OWN, ASK_WHO_WHY, AGENT);
    expect(t.memory).toContain(`${DECISION}（来自个人空间知识`);
    const own = await api.owner.get<TurnMemoryBody>(memoryPath(S_OWN, t.answerId));
    expect(own.body.recalled.map((m) => m.claimId)).toEqual(expect.arrayContaining([ids.pDecision]));
    const mem = await api.member.get<TurnMemoryBody>(memoryPath(S_OWN, t.answerId));
    expect(mem.status).toBe(200);
    expect(mem.body.recalled).toEqual([]);
    scan("member 读 owner@S_OWN 的回答引用", mem.body);
    scan("member 读 S_OWN 的知识面板", (await api.member.get(`/knowledge-graph/threads/${S_OWN}`)).body);
  });

  it("成员读所有者的个人会话 / 个人空间来源 / 所有者在 B 的回答引用 ⇒ 404，与不存在逐字相同", async () => {
    const m = api.member;
    await expectSameAsMissing("member 读 A 的知识", await m.get(`/knowledge-graph/threads/${A}`), await m.get("/knowledge-graph/threads/thr-no-such"));
    await expectSameAsMissing("member 读 B 的回答引用", await m.get(memoryPath(B, ownerAnswerB.answerId)), await m.get(memoryPath("thr-no-such", "msg-no-such")));
    for (const id of [ids.decision, ids.demand, ids.pDecision, ids.pDemand]) {
      await expectSameAsMissing(`member 打开来源 ${id}`, await m.get(sourcesPath(id)), await m.get(sourcesPath("clm-no-such")));
    }
  });

  it("图路径尝试：成员这一轮的图路被掺所有者的 id ⇒ 上下文与引用里没有；伪造成员回答的引用记录 ⇒ 读接口丢掉", async () => {
    const before = leakyCalls;
    const t = await ask("member@S 掺图路", api.member, ORG, S, ASK_DEMAND, leakyGraph());
    expect(leakyCalls).toBe(before + 1);
    expect(t.memory).toContain(CONTRACT);
    // 直接往这一轮的召回记录里塞所有者的结论 id 与经过所有者实体的图路径（模拟记录层被污染）
    const forged = [ids.decision, ids.demand, ids.pDecision, ids.pDemand].map((claimId) => ({
      claimId, channels: ["fts", "graph"], retrievalReasons: ["recall", "lead"], score: 0.05,
      graphPath: [{ src: `object:${ids.objects[0]!}`, relation: "about", dst: `claim:${claimId}` }],
    }));
    await asOwner((c) => c.query("UPDATE kg_turn_recalls SET items = items || $2::jsonb WHERE run_id = $1", [t.runId, JSON.stringify(forged)]));
    for (const [label, who] of [["member", api.member], ["owner", api.owner]] as const) {
      const mem = await who.get<TurnMemoryBody>(memoryPath(S, t.answerId));
      expect(mem.status).toBe(200);
      expect(mem.body.recalled.map((r) => r.claimId)).not.toEqual(expect.arrayContaining([ids.decision]));
      if (label === "member") scan("member 读被伪造的回答引用", mem.body);
      // 所有者读共享会话里的这条回答：会话 A 的 L0 不属于 S，同样丢掉；个人空间的只给本人看（F13 读侧第二道）
      else expect(mem.body.recalled.map((r) => r.claimId)).not.toContain(ids.demand);
    }
  });
});

describe("F14 零越权：另一组织（同一个用户 id）", () => {
  it("在另一个组织的个人会话里问 ⇒ 没有记忆、引用为空；候选集拿本组织的会话 id 也为空", async () => {
    for (const q of [ASK_WHO_WHY, ASK_DEMAND]) {
      const t = await ask(`owner@ORG2「${q}」`, api.owner2, ORG2, X, q);
      expect(t.memory).toBeNull();
      expect(t.answer).toContain(NOTHING_FOUND);
    }
    for (const threadId of [X, A, B]) {
      const c = await e.recall.candidates(toOrgId(ORG2), OWNER, threadId);
      scan(`candidates(ORG2, ${threadId})`, c);
      expect(c.claims).toEqual([]);
    }
  });

  it("图路径尝试：另一组织的图路被掺本组织所有者的 id ⇒ 丢掉", async () => {
    await addChatMessage({ orgId: ORG2, id: "m-f14-zl-org2-release", threadId: X, body: SAY_RELEASE, authorId: OWNER });
    await settleKnowledge(e, ORG2);
    const before = leakyCalls;
    const t = await ask("owner@ORG2 掺图路", api.owner2, ORG2, X, ASK_WHO_WHY, leakyGraph());
    expect(leakyCalls).toBe(before + 1);
    expect(t.memory).toContain(RELEASE);
  });

  it("拿本组织的会话 / 回答 / 结论 id 在另一组织里读 ⇒ 404，与不存在逐字相同", async () => {
    const o = api.owner2;
    await expectSameAsMissing("ORG2 读 A 的知识", await o.get(`/knowledge-graph/threads/${A}`), await o.get("/knowledge-graph/threads/thr-no-such"));
    await expectSameAsMissing("ORG2 读 B 的回答引用", await o.get(memoryPath(B, ownerAnswerB.answerId)), await o.get(memoryPath("thr-no-such", "msg-no-such")));
    for (const id of [ids.decision, ids.demand, ids.pDecision, ids.pDemand]) {
      await expectSameAsMissing(`ORG2 打开来源 ${id}`, await o.get(sourcesPath(id)), await o.get(sourcesPath("clm-no-such")));
    }
  });

  it("数据库层（RLS）：另一组织上下文、或本组织别的用户，直接查这些结论 ⇒ 0 行", async () => {
    const all = [ids.decision, ids.demand, ids.pDecision, ids.pDemand];
    const count = (org: string, userId: string) => asApp(org, async (c) => {
      await c.query("BEGIN");
      try {
        await c.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
        return (await c.query("SELECT id FROM claims WHERE id = ANY($1::text[])", [all])).rowCount;
      } finally {
        await c.query("ROLLBACK");
      }
    });
    expect(await count(ORG2, OWNER)).toBe(0);
    // 同组织别的用户：个人空间两条看不到（会话 A 的 L0 行由会话可见性在读路径上挡，见上面的 404）
    const personal = (userId: string) => asApp(ORG, async (c) => {
      await c.query("BEGIN");
      try {
        await c.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
        return (await c.query("SELECT id FROM claims WHERE id = ANY($1::text[])", [[ids.pDecision, ids.pDemand]])).rowCount;
      } finally {
        await c.query("ROLLBACK");
      }
    });
    expect(await personal(MEMBER)).toBe(0);
    expect(await personal(OTHER)).toBe(0);
    expect(await personal(OWNER)).toBe(2);
  });
});

describe("F14 零越权：S2 汇总", () => {
  it("所有探针的泄漏条数 = 0", () => {
    expect(probes.length).toBeGreaterThanOrEqual(30);
    expect(leaks).toEqual([]);
  });
});
