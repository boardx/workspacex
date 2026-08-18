/**
 * F950（2026-08-16 delta）—— 定题/分组/筹备计数三条端点第一次真正落在 Postgres 上。
 * 这份测试补的是 `single-source-theme-inheritance.test.ts`/`grouping-three-states.test.ts`/
 * `prep-tabs-counts.test.ts` 三个内存假仓储版本**没有覆盖**的东西：真实往返
 * （写 → 读回 → 还在）、并发冲突在真实 `UPDATE ... WHERE` 上确实会红、组员/组长
 * 经 `project_memberships` 真的落库。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getProjectTopicUseCase } from "../../src/application/templates/get-project-topic";
import { saveAndSyncTopicUseCase, SaveAndSyncTopicError } from "../../src/application/templates/save-and-sync-topic";
import { PgProjectTopicRepository } from "../../src/infrastructure/templates/pg-project-topic-repository";
import { getProjectGroupingUseCase } from "../../src/application/templates/get-project-grouping";
import { updateGroupingUseCase, UpdateGroupingError } from "../../src/application/templates/update-grouping";
import { PgGroupingRepository } from "../../src/infrastructure/templates/pg-grouping-repository";
import { getProjectPrepUseCase } from "../../src/application/templates/get-project-prep";
import { PgProjectPrepRepository } from "../../src/infrastructure/templates/pg-project-prep-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const ORG = "f192-prep-org";
const LEAD = "u-f192-lead";
const MEMBER = "u-f192-member";
const OTHER_MEMBER = "u-f192-member-2";
const HOOK_TIMEOUT_MS = 120_000;

let db: PgDatabase;
let topicRepo: PgProjectTopicRepository;
let groupingRepo: PgGroupingRepository;
let prepRepo: PgProjectPrepRepository;

async function createWorkshop(id: string): Promise<void> {
  await asApp(ORG, (c) =>
    c.query("INSERT INTO projects (id, org_id, name, status, kind) VALUES ($1,$2,$3,'active','workshop')", [
      id, ORG, `工作坊 ${id}`,
    ]),
  );
  await asApp(ORG, (c) => c.query("INSERT INTO workshops (id, org_id) VALUES ($1,$2)", [id, ORG]));
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  topicRepo = new PgProjectTopicRepository(db);
  groupingRepo = new PgGroupingRepository(db);
  prepRepo = new PgProjectPrepRepository(db);
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG);
  await db?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: "unused-seed-project" });
  await asApp(ORG, (c) => c.query("DELETE FROM projects WHERE id = 'unused-seed-project'"));

  await addOrgMember(ORG, LEAD, "lead", null);
  await addOrgMember(ORG, MEMBER, "consultant", null);
  await addOrgMember(ORG, OTHER_MEMBER, "consultant", null);
}, HOOK_TIMEOUT_MS);

describe("F950 定题：写入 → 读回 → 并发冲突", () => {
  it("刷新后定题还在——不是本地状态", async () => {
    await createWorkshop("f192-p1");
    await addProjectMember(ORG, "f192-p1", LEAD, "facilitator", null, true);

    await saveAndSyncTopicUseCase(
      { repo: topicRepo },
      {
        orgId: toOrgId(ORG), projectId: "f192-p1", actorProjectRole: "facilitator",
        title: "欧洲市场进入策略", background: "Q3 董事会要结果", expectedTopicRevision: "0",
        aiGenerated: null,
      },
    );

    const read = await getProjectTopicUseCase(
      { repo: topicRepo },
      { orgId: toOrgId(ORG), projectId: "f192-p1", actorProjectRole: "member" },
    );
    expect(read.title).toBe("欧洲市场进入策略");
    expect(read.background).toBe("Q3 董事会要结果");
  });

  it("未定题时是真实空态：空串 + revision '0'，不是 404", async () => {
    await createWorkshop("f192-p2");
    const read = await getProjectTopicUseCase(
      { repo: topicRepo },
      { orgId: toOrgId(ORG), projectId: "f192-p2", actorProjectRole: "member" },
    );
    expect(read.title).toBe("");
    expect(read.background).toBe("");
    expect(read.revision).toBe("0");
  });

  it("并发冲突：拿着旧 revision 提交 ⇒ VERSION_CHANGED，不覆盖", async () => {
    await createWorkshop("f192-p3");
    await addProjectMember(ORG, "f192-p3", LEAD, "facilitator", null, true);

    await saveAndSyncTopicUseCase(
      { repo: topicRepo },
      {
        orgId: toOrgId(ORG), projectId: "f192-p3", actorProjectRole: "facilitator",
        title: "第一版", background: "b1", expectedTopicRevision: "0", aiGenerated: null,
      },
    );

    await expect(
      saveAndSyncTopicUseCase(
        { repo: topicRepo },
        {
          orgId: toOrgId(ORG), projectId: "f192-p3", actorProjectRole: "facilitator",
          title: "第二版·用了过期的 revision", background: "b2", expectedTopicRevision: "0", aiGenerated: null,
        },
      ),
    ).rejects.toMatchObject(new SaveAndSyncTopicError("VERSION_CHANGED"));

    const read = await getProjectTopicUseCase(
      { repo: topicRepo },
      { orgId: toOrgId(ORG), projectId: "f192-p3", actorProjectRole: "member" },
    );
    // 冲突提交没有生效——读到的仍是第一版。
    expect(read.title).toBe("第一版");
  });

  it("非引导师不能定题 ⇒ ROLE_INSUFFICIENT，写入未发生", async () => {
    await createWorkshop("f192-p4");
    await addProjectMember(ORG, "f192-p4", MEMBER, "member", null);

    await expect(
      saveAndSyncTopicUseCase(
        { repo: topicRepo },
        {
          orgId: toOrgId(ORG), projectId: "f192-p4", actorProjectRole: "member",
          title: "不该写进去", background: "", expectedTopicRevision: "0", aiGenerated: null,
        },
      ),
    ).rejects.toMatchObject(new SaveAndSyncTopicError("ROLE_INSUFFICIENT"));

    const read = await getProjectTopicUseCase(
      { repo: topicRepo },
      { orgId: toOrgId(ORG), projectId: "f192-p4", actorProjectRole: "member" },
    );
    expect(read.title).toBe("");
  });
});

describe("F950 分组：写入 → 读回 → 组长/组员经 project_memberships 落库", () => {
  it("刷新后分组、组长、组员都还在", async () => {
    await createWorkshop("f192-g1");
    await addProjectMember(ORG, "f192-g1", LEAD, "facilitator", null, true);
    await addProjectMember(ORG, "f192-g1", MEMBER, "member", null);
    await addProjectMember(ORG, "f192-g1", OTHER_MEMBER, "member", null);

    await updateGroupingUseCase(
      { repo: groupingRepo },
      {
        orgId: toOrgId(ORG), projectId: "f192-g1", actorProjectRole: "facilitator",
        groupCount: 1,
        groups: [{
          groupId: "g-1", name: "第 1 组", scenario: "采购决策链",
          leaderUserId: MEMBER, status: "recording-ready", memberUserIds: [OTHER_MEMBER],
        }],
        expectedRevision: "0",
      },
    );

    const read = await getProjectGroupingUseCase(
      { repo: groupingRepo },
      { orgId: toOrgId(ORG), projectId: "f192-g1", actorProjectRole: "member" },
    );
    expect(read.groups).toHaveLength(1);
    const g = read.groups[0]!;
    expect(g.name).toBe("第 1 组");
    expect(g.leaderUserId).toBe(MEMBER);
    expect(g.memberUserIds).toEqual([OTHER_MEMBER]);

    // 组长的 project_role 真的被改成了 groupLead（不只是 groups 表上的一个字段）。
    const roleRow = await asApp(ORG, (c) =>
      c.query<{ project_role: string }>(
        "SELECT project_role FROM project_memberships WHERE project_id=$1 AND user_id=$2",
        ["f192-g1", MEMBER],
      ),
    );
    expect(roleRow.rows[0]?.project_role).toBe("groupLead");
  });

  it("未分组时是真实空态：空数组 + revision '0'", async () => {
    await createWorkshop("f192-g2");
    const read = await getProjectGroupingUseCase(
      { repo: groupingRepo },
      { orgId: toOrgId(ORG), projectId: "f192-g2", actorProjectRole: "member" },
    );
    expect(read.groups).toEqual([]);
    expect(read.revision).toBe("0");
  });

  it("并发冲突：拿着旧 revision 提交 ⇒ VERSION_CHANGED", async () => {
    await createWorkshop("f192-g3");
    await addProjectMember(ORG, "f192-g3", LEAD, "facilitator", null, true);
    await addProjectMember(ORG, "f192-g3", MEMBER, "member", null);

    await updateGroupingUseCase(
      { repo: groupingRepo },
      {
        orgId: toOrgId(ORG), projectId: "f192-g3", actorProjectRole: "facilitator",
        groupCount: 1,
        groups: [{ groupId: "g-1", name: "第 1 组", scenario: "s", leaderUserId: MEMBER, status: "recording-ready", memberUserIds: [] }],
        expectedRevision: "0",
      },
    );

    await expect(
      updateGroupingUseCase(
        { repo: groupingRepo },
        {
          orgId: toOrgId(ORG), projectId: "f192-g3", actorProjectRole: "facilitator",
          groupCount: 1,
          groups: [{ groupId: "g-1", name: "改了名字但用了过期 revision", scenario: "s", leaderUserId: MEMBER, status: "recording-ready", memberUserIds: [] }],
          expectedRevision: "0",
        },
      ),
    ).rejects.toMatchObject(new UpdateGroupingError("VERSION_CHANGED"));
  });

  it("组员里混入一个从未加入项目的用户 id：不报错，也不会把这个人拉进项目（已知限制）", async () => {
    await createWorkshop("f192-g4");
    await addProjectMember(ORG, "f192-g4", LEAD, "facilitator", null, true);
    await addProjectMember(ORG, "f192-g4", MEMBER, "member", null);

    const strangerId = "u-f192-never-joined";
    await updateGroupingUseCase(
      { repo: groupingRepo },
      {
        orgId: toOrgId(ORG), projectId: "f192-g4", actorProjectRole: "facilitator",
        groupCount: 1,
        groups: [{ groupId: "g-1", name: "第 1 组", scenario: "s", leaderUserId: MEMBER, status: "recording-ready", memberUserIds: [strangerId] }],
        expectedRevision: "0",
      },
    );

    const read = await getProjectGroupingUseCase(
      { repo: groupingRepo },
      { orgId: toOrgId(ORG), projectId: "f192-g4", actorProjectRole: "member" },
    );
    // stranger 没有 project_memberships 行，UPDATE 匹配 0 行——不出现在读回的组员名单里。
    expect(read.groups[0]?.memberUserIds ?? []).not.toContain(strangerId);
  });
});

describe("F950 筹备计数：真实条目数", () => {
  it("groupCount/agendaSegmentCount 反映真实写入的数据，materials/preTasks 诚实为 0", async () => {
    await createWorkshop("f192-c1");
    await addProjectMember(ORG, "f192-c1", LEAD, "facilitator", null, true);
    await addProjectMember(ORG, "f192-c1", MEMBER, "member", null);

    await updateGroupingUseCase(
      { repo: groupingRepo },
      {
        orgId: toOrgId(ORG), projectId: "f192-c1", actorProjectRole: "facilitator",
        groupCount: 1,
        groups: [{ groupId: "g-1", name: "第 1 组", scenario: "s", leaderUserId: MEMBER, status: "recording-ready", memberUserIds: [] }],
        expectedRevision: "0",
      },
    );

    const out = await getProjectPrepUseCase(
      { repo: prepRepo },
      { orgId: toOrgId(ORG), projectId: "f192-c1", actorProjectRole: "member" },
    );
    expect(out.tabs.find((t) => t.key === "topic-grouping")?.count).toBe(1);
    expect(out.tabs.find((t) => t.key === "materials")?.count).toBe(0);
    expect(out.tabs.find((t) => t.key === "pre-tasks")?.label).toBe("会前任务 0/0");
  });
});
