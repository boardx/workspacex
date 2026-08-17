import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { research as C } from "@repo/contracts";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f195-guided-workflow";
const OTHER_ORG = "org-f195-guided-workflow-other";
const OWNER = "u-f195-owner";
const OTHER_USER = "u-f195-other";

let app: NestExpressApplication;
let base = "";
let db: PgDatabase;
let graphServer: Server;
let graphBase = "";
let modelServer: Server;
let modelBase = "";
let graphCommandCalls = 0;
let modelCalls = 0;
let modelMode: "normal" | "invalid-outline" = "normal";

const graphStates = new Map<string, Record<string, unknown>>();
const nodeMeta = (status: string, version = 0) => ({
  status,
  version,
  confirmedVersion: status === "confirmed" ? version : null,
  contentVersionId: null,
  modelId: null,
  modelInvocationId: null,
  modelOutputSchemaVersion: null,
  confirmedAt: null,
  updatedAt: "2026-08-16T00:00:00.000Z",
  errorCode: null,
});

const readJson = async (request: import("node:http").IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, any>;
};

beforeAll(async () => {
  graphServer = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.method === "POST" && request.url === "/threads") {
      const body = await readJson(request);
      response.end(JSON.stringify({ thread_id: body.thread_id }));
      return;
    }
    const runMatch = request.url?.match(/^\/threads\/([^/]+)\/runs\/wait$/);
    if (request.method === "POST" && runMatch) {
      const sessionId = decodeURIComponent(runMatch[1]!);
      const body = await readJson(request);
      if (body.input) {
        graphStates.set(sessionId, body.input);
      } else {
        graphCommandCalls += 1;
        const previous = graphStates.get(sessionId)!;
        const command = body.command.resume;
        const previousSummaries = previous.nodeSummaries as Record<string, any>;
        const nextSummaries = JSON.parse(JSON.stringify(previousSummaries)) as Record<string, any>;
        const nextGraphVersion = Number(previous.graphVersion) + 1;
        if (command.action === "generate") {
          nextSummaries[command.node].status = "ready";
          nextSummaries[command.node].version += 1;
          if (command.node === "directions") {
            nextSummaries.directions.modelId = "qwen3.7-plus";
            nextSummaries.directions.modelInvocationId = `${sessionId}:${command.requestId}:directions:generate`;
            nextSummaries.directions.modelOutputSchemaVersion = "guided-research-directions:v1";
            nextSummaries.directions.contentVersionId = `content-${nextGraphVersion}`;
          }
          if (command.node === "outline") {
            nextSummaries.outline.modelId = "qwen3.7-plus";
            nextSummaries.outline.modelInvocationId = `${sessionId}:${command.requestId}:outline:generate`;
            nextSummaries.outline.modelOutputSchemaVersion = "guided-research-outline:v1";
            nextSummaries.outline.contentVersionId = `content-${nextGraphVersion}`;
          }
        }
        if (command.action === "confirm" || command.action === "reconfirm") {
          nextSummaries[command.node].status = "confirmed";
          nextSummaries[command.node].confirmedVersion = nextSummaries[command.node].version;
        }
        graphStates.set(sessionId, {
          ...previous,
          graphVersion: nextGraphVersion,
          revision: command.action === "reconfirm" ? Number(previous.revision) + 1 : previous.revision,
          currentNode: command.node === "brief"
            ? "directions"
            : command.node === "directions" && command.action !== "generate" ? "outline" : previous.currentNode,
          availableNodes: command.node === "directions" && command.action !== "generate"
            ? ["brief", "directions", "outline"]
            : command.node === "brief" ? ["brief", "directions"] : previous.availableNodes,
          nodeStates: { ...(previous.nodeStates as object), [command.node]: command.nodeState },
          nodeSummaries: nextSummaries,
        });
      }
      response.end(JSON.stringify({}));
      return;
    }
    const stateMatch = request.url?.match(/^\/threads\/([^/]+)\/state$/);
    if (request.method === "GET" && stateMatch) {
      const sessionId = decodeURIComponent(stateMatch[1]!);
      const values = graphStates.get(sessionId);
      if (!values) {
        response.statusCode = 404;
        response.end(JSON.stringify({ detail: "thread not found" }));
        return;
      }
      response.end(JSON.stringify({
        values,
        checkpoint: { checkpoint_id: `cp-${String(values.graphVersion)}` },
      }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ detail: "not found" }));
  });
  await new Promise<void>((resolve) => graphServer.listen(0, "127.0.0.1", resolve));
  const graphAddress = graphServer.address();
  graphBase = `http://127.0.0.1:${typeof graphAddress === "object" && graphAddress ? graphAddress.port : 0}`;
  process.env.GUIDED_RESEARCH_GRAPH_URL = graphBase;

  modelServer = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.method !== "POST" || request.url !== "/chat/completions") {
      response.statusCode = 404;
      response.end(JSON.stringify({ detail: "not found" }));
      return;
    }
    modelCalls += 1;
    const body = await readJson(request);
    expect(body.model).toBe("qwen3.7-plus");
    const responseContent = modelMode === "invalid-outline" && modelCalls > 1
      ? { sections: [] }
      : modelCalls === 1
      ? {
          directions: [
            {
              id: "direction-model-market",
              title: "模型生成的市场优先级",
              description: "从 brief 中比较目标区域的市场容量、政策窗口和客户成熟度。",
              enabled: true,
              order: 0,
            },
            {
              id: "direction-model-entry",
              title: "模型生成的进入路径",
              description: "评估自建、渠道合作和生态伙伴三种路径的风险与速度。",
              enabled: true,
              order: 1,
            },
          ],
        }
      : {
          sections: [
            {
              id: "section-model-market",
              title: "市场优先级判断",
              description: "综合目标国家市场规模、政策窗口和客户成熟度形成进入优先级。",
              researchQuestions: ["哪些国家最值得优先进入？", "市场规模与增长质量是否匹配？"],
              order: 0,
            },
            {
              id: "section-model-entry",
              title: "进入路径取舍",
              description: "比较自建、渠道合作和生态伙伴三种路径的速度、风险与资源要求。",
              researchQuestions: ["哪种进入路径风险最低？", "哪些伙伴类型能缩短落地周期？"],
              order: 1,
            },
          ],
        };
    response.end(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify(responseContent),
        },
      }],
      usage: { total_tokens: 123 },
    }));
  });
  await new Promise<void>((resolve) => modelServer.listen(0, "127.0.0.1", resolve));
  const modelAddress = modelServer.address();
  modelBase = `http://127.0.0.1:${typeof modelAddress === "object" && modelAddress ? modelAddress.port : 0}`;
  process.env.KERNEL_MODEL_PROVIDER = "test-qwen";
  process.env.KERNEL_MODEL_BASE_URL = modelBase;
  process.env.KERNEL_MODEL_API_KEY = "test-key";
  process.env.KERNEL_MODEL_TIMEOUT_MS = "2000";

  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const address = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}, 120_000);

afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG, OTHER_ORG);
  await db?.close();
  await new Promise<void>((resolve, reject) => graphServer.close((error) => error ? reject(error) : resolve()));
  await new Promise<void>((resolve, reject) => modelServer.close((error) => error ? reject(error) : resolve()));
});

beforeEach(async () => {
  graphStates.clear();
  graphCommandCalls = 0;
  modelCalls = 0;
  modelMode = "normal";
  await resetOrgs(ORG, OTHER_ORG);
  const fixture = await seedOrg({ orgId: ORG, projectId: "proj-f195" });
  await addOrgMember(ORG, OWNER, "consultant", fixture.teams.energy!);
  await addOrgMember(ORG, OTHER_USER, "consultant", fixture.teams.energy!);
  await seedOrg({ orgId: OTHER_ORG, projectId: "proj-f195-other" });
});

const auth = (userId: string, orgId = ORG) => ({
  "content-type": "application/json",
  "x-kernel-test-principal": `${userId}:${orgId}`,
});

async function createSession() {
  const response = await fetch(`${base}${C.operations.createGuidedResearchSession.path}`, {
    method: "POST",
    headers: auth(OWNER),
    body: JSON.stringify({
      title: "欧洲储能进入研究",
      tags: ["欧洲", "储能"],
      idempotencyKey: "create-f195",
      collaboratorUserIds: [],
      brief: {
        topic: "欧洲储能市场进入策略",
        goal: "确定首批进入国家",
        timeRange: "2025-2028",
        region: "欧洲",
        focus: "市场、政策和并网",
      },
    }),
  });
  expect(response.status).toBe(201);
  return C.operations.createGuidedResearchSession.out.parse(await response.json());
}

const briefNodeState = {
  name: "欧洲储能进入研究",
  tags: ["欧洲", "储能"],
  topic: "欧洲储能市场进入策略",
  objective: "确定首批进入国家",
  timeRange: "2025-2028",
  geography: "欧洲",
  focus: "市场、政策和并网",
};

describe("F195 Guided Research workflow API", () => {
  it("hydrates one server workflow and keeps absent and unauthorized indistinguishable", async () => {
    const session = await createSession();
    const owner = await fetch(`${base}/research/guided-sessions/${session.sessionId}/workflow`, {
      headers: auth(OWNER),
    });
    expect(owner.status).toBe(200);
    expect(C.operations.getGuidedResearchWorkflow.out.parse(await owner.json())).toMatchObject({
      sessionId: session.sessionId,
      currentNode: "directions",
      graphVersion: 0,
      availableNodes: ["brief", "directions"],
    });

    for (const sessionId of [session.sessionId, "grs-missing"]) {
      const hidden = await fetch(`${base}/research/guided-sessions/${sessionId}/workflow`, {
        headers: auth(OTHER_USER),
      });
      expect(hidden.status).toBe(404);
      expect(await hidden.json()).toMatchObject({ reasonCode: "RESEARCH_NOT_FOUND" });
    }
  });

  it("finalizes an idempotent command and rejects payload or graph-version conflicts", async () => {
    const session = await createSession();
    await fetch(`${base}/research/guided-sessions/${session.sessionId}/workflow`, { headers: auth(OWNER) });
    const url = `${base}/research/guided-sessions/${session.sessionId}/workflow/nodes/brief`;
    const payload = {
      sessionId: session.sessionId,
      node: "brief",
      action: "reconfirm",
      requestId: "request-f195",
      expectedGraphVersion: 0,
      nodeState: briefNodeState,
    };

    const first = await fetch(url, { method: "POST", headers: auth(OWNER), body: JSON.stringify(payload) });
    expect(first.status).toBe(201);
    const firstProjection = C.operations.executeGuidedResearchNode.out.parse(await first.json());
    expect(firstProjection.graphVersion).toBe(2);
    expect(firstProjection.activeNodeState).toEqual({
      directions: [
        {
          id: "direction-model-market",
          title: "模型生成的市场优先级",
          description: "从 brief 中比较目标区域的市场容量、政策窗口和客户成熟度。",
          enabled: true,
          order: 0,
        },
        {
          id: "direction-model-entry",
          title: "模型生成的进入路径",
          description: "评估自建、渠道合作和生态伙伴三种路径的风险与速度。",
          enabled: true,
          order: 1,
        },
      ],
    });
    expect(firstProjection.nodeSummaries.directions).toMatchObject({
      status: "ready",
      version: 1,
      modelId: "qwen3.7-plus",
      modelOutputSchemaVersion: "guided-research-directions:v1",
    });

    const replay = await fetch(url, { method: "POST", headers: auth(OWNER), body: JSON.stringify(payload) });
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(firstProjection);
    expect(graphCommandCalls).toBe(0);
    expect(modelCalls).toBe(1);

    const mismatch = await fetch(url, {
      method: "POST",
      headers: auth(OWNER),
      body: JSON.stringify({ ...payload, nodeState: { ...briefNodeState, focus: "不同载荷" } }),
    });
    expect(mismatch.status).toBe(409);
    expect(await mismatch.json()).toMatchObject({ reasonCode: "RESEARCH_IDEMPOTENCY_REPLAY_MISMATCH" });

    const stale = await fetch(url, {
      method: "POST",
      headers: auth(OWNER),
      body: JSON.stringify({ ...payload, requestId: "request-stale" }),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      reasonCode: "RESEARCH_GRAPH_VERSION_CONFLICT",
      latestProjection: { graphVersion: 2 },
    });
    expect(graphCommandCalls).toBe(0);
  });

  it("generates a structured outline after directions confirmation without replaying the model", async () => {
    const session = await createSession();
    await fetch(`${base}/research/guided-sessions/${session.sessionId}/workflow`, { headers: auth(OWNER) });

    const briefPayload = {
      sessionId: session.sessionId,
      node: "brief",
      action: "confirm",
      requestId: "request-outline-brief",
      expectedGraphVersion: 0,
      nodeState: briefNodeState,
    };
    const brief = await fetch(`${base}/research/guided-sessions/${session.sessionId}/workflow/nodes/brief`, {
      method: "POST",
      headers: auth(OWNER),
      body: JSON.stringify(briefPayload),
    });
    expect(brief.status).toBe(201);
    const directionsReady = C.operations.executeGuidedResearchNode.out.parse(await brief.json());
    expect(directionsReady.graphVersion).toBe(2);

    const directionsPayload = {
      sessionId: session.sessionId,
      node: "directions",
      action: "confirm",
      requestId: "request-outline-directions",
      expectedGraphVersion: 2,
      nodeState: directionsReady.activeNodeState,
    };
    const first = await fetch(`${base}/research/guided-sessions/${session.sessionId}/workflow/nodes/directions`, {
      method: "POST",
      headers: auth(OWNER),
      body: JSON.stringify(directionsPayload),
    });
    expect(first.status).toBe(201);
    const firstProjection = C.operations.executeGuidedResearchNode.out.parse(await first.json());
    expect(firstProjection).toMatchObject({
      graphVersion: 4,
      currentNode: "outline",
      activeNodeState: {
        sections: [
          {
            id: "section-model-market",
            title: "市场优先级判断",
            description: "综合目标国家市场规模、政策窗口和客户成熟度形成进入优先级。",
            researchQuestions: ["哪些国家最值得优先进入？", "市场规模与增长质量是否匹配？"],
            order: 0,
          },
          {
            id: "section-model-entry",
            title: "进入路径取舍",
            description: "比较自建、渠道合作和生态伙伴三种路径的速度、风险与资源要求。",
            researchQuestions: ["哪种进入路径风险最低？", "哪些伙伴类型能缩短落地周期？"],
            order: 1,
          },
        ],
      },
      nodeSummaries: {
        outline: {
          status: "ready",
          version: 1,
          modelId: "qwen3.7-plus",
          modelOutputSchemaVersion: "guided-research-outline:v1",
        },
      },
    });

    const replay = await fetch(`${base}/research/guided-sessions/${session.sessionId}/workflow/nodes/directions`, {
      method: "POST",
      headers: auth(OWNER),
      body: JSON.stringify(directionsPayload),
    });
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(firstProjection);
    expect(modelCalls).toBe(2);
    expect(graphCommandCalls).toBe(0);

    const stale = await fetch(`${base}/research/guided-sessions/${session.sessionId}/workflow/nodes/directions`, {
      method: "POST",
      headers: auth(OWNER),
      body: JSON.stringify({ ...directionsPayload, requestId: "request-outline-stale" }),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      reasonCode: "RESEARCH_GRAPH_VERSION_CONFLICT",
      latestProjection: { graphVersion: 4 },
    });
    expect(modelCalls).toBe(2);
    expect(graphCommandCalls).toBe(0);
  });

  it("does not advance or fabricate outline state when the model returns no valid outline", async () => {
    const session = await createSession();
    await fetch(`${base}/research/guided-sessions/${session.sessionId}/workflow`, { headers: auth(OWNER) });

    const brief = await fetch(`${base}/research/guided-sessions/${session.sessionId}/workflow/nodes/brief`, {
      method: "POST",
      headers: auth(OWNER),
      body: JSON.stringify({
        sessionId: session.sessionId,
        node: "brief",
        action: "confirm",
        requestId: "request-invalid-outline-brief",
        expectedGraphVersion: 0,
        nodeState: briefNodeState,
      }),
    });
    expect(brief.status).toBe(201);
    const directionsReady = C.operations.executeGuidedResearchNode.out.parse(await brief.json());
    modelMode = "invalid-outline";

    const response = await fetch(`${base}/research/guided-sessions/${session.sessionId}/workflow/nodes/directions`, {
      method: "POST",
      headers: auth(OWNER),
      body: JSON.stringify({
        sessionId: session.sessionId,
        node: "directions",
        action: "confirm",
        requestId: "request-invalid-outline-directions",
        expectedGraphVersion: 2,
        nodeState: directionsReady.activeNodeState,
      }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ reasonCode: "RESEARCH_NODE_STATE_INVALID" });
    expect(modelCalls).toBe(2);
    expect(graphCommandCalls).toBe(0);

    const workflow = await fetch(`${base}/research/guided-sessions/${session.sessionId}/workflow`, {
      headers: auth(OWNER),
    });
    expect(C.operations.getGuidedResearchWorkflow.out.parse(await workflow.json())).toMatchObject({
      graphVersion: 2,
      currentNode: "directions",
      nodeSummaries: { outline: { status: "locked", version: 0 } },
    });
  });
});
