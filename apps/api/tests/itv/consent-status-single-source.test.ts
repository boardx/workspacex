/**
 * F97 —— `Subject.consentStatus` 是 `ConsentBits` 的**派生投影**，磁盘上不存在
 * 第二份同意书状态（domain.md I-19 / I-20，uc-6-7/V5）。
 *
 * 断言口径逐字对齐 I-20 给出的验证方法：
 * 「改访谈侧同意位 → 断言项目侧组卡状态同步变化；查表结构断言无第二列/第二表」。
 * 所以本文件既跑行为断言（改一次同意位、两处投影都变），也跑结构断言
 * （`interview_subjects` 没有状态列，同意书事实只有一张表）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addOrgMember, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { FIXTURE_CONTACT_CIPHER, resetInterviews, seedInterview } from "../support/interview-db";
import { PgInterviewSubjectRepository } from "../../src/infrastructure/interview/pg-interview-subject-repository";
import { PgConsentSubmissionStore } from "../../src/infrastructure/interview/pg-consent-submission-store";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import {
  getGroupCardSubjects,
  getInterviewRosterSubjects,
} from "../../src/application/interview/subject-projections";
import { deriveConsentStatus } from "../../src/domain/interview/subject";
import { toOrgId } from "../../src/domain/org-id";
import { UuidDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";

process.env.KERNEL_QUIET = "1";

const ORG = "org-f97-consent";
const PROJECT = "proj-f97-consent";
const CREATOR = "u-f97-consent-creator";
const SESSION = "itv-f97-consent-session";

let db: PgDatabase;
let subjects: PgInterviewSubjectRepository;
let consent: PgConsentSubmissionStore;
let groupId: string;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  subjects = new PgInterviewSubjectRepository(db, FIXTURE_CONTACT_CIPHER);
  consent = new PgConsentSubmissionStore(db);
}, 120_000);

afterAll(async () => {
  await resetInterviews(ORG, [SESSION]);
  await resetOrgs(ORG);
  await db.close();
});

beforeEach(async () => {
  await resetInterviews(ORG, [SESSION]);
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  groupId = fx.groups.g1!;
  await addOrgMember(ORG, CREATOR, "consultant", fx.teams.energy!);
  await seedInterview({ orgId: ORG, id: SESSION, createdBy: CREATOR, projectId: PROJECT });
}, 60_000);

const decisions = new UuidDecisionIdFactory();
const deps = () => ({ subjects, consent, decisions });

describe("F97 — 同意书状态单一来源", () => {
  it("尚无提交时两处投影都显示待确认（pending_consent）", async () => {
    const created = await subjects.create({
      orgId: toOrgId(ORG), displayName: "李雷", roleTitle: "运营总监", orgName: null,
      groupId, contact: null, sourceKind: "human", createdBy: CREATOR,
    });
    await subjects.attachToSession(toOrgId(ORG), SESSION, created.subjectId, CREATOR);

    const groupRows = await getGroupCardSubjects(deps(), toOrgId(ORG), CREATOR, groupId, SESSION);
    const rosterRows = await getInterviewRosterSubjects(deps(), toOrgId(ORG), CREATOR, SESSION);

    expect(groupRows.find((r) => r.subjectId === created.subjectId)?.consentStatus).toBe("pending_consent");
    expect(rosterRows.find((r) => r.subjectId === created.subjectId)?.consentStatus).toBe("pending_consent");
  });

  it("改一次访谈侧同意位，项目侧组卡状态与访谈侧名单状态同步变化", async () => {
    const created = await subjects.create({
      orgId: toOrgId(ORG), displayName: "韩梅梅", roleTitle: "采购经理", orgName: null,
      groupId, contact: null, sourceKind: "human", createdBy: CREATOR,
    });
    await subjects.attachToSession(toOrgId(ORG), SESSION, created.subjectId, CREATOR);

    await consent.submit(toOrgId(ORG), SESSION, created.subjectId, {
      record: true, transcript: true, ai_analysis: true, attribution: false,
    });

    const groupAfterGrant = await getGroupCardSubjects(deps(), toOrgId(ORG), CREATOR, groupId, SESSION);
    const rosterAfterGrant = await getInterviewRosterSubjects(deps(), toOrgId(ORG), CREATOR, SESSION);
    expect(groupAfterGrant.find((r) => r.subjectId === created.subjectId)?.consentStatus).toBe("authorized");
    expect(rosterAfterGrant.find((r) => r.subjectId === created.subjectId)?.consentStatus).toBe("authorized");

    // 再提交一次，拒绝 AI 分析（append-only：这是第二条提交，不是覆盖第一条）。
    await consent.submit(toOrgId(ORG), SESSION, created.subjectId, {
      record: true, transcript: true, ai_analysis: false, attribution: false,
    });

    const groupAfterDecline = await getGroupCardSubjects(deps(), toOrgId(ORG), CREATOR, groupId, SESSION);
    const rosterAfterDecline = await getInterviewRosterSubjects(deps(), toOrgId(ORG), CREATOR, SESSION);
    expect(groupAfterDecline.find((r) => r.subjectId === created.subjectId)?.consentStatus).toBe(
      "ai_analysis_declined",
    );
    expect(rosterAfterDecline.find((r) => r.subjectId === created.subjectId)?.consentStatus).toBe(
      "ai_analysis_declined",
    );
  });

  it("两处投影调用的是同一个派生函数，不是各自维护的判断（回归防线）", () => {
    // 若有人把其中一处投影改成读一份"缓存的状态列"而不是现算，这条测试本身
    // 不会红——但下面的结构断言会。这一条只锁 `deriveConsentStatus` 的纯函数
    // 契约本身：三态覆盖穷举，防止有人加第四个分支却没有测试跟上。
    expect(deriveConsentStatus(null)).toBe("pending_consent");
    expect(deriveConsentStatus({ record: true, transcript: true, ai_analysis: true, attribution: true })).toBe(
      "authorized",
    );
    expect(deriveConsentStatus({ record: true, transcript: true, ai_analysis: false, attribution: true })).toBe(
      "ai_analysis_declined",
    );
  });

  it("磁盘上不存在第二份同意书状态：interview_subjects 没有状态/同意相关列", async () => {
    const cols = await asOwner((s) =>
      s.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'interview_subjects'`,
      ),
    );
    const names = cols.rows.map((r) => r.column_name);
    expect(names).not.toContain("consent_status");
    expect(names).not.toContain("status");
    for (const n of names) {
      expect(n.toLowerCase()).not.toContain("consent");
    }
  });

  it("同意书事实只存在一张表里（不是访谈侧一份、项目侧再造一份）", async () => {
    const tables = await asOwner((s) =>
      s.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name LIKE '%consent%'`,
      ),
    );
    expect(tables.rows.map((r) => r.table_name)).toEqual(["interview_consent_submissions"]);
  });
});
