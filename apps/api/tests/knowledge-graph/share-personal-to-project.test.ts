/**
 * phase-18 S10（issue #4367，epic #4359）——「分享到项目…」：个人结论显式提升到项目层。
 *
 * 走真实链路（kg-e2e-fixtures.ts：完整应用、真 HTTP、真抽取 tick、生产同款召回、真写回），钉住：
 *   · 范围预览：只列本人是成员（非观察者、未归档）的项目，列出项目里谁会看到（含观察者），已分享的标出来；
 *   · 授权：只有这条个人结论的主人能看目标 / 分享 / 撤回——别人一律 404，且与「不存在」逐字相同（人类决定：404 不是 403）；
 *     只能分享到自己是成员的项目（不是成员 ⇒ 404，与不存在的项目相同）；观察者 / 已归档 ⇒ 403；
 *   · 分享：项目里多一份派生副本（derived_from 连回、证据跟过去、作者 = 分享人、动作 shareToProject），个人原件不动；幂等；
 *   · 可见：全体项目成员（含观察者）在项目大脑里看到它，标「由 X 分享自个人记忆」；非成员什么都看不到；
 *   · 召回：项目会话里任何成员提问都能用上它，模型材料与回答引用都标出处；分享人自己提问不重复出现两份；
 *   · 撤回：项目副本失效（F07 级联收掉边），个人原件不动；再撤 ⇒ 404；
 *   · 原件被忘掉 ⇒ 分享出去的副本一并失效。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { knowledgeGraph as KG } from "@repo/contracts";
import { runExtractionTick } from "../../src/application/knowledge-graph/extract-message-knowledge";
import { toOrgId } from "../../src/domain/org-id";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { addCredential, addOrgMember, addProjectMember, asApp, asOwner, resetOrgs, seedOrg } from "../support/db";
import {
  client, memoryPath, projectGraph, publishAgent, sourcesPath, startApp, turn,
  type Client, type E2eApp, type HttpResult, type ThreadKnowledgeBody,
} from "./kg-e2e-fixtures";
import { enableExtraction, extractionDeps, loopbackModel } from "./kg-extraction-fixtures";

const ORG = "org-kg-s10-share";
const P1 = `${ORG}-p`;
const P2 = `${ORG}-p2`; // 分享人不是成员
const P3 = `${ORG}-p3`; // 分享人只是观察者
const P4 = `${ORG}-p4`; // 分享人是成员，但项目已归档
const OWNER = "u-s10-owner";
const MATE = "u-s10-mate";
const OBS = "u-s10-obs";
const OUT = "u-s10-out";
const NAMES: Record<string, string> = { [OWNER]: "李雷", [MATE]: "韩梅梅", [OBS]: "王观察" };
const AGENT = "agent-s10";
const OWN = "thr-s10-own";
const S = "thr-s10-s";
const OUT_T = "thr-s10-out";
const FACT = "客户 A 最看重交付确定性";
const ASK = "客户 A 最看重什么？";
const LABEL = `${FACT}（来自项目记忆，由 李雷 分享自个人记忆）`;

let e: E2eApp;
let owner: Client;
let mate: Client;
let obs: Client;
let out: Client;
const ids = { source: "", personal: "", copy: "" };

const factReply = (statement: string) => JSON.stringify({
  entities: [], claims: [{ statement, kind: "fact", confidence: 0.9, about: [], decidedBy: null, quote: statement }],
});
const sql = <T>(q: string, params: unknown[] = []) => asOwner(async (c) => (await c.query(q, params)).rows as T[]);
const targetsPath = (claimId: string) => `/knowledge-graph/personal/claims/${claimId}/share-targets`;
const sharePath = (claimId: string) => `/knowledge-graph/personal/claims/${claimId}/share`;
const unsharePath = (claimId: string) => `/knowledge-graph/personal/claims/${claimId}/unshare`;
const stripTrace = (x: unknown) => ({ ...(x as Record<string, unknown>), traceId: undefined });
function expectSame(label: string, got: HttpResult, twin: HttpResult, status: number, reasonCode: string): void {
  expect(got.status, `${label} ${JSON.stringify(got.body)}`).toBe(status);
  expect((got.body as { reasonCode?: string }).reasonCode, label).toBe(reasonCode);
  expect(stripTrace(got.body), `${label}（与对照逐字相同）`).toEqual(stripTrace(twin.body));
}

async function addProject(id: string): Promise<void> {
  await asApp(ORG, async (c) => {
    await c.query("INSERT INTO projects (id, org_id, name, kind) VALUES ($1, $2, $3, 'workshop')", [id, ORG, `project ${id}`]);
    await c.query("INSERT INTO workshops (id, org_id) VALUES ($1, $2)", [id, ORG]);
  });
}

beforeAll(async () => {
  e = await startApp();
  await resetOrgs(ORG);
  await sql("DELETE FROM credentials WHERE user_id LIKE 'u-s10-%'");
  await seedOrg({ orgId: ORG, projectId: P1 });
  await enableExtraction(ORG);
  for (const u of [OWNER, MATE, OBS, OUT]) await addOrgMember(ORG, u, "consultant", null);
  for (const [u, n] of Object.entries(NAMES)) await addCredential(u, `${u}@s10.test`, n);
  await addProject(P2);
  await addProject(P3);
  await addProject(P4);
  await addProjectMember(ORG, P1, OWNER, "member", null);
  await addProjectMember(ORG, P1, MATE, "facilitator", null);
  await addProjectMember(ORG, P1, OBS, "observer", null);
  await addProjectMember(ORG, P2, OUT, "facilitator", null);
  await addProjectMember(ORG, P3, OWNER, "observer", null);
  await addProjectMember(ORG, P4, OWNER, "member", null);
  await sql("UPDATE projects SET status = 'archived' WHERE id = $1", [P4]);
  await publishAgent(ORG, AGENT, MATE);
  await addChatThread({ orgId: ORG, id: OWN, projectId: null, visibilityScope: "private", createdBy: OWNER, title: "我的笔记" });
  await addChatThread({ orgId: ORG, id: S, projectId: P1, visibilityScope: "plenary", createdBy: MATE, title: "项目群聊" });
  await addChatThread({ orgId: ORG, id: OUT_T, projectId: null, visibilityScope: "private", createdBy: OUT, title: "外人" });
  owner = client(e, OWNER, ORG);
  mate = client(e, MATE, ORG);
  obs = client(e, OBS, ORG);
  out = client(e, OUT, ORG);
}, 180_000);

afterAll(async () => {
  await sql("DELETE FROM credentials WHERE user_id LIKE 'u-s10-%'");
  await e?.app.close();
});

describe("S10 分享到项目：个人结论显式提升到项目层", () => {
  it("准备：李雷在自己的个人对话里说了一条，确认后记进长期记忆", async () => {
    await addChatMessage({ orgId: ORG, id: "m-s10-own", threadId: OWN, body: `${FACT}。`, authorId: OWNER });
    const { model } = loopbackModel([[FACT, factReply(FACT)]]);
    const deps = extractionDeps(e.db, model, ORG);
    for (let i = 0; i < 20; i += 1) if ((await runExtractionTick(deps)).processed === 0) break;
    await projectGraph(e);
    const k = await owner.get<ThreadKnowledgeBody>(`/knowledge-graph/threads/${OWN}`);
    const c = k.body.claims.find((x) => x.statement === FACT);
    expect(c, JSON.stringify(k.body)).toBeDefined();
    ids.source = c!.id;
    const promoted = await owner.post<{ results: Array<{ personalClaimId?: string }> }>(`/knowledge-graph/threads/${OWN}/promote`, { claimIds: [c!.id] });
    expect(promoted.status, JSON.stringify(promoted.body)).toBe(200);
    ids.personal = promoted.body.results[0]!.personalClaimId!;
    expect(ids.personal).toEqual(expect.any(String));
  }, 120_000);

  it("范围预览：只列李雷是成员、不是观察者、未归档的项目；列出项目里谁会看到（含观察者）", async () => {
    const r = await owner.get<{ statement: string; targets: Array<{ projectId: string; audience: Array<{ userId: string; displayName: string }>; audienceCount: number; sharedClaimId: string | null }> }>(targetsPath(ids.personal));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(KG.knowledgeGraph.listProjectShareTargets.out.safeParse(r.body).success).toBe(true);
    expect(r.body.statement).toBe(FACT);
    expect(r.body.targets.map((t) => t.projectId)).toEqual([P1]);
    const [t] = r.body.targets;
    expect(t!.audienceCount).toBe(3);
    expect(t!.audience.map((m) => m.displayName).sort()).toEqual(["李雷", "王观察", "韩梅梅"].sort());
    expect(t!.audience.map((m) => m.userId)).not.toContain(OUT);
    expect(t!.sharedClaimId).toBeNull();
  });

  it("别人碰李雷的个人结论：看目标 / 分享 / 撤回一律 404，与「不存在」逐字相同（项目同事、项目外的人都一样）", async () => {
    for (const [who, api] of [["同项目的韩梅梅", mate], ["项目外的人", out]] as const) {
      expectSame(`${who}看目标`, await api.get(targetsPath(ids.personal)), await api.get(targetsPath("clm-no-such")), 404, "KG_CLAIM_NOT_FOUND");
      expectSame(`${who}分享`, await api.post(sharePath(ids.personal), { projectId: P1 }), await api.post(sharePath("clm-no-such"), { projectId: P1 }), 404, "KG_CLAIM_NOT_FOUND");
      expectSame(`${who}撤回`, await api.post(unsharePath(ids.personal), { projectId: P1 }), await api.post(unsharePath("clm-no-such"), { projectId: P1 }), 404, "KG_CLAIM_NOT_FOUND");
    }
    // 对话里的原结论（L0）不是个人空间的：同样走不通
    expect((await owner.get(targetsPath(ids.source))).status).toBe(404);
    expect(await sql("SELECT 1 FROM claims WHERE org_id = $1 AND scope_kind = 'project'", [ORG])).toEqual([]);
  });

  it("只能分享到自己是成员的项目：不是成员 ⇒ 404（与不存在的项目相同）；观察者、已归档 ⇒ 403", async () => {
    expectSame("不是成员的项目", await owner.post(sharePath(ids.personal), { projectId: P2 }),
      await owner.post(sharePath(ids.personal), { projectId: `${ORG}-no-such` }), 404, "KG_PROJECT_NOT_FOUND");
    const observer = await owner.post<{ reasonCode: string }>(sharePath(ids.personal), { projectId: P3 });
    expect([observer.status, observer.body.reasonCode]).toEqual([403, "KG_PROJECT_READ_ONLY"]);
    const archived = await owner.post<{ reasonCode: string }>(sharePath(ids.personal), { projectId: P4 });
    expect([archived.status, archived.body.reasonCode]).toEqual([403, "KG_PROJECT_READ_ONLY"]);
    expect(await sql("SELECT 1 FROM claims WHERE org_id = $1 AND scope_kind = 'project'", [ORG])).toEqual([]);
  });

  it("主人确认分享：项目里多一份派生副本（derived_from 连回、证据跟过去、作者留名），个人原件一字不动；再点一次幂等", async () => {
    const before = await sql("SELECT status, revoked_at, updated_at, scope_kind, scope_id, statement FROM claims WHERE id = $1", [ids.personal]);
    const r = await owner.post<{ projectClaimId: string; outcome: string }>(sharePath(ids.personal), { projectId: P1 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.outcome).toBe("shared");
    ids.copy = r.body.projectClaimId;
    expect(await sql("SELECT statement, scope_kind, scope_id, status, created_by, reviewed_by FROM claims WHERE id = $1", [ids.copy])).toEqual([
      { statement: FACT, scope_kind: "project", scope_id: P1, status: "accepted", created_by: "human", reviewed_by: OWNER },
    ]);
    expect(await sql("SELECT 1 FROM ontology_edges WHERE src_id = $1 AND dst_id = $2 AND relation = 'derived_from' AND status = 'active'", [ids.copy, ids.personal])).toHaveLength(1);
    expect(await sql("SELECT message_id FROM claim_message_evidence WHERE claim_id = $1", [ids.copy])).toEqual([{ message_id: "m-s10-own" }]);
    expect(await sql("SELECT action_type, actor_id, scope_kind, scope_id FROM ontology_actions WHERE payload->'claims'->1->>'id' = $1", [ids.copy]))
      .toEqual([{ action_type: "shareToProject", actor_id: OWNER, scope_kind: "project", scope_id: P1 }]);
    expect(await sql("SELECT status, revoked_at, updated_at, scope_kind, scope_id, statement FROM claims WHERE id = $1", [ids.personal])).toEqual(before);

    const again = await owner.post<{ projectClaimId: string; outcome: string }>(sharePath(ids.personal), { projectId: P1 });
    expect(again.body).toEqual({ projectClaimId: ids.copy, outcome: "already_shared" });
    const t = await owner.get<{ targets: Array<{ sharedClaimId: string | null }> }>(targetsPath(ids.personal));
    expect(t.body.targets[0]!.sharedClaimId).toBe(ids.copy);
  });

  it("全体项目成员（含观察者）在项目大脑里看到它、标出处；项目外的人什么都看不到", async () => {
    for (const api of [mate, obs, owner]) {
      const r = await api.get<{ claims: Array<{ id: string; statement: string }>; sharedFromPersonal: unknown }>(`/knowledge-graph/projects/${P1}`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(KG.knowledgeGraph.getProjectKnowledge.out.safeParse(r.body).success).toBe(true);
      expect(r.body.claims.map((c) => [c.id, c.statement])).toEqual([[ids.copy, FACT]]);
      expect(r.body.sharedFromPersonal).toEqual([{ claimId: ids.copy, sharedByName: "李雷" }]);
    }
    // 审查 F2：出处函数只回答项目成员——项目外的人直接调也拿不到分享人
    const authorAs = (userId: string) => asOwner(async (c) => {
      await c.query("SELECT set_config('app.current_org', $1, false), set_config('app.current_user_id', $2, false)", [ORG, userId]);
      return (await c.query<{ n: string | null }>("SELECT kg_share_author_name($1) AS n", [ids.copy])).rows[0]!.n;
    });
    expect(await authorAs(MATE)).toBe("李雷");
    expect(await authorAs(OUT)).toBeNull();
    const denied = await out.get(`/knowledge-graph/projects/${P1}`);
    expect(denied.status).toBe(403);
    expect(JSON.stringify(denied.body)).not.toContain(FACT);
    expect((await out.get(sourcesPath(ids.copy))).status).toBe(404);
    const outside = await e.recall.candidates(toOrgId(ORG), OUT, OUT_T);
    expect(outside.claims.map((c) => c.statement)).not.toContain(FACT);
    // 同事打开项目副本的来源：证据只在李雷的个人对话里，同事一个也看不到 ⇒ 与不存在同一个出口（R9 口径），原话不漏出来
    const src = await mate.get(sourcesPath(ids.copy));
    expectSame("同事打开分享来的那条的来源", src, await mate.get(sourcesPath("clm-no-such")), 404, "KG_CLAIM_NOT_FOUND");
    expect(JSON.stringify(src.body)).not.toContain(FACT);
  });

  it("召回：项目会话里同事提问用得上它，模型材料和回答引用都标「由 李雷 分享自个人记忆」；观察者读这一轮同样看得到", async () => {
    const t = await turn(e, mate, ORG, S, ASK, AGENT);
    expect(t.memory).toContain(`- [你确认过] ${LABEL}`);
    for (const api of [mate, obs]) {
      const m = await api.get<{ recalled: Array<{ claimId: string; scope: string; sharedByName?: string | null }> }>(memoryPath(S, t.answerId));
      expect(m.status).toBe(200);
      expect(KG.knowledgeGraph.getTurnMemory.out.safeParse(m.body).success).toBe(true);
      expect(m.body.recalled.map((x) => [x.claimId, x.scope, x.sharedByName])).toEqual([[ids.copy, "project", "李雷"]]);
    }
  }, 120_000);

  it("分享人自己在项目会话里提问：同一句话只出现一次（项目那份），不和个人原件重复", async () => {
    const t = await turn(e, owner, ORG, S, ASK, AGENT);
    expect(t.memory!.split(FACT)).toHaveLength(2);
    expect(t.memory).toContain(LABEL);
  }, 120_000);

  it("撤回：项目副本失效（F07 级联收掉它的边），个人原件不动；同事再也看不到、召回不到；再撤 ⇒ 404", async () => {
    const before = await sql("SELECT status, revoked_at, updated_at FROM claims WHERE id = $1", [ids.personal]);
    const r = await owner.post<{ projectClaimId: string }>(unsharePath(ids.personal), { projectId: P1 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toEqual({ projectClaimId: ids.copy });
    expect(await sql("SELECT status, revocation_reason, revoked_at IS NOT NULL AS gone FROM claims WHERE id = $1", [ids.copy]))
      .toEqual([{ status: "superseded", revocation_reason: "user_revoked", gone: true }]);
    expect(await sql("SELECT status FROM ontology_edges WHERE src_id = $1 AND dst_id = $2 AND relation = 'derived_from'", [ids.copy, ids.personal]))
      .toEqual([{ status: "invalidated" }]);
    expect(await sql("SELECT status, revoked_at, updated_at FROM claims WHERE id = $1", [ids.personal])).toEqual(before);

    const brain = await mate.get<{ claims: unknown[]; sharedFromPersonal: unknown[] }>(`/knowledge-graph/projects/${P1}`);
    expect([brain.body.claims, brain.body.sharedFromPersonal]).toEqual([[], []]);
    const c = await e.recall.candidates(toOrgId(ORG), MATE, S);
    expect(c.claims.map((x) => x.statement)).not.toContain(FACT);
    const t = await owner.get<{ targets: Array<{ sharedClaimId: string | null }> }>(targetsPath(ids.personal));
    expect(t.body.targets[0]!.sharedClaimId).toBeNull();
    const again = await owner.post<{ reasonCode: string }>(unsharePath(ids.personal), { projectId: P1 });
    expect([again.status, again.body.reasonCode]).toEqual([404, "KG_CLAIM_NOT_FOUND"]);
    // 个人原件仍在本人的长期记忆里
    const mine = await owner.get<{ claims: Array<{ id: string }> }>("/knowledge-graph/personal");
    expect(mine.body.claims.map((x) => x.id)).toContain(ids.personal);
  });

  // 跨轮次交互（S4 #4361 忘掉 / 撤销卡、S8 #4491 整合 / 整合撤销、S6 #4492 时间继承）：那些分支还没合入 main，这里按它们的
  // 落库形状直接改行来模拟（原因码是普通文本）。S6 的 kg_copy_inherits_time 会往副本上抄 valid_to / due_at / todo_status，
  // 所以本文件不对副本的这几列做「必须为空」的断言。TODO(#4491 / S4 claude/s4-memory-manage)：合入后改走真函数再跑一遍。
  const liveCopy = async (id: string) => (await sql<{ live: boolean; reason: string | null }>(
    "SELECT (revoked_at IS NULL AND status <> 'superseded') AS live, revocation_reason AS reason FROM claims WHERE id = $1", [id]))[0];
  const derivedTo = (id: string) => sql<{ dst_id: string }>(
    "SELECT dst_id FROM ontology_edges WHERE src_id = $1 AND relation = 'derived_from' AND status = 'active' ORDER BY dst_id", [id]);
  /** 模拟一次撤销（S4 kg_undo_memory_card / S8 kg_consolidation_undo）：原件恢复成活的，它自己连出去的边也回来。 */
  const undoRevoke = async (id: string) => {
    await sql("UPDATE ontology_edges SET status = 'active', invalidated_at = NULL WHERE src_id = $1 AND status = 'invalidated'", [id]);
    await sql("UPDATE claims SET status = 'accepted', revoked_at = NULL, revocation_reason = NULL, updated_at = now() WHERE id = $1", [id]);
  };
  const revokeAs = (id: string, reason: string) =>
    sql("UPDATE claims SET status = 'superseded', revoked_at = now(), revocation_reason = $2, updated_at = now() WHERE id = $1", [id, reason]);

  it("整合（S8 'consolidated_duplicate'）：副本不失效，derived_from 改挂到留下的那条，出处照旧；留下的那条再被忘掉 ⇒ 副本失效", async () => {
    const r = await owner.post<{ projectClaimId: string; outcome: string }>(sharePath(ids.personal), { projectId: P1 });
    expect(r.body.outcome).toBe("shared");
    const copyA = r.body.projectClaimId;
    const KEPT = "clm-s10-kept";
    await sql(`INSERT INTO claims (id, org_id, statement, status, tsv, claim_kind, confidence, created_by, reviewed_by,
                                   scope_kind, scope_id, valid_from, supersedes_claim_id)
               VALUES ($1, $2, $3, 'accepted', to_tsvector('simple', $3), 'fact', 1, 'human', $4, 'personal', $4, now(), $5)`,
      [KEPT, ORG, FACT, OWNER, ids.personal]);
    await revokeAs(ids.personal, "consolidated_duplicate");
    expect(await liveCopy(copyA)).toEqual({ live: true, reason: null });
    expect(await derivedTo(copyA)).toEqual([{ dst_id: KEPT }]);
    const brain = await mate.get<{ claims: Array<{ id: string }>; sharedFromPersonal: unknown }>(`/knowledge-graph/projects/${P1}`);
    expect(brain.body.claims.map((c) => c.id)).toEqual([copyA]);
    expect(brain.body.sharedFromPersonal).toEqual([{ claimId: copyA, sharedByName: "李雷" }]);
    // 整合被撤销（败者回来）：这份副本本来就没被撤，没有要恢复的，仍挂在留下的那条上
    await undoRevoke(ids.personal);
    expect(await liveCopy(copyA)).toEqual({ live: true, reason: null });
    expect(await derivedTo(copyA)).toEqual([{ dst_id: KEPT }]);
    // 败者之后再被忘掉：已改挂的副本不跟着它走
    await revokeAs(ids.personal, "user_forgot");
    expect((await liveCopy(copyA))!.live).toBe(true);
    await undoRevoke(ids.personal);
    // 留下的那条被忘掉 ⇒ 挂在它下面的副本一并失效（收尾，后面的用例从干净的项目记忆开始）
    await revokeAs(KEPT, "user_forgot");
    expect(await liveCopy(copyA)).toEqual({ live: false, reason: "personal_source_revoked" });
  });

  it("整合带 S8 的 kg.consolidation_keep 标记（说法不同）：副本改挂到标记指向的那条", async () => {
    const r = await owner.post<{ projectClaimId: string; outcome: string }>(sharePath(ids.personal), { projectId: P1 });
    expect(r.body.outcome).toBe("shared");
    const copyC = r.body.projectClaimId;
    const KEPT2 = "clm-s10-kept-2";
    const OTHER_TEXT = "交付确定性是客户 A 最在意的一点";
    await sql(`INSERT INTO claims (id, org_id, statement, status, tsv, claim_kind, confidence, created_by, reviewed_by,
                                   scope_kind, scope_id, valid_from)
               VALUES ($1, $2, $3, 'accepted', to_tsvector('simple', $3), 'fact', 1, 'human', $4, 'personal', $4, now())`,
      [KEPT2, ORG, OTHER_TEXT, OWNER]);
    // 与 S8 kg_consolidation_apply_merges 同一形状：同一事务里先设标记，再失效败者
    await asOwner(async (c) => {
      await c.query("BEGIN");
      await c.query("SELECT set_config('kg.consolidation_keep', $1, true)", [KEPT2]);
      await c.query("UPDATE claims SET status = 'superseded', revoked_at = now(), revocation_reason = 'consolidated_duplicate', updated_at = now() WHERE id = $1", [ids.personal]);
      await c.query("COMMIT");
    });
    expect(await liveCopy(copyC)).toEqual({ live: true, reason: null });
    expect(await derivedTo(copyC)).toEqual([{ dst_id: KEPT2 }]);
    // 收尾：败者回来；留下的那条被忘掉 ⇒ 挂在它下面的副本失效
    await undoRevoke(ids.personal);
    await revokeAs(KEPT2, "user_forgot");
    expect(await liveCopy(copyC)).toEqual({ live: false, reason: "personal_source_revoked" });
  });

  it("忘掉（S4 'user_forgot'）⇒ 副本失效；撤销忘掉 ⇒ 副本恢复（边也回来、出处照旧）；主人自己撤回的那份不恢复", async () => {
    const r = await owner.post<{ projectClaimId: string; outcome: string }>(sharePath(ids.personal), { projectId: P1 });
    expect(r.body.outcome).toBe("shared");
    const copyB = r.body.projectClaimId;
    await revokeAs(ids.personal, "user_forgot");
    expect(await liveCopy(copyB)).toEqual({ live: false, reason: "personal_source_revoked" });
    expect(await derivedTo(copyB)).toEqual([]);
    expect((await mate.get<{ claims: unknown[] }>(`/knowledge-graph/projects/${P1}`)).body.claims).toEqual([]);

    await undoRevoke(ids.personal);
    expect(await liveCopy(copyB)).toEqual({ live: true, reason: null });
    expect(await derivedTo(copyB)).toEqual([{ dst_id: ids.personal }]);
    const brain = await mate.get<{ claims: Array<{ id: string }>; sharedFromPersonal: unknown }>(`/knowledge-graph/projects/${P1}`);
    expect(brain.body.claims.map((c) => c.id)).toEqual([copyB]);
    expect(brain.body.sharedFromPersonal).toEqual([{ claimId: copyB, sharedByName: "李雷" }]);
    // 主人自己「撤回分享」的那份（user_revoked）不会被撤销忘掉带回来
    expect(await liveCopy(ids.copy)).toEqual({ live: false, reason: "user_revoked" });
    const t = await owner.get<{ targets: Array<{ sharedClaimId: string | null }> }>(targetsPath(ids.personal));
    expect(t.body.targets[0]!.sharedClaimId).toBe(copyB);
  });

  it("原件被忘掉（原结论在出处对话里被撤掉 ⇒ F07 级联到长期记忆）⇒ 分享出去的项目副本一并失效", async () => {
    // 上一条用例恢复出来的那份还活着 ⇒ 这里是 already_shared，交回的就是它
    const r = await owner.post<{ projectClaimId: string; outcome: string }>(sharePath(ids.personal), { projectId: P1 });
    expect(["shared", "already_shared"]).toContain(r.body.outcome);
    const copy2 = r.body.projectClaimId;
    expect(copy2).not.toBe(ids.copy);
    const k = await owner.get<ThreadKnowledgeBody>(`/knowledge-graph/threads/${OWN}`);
    const revoke = await owner.post(`/knowledge-graph/threads/${OWN}/actions`, {
      basedOnRevision: k.body.revision, action: { type: "revokeClaim", claimId: ids.source, reason: "说错了" },
    });
    expect(revoke.status, JSON.stringify(revoke.body)).toBe(200);
    expect(await sql("SELECT id, revoked_at IS NOT NULL AS gone FROM claims WHERE id = ANY($1::text[]) ORDER BY id", [[ids.personal, copy2]]))
      .toEqual([{ id: ids.personal, gone: true }, { id: copy2, gone: true }].sort((x, y) => x.id.localeCompare(y.id)));
    const brain = await mate.get<{ claims: unknown[] }>(`/knowledge-graph/projects/${P1}`);
    expect(brain.body.claims).toEqual([]);
  });
});
