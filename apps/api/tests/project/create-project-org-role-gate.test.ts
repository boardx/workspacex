/**
 * F117 ②⑤ —— **谁能建**（U-4 裁 A → **2026-08-06 人类裁决 / #608 覆盖**）与
 * **创建者自动获角色**（Q-4②，**2026-08-16 人类裁决推翻**）。
 *
 * ## 🔴 #608：这两条**不再**是同一条裁决的两端
 *
 * 旧稿写的是：「`lead` 能建、`admin` 不能建，是因为管理员的权是治理不是参与（D-18 同向）」。
 * 那半句今天**已经不成立**——`admin` 也能建了（#608：组织里的第一个人永远是 `admin`，
 * 且没有任何 `UPDATE org_memberships` 能把他变成 `lead`，否则第一个项目永远建不出来）。
 *
 * ⚠ **D-18 本身没有被放弃**（`decide()` 一字未改），但它守的那条边挪了：
 *   `admin`（和 `lead`）建完之后**现在会**获得项目角色（facilitator），
 *   不再落在 D-18 判定的"组织层越过项目层、无项目角色"那个格子里。
 * ⇒ 本文件最后一个 describe（Q-4②）因此从"护栏"变成"正向验证"，同样重要。
 *
 * ⚠ 2026-08-16 之前：创建者建完之后不会自动获得项目角色，理由是 Q-4② 裁的
 * 「`lead` 对自建未加入的项目**持管理权、不持内容读取权**」——若创建即授角色，
 * 那条边的两端就不存在了。**人类直接裁决推翻了这条**：创建者自动获得最高权限
 * （facilitator + is_host），这正是"建了项目却进不去自己项目"这个真实产品缺口的根治。
 *
 * ⇒ 所以本文件里「建完之后创建者读得到内容」现在是**正向断言**，
 *   不是"建完之后创建者读不到内容"（那是推翻前的旧行为）。
 *
 * ## 每条都要有反向的那一半
 *
 *   · 只测「consultant/compliance 被拒」⇒ 一个「谁都拒」的实现全绿 ⇒ 必须同时测 lead/admin 能建
 *   · 只测「lead/admin 能建」⇒ 一个「谁都放行」的实现全绿 ⇒ 必须同时测另两种被拒
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

describe("#608（覆盖 U-4 裁 A）：`lead` 与 `admin` 能创建，另两种不能", () => {
  it("四种组织角色逐个试，恰好 `lead` / `admin` 通过，其余一律 ORG_ROLE_INSUFFICIENT", async () => {
    // 非空转：遍历的是契约的闭集本身。加第五种角色，本条自动覆盖它。
    expect(IdentityContract.OrgRole.options.length).toBe(4);

    const verdicts: Record<string, string> = {};
    for (const role of IdentityContract.OrgRole.options) {
      verdicts[role] = await reasonOf(submit(userFor(role)));
    }
    expect(verdicts).toEqual({
      lead: "NO_ERROR",
      // 🔴 2026-08-06 人类裁决（#608）把这一格从 `ORG_ROLE_INSUFFICIENT` 翻成 `NO_ERROR`。
      //    U-4 裁 A 原本的理由（管理员的权是治理不是参与，D-18 同向）没有被否定，
      //    被否定的是它的**代价**：`bootstrapFirstUser` 只产 `admin`，且全仓没有任何
      //    `UPDATE org_memberships`，于是第一个用户永远建不了第一个项目。
      //    ⚠ D-18 本身没有被否定：建完**现在会**授予项目角色（Q-4② 已推翻，见本文件
      //      最后一个 describe，以及 `bootstrap-admin-can-create-project.test.ts` 的正向验证）。
      admin: "NO_ERROR",
      // 反向的一半：不许退化成「谁都能建」。这两格红了，说明放宽放过头了。
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
    // ⚠ #608 之后这里必须用一个**仍被拒**的角色：原来写的是 `admin`，
    //   而 admin 现在建得成，这条会静默地变成「建成功了，然后断言库里有 0 行」——
    //   一条断言方向反了的红。改用 `consultant`（本次放宽未涉及）。
    await reasonOf(submit(userFor("consultant")));
    const n = await asApp(ORG, async (c) =>
      Number((await c.query("SELECT count(*)::int AS n FROM projects WHERE org_id = $1", [ORG])).rows[0]!.n),
    );
    expect(n).toBe(0);
  });

  it("纯判断那一层单独也说同一句话（domain 不依赖库）", () => {
    const ALLOWED = ["lead", "admin"] as const;
    for (const role of ALLOWED) expect(canCreateProject(role), role).toBe(true);
    // 遍历契约闭集取补集：加第五种角色时，它默认落在「必须为假」这一侧，
    // 而不是悄悄被放行——这正是不写排除式判据的那条理由的测试面。
    for (const role of IdentityContract.OrgRole.options.filter((r) => !(ALLOWED as readonly string[]).includes(r))) {
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

  it("kind 判在角色之前：一个**会被角色判据拒掉**的人传非法 kind，拿到的仍是 INVALID_KIND", async () => {
    // 取舍写在 `create-project.ts`：非法 kind 与调用者是谁无关，
    // 放在角色之后会让这个码只有能建项目的人才看得见——而任何调用方都可能传错。
    //
    // ⚠ #608 之前这里用的是 `admin`，因为当时 admin 会被角色判据拒掉。admin 现在能建了，
    //   继续用它，这条就退化成「一个有权建的人传了非法 kind」——**顺序**这件事再也证不到，
    //   而断言依旧全绿。换成 `consultant`（本次放宽未涉及，仍被拒）才保住原意。
    expect(await reasonOf(submit(userFor("consultant"), { kind: "delivery" }))).toBe("INVALID_KIND");
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

describe("🔴 Q-4②（2026-08-16 人类裁决推翻）：创建者**自动**获得项目最高权限角色", () => {
  it("建完之后 `project_memberships` 里多了一行 facilitator（is_host=true）", async () => {
    const out = await submit(userFor("lead"));
    const rows = await asApp(ORG, async (c) =>
      (await c.query<{ user_id: string; project_role: string; is_host: boolean }>(
        "SELECT user_id, project_role, is_host FROM project_memberships WHERE project_id = $1",
        [out.id],
      )).rows,
    );
    expect(rows).toEqual([{ user_id: userFor("lead"), project_role: "facilitator", is_host: true }]);
  });

  it("正向断言：创建者立刻以自己的身份判权，走项目层放行", async () => {
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
    expect(d.allowed).toBe(true);
    // 组织层照样过——现在项目层**也**过了，不再需要区分。
    expect(d.orgLayer.passed).toBe(true);
    expect(d.orgLayer.role).toBe("lead");
    expect(d.projectLayer?.passed).toBe(true);
    expect(d.reasonCode).toBeNull();
  });

  it("反向的反向：给**另一个**人补一个项目角色，同一次判权立刻放行", async () => {
    // 少了这一条，一个「对任何项目都拒绝」的判权实现会让上一条白绿。
    // ⚠ 创建者本人现在已经自动拿到 facilitator（上一条断言钉住的行为），这里必须换
    //   一个**没有**参与创建的人来验证「后补的角色」这条路径，否则 `addProjectMember`
    //   会撞上创建时已写的那一行，报 `project_memberships_pkey` 唯一约束冲突——
    //   那是实现细节的巧合撞车，不是这条测试想验证的东西。
    const out = await submit(userFor("lead"));
    const other = "u-f117-added-facilitator";
    // `decide()` 的组织层要求 `org.role !== null`（I-11 之前那一关）——这个人必须先
    // 在组织里有一行，才轮到项目层的 facilitator 角色说话。用 `consultant`（本文件
    // 放宽未涉及的角色）保持「是项目角色而不是组织角色在放行」这条测试意图不失真。
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
