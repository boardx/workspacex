/**
 * F124 —— **I-P38**：项目容器归档 = 只读降级。三方向：
 *   ① 写被拒（INSERT / UPDATE / DELETE，挂在容器上的表）
 *   ② 读仍然可用（反向断言——只有 ① 一条时，一个「归档即 404」的实现也会全绿）
 *   ③ 解归档后又能写（可逆，U-2⑴）
 *
 * ## 为什么直接用 `asApp` 裸打库，不走业务路由
 *
 * 冻结声称的性质是「**任何**写都被挡」——挑一条业务路由验，验的只是那条路由。
 * `asApp` 是生产运行时同一个角色、同一条 `SET LOCAL app.current_org` 路径，没有
 * 任何应用层过滤，与 `org-disabled-readonly.test.ts` 的理由完全相同。
 *
 * ## 为什么覆盖两类表：`workshops`（列名 `id`）与 `groups`（列名 `project_id`）
 *
 * 迁移 `20260801120000_f124_*.sql` 的冻结函数分两路推导「哪些表挂着项目容器」：
 * catalog 推导的 `project_id` 外键表，与显式列出的「列名不叫 project_id」的三张
 * 子类型表 + `agenda_segments`。只测其中一类，另一类的冻结缺口不会被任何断言看见。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PgProjectArchiveRepository } from "../../src/infrastructure/project/pg-project-archive-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs } from "../support/db";

const ORG = "f124-ro-org";
const LEAD = "u-f124-ro-lead";
const HOOK_TIMEOUT_MS = 120_000;

let db: PgDatabase;
let repo: PgProjectArchiveRepository;

async function createWorkshop(id: string, status: "active" | "archived" = "active"): Promise<void> {
  await asApp(ORG, (c) =>
    c.query("INSERT INTO projects (id, org_id, name, status, kind) VALUES ($1,$2,$3,$4,'workshop')", [
      id, ORG, `workshop ${id}`, status,
    ]),
  );
  await asApp(ORG, (c) => c.query("INSERT INTO workshops (id, org_id) VALUES ($1,$2)", [id, ORG]));
}

/** 一次真实的写。返回 null = 成功，否则是被拒的原因（同 `org-disabled-readonly.test.ts` 的 `tryWrite`）。 */
async function tryInsertGroup(projectId: string, groupId: string): Promise<string | null> {
  try {
    await asApp(ORG, (c) =>
      c.query("INSERT INTO groups (id, org_id, project_id, name) VALUES ($1,$2,$3,'probe')", [
        groupId, ORG, projectId,
      ]),
    );
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgProjectArchiveRepository(db);
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

describe("I-P38 ①+②：归档后写被拒、读仍然通（不是「归档即 404」）", () => {
  it("挂 project_id 的表（groups）：归档前写得进，归档后 INSERT/UPDATE/DELETE 全部被拒", async () => {
    const id = `${ORG}-p-groups`;
    await createWorkshop(id);

    // 先证明这条写路径本来是通的——否则下面的「被拒」可能只是路径本身不能写。
    expect(await tryInsertGroup(id, `${id}-g0`), "归档前必须写得进去").toBeNull();

    const outcome = await repo.archive(toOrgId(ORG), id);
    expect(outcome.kind).toBe("archived");

    const insertErr = await tryInsertGroup(id, `${id}-g1`);
    expect(insertErr, "归档后 INSERT 必须被拒").not.toBeNull();
    expect(insertErr).toMatch(/row-level security|policy/i);

    await expect(
      asApp(ORG, (c) => c.query("UPDATE groups SET name = 'renamed' WHERE project_id = $1", [id])),
    ).rejects.toThrow(/row-level security|policy/i);

    // ⚠ DELETE 单独断言：WITH CHECK 只挡新行，漏了 DELETE 的表现是「插不进改不了但删得掉」。
    const del = await asApp(ORG, (c) => c.query("DELETE FROM groups WHERE project_id = $1", [id]));
    expect(del.rowCount, "DELETE 必须一行都删不掉").toBe(0);
  });

  it("列名不是 project_id 的子类型表（workshops）：归档后同样写被拒", async () => {
    const id = `${ORG}-p-workshop-self`;
    await createWorkshop(id);

    await repo.archive(toOrgId(ORG), id);

    await expect(
      asApp(ORG, (c) => c.query("UPDATE workshops SET org_id = org_id WHERE id = $1", [id])),
    ).rejects.toThrow(/row-level security|policy/i);
  });

  it("读没有被关掉——容器与其挂载表在归档后仍可 SELECT（反证「归档即 404」）", async () => {
    const id = `${ORG}-p-readable`;
    await createWorkshop(id);
    await tryInsertGroup(id, `${id}-g0`);

    await repo.archive(toOrgId(ORG), id);

    const project = await asApp(ORG, (c) =>
      c.query<{ status: string }>("SELECT status FROM projects WHERE id = $1", [id]),
    );
    expect(project.rows[0]?.status, "归档后容器行本身必须仍然可读").toBe("archived");

    const groups = await asApp(ORG, (c) =>
      c.query<{ n: string }>("SELECT count(*)::text AS n FROM groups WHERE project_id = $1", [id]),
    );
    expect(Number(groups.rows[0]!.n), "归档容器下挂的既有行必须仍然可读").toBeGreaterThan(0);
  });
});

describe("U-2⑴：解归档后又能写（可逆，不是 F22 组织冻结的不可逆形状）", () => {
  it("archive → unarchive → 写恢复正常", async () => {
    const id = `${ORG}-p-reversible`;
    await createWorkshop(id);

    await repo.archive(toOrgId(ORG), id);
    expect(await tryInsertGroup(id, `${id}-g-blocked`)).not.toBeNull();

    const un = await repo.unarchive(toOrgId(ORG), id);
    expect(un.kind).toBe("unarchived");

    expect(await tryInsertGroup(id, `${id}-g-after-unarchive`), "解归档后必须又能写").toBeNull();
  });
});

describe("lint-permission-paths 白名单的反证：仓储只碰 projects/agenda_segments", () => {
  it("pg-project-archive-repository.ts 不引用其它租户表（豁免的全部依据）", () => {
    const src = fileURLToPath(
      new URL("../../src/infrastructure/project/pg-project-archive-repository.ts", import.meta.url),
    );
    const body = readFileSync(src, "utf8");
    const code = body
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join("\n");

    // 非空转：文件确实被读到了，且它确实在碰这两张表。
    expect(code).toMatch(/FROM projects/);
    expect(code).toMatch(/UPDATE projects/);
    expect(code).toMatch(/agenda_segments/);

    const refs = [...code.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi)].map((m) => m[1]!.toLowerCase());
    const other = refs.filter((t) => t !== "projects" && t !== "agenda_segments");
    expect(other, `不应出现的表引用：${other.join(",")}`).toEqual([]);
  });
});
