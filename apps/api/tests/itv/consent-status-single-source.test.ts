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

  it("「当前同意状态」事实只存在一张表里（不是访谈侧一份、项目侧再造一份）", async () => {
    const tables = await asOwner((s) =>
      s.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name LIKE '%consent%'
          ORDER BY table_name`,
      ),
    );
    // F86/#356 新增 `interview_consent_snapshots`：**不是**第二份「当前同意状态」，
    // 是完全不同的一件事——受访者签署当下、告知内容（render_params）与当时勾选的
    // 四个位的一次性快照（append-only，事后不可回溯改写，见 consent-token-ports.ts
    // `ConsentSnapshotRepository` 头部注释）。`Subject.consentStatus`（本文件其余用例
    // 断言的那个「状态」）仍然只从 `interview_consent_submissions` 派生，
    // 从未读过 `interview_consent_snapshots` 一个字节——这条断言就是把「多了一张表」
    // 与「多了一份状态事实」分开验证，不是把后者当成前者的例外放过去。
    //
    // #465 新增 `recording_consent_cells`：与上面 F86 那条**同型**——多了一张表，
    // 不是多了一份「当前同意状态」。理由逐条可核，请连同下面三条机械断言一起看：
    //
    //   · **不是同一件事**：它按 `source_ref_id`（工作坊 / 聊天线程 / 访谈**容器**）键，
    //     不按 `(interview_session_id, subject_id)` 键。`interview_consent_submissions`
    //     的两个外键硬绑 `interview_sessions` + `interview_subjects`（均 NOT NULL），
    //     结构上表达不了工作坊在场者与聊天线程参与者——这不是「懒得复用」，
    //     是复用不了。（#465 报上来时两边各自实测过一次。）
    //   · **不产生第二个状态**：`Subject.consentStatus` 仍然只从
    //     `interview_consent_submissions` 经 `deriveConsentStatus` 派生，从未读过这张表
    //     一个字节。这一条不是声明：`tests/rec/recording-consent-single-source.test.ts`
    //     从每个调用 `deriveConsentStatus` 的模块出发求 import 传递闭包，断言闭包里
    //     没有任何模块碰 `recording_consent_cells`（写成图可达性而不是同文件字符串匹配，
    //     因为「A 读表、B 调 derive」一跳就能绕开）。
    //   · **不复制授权项定义**：X-7 管的是「授权项**定义**」不得自己拆，而这张表的项
    //     来自已签核契约的 `RecordingConsentItem`；迁移里那条 `CHECK` 与该枚举的逐字
    //     对账、以及代码侧不得写死项数（曾经的 `< 3`），同样在那个文件里机械断言。
    //
    // ⚠ 2026-08-04 coord-main 就 X-7 / XC-18 的裁决（issue #465 / PR #500）只回答了
    //   「表能不能建」。**三项（recording 契约）vs 四项（本表四个布尔列）之争仍未裁**，
    //   是产品语义问题，需要人类。谁来读这段，不要把它读成那件事已经解决了。
    //
    // ⚠ 这份清单每加一项，这条门控就松一分。加第四项之前请先问：新表是不是又一个
    //   「按不同的键存同一件事」——F86 与 #465 两条都是先答完这个问题才进来的。
    expect(tables.rows.map((r) => r.table_name)).toEqual([
      "interview_consent_snapshots",
      "interview_consent_submissions",
      "recording_consent_cells",
    ]);
  });
});
