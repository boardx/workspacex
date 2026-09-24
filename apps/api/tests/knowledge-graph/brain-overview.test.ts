/**
 * 大脑页（/brain）的两个读，真实数据库：个人空间（UC-KG-7 getPersonalKnowledge）与会话记忆概况
 * （getBrainOverview）。2026-09-24 人类指令「取消所有的 mockup 的数据」——页面上的每个数字都来自这里。
 *
 * 知识由 F06 抽取流水线真实产生（回环模型），个人空间由 F11 promoteToPersonal 真实写入。
 * 覆盖：计数与会话知识面板一致、个人结论能找回来源会话、别人的个人空间 / 会话一条不漏、
 * 被移出项目后那个会话不再出现、跨组织为空、不是组织成员 ⇒ 404、响应形状过契约。
 */
import { NotFoundException } from "@nestjs/common";
import { knowledgeGraph as KG } from "@repo/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runExtractionTick } from "../../src/application/knowledge-graph/extract-message-knowledge";
import { newKgId } from "../../src/application/knowledge-graph/ids";
import { promoteToPersonal, type PromotionDeps } from "../../src/application/knowledge-graph/promote-to-personal";
import { getBrainOverview, getPersonalKnowledge } from "../../src/application/knowledge-graph/read-personal-knowledge";
import { getThreadKnowledge } from "../../src/application/knowledge-graph/read-thread-knowledge";
import { toOrgId } from "../../src/domain/org-id";
import { PgChatRepository } from "../../src/infrastructure/chat/pg-chat-repository";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { CountingDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgHumanAction } from "../../src/infrastructure/knowledge-graph/pg-human-action";
import { PgKnowledgeRead } from "../../src/infrastructure/knowledge-graph/pg-knowledge-read";
import { PgPromotion } from "../../src/infrastructure/knowledge-graph/pg-promotion";
import { KnowledgeGraphController } from "../../src/interface/controllers/knowledge-graph.controller";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { addOrgMember, addProjectMember, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { enableExtraction, extractionDeps, loopbackModel } from "./kg-extraction-fixtures";

const ORG = "org-kg-brain-a";
const ORG_B = "org-kg-brain-b";
const ORG_ID = toOrgId(ORG);
const ORG_B_ID = toOrgId(ORG_B);
const MINE = "thr-kg-brain-mine";
const MINE_OLD = "thr-kg-brain-mine-old";
const EMPTY = "thr-kg-brain-empty";
const SHARED = "thr-kg-brain-shared";
const THEIRS = "thr-kg-brain-theirs";
const B_MINE = "thr-kg-brain-b-mine";

let db: PgDatabase;
let deps: PromotionDeps;
let ctl: KnowledgeGraphController;
const owner = { userId: "u-owner", orgId: ORG_ID };
const other = { userId: "u-other", orgId: ORG_ID };

const claim = (statement: string, kind: string, about: string[]) =>
  ({ statement, kind, confidence: 0.8, about, decidedBy: null, quote: statement });
const REPLY = JSON.stringify({
  entities: [{ name: "v2", kind: "product", aliases: [] }, { name: "老张", kind: "person", aliases: [] }],
  claims: [
    claim("v2 下周一上线", "decision", ["v2"]),
    claim("老张负责测试", "fact", ["老张"]),
    claim("测试环境不稳定", "risk", ["v2"]),
  ],
});
const REPLY_B = JSON.stringify({
  entities: [{ name: "乙方", kind: "organization", aliases: [] }],
  claims: [claim("乙方合同已签", "fact", ["乙方"])],
});
const BODY = "v2 下周一上线。老张负责测试，测试环境不稳定。";

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG, ORG_B);
  const fx = await seedOrg({ orgId: ORG, projectId: `${ORG}-p` });
  const fxB = await seedOrg({ orgId: ORG_B, projectId: `${ORG_B}-p` });
  await enableExtraction();
  for (const u of ["u-owner", "u-other"]) {
    await addOrgMember(ORG, u, "consultant", fx.teams.energy!);
    await addProjectMember(ORG, `${ORG}-p`, u, "facilitator", null);
  }
  // 同一个人也是另一个组织的成员：跨组织读必须为空。
  await addOrgMember(ORG_B, "u-owner", "consultant", fxB.teams.energy!);
  const t0 = Date.now();
  await addChatThread({ orgId: ORG, id: MINE_OLD, projectId: null, visibilityScope: "private", createdBy: "u-owner", title: "上个月的对话", lastActivityAt: new Date(t0 - 86_400_000) });
  await addChatThread({ orgId: ORG, id: MINE, projectId: null, visibilityScope: "private", createdBy: "u-owner", title: "v2 上线安排", lastActivityAt: new Date(t0) });
  await addChatThread({ orgId: ORG, id: EMPTY, projectId: null, visibilityScope: "private", createdBy: "u-owner", title: "什么都没记下" });
  await addChatThread({ orgId: ORG, id: SHARED, projectId: `${ORG}-p`, visibilityScope: "plenary", createdBy: "u-owner", title: "项目周会", lastActivityAt: new Date(t0 - 3_600_000) });
  await addChatThread({ orgId: ORG, id: THEIRS, projectId: null, visibilityScope: "private", createdBy: "u-other", title: "别人的私事" });
  await addChatThread({ orgId: ORG_B, id: B_MINE, projectId: null, visibilityScope: "private", createdBy: "u-owner", title: "乙方" });
  db = new PgDatabase(appConfig());
  deps = {
    repo: new PgIdentityRepository(db), ids: new CountingDecisionIdFactory(), chat: new PgChatRepository(db),
    knowledge: new PgKnowledgeRead(db), promotion: new PgPromotion(db), newId: newKgId,
  };
  ctl = new KnowledgeGraphController(deps.repo, deps.ids, deps.chat, deps.knowledge, new PgHumanAction(db), deps.promotion);
  const { model } = loopbackModel([["上线", REPLY], ["乙方", REPLY_B]]);
  for (const t of [MINE, MINE_OLD, SHARED, THEIRS]) {
    await addChatMessage({ orgId: ORG, id: `m-${t}`, threadId: t, body: BODY, authorId: t === THEIRS ? "u-other" : "u-owner" });
  }
  await addChatMessage({ orgId: ORG, id: `m-${EMPTY}`, threadId: EMPTY, body: "你好", authorId: "u-owner" });
  await addChatMessage({ orgId: ORG_B, id: `m-${B_MINE}`, threadId: B_MINE, body: "乙方合同已签", authorId: "u-owner" });
  await runExtractionTick(extractionDeps(db, model, ORG));
  await runExtractionTick(extractionDeps(db, model, ORG_B));

  // 本人：从 MINE 记两条到长期记忆；别人：从 THEIRS 记一条。组织 B：记一条。
  const ids = async (viewer: { userId: string; orgId: typeof ORG_ID }, threadId: string, statements: string[]) =>
    (await getThreadKnowledge(deps, { ...viewer, threadId })).claims.filter((c) => statements.includes(c.statement)).map((c) => c.id);
  await promoteToPersonal(deps, { ...owner, threadId: MINE, claimIds: await ids(owner, MINE, ["v2 下周一上线", "老张负责测试"]) });
  await promoteToPersonal(deps, { ...other, threadId: THEIRS, claimIds: await ids(other, THEIRS, ["测试环境不稳定"]) });
  const bOwner = { userId: "u-owner", orgId: ORG_B_ID };
  await promoteToPersonal(deps, { ...bOwner, threadId: B_MINE, claimIds: await ids(bOwner, B_MINE, ["乙方合同已签"]) });
});
afterAll(async () => { await db.close(); });

describe("个人空间（长期记忆）：只有本人", () => {
  it("本人读到自己记下的结论（你确认过）、它们引用的实体，每条都指回会话里的原结论", async () => {
    const k = await getPersonalKnowledge(deps, owner);
    expect(k.scope).toEqual({ kind: "personal", id: "u-owner" });
    expect(k.claims.map((c) => c.statement).sort()).toEqual(["v2 下周一上线", "老张负责测试"].sort());
    for (const c of k.claims) {
      expect(c.scope).toEqual({ kind: "personal", id: "u-owner" });
      expect(c.triState).toBe("confirmed");
      expect(c.derivedFromClaimId).not.toBeNull();
    }
    expect(k.claims.find((c) => c.statement === "v2 下周一上线")?.kind).toBe("decision");
    expect(k.objects.map((o) => o.name).sort()).toEqual(["v2", "老张"].sort());
    expect(k.revision).toBeGreaterThan(0);
  });

  it("别人读不到我的一条：各自只看见自己的", async () => {
    const mine = await getPersonalKnowledge(deps, owner);
    const theirs = await getPersonalKnowledge(deps, other);
    expect(theirs.claims.map((c) => c.statement)).toEqual(["测试环境不稳定"]);
    const mineIds = new Set([...mine.claims.map((c) => c.id), ...mine.objects.map((o) => o.id)]);
    expect([...theirs.claims.map((c) => c.id), ...theirs.objects.map((o) => o.id)].some((id) => mineIds.has(id))).toBe(false);
    expect(theirs.claims.map((c) => c.statement)).not.toContain("老张负责测试");
  });

  it("跨组织：同一个人在组织 B 只看到组织 B 的，组织 A 的一条不带过去", async () => {
    const b = await getPersonalKnowledge(deps, { userId: "u-owner", orgId: ORG_B_ID });
    expect(b.claims.map((c) => c.statement)).toEqual(["乙方合同已签"]);
    const a = await getPersonalKnowledge(deps, owner);
    expect(a.claims.map((c) => c.statement)).not.toContain("乙方合同已签");
  });

  it("不是这个组织的成员 ⇒ 与不存在同一个出口（HTTP 404）", async () => {
    await expect(getPersonalKnowledge(deps, { userId: "u-stranger", orgId: ORG_ID })).rejects.toMatchObject({ code: "KG_THREAD_NOT_FOUND" });
    await expect(ctl.personalKnowledge({ userId: "u-stranger", orgId: ORG } as never)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("HTTP 出口的形状过契约 out", async () => {
    const out = await ctl.personalKnowledge({ userId: "u-owner", orgId: ORG } as never);
    expect(() => KG.knowledgeGraph.getPersonalKnowledge.out.parse(out)).not.toThrow();
  });
});

describe("会话记忆概况", () => {
  it("列出本人记下了东西的会话，最近活动在前；计数与会话知识面板读到的一致；什么都没记下的会话不出现", async () => {
    const o = await getBrainOverview(deps, owner);
    expect(o.threads.map((t) => t.threadId)).toEqual([MINE, SHARED, MINE_OLD]);
    for (const t of o.threads) {
      const k = await getThreadKnowledge(deps, { ...owner, threadId: t.threadId });
      const tri = (s: string) => k.claims.filter((c) => c.triState === s).length;
      expect(t).toMatchObject({
        claims: k.claims.length, pending: tri("pending"), confirmed: tri("confirmed"), conflict: tri("conflict"),
        objects: k.objects.filter((x) => x.claimCount > 0).length,
      });
    }
    const mine = o.threads.find((t) => t.threadId === MINE)!;
    expect(mine).toMatchObject({ title: "v2 上线安排", projectId: null, claims: 3, confirmed: 2, pending: 1, conflict: 0 });
    expect(o.threads.find((t) => t.threadId === SHARED)).toMatchObject({ title: "项目周会", projectId: `${ORG}-p` });
    expect(o.threads.map((t) => t.threadId)).not.toContain(EMPTY);
  });

  it("个人空间的每条结论都找得回来源会话（标题 + 会话里的原结论）", async () => {
    const o = await getBrainOverview(deps, owner);
    const k = await getPersonalKnowledge(deps, owner);
    expect(o.personalOrigins).toHaveLength(k.claims.length);
    for (const c of k.claims) {
      const origin = o.personalOrigins.find((x) => x.personalClaimId === c.id);
      expect(origin).toEqual({
        personalClaimId: c.id, sourceClaimId: c.derivedFromClaimId, threadId: MINE, projectId: null, threadTitle: "v2 上线安排",
      });
    }
  });

  it("别人：只看到自己的会话，我的会话、标题、来源一条都没有", async () => {
    const o = await getBrainOverview(deps, other);
    expect(o.threads.map((t) => t.threadId)).toEqual([THEIRS]);
    expect(o.personalOrigins.map((x) => x.threadId)).toEqual([THEIRS]);
    const text = JSON.stringify(o);
    for (const leak of [MINE, SHARED, MINE_OLD, "v2 上线安排", "项目周会"]) expect(text).not.toContain(leak);
  });

  it("跨组织：组织 B 里只有组织 B 的会话", async () => {
    const b = await getBrainOverview(deps, { userId: "u-owner", orgId: ORG_B_ID });
    expect(b.threads.map((t) => t.threadId)).toEqual([B_MINE]);
    expect(b.personalOrigins.map((x) => x.threadId)).toEqual([B_MINE]);
    const a = await getBrainOverview(deps, owner);
    expect(JSON.stringify(a)).not.toContain(B_MINE);
  });

  it("被移出项目后，那个项目会话从概况里消失（与打开会话同一个可见性判定）", async () => {
    await asOwner((c) => c.query("DELETE FROM project_memberships WHERE org_id = $1 AND project_id = $2 AND user_id = 'u-owner'", [ORG, `${ORG}-p`]));
    try {
      const o = await getBrainOverview(deps, owner);
      expect(o.threads.map((t) => t.threadId)).toEqual([MINE, MINE_OLD]);
    } finally {
      await addProjectMember(ORG, `${ORG}-p`, "u-owner", "facilitator", null);
    }
  });

  it("不是这个组织的成员 ⇒ 什么都没有", async () => {
    const o = await getBrainOverview(deps, { userId: "u-stranger", orgId: ORG_ID });
    expect(o).toEqual({ threads: [], personalOrigins: [] });
  });

  it("HTTP 出口的形状过契约 out", async () => {
    const out = await ctl.brainOverview({ userId: "u-owner", orgId: ORG } as never);
    expect(() => KG.knowledgeGraph.getBrainOverview.out.parse(out)).not.toThrow();
  });
});
