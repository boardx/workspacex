/**
 * F122 —— UC-P2 `listProjects` 的两段式返回，反证「不漏也不重复」。
 *
 * ## 为什么正向断言不够
 *
 * 「一个持有项目角色又是 lead 的人，两段里都能看到那个容器」——这条正向断言在
 * 「把两段压成一个混合数组」的实现下也可能凑巧看起来对（如果那个实现恰好
 * 在两个字段里各塞一份）。真正要钉住的是**边界**：只在一段里的容器**不会**
 * 悄悄出现在另一段（重复），也**不会**因为在另一段而消失（漏）。
 * 这正是 `usecases.md` UC-P2「⚠ 无项目 ≠ 失败」与「两段不是混合数组」两条
 * 裁决背后真正担心的失败模式。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listProjects } from "../../src/application/project/list-projects";
import { PgProjectListRepository } from "../../src/infrastructure/project/pg-project-list-repository";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import {
  addOrgMember,
  addProjectMember,
  asApp,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";

const ORG = "f122-two-seg-org";
const LEAD = "u-f122-lead";
const MEMBER_ONLY = "u-f122-member-only";
const NOBODY = "u-f122-nobody";
const HOOK_TIMEOUT_MS = 120_000;

let db: PgDatabase;
let repo: PgProjectListRepository;
let identity: PgIdentityRepository;

async function createProjectRow(id: string, name: string): Promise<void> {
  await asApp(ORG, (c) =>
    c.query(
      "INSERT INTO projects (id, org_id, name, status, kind) VALUES ($1,$2,$3,'active','workshop')",
      [id, ORG, name],
    ),
  );
  await asApp(ORG, (c) =>
    c.query("INSERT INTO workshops (id, org_id) VALUES ($1,$2)", [id, ORG]),
  );
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  identity = new PgIdentityRepository(db);
  repo = new PgProjectListRepository(db);
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG);
  await db?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: "unused-seed-project" });
  // seedOrg 建了一个默认项目，本文件不需要它——每条用例自己建需要的容器。
  await asApp(ORG, (c) => c.query("DELETE FROM projects WHERE id = 'unused-seed-project'"));

  await addOrgMember(ORG, LEAD, "lead", null);
  await addOrgMember(ORG, MEMBER_ONLY, "consultant", null);
}, HOOK_TIMEOUT_MS);

describe("F122：只在一段里的容器不漏、不重复出现在另一段", () => {
  it("只持有项目角色（非 lead/admin）：只出现在 member，managed 恒为空", async () => {
    await createProjectRow("f122-p-member-only", "只有成员角色的容器");
    await addProjectMember(ORG, "f122-p-member-only", MEMBER_ONLY, "member", null);

    const out = await listProjects(
      { repo, identity },
      { orgId: toOrgId(ORG), actorId: MEMBER_ONLY },
    );

    expect(out.member.map((p) => p.id)).toEqual(["f122-p-member-only"]);
    // 反证「漏」：这个容器必须在 member 里。
    expect(out.managed).toEqual([]);
    // 反证「重复」：非 lead/admin 时 managed 恒为空，不会把 member 的东西也塞一份进去。
  });

  it("只是 lead（未加入该容器）：只出现在 managed，member 不含它", async () => {
    await createProjectRow("f122-p-managed-only", "lead 管着但没加入的容器");
    // ⚠ 刻意不给 LEAD 加 project_memberships 行——Q-4② 逐字「lead 对自建未加入的
    //   项目持管理权、不持内容读取权」，未加入是本用例要覆盖的常态。

    const out = await listProjects(
      { repo, identity },
      { orgId: toOrgId(ORG), actorId: LEAD },
    );

    expect(out.managed.map((p) => p.id)).toContain("f122-p-managed-only");
    // 反证「漏」：lead 未加入的容器仍必须出现在 managed。
    expect(out.member.map((p) => p.id)).not.toContain("f122-p-managed-only");
    // 反证「重复」：它不在 member 段——lead 没有项目角色，member 段的判据是
    // project_memberships 而不是「组织角色是不是 lead」。
  });

  it("同一个容器既在 member 又在 managed：两段各自独立判定，不互斥也不去重成一份", async () => {
    await createProjectRow("f122-p-both", "lead 自己加入的容器");
    await addProjectMember(ORG, "f122-p-both", LEAD, "facilitator", null, true);

    const out = await listProjects(
      { repo, identity },
      { orgId: toOrgId(ORG), actorId: LEAD },
    );

    expect(out.member.map((p) => p.id)).toContain("f122-p-both");
    expect(out.managed.map((p) => p.id)).toContain("f122-p-both");
  });

  it("组织角色是 consultant（非 lead/admin）且未加入任何容器：两段都是空列表，不是失败", async () => {
    await createProjectRow("f122-p-untouched", "与本用例调用者无关的容器");

    const out = await listProjects(
      { repo, identity },
      { orgId: toOrgId(ORG), actorId: MEMBER_ONLY },
    );

    // ⚠ 空态是正常状态，不生成伪数据——同 usecases.md UC-P2「无项目 ≠ 失败」。
    expect(out.member).toEqual([]);
    expect(out.managed).toEqual([]);
  });

  it("调用者不在该组织：两段都为空，且不抛出 AUTH_SERVICE_UNAVAILABLE 之外的码", async () => {
    await createProjectRow("f122-p-outsider-noise", "与非成员调用者无关的容器");

    const out = await listProjects(
      { repo, identity },
      { orgId: toOrgId(ORG), actorId: NOBODY },
    );

    expect(out.member).toEqual([]);
    expect(out.managed).toEqual([]);
  });
});
