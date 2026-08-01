/**
 * F97 —— 访谈对象是**同一条记录的两个投影**（uc-6-7 R3-9, AC5）。
 *
 * 项目侧组卡按 `groupId` 取对象表；访谈侧受访者名单按 `interviewId`（经
 * `interview_session_subjects`）取同一张 `interview_subjects` 表。本文件要断言的是
 * 「两处不是两份数据」——不是各自返回对但恰好一致的值，而是**同一行**：
 * 改一处字段，两条查询路径都看见新值；且 `interview_subjects` 里这个人只有一行,
 * 不会因为存在两条投影就被写成两条记录。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addOrgMember,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";
import { FIXTURE_CONTACT_CIPHER, resetInterviews, seedInterview } from "../support/interview-db";
import { PgInterviewSubjectRepository } from "../../src/infrastructure/interview/pg-interview-subject-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { listSubjects } from "../../src/application/interview/list-subjects";
import { toOrgId } from "../../src/domain/org-id";
import { UuidDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";

process.env.KERNEL_QUIET = "1";

const ORG = "org-f97-proj";
const PROJECT = "proj-f97-a";
const CREATOR = "u-f97-creator";

const SESSION = "itv-f97-session";

let db: PgDatabase;
let repo: PgInterviewSubjectRepository;
let groupId: string;

const decisions = new UuidDecisionIdFactory();
const deps = () => ({ repo, decisions });

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgInterviewSubjectRepository(db, FIXTURE_CONTACT_CIPHER);
}, 120_000);

afterAll(async () => {
  await resetInterviews(ORG, [SESSION]);
  // `resetOrgs` 级联删除 `interview_subjects`（org_id 外键 ON DELETE CASCADE），
  // 所以本文件不需要单独的对象清理 fixture。
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

async function seedSubject(overrides: Partial<Parameters<typeof repo.create>[0]> = {}) {
  return repo.create({
    orgId: toOrgId(ORG),
    displayName: "王芳",
    roleTitle: "采购总监",
    orgName: "某物流园区",
    groupId,
    contact: "13800001111",
    sourceKind: "human",
    createdBy: CREATOR,
    ...overrides,
  });
}

describe("F97 — 访谈对象两处投影是同一条记录", () => {
  it("按 groupId 与按 interviewId 查到的是同一个 subjectId、同一份字段", async () => {
    const created = await seedSubject();
    await repo.attachToSession(toOrgId(ORG), SESSION, created.subjectId, CREATOR);

    const byGroup = await listSubjects(deps(), {
      orgId: toOrgId(ORG),
      viewerUserId: CREATOR,
      input: { groupId, interviewId: null, filters: null, cursor: null },
    });
    const byInterview = await listSubjects(deps(), {
      orgId: toOrgId(ORG),
      viewerUserId: CREATOR,
      input: { groupId: null, interviewId: SESSION, filters: null, cursor: null },
    });

    expect(byGroup.items).toHaveLength(1);
    expect(byInterview.items).toHaveLength(1);
    expect(byGroup.items[0]!.subjectId).toBe(created.subjectId);
    expect(byInterview.items[0]!.subjectId).toBe(created.subjectId);
    // 同一条记录：除了各自的过滤键之外，其它字段逐一相同。
    expect(byGroup.items[0]).toEqual(byInterview.items[0]);
  });

  it("改一处字段，两处投影同时看见新值（不是两份各自要改的数据）", async () => {
    const created = await seedSubject();
    await repo.attachToSession(toOrgId(ORG), SESSION, created.subjectId, CREATOR);

    await repo.update({
      orgId: toOrgId(ORG),
      subjectId: created.subjectId,
      displayName: "王芳（更新）",
      roleTitle: null,
      orgName: null,
      groupId,
      contact: null,
    });

    const byGroup = await listSubjects(deps(), {
      orgId: toOrgId(ORG),
      viewerUserId: CREATOR,
      input: { groupId, interviewId: null, filters: null, cursor: null },
    });
    const byInterview = await listSubjects(deps(), {
      orgId: toOrgId(ORG),
      viewerUserId: CREATOR,
      input: { groupId: null, interviewId: SESSION, filters: null, cursor: null },
    });

    expect(byGroup.items[0]!.displayName).toBe("王芳（更新）");
    expect(byInterview.items[0]!.displayName).toBe("王芳（更新）");
  });

  it("不会因为存在两条投影而在磁盘上写出两行", async () => {
    const created = await seedSubject();
    await repo.attachToSession(toOrgId(ORG), SESSION, created.subjectId, CREATOR);

    const byGroup = await repo.listByGroup(toOrgId(ORG), groupId);
    const byInterview = await repo.listByInterviewSession(toOrgId(ORG), SESSION);

    // `ref.id` 是 `Guarded<T>` 上公开的那部分（内容需要经 disclose 才能看），
    // 足够用来断言"这是同一行"而不需要在这里再走一次判定。
    expect(byGroup.map((r) => r.item.ref.id)).toEqual([created.subjectId]);
    expect(byInterview.map((r) => r.item.ref.id)).toEqual([created.subjectId]);
  });

  it("未归组的对象不出现在组卡投影里，但仍是可直读的一条记录（A1：先入表后归组）", async () => {
    const created = await seedSubject({ groupId: null });

    const byGroup = await repo.listByGroup(toOrgId(ORG), groupId);
    expect(byGroup.find((r) => r.item.ref.id === created.subjectId)).toBeUndefined();

    const direct = await repo.findGuardedById(toOrgId(ORG), created.subjectId);
    expect(direct?.item.ref.id).toBe(created.subjectId);
    expect(direct?.facts.groupId).toBeNull();
  });
});
