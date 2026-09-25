/**
 * Phase 18 F12 —— L1 跨会话召回（uc-18-4 R3-6 / V1），真实数据库 + 真 AGE。
 *
 * 会话 A 里说过「客户 A 要求 v2 下周一上线」并晋升到个人空间；同一个人在新会话 B 里问
 * 「客户 A 有什么要求」⇒ 召回这条、标「来自个人空间知识」，来源能点回会话 A 的原话。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getClaimSources } from "../../src/application/knowledge-graph/read-thread-knowledge";
import { recallThreadKnowledge } from "../../src/application/knowledge-graph/recall-knowledge";
import { buildKnowledgeContextMessage } from "../../src/domain/knowledge-graph/recall";
import { toOrgId } from "../../src/domain/org-id";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { PgKnowledgeRecall } from "../../src/infrastructure/knowledge-graph/pg-knowledge-recall";
import { asOwner } from "../support/db";
import { DEMAND, seedL1Org, type L1Org } from "./kg-l1-fixtures";

const ORG = "org-kg-f12-recall";
let db: PgDatabase;
let port: PgKnowledgeRecall;
let fx: L1Org;
const noLog = () => undefined;
const recall = (threadId: string, query: string, userId = "u-owner") =>
  recallThreadKnowledge(port, { orgId: toOrgId(ORG), userId, threadId, query }, noLog);

beforeAll(async () => {
  db = new PgDatabase(appConfig());
  fx = await seedL1Org(db, ORG);
  port = new PgKnowledgeRecall(db);
});
afterAll(async () => { await db.close(); });

describe("F12: 新会话召回个人空间里的知识", () => {
  it("会话 B（新会话，本身什么都没记）问「客户 A 有什么要求」⇒ 召回会话 A 晋升的那条，作用域是个人空间", async () => {
    const r = await recall(fx.B, "客户 A 有什么要求？");
    expect(r.items[0]).toMatchObject({ claim: { id: fx.personalClaimId, statement: DEMAND, scope: "personal", triState: "confirmed" } });
    // 问题里的「客户 A」经个人空间的实体解析成图种子，图路也命中（F15 起会话 A 里的「客户 A」也是本人个人空间的实体，
    // 同名的两个都会成为种子；晋升过的那条结论本身只以长期记忆的副本出现，见下面「只出现一次」）
    expect(r.graphSeeds.length).toBeGreaterThanOrEqual(1);
    expect(r.items[0]!.channels).toEqual(["fts", "graph"]);
  });

  it("交给模型的材料标明「来自个人空间知识」和最早那次对话的日期", async () => {
    const memory = buildKnowledgeContextMessage(await recall(fx.B, "客户 A 有什么要求？"));
    const [said] = await asOwner(async (c) => (await c.query<{ d: string }>(
      "SELECT to_char(created_at AT TIME ZONE 'UTC', 'MM/DD') AS d FROM chat_messages WHERE id = $1", [`m-${fx.A}`])).rows);
    expect(memory).toContain(`- [你确认过] ${DEMAND}（来自个人空间知识，最早见于你 ${said!.d} 的对话）`);
    expect(memory).toContain("标了「来自个人空间知识」的，引用时也照样标出");
  });

  it("来源能点回会话 A 的原消息（getClaimSources 对个人空间结论可用，仅本人）", async () => {
    const out = await getClaimSources(fx.readDeps, { userId: "u-owner", orgId: toOrgId(ORG), claimId: fx.personalClaimId });
    expect(out.claim).toMatchObject({ id: fx.personalClaimId, scope: { kind: "personal", id: "u-owner" }, derivedFromClaimId: expect.any(String) });
    expect(out.evidence).toEqual([expect.objectContaining({ sourceKind: "chat_message", sourceRef: `m-${fx.A}`, stance: "supporting" })]);
    expect(out.evidence[0]!.excerpt).toContain(DEMAND);
    expect(out.provenance.map((p) => p.action)).toContain("promoteToPersonal");
  });

  it("在会话 A 里问：原结论（L0）和它的个人空间副本（L1）只出现一次", async () => {
    const r = await recall(fx.A, "客户 A 有什么要求？");
    expect(r.items.filter((i) => i.claim.statement === DEMAND)).toHaveLength(1);
    expect(r.items[0]!.claim.scope).toBe("chat_session");
  });
});
