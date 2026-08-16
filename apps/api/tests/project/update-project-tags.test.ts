/**
 * F185（2026-08-16 delta）—— `updateProjectTags`：整体替换语义 + 权限线 + 去重 +
 * 上限，以及它如何喂回 `listProjects`（同一个事实，读写两侧必须一致）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { updateProjectTags } from "../../src/application/project/update-project-tags";
import { listProjects } from "../../src/application/project/list-projects";
import { ProjectError } from "../../src/application/project/errors";
import { PgProjectTagsRepository } from "../../src/infrastructure/project/pg-project-tags-repository";
import { PgProjectListRepository } from "../../src/infrastructure/project/pg-project-list-repository";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const ORG = "f185-tags-org";
const LEAD = "u-f185-lead";
const CONSULTANT = "u-f185-consultant";
const HOOK_TIMEOUT_MS = 120_000;

let db: PgDatabase;
let tagsRepo: PgProjectTagsRepository;
let listRepo: PgProjectListRepository;
let identity: PgIdentityRepository;

async function createProjectRow(id: string): Promise<void> {
  await asApp(ORG, (c) =>
    c.query("INSERT INTO projects (id, org_id, name, status, kind) VALUES ($1,$2,$3,'active','workshop')", [
      id, ORG, `容器 ${id}`,
    ]),
  );
  await asApp(ORG, (c) => c.query("INSERT INTO workshops (id, org_id) VALUES ($1,$2)", [id, ORG]));
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  identity = new PgIdentityRepository(db);
  tagsRepo = new PgProjectTagsRepository(db);
  listRepo = new PgProjectListRepository(db);
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
  await addOrgMember(ORG, CONSULTANT, "consultant", null);
}, HOOK_TIMEOUT_MS);

describe("F185 updateProjectTags", () => {
  it("lead 可以写标签，且 listProjects 读回同一个事实", async () => {
    await createProjectRow("f185-p1");

    const out = await updateProjectTags(
      { repo: tagsRepo, identity },
      { orgId: toOrgId(ORG), actorId: LEAD, projectId: "f185-p1", tags: ["客户", "高优先级"] },
    );
    expect(out.tags.slice().sort()).toEqual(["客户", "高优先级"]);

    const listed = await listProjects({ repo: listRepo, identity }, { orgId: toOrgId(ORG), actorId: LEAD });
    expect(listed.find((p) => p.id === "f185-p1")?.tags).toEqual(["客户", "高优先级"]);
  });

  it("整体替换：第二次写入把第一次的标签集合整体换掉，不是增量合并", async () => {
    await createProjectRow("f185-p2");
    await updateProjectTags(
      { repo: tagsRepo, identity },
      { orgId: toOrgId(ORG), actorId: LEAD, projectId: "f185-p2", tags: ["旧标签"] },
    );

    const out = await updateProjectTags(
      { repo: tagsRepo, identity },
      { orgId: toOrgId(ORG), actorId: LEAD, projectId: "f185-p2", tags: ["新标签"] },
    );

    expect(out.tags).toEqual(["新标签"]);
  });

  it("传空数组 = 清空全部标签", async () => {
    await createProjectRow("f185-p3");
    await updateProjectTags(
      { repo: tagsRepo, identity },
      { orgId: toOrgId(ORG), actorId: LEAD, projectId: "f185-p3", tags: ["会被清空"] },
    );

    const out = await updateProjectTags(
      { repo: tagsRepo, identity },
      { orgId: toOrgId(ORG), actorId: LEAD, projectId: "f185-p3", tags: [] },
    );

    expect(out.tags).toEqual([]);
  });

  it("重复标签在写入前去重，不因主键冲突整批失败", async () => {
    await createProjectRow("f185-p4");

    const out = await updateProjectTags(
      { repo: tagsRepo, identity },
      { orgId: toOrgId(ORG), actorId: LEAD, projectId: "f185-p4", tags: ["a", "a", "b"] },
    );

    expect(out.tags.slice().sort()).toEqual(["a", "b"]);
  });

  it("非 lead/admin（consultant）：ORG_ROLE_INSUFFICIENT，写入未发生", async () => {
    await createProjectRow("f185-p5");

    await expect(
      updateProjectTags(
        { repo: tagsRepo, identity },
        { orgId: toOrgId(ORG), actorId: CONSULTANT, projectId: "f185-p5", tags: ["不该写进去"] },
      ),
    ).rejects.toMatchObject({ reasonCode: "ORG_ROLE_INSUFFICIENT" });

    const listed = await listProjects({ repo: listRepo, identity }, { orgId: toOrgId(ORG), actorId: LEAD });
    expect(listed.find((p) => p.id === "f185-p5")?.tags).toEqual([]);
  });

  it("容器不存在（或跨组织误传 id）：PROJECT_NOT_FOUND", async () => {
    await expect(
      updateProjectTags(
        { repo: tagsRepo, identity },
        { orgId: toOrgId(ORG), actorId: LEAD, projectId: "f185-does-not-exist", tags: ["x"] },
      ),
    ).rejects.toBeInstanceOf(ProjectError);
    await expect(
      updateProjectTags(
        { repo: tagsRepo, identity },
        { orgId: toOrgId(ORG), actorId: LEAD, projectId: "f185-does-not-exist", tags: ["x"] },
      ),
    ).rejects.toMatchObject({ reasonCode: "PROJECT_NOT_FOUND" });
  });
});
