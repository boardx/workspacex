/**
 * F06 -- uc-11-5 AC4/D-29/V8/V9: 「我的今天」与看板视图必须读同一套 `status` enum、
 * 同一张任务表，不新建状态字段/分区列，也不复制一份卡数据。
 *
 * Real Postgres round trip: create a task, change its status through the SAME write path
 * F01/F02 already ship (`changeTaskStatusWithWriteback`), then read it back through BOTH
 * `getMyToday` (F06) and `listTasks` (F02) and assert they report the identical status for
 * the identical card id -- proving there is exactly one source of truth, not by inspection
 * of the code but by an end-to-end write-then-read-twice assertion.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTask } from "../../src/application/board/create-task";
import { changeTaskStatusWithWriteback } from "../../src/application/board/change-task-status-with-writeback";
import { getMyToday } from "../../src/application/board/get-my-today";
import { listTasks } from "../../src/application/board/list-tasks";
import { ManualSourceWriteback } from "../../src/application/board/writeback-port";
import { PgTaskRepository, PgTaskStatusAuditWriter } from "../../src/infrastructure/board/pg-task-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { migrateOnce, resetOrgs, seedOrg } from "../support/db";

const ORG = "f06-same-source-org";
const PROJECT = "f06-same-source-project";
const ME = "u-me-f06";
const HOOK_TIMEOUT_MS = 120_000;

describe("F06 same-source assertion (real Postgres)", () => {
  let db: PgDatabase;
  let tasks: PgTaskRepository;
  let audit: PgTaskStatusAuditWriter;

  beforeAll(async () => {
    await migrateOnce();
    await resetOrgs(ORG);
    await seedOrg({ orgId: ORG, projectId: PROJECT });
    db = new PgDatabase(appConfig());
    tasks = new PgTaskRepository();
    audit = new PgTaskStatusAuditWriter();
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await resetOrgs(ORG);
    await db.close();
  });

  it("V8: after changing status via the write path, 我的今天 and 看板列表 agree on the same status for the same card id", async () => {
    // 逾期 due date + status=todo -> lands in ② 今天该我推进 before any status change.
    const created = await createTask(
      { db, tasks },
      { orgId: toOrgId(ORG), projectId: PROJECT, title: "同源断言用卡", ownerUserId: ME, dueAt: "2000-01-01T00:00:00.000Z" },
    );

    const now = new Date();
    const before = await getMyToday(
      { db, tasks },
      { orgId: toOrgId(ORG), userId: ME, role: "org-wide-admin", groupId: null, now },
    );
    expect(before.sections.my_push_today.some((c) => c.id === created.id)).toBe(true);

    // The SAME write path uc-11-1 uses (F01's changeTaskStatus, wrapped by F02's writeback).
    await changeTaskStatusWithWriteback(
      { db, tasks, audit, writeback: new ManualSourceWriteback() },
      { orgId: toOrgId(ORG), taskId: created.id, actorId: ME, toStatus: "review", sourceKind: "手工创建" },
    );

    const afterToday = await getMyToday(
      { db, tasks },
      { orgId: toOrgId(ORG), userId: ME, role: "org-wide-admin", groupId: null, now },
    );
    const afterBoard = await listTasks(
      { db, tasks },
      { orgId: toOrgId(ORG), userId: ME, scope: "global", role: "org-wide-admin", groupId: null, now },
    );

    // Same card, same enum value, reported by two independent use cases reading the same table.
    const cardInToday = [
      ...afterToday.sections.awaiting_my_judgment, ...afterToday.sections.my_push_today,
      ...afterToday.sections.ai_running_for_me, ...afterToday.sections.waiting_on_others,
    ].find((c) => c.id === created.id);
    const cardInBoard = afterBoard.cards.find((c) => c.id === created.id);

    expect(cardInToday?.status).toBe("review");
    expect(cardInBoard?.status).toBe("review");
    expect(cardInToday?.status).toBe(cardInBoard?.status);

    // The status transition moved it OUT of ② (my_push_today) and into ① (review => 待验收).
    expect(afterToday.sections.my_push_today.some((c) => c.id === created.id)).toBe(false);
    expect(afterToday.sections.awaiting_my_judgment.some((c) => c.id === created.id)).toBe(true);
  });

  it("V9: the tasks table has no persisted 'section'/'my_today_section' column -- section membership is derived, not stored", async () => {
    const cols = await db.withTenant(toOrgId(ORG), (s) =>
      s.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'tasks'`,
      ));
    const names = cols.rows.map((r) => r.column_name.toLowerCase());
    expect(names.some((n) => n.includes("section"))).toBe(false);
  });
});
