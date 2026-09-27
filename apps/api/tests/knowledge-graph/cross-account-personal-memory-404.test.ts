/**
 * #4366 人类决定（2026-09）：另一个账号访问你的个人记忆 ⇒ 一律 404，而且与「根本不存在」逐字相同（除 traceId）——
 * 不能用 403 / 不同的错误码透露「这条存在，只是你看不到」。
 *
 * 扫一遍同组织另一位成员（与所有者同在一个项目里，所以不是「不同组织」的那种天然隔离）能碰到所有者个人记忆的每一条口：
 *   - 读：个人空间结论的来源抽屉、所有者个人对话的知识 / 来源 / 提名；
 *   - 写：在所有者的个人对话上做动作 / 晋升 / 撤销自动记入；
 *   - 借道：在**自己的**对话上，拿所有者个人空间结论的 id 去确认 / 改写 / 忘掉 / 撤销自动记入。
 * 每一条都配一个用不存在的 id 打同一个接口的对照；对照组（所有者本人）必须能读到，保证扫描不是空转。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { knowledgeGraph as KG } from "@repo/contracts";
import { runExtractionTick } from "../../src/application/knowledge-graph/extract-message-knowledge";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { addOrgMember, addProjectMember, resetOrgs, seedOrg } from "../support/db";
import { client, projectGraph, startApp, type Client, type E2eApp, type HttpResult, type ThreadKnowledgeBody } from "./kg-e2e-fixtures";
import { enableExtraction, extractionDeps, loopbackModel } from "./kg-extraction-fixtures";

const ORG = "org-kg-s9-cross-404";
const PROJECT = `${ORG}-p`;
const OWNER = "u-s9x-owner";
const OTHER = "u-s9x-other";
const A1 = "thr-s9x-a1";
const B1 = "thr-s9x-b1";
const SECRET = "我决定北极星只做安卓版";
const reply = JSON.stringify({
  entities: [], claims: [{ statement: SECRET, kind: "decision", confidence: 0.9, about: [], decidedBy: null, quote: SECRET }],
});

type Personal = import("zod").infer<typeof KG.knowledgeGraph.getPersonalKnowledge.out>;
let e: E2eApp;
let owner: Client;
let other: Client;
const ids: { personal?: string; source?: string } = {};
const stripTrace = (b: unknown) => ({ ...(b as Record<string, unknown>), traceId: undefined });

async function sameAsMissing(label: string, got: HttpResult, missing: HttpResult): Promise<void> {
  expect(JSON.stringify(got.body ?? null), label).not.toContain(SECRET);
  expect({ label, status: got.status }).toEqual({ label, status: 404 });
  expect({ label, status: missing.status }).toEqual({ label, status: 404 });
  expect(stripTrace(got.body), label).toEqual(stripTrace(missing.body));
}
const revisionOf = async (who: Client, threadId: string) => (await who.get<ThreadKnowledgeBody>(`/knowledge-graph/threads/${threadId}`)).body.revision ?? 0;

beforeAll(async () => {
  e = await startApp();
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await enableExtraction(ORG);
  for (const u of [OWNER, OTHER]) {
    await addOrgMember(ORG, u, "consultant", fx.teams.energy!);
    await addProjectMember(ORG, PROJECT, u, "facilitator", null);
  }
  await addChatThread({ orgId: ORG, id: A1, projectId: null, visibilityScope: "private", createdBy: OWNER, title: A1 });
  await addChatThread({ orgId: ORG, id: B1, projectId: null, visibilityScope: "private", createdBy: OTHER, title: B1 });
  await addChatMessage({ orgId: ORG, id: "m-s9x-a1", threadId: A1, body: `${SECRET}。`, authorId: OWNER });
  const deps = extractionDeps(e.db, loopbackModel([[SECRET, reply]]).model, ORG);
  for (let i = 0; i < 20; i += 1) if ((await runExtractionTick(deps)).processed === 0) break;
  await projectGraph(e);
  owner = client(e, OWNER, ORG);
  other = client(e, OTHER, ORG);
  // 所有者说的决定自动记进本人个人空间（#4283）：那就是「你的记忆」。
  const p = await owner.get<Personal>("/knowledge-graph/personal");
  ids.personal = p.body.claims.find((c) => c.statement === SECRET)!.id;
  const k = await owner.get<ThreadKnowledgeBody>(`/knowledge-graph/threads/${A1}`);
  ids.source = k.body.claims.find((c) => c.statement === SECRET)!.id;
}, 180_000);

afterAll(async () => { await e?.app.close(); });

describe("#4366：别的账号碰你的个人记忆 ⇒ 404，与不存在无法区分", () => {
  it("对照：所有者本人读得到自己个人记忆的来源", async () => {
    const r = await owner.get(`/knowledge-graph/claims/${ids.personal}/sources`);
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).toContain(SECRET);
  });

  it("读：个人空间结论 / 来源会话里那条的来源抽屉、所有者个人对话的知识与提名", async () => {
    await sameAsMissing("sources(personal)", await other.get(`/knowledge-graph/claims/${ids.personal}/sources`), await other.get("/knowledge-graph/claims/clm_nope/sources"));
    await sameAsMissing("sources(session)", await other.get(`/knowledge-graph/claims/${ids.source}/sources`), await other.get("/knowledge-graph/claims/clm_nope/sources"));
    await sameAsMissing("thread", await other.get(`/knowledge-graph/threads/${A1}`), await other.get("/knowledge-graph/threads/thr-nope"));
    await sameAsMissing("nominations", await other.get(`/knowledge-graph/threads/${A1}/nominations`), await other.get("/knowledge-graph/threads/thr-nope/nominations"));
    await sameAsMissing("turn memory", await other.get(`/knowledge-graph/threads/${A1}/messages/m-s9x-a1/memory`), await other.get("/knowledge-graph/threads/thr-nope/messages/m-nope/memory"));
    await sameAsMissing("extraction", await other.get(`/knowledge-graph/threads/${A1}/messages/m-s9x-a1/extraction`), await other.get("/knowledge-graph/threads/thr-nope/messages/m-nope/extraction"));
  });

  it("写：在所有者的个人对话上确认 / 晋升 / 撤销自动记入", async () => {
    const act = { basedOnRevision: 0, action: { type: "confirmClaim", claimId: ids.source } };
    await sameAsMissing("actions(owner thread)", await other.post(`/knowledge-graph/threads/${A1}/actions`, act), await other.post("/knowledge-graph/threads/thr-nope/actions", act));
    await sameAsMissing("promote(owner thread)",
      await other.post(`/knowledge-graph/threads/${A1}/promote`, { claimIds: [ids.source] }),
      await other.post("/knowledge-graph/threads/thr-nope/promote", { claimIds: [ids.source] }));
    await sameAsMissing("undo(owner thread)",
      await other.post(`/knowledge-graph/threads/${A1}/claims/${ids.source}/personal-copy/undo`, {}),
      await other.post(`/knowledge-graph/threads/thr-nope/claims/${ids.source}/personal-copy/undo`, {}));
  });

  it("借道：在自己的对话上拿所有者个人空间结论的 id 去确认 / 改写 / 忘掉 / 撤销自动记入", async () => {
    const rev = await revisionOf(other, B1);
    for (const [label, action] of [
      ["confirmClaim", { type: "confirmClaim", claimId: ids.personal }],
      ["reviseClaim", { type: "reviseClaim", claimId: ids.personal, statement: "改掉" }],
      ["revokeClaim", { type: "revokeClaim", claimId: ids.personal }],
    ] as const) {
      const missingAction = { ...action, claimId: "clm_nope" };
      await sameAsMissing(`own-thread ${label}`,
        await other.post(`/knowledge-graph/threads/${B1}/actions`, { basedOnRevision: rev, action }),
        await other.post(`/knowledge-graph/threads/${B1}/actions`, { basedOnRevision: rev, action: missingAction }));
    }
    await sameAsMissing("own-thread undo",
      await other.post(`/knowledge-graph/threads/${B1}/claims/${ids.personal}/personal-copy/undo`, {}),
      await other.post(`/knowledge-graph/threads/${B1}/claims/clm_nope/personal-copy/undo`, {}));
    // 所有者的个人记忆一条没动
    const p = await owner.get<Personal>("/knowledge-graph/personal");
    expect(p.body.claims.map((c) => c.statement)).toContain(SECRET);
  });
});
