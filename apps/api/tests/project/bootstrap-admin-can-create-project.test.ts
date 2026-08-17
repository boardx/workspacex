/**
 * #608 —— **刚 bootstrap 出来的第一个用户能不能建第一个项目**（人类裁决 2026-08-06，
 * 覆盖 U-4 裁 A 的「只有 `lead`」那一半）。
 *
 * ## 为什么这条以前没有人发现
 *
 * 既有的 `create-project-org-role-gate.test.ts` 是**自己 INSERT 一行 `org_role='lead'`**
 * 再去建项目——它证明的是「lead 能建」，而**产品里没有任何路径能产生那个 lead**：
 *   · `bootstrapFirstUser` 落库时 `org_role` 是写死的 `'admin'`（实测
 *     `pg-registration-repository.ts` 三处自助注册 INSERT 全部写死 `'admin'`）；
 *   · 全仓**没有任何** `UPDATE org_memberships`（改组织角色的写路径不存在）。
 * ⇒ 第一个用户永远是 `admin`，永远变不成 `lead`，于是**永远建不了第一个项目**。
 * 预置 lead 的夹具把这个洞完整地盖住了：所有断言全绿，而真实用户第一步就卡死。
 *
 * ## 所以本文件走**真实旅程**，不预置任何角色
 *
 * 自己建一个空库（全局测试库的 bootstrap 名额早被别的套件消费掉了，
 * 在那上面**证不了**「第一个用户」这件事——同
 * `bootstrap-first-user-concurrency.test.ts` 文件头的理由），
 * 在里面真的跑一次 `bootstrapFirstUser`，拿它**返回的** userId / orgId 去建项目。
 * 角色是产品自己写进去的，不是测试塞进去的。
 *
 * ⚠ 干净机器上也成立：本文件 CREATE DATABASE + migrate，不依赖任何磁盘残留或
 *   别的套件留下的行（#600/#603 那次「绿来自机器状态而非仓库内容」的教训）。
 *
 * ## 🔴 Q-4② 已于 2026-08-16 被人类裁决推翻——本文件现在钉住**新**行为
 *
 * 原判据（存档）：人类只裁了「admin 也能建」，没有裁「建完就给角色」。
 * **人类随后直接裁决推翻了这一条**：创建者自动获得该项目最高权限的角色
 * （facilitator + is_host）——这正是下面「admin 建完立刻判权」那条断言会拿到
 * `ADMIN_NOT_SUPERUSER` 这个真实产品缺口（建了项目却进不去）的根治。
 * ⇒ 下面第二、三条断言是这次改动的**正向验证**，不是历史护栏。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { migrate } from "../../src/infrastructure/db/migrator";
import { migrationConfig, appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { PgRegistrationRepository } from "../../src/infrastructure/auth/pg-registration-repository";
import { BcryptPasswordHasher } from "../../src/infrastructure/auth/bcrypt-password-hasher";
import { PgProjectRepository } from "../../src/infrastructure/project/pg-project-repository";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { CountingDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { UuidIdFactory } from "../../src/infrastructure/artifact/uuid-id-factory";
import { bootstrapFirstUser } from "../../src/application/auth/bootstrap-first-user";
import { createProject } from "../../src/application/project/create-project";
import { authorize } from "../../src/application/identity/authorize";
import { canCreateProject } from "../../src/domain/project/create-project-rules";
import { toOrgId } from "../../src/domain/org-id";
import { dropDatabaseAfterDraining } from "../support/drop-database";

process.env.KERNEL_QUIET = "1";

const HOOK_TIMEOUT_MS = 180_000;
const DATABASE = `wsx_i608_${process.pid}_${Date.now()}`;

/**
 * ⚠ 本文件**刻意不碰 `process.env.PGDATABASE`**。
 *
 * 第一版是照着 `bootstrap-first-user-concurrency.test.ts` 抄的，它会 `process.env.PGDATABASE
 * = DATABASE`（它必须这么做：它通过 `createApp()` 起真实 Nest 应用，应用自己去读 env）。
 * 本文件不起应用、直接调用例，两处需要库名的地方都**显式传配置**
 * （`ownerConfig(DATABASE)` 与 `{ ...appConfig(), database: DATABASE }`），
 * 所以那次赋值纯属多余——而它是**进程级全局可变状态**：同一个 worker 进程里跑的
 * 别的测试文件会读到它，`afterAll` 的「还原」还可能把别人设的值覆盖掉。
 * ⇒ 多余的全局写入不留。测试之间的耦合应当是零，不是「小心地互相还原」。
 */

let db: PgDatabase;
let firstUserId: string;
let firstOrgId: string;

function ownerConfig(database: string) {
  return { ...migrationConfig(), database };
}

beforeAll(async () => {
  const admin = new pg.Client(ownerConfig("postgres"));
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${DATABASE}`);
  } finally {
    await admin.end();
  }
  await migrate(ownerConfig(DATABASE));

  db = new PgDatabase({ ...appConfig(), database: DATABASE });

  // 真实旅程第 1 步：自助注册出组织里的第一个人。角色由产品决定，测试不指定。
  const out = await bootstrapFirstUser(
    { repo: new PgRegistrationRepository(db), hasher: new BcryptPasswordHasher() },
    {
      email: "first@i608.test",
      password: "correct-horse-battery-staple",
      displayName: "第一个用户",
      orgName: "第一个组织",
    },
  );
  firstUserId = out.userId;
  firstOrgId = out.orgId;
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await db?.close();
  const admin = new pg.Client(ownerConfig("postgres"));
  await admin.connect();
  try {
    await dropDatabaseAfterDraining(admin, DATABASE);
  } finally {
    await admin.end();
  }
}, HOOK_TIMEOUT_MS);

describe("#608 前提：这个死锁是真的（不是从 issue 抄来的转述）", () => {
  /**
   * ⚠ 必须 `withTenant`，不能 `withoutTenant`：`org_memberships` 挂着 RLS
   * `org_id = current_setting('app.current_org', true)`，未设租户时它**匹配不到任何行**，
   * 于是查询返回 `[]` 而不是报错——一个「空结果」会被读成「没有这一行」。
   * 这正是 `pg-identity-repository.ts` 头注记下的那个坑（`listMemberships` 栽过一次）。
   * 本文件第一版就栽在同一格：两条前提断言拿到 `[]` / `0`，看起来像「bootstrap 没写成功」。
   */
  it("bootstrap 出来的第一个用户，组织角色是 `admin`", async () => {
    const rows = await db.withTenant(toOrgId(firstOrgId), async (s) =>
      (await s.query<{ org_role: string }>(
        "SELECT org_role FROM org_memberships WHERE user_id = $1 AND org_id = $2",
        [firstUserId, firstOrgId],
      )).rows,
    );
    expect(rows.map((r) => r.org_role)).toEqual(["admin"]);
  });

  it("这个组织里除他之外没有别人 —— 所以「让别人把你提成 lead」这条路不存在", async () => {
    const n = await db.withTenant(toOrgId(firstOrgId), async (s) =>
      Number((await s.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM org_memberships WHERE org_id = $1",
        [firstOrgId],
      )).rows[0]!.n),
    );
    expect(n).toBe(1);
  });
});

describe("🔴 #608 裁决：admin 也能建项目", () => {
  it("刚 bootstrap 的 admin 建第一个项目 —— 成功（本次改动之前这里是红的）", async () => {
    const created = await createProject(
      { repo: new PgProjectRepository(db, new UuidIdFactory()), identity: new PgIdentityRepository(db) },
      {
        orgId: toOrgId(firstOrgId),
        actorId: firstUserId,
        name: "第一个项目",
        kind: "workshop",
        blueprintVersionId: null,
      },
    );
    expect(created.id).toBeTruthy();

    // 正样本必须落到**库里真有这一行**，不只是「用例没抛错」。
    const rows = await db.withTenant(toOrgId(firstOrgId), async (s) =>
      (await s.query<{ id: string; name: string }>(
        "SELECT id, name FROM projects WHERE org_id = $1",
        [firstOrgId],
      )).rows,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(created.id);
  });

  it("纯判断那一层：`admin` 与 `lead` 都为真，另两种角色与 null 仍为假", () => {
    expect(canCreateProject("admin")).toBe(true);
    expect(canCreateProject("lead")).toBe(true);
    // 反向的一半：不许退化成「谁都能建」——那会让上一条断言变成空转。
    expect(canCreateProject("consultant")).toBe(false);
    expect(canCreateProject("compliance")).toBe(false);
    expect(canCreateProject(null)).toBe(false);
  });
});

describe("🔴 正向：Q-4② 已推翻，创建者自动获得 facilitator", () => {
  it("admin 建完项目后，`project_memberships` 里多了一行 facilitator（自己，is_host=true）", async () => {
    const created = await createProject(
      { repo: new PgProjectRepository(db, new UuidIdFactory()), identity: new PgIdentityRepository(db) },
      {
        orgId: toOrgId(firstOrgId),
        actorId: firstUserId,
        name: "护栏项目",
        kind: "workshop",
        blueprintVersionId: null,
      },
    );
    const rows = await db.withTenant(toOrgId(firstOrgId), async (s) =>
      (await s.query<{ user_id: string; project_role: string; is_host: boolean }>(
        "SELECT user_id, project_role, is_host FROM project_memberships WHERE project_id = $1",
        [created.id],
      )).rows,
    );
    expect(rows).toEqual([{ user_id: firstUserId, project_role: "facilitator", is_host: true }]);
  });

  it("admin 建完立刻以自己身份判权 ⇒ 放行（不再是 ADMIN_NOT_SUPERUSER）", async () => {
    const created = await createProject(
      { repo: new PgProjectRepository(db, new UuidIdFactory()), identity: new PgIdentityRepository(db) },
      {
        orgId: toOrgId(firstOrgId),
        actorId: firstUserId,
        name: "判权项目",
        kind: "workshop",
        blueprintVersionId: null,
      },
    );
    const decision = await authorize(
      { repo: new PgIdentityRepository(db), ids: new CountingDecisionIdFactory() },
      {
        userId: firstUserId,
        orgId: toOrgId(firstOrgId),
        projectId: created.id,
        object: { kind: "project", id: created.id },
        action: "read.allHands",
      },
    );
    /**
     * 这正是 D-18（`ADMIN_NOT_SUPERUSER`）在真实产品里造成的可用性问题的根治：
     * 不是绕开 D-18 判定本身（`permission-decision.ts` 的 `decide()` 一字未改），
     * 是创建者从一开始就不再落在它判定的那个"组织层越过项目层、无项目角色"的格子里
     * ——他现在有真实的 `facilitator` 项目角色，走的是项目层放行，不是组织层旁路。
     */
    expect(decision.allowed).toBe(true);
    expect(decision.reasonCode).toBeNull();
    expect(decision.projectLayer?.passed).toBe(true);
  });
});
