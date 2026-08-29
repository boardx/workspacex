import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { interview } from "@repo/contracts";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { z } from "zod";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { addOrgMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-digital-interview-f04";
const OTHER_ORG = "org-digital-interview-f04-other";
const USER = "u-digital-interview-f04";
const EXPERT = "agent-digital-interview-f04";
const EXPERT_VERSION = "agent-version-digital-interview-f04";
const PROVIDER = "digital-interview-f04-loopback";
const MODEL = "digital-interview-f04-model";
const auth = { "x-kernel-test-principal": `${USER}:${ORG}` };
const otherAuth = { "x-kernel-test-principal": `${USER}:${OTHER_ORG}` };

let app: NestExpressApplication;
let base = "";
let db: PgDatabase;
let provider: Server;
let providerHook: (() => Promise<void>) | null = null;
let providerFailureStatus: number | null = null;

async function startApp() {
  const { createApp } = await import("../../src/main");
  app = await createApp();
  const server = await app.listen(0, "127.0.0.1");
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("digital interview acceptance server did not bind a TCP port");
  }
  base = `http://127.0.0.1:${address.port}`;
}

async function restartApp() {
  const previous = app;
  await startApp();
  await previous.close();
}

type DigitalInterviewResponse = z.infer<typeof interview.DigitalInterviewWorkflowView>;

function maskTrace(raw: string) {
  return raw.replace(/"traceId":"[^"]+"/, '"traceId":"<masked>"');
}

async function postCreate(input: { readonly requestId: string; readonly name?: string }) {
  const response = await fetch(`${base}/interviews/digital`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({
      name: input.name ?? "德国储能采购决策链",
      tags: ["采购", "德国市场"],
      scope: { kind: "none", projectId: null, researchProjectId: null },
      requestId: input.requestId,
    }),
  });
  return response;
}

async function createInterview(requestId = "create-f04") {
  const response = await postCreate({ requestId });
  expect(response.status).toBe(201);
  return await response.json() as DigitalInterviewResponse;
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  provider = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", async () => {
      await providerHook?.();
      if (providerFailureStatus !== null) {
        response.writeHead(providerFailureStatus, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "simulated provider failure" } }));
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString()) as {
        messages: Array<{ role: string; content: string }>;
      };
      const context = JSON.parse(body.messages.at(-1)?.content ?? "{}") as {
        currentStep?: string;
        operation?: string;
      };
      const patch = context.operation === "generate_interview_experts"
        ? { experts: [
          { displayName: "江西足球青训教练", role: "长期观察本地青训体系与人才梯队", domains: ["青训", "人才培养"] },
          { displayName: "职业联赛运营专家", role: "分析俱乐部经营、赛事运营与商业化", domains: ["职业联赛", "体育商业"] },
          { displayName: "江西足球史研究者", role: "追踪地方足球历史、文化与政策环境", domains: ["足球史", "地方体育政策"] },
        ] }
        : context.currentStep === "topic"
        ? { topic: "建议聚焦最终否决权" }
        : context.currentStep === "experts"
          ? { expertIds: [EXPERT] }
          : context.currentStep === "questions"
            ? { questions: [] }
            : { instruction: "建议聚焦最终否决权" };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(patch) } }] }));
    });
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  process.env.KERNEL_MODEL_PROVIDER = PROVIDER;
  process.env.KERNEL_MODEL_BASE_URL = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;
  process.env.KERNEL_MODEL_API_KEY = "test-key";
  process.env.KERNEL_DIGITAL_INTERVIEW_SKILL_MODEL_ID = MODEL;
  await startApp();
}, 120_000);

afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG, OTHER_ORG);
  await db.close();
  await new Promise<void>((resolve) => provider.close(() => resolve()));
});

beforeEach(async () => {
  providerHook = null;
  providerFailureStatus = null;
  await resetOrgs(ORG, OTHER_ORG);
  const fixture = await seedOrg({ orgId: ORG, projectId: "proj-f04" });
  await addOrgMember(ORG, USER, "consultant", fixture.teams.energy!);
  const otherFixture = await seedOrg({ orgId: OTHER_ORG, projectId: "proj-f04-other" });
  await addOrgMember(OTHER_ORG, USER, "consultant", otherFixture.teams.energy!);
  await asApp(ORG, async (session) => {
    await session.query(
      `INSERT INTO agents
        (id,org_id,stable_name,name,status,creator_id,created_at,updated_at,published_version_id,
         initials,role,visibility,source,publish_state,model_id,concurrency_limit,degrade_policy)
       VALUES ($1,$2,'f04-procurement','德国采购总监','enabled',$3,now(),now(),NULL,
               'DE','采购决策','全组织可用','self','运行中',$4,2,'跟随组织级')`,
      [EXPERT, ORG, USER, MODEL],
    );
    await session.query(
      `INSERT INTO agent_versions
        (id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,
         model_provider,model_id,tool_policy,creator_id,created_at,published_at)
       VALUES ($1,$2,$3,'v1',$4,'德国采购决策专家','{}',$5,$6,'[]',$7,now(),now())`,
      [EXPERT_VERSION, ORG, EXPERT, "a".repeat(64), PROVIDER, MODEL, USER],
    );
    await session.query(
      "UPDATE agents SET published_version_id=$3 WHERE org_id=$1 AND id=$2",
      [ORG, EXPERT, EXPERT_VERSION],
    );
    await session.query(
      `INSERT INTO capability_listings(id,org_id,kind,name,scope,enabled,abbr,duty,role_label)
       VALUES ($1,$2,'agent','德国采购总监','org-wide',true,'DE','采购决策','采购总监')`,
      [EXPERT, ORG],
    );
  });
});

describe("F04 批量数字专家访谈 — HTTP 持久化验收门", () => {
  it("创建只持久化名称和标签；create replay 幂等、变更 payload 被拒绝，并在重启后恢复 scope", async () => {
    const first = await postCreate({ requestId: "create-f04" });
    expect(first.status).toBe(201);
    const firstRaw = await first.text();
    const created = JSON.parse(firstRaw) as DigitalInterviewResponse;
    expect(created).toMatchObject({
      topic: null,
      status: "topic_pending",
      version: 1,
      scope: { kind: "none", projectId: null, researchProjectId: null },
    });

    const replay = await postCreate({ requestId: "create-f04" });
    expect(replay.status).toBe(201);
    const replayRaw = await replay.text();
    expect(maskTrace(replayRaw)).toBe(maskTrace(firstRaw));

    const changedPayload = await postCreate({ requestId: "create-f04", name: "同一 key 不能创建第二场访谈" });
    expect(changedPayload.status).toBe(409);
    expect(await changedPayload.json()).toMatchObject({ reasonCode: "IDEMPOTENCY_KEY_REUSED" });

    await restartApp();
    const restored = await fetch(`${base}/interviews/digital/${created.interviewId}`, { headers: auth });
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({
      interviewId: created.interviewId,
      name: "德国储能采购决策链",
      tags: ["采购", "德国市场"],
      topic: null,
      status: "topic_pending",
      version: 1,
      scope: { kind: "none", projectId: null, researchProjectId: null },
    });
  });

  it("确认主题只产生一个新版本；同 requestId 重试幂等，而改 payload 重用 key 被拒绝", async () => {
    const created = await createInterview();
    const confirm = (topic: string) => fetch(`${base}/interviews/digital/${created.interviewId}/topic/confirm`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ topic, requestId: "confirm-topic-f04", expectedVersion: created.version }),
    });

    const first = await confirm("谁拥有储能采购的最终否决权？");
    expect(first.status).toBe(201);
    const firstRaw = await first.text();
    expect(JSON.parse(firstRaw)).toMatchObject({ status: "experts_pending", version: 2 });

    const retry = await confirm("谁拥有储能采购的最终否决权？");
    expect(retry.status).toBe(201);
    expect(maskTrace(await retry.text())).toBe(maskTrace(firstRaw));

    const changedPayload = await confirm("同一 key 不能悄悄覆盖成另一个主题");
    expect(changedPayload.status).toBe(409);
    expect(await changedPayload.json()).toMatchObject({ reasonCode: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("模型不可用时保留第一步输入并返回可重试错误，不用专家目录伪造生成结果", async () => {
    const created = await createInterview("create-model-unavailable-f04");
    providerFailureStatus = 503;

    const response = await fetch(`${base}/interviews/digital/${created.interviewId}/topic/confirm`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        topic: "江西足球的崛起",
        requestId: "confirm-topic-model-unavailable-f04",
        expectedVersion: created.version,
      }),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ reasonCode: "AI_GENERATION_UNAVAILABLE" });
    const restored = await fetch(`${base}/interviews/digital/${created.interviewId}`, { headers: auth });
    expect(await restored.json()).toMatchObject({ topic: "江西足球的崛起", version: 2, expertCandidates: [] });
  });

  it("陈旧 expectedVersion 冲突，且不会把已确认主题覆盖掉", async () => {
    const created = await createInterview();
    const first = await fetch(`${base}/interviews/digital/${created.interviewId}/topic/confirm`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ topic: "先确认的主题", requestId: "topic-current-f04", expectedVersion: 1 }),
    });
    expect(first.status).toBe(201);

    const stale = await fetch(`${base}/interviews/digital/${created.interviewId}/topic/confirm`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ topic: "不应覆盖", requestId: "topic-stale-f04", expectedVersion: 1 }),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ reasonCode: "CONCURRENT_MODIFICATION" });

    await restartApp();
    const restored = await fetch(`${base}/interviews/digital/${created.interviewId}`, { headers: auth });
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({
      topic: "先确认的主题",
      status: "experts_pending",
      version: 2,
    });
  });

  it("跨组织读取与不存在读取仅 traceId 不同，且不泄露原因或被寻址 id", async () => {
    const created = await createInterview();
    const denied = await fetch(`${base}/interviews/digital/${created.interviewId}`, { headers: otherAuth });
    const missing = await fetch(`${base}/interviews/digital/itv-f04-does-not-exist`, { headers: auth });

    expect(denied.status).toBe(404);
    expect(missing.status).toBe(404);
    const deniedRaw = await denied.text();
    const missingRaw = await missing.text();
    const maskTrace = (raw: string) => raw.replace(/"traceId":"[^"]+"/, '"traceId":"<masked>"');
    const traceOf = (raw: string) => /"traceId":"([^"]+)"/.exec(raw)?.[1];

    expect(traceOf(deniedRaw)).toBeTruthy();
    expect(traceOf(missingRaw)).toBeTruthy();
    expect(traceOf(deniedRaw)).not.toBe(traceOf(missingRaw));
    expect(maskTrace(deniedRaw)).toBe(maskTrace(missingRaw));
    for (const raw of [deniedRaw, missingRaw]) {
      expect(raw).not.toContain("reasonCode");
      expect(raw).not.toContain(created.interviewId);
      expect(raw).not.toContain("itv-f04-does-not-exist");
    }
  });

  it("显式确认推进主题、专家和问题；Skill 消息与 proposal 使用同一 aggregate version 并可重启恢复", async () => {
    const created = await createInterview("create-complete-f04");
    const topic = await fetch(`${base}/interviews/digital/${created.interviewId}/topic/confirm`, {
      method: "POST", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ topic: "德国储能采购谁有最终否决权", expectedVersion: 1, requestId: "topic-complete-f04" }),
    });
    expect(topic.status).toBe(201);
    const topicView = await topic.json() as DigitalInterviewResponse;
    expect(topicView).toMatchObject({ currentStep: "experts", version: 2 });
    expect(topicView.expertCandidates).toHaveLength(3);
    expect(topicView.expertCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ displayName: "江西足球青训教练", role: "长期观察本地青训体系与人才梯队" }),
    ]));
    expect(topicView.expertCandidates.every((expert) => expert.expertId.startsWith("itv-generated-expert"))).toBe(true);

    const experts = await fetch(`${base}/interviews/digital/${created.interviewId}/experts/confirm`, {
      method: "POST", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ expertIds: [topicView.expertCandidates[0]!.expertId], expectedVersion: 2, requestId: "experts-complete-f04" }),
    });
    expect(experts.status).toBe(201);
    const expertView = await experts.json() as DigitalInterviewResponse;
    expect(expertView).toMatchObject({ currentStep: "questions", selectedExpertIds: [topicView.expertCandidates[0]!.expertId], version: 3 });
    expect(expertView.questionCandidates).toHaveLength(3);

    const generatedQuestions = expertView.questionCandidates;
    const questions = await fetch(`${base}/interviews/digital/${created.interviewId}/questions/confirm`, {
      method: "POST", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ questions: generatedQuestions, expectedVersion: 3, requestId: "questions-complete-f04" }),
    });
    expect(questions.status).toBe(201);
    expect(await questions.json()).toMatchObject({ currentStep: "runs", questions: generatedQuestions, version: 4 });

    const message = await fetch(`${base}/interviews/digital/${created.interviewId}/skill/messages`, {
      method: "POST", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        currentStep: "runs", text: "请聚焦最终否决权",
        draftContext: { step: "runs", instruction: "按已确认问题开始执行" },
        expectedVersion: 4, requestId: "skill-message-f04",
      }),
    });
    expect(message.status).toBe(201);
    const messageView = await message.json() as DigitalInterviewResponse;
    expect(messageView).toMatchObject({ version: 5 });
    expect(messageView.skillMessages.map((item) => item.role)).toEqual(["user", "assistant"]);
    expect(messageView.skillProposals).toEqual([
      expect.objectContaining({ status: "proposed", patch: { instruction: "建议聚焦最终否决权" } }),
    ]);

    const proposalId = messageView.skillProposals[0]!.proposalId;
    const applied = await fetch(`${base}/interviews/digital/${created.interviewId}/skill/proposals/${proposalId}/apply`, {
      method: "POST", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: 5, requestId: "skill-apply-f04" }),
    });
    expect(applied.status).toBe(201);
    expect(await applied.json()).toMatchObject({
      version: 6,
      skillProposals: [expect.objectContaining({ proposalId, status: "applied_to_draft" })],
    });

    const secondMessage = await fetch(`${base}/interviews/digital/${created.interviewId}/skill/messages`, {
      method: "POST", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        currentStep: "runs", text: "这条建议请保留审计后拒绝",
        draftContext: { step: "runs", instruction: "按已确认问题开始执行" },
        expectedVersion: 6, requestId: "skill-message-reject-f04",
      }),
    });
    expect(secondMessage.status).toBe(201);
    const secondMessageView = await secondMessage.json() as DigitalInterviewResponse;
    expect(secondMessageView.version).toBe(7);
    const rejectedProposalId = secondMessageView.skillProposals.find((proposal) => proposal.status === "proposed")!.proposalId;
    const rejected = await fetch(`${base}/interviews/digital/${created.interviewId}/skill/proposals/${rejectedProposalId}/reject`, {
      method: "POST", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: 7, requestId: "skill-reject-f04" }),
    });
    expect(rejected.status).toBe(201);
    expect(await rejected.json()).toMatchObject({
      version: 8,
      skillProposals: expect.arrayContaining([
        expect.objectContaining({ proposalId: rejectedProposalId, status: "rejected" }),
      ]),
    });

    await restartApp();
    const restored = await fetch(`${base}/interviews/digital/${created.interviewId}`, { headers: auth });
    expect(restored.status).toBe(200);
    const restoredView = await restored.json() as DigitalInterviewResponse;
    expect(restoredView).toMatchObject({
      version: 8,
      selectedExpertIds: [topicView.expertCandidates[0]!.expertId],
      questions: generatedQuestions,
      skillMessages: [{ role: "user" }, { role: "assistant" }, { role: "user" }, { role: "assistant" }],
      skillProposals: expect.arrayContaining([
        expect.objectContaining({ proposalId, status: "applied_to_draft" }),
        expect.objectContaining({ proposalId: rejectedProposalId, status: "rejected" }),
      ]),
    });
    expect(restoredView).not.toHaveProperty("dirtyTopic");
    expect(restoredView).not.toHaveProperty("dirtyQuestions");
  });

  it("模型调用期间权限被撤销时拒绝 Skill 落库", async () => {
    const created = await createInterview("create-revoke-f04");
    providerHook = () => asOwner((client) =>
      client.query("DELETE FROM org_memberships WHERE org_id=$1 AND user_id=$2", [ORG, USER]),
    ).then(() => undefined);

    const response = await fetch(`${base}/interviews/digital/${created.interviewId}/skill/messages`, {
      method: "POST", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        currentStep: "topic", text: "这条消息不能落库",
        draftContext: { step: "topic", topic: "这条主题不能落库" },
        expectedVersion: 1, requestId: "skill-revoke-f04",
      }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ reasonCode: "PERMISSION_REVOKED_MIDWAY" });
    providerHook = null;

    const count = await asOwner((client) => client.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM digital_interview_skill_messages m
         JOIN digital_interview_skill_threads t ON t.org_id=m.org_id AND t.id=m.skill_thread_id
        WHERE t.org_id=$1 AND t.interview_id=$2`,
      [ORG, created.interviewId],
    ));
    expect(count.rows[0]?.count).toBe("0");
  });
});
