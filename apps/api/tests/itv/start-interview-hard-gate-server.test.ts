/**
 * F88 —— 开始访谈的硬门禁（uc-6-3 R3 步骤7 / AC2，V2）。
 *
 * ## 这个文件要证的事，以及反证
 *
 * **服务端断言，不是前端标记**：直接调用 `startSession`（不经过任何界面/禁用按钮），
 * 对一场大纲已确认、但必需受访者（主访对象）尚未提交同意的访谈，断言它被拒绝
 * （`CONSENT_REQUIRED`）而不是「假装能开始」。反证：若门禁只看大纲状态、不看同意位，
 * 第一个 it 会在这里当场失败——那样的实现会对「大纲已确认但无人授权」也放行。
 *
 * 随后走 `submitConsent`（服务端唯一写入路径，不由测试直接 INSERT）把必需受访者的
 * 同意位补齐，同一个 `startSession` 调用改为放行——证明门禁真的挂在
 * `interview_consent_submissions` 事实表上，不是恒拒绝的假门。
 *
 * ## 观察/陪同不进门禁（notes 原文）
 *
 * 第二组用例：`mode: "observation"` 的对象即使从未提交同意，也不阻断 `startSession`，
 * 只出现在 `excludedSubjectIds` 里（E5：不因一人未签而阻断全场，未授权者只是
 * 「不被录音或转写」）。同一组还断言：一旦该观察者也提交了同意，`excludedSubjectIds`
 * 里就不再有他——门禁与「谁被排除」共用同一份同意书事实，不是两套判断。
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
import { PgConsentGateReader } from "../../src/infrastructure/interview/pg-consent-gate-reader";
import { UuidIdFactory } from "../../src/infrastructure/artifact/uuid-id-factory";
import { UuidDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { createInterviewFromWizard } from "../../src/application/interview/create-interview-from-wizard";
import { confirmOutline } from "../../src/application/interview/confirm-outline";
import { startSession } from "../../src/application/interview/start-session";
import { ConsentRequiredError } from "../../src/application/interview/errors";
import { toOrgId } from "../../src/domain/org-id";
import type { ConsentBits } from "../../src/domain/interview/subject";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f88-hard-gate";
const PROJECT = "proj-f88-hard-gate";
const RESEARCHER = "u-f88-hard-gate-researcher";

let db: PgDatabase;
let templates: PgTemplateRepository;
let subjects: PgInterviewSubjectRepository;
let consent: PgConsentSubmissionStore;
let outlines: PgOutlineRepository;
let wizardInterviews: PgWizardInterviewRepository;
let scope: PgInterviewScopeRepository;
let consentGate: PgConsentGateReader;
const ids = new UuidIdFactory();
const decisions = new UuidDecisionIdFactory();

const ALL_TRUE: ConsentBits = { record: true, transcript: true, ai_analysis: true, attribution: true };
const ALL_FALSE: ConsentBits = { record: false, transcript: false, ai_analysis: false, attribution: false };

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
  consentGate = new PgConsentGateReader(db);
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
  return { outlines, scope, decisions, consentGate };
}

/** 建一个已确认大纲、带 N 个「访谈」模式必需受访者的访谈。 */
async function readyInterview(subjectCount: number) {
  const createdSubjects = await Promise.all(
    Array.from({ length: subjectCount }, (_, i) =>
      subjects.create({
        orgId: toOrgId(ORG),
        displayName: `受访者-${i + 1}`,
        roleTitle: "运营总监",
        orgName: null,
        groupId: null,
        contact: null,
        sourceKind: "human",
        mode: subjectCount > 1 ? "group_interview" : "interview",
        createdBy: RESEARCHER,
      }),
    ),
  );

  const created = await createInterviewFromWizard(deps(), {
    orgId: toOrgId(ORG),
    actorId: RESEARCHER,
    scope: { kind: "project", projectId: PROJECT, researchProjectId: null },
    sourceKind: "human",
    templateId: null,
    subjectIds: createdSubjects.map((s) => s.subjectId),
    context: { who: "运营总监", situation: "年度复盘", decision: "是否调整预算" },
  });
  await confirmOutline({ outlines }, { orgId: toOrgId(ORG), outlineId: created.outlineId });
  return { interviewId: created.interviewId, subjects: createdSubjects };
}

describe("F88 — 开始访谈的硬门禁（服务端断言，V2）", () => {
  it("必需受访者（主访对象）尚未提交同意 ⇒ CONSENT_REQUIRED，服务端拒绝", async () => {
    const { interviewId } = await readyInterview(1);

    await expect(
      startSession(sessionDeps(), { orgId: toOrgId(ORG), viewerUserId: RESEARCHER, interviewId }),
    ).rejects.toThrow(ConsentRequiredError);
  });

  it("提交同意（含[全部拒绝]）之后，同一个 startSession 调用改为放行", async () => {
    const { interviewId, subjects: rosterSubjects } = await readyInterview(1);
    const subject = rosterSubjects[0]!;

    // [全部拒绝] 也是合法完整的提交——门禁只关心「有没有提交」，不关心提交的是什么。
    await consent.submit(toOrgId(ORG), interviewId, subject.subjectId, ALL_FALSE);

    const result = await startSession(sessionDeps(), {
      orgId: toOrgId(ORG),
      viewerUserId: RESEARCHER,
      interviewId,
    });
    expect(result.startedAt).toBeTruthy();
    expect(result.excludedSubjectIds).toEqual([]);
  });

  it("多必需受访者：一人未提交即拒绝，全部提交后放行", async () => {
    const { interviewId, subjects: rosterSubjects } = await readyInterview(2);
    const [first, second] = rosterSubjects as [typeof rosterSubjects[0], typeof rosterSubjects[0]];

    await consent.submit(toOrgId(ORG), interviewId, first.subjectId, ALL_TRUE);

    // 只有一人提交——仍然拒绝,不因「大多数人已授权」放松门禁。
    const rejected = await startSession(sessionDeps(), {
      orgId: toOrgId(ORG),
      viewerUserId: RESEARCHER,
      interviewId,
    }).catch((e: unknown) => e);
    expect(rejected).toBeInstanceOf(ConsentRequiredError);
    if (rejected instanceof ConsentRequiredError) {
      expect(rejected.pendingSubjectIds).toEqual([second.subjectId]);
    }

    await consent.submit(toOrgId(ORG), interviewId, second.subjectId, ALL_TRUE);
    const result = await startSession(sessionDeps(), {
      orgId: toOrgId(ORG),
      viewerUserId: RESEARCHER,
      interviewId,
    });
    expect(result.startedAt).toBeTruthy();
  });

  it("观察/陪同（mode: observation）不进门禁——未授权也不阻断开始，只标记 excludedSubjectIds（E5）", async () => {
    const requiredSubject = await subjects.create({
      orgId: toOrgId(ORG),
      displayName: "主访对象",
      roleTitle: "运营总监",
      orgName: null,
      groupId: null,
      contact: null,
      sourceKind: "human",
      mode: "interview",
      createdBy: RESEARCHER,
    });
    const observer = await subjects.create({
      orgId: toOrgId(ORG),
      displayName: "隐藏观察员",
      roleTitle: "同事陪同",
      orgName: null,
      groupId: null,
      contact: null,
      sourceKind: "human",
      mode: "observation",
      createdBy: RESEARCHER,
    });

    const created = await createInterviewFromWizard(deps(), {
      orgId: toOrgId(ORG),
      actorId: RESEARCHER,
      scope: { kind: "project", projectId: PROJECT, researchProjectId: null },
      sourceKind: "human",
      templateId: null,
      subjectIds: [requiredSubject.subjectId, observer.subjectId],
      context: { who: "运营总监", situation: "年度复盘", decision: "是否调整预算" },
    });
    await confirmOutline({ outlines }, { orgId: toOrgId(ORG), outlineId: created.outlineId });

    // 必需受访者已提交，观察员从未提交——门禁不应阻断。
    await consent.submit(toOrgId(ORG), created.interviewId, requiredSubject.subjectId, ALL_TRUE);

    const result = await startSession(sessionDeps(), {
      orgId: toOrgId(ORG),
      viewerUserId: RESEARCHER,
      interviewId: created.interviewId,
    });
    expect(result.startedAt).toBeTruthy();
    expect(result.excludedSubjectIds).toEqual([observer.subjectId]);

    // 观察员之后也提交了——不再出现在 excludedSubjectIds 里,证明两者共用同一份事实。
    await consent.submit(toOrgId(ORG), created.interviewId, observer.subjectId, ALL_TRUE);
    const result2 = await startSession(sessionDeps(), {
      orgId: toOrgId(ORG),
      viewerUserId: RESEARCHER,
      interviewId: created.interviewId,
    });
    expect(result2.excludedSubjectIds).toEqual([]);
  });

  it("没有必需受访者的名单不阻断（真空成立），大纲检查仍然优先", async () => {
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
});
