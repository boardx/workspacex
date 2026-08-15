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
let db: PgDatabase;
let sequence = 0;
const ids = { next: (prefix: string) => `${prefix}-persistence-${++sequence}` };
let modelCalls: Array<Parameters<ModelCallPort["complete"]>[0]> = [];
const model: ModelCallPort = { complete: async (input) => {
  modelCalls.push(input);
  const context = JSON.parse(input.user) as { currentStep: string };
  return { text: JSON.stringify(context.currentStep === "topic"
    ? { topic: "更聚焦的主题" }
    : { expertIds: [EXPERT] }) };
} };

function createRuntime() {
  const repo = new PgDigitalInterviewRepository(db);
  const effects = new PgDigitalInterviewEffects(db, ids, repo);
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
      model,
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
  sequence = 0;
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
      `INSERT INTO capability_listings(id,org_id,kind,name,scope,enabled,abbr,duty)
       VALUES ($1,$2,'agent','采购专家','org-wide',true,'PE','采购决策')`,
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
    expect(recovered.expertCandidates.map((candidate) => candidate.expertId)).toEqual([EXPERT]);
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
    expect(firstConfirmed.expertCandidates.map((item) => item.expertId)).toEqual([EXPERT]);
    expect(secondConfirmed.expertCandidates.map((item) => item.expertId)).toEqual([EXPERT]);
    await setup.checkpointer.end();
  });

  it("generates three durable questions per confirmed visible expert and branches on upstream reconfirm", async () => {
    const setup = createRuntime();
    const created = await setup.runtime.createDraft({
      orgId: ORG, actorId: USER, name: "修订链", tags: ["采购"],
      scope: { kind: "none", projectId: null, researchProjectId: null }, requestId: "create-revision",
    });
    const topic = await setup.runtime.confirmTopic({ orgId: ORG, actorId: USER, interviewId: created.interviewId,
      topic: "旧主题", expectedVersion: 1, requestId: "topic-revision-1" });
    expect(topic.expertCandidates.map((item) => item.expertId)).toEqual([EXPERT]);
    const experts = await setup.runtime.confirmExperts({ orgId: ORG, actorId: USER, interviewId: created.interviewId,
      expertIds: [EXPERT], expectedVersion: 2, requestId: "experts-revision-1" });
    expect(experts.questionCandidates).toHaveLength(3);
    expect(new Set(experts.questionCandidates.map((item) => item.expertId))).toEqual(new Set([EXPERT]));
    const editedQuestions = experts.questionCandidates.map((question, index) => index === 0
      ? { ...question, text: "用户编辑后保留的问题" }
      : question);
    const questions = await setup.runtime.confirmQuestions({
      orgId: ORG, actorId: USER, interviewId: created.interviewId,
      questions: editedQuestions, expectedVersion: 3, requestId: "questions-revision-1",
    });
    const revisedExperts = await setup.runtime.confirmExperts({
      orgId: ORG, actorId: USER, interviewId: created.interviewId,
      expertIds: [EXPERT], expectedVersion: 4, requestId: "experts-revision-2",
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
      "INSERT INTO interview_collaborators(org_id,interview_id,user_id) VALUES($1,$2,$3)",
      [ORG, created.interviewId, COLLABORATOR],
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
    expect(modelCalls[1]?.history).toEqual([
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
});
