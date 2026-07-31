/**
 * F117 ②⑤ —— **谁能建**（U-4 裁 A）与 **创建者不自动获角色**（Q-4②）。
 *
 * ## 这两条其实是同一条裁决的两端
 *
 * `lead` 能建、`admin` 不能建，是因为管理员的权是**治理**不是**参与**（D-18 同向）。
 * 而 `lead` 建完之后**不会**自动获得项目角色，是因为 Q-4② 裁的正是
 * 「`lead` 对自建未加入的项目**持管理权、不持内容读取权**」——若创建即授角色，
 * 那条边的两端就不存在了，「管理员不是超级用户」随之破掉。
 *
 * ⇒ 所以本文件里「建完之后创建者读不到内容」是**正向断言**，
 *   而不是一条描述缺陷的注释。
 *
 * ## 每条都要有反向的那一半
 *
 *   · 只测「admin 被拒」⇒ 一个「谁都拒」的实现全绿  ⇒ 必须同时测 lead 能建
 *   · 只测「创建者判权被拒」⇒ 一个「谁都拒」的判权全绿 ⇒ 必须同时测有项目角色的人被放行
 *   · 只测「四种组织角色里只有 lead 通过」⇒ 枚举一旦加第五种，本条不会知道
 *     ⇒ 遍历的是契约的 `OrgRole.options`，并断言它恰好四个
 */
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
  for (const role of IdentityContract.OrgRole.options) {
    await addOrgMember(ORG, userFor(role), role, null);
  }
}, HOOK_TIMEOUT_MS);

describe("U-4 裁 A：只有组织角色 `lead` 能创建", () => {
  it("四种组织角色逐个试，恰好 `lead` 通过，其余一律 ORG_ROLE_INSUFFICIENT", async () => {
    // 非空转：遍历的是契约的闭集本身。加第五种角色，本条自动覆盖它。
    expect(IdentityContract.OrgRole.options.length).toBe(4);

    const verdicts: Record<string, string> = {};
    for (const role of IdentityContract.OrgRole.options) {
      verdicts[role] = await reasonOf(submit(userFor(role)));
    }
    expect(verdicts).toEqual({
      lead: "NO_ERROR",
      // 🔴 `admin` 与其余角色**同码**。这一格是 U-4 裁 A 的全部内容：
      //    管理员的权是治理不是参与。它写成 `NO_ERROR` 的那天，D-18 也就没了。
      admin: "ORG_ROLE_INSUFFICIENT",
      consultant: "ORG_ROLE_INSUFFICIENT",
      compliance: "ORG_ROLE_INSUFFICIENT",
    });
  });

  it("非成员与「成员但不是 lead」落在同一个码上（契约的 err 里没有 NO_ORG_MEMBERSHIP）", async () => {
    const r = await reasonOf(submit("u-f117-stranger"));
    expect(r).toBe("ORG_ROLE_INSUFFICIENT");
    // 反向：这个码确实在契约的失败面里，不是本地编的。
    expect(ProjectContract.operations.createProject.err).toContain("ORG_ROLE_INSUFFICIENT");
    expect(ProjectContract.operations.createProject.err).not.toContain("NO_ORG_MEMBERSHIP");
  });

  it("被拒之后**一行都没写**（拒绝不是「先建了再说」）", async () => {
    await reasonOf(submit(userFor("admin")));
    const n = await asApp(ORG, async (c) =>
      Number((await c.query("SELECT count(*)::int AS n FROM projects WHERE org_id = $1", [ORG])).rows[0]!.n),
    );
    expect(n).toBe(0);
  });

  it("纯判断那一层单独也说同一句话（domain 不依赖库）", () => {
    expect(canCreateProject("lead")).toBe(true);
    for (const role of IdentityContract.OrgRole.options.filter((r) => r !== "lead")) {
      expect(canCreateProject(role), role).toBe(false);
    }
    expect(canCreateProject(null)).toBe(false);
  });
});

describe("INVALID_KIND：三值闭集之外直接拒", () => {
  it("`delivery`（被否决的 Q-12 候选 A 里的那个值）拿到 INVALID_KIND", async () => {
    expect(await reasonOf(submit(userFor("lead"), { kind: "delivery" }))).toBe("INVALID_KIND");
  });

  it("三个合法值都不会撞上这个码（防「什么都判非法」）", async () => {
    for (const kind of ProjectContract.ProjectKind.options) {
      expect(await reasonOf(submit(userFor("lead"), { kind, name: `k-${kind}` })), kind).toBe("NO_ERROR");
    }
  });

  it("kind 判在角色之前：一个 admin 传非法 kind 得到的是 INVALID_KIND", async () => {
    // 取舍写在 `create-project.ts`：非法 kind 与调用者是谁无关，
    // 放在角色之后会让这个码只有 lead 才看得见——而任何调用方都可能传错。
    expect(await reasonOf(submit(userFor("admin"), { kind: "delivery" }))).toBe("INVALID_KIND");
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
        { orgId: toOrgId(ORG), actorId: userFor("lead"), name: "断线", kind: "workshop", blueprintVersionId: null },
      ),
    );
    expect(r).toBe("AUTH_SERVICE_UNAVAILABLE");
    const n = await asApp(ORG, async (c) =>
      Number((await c.query("SELECT count(*)::int AS n FROM projects WHERE org_id = $1", [ORG])).rows[0]!.n),
    );
    expect(n).toBe(0);
  });
});

describe("🔴 Q-4②：创建者**不会**被自动授予任何项目角色", () => {
  it("建完之后 `project_memberships` 里一行都没有", async () => {
    const out = await submit(userFor("lead"));
    const rows = await asApp(ORG, async (c) =>
      (await c.query("SELECT user_id, project_role FROM project_memberships WHERE project_id = $1", [out.id]))
        .rows,
    );
    expect(rows).toEqual([]);
  });

  it("反向断言：创建者立刻以自己的身份判权，拿到 NO_PROJECT_ROLE", async () => {
    const out = await submit(userFor("lead"));
    const d = await authorize(
      { repo: identity, ids },
      {
        userId: userFor("lead"),
        orgId: toOrgId(ORG),
        projectId: out.id,
        object: { kind: "project", id: out.id },
        action: "read.allHands",
      },
    );
    expect(d.allowed).toBe(false);
    // 组织层是**过**的——挡住的是项目层。这两者必须可分辨，
    // 否则「我建的项目我进不去」会被读成「我不在这个组织里」。
    expect(d.orgLayer.passed).toBe(true);
    expect(d.orgLayer.role).toBe("lead");
    expect(d.projectLayer?.passed).toBe(false);
    expect(d.reasonCode).toBe("NO_PROJECT_ROLE");
  });

  it("反向的反向：给同一个人补一个项目角色，同一次判权立刻放行", async () => {
    // 少了这一条，一个「对任何项目都拒绝」的判权实现会让上一条白绿。
    const out = await submit(userFor("lead"));
    await addProjectMember(ORG, out.id, userFor("lead"), "facilitator", null, true);
    const d = await authorize(
      { repo: identity, ids },
      {
        userId: userFor("lead"),
        orgId: toOrgId(ORG),
        projectId: out.id,
        object: { kind: "project", id: out.id },
        action: "read.allHands",
      },
    );
    expect(d.allowed).toBe(true);
  });
});
