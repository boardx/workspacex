/**
 * Phase 18 F10 —— 人工编辑动作（uc-18-3 R3-3 / R3-4 / R4 E1–E3 / R5），真实数据库。
 *
 * 知识由 F06 抽取流水线真实产生；每个动作经 applyHumanAction → kg_apply_human_action 落表，
 * 读回用 F09 的读接口（用户在面板上看到的就是它），并核对 AGE 投影仍与 canonical 一致。
 */
import { ConflictException, ForbiddenException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyHumanAction, type HumanActionDeps } from "../../src/application/knowledge-graph/apply-human-action";
import { newKgId } from "../../src/application/knowledge-graph/ids";
import { runExtractionTick } from "../../src/application/knowledge-graph/extract-message-knowledge";
import { projectPendingGraph } from "../../src/application/knowledge-graph/project-pending-graph";
import { getThreadKnowledge } from "../../src/application/knowledge-graph/read-thread-knowledge";
import { toOrgId } from "../../src/domain/org-id";
import { PgChatRepository } from "../../src/infrastructure/chat/pg-chat-repository";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { CountingDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { graphParity } from "../../src/infrastructure/knowledge-graph/kg-graph-rebuild";
import { PgGraphProjection } from "../../src/infrastructure/knowledge-graph/pg-graph-projection";
import { PgHumanAction } from "../../src/infrastructure/knowledge-graph/pg-human-action";
import { PgKnowledgeRead } from "../../src/infrastructure/knowledge-graph/pg-knowledge-read";
import { KnowledgeGraphController } from "../../src/interface/controllers/knowledge-graph.controller";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { addOrgMember, addProjectMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { enableExtraction, extractionDeps, loopbackModel, silentLogger } from "./kg-extraction-fixtures";

const ORG = "org-kg-f10-actions";
const ORG_ID = toOrgId(ORG);
const MINE = "thr-kg-f10-mine";
const SHARED = "thr-kg-f10-shared";
let db: PgDatabase;
let deps: HumanActionDeps;
const owner = { userId: "u-owner", orgId: ORG_ID };

const FOUR = JSON.stringify({
  entities: [
    { name: "张三", kind: "person", aliases: [] }, { name: "老张", kind: "person", aliases: [] },
    { name: "v2", kind: "product", aliases: [] },
  ],
  claims: [
    { statement: "v2 下周一上线", kind: "decision", confidence: 0.9, about: ["v2"], decidedBy: "张三", quote: "v2 下周一上线" },
    { statement: "v2 下周三上线", kind: "decision", confidence: 0.6, about: ["v2"], decidedBy: null, quote: "v2 下周三上线" },
    { statement: "老张负责测试", kind: "fact", confidence: 0.8, about: ["老张"], decidedBy: null, quote: "老张负责测试" },
    { statement: "测试环境不稳定", kind: "risk", confidence: 0.7, about: ["v2"], decidedBy: null, quote: "测试环境不稳定" },
  ],
});

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: `${ORG}-p` });
  await enableExtraction();
  for (const u of ["u-owner", "u-member"]) {
    await addOrgMember(ORG, u, "consultant", fx.teams.energy!);
    await addProjectMember(ORG, `${ORG}-p`, u, "facilitator", null);
  }
  await addChatThread({ orgId: ORG, id: MINE, projectId: null, visibilityScope: "private", createdBy: "u-owner" });
  await addChatThread({ orgId: ORG, id: SHARED, projectId: `${ORG}-p`, visibilityScope: "plenary", createdBy: "u-owner" });
  db = new PgDatabase(appConfig());
  deps = {
    repo: new PgIdentityRepository(db), ids: new CountingDecisionIdFactory(), chat: new PgChatRepository(db),
    knowledge: new PgKnowledgeRead(db), actions: new PgHumanAction(db), newId: newKgId,
  };
  const { model } = loopbackModel([["上线", FOUR]]);
  for (const t of [MINE, SHARED]) {
    await addChatMessage({ orgId: ORG, id: `m-${t}`, threadId: t, body: "v2 下周一上线；也有人说 v2 下周三上线。老张负责测试，测试环境不稳定。", authorId: "u-owner" });
  }
  await runExtractionTick(extractionDeps(db, model, ORG));
});
afterAll(async () => { await db.close(); });

const read = (threadId = MINE, userId = "u-owner") => getThreadKnowledge(deps, { userId, orgId: ORG_ID, threadId });
const act = async (action: Parameters<typeof applyHumanAction>[1]["action"], threadId = MINE, userId = "u-owner") => {
  const k = await read(threadId, "u-owner");
  return applyHumanAction(deps, { userId, orgId: ORG_ID, threadId, basedOnRevision: k.revision, action });
};
const claimBy = async (statement: string, threadId = MINE) => (await read(threadId)).claims.find((c) => c.statement === statement)!;
const objectBy = async (name: string) => (await read()).objects.find((o) => o.name === name)!;

describe("F10: 结论动作", () => {
  it("确认：AI 记下的 → 你确认过，reviewedBy 为本人，版本号 +1", async () => {
    const before = await read();
    const c = await claimBy("老张负责测试");
    const out = await act({ type: "confirmClaim", claimId: c.id });
    expect(out.revision).toBe(before.revision + 1);
    expect(await claimBy("老张负责测试")).toMatchObject({ status: "accepted", triState: "confirmed", reviewedBy: "u-owner" });
  });

  it("并发：拿旧版本号提交 ⇒ KG_REVISION_CHANGED（E1），HTTP 409", async () => {
    const k = await read();
    const c = await claimBy("测试环境不稳定");
    await expect(applyHumanAction(deps, { ...owner, threadId: MINE, basedOnRevision: k.revision - 1, action: { type: "confirmClaim", claimId: c.id } }))
      .rejects.toMatchObject({ code: "KG_REVISION_CHANGED" });
    const ctl = new KnowledgeGraphController(deps.repo, deps.ids, deps.chat, deps.knowledge, deps.actions, {} as never);
    await expect(ctl.humanAction({ userId: "u-owner", orgId: ORG } as never, MINE, { basedOnRevision: k.revision - 1, action: { type: "confirmClaim", claimId: c.id } }))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it("标冲突 → 两条都是「有矛盾」；对冲突态点确认 ⇒ KG_CONTESTED_NEEDS_RESOLUTION（E3），「全部确认」整批拒绝", async () => {
    const a = await claimBy("v2 下周一上线");
    const b = await claimBy("v2 下周三上线");
    await act({ type: "markContested", claimIds: [a.id, b.id] });
    expect((await claimBy("v2 下周一上线")).triState).toBe("conflict");
    await expect(act({ type: "confirmClaim", claimId: a.id })).rejects.toMatchObject({ code: "KG_CONTESTED_NEEDS_RESOLUTION" });
    const risk = await claimBy("测试环境不稳定");
    await expect(act({ type: "confirmClaims", claimIds: [risk.id, b.id] })).rejects.toMatchObject({ code: "KG_CONTESTED_NEEDS_RESOLUTION" });
    expect((await claimBy("测试环境不稳定")).status).toBe("proposed");  // 整批没动
  });

  it("全部确认（U-2 批量）", async () => {
    const risk = await claimBy("测试环境不稳定");
    await act({ type: "confirmClaims", claimIds: [risk.id] });
    expect((await claimBy("测试环境不稳定")).triState).toBe("confirmed");
  });

  it("改写：新结论（你确认过）取代旧的，证据与关联原样保留", async () => {
    const old = await claimBy("v2 下周三上线");
    await act({ type: "reviseClaim", claimId: old.id, statement: "v2 推迟到下周三上线（客户要求）" });
    const k = await read();
    expect(k.claims.some((c) => c.id === old.id)).toBe(false);
    const revised = k.claims.find((c) => c.statement.startsWith("v2 推迟"))!;
    expect(revised).toMatchObject({ status: "accepted", createdBy: "human", supersedesClaimId: old.id, supportingCount: 1 });
    expect(revised.aboutObjectIds).toEqual(old.aboutObjectIds);
  });

  it("忘掉：列表里消失，但数据库行与审计都在（revoked_at + 原因）", async () => {
    const c = await claimBy("v2 下周一上线");
    const out = await act({ type: "revokeClaim", claimId: c.id, reason: "说错了" });
    expect((await read()).claims.some((x) => x.id === c.id)).toBe(false);
    const row = await asOwner((q) => q.query("SELECT status, revoked_at IS NOT NULL AS revoked, revocation_reason FROM claims WHERE id = $1", [c.id]));
    expect(row.rows[0]).toEqual({ status: "superseded", revoked: true, revocation_reason: "说错了" });
    const audit = await asOwner((q) => q.query("SELECT actor_kind, actor_id, action_type FROM ontology_actions WHERE id = $1", [out.actionId]));
    expect(audit.rows[0]).toEqual({ actor_kind: "human", actor_id: "u-owner", action_type: "revokeClaim" });
  });
});

describe("F10: 实体动作", () => {
  it("改名：旧名进别名", async () => {
    const v2 = await objectBy("v2");
    await act({ type: "renameObject", objectId: v2.id, name: "产品 v2" });
    expect(await objectBy("产品 v2")).toMatchObject({ id: v2.id, aliases: ["v2"] });
  });

  it("合并：「老张」并入「张三」，关联改指保留方，名字进别名", async () => {
    const keep = await objectBy("张三");
    const merge = await objectBy("老张");
    await act({ type: "mergeObjects", keepObjectId: keep.id, mergeObjectId: merge.id });
    const k = await read();
    expect(k.objects.some((o) => o.id === merge.id)).toBe(false);
    const kept = k.objects.find((o) => o.id === keep.id)!;
    expect(kept.aliases).toContain("老张");
    expect((await claimBy("老张负责测试")).aboutObjectIds).toEqual([keep.id]);
  });

  it("拆分：选中的结论改挂到新实体", async () => {
    const v2 = await objectBy("产品 v2");
    const risk = await claimBy("测试环境不稳定");
    await act({ type: "splitObject", objectId: v2.id, newName: "测试环境", moveClaimIds: [risk.id] });
    const env = await objectBy("测试环境");
    expect((await claimBy("测试环境不稳定")).aboutObjectIds).toEqual([env.id]);
  });
});

describe("F10: 权限与作用域", () => {
  it("非所有者（看得见共享会话的成员）⇒ KG_NOT_OWNER（应用层 + 数据库层），HTTP 403", async () => {
    const c = await claimBy("老张负责测试", SHARED);
    await expect(act({ type: "confirmClaim", claimId: c.id }, SHARED, "u-member")).rejects.toMatchObject({ code: "KG_NOT_OWNER" });
    const k = await read(SHARED);
    await expect(asApp(ORG, async (q) => {
      await q.query("SELECT set_config('app.current_user_id', 'u-member', true)");
      return q.query("SELECT kg_apply_human_action($1::jsonb)", [JSON.stringify({
        action_id: "act-direct", thread_id: SHARED, based_on_revision: k.revision, action: { type: "confirmClaim", claimId: c.id },
      })]);
    })).rejects.toThrow(/KG_NOT_OWNER/);
    const ctl = new KnowledgeGraphController(deps.repo, deps.ids, deps.chat, deps.knowledge, deps.actions, {} as never);
    await expect(ctl.humanAction({ userId: "u-member", orgId: ORG } as never, SHARED, { basedOnRevision: k.revision, action: { type: "confirmClaim", claimId: c.id } }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it("别的会话里的结论 id ⇒ KG_CLAIM_NOT_FOUND（不跨会话改）", async () => {
    const other = await claimBy("老张负责测试", SHARED);
    await expect(act({ type: "confirmClaim", claimId: other.id })).rejects.toMatchObject({ code: "KG_CLAIM_NOT_FOUND" });
  });

  it("所有动作之后，AGE 投影与 canonical 仍逐行一致（R3-5）", async () => {
    await projectPendingGraph(new PgGraphProjection(db), silentLogger);
    const p = await asOwner(async (c) => {
      await c.query("BEGIN");
      try { return await graphParity(c, ORG); } finally { await c.query("COMMIT"); }
    });
    expect(p).toEqual({ missingInGraph: [], extraInGraph: [] });
  });
});
