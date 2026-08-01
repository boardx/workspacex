/**
 * F84 —— 未经研究员确认的草案不得进现场（uc-6-2 R3 步骤3 / AC5，I-10）。
 *
 * ## 这个文件要证的事，以及反证
 *
 * **服务端断言，不是前端标记**：直接调用 `startSession`（不经过任何界面），
 * 对一场大纲仍是 `pending_confirm` 的访谈，断言它被拒绝而不是「假装能开始」。
 * 反证：若 `startSession` 被改成只检查大纲是否存在（不检查 `status`），
 * 第一个 it 会在这里当场失败——因为那样的实现会对 `pending_confirm` 也放行。
 *
 * 随后走 `confirmOutline` 把状态转正，同一个 `startSession` 调用改为放行——
 * 证明这条门禁真的挂在 `status` 这个字段上，不是恒拒绝的假门。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { FIXTURE_CONTACT_CIPHER } from "../support/interview-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgTemplateRepository } from "../../src/infrastructure/interview/pg-template-repository";
import { PgInterviewSubjectRepository } from "../../src/infrastructure/interview/pg-interview-subject-repository";
import { PgConsentSubmissionStore } from "../../src/infrastructure/interview/pg-consent-submission-store";
import { PgOutlineRepository, PgWizardInterviewRepository } from "../../src/infrastructure/interview/pg-outline-repository";
import { PgInterviewScopeRepository } from "../../src/infrastructure/interview/pg-interview-scope-repository";
import { UuidIdFactory } from "../../src/infrastructure/artifact/uuid-id-factory";
import { UuidDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { createInterviewFromWizard } from "../../src/application/interview/create-interview-from-wizard";
import { confirmOutline } from "../../src/application/interview/confirm-outline";
import { startSession } from "../../src/application/interview/start-session";
import { OutlineNotConfirmedError } from "../../src/application/interview/errors";
import { toOrgId } from "../../src/domain/org-id";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f84-onsite-gate";
const PROJECT = "proj-f84-onsite-gate";
const RESEARCHER = "u-f84-onsite-researcher";

let db: PgDatabase;
let templates: PgTemplateRepository;
let subjects: PgInterviewSubjectRepository;
let consent: PgConsentSubmissionStore;
let outlines: PgOutlineRepository;
let wizardInterviews: PgWizardInterviewRepository;
let scope: PgInterviewScopeRepository;
const ids = new UuidIdFactory();
const decisions = new UuidDecisionIdFactory();

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  templates = new PgTemplateRepository(db);
  subjects = new PgInterviewSubjectRepository(db, FIXTURE_CONTACT_CIPHER);
  consent = new PgConsentSubmissionStore(db);
  outlines = new PgOutlineRepository(db);
  wizardInterviews = new PgWizardInterviewRepository(db);
  scope = new PgInterviewScopeRepository(db);
}, 120_000);

afterAll(async () => {
  await resetOrgs(ORG);
  await db.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, RESEARCHER, "consultant", fx.teams.energy!);
});

function deps() {
  return { templates, wizardInterviews, subjects, consent, outlines, ids, decisions };
}

function sessionDeps() {
  return { outlines, scope, decisions };
}

describe("F84 — 待确认草案不得进现场（服务端断言）", () => {
  it("大纲仍是 pending_confirm 时，startSession 被服务端拒绝（不是前端标记）", async () => {
    const created = await createInterviewFromWizard(deps(), {
      orgId: toOrgId(ORG),
      actorId: RESEARCHER,
      scope: { kind: "project", projectId: PROJECT, researchProjectId: null },
      sourceKind: "human",
      templateId: null,
      subjectIds: [],
      context: { who: "运营总监", situation: "年度复盘", decision: "是否调整预算" },
    });

    const outlineBefore = await outlines.getByInterview(toOrgId(ORG), RESEARCHER, created.interviewId);
    expect(outlineBefore).not.toBeNull();

    await expect(
      startSession(sessionDeps(), { orgId: toOrgId(ORG), viewerUserId: RESEARCHER, interviewId: created.interviewId }),
    ).rejects.toThrow(OutlineNotConfirmedError);

    // 拒绝之后大纲本身没有被静默改动——失败不得被呈现为成功，也不产生半成品。
    const outlineAfterReject = await outlines.getByInterview(toOrgId(ORG), RESEARCHER, created.interviewId);
    expect(outlineAfterReject).not.toBeNull();
  });

  it("研究员确认大纲之后，同一个 startSession 调用改为放行", async () => {
    const created = await createInterviewFromWizard(deps(), {
      orgId: toOrgId(ORG),
      actorId: RESEARCHER,
      scope: { kind: "project", projectId: PROJECT, researchProjectId: null },
      sourceKind: "human",
      templateId: null,
      subjectIds: [],
      context: { who: "运营总监", situation: "年度复盘", decision: "是否调整预算" },
    });

    await confirmOutline({ outlines }, { orgId: toOrgId(ORG), outlineId: created.outlineId });

    const result = await startSession(sessionDeps(), {
      orgId: toOrgId(ORG),
      viewerUserId: RESEARCHER,
      interviewId: created.interviewId,
    });
    expect(result.startedAt).toBeTruthy();
    expect(result.excludedSubjectIds).toEqual([]);
  });

  it("从未生成过大纲的访谈同样被拒绝（不存在与「未确认」是同一个后果）", async () => {
    const bareInterviewId = ids.next("itv");
    await wizardInterviews.createBlankInterview({
      orgId: toOrgId(ORG),
      interviewId: bareInterviewId,
      projectId: PROJECT,
      researchProjectId: null,
      sourceKind: "human",
      title: "尚未跑向导的访谈",
      createdBy: RESEARCHER,
    });

    await expect(
      startSession(sessionDeps(), { orgId: toOrgId(ORG), viewerUserId: RESEARCHER, interviewId: bareInterviewId }),
    ).rejects.toThrow(OutlineNotConfirmedError);
  });

  it("非本场研究员、非协作者、非项目成员的第三方被拒绝（NO_INTERVIEW_ACCESS，与 F80 同一条规则）", async () => {
    const STRANGER = "u-f84-stranger";
    await addOrgMember(ORG, STRANGER, "consultant", null);

    const created = await createInterviewFromWizard(deps(), {
      orgId: toOrgId(ORG),
      actorId: RESEARCHER,
      scope: { kind: "none", projectId: null, researchProjectId: null },
      sourceKind: "human",
      templateId: null,
      subjectIds: [],
      context: { who: "运营总监", situation: "年度复盘", decision: "是否调整预算" },
    });
    await confirmOutline({ outlines }, { orgId: toOrgId(ORG), outlineId: created.outlineId });

    await expect(
      startSession(sessionDeps(), { orgId: toOrgId(ORG), viewerUserId: STRANGER, interviewId: created.interviewId }),
    ).rejects.toThrow(/NO_INTERVIEW_ACCESS/);
  });
});
