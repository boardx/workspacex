/**
 * Phase 18 F12 —— L1 零越权（uc-18-4 R5 / R11② / V2），真实数据库。
 *
 * 召回范围恒为「发起人可见的这个会话（L0）∪ 发起人本人的个人空间（L1）」：
 *   - 另一个用户在自己的会话里问同样的问题 ⇒ 所有者的 L1 零召回；
 *   - 项目会话里，成员提问只得 L0，看不到所有者的 L1；所有者本人在同一会话提问则 L0 + 自己的 L1；
 *   - 换一个组织、同一个用户 id ⇒ 零召回；
 *   - 图里是全 org 的 id：即使图路把所有者的 L1 id 递过来，也回候选集求交丢掉；
 *   - 数据库层（RLS）同样只把个人空间的行放给本人；来源抽屉对别人与不存在同一个出口。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KnowledgeRecallPort } from "../../src/application/knowledge-graph/ports";
import { getClaimSources } from "../../src/application/knowledge-graph/read-thread-knowledge";
import { recallThreadKnowledge } from "../../src/application/knowledge-graph/recall-knowledge";
import { toOrgId } from "../../src/domain/org-id";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { PgKnowledgeRecall } from "../../src/infrastructure/knowledge-graph/pg-knowledge-recall";
import { asApp } from "../support/db";
import { DEMAND, seedL1Org, type L1Org } from "./kg-l1-fixtures";

const ORG = "org-kg-f12-leak";
const ORG2 = "org-kg-f12-leak2";
const Q = "客户 A 有什么要求？";
let db: PgDatabase;
let port: PgKnowledgeRecall;
let fx: L1Org;
let fx2: L1Org;
const noLog = () => undefined;
const recall = (org: string, threadId: string, userId: string, p: KnowledgeRecallPort = port) =>
  recallThreadKnowledge(p, { orgId: toOrgId(org), userId, threadId, query: Q }, noLog);
const personalIds = (r: Awaited<ReturnType<typeof recall>>) => r.items.filter((i) => i.claim.scope === "personal").map((i) => i.claim.id);

beforeAll(async () => {
  db = new PgDatabase(appConfig());
  fx = await seedL1Org(db, ORG);
  fx2 = await seedL1Org(db, ORG2);
  port = new PgKnowledgeRecall(db);
});
afterAll(async () => { await db.close(); });

describe("F12: L1 零越权", () => {
  it("所有者自己能召回（对照组）", async () => {
    expect(personalIds(await recall(ORG, fx.B, "u-owner"))).toEqual([fx.personalClaimId]);
  });

  it("另一个用户在自己的个人会话里问同样的问题 ⇒ 零召回（候选集里也没有所有者的任何结论 / 实体）", async () => {
    const r = await recall(ORG, fx.OTHER, "u-other");
    expect(r.items).toEqual([]);
    const c = await port.candidates(toOrgId(ORG), "u-other", fx.OTHER);
    expect(c.claims).toEqual([]);
    expect(c.objects).toEqual([]);
  });

  it("项目会话：成员提问只得 L0（合同那条），看不到所有者的 L1；所有者在同一会话提问得 L0 + 自己的 L1", async () => {
    const member = await recall(ORG, fx.S, "u-member");
    expect(member.items.map((i) => i.claim.scope)).toEqual(["chat_session"]);
    expect(member.items[0]!.claim.statement).toBe("客户 A 的合同在法务那里");
    const owner = await recall(ORG, fx.S, "u-owner");
    expect(new Set(owner.items.map((i) => i.claim.statement))).toEqual(new Set([DEMAND, "客户 A 的合同在法务那里"]));
    expect(personalIds(owner)).toEqual([fx.personalClaimId]);
  });

  it("跨组织：另一个组织里同一个用户 id 的个人空间是另一份；召回永不跨组织", async () => {
    const r = await recall(ORG2, fx2.B, "u-owner");
    expect(personalIds(r)).toEqual([fx2.personalClaimId]);
    expect(personalIds(r)).not.toContain(fx.personalClaimId);
    // 拿本组织的会话 id 去另一个组织召回：该组织里没有这个会话，也没有这些行
    const cross = await port.candidates(toOrgId(ORG2), "u-other", fx.B);
    expect(cross.claims).toEqual([]);
  });

  it("图路把所有者的 L1 id 递给成员，也回候选集求交丢掉", async () => {
    const leaky: KnowledgeRecallPort = {
      candidates: (...a) => port.candidates(...a),
      graphNeighbors: async (o, seeds) => [
        ...(await port.graphNeighbors(o, seeds)),
        { claimId: fx.personalClaimId, path: [{ src: seeds[0]!, relation: "about", dst: `claim:${fx.personalClaimId}` }] },
      ],
    };
    expect(personalIds(await recall(ORG, fx.S, "u-member", leaky))).toEqual([]);
  });

  it("数据库层：以成员身份直接查个人空间的结论 ⇒ 0 行（RLS 只放给本人）；所有者 ⇒ 1 行", async () => {
    const count = (userId: string) => asApp(ORG, async (c) => {
      await c.query("BEGIN");
      try {
        await c.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
        return (await c.query("SELECT id FROM claims WHERE scope_kind = 'personal'")).rowCount;
      } finally {
        await c.query("ROLLBACK");
      }
    });
    expect(await count("u-member")).toBe(0);
    expect(await count("u-other")).toBe(0);
    expect(await count("u-owner")).toBe(1);
  });

  it("来源抽屉：别人打开所有者的 L1 结论 ⇒ 与不存在同一个出口（KG_CLAIM_NOT_FOUND）", async () => {
    for (const userId of ["u-member", "u-other"]) {
      await expect(getClaimSources(fx.readDeps, { userId, orgId: toOrgId(ORG), claimId: fx.personalClaimId }))
        .rejects.toMatchObject({ code: "KG_CLAIM_NOT_FOUND" });
    }
    await expect(getClaimSources(fx.readDeps, { userId: "u-owner", orgId: toOrgId(ORG), claimId: "no-such-claim" }))
      .rejects.toMatchObject({ code: "KG_CLAIM_NOT_FOUND" });
  });
});
