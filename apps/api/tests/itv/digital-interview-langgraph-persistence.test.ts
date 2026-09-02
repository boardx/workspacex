import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DigitalInterviewEffects } from "../../src/application/interview/workflow/digital-interview-effects.port";
import type { ModelCallPort } from "../../src/application/agent-run/ports";
import { PgDigitalInterviewRepository } from "../../src/infrastructure/interview/pg-digital-interview-repository";
import { PgDigitalInterviewEffects } from "../../src/infrastructure/interview/workflow/pg-digital-interview-effects";
import {
  createDigitalInterviewCheckpointer,
  LangGraphDigitalInterviewRuntime,
} from "../../src/infrastructure/interview/workflow/langgraph-digital-interview-runtime";
import { PgInterviewScopeRepository } from "../../src/infrastructure/interview/pg-interview-scope-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { UuidDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { toOrgId } from "../../src/domain/org-id";
import { addOrgMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const ORG = toOrgId("org-f04-langgraph-persistence");
const USER = "user-f04-langgraph-persistence";
const COLLABORATOR = "collaborator-f04-langgraph-persistence";
const EXPERT = "expert-f04-langgraph-persistence";
const EXPERT_VERSION = "expert-version-f04-langgraph-persistence";
let db: PgDatabase;
let sequence = 0;
let testCycle = Date.now();
const ids = { next: (prefix: string) => `${prefix}-persistence-${++sequence}` };
let modelCalls: Array<Parameters<ModelCallPort["complete"]>[0]> = [];
const model: ModelCallPort = { complete: async (input) => {
  modelCalls.push(input);
  const context = JSON.parse(input.user) as {
    currentStep?: string;
    operation?: string;
    experts?: Array<{
      expertId: string; displayName: string; occupation: string; goals: string[];
      painPoints: string[]; typicalAdvice: string;
    }>;
  };
  return { text: JSON.stringify(context.operation === "generate_interview_experts"
    ? { experts: [
      { displayName: "采购决策专家", role: "分析采购决策链", domains: ["采购"], category: "采购", bio: "研究采购决策与供应商选择。", location: "德国", typicalAdvice: "先定位最终否决权。", age: 48, occupation: "采购顾问", goals: ["优化采购"], interests: ["供应商管理"], painPoints: ["决策不透明"], motivations: ["提升质量"], influences: ["工业采购实践"], personalityTraits: { introvertExtrovert: 5, analyticalCreative: 7, busyTimeRich: 4 }, serviceValue: "采购决策咨询" },
      { displayName: "财务风控专家", role: "评估预算与财务风险", domains: ["财务", "风控"], category: "财务", bio: "研究预算约束与财务风险。", location: "欧洲", typicalAdvice: "先量化风险敞口。", age: 44, occupation: "财务风控顾问", goals: ["控制风险"], interests: ["风险模型"], painPoints: ["风险不可见"], motivations: ["提高稳健性"], influences: ["国际会计准则"], personalityTraits: { introvertExtrovert: 4, analyticalCreative: 8, busyTimeRich: 4 }, serviceValue: "财务风险评估" },
      { displayName: "交付运营专家", role: "评估实施与交付约束", domains: ["运营", "交付"], category: "运营", bio: "研究复杂项目实施与交付。", location: "中国", typicalAdvice: "先验证关键交付约束。", age: 41, occupation: "交付运营顾问", goals: ["保障交付"], interests: ["项目运营"], painPoints: ["资源冲突"], motivations: ["提高交付成功率"], influences: ["精益运营"], personalityTraits: { introvertExtrovert: 6, analyticalCreative: 6, busyTimeRich: 3 }, serviceValue: "交付约束诊断" },
    ] }
    : context.operation === "generate_interview_questions"
      ? { experts: (context.experts ?? []).map((expert) => ({
        expertId: expert.expertId,
        questions: [
          { text: `作为${expert.occupation}，您会如何实现“${expert.goals[0]}”？`, purpose: "追问专业目标" },
          { text: `针对“${expert.painPoints[0]}”，您的专业判断和解决路径是什么？`, purpose: "深挖专业痛点" },
          { text: `您提出“${expert.typicalAdvice}”的真实案例和证据是什么？`, purpose: "验证典型建议" },
        ],
      })) }
    : context.currentStep === "topic" ? { topic: "更聚焦的主题" } : { expertIds: [EXPERT] }) };
} };

function createRuntime(modelOverride: ModelCallPort = model) {
  const repo = new PgDigitalInterviewRepository(db);
  const effects = new PgDigitalInterviewEffects(db, ids, repo, modelOverride, "test-provider", "test-model");
  const checkpointer = createDigitalInterviewCheckpointer(appConfig());
  return {
    effects,
    checkpointer,
    runtime: new LangGraphDigitalInterviewRuntime({
      effects,
      checkpointer,
      repo,
      scope: new PgInterviewScopeRepository(db),
      decisions: new UuidDecisionIdFactory(),
      ids,
      model: modelOverride,
      skillModelProvider: "test-provider",
      skillModelId: "test-model",
    }),
  };
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
}, 120_000);

afterAll(async () => {
  await resetOrgs(ORG);
  await db.close();
});

beforeEach(async () => {
  // Checkpoints deliberately outlive business-row resets; keep thread IDs unique per test
  // so one case cannot resume another case's durable graph.
  sequence = ++testCycle * 1_000;
  modelCalls = [];
  await resetOrgs(ORG);
  const fixture = await seedOrg({ orgId: ORG, projectId: "project-f04-persistence" });
  await addOrgMember(ORG, USER, "consultant", fixture.teams.energy!);
  await addOrgMember(ORG, COLLABORATOR, "consultant", fixture.teams.energy!);
  await asApp(ORG, async (session) => {
    await session.query(
      `INSERT INTO agents
        (id,org_id,stable_name,name,status,creator_id,created_at,updated_at,published_version_id,
         initials,role,visibility,source,publish_state,model_id,concurrency_limit,degrade_policy)
       VALUES ($1,$2,$1,'采购专家','enabled',$3,now(),now(),NULL,
               'PE','采购决策','全组织可用','self','运行中','model-f04',2,'跟随组织级')`,
      [EXPERT, ORG, USER],
    );
    await session.query(
      `INSERT INTO agent_versions
         (id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,
          model_provider,model_id,tool_policy,creator_id,created_at,published_at)
       VALUES ($1,$2,$3,'v1',$4,'采购决策专家','{}','test-provider','model-f04','[]',$5,now(),now())`,
      [EXPERT_VERSION, ORG, EXPERT, "a".repeat(64), USER],
    );
    await session.query(
      "UPDATE agents SET published_version_id=$3 WHERE org_id=$1 AND id=$2",
      [ORG, EXPERT, EXPERT_VERSION],
    );
    await session.query(
      `INSERT INTO capability_listings(id,org_id,kind,name,scope,enabled,abbr,duty,role_label)
       VALUES ($1,$2,'agent','采购专家','org-wide',true,'PE','采购决策','采购专家')`,
      [EXPERT, ORG],
    );
  });
});

describe("F04 PostgresSaver and exactly-once business persistence", () => {
  it("recovers the same workflow after process recreation and rejects conflicting writes", async () => {
    const first = createRuntime();
    const created = await first.runtime.createDraft({
      orgId: ORG, actorId: USER, name: "采购决策", tags: ["采购"],
      scope: { kind: "none", projectId: null, researchProjectId: null }, requestId: "create-1",
    });
    const confirmed = await first.runtime.confirmTopic({
      orgId: ORG, actorId: USER, interviewId: created.interviewId,
      topic: "谁拥有否决权", expectedVersion: 1, requestId: "topic-1",
    });
    expect(confirmed).toMatchObject({ version: 2, currentStep: "experts", topicVersionId: expect.any(String) });
    expect(confirmed.selectedExpertIds).toHaveLength(3);
    expect(confirmed.selectedExpertIds.every((id) => id.startsWith("itv-generated-expert"))).toBe(true);
    expect(modelCalls.some((call) => JSON.parse(call.user).operation === "generate_interview_experts")).toBe(true);

    const replay = await first.runtime.confirmTopic({
      orgId: ORG, actorId: USER, interviewId: created.interviewId,
      topic: "谁拥有否决权", expectedVersion: 1, requestId: "topic-1",
    });
    expect(replay).toEqual(confirmed);
    await expect(first.runtime.confirmTopic({
      orgId: ORG, actorId: USER, interviewId: created.interviewId,
      topic: "换一个 payload", expectedVersion: 1, requestId: "topic-1",
    })).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    await expect(first.runtime.confirmTopic({
      orgId: ORG, actorId: USER, interviewId: created.interviewId,
      topic: "陈旧版本", expectedVersion: 1, requestId: "topic-2",
    })).rejects.toMatchObject({ code: "CONCURRENT_MODIFICATION" });

    const recreated = createRuntime();
    await expect(recreated.runtime.get({ orgId: ORG, actorId: USER, interviewId: created.interviewId }))
      .resolves.toEqual(confirmed);
    await first.checkpointer.end();
    await recreated.checkpointer.end();
  });

  it("repairs a crash after the business receipt committed but before the graph checkpoint advanced", async () => {
    const first = createRuntime();
    const created = await first.runtime.createDraft({
      orgId: ORG, actorId: USER, name: "崩溃恢复", tags: ["恢复"],
      scope: { kind: "none", projectId: null, researchProjectId: null }, requestId: "create-crash",
    });
    const command = { kind: "confirm_topic" as const, topic: "崩溃后仍然一次写入", expectedVersion: 1, requestId: "topic-crash" };
    await first.effects.commitStep({
      orgId: ORG, actorId: USER, interviewId: created.interviewId,
      revisionId: created.revisionId, revisionNumber: 1, nodeName: "confirm_topic",
      operationId: `${created.interviewId}:confirm_topic:1:topic-crash`, command,
    });

    const recreated = createRuntime();
    const recovered = await recreated.runtime.confirmTopic({
      orgId: ORG, actorId: USER, interviewId: created.interviewId,
      topic: command.topic, expectedVersion: 1, requestId: command.requestId,
    });
    expect(recovered).toMatchObject({ version: 2, topic: command.topic, currentStep: "experts" });
    expect(recovered.expertCandidates).toHaveLength(3);
    expect(recovered.expertCandidates[0]).toMatchObject({
      age: 48, occupation: "采购顾问", goals: ["优化采购"], interests: ["供应商管理"],
      painPoints: ["决策不透明"], motivations: ["提升质量"], influences: ["工业采购实践"],
      personalityTraits: { introvertExtrovert: 5, analyticalCreative: 7, busyTimeRich: 4 },
      serviceValue: "采购决策咨询",
    });
    await first.checkpointer.end();
    await recreated.checkpointer.end();
  });

  it("advances the stale interrupt after generation committed but before its graph checkpoint", async () => {
    const first = createRuntime();
    const created = await first.runtime.createDraft({
      orgId: ORG, actorId: USER, name: "生成节点崩溃恢复", tags: ["恢复"],
      scope: { kind: "none", projectId: null, researchProjectId: null }, requestId: "create-generation-crash",
    });
    const command = {
      kind: "confirm_topic" as const, topic: "生成已落库但图未推进",
      expectedVersion: 1, requestId: "topic-generation-crash",
    };
    const committed = await first.effects.commitStep({
      orgId: ORG, actorId: USER, interviewId: created.interviewId,
      revisionId: created.revisionId, revisionNumber: 1, nodeName: "confirm_topic",
      operationId: `${created.interviewId}:confirm_topic:1:${command.requestId}`, command,
    });
    await first.effects.generateExpertCandidates({
      orgId: ORG, actorId: USER, interviewId: created.interviewId,
      revisionId: committed.revisionId, revisionNumber: committed.revisionNumber,
      expectedVersion: committed.aggregateVersion, requestId: command.requestId,
      operationId: `${created.interviewId}:generate_expert_candidates:1:${command.requestId}`,
    });

    const recreated = createRuntime();
    const replay = await recreated.runtime.confirmTopic({
      orgId: ORG, actorId: USER, interviewId: created.interviewId,
      topic: command.topic, expectedVersion: command.expectedVersion, requestId: command.requestId,
    });
    const advanced = await recreated.runtime.confirmExperts({
      orgId: ORG, actorId: USER, interviewId: created.interviewId,
      expertIds: [replay.expertCandidates[0]!.expertId], addedExperts: [], expectedVersion: replay.version, requestId: "experts-after-generation-crash",
    });
    expect(advanced).toMatchObject({ currentStep: "questions", selectedExpertIds: [replay.expertCandidates[0]!.expertId], version: 3 });
    expect(advanced.questionCandidates).toHaveLength(3);
    await first.checkpointer.end();
    await recreated.checkpointer.end();
  });

  it("advances a stale terminal confirmation interrupt to END when its receipt already committed", async () => {
    const first = createRuntime();
    const created = await first.runtime.createDraft({
      orgId: ORG, actorId: USER, name: "终态确认崩溃恢复", tags: ["恢复"],
      scope: { kind: "none", projectId: null, researchProjectId: null }, requestId: "create-terminal-crash",
    });
    const topic = await first.runtime.confirmTopic({
      orgId: ORG, actorId: USER, interviewId: created.interviewId,
      topic: "终态确认后图必须结束", expectedVersion: 1, requestId: "topic-terminal-crash",
    });
    const experts = await first.runtime.confirmExperts({
      orgId: ORG, actorId: USER, interviewId: created.interviewId,
      expertIds: [topic.expertCandidates[0]!.expertId], addedExperts: [], expectedVersion: topic.version, requestId: "experts-terminal-crash",
    });
    const command = {
      kind: "confirm_questions" as const,
      questions: experts.questionCandidates,
      expectedVersion: experts.version,
      requestId: "questions-terminal-crash",
    };
    const committed = await first.effects.commitStep({
      orgId: ORG, actorId: USER, interviewId: created.interviewId,
      revisionId: experts.revisionId, revisionNumber: 1, nodeName: "confirm_questions",
      operationId: `${created.interviewId}:confirm_questions:1:${command.requestId}`,
      command,
    });

    const recreated = createRuntime();
    const replay = await recreated.runtime.confirmQuestions({
      orgId: ORG, actorId: USER, interviewId: created.interviewId,
      questions: command.questions, expectedVersion: command.expectedVersion, requestId: command.requestId,
    });
    expect(replay).toMatchObject({ currentStep: "runs", version: 4 });
    const checkpoint = await recreated.checkpointer.getTuple({
      configurable: { thread_id: created.interviewId },
    });
    expect(checkpoint?.checkpoint.channel_values).toMatchObject({
      currentStep: "runs",
      questionVersionId: committed.questionVersionId,
      aggregateVersion: 4,
    });
    await first.checkpointer.end();
    await recreated.checkpointer.end();
  });

  it("scopes the same operation/request id to each interview and returns its own workflow", async () => {
    const setup = createRuntime();
    const first = await setup.runtime.createDraft({
      orgId: ORG, actorId: USER, name: "第一场", tags: ["采购"],
      scope: { kind: "none", projectId: null, researchProjectId: null }, requestId: "create-scope-1",
    });
    const second = await setup.runtime.createDraft({
      orgId: ORG, actorId: USER, name: "第二场", tags: ["采购"],
      scope: { kind: "none", projectId: null, researchProjectId: null }, requestId: "create-scope-2",
    });
    const [firstConfirmed, secondConfirmed] = await Promise.all([
      setup.runtime.confirmTopic({ orgId: ORG, actorId: USER, interviewId: first.interviewId,
        topic: "同一主题", expectedVersion: 1, requestId: "same-topic-request" }),
      setup.runtime.confirmTopic({ orgId: ORG, actorId: USER, interviewId: second.interviewId,
        topic: "同一主题", expectedVersion: 1, requestId: "same-topic-request" }),
    ]);
    expect(firstConfirmed.interviewId).toBe(first.interviewId);
    expect(secondConfirmed.interviewId).toBe(second.interviewId);
    expect(firstConfirmed.expertCandidates).toHaveLength(3);
    expect(secondConfirmed.expertCandidates).toHaveLength(3);
    await setup.checkpointer.end();
  });

  it("generates distinct questions from each selected expert's complete Persona", async () => {
    const setup = createRuntime();
    const created = await setup.runtime.createDraft({
      orgId: ORG, actorId: USER, name: "专家针对性问题", tags: ["采购", "风控"],
      scope: { kind: "none", projectId: null, researchProjectId: null }, requestId: "create-targeted-questions",
    });
    const topic = await setup.runtime.confirmTopic({
      orgId: ORG, actorId: USER, interviewId: created.interviewId,
      topic: "如何平衡采购效率与财务风险", expectedVersion: 1, requestId: "topic-targeted-questions",
    });
    const selected = topic.expertCandidates.slice(0, 2);
    const experts = await setup.runtime.confirmExperts({
      orgId: ORG, actorId: USER, interviewId: created.interviewId,
      expertIds: selected.map((expert) => expert.expertId), addedExperts: [],
      expectedVersion: topic.version, requestId: "experts-targeted-questions",
    });

    const questionCall = modelCalls.find((call) => JSON.parse(call.user).operation === "generate_interview_questions");
    expect(questionCall).toBeDefined();
    const questionContext = JSON.parse(questionCall!.user) as { topic: string; experts: typeof selected };
    expect(questionContext.topic).toBe("如何平衡采购效率与财务风险");
    expect(questionContext.experts).toEqual(selected.map((expert) => expect.objectContaining({
      expertId: expert.expertId,
      occupation: expert.occupation,
      goals: expert.goals,
      painPoints: expert.painPoints,
      personalityTraits: expert.personalityTraits,
      serviceValue: expert.serviceValue,
    })));

    const firstQuestions = experts.questionCandidates.filter((question) => question.expertId === selected[0]!.expertId);
    const secondQuestions = experts.questionCandidates.filter((question) => question.expertId === selected[1]!.expertId);
    expect(firstQuestions).toHaveLength(3);
    expect(secondQuestions).toHaveLength(3);
    expect(firstQuestions.map((question) => question.text).join(" ")).toContain(selected[0]!.occupation);
    expect(secondQuestions.map((question) => question.text).join(" ")).toContain(selected[1]!.occupation);
    expect(firstQuestions.map((question) => question.text)).not.toEqual(secondQuestions.map((question) => question.text));
    await setup.checkpointer.end();
  });

  it("fails closed when the model does not return distinct Persona-specific question groups", async () => {
    const invalidQuestionsModel: ModelCallPort = { complete: async (input) => {
      const context = JSON.parse(input.user) as { operation?: string; experts?: Array<{ expertId: string }> };
      if (context.operation !== "generate_interview_questions") return model.complete(input);
      return { text: JSON.stringify({ experts: (context.experts ?? []).map((expert) => ({
        expertId: expert.expertId,
        questions: [
          { text: "固定问题一", purpose: "固定目的" },
          { text: "固定问题二", purpose: "固定目的" },
          { text: "固定问题三", purpose: "固定目的" },
        ],
      })) }) };
    } };
    const setup = createRuntime(invalidQuestionsModel);
    const created = await setup.runtime.createDraft({
      orgId: ORG, actorId: USER, name: "拒绝固定问题", tags: ["质量"],
      scope: { kind: "none", projectId: null, researchProjectId: null }, requestId: "create-reject-fixed",
    });
    const topic = await setup.runtime.confirmTopic({
      orgId: ORG, actorId: USER, interviewId: created.interviewId,
      topic: "拒绝跨专家固定模板", expectedVersion: 1, requestId: "topic-reject-fixed",
    });
    await expect(setup.runtime.confirmExperts({
      orgId: ORG, actorId: USER, interviewId: created.interviewId,
      expertIds: topic.expertCandidates.slice(0, 2).map((expert) => expert.expertId), addedExperts: [],
      expectedVersion: topic.version, requestId: "experts-reject-fixed",
    })).rejects.toMatchObject({ code: "AI_GENERATION_UNAVAILABLE" });
    await setup.checkpointer.end();
  });

  it("does not disclose Persona to the model for an unauthorized same-org actor", async () => {
    const setup = createRuntime();
    const created = await setup.runtime.createDraft({
      orgId: ORG, actorId: USER, name: "模型调用前鉴权", tags: ["权限"],
      scope: { kind: "none", projectId: null, researchProjectId: null }, requestId: "create-pre-model-auth",
    });
    const topic = await setup.runtime.confirmTopic({
      orgId: ORG, actorId: USER, interviewId: created.interviewId,
      topic: "无权限用户不能读取 Persona", expectedVersion: 1, requestId: "topic-pre-model-auth",
    });
    const committed = await setup.effects.commitStep({
      orgId: ORG, actorId: USER, interviewId: created.interviewId,
      revisionId: topic.revisionId, revisionNumber: 1, nodeName: "confirm_experts",
      operationId: `${created.interviewId}:confirm_experts:1:experts-pre-model-auth`,
      command: {
        kind: "confirm_experts", expertIds: [topic.expertCandidates[0]!.expertId], addedExperts: [],
        expectedVersion: topic.version, requestId: "experts-pre-model-auth",
      },
    });
    modelCalls = [];

    await expect(setup.effects.generateQuestions({
      orgId: ORG, actorId: COLLABORATOR, interviewId: created.interviewId,
      revisionId: committed.revisionId, revisionNumber: committed.revisionNumber,
      expectedVersion: committed.aggregateVersion, requestId: "experts-pre-model-auth",
      operationId: `${created.interviewId}:generate_questions:1:experts-pre-model-auth`,
    })).rejects.toMatchObject({ code: "PERMISSION_REVOKED_MIDWAY" });
    expect(modelCalls).toHaveLength(0);
    await setup.checkpointer.end();
  });

  it("rechecks permission after model generation and persists no questions when access is revoked", async () => {
    const setup = createRuntime();
    const created = await setup.runtime.createDraft({
      orgId: ORG, actorId: USER, name: "模型期间撤权", tags: ["权限"],
      scope: { kind: "none", projectId: null, researchProjectId: null }, requestId: "create-mid-model-revoke",
    });
    await asApp(ORG, (session) => session.query(
      "INSERT INTO interview_collaborators(org_id,interview_id,user_id,added_by) VALUES($1,$2,$3,$4)",
      [ORG, created.interviewId, COLLABORATOR, USER],
    ));
    const topic = await setup.runtime.confirmTopic({
      orgId: ORG, actorId: USER, interviewId: created.interviewId,
      topic: "撤权后不得落库", expectedVersion: 1, requestId: "topic-mid-model-revoke",
    });
    const committed = await setup.effects.commitStep({
      orgId: ORG, actorId: USER, interviewId: created.interviewId,
      revisionId: topic.revisionId, revisionNumber: 1, nodeName: "confirm_experts",
      operationId: `${created.interviewId}:confirm_experts:1:experts-mid-model-revoke`,
      command: {
        kind: "confirm_experts", expertIds: [topic.expertCandidates[0]!.expertId], addedExperts: [],
        expectedVersion: topic.version, requestId: "experts-mid-model-revoke",
      },
    });
    const revokeDuringQuestionGeneration: ModelCallPort = { complete: async (input) => {
      const context = JSON.parse(input.user) as { operation?: string };
      const result = await model.complete(input);
      if (context.operation === "generate_interview_questions") {
        await asOwner((client) => client.query(
          "DELETE FROM interview_collaborators WHERE org_id=$1 AND interview_id=$2 AND user_id=$3",
          [ORG, created.interviewId, COLLABORATOR],
        ));
      }
      return result;
    } };
    const guarded = createRuntime(revokeDuringQuestionGeneration);

    await expect(guarded.effects.generateQuestions({
      orgId: ORG, actorId: COLLABORATOR, interviewId: created.interviewId,
      revisionId: committed.revisionId, revisionNumber: committed.revisionNumber,
      expectedVersion: committed.aggregateVersion, requestId: "experts-mid-model-revoke",
      operationId: `${created.interviewId}:generate_questions:1:experts-mid-model-revoke`,
    })).rejects.toMatchObject({ code: "PERMISSION_REVOKED_MIDWAY" });
    const persisted = await asOwner((client) => client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM digital_interview_question_candidates WHERE org_id=$1 AND revision_id=$2",
      [ORG, committed.revisionId],
    ));
    expect(persisted.rows[0]?.count).toBe("0");
    await setup.checkpointer.end();
    await guarded.checkpointer.end();
  });

  it("generates three durable questions per confirmed visible expert and branches on upstream reconfirm", async () => {
    const setup = createRuntime();
    const created = await setup.runtime.createDraft({
      orgId: ORG, actorId: USER, name: "修订链", tags: ["采购"],
      scope: { kind: "none", projectId: null, researchProjectId: null }, requestId: "create-revision",
    });
    const topic = await setup.runtime.confirmTopic({ orgId: ORG, actorId: USER, interviewId: created.interviewId,
      topic: "旧主题", expectedVersion: 1, requestId: "topic-revision-1" });
    expect(topic.expertCandidates).toHaveLength(3);
    const generatedExpertId = topic.expertCandidates[0]!.expertId;
    expect(topic.expertCandidates[0]).toMatchObject({
      agentDefinitionId: generatedExpertId, agentVersion: generatedExpertId,
      materialContextPackId: null, materialVersion: null,
      age: 48, occupation: "采购顾问", goals: ["优化采购"], interests: ["供应商管理"],
      painPoints: ["决策不透明"], motivations: ["提升质量"], influences: ["工业采购实践"],
      personalityTraits: { introvertExtrovert: 5, analyticalCreative: 7, busyTimeRich: 4 },
      serviceValue: "采购决策咨询",
    });
    const experts = await setup.runtime.confirmExperts({ orgId: ORG, actorId: USER, interviewId: created.interviewId,
      expertIds: [generatedExpertId], addedExperts: [], expectedVersion: 2, requestId: "experts-revision-1" });
    expect(experts.questionCandidates).toHaveLength(3);
    expect(new Set(experts.questionCandidates.map((item) => item.expertId))).toEqual(new Set([generatedExpertId]));
    const snapshot = await asOwner((client) => client.query<{
      agent_definition_id: string; agent_version: string;
      material_context_pack_id: string | null; material_version: string | null;
      age: number; occupation: string; goals: string[]; interests: string[]; pain_points: string[];
      motivations: string[]; influences: string[];
      personality_traits: { introvertExtrovert: number; analyticalCreative: number; busyTimeRich: number };
      service_value: string;
    }>(
      `SELECT s.agent_definition_id,s.agent_version,s.material_context_pack_id,s.material_version,
              s.age,s.occupation,s.goals,s.interests,s.pain_points,s.motivations,s.influences,
              s.personality_traits,s.service_value
         FROM digital_interview_expert_snapshots s
         JOIN digital_interview_expert_snapshot_versions v
           ON v.org_id=s.org_id AND v.id=s.version_id
        WHERE v.org_id=$1 AND v.interview_id=$2 AND v.is_current`,
      [ORG, created.interviewId],
    ));
    expect(snapshot.rows).toEqual([{
      agent_definition_id: generatedExpertId, agent_version: generatedExpertId,
      material_context_pack_id: null, material_version: null,
      age: 48, occupation: "采购顾问", goals: ["优化采购"], interests: ["供应商管理"],
      pain_points: ["决策不透明"], motivations: ["提升质量"], influences: ["工业采购实践"],
      personality_traits: { introvertExtrovert: 5, analyticalCreative: 7, busyTimeRich: 4 },
      service_value: "采购决策咨询",
    }]);
    const editedQuestions = experts.questionCandidates.map((question, index) => index === 0
      ? { ...question, text: "用户编辑后保留的问题" }
      : question);
    const questions = await setup.runtime.confirmQuestions({
      orgId: ORG, actorId: USER, interviewId: created.interviewId,
      questions: editedQuestions, expectedVersion: 3, requestId: "questions-revision-1",
    });
    const revisedExperts = await setup.runtime.confirmExperts({
      orgId: ORG, actorId: USER, interviewId: created.interviewId,
      expertIds: [generatedExpertId], addedExperts: [], expectedVersion: 4, requestId: "experts-revision-2",
    });
    expect(revisedExperts.revisionId).not.toBe(questions.revisionId);
    expect(revisedExperts.questionCandidates).toEqual(editedQuestions);

    const revised = await setup.runtime.confirmTopic({ orgId: ORG, actorId: USER, interviewId: created.interviewId,
      topic: "新主题", expectedVersion: 5, requestId: "topic-revision-2" });
    expect(revised).toMatchObject({ topic: "新主题", version: 6, currentStep: "experts" });
    expect(revised.revisionId).not.toBe(created.revisionId);
    expect(revised.expertSnapshotVersionId).toBeNull();
    expect(revised.questionVersionId).toBeNull();
    expect(revised.questionCandidates).toEqual([]);
    await setup.checkpointer.end();
  });

  it("rechecks the current actor in the write transaction and attributes collaborator confirmations", async () => {
    const base = createRuntime();
    const created = await base.runtime.createDraft({
      orgId: ORG, actorId: USER, name: "权限竞态", tags: ["权限"],
      scope: { kind: "none", projectId: null, researchProjectId: null }, requestId: "create-permission-race",
    });
    await asApp(ORG, (session) => session.query(
      "INSERT INTO interview_collaborators(org_id,interview_id,user_id,added_by) VALUES($1,$2,$3,$4)",
      [ORG, created.interviewId, COLLABORATOR, USER],
    ));

    const original = base.effects.commitStep.bind(base.effects);
    const guardedEffects: DigitalInterviewEffects = {
      commitStep: async (input: Parameters<typeof original>[0]) => {
        await asOwner((client) => client.query(
          "DELETE FROM org_memberships WHERE org_id=$1 AND user_id=$2",
          [ORG, COLLABORATOR],
        ));
        return original(input);
      },
      createDraft: base.effects.createDraft.bind(base.effects),
      findReceipt: base.effects.findReceipt.bind(base.effects),
      appendSkillMessage: base.effects.appendSkillMessage.bind(base.effects),
      setSkillProposalStatus: base.effects.setSkillProposalStatus.bind(base.effects),
      generateExpertCandidates: base.effects.generateExpertCandidates.bind(base.effects),
      generateQuestions: base.effects.generateQuestions.bind(base.effects),
      executeInterviewRuns: base.effects.executeInterviewRuns.bind(base.effects),
    };
    const denied = new LangGraphDigitalInterviewRuntime({
      effects: guardedEffects, checkpointer: base.checkpointer,
      repo: new PgDigitalInterviewRepository(db), scope: new PgInterviewScopeRepository(db),
      decisions: new UuidDecisionIdFactory(), ids, model,
      skillModelProvider: "test-provider", skillModelId: "test-model",
    });
    await expect(denied.confirmTopic({ orgId: ORG, actorId: COLLABORATOR, interviewId: created.interviewId,
      topic: "不能落库", expectedVersion: 1, requestId: "topic-permission-race" }))
      .rejects.toMatchObject({ code: "PERMISSION_REVOKED_MIDWAY" });

    const restored = await base.runtime.get({ orgId: ORG, actorId: USER, interviewId: created.interviewId });
    expect(restored).toMatchObject({ topic: null, version: 1 });
    const fixture = await asOwner((client) => client.query<{ team_id: string }>(
      "SELECT id AS team_id FROM teams WHERE org_id=$1 ORDER BY id LIMIT 1",
      [ORG],
    ));
    await addOrgMember(ORG, COLLABORATOR, "consultant", fixture.rows[0]!.team_id);
    await base.runtime.confirmTopic({ orgId: ORG, actorId: COLLABORATOR, interviewId: created.interviewId,
      topic: "协作者确认", expectedVersion: 1, requestId: "topic-collaborator" });
    const attribution = await asOwner((client) => client.query<{ created_by: string }>(
      `SELECT created_by FROM digital_interview_topic_versions
        WHERE org_id=$1 AND interview_id=$2 AND is_current`,
      [ORG, created.interviewId],
    ));
    expect(attribution.rows[0]?.created_by).toBe(COLLABORATOR);
    await base.checkpointer.end();
  });

  it("sends confirmed workflow plus current draft to Skill and records committed then stale proposals", async () => {
    const setup = createRuntime();
    const created = await setup.runtime.createDraft({
      orgId: ORG, actorId: USER, name: "Skill 上下文", tags: ["Skill"],
      scope: { kind: "none", projectId: null, researchProjectId: null }, requestId: "create-skill-context",
    });
    const proposed = await setup.runtime.appendSkillMessage({
      orgId: ORG, actorId: USER, interviewId: created.interviewId, currentStep: "topic",
      text: "聚焦主题", draftContext: { step: "topic", topic: "页面中的未确认主题" },
      expectedVersion: 1, requestId: "skill-context-topic",
    });
    const prompt = JSON.parse(modelCalls[0]!.user) as {
      confirmedWorkflow: { name: string; topic: string | null };
      currentDraft: { step: string; topic: string };
    };
    expect(prompt).toMatchObject({
      confirmedWorkflow: { name: "Skill 上下文", topic: null },
      currentDraft: { step: "topic", topic: "页面中的未确认主题" },
    });
    const topicProposalId = proposed.skillProposals[0]!.proposalId;
    const applied = await setup.runtime.applySkillProposal({
      orgId: ORG, actorId: USER, interviewId: created.interviewId,
      proposalId: topicProposalId, expectedVersion: 2, requestId: "apply-context-topic",
    });
    const confirmed = await setup.runtime.confirmTopic({
      orgId: ORG, actorId: USER, interviewId: created.interviewId,
      topic: "更聚焦的主题", expectedVersion: applied.version, requestId: "confirm-context-topic",
    });
    expect(confirmed.skillProposals).toEqual([
      expect.objectContaining({ proposalId: topicProposalId, status: "committed", committedVersionId: confirmed.topicVersionId }),
    ]);

    const expertProposal = await setup.runtime.appendSkillMessage({
      orgId: ORG, actorId: USER, interviewId: created.interviewId, currentStep: "experts",
      text: "建议专家", draftContext: { step: "experts", expertIds: [EXPERT] },
      expectedVersion: confirmed.version, requestId: "skill-context-experts",
    });
    const expertStepSkillCall = modelCalls.find((call) => {
      const context = JSON.parse(call.user) as { currentStep?: string; request?: string };
      return context.currentStep === "experts" && context.request === "建议专家";
    });
    expect(expertStepSkillCall?.history).toEqual([
      expect.objectContaining({ role: "user", content: "聚焦主题" }),
      expect.objectContaining({ role: "assistant" }),
    ]);
    const expertProposalId = expertProposal.skillProposals.find((item) => item.status === "proposed")!.proposalId;
    const expertApplied = await setup.runtime.applySkillProposal({
      orgId: ORG, actorId: USER, interviewId: created.interviewId,
      proposalId: expertProposalId, expectedVersion: expertProposal.version, requestId: "apply-context-experts",
    });
    const revised = await setup.runtime.confirmTopic({
      orgId: ORG, actorId: USER, interviewId: created.interviewId,
      topic: "再次修订主题", expectedVersion: expertApplied.version, requestId: "reconfirm-context-topic",
    });
    expect(revised.skillProposals).toEqual(expect.arrayContaining([
      expect.objectContaining({ proposalId: topicProposalId, status: "committed" }),
      expect.objectContaining({ proposalId: expertProposalId, status: "stale" }),
    ]));
    await setup.checkpointer.end();
  });

  it("persists streamed report sections and recovers them before the model finishes", async () => {
    let releaseReport!: () => void;
    let partialPersisted!: () => void;
    const release = new Promise<void>((resolve) => { releaseReport = resolve; });
    const partial = new Promise<void>((resolve) => { partialPersisted = resolve; });
    const streamingModel: ModelCallPort = {
      complete: async (input) => {
        const context = JSON.parse(input.user) as { operation?: string; questions?: Array<{ questionId: string }> };
        if (context.operation === "generate_interview_experts" || context.operation === "generate_interview_questions") {
          return model.complete(input);
        }
        return { text: JSON.stringify({ answers: (context.questions ?? []).map((question) => ({
          questionId: question.questionId, answer: "先培养教练，再连接稳定赛事。",
        })) }) };
      },
      completeStream: async (input, onDelta) => {
        const context = JSON.parse(input.user) as { operation?: string };
        if (context.operation !== "generate_interview_report") return streamingModel.complete(input);
        const meta = '{"type":"meta","title":"江西足球报告","executiveSummary":"基层体系需要长期投入"}\n';
        const section = '{"type":"section","markdown":"## 基层体系\\n先培养教练。"}\n';
        const secondSection = '{"type":"section","markdown":"## 赛事连接\\n建立稳定赛事。"}\n';
        const source = JSON.parse(input.user) as { experts: Array<{ expertId: string; answers: Array<{ questionId: string }> }> };
        const finding = JSON.stringify({ type: "finding", title: "教练优先", summary: "建立长期教练梯队。",
          expertId: source.experts[0]!.expertId, questionId: source.experts[0]!.answers[0]!.questionId });
        await onDelta(meta);
        await onDelta(section);
        partialPersisted();
        await release;
        await onDelta(secondSection);
        await onDelta(`${finding}\n`);
        return { text: `${meta}${section}${secondSection}${finding}\n` };
      },
    };
    const setup = createRuntime(streamingModel);
    const created = await setup.runtime.createDraft({ orgId: ORG, actorId: USER, name: "流式恢复", tags: ["报告"],
      scope: { kind: "none", projectId: null, researchProjectId: null }, requestId: "create-report-stream" });
    const topic = await setup.runtime.confirmTopic({ orgId: ORG, actorId: USER, interviewId: created.interviewId,
      topic: "江西足球基层体系", expectedVersion: 1, requestId: "topic-report-stream" });
    const experts = await setup.runtime.confirmExperts({ orgId: ORG, actorId: USER, interviewId: created.interviewId,
      expertIds: [topic.expertCandidates[0]!.expertId], addedExperts: [], expectedVersion: topic.version, requestId: "experts-report-stream" });
    await setup.runtime.confirmQuestions({ orgId: ORG, actorId: USER, interviewId: created.interviewId,
      questions: experts.questionCandidates, expectedVersion: experts.version, requestId: "questions-report-stream" });
    let ready = await setup.runtime.get({ orgId: ORG, actorId: USER, interviewId: created.interviewId });
    for (let attempt = 0; attempt < 30 && ready.expertRuns.some((run) => run.status === "running"); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      ready = await setup.runtime.get({ orgId: ORG, actorId: USER, interviewId: created.interviewId });
    }
    expect(ready.expertRuns).toEqual([expect.objectContaining({ status: "completed" })]);
    const generated = setup.runtime.generateReport({ orgId: ORG, actorId: USER, interviewId: created.interviewId,
      expectedVersion: ready.version, requestId: "generate-report-stream" });
    await partial;
    const recovered = await setup.runtime.get({ orgId: ORG, actorId: USER, interviewId: created.interviewId });
    expect(recovered).toMatchObject({ status: "report_pending", report: null,
      reportGeneration: { status: "running", title: "江西足球报告", markdown: "## 基层体系\n先培养教练。" } });
    releaseReport();
    const completed = await generated;
    expect(completed).toMatchObject({ status: "completed", reportGeneration: null,
      report: { title: "江西足球报告", findings: [expect.objectContaining({ exploratory: true })] } });
    const recreated = createRuntime(streamingModel);
    await expect(recreated.runtime.get({ orgId: ORG, actorId: USER, interviewId: created.interviewId }))
      .resolves.toMatchObject({ status: "completed", report: { title: "江西足球报告" } });
    await setup.checkpointer.end();
    await recreated.checkpointer.end();
  });
});
