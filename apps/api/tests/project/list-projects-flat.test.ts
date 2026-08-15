/**
 * F122 → F185（2026-08-16 delta）—— UC-P2 `listProjects` 从两段式改为扁平数组。
 *
 * ⚠ 这份文件此前叫 `list-projects-two-segments.test.ts`，断言的是 `{member, managed}`
 *   两段各自独立、不漏不重复。那条裁决已被推翻（见 `requirements/00-project/
 *   OPEN-QUESTIONS.md` 「🔁 2026-08-16 delta」），仓储层的两段查询本身**没有变**
 *   （`listForActor` 依然分别查 member/managed，见 `pg-project-list-repository.ts`
 *   头注），变的是应用层把两段合并去重成一个数组——本文件因此改名、改断言，
 *   不是另开一份重复的测试。
 *
 * 反证目标不变，只是换了个可观测形状：
 *   · 只落在一种入列理由里的容器，必须出现且只出现一次；
 *   · 同时落在两种入列理由里的容器，必须**不重复**——这是原文件「两段都要有」
 *     反证的直接反面，是扁平化之后唯一会新出现的失败模式（重复行）。
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

describe("F185：扁平数组，只在一种入列理由里的容器不漏、不重复", () => {
  it("只持有项目角色（非 lead/admin）：出现在结果里，且只出现一次", async () => {
    await createProjectRow("f122-p-member-only", "只有成员角色的容器");
    await addProjectMember(ORG, "f122-p-member-only", MEMBER_ONLY, "member", null);

    const out = await listProjects({ repo, identity }, { orgId: toOrgId(ORG), actorId: MEMBER_ONLY });

    expect(out.filter((p) => p.id === "f122-p-member-only")).toHaveLength(1);
  });

  it("只是 lead（未加入该容器）：仍出现在结果里（管理入列理由不需要 project_memberships 行）", async () => {
    await createProjectRow("f122-p-managed-only", "lead 管着但没加入的容器");
    // ⚠ 刻意不给 LEAD 加 project_memberships 行——Q-4② 逐字「lead 对自建未加入的
    //   项目持管理权、不持内容读取权」，未加入是本用例要覆盖的常态。

    const out = await listProjects({ repo, identity }, { orgId: toOrgId(ORG), actorId: LEAD });

    expect(out.filter((p) => p.id === "f122-p-managed-only")).toHaveLength(1);
  });

  it("同一个容器既持有项目角色又被管理：合并去重，只出现一次（扁平化新增的反证）", async () => {
    await createProjectRow("f122-p-both", "lead 自己加入的容器");
    await addProjectMember(ORG, "f122-p-both", LEAD, "facilitator", null, true);

    const out = await listProjects({ repo, identity }, { orgId: toOrgId(ORG), actorId: LEAD });

    // 反证「重复」：两种入列理由都成立时，响应体里**恰好一条**，不是两条相同 id 的行。
    expect(out.filter((p) => p.id === "f122-p-both")).toHaveLength(1);
  });

  it("组织角色是 consultant（非 lead/admin）且未加入任何容器：空数组，不是失败", async () => {
    await createProjectRow("f122-p-untouched", "与本用例调用者无关的容器");

    const out = await listProjects({ repo, identity }, { orgId: toOrgId(ORG), actorId: MEMBER_ONLY });

    // ⚠ 空态是正常状态，不生成伪数据——同 usecases.md UC-P2「无项目 ≠ 失败」。
    expect(out).toEqual([]);
  });

  it("调用者不在该组织：空数组，且不抛出 AUTH_SERVICE_UNAVAILABLE 之外的码", async () => {
    await createProjectRow("f122-p-outsider-noise", "与非成员调用者无关的容器");

    const out = await listProjects({ repo, identity }, { orgId: toOrgId(ORG), actorId: NOBODY });

    expect(out).toEqual([]);
  });

  it("列表项默认带 tags: []（F185 新字段，未打标签时不是 undefined 也不是 null）", async () => {
    await createProjectRow("f122-p-no-tags", "还没打过标签的容器");
    await addProjectMember(ORG, "f122-p-no-tags", MEMBER_ONLY, "member", null);

    const out = await listProjects({ repo, identity }, { orgId: toOrgId(ORG), actorId: MEMBER_ONLY });

    expect(out.find((p) => p.id === "f122-p-no-tags")?.tags).toEqual([]);
  });
});
