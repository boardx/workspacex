/**
 * F123 -- UC-P3 `getProjectOverview`: **白名单四件**是封闭的，且分层无权限可区分。
 *
 * ⚠ 需要真实 Postgres（`ensureDatabase` / `migrateOnce`）。本仓纪律（issue #74）：
 *   本地不跑这类测试，只跑 `pnpm --filter api run typecheck`；CI / `harness verify`
 *   跑真正的执行。
 *
 * ## 为什么白名单断言是「集合相等」，不是「字段存在」
 *
 * `expect(result.backflow).toBeDefined()` 这类断言只钉住「至少有这些」，挡不住
 * 「多出第五个板块」——而契约文件头逐字：「加第五件属修订已签核裁决，不是补一个板块」。
 * 这里改用**集合相等**（`Object.keys(...).sort()` 与期望清单逐一比对），并且反向断言
 * 契约的 `.strict()` 会**拒绝**一个多出字段（`readiness` 之类）的响应体——
 * 缺了反向断言，「集合相等」这句话本身也可能是空转的（同一份纪律见 AGENTS.md 备忘）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { project as C } from "@repo/contracts";
import { getProjectOverview } from "../../src/application/project/get-project-overview";
import { PgProjectOverviewRepository } from "../../src/infrastructure/project/pg-project-overview-repository";
import { toOrgId } from "../../src/domain/org-id";
import { makeHarness, seedArtifact, type Harness } from "../support/binding-fixture";
import { bindToProjectStep } from "../../src/application/artifact/bind-to-project-step";
import {
  addOrgMember,
  addProjectMember,
  asApp,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedAgendaSegment,
  seedOrg,
} from "../support/db";

const ORG = "org-f123-overview";
const WORKSHOP = "proj-f123-overview-ws";
const RESEARCH = "proj-f123-overview-research";
const LEAD = "u-f123-lead";
const FACILITATOR = "u-f123-facilitator";
const GROUP_LEAD = "u-f123-grouplead";
const MEMBER_1 = "u-f123-member-1";
const MEMBER_2 = "u-f123-member-2";
const OBSERVER = "u-f123-observer";
const ORG_ADMIN_NO_ROLE = "u-f123-admin-no-role";
const CONSULTANT_NO_ROLE = "u-f123-consultant-no-role";

let h: Harness;
let overviewRepo: PgProjectOverviewRepository;

const org = () => toOrgId(ORG);

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  h = await makeHarness("f123-overview");
  overviewRepo = new PgProjectOverviewRepository(h.db);
}, 120_000);

afterAll(async () => {
  await resetOrgs(ORG);
  await h?.close();
}, 120_000);

async function activateSegment(segmentId: string): Promise<void> {
  await asApp(ORG, (c) =>
    c.query("UPDATE agenda_segments SET state = 'active' WHERE id = $1", [segmentId]),
  );
}

const overviewOf = (userId: string, projectId: string) =>
  getProjectOverview(
    { repo: overviewRepo, auth: h.deps.auth, binding: h.deps },
    { userId, orgId: org(), projectId },
  );

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: WORKSHOP });
  await asApp(ORG, (c) =>
    c.query("INSERT INTO projects (id, org_id, name, kind) VALUES ($1,$2,$3,'research_project')", [
      RESEARCH, ORG, "a research project",
    ]),
  );
  await asApp(ORG, (c) =>
    c.query("INSERT INTO research_projects (id, org_id) VALUES ($1,$2)", [RESEARCH, ORG]),
  );

  await addOrgMember(ORG, LEAD, "lead", null);
  await addOrgMember(ORG, ORG_ADMIN_NO_ROLE, "admin", null);
  await addOrgMember(ORG, CONSULTANT_NO_ROLE, "consultant", null);
  await addProjectMember(ORG, WORKSHOP, FACILITATOR, "facilitator", null, true);
  await addProjectMember(ORG, WORKSHOP, GROUP_LEAD, "groupLead", null);
  await addProjectMember(ORG, WORKSHOP, MEMBER_1, "member", null);
  await addProjectMember(ORG, WORKSHOP, MEMBER_2, "member", null);
  await addProjectMember(ORG, WORKSHOP, OBSERVER, "observer", null);
});

describe("白名单四件是封闭集合，不多不少", () => {
  it("响应体的键集合恰好等于契约允许的集合", async () => {
    await seedAgendaSegment(ORG, WORKSHOP, "f123-seg-active");
    await activateSegment("f123-seg-active");

    const out = await overviewOf(FACILITATOR, WORKSHOP);

    // 反证「不多」：与期望键集合做**集合相等**，不是子集/存在性检查。
    expect(Object.keys(out).sort()).toEqual(
      [
        "projectId", "name", "kind", "status",
        "currentAgendaSegment", "roleCounts", "backflow", "blueprint",
      ].sort(),
    );

    const parsed = C.operations.getProjectOverview.out.safeParse(out);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(out)).toBeNull();

    // 反证「加了第五件也全绿」：契约是 `.strict()`，一个多出字段的响应体必须被拒绝——
    // 缺了这一条，上面的键集合比对可能只是巧合。
    const withExtraField = { ...out, readiness: 0.42 };
    expect(C.operations.getProjectOverview.out.safeParse(withExtraField).success).toBe(false);
  });

  it("非工作坊容器：当前议程环节与角色人数恒为 null，不是缺字段", async () => {
    await addOrgMember(ORG, "u-f123-research-owner", "lead", null);
    const out = await overviewOf(LEAD, RESEARCH);
    expect(out.currentAgendaSegment).toBeNull();
    expect(out.roleCounts).toBeNull();
    expect(out.kind).toBe("research_project");
    // 键集合与工作坊一致——「不适用」不是「省略字段」。
    expect(Object.keys(out).sort()).toEqual(
      [
        "projectId", "name", "kind", "status",
        "currentAgendaSegment", "roleCounts", "backflow", "blueprint",
      ].sort(),
    );
  });
});

describe("四类项目角色人数：分组计数，不是「存在与否」", () => {
  it("每一类的人数各自独立，且没有成员的类目仍是 0 不是缺省", async () => {
    const out = await overviewOf(FACILITATOR, WORKSHOP);
    expect(out.roleCounts).toEqual({ facilitator: 1, groupLead: 1, member: 2, observer: 1 });
  });
});

describe("当前议程环节：唯一 active 驱动源，没有 active 时是 null 不是抛错", () => {
  it("没有任何议程环节：null，不是失败", async () => {
    const out = await overviewOf(FACILITATOR, WORKSHOP);
    expect(out.currentAgendaSegment).toBeNull();
  });

  it("有一条 active：整条环节的字段都能拿到", async () => {
    await seedAgendaSegment(ORG, WORKSHOP, "f123-seg-a");
    await seedAgendaSegment(ORG, WORKSHOP, "f123-seg-b");
    await activateSegment("f123-seg-b");

    const out = await overviewOf(FACILITATOR, WORKSHOP);
    expect(out.currentAgendaSegment?.id).toBe("f123-seg-b");
    expect(out.currentAgendaSegment?.state).toBe("active");
    // 反证：不是随手挑第一条——另一条 pending 的不会被当成「当前」。
    expect(out.currentAgendaSegment?.id).not.toBe("f123-seg-a");
  });
});

describe("回流列表：项目侧投影，复用 F06 的既有判据（本 feature 不重新建模）", () => {
  it("已定版的产出出现在概览的回流板块里，字段与 listBackflow 一致", async () => {
    await seedAgendaSegment(ORG, WORKSHOP, "f123-seg-backflow");
    const a = await seedArtifact(h, ORG, WORKSHOP, ["v1\n"], FACILITATOR);
    const pinned = await bindToProjectStep(h.deps, {
      userId: FACILITATOR, orgId: org(), artifactId: a.artifactId,
      projectId: WORKSHOP, stepId: "f123-seg-backflow", mode: "pinned",
      sourceVersionId: a.versionIds[0]!,
    });

    const out = await overviewOf(FACILITATOR, WORKSHOP);
    expect(out.backflow).toHaveLength(1);
    expect(out.backflow[0]!.bindingId).toBe(pinned.id);
    expect(out.backflow[0]!.badge).toBe("pinned");
  });

  it("新工作坊没有任何回流：[]，不是伪造行", async () => {
    const out = await overviewOf(FACILITATOR, WORKSHOP);
    expect(out.backflow).toEqual([]);
  });
});

describe("分层无权限：组织层挡的（ADMIN_NOT_SUPERUSER）与项目层挡的（NO_PROJECT_ROLE）必须可区分", () => {
  it("组织角色是 admin 但没有项目角色：ADMIN_NOT_SUPERUSER", async () => {
    await expect(overviewOf(ORG_ADMIN_NO_ROLE, WORKSHOP)).rejects.toMatchObject({
      reasonCode: "ADMIN_NOT_SUPERUSER",
    });
  });

  it("组织角色是 consultant 且没有项目角色：NO_PROJECT_ROLE（普通状态，不是 ADMIN_NOT_SUPERUSER）", async () => {
    await expect(overviewOf(CONSULTANT_NO_ROLE, WORKSHOP)).rejects.toMatchObject({
      reasonCode: "NO_PROJECT_ROLE",
    });
  });

  // ⚠ 反证：把上面两个用户互换角色断言，必须能抓出差异——这正是任务要求的
  // 「把其中两种状态互换，测试必须能抓出差异」。一个把两种无权限塌缩成同一个码的实现
  // （例如永远返回 NO_PROJECT_ROLE）会让第一条用例变红；一个方向反转的实现
  // （admin 给 NO_PROJECT_ROLE、consultant 给 ADMIN_NOT_SUPERUSER）会让两条同时变红。
  it("counter-proof：admin 与 consultant 拿到的码不相同", async () => {
    const adminResult = await overviewOf(ORG_ADMIN_NO_ROLE, WORKSHOP).catch((e) => e);
    const consultantResult = await overviewOf(CONSULTANT_NO_ROLE, WORKSHOP).catch((e) => e);
    expect(adminResult.reasonCode).not.toBe(consultantResult.reasonCode);
  });
});
