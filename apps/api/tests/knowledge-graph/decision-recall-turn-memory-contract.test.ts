/**
 * issue #4271（round 3 真浏览器复现）—— 本会话的决定类结论被强制召回（#4186，`fuseRecall` 的 decisionForced）
 * 之后，这一轮回答下方的 `getTurnMemory` 必须仍然满足契约 `KgTurnMemory`。
 *
 * 复现到的缺陷：强制召回条目的 `score` 是 `Number.POSITIVE_INFINITY`，写进 `kg_turn_recalls.items`（jsonb）时
 * JSON 把它变成 `null`，读接口原样回 `score: null`，而契约是 `z.number()`——前端 `getParsed` 解析失败，
 * `TurnMemoryLine` 整块不画：这一轮的引用、「已记下」、**连同「记住 / 忘掉」确认卡**全部消失
 * （「记住这句」/「+ 记一条」在有决定的会话里看起来就是「点了没反应」）。
 *
 * 同一套完整应用与真链路（kg-e2e-fixtures.ts 文件头）：真受理接口 → 抽取 tick → 执行器召回 → 写回 → GET memory。
 * 另有一条读侧的守卫：修复前已经写进库里的 `score: null` 行（线上已有），读出来也要合契约。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { knowledgeGraph as KG } from "@repo/contracts";
import { addChatThread } from "../support/chat-db";
import { addOrgMember, asOwner, resetOrgs, seedOrg } from "../support/db";
import {
  DECISION, SAY_DECISION, client, memoryPath, publishAgent, settleKnowledge, startApp, turn,
  type Client, type E2eApp, type TurnMemoryBody,
} from "./kg-e2e-fixtures";
import { enableExtraction } from "./kg-extraction-fixtures";

const ORG = "org-kg-i4271-decision-turn";
const OWNER = "u-i4271-owner";
const AGENT = "agent-i4271";
const A = "thr-i4271-a";

let e: E2eApp;
let me: Client;

beforeAll(async () => {
  e = await startApp();
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: `${ORG}-p` });
  await enableExtraction(ORG);
  await addOrgMember(ORG, OWNER, "consultant", null);
  await publishAgent(ORG, AGENT, OWNER);
  await addChatThread({ orgId: ORG, id: A, projectId: null, visibilityScope: "private", createdBy: OWNER, title: "决定" });
  me = client(e, OWNER, ORG);
}, 180_000);

afterAll(async () => {
  await e?.app.close();
});

describe("issue #4271: 决定类结论被强制召回的那一轮，回答下方的记忆仍合契约", () => {
  let answerId = "";

  it("说出决定 → 下一轮说毫不相关的话：决定经强制通道进了模型上下文", async () => {
    await turn(e, me, ORG, A, SAY_DECISION, AGENT);
    await settleKnowledge(e, ORG);
    const t = await turn(e, me, ORG, A, "开始写报告吧", AGENT);
    expect(t.memory).toContain(DECISION);
    answerId = t.answerId;
  }, 120_000);

  it("GET memory 通过 KgTurnMemory 契约解析，决定那条带有限的 score、走 claim 通道", async () => {
    const r = await me.get<TurnMemoryBody>(memoryPath(A, answerId));
    expect(r.status).toBe(200);
    const parsed = KG.knowledgeGraph.getTurnMemory.out.safeParse(r.body);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
    const hit = parsed.success ? parsed.data.recalled.find((m) => m.statement === DECISION) : undefined;
    expect(hit?.channels).toEqual(["claim"]);
    expect(Number.isFinite(hit?.score)).toBe(true);
  });

  it("修复前已经落库的 score: null 行，读出来也合契约", async () => {
    await asOwner((c) => c.query(
      `UPDATE kg_turn_recalls SET items = (SELECT jsonb_agg(jsonb_set(i, '{score}', 'null'::jsonb)) FROM jsonb_array_elements(items) i)
        WHERE org_id = $1 AND thread_id = $2`,
      [ORG, A],
    ));
    const r = await me.get<TurnMemoryBody>(memoryPath(A, answerId));
    const parsed = KG.knowledgeGraph.getTurnMemory.out.safeParse(r.body);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
    expect(parsed.success && parsed.data.recalled.some((m) => m.statement === DECISION)).toBe(true);
  });
});
