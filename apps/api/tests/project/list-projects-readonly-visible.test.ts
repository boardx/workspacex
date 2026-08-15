/**
 * F122 —— 归档 / 组织停用的容器「显示且标注只读」，反证「不是列表隐藏它」。
 *
 * usecases.md UC-P2 逐字：「`archived` 的容器**显示且标注只读**，**不消失**」，
 * 「停用组织下的项目：同上：**显示且标注只读**」，且两处呈现必须一致
 * （Q-5 B ↔ Q-7③ 耦合）。反证的失败模式是「藏起来读作『产品做不到这件事』，
 * 而真相是『这个组织不允许』」——本文件对每一种只读原因都断言**列表仍然返回它**，
 * 而不是从响应体里悄悄消失。
 *
 * ## 关于「写操作必须被拒」这条反向断言，两种只读原因目前的覆盖不对称
 *
 * · **组织停用**：F22 已 passing 的 `kernel_apply_org_freeze_policies()` 会扫描
 *   全部带 `org_id` 外键的租户表并装上冻结策略——`projects` 表在 0014 迁移执行时
 *   已经存在，因此**已经**被那次扫描纳入。本文件下面「组织停用 ⇒ 写被拒」那条
 *   断言测的是**继承来的**保护，不是本 feature 新写的代码。
 * · **容器自己归档**：`usecases.md` UC-P4 与 `0018-f116-*.sql` 的头部注释此前都明确写着
 *   「只读语义（RESTRICTIVE 策略）不在本迁移里 —— 那是 **F124** 的交付物」。
 *   ✅ **2026-08-01 更新**：F124 已落地（`20260801120000_f124_project_archive_readonly.sql`），
 *   挂在项目容器上的表（含本文件用到的 `workshops`）现在对归档容器的写入是真实被拒的。
 *   「写被拒」的反向断言不在**本文件**——它是 F124 自己的交付物，见
 *   `tests/project/archive-readonly-and-readable.test.ts`；本文件仍然只断言可见性
 *   （显示 + 标注），职责边界不变，只是不再需要「本文件不假装这条防线已存在」那句免责声明。
 *   ⚠ 唯一联动：下面 `createProjectRow` 建「已归档」夹具时必须先以 `active` 状态
 *   插入子类型行、再翻成 `archived`——F124 的冻结策略会挡住对一个已归档容器的
 *   `INSERT INTO workshops`，直接按目标状态两行一起插会被库拒掉。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listProjects } from "../../src/application/project/list-projects";
import { PgProjectListRepository } from "../../src/infrastructure/project/pg-project-list-repository";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgOrgLifecycleRepository } from "../../src/infrastructure/auth/pg-org-lifecycle-repository";
import { retentionUntil } from "../../src/domain/auth/org-lifecycle";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { addOrgMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs } from "../support/db";

const ORG = "f122-readonly-org";
const LEAD = "u-f122-ro-lead";
const HOOK_TIMEOUT_MS = 120_000;

let db: PgDatabase;
let repo: PgProjectListRepository;
let identity: PgIdentityRepository;
let orgs: PgOrgLifecycleRepository;

async function createProjectRow(id: string, name: string, status: "active" | "archived" = "active"): Promise<void> {
  // ⚠ F124：容器建成 `active` 之后才建子类型行，需要时**最后**再翻成 `archived`。
  //   迁移 `20260801120000_f124_*.sql` 给 `workshops` 装了 RESTRICTIVE INSERT 策略
  //   （`kernel_project_is_writable(id)`）——生产路径下这天然成立（`PgProjectRepository`
  //   在同一个事务里先插 `projects` 后插子类型表，此刻 `status` 恒为 `'active'`，
  //   见 0018 头部注释），但这里是**直接裸插测试夹具**，顺序不受应用层约束。
  //   先按 'active' 建两行，再单独 UPDATE 成目标状态，两条语句都不会撞上冻结：
  //   `projects` 本身不在冻结范围内（承载归档标记本身），子类型表的 INSERT 发生在
  //   它仍是 active 的那一刻。
  await asApp(ORG, (c) =>
    c.query(
      "INSERT INTO projects (id, org_id, name, status, kind) VALUES ($1,$2,$3,'active','workshop')",
      [id, ORG, name],
    ),
  );
  await asApp(ORG, (c) => c.query("INSERT INTO workshops (id, org_id) VALUES ($1,$2)", [id, ORG]));
  if (status === "archived") {
    await asApp(ORG, (c) => c.query("UPDATE projects SET status = 'archived' WHERE id = $1", [id]));
  }
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  identity = new PgIdentityRepository(db);
  repo = new PgProjectListRepository(db);
  orgs = new PgOrgLifecycleRepository(db);
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
  await addOrgMember(ORG, LEAD, "lead", null);
}, HOOK_TIMEOUT_MS);

describe("F122：归档容器——显示且标注只读，不消失", () => {
  it("已归档容器仍出现在 managed 段，readOnlyReason = 'archived'", async () => {
    await createProjectRow("f122-ro-archived", "已归档的容器", "archived");

    const out = await listProjects({ repo, identity }, { orgId: toOrgId(ORG), actorId: LEAD });

    const row = out.find((p) => p.id === "f122-ro-archived");
    expect(row, "归档容器不该从 managed 段消失").toBeDefined();
    expect(row?.status).toBe("archived");
    expect(row?.readOnlyReason).toBe("archived");
  });

  it("活跃容器 readOnlyReason 为 null（可写，不是默认标了只读）", async () => {
    await createProjectRow("f122-ro-active", "活跃容器", "active");

    const out = await listProjects({ repo, identity }, { orgId: toOrgId(ORG), actorId: LEAD });

    const row = out.find((p) => p.id === "f122-ro-active");
    expect(row?.readOnlyReason).toBeNull();
  });
});

describe("F122：组织停用——显示且标注只读，且两种只读原因可分辨", () => {
  it("停用后容器仍出现在列表里，readOnlyReason = 'org-disabled'（不是 'archived'）", async () => {
    await createProjectRow("f122-ro-org-disabled", "组织停用下的活跃容器", "active");

    const at = new Date();
    await orgs.disable(toOrgId(ORG), at, retentionUntil(at));

    const out = await listProjects({ repo, identity }, { orgId: toOrgId(ORG), actorId: LEAD });

    const row = out.find((p) => p.id === "f122-ro-org-disabled");
    expect(row, "组织停用不该让容器从列表消失").toBeDefined();
    // ⚠ 容器自己的 status 仍是 'active'——它没有被归档，只是所属组织被停用。
    expect(row?.status).toBe("active");
    expect(row?.readOnlyReason).toBe("org-disabled");
  });

  it("反证：组织停用后，写这个容器（改名）被数据库拒绝——不是列表把它藏起来才叫「只读」", async () => {
    await createProjectRow("f122-ro-write-blocked", "停用前可写", "active");

    const at = new Date();
    await orgs.disable(toOrgId(ORG), at, retentionUntil(at));

    // 停用之后仍能读到它（否则上一条断言就不成立），但 UPDATE 必须被 RESTRICTIVE
    // 策略拒绝——这条继承自 F22 `kernel_apply_org_freeze_policies()`，是「只读」
    // 这两个字在数据库层的全部含义：不是列表软性隐藏一个仍然可写的东西。
    await expect(
      asApp(ORG, (c) =>
        c.query("UPDATE projects SET name = $1 WHERE id = $2", ["改名被拒", "f122-ro-write-blocked"]),
      ),
    ).rejects.toThrow();

    const stillThere = await asOwner((c) =>
      c.query<{ name: string }>("SELECT name FROM projects WHERE id = $1", ["f122-ro-write-blocked"]),
    );
    expect(stillThere.rows[0]?.name).toBe("停用前可写");
  });

  it("两种只读原因同时成立时（已归档 + 组织停用），呈现的是 'archived'（容器自己的因果更近）", async () => {
    await createProjectRow("f122-ro-both-reasons", "既归档又在停用组织里", "archived");

    const at = new Date();
    await orgs.disable(toOrgId(ORG), at, retentionUntil(at));

    const out = await listProjects({ repo, identity }, { orgId: toOrgId(ORG), actorId: LEAD });

    const row = out.find((p) => p.id === "f122-ro-both-reasons");
    expect(row, "两个只读原因都成立时容器仍不该消失").toBeDefined();
    expect(row?.readOnlyReason).toBe("archived");
  });
});
