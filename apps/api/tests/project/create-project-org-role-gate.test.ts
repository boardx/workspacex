/** PostgreSQL coverage for project creation, organization membership, and creator roles. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { identity as IdentityContract, project as ProjectContract } from "@repo/contracts";
import { createProject } from "../../src/application/project/create-project";
import { ProjectError } from "../../src/application/project/errors";
import { PgProjectRepository } from "../../src/infrastructure/project/pg-project-repository";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { CountingDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { UuidIdFactory } from "../../src/infrastructure/artifact/uuid-id-factory";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { authorize } from "../../src/application/identity/authorize";
import type { IdentityRepository } from "../../src/application/identity/ports";
import { toOrgId } from "../../src/domain/org-id";
import { canCreateProject } from "../../src/domain/project/create-project-rules";
import { addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs } from "../support/db";

const ORG = "f117-role-org";
const HOOK_TIMEOUT_MS = 120_000;

let db: PgDatabase;
let repo: PgProjectRepository;
let identity: PgIdentityRepository;
let ids: CountingDecisionIdFactory;

/** 每个组织角色一个人，名字里带角色，便于失败时一眼看出是谁。 */
const userFor = (role: string) => `u-f117-${role}`;

function submit(actorId: string, over: { name?: string; kind?: string; blueprintVersionId?: string | null } = {}) {
  return createProject(
    { repo, identity },
    {
      orgId: toOrgId(ORG),
      actorId,
      name: over.name ?? `${actorId} 的容器`,
      kind: over.kind ?? "workshop",
      blueprintVersionId: over.blueprintVersionId === undefined ? null : over.blueprintVersionId,
    },
  );
}

async function reasonOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "NO_ERROR";
  } catch (e) {
    return e instanceof ProjectError ? e.reasonCode : `OTHER:${String(e)}`;
  }
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  identity = new PgIdentityRepository(db);
  ids = new CountingDecisionIdFactory();
  repo = new PgProjectRepository(db, new UuidIdFactory());
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG);
  await db?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await resetOrgs(ORG);
  await asApp(ORG, (c) =>
    c.query("INSERT INTO organizations (id, name, kind) VALUES ($1,$2,'organization')", [ORG, `org ${ORG}`]),
  );
  for (const role of IdentityContract.AssignableOrgRole.options) {
    await addOrgMember(ORG, userFor(role), role, null);
  }
}, HOOK_TIMEOUT_MS);

describe("Project creation is available to organization members", () => {
  it.each(IdentityContract.AssignableOrgRole.options)("allows %s to create a general project", async (role) => {
    const actorId = userFor(role);
    const project = await submit(actorId, { kind: "general" });
    const membership = await asApp(ORG, (c) => c.query(
      "SELECT role FROM general_project_members WHERE org_id = $1 AND project_id = $2 AND user_id = $3",
      [ORG, project.id, actorId],
    ));
    expect(membership.rows).toEqual([{ role: "owner" }]);
  });

  it("非成员被拒（契约的 err 里没有 NO_ORG_MEMBERSHIP）", async () => {
    const r = await reasonOf(submit("u-f117-stranger"));
    expect(r).toBe("ORG_ROLE_INSUFFICIENT");
    // 反向：这个码确实在契约的失败面里，不是本地编的。
    expect(ProjectContract.operations.createProject.err).toContain("ORG_ROLE_INSUFFICIENT");
    expect(ProjectContract.operations.createProject.err).not.toContain("NO_ORG_MEMBERSHIP");
  });

  it("被拒之后**一行都没写**（拒绝不是「先建了再说」）", async () => {
    expect(await reasonOf(submit("u-f117-stranger"))).toBe("ORG_ROLE_INSUFFICIENT");
    const n = await asApp(ORG, async (c) =>
      Number((await c.query("SELECT count(*)::int AS n FROM projects WHERE org_id = $1", [ORG])).rows[0]!.n),
    );
    expect(n).toBe(0);
  });

  it("纯判断那一层单独也说同一句话（domain 不依赖库）", () => {
    const ALLOWED = ["admin", "consultant"] as const;
    for (const role of ALLOWED) expect(canCreateProject(role), role).toBe(true);
    // 遍历契约闭集取补集：加第五种角色时，它默认落在「必须为假」这一侧，
    // 而不是悄悄被放行——这正是不写排除式判据的那条理由的测试面。
    for (const role of IdentityContract.AssignableOrgRole.options.filter((r) => !(ALLOWED as readonly string[]).includes(r))) {
      expect(canCreateProject(role), role).toBe(false);
    }
    expect(canCreateProject(null)).toBe(false);
  });
});

describe("INVALID_KIND：三值闭集之外直接拒", () => {
  it("`delivery`（被否决的 Q-12 候选 A 里的那个值）拿到 INVALID_KIND", async () => {
    expect(await reasonOf(submit(userFor("admin"), { kind: "delivery" }))).toBe("INVALID_KIND");
  });

  it("三个合法值都不会撞上这个码（防「什么都判非法」）", async () => {
    for (const kind of ProjectContract.ProjectKind.options) {
      expect(await reasonOf(submit(userFor("admin"), { kind, name: `k-${kind}` })), kind).toBe("NO_ERROR");
    }
  });

  it("kind 判在角色之前：一个**会被角色判据拒掉**的人传非法 kind，拿到的仍是 INVALID_KIND", async () => {
    expect(await reasonOf(submit("u-f117-stranger", { kind: "delivery" }))).toBe("INVALID_KIND");
  });
});

describe("AUTH_SERVICE_UNAVAILABLE：判定服务不可用一律拒绝，不得降级放行", () => {
  it("角色查询抛出 ⇒ 拿到该码，且一行都没写", async () => {
    const broken: IdentityRepository = new Proxy(identity, {
      get(target, prop, recv) {
        if (prop === "findOrgMembership") {
          return () => Promise.reject(new Error("auth store down"));
        }
        return Reflect.get(target, prop, recv) as unknown;
      },
    }) as IdentityRepository;

    const r = await reasonOf(
      createProject(
        { repo, identity: broken },
        { orgId: toOrgId(ORG), actorId: userFor("admin"), name: "断线", kind: "workshop", blueprintVersionId: null },
      ),
    );
    expect(r).toBe("AUTH_SERVICE_UNAVAILABLE");
    const n = await asApp(ORG, async (c) =>
      Number((await c.query("SELECT count(*)::int AS n FROM projects WHERE org_id = $1", [ORG])).rows[0]!.n),
    );
    expect(n).toBe(0);
  });
});

describe("🔴 Q-4②（2026-08-16 人类裁决推翻）：创建者**自动**获得项目最高权限角色", () => {
  it("建完之后 `project_memberships` 里多了一行 facilitator（is_host=true）", async () => {
    const out = await submit(userFor("admin"));
    const rows = await asApp(ORG, async (c) =>
      (await c.query<{ user_id: string; project_role: string; is_host: boolean }>(
        "SELECT user_id, project_role, is_host FROM project_memberships WHERE project_id = $1",
        [out.id],
      )).rows,
    );
    expect(rows).toEqual([{ user_id: userFor("admin"), project_role: "facilitator", is_host: true }]);
  });

  it("正向断言：创建者立刻以自己的身份判权，走项目层放行", async () => {
    const out = await submit(userFor("admin"));
    const d = await authorize(
      { repo: identity, ids },
      {
        userId: userFor("admin"),
        orgId: toOrgId(ORG),
        projectId: out.id,
        object: { kind: "project", id: out.id },
        action: "read.allHands",
      },
    );
    expect(d.allowed).toBe(true);
    // 组织层照样过——现在项目层**也**过了，不再需要区分。
    expect(d.orgLayer.passed).toBe(true);
    expect(d.orgLayer.role).toBe("admin");
    expect(d.projectLayer?.passed).toBe(true);
    expect(d.reasonCode).toBeNull();
  });

  it("反向的反向：给**另一个**人补一个项目角色，同一次判权立刻放行", async () => {
    // 少了这一条，一个「对任何项目都拒绝」的判权实现会让上一条白绿。
    // ⚠ 创建者本人现在已经自动拿到 facilitator（上一条断言钉住的行为），这里必须换
    //   一个**没有**参与创建的人来验证「后补的角色」这条路径，否则 `addProjectMember`
    //   会撞上创建时已写的那一行，报 `project_memberships_pkey` 唯一约束冲突——
    //   那是实现细节的巧合撞车，不是这条测试想验证的东西。
    const out = await submit(userFor("admin"));
    const other = "u-f117-added-facilitator";
    // `decide()` 的组织层要求 `org.role !== null`（I-11 之前那一关）——这个人必须先
    // 在组织里有一行，才轮到项目层的 facilitator 角色说话。用 `consultant`（本文件
    // 没有该项目角色时仍不能读取的组织角色）保持「是项目角色而不是组织角色在放行」这条测试意图不失真。
    await addOrgMember(ORG, other, "consultant", null);
    await addProjectMember(ORG, out.id, other, "facilitator", null, false);
    const d = await authorize(
      { repo: identity, ids },
      {
        userId: other,
        orgId: toOrgId(ORG),
        projectId: out.id,
        object: { kind: "project", id: out.id },
        action: "read.allHands",
      },
    );
    expect(d.allowed).toBe(true);
  });
});
