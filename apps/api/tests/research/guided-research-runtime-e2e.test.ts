/**
 * WF07 —— 引导式研究在通用 Workflow Runtime 上的端到端（02-workflow-runtime.md R3-12；coverage V14）。
 *
 * 走真实 Nest 应用 + 真实 PostgreSQL，经现有 research.ts 引导式研究 operations（路径与响应形状不变）
 * 完成 hydrate → brief 确认（生成方向）→ 幂等重放 → 载荷冲突 / 版本冲突 → directions 确认（生成大纲），
 * 然后读库证明：checkpoint 只落 `langgraph_workflow`（checkpoint_ns = guided-research:1，thread_id = sessionId），
 * receipt 只落 `workflow_receipts`；旧 `langgraph_interview` / `guided_research_node_receipts` 一行都没有；
 * 迁移报告里本会话不在未迁清单上。模型是回环假服务（真实模型链路另见 real-model-e2e）。
 */
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { research as C } from "@repo/contracts";
import { reportGuidedResearchMigration } from "../../scripts/lib/guided-research-stage1-migration";
import { addOrgMember, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-wf07-guided-e2e";
const OWNER = "u-wf07-e2e-owner";
const OTHER = "u-wf07-e2e-other";

let app: NestExpressApplication;
let base = "";
let modelServer: Server;
let modelCalls = 0;
const sessions: string[] = [];

const directions = [
  { id: "direction-market", title: "市场优先级", description: "比较目标区域的市场容量与政策窗口。", enabled: true, order: 0 },
  { id: "direction-entry", title: "进入路径", description: "评估自建、渠道合作与生态伙伴的风险。", enabled: true, order: 1 },
];
const sections = [
  {
    id: "section-market", title: "市场优先级判断", description: "综合市场规模、政策窗口与客户成熟度。",
    researchQuestions: ["哪些国家最值得优先进入？"], order: 0,
  },
  {
    id: "section-entry", title: "进入路径取舍", description: "比较三种进入路径的速度、风险与资源要求。",
    researchQuestions: ["哪种进入路径风险最低？"], order: 1,
  },
];

beforeAll(async () => {
  modelServer = createServer(async (request, response) => {
    for await (const _chunk of request) void _chunk;
    response.setHeader("content-type", "application/json");
    if (request.method !== "POST" || request.url !== "/chat/completions") {
      response.statusCode = 404;
      response.end("{}");
      return;
    }
    modelCalls += 1;
    const content = modelCalls % 2 === 1 ? { directions } : { sections };
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { total_tokens: 42 } }));
  });
  await new Promise<void>((resolve) => modelServer.listen(0, "127.0.0.1", resolve));
  const address = modelServer.address();
  process.env.KERNEL_MODEL_PROVIDER = "test-qwen";
  process.env.KERNEL_MODEL_BASE_URL = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  process.env.KERNEL_MODEL_API_KEY = "test-key";
  process.env.KERNEL_MODEL_TIMEOUT_MS = "2000";

  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  const appAddress = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof appAddress === "object" && appAddress ? appAddress.port : 0}`;
}, 120_000);

afterAll(async () => {
  await app?.close();
  await asOwner(async (c) => {
    for (const t of ["checkpoints", "checkpoint_blobs", "checkpoint_writes"]) {
      await c.query(`DELETE FROM langgraph_workflow.${t} WHERE thread_id = ANY($1)`, [sessions]);
    }
  });
  await resetOrgs(ORG);
  await new Promise<void>((resolve, reject) => modelServer.close((e) => (e ? reject(e) : resolve())));
});

beforeEach(async () => {
  modelCalls = 0;
  await resetOrgs(ORG);
  const fixture = await seedOrg({ orgId: ORG, projectId: "proj-wf07-e2e" });
  await addOrgMember(ORG, OWNER, "consultant", fixture.teams.energy!);
  await addOrgMember(ORG, OTHER, "consultant", fixture.teams.energy!);
});

const auth = (userId: string) => ({ "content-type": "application/json", "x-kernel-test-principal": `${userId}:${ORG}` });

const briefNodeState = {
  name: "欧洲储能进入研究", tags: ["欧洲", "储能"], topic: "欧洲储能市场进入策略", objective: "确定首批进入国家",
  timeRange: "2025-2028", geography: "欧洲", focus: "市场、政策和并网",
};

async function post(url: string, body: unknown) {
  return fetch(url, { method: "POST", headers: auth(OWNER), body: JSON.stringify(body) });
}

describe("WF07 guided research runs on the generic workflow runtime (existing operations unchanged)", () => {
  it("drives the guided flow over the same HTTP operations and persists only to workflow runtime storage", async () => {
    const created = await post(`${base}${C.operations.createGuidedResearchSession.path}`, {
      title: "欧洲储能进入研究",
      tags: ["欧洲", "储能"],
      idempotencyKey: "create-wf07-e2e",
      collaboratorUserIds: [],
      brief: { topic: "欧洲储能市场进入策略", goal: "确定首批进入国家", timeRange: "2025-2028", region: "欧洲", focus: "市场、政策和并网" },
    });
    expect(created.status).toBe(201);
    const { sessionId } = C.operations.createGuidedResearchSession.out.parse(await created.json());
    sessions.push(sessionId);
    const workflowUrl = `${base}/research/guided-sessions/${sessionId}/workflow`;

    const hydrated = await fetch(workflowUrl, { headers: auth(OWNER) });
    expect(hydrated.status).toBe(200);
    expect(C.operations.getGuidedResearchWorkflow.out.parse(await hydrated.json())).toMatchObject({
      sessionId, graphVersion: 0, currentNode: "directions", availableNodes: ["brief", "directions"],
    });
    const hidden = await fetch(workflowUrl, { headers: auth(OTHER) });
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toMatchObject({ reasonCode: "RESEARCH_NOT_FOUND" });

    const briefCommand = {
      sessionId, node: "brief", action: "confirm", requestId: "request-wf07-brief", expectedGraphVersion: 0, nodeState: briefNodeState,
    };
    const brief = await post(`${workflowUrl}/nodes/brief`, briefCommand);
    expect(brief.status).toBe(201);
    const afterBrief = C.operations.executeGuidedResearchNode.out.parse(await brief.json());
    expect(afterBrief).toMatchObject({ graphVersion: 2, currentNode: "directions", activeNodeState: { directions } });

    const replay = await post(`${workflowUrl}/nodes/brief`, briefCommand);
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(afterBrief);
    expect(modelCalls).toBe(1);

    const mismatch = await post(`${workflowUrl}/nodes/brief`, { ...briefCommand, nodeState: { ...briefNodeState, focus: "不同载荷" } });
    expect(mismatch.status).toBe(409);
    expect(await mismatch.json()).toMatchObject({ reasonCode: "RESEARCH_IDEMPOTENCY_REPLAY_MISMATCH" });
    const stale = await post(`${workflowUrl}/nodes/brief`, { ...briefCommand, requestId: "request-wf07-stale" });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ reasonCode: "RESEARCH_GRAPH_VERSION_CONFLICT", latestProjection: { graphVersion: 2 } });

    const outline = await post(`${workflowUrl}/nodes/directions`, {
      sessionId, node: "directions", action: "confirm", requestId: "request-wf07-directions",
      expectedGraphVersion: 2, nodeState: afterBrief.activeNodeState,
    });
    expect(outline.status).toBe(201);
    expect(C.operations.executeGuidedResearchNode.out.parse(await outline.json())).toMatchObject({
      graphVersion: 4, currentNode: "outline", activeNodeState: { sections },
    });

    // 重新 hydrate：状态从 langgraph_workflow 的 checkpoint 读回
    const rehydrated = await fetch(workflowUrl, { headers: auth(OWNER) });
    expect(C.operations.getGuidedResearchWorkflow.out.parse(await rehydrated.json())).toMatchObject({ graphVersion: 4, currentNode: "outline" });

    const storage = await asOwner(async (c) => ({
      workflow: (await c.query<{ checkpoint_ns: string }>(
        "SELECT DISTINCT checkpoint_ns FROM langgraph_workflow.checkpoints WHERE thread_id = $1", [sessionId],
      )).rows,
      legacy: (await c.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM langgraph_interview.checkpoints WHERE thread_id = $1", [sessionId],
      )).rows[0]!.n,
      receipts: (await c.query<{ request_key: string; status: string }>(
        "SELECT request_key, status FROM workflow_receipts WHERE org_id = $1 AND scope = 'command' ORDER BY request_key", [ORG],
      )).rows,
      legacyReceipts: (await c.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM guided_research_node_receipts WHERE session_id = $1", [sessionId],
      )).rows[0]!.n,
    }));
    expect(storage.workflow).toEqual([{ checkpoint_ns: "guided-research:1" }]);
    expect(storage.legacy).toBe(0);
    expect(storage.receipts).toEqual([
      { request_key: `guided-research:${sessionId}:request-wf07-brief`, status: "finalized" },
      { request_key: `guided-research:${sessionId}:request-wf07-directions`, status: "finalized" },
    ]);
    expect(storage.legacyReceipts).toBe(0);

    const report = await asOwner((c) => reportGuidedResearchMigration(c));
    expect(report.unmigrated).toEqual([]);
  });
});
