import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const ORG = toOrgId("org-f04-langgraph-persistence");
const USER = "user-f04-langgraph-persistence";
let db: PgDatabase;
let sequence = 0;
const ids = { next: (prefix: string) => `${prefix}-persistence-${++sequence}` };
const model = { complete: async () => ({ text: JSON.stringify({ topic: "更聚焦的主题" }) }) };

function createRuntime() {
  const repo = new PgDigitalInterviewRepository(db);
  const effects = new PgDigitalInterviewEffects(db, ids);
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
  await resetOrgs(ORG);
  const fixture = await seedOrg({ orgId: ORG, projectId: "project-f04-persistence" });
  await addOrgMember(ORG, USER, "consultant", fixture.teams.energy!);
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
    await first.checkpointer.end();
    await recreated.checkpointer.end();
  });
});
