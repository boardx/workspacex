import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDigitalInterviewDraft } from "../../src/application/interview/create-digital-interview-draft";
import { transitionDigitalInterviewStatus } from "../../src/application/interview/transition-digital-interview-status";
import { getDigitalInterview } from "../../src/application/interview/get-digital-interview";
import {
  DigitalInterviewInputInvalidError,
  DigitalInterviewStepInvalidError,
} from "../../src/application/interview/errors";
import { projectDigitalInterviewState } from "../../src/domain/interview/digital-interview";
import { PgDigitalInterviewRepository } from "../../src/infrastructure/interview/pg-digital-interview-repository";
import { PgInterviewScopeRepository } from "../../src/infrastructure/interview/pg-interview-scope-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { UuidDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";

process.env.KERNEL_QUIET = "1";

const ORG = "org-digital-interview-f01";
const PROJECT = "proj-digital-interview-f01";
const RESEARCHER = "u-digital-interview-f01";
const INTERVIEW = "itv-digital-interview-f01";

let db: PgDatabase;
let repo: PgDigitalInterviewRepository;
let scope: PgInterviewScopeRepository;
const decisions = new UuidDecisionIdFactory();

const ids = {
  next(prefix: string) {
    expect(prefix).toBe("itv");
    return INTERVIEW;
  },
};

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgDigitalInterviewRepository(db);
  scope = new PgInterviewScopeRepository(db);
}, 120_000);

afterAll(async () => {
  await resetOrgs(ORG);
  await db.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  const fixture = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, RESEARCHER, "consultant", fixture.teams.energy!);
});

async function createDraft() {
  return createDigitalInterviewDraft(
    { repo, ids },
    {
      orgId: toOrgId(ORG),
      actorId: RESEARCHER,
      scope: { kind: "none", projectId: null, researchProjectId: null },
      name: "德国采购决策链",
      tags: ["采购决策", "德国市场"],
      topic: "储能采购中谁拥有否决权",
    },
  );
}

describe("F01 — 数字专家访谈草稿与八态持久化", () => {
  it("创建只保存名称、标签和主题，状态为 draft 且没有生成专家", async () => {
    const created = await createDraft();

    expect(created).toMatchObject({
      interviewId: INTERVIEW,
      name: "德国采购决策链",
      tags: ["采购决策", "德国市场"],
      topic: "储能采购中谁拥有否决权",
      status: "draft",
      selectedExpertIds: [],
      version: 1,
    });
  });

  it("重新创建 repository 后仍能恢复草稿、状态和版本", async () => {
    await createDraft();

    const afterRefresh = await getDigitalInterview(
      { repo: new PgDigitalInterviewRepository(db), scope, decisions },
      { orgId: toOrgId(ORG), viewerUserId: RESEARCHER, interviewId: INTERVIEW },
    );
    expect(afterRefresh).toEqual({
      interviewId: INTERVIEW,
      orgId: toOrgId(ORG),
      name: "德国采购决策链",
      tags: ["采购决策", "德国市场"],
      topic: "储能采购中谁拥有否决权",
      status: "draft",
      sourceQuickInterviewId: null,
      selectedExpertIds: [],
      reportId: null,
      version: 1,
      createdBy: RESEARCHER,
    });
  });

  it("卡片、详情、当前步骤和主操作都由同一个状态投影", () => {
    expect(projectDigitalInterviewState("questions_pending")).toEqual({
      cardStatus: "questions_pending",
      detailStatus: "questions_pending",
      currentStep: "questions",
      primaryAction: "confirm_questions",
    });
  });

  it("拒绝 draft 直接跳到 running，且失败后数据库状态和版本不变", async () => {
    await createDraft();

    await expect(
      transitionDigitalInterviewStatus(
        { repo, scope, decisions },
        {
          orgId: toOrgId(ORG),
          actorId: RESEARCHER,
          interviewId: INTERVIEW,
          expectedVersion: 1,
          toStatus: "running",
        },
      ),
    ).rejects.toThrow(DigitalInterviewStepInvalidError);

    const unchanged = await getDigitalInterview(
      { repo, scope, decisions },
      { orgId: toOrgId(ORG), viewerUserId: RESEARCHER, interviewId: INTERVIEW },
    );
    expect(unchanged?.status).toBe("draft");
    expect(unchanged?.version).toBe(1);
  });

  it("合法推进会持久化新状态并把版本递增一次", async () => {
    await createDraft();

    const transitioned = await transitionDigitalInterviewStatus(
      { repo, scope, decisions },
      {
        orgId: toOrgId(ORG),
        actorId: RESEARCHER,
        interviewId: INTERVIEW,
        expectedVersion: 1,
        toStatus: "topic_pending",
      },
    );
    expect(transitioned.status).toBe("topic_pending");
    expect(transitioned.version).toBe(2);

    const restored = await getDigitalInterview(
      { repo: new PgDigitalInterviewRepository(db), scope, decisions },
      { orgId: toOrgId(ORG), viewerUserId: RESEARCHER, interviewId: INTERVIEW },
    );
    expect(restored.status).toBe("topic_pending");
    expect(restored.version).toBe(2);
  });

  it("拒绝缺少标签的草稿且不写入半成品", async () => {
    await expect(
      createDigitalInterviewDraft(
        { repo, ids },
        {
          orgId: toOrgId(ORG),
          actorId: RESEARCHER,
          scope: { kind: "none", projectId: null, researchProjectId: null },
          name: "德国采购决策链",
          tags: [],
          topic: "储能采购中谁拥有否决权",
        },
      ),
    ).rejects.toThrow(DigitalInterviewInputInvalidError);

    await expect(
      getDigitalInterview(
        { repo, scope, decisions },
        { orgId: toOrgId(ORG), viewerUserId: RESEARCHER, interviewId: INTERVIEW },
      ),
    ).rejects.toThrow(/NO_INTERVIEW_ACCESS/);
  });
});
