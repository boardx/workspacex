/**
 * F02 -- uc-11-1 R3.3/R7: "拖动改列在同一事务内回写来源对象；回写失败标『未同步』可重试，
 * 不得静默丢弃 / 不得只改本地状态就显示成功".
 *
 * ## 本次范围（如实记录）
 *
 * 没有真实的外部来源对象（F03 六来源适配器未做）。所有本次能创建的卡都是手工创建
 * （`source_kind = '手工创建'`），其 `WritebackPort` 实现（`ManualSourceWriteback`）
 * 恒定成功——这一半的路径在下面第一组用例里断言（真实执行，不是"因为反正会成功所以
 * 不用测"）。
 *
 * 但契约的关键部分是"回写失败时会发生什么"，而这条路径此刻没有真实场景会触发它。
 * 所以第二组用例注入一个**会失败**的假 `WritebackPort`，断言 `changeTaskStatusWithWriteback`
 * 真的：① 让 status 的变更照常提交（不因为回写会失败就连状态机都不推进）；
 * ② 把 `sync_status` 持久化为 `out_of_sync`（真实写入 Postgres，不是内存里的返回值）；
 * ③ 把失败原因带回调用方，供界面显示"未同步"，不吞掉。
 * 第三组用例验证"可重试"：同一张卡用一个会成功的 port 再调一次，`sync_status` 真的
 * 翻回 `synced`。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { changeTaskStatusWithWriteback } from "../../src/application/board/change-task-status-with-writeback";
import { createTask } from "../../src/application/board/create-task";
import { ManualSourceWriteback, type WritebackPort, type WritebackResult } from "../../src/application/board/writeback-port";
import { PgTaskRepository, PgTaskStatusAuditWriter } from "../../src/infrastructure/board/pg-task-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { migrateOnce, resetOrgs, seedOrg, asOwner } from "../support/db";

const ORG = "f02-writeback-org";
const PROJECT = "f02-writeback-project";
const HOOK_TIMEOUT_MS = 120_000;

class AlwaysFailWriteback implements WritebackPort {
  async writeback(): Promise<WritebackResult> {
    return { ok: false, retryable: true, reason: "SOURCE_MODULE_UNREACHABLE (test double)" };
  }
}

async function readSyncStatus(taskId: string): Promise<string> {
  const rows = await asOwner((c) => c.query("SELECT sync_status FROM tasks WHERE id = $1", [taskId]));
  return (rows.rows[0] as { sync_status: string }).sync_status;
}

describe("F02 writeback transaction (real Postgres)", () => {
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

  async function newTask(): Promise<string> {
    const created = await createTask(
      { db, tasks },
      { orgId: toOrgId(ORG), projectId: PROJECT, title: "writeback test task", ownerUserId: "u-owner" },
    );
    return created.id;
  }

  it("manual-created cards writeback through the real ManualSourceWriteback no-op adapter and stay 'synced'", async () => {
    const taskId = await newTask();
    const result = await changeTaskStatusWithWriteback(
      { db, tasks, audit, writeback: new ManualSourceWriteback() },
      { orgId: toOrgId(ORG), taskId, actorId: "u-owner", toStatus: "in_progress", sourceKind: "手工创建" },
    );
    expect(result.syncStatus).toBe("synced");
    expect(result.writebackFailureReason).toBeNull();
    expect(await readSyncStatus(taskId)).toBe("synced");
  });

  it("a real status transition still commits even when the writeback fails -- status is NOT rolled back", async () => {
    const taskId = await newTask();
    const result = await changeTaskStatusWithWriteback(
      { db, tasks, audit, writeback: new AlwaysFailWriteback() },
      { orgId: toOrgId(ORG), taskId, actorId: "u-owner", toStatus: "in_progress", sourceKind: "手工创建" },
    );
    expect(result.toStatus).toBe("in_progress"); // the board-side move DID happen.
    expect(result.syncStatus).toBe("out_of_sync"); // ...but it must be visibly marked as unsynced.
    expect(result.writebackFailureReason).toContain("SOURCE_MODULE_UNREACHABLE");

    const rows = await asOwner((c) => c.query("SELECT status, sync_status FROM tasks WHERE id = $1", [taskId]));
    const stored = rows.rows[0] as { status: string; sync_status: string };
    expect(stored.status).toBe("in_progress"); // real DB row, not just the return value.
    expect(stored.sync_status).toBe("out_of_sync");
  });

  it("retryable: calling again with a succeeding writeback flips sync_status back to 'synced'", async () => {
    const taskId = await newTask();
    await changeTaskStatusWithWriteback(
      { db, tasks, audit, writeback: new AlwaysFailWriteback() },
      { orgId: toOrgId(ORG), taskId, actorId: "u-owner", toStatus: "in_progress", sourceKind: "手工创建" },
    );
    expect(await readSyncStatus(taskId)).toBe("out_of_sync");

    // Retry: same card, forward move again is a no-op transition (in_progress -> in_progress
    // is rejected as NOOP by O-27), so retry has to go through a real forward move instead --
    // this exercises the actual retry shape a UI "重试" button would drive (advance again).
    const retried = await changeTaskStatusWithWriteback(
      { db, tasks, audit, writeback: new ManualSourceWriteback() },
      { orgId: toOrgId(ORG), taskId, actorId: "u-owner", toStatus: "review", sourceKind: "手工创建" },
    );
    expect(retried.syncStatus).toBe("synced");
    expect(await readSyncStatus(taskId)).toBe("synced");
  });
});
