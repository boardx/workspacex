/**
 * F960（2026-08-17 delta）—— 观察/访谈对象表读写：写入 → 读回 → 整体替换 →
 * 并发冲突 → 权限拒绝，真实 Postgres（同 `update-project-tags.test.ts` 的形状）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { updateInterviewSubjectsUseCase, UpdateInterviewSubjectsError } from "../../src/application/templates/update-interview-subjects";
import { getInterviewSubjectsUseCase, GetInterviewSubjectsError } from "../../src/application/templates/get-interview-subjects";
import { PgInterviewSubjectsRepository } from "../../src/infrastructure/templates/pg-interview-subjects-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import type { InterviewSubjectRow } from "../../src/domain/templates/interview-subject";
import { addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const ORG = "f960-itv-org";
const PROJECT = "f960-p1";
const GROUP = "f960-g1";
const FACILITATOR = "u-f960-facilitator";
const MEMBER = "u-f960-member";
const HOOK_TIMEOUT_MS = 120_000;

let db: PgDatabase;
let repo: PgInterviewSubjectsRepository;

function subjectRow(overrides: Partial<InterviewSubjectRow> = {}): InterviewSubjectRow {
  return {
    subjectId: "s-1",
    name: "Dr. Weber",
    role: "运营总监",
    contact: "+49 ···",
    focus: "痛点与付费意愿",
    method: "远程视频",
    status: "待预约",
    ...overrides,
  };
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgInterviewSubjectsRepository(db);
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG);
  await db?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: "unused-seed-project" });
  await asApp(ORG, (c) => c.query("DELETE FROM projects WHERE id = 'unused-seed-project'"));

  await asApp(ORG, (c) =>
    c.query("INSERT INTO projects (id, org_id, name, status, kind) VALUES ($1,$2,$3,'active','workshop')", [
      PROJECT, ORG, "F960 项目",
    ]),
  );
  await asApp(ORG, (c) => c.query("INSERT INTO workshops (id, org_id) VALUES ($1,$2)", [PROJECT, ORG]));
  await asApp(ORG, (c) =>
    c.query("INSERT INTO groups (id, org_id, project_id, name) VALUES ($1,$2,$3,$4)", [GROUP, ORG, PROJECT, "A 组"]),
  );

  await addOrgMember(ORG, FACILITATOR, "lead", null);
  await addOrgMember(ORG, MEMBER, "consultant", null);
  await addProjectMember(ORG, PROJECT, FACILITATOR, "facilitator", GROUP);
  await addProjectMember(ORG, PROJECT, MEMBER, "member", GROUP);
}, HOOK_TIMEOUT_MS);

describe("F960 updateInterviewSubjects / getInterviewSubjects", () => {
  it("从未填写过 ⇒ 读回真实空态，不是错误", async () => {
    const out = await getInterviewSubjectsUseCase(
      { repo },
      { orgId: toOrgId(ORG), projectId: PROJECT, groupId: GROUP, actorProjectRole: "facilitator" },
    );
    expect(out).toEqual({ subjects: [], revision: "0" });
  });

  it("facilitator 写入后，读回同一批数据与推进后的 revision", async () => {
    const subjects = [subjectRow({ subjectId: "s-1" }), subjectRow({ subjectId: "s-2", name: "李工" })];

    const written = await updateInterviewSubjectsUseCase(
      { repo },
      { orgId: toOrgId(ORG), projectId: PROJECT, groupId: GROUP, actorProjectRole: "facilitator", subjects, expectedRevision: "0" },
    );
    expect(written.subjects).toEqual(subjects);
    expect(written.revision).toBe("1");

    const read = await getInterviewSubjectsUseCase(
      { repo },
      { orgId: toOrgId(ORG), projectId: PROJECT, groupId: GROUP, actorProjectRole: "member" },
    );
    expect(read.subjects).toEqual(subjects);
    expect(read.revision).toBe("1");
  });

  it("整体替换：第二次写入把第一次的集合整体换掉，不是增量合并", async () => {
    await updateInterviewSubjectsUseCase(
      { repo },
      {
        orgId: toOrgId(ORG), projectId: PROJECT, groupId: GROUP, actorProjectRole: "facilitator",
        subjects: [subjectRow({ subjectId: "s-1" })], expectedRevision: "0",
      },
    );
    const second = await updateInterviewSubjectsUseCase(
      { repo },
      {
        orgId: toOrgId(ORG), projectId: PROJECT, groupId: GROUP, actorProjectRole: "facilitator",
        subjects: [subjectRow({ subjectId: "s-2", name: "换人了" })], expectedRevision: "1",
      },
    );
    expect(second.subjects).toEqual([subjectRow({ subjectId: "s-2", name: "换人了" })]);

    const read = await getInterviewSubjectsUseCase(
      { repo },
      { orgId: toOrgId(ORG), projectId: PROJECT, groupId: GROUP, actorProjectRole: "member" },
    );
    expect(read.subjects.map((s) => s.subjectId)).toEqual(["s-2"]);
  });

  it("并发冲突 ⇒ VERSION_CHANGED，不覆盖已有数据", async () => {
    await updateInterviewSubjectsUseCase(
      { repo },
      {
        orgId: toOrgId(ORG), projectId: PROJECT, groupId: GROUP, actorProjectRole: "facilitator",
        subjects: [subjectRow({ subjectId: "s-1" })], expectedRevision: "0",
      },
    );

    await expect(
      updateInterviewSubjectsUseCase(
        { repo },
        {
          orgId: toOrgId(ORG), projectId: PROJECT, groupId: GROUP, actorProjectRole: "facilitator",
          subjects: [subjectRow({ subjectId: "s-stale" })], expectedRevision: "0",
        },
      ),
    ).rejects.toMatchObject(new UpdateInterviewSubjectsError("VERSION_CHANGED"));

    const read = await getInterviewSubjectsUseCase(
      { repo },
      { orgId: toOrgId(ORG), projectId: PROJECT, groupId: GROUP, actorProjectRole: "facilitator" },
    );
    expect(read.subjects.map((s) => s.subjectId)).toEqual(["s-1"]);
  });

  it("member/observer 写不了 ⇒ ROLE_INSUFFICIENT（角色门槛在用例层，本测试只确认仓储没被越权触达）", async () => {
    await expect(
      updateInterviewSubjectsUseCase(
        { repo },
        {
          orgId: toOrgId(ORG), projectId: PROJECT, groupId: GROUP, actorProjectRole: "member",
          subjects: [subjectRow()], expectedRevision: "0",
        },
      ),
    ).rejects.toMatchObject(new UpdateInterviewSubjectsError("ROLE_INSUFFICIENT"));

    const read = await getInterviewSubjectsUseCase(
      { repo },
      { orgId: toOrgId(ORG), projectId: PROJECT, groupId: GROUP, actorProjectRole: "facilitator" },
    );
    expect(read.subjects).toEqual([]);
  });

  it("无项目角色 ⇒ 读写都是 NO_PROJECT_ROLE", async () => {
    await expect(
      getInterviewSubjectsUseCase({ repo }, { orgId: toOrgId(ORG), projectId: PROJECT, groupId: GROUP, actorProjectRole: null }),
    ).rejects.toMatchObject(new GetInterviewSubjectsError("NO_PROJECT_ROLE"));

    await expect(
      updateInterviewSubjectsUseCase(
        { repo },
        { orgId: toOrgId(ORG), projectId: PROJECT, groupId: GROUP, actorProjectRole: null, subjects: [], expectedRevision: "0" },
      ),
    ).rejects.toMatchObject(new UpdateInterviewSubjectsError("NO_PROJECT_ROLE"));
  });

  it("两个不同的组各自独立的 revision 与数据", async () => {
    const otherGroup = "f960-g2";
    await asApp(ORG, (c) =>
      c.query("INSERT INTO groups (id, org_id, project_id, name) VALUES ($1,$2,$3,$4)", [otherGroup, ORG, PROJECT, "B 组"]),
    );

    await updateInterviewSubjectsUseCase(
      { repo },
      {
        orgId: toOrgId(ORG), projectId: PROJECT, groupId: GROUP, actorProjectRole: "facilitator",
        subjects: [subjectRow({ subjectId: "s-1" })], expectedRevision: "0",
      },
    );

    const otherGroupRead = await getInterviewSubjectsUseCase(
      { repo },
      { orgId: toOrgId(ORG), projectId: PROJECT, groupId: otherGroup, actorProjectRole: "facilitator" },
    );
    expect(otherGroupRead).toEqual({ subjects: [], revision: "0" });
  });
});
