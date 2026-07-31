/**
 * F124 —— **I-P39** 归档的四个连带行为（U-2，2026-07-30 已裁）。
 *
 *   ⑴ 可逆（`unarchiveProject` 存在）
 *   ⑵ 有 `active` 议程环节时拒绝归档
 *   ⑶ 归档容器的 artifact 仍可被下游引用（仍受 I-14「只能引 pinned」约束）
 *   ⑷ Context Pack 默认不召回归档内容，可显式请求
 *
 * 外加 I-P38 第三条断言：**归档不产生任何删除**（`artifact_versions` /
 * `provenance_events` 行数差为 0）——这是本文件而不是
 * `archive-readonly-and-readable.test.ts` 的职责，因为它测的是「归档这个动作
 * 本身做了什么」，不是「归档之后写入是否被拒」。
 *
 * ## ⑶⑷ 为什么本文件不写断言，只写 `it.todo`
 *
 * ⑶「仍可引用」在当前实现里**没有新代码**：归档只影响 `projects.status` 与本迁移
 * 新增的 RESTRICTIVE 冻结，读路径（含「下游引用某个 artifact」的查询）完全不受
 * 影响，这本身就是「读仍可用」这条断言（见另一文件）覆盖的性质。写一条形如
 * 「归档后仍能读到 artifact」的测试只是在重复那条断言,不会多验证任何新代码。
 * ⑷ 需要修订 phase-00 **已签核**的 `context-pack` 契约（`QueryContext` 加显式开关，
 * `contracts/project/domain.md` U-2⑷ 逐字「签核动作不是实现动作」）——这不是本
 * feature 能单方面做的事,已在 issue #104 里作为判断/缺口报告。`it.todo` 把这个
 * 缺口钉在测试文件里,而不是让它安静地不存在。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PgProjectArchiveRepository } from "../../src/infrastructure/project/pg-project-archive-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import {
  addOrgMember,
  asApp,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedAgendaSegment,
} from "../support/db";

const ORG = "f124-4c-org";
const LEAD = "u-f124-4c-lead";
const HOOK_TIMEOUT_MS = 120_000;

let db: PgDatabase;
let repo: PgProjectArchiveRepository;

async function createWorkshop(id: string): Promise<void> {
  await asApp(ORG, (c) =>
    c.query("INSERT INTO projects (id, org_id, name, status, kind) VALUES ($1,$2,$3,'active','workshop')", [
      id, ORG, `workshop ${id}`,
    ]),
  );
  await asApp(ORG, (c) => c.query("INSERT INTO workshops (id, org_id) VALUES ($1,$2)", [id, ORG]));
}

async function countAll(table: string): Promise<number> {
  const r = await asApp(ORG, (c) => c.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`));
  return Number(r.rows[0]!.n);
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

describe("I-P38 ③：归档不产生任何删除", () => {
  it("artifact_versions / provenance_events 行数差为 0", async () => {
    const id = `${ORG}-p-noop-delete`;
    await createWorkshop(id);

    const beforeVersions = await countAll("artifact_versions");
    const beforeEvents = await countAll("provenance_events");

    const outcome = await repo.archive(toOrgId(ORG), id);
    expect(outcome.kind).toBe("archived");

    expect(await countAll("artifact_versions"), "归档不得删除任何 artifact 版本行").toBe(beforeVersions);
    expect(await countAll("provenance_events"), "归档不得删除任何审计行").toBe(beforeEvents);

    // 容器与其挂载表本身也必须原样都在——归档是状态翻转，不是级联清除。
    const workshopRows = await asApp(ORG, (c) =>
      c.query<{ n: string }>("SELECT count(*)::text AS n FROM workshops WHERE id = $1", [id]),
    );
    expect(Number(workshopRows.rows[0]!.n)).toBe(1);
  });
});

describe("I-P39 ⑴：归档可逆", () => {
  it("unarchiveProject 存在且把状态翻回 active", async () => {
    const id = `${ORG}-p-reversible-4c`;
    await createWorkshop(id);

    await repo.archive(toOrgId(ORG), id);
    const un = await repo.unarchive(toOrgId(ORG), id);
    expect(un.kind).toBe("unarchived");

    const row = await asApp(ORG, (c) =>
      c.query<{ status: string }>("SELECT status FROM projects WHERE id = $1", [id]),
    );
    expect(row.rows[0]?.status).toBe("active");
  });

  it("对已经是 active 的容器解归档：无条件幂等，不报错", async () => {
    const id = `${ORG}-p-already-active`;
    await createWorkshop(id);

    const un = await repo.unarchive(toOrgId(ORG), id);
    expect(un.kind).toBe("unarchived");
  });
});

describe("I-P39 ⑵：有 active 议程环节时拒绝归档（U-2⑵，失败码故意未命名——见 KNOWN_CONTRACT_GAPS.P7）", () => {
  it("workshop 存在一条 active 环节时，archive() 报告 active-segment-exists 而不是真的归档", async () => {
    const id = `${ORG}-p-active-segment`;
    await createWorkshop(id);
    await seedAgendaSegment(ORG, id, `${id}-seg-0`);
    // `seedAgendaSegment` 默认建成 'pending'；这里显式推进为 'active'，
    // 因为这条测试要断言的正是「有 active 环节」这个前置条件本身。
    await asApp(ORG, (c) =>
      c.query("UPDATE agenda_segments SET state = 'active' WHERE id = $1", [`${id}-seg-0`]),
    );

    const outcome = await repo.archive(toOrgId(ORG), id);
    expect(outcome.kind).toBe("active-segment-exists");

    // 反证：容器必须仍是 active——「拒绝归档」不是「归档但打个折」。
    const row = await asApp(ORG, (c) =>
      c.query<{ status: string }>("SELECT status FROM projects WHERE id = $1", [id]),
    );
    expect(row.rows[0]?.status, "被拒的归档不得让容器状态发生任何改变").toBe("active");
  });

  it("反证：环节是 closed/skipped（非 active）时，归档正常放行", async () => {
    const id = `${ORG}-p-closed-segment`;
    await createWorkshop(id);
    await seedAgendaSegment(ORG, id, `${id}-seg-1`);
    await asApp(ORG, (c) =>
      c.query("UPDATE agenda_segments SET state = 'closed' WHERE id = $1", [`${id}-seg-1`]),
    );

    const outcome = await repo.archive(toOrgId(ORG), id);
    expect(outcome.kind).toBe("archived");
  });

  // ⚠ 单向断言（只测「有 active 就拒」）会被一个「永远拒绝归档」的实现全绿地骗过。
  // 上面这条 closed/skipped 放行的用例就是反证——没有它，「拒绝」读起来像覆盖，
  // 而它其实什么都没覆盖（同 `usecases.md` 对 STEP_CLOSED/STEP_REJECTS 那条纪律）。

  it.todo(
    "⑶ 归档容器的 artifact 仍可被下游引用（仍受 I-14『只能引 pinned』约束）—— " +
      "无新代码路径，读路径不受归档影响；另文件『读仍可用』断言已覆盖同一性质，此处留痕不重复断言",
  );

  it.todo(
    "⑷ Context Pack 默认不召回归档内容，可显式请求 —— 需要修订 phase-00 已签核的 " +
      "context-pack 契约（QueryContext 加显式开关，contracts/project/domain.md U-2⑷）," +
      "签核动作不是实现动作，本 feature 不越权代做，见 issue #104 报告",
  );
});
