/**
 * Regression test for a real R5 gap found in independent review of PR #2432: `list`,
 * `myToday`, and `create` on `BoardController` all call `resolveProjectRole` (observer ->
 * 403, non-privileged -> scoped) before touching a task, but `changeStatus`
 * (`PATCH /tasks/:id/status`) did not call it at all -- so ANY authenticated org member,
 * including an `observer` and a `member`/`groupLead` outside the card's own group, could
 * flip any task's status merely by knowing its id. `pg-task-repository.ts`'s own header
 * comment claimed a "写前置检查" ("write pre-check") lived in `board.controller.ts`; it did
 * not exist until this fix.
 *
 * This is a fast, no-database unit test (fakes for every port) precisely so this guard has
 * coverage even in a sandbox without Docker/Postgres -- the real-Postgres suites
 * (`pg-task-repository-guard.test.ts` etc.) cover the read-side SQL shape; this one covers
 * the controller-level authorization decision that sits in front of the write.
 */
import { describe, expect, it } from "vitest";
import { BoardController } from "../../src/interface/controllers/board.controller";
import type { TaskRepository, TaskRow, TaskStatusAuditWriter } from "../../src/application/board/ports";
import type { DatabasePort, TenantSession } from "../../src/application/ports/database.port";
import type { IdentityRepository, OrgMembershipRow, ProjectMembershipRow } from "../../src/application/identity/ports";
import type { RawTaskRow } from "../../src/domain/board/card-render";
import { toOrgId, type OrgId } from "../../src/domain/org-id";
import { ForbiddenException } from "@nestjs/common";

const ORG = toOrgId("f02-write-guard-org");
const PROJECT = "f02-write-guard-project";

function fakeSession(): TenantSession {
  return { query: async () => ({ rows: [] }) };
}

function fakeDb(): DatabasePort {
  return {
    withTenant: async (_orgId, fn) => fn(fakeSession()),
    withoutTenant: async (fn) => fn(fakeSession()),
    close: async () => {},
  };
}

/** One in-memory task row, keyed by id, plus enough of `TaskRepository` for `changeStatus`. */
function fakeTaskRepository(row: TaskRow): TaskRepository & { visibleRows: RawTaskRow[] } {
  const repo = {
    visibleRows: [] as RawTaskRow[],
    async getByIdWithin(): Promise<TaskRow | null> {
      return row;
    },
    async updateStatusWithin(): Promise<void> {},
    async updateSyncStatusWithin(): Promise<void> {},
    async createWithin(): Promise<void> {},
    async listVisibleWithin(): Promise<readonly RawTaskRow[]> {
      return repo.visibleRows;
    },
  };
  return repo;
}

function fakeAudit(): TaskStatusAuditWriter {
  return { appendWithin: async () => "audit-1" };
}

function fakeIdentity(membership: ProjectMembershipRow | null, org: OrgMembershipRow | null = null): IdentityRepository {
  // Only the two methods `resolveProjectRole` calls are exercised by this test; the rest of
  // `IdentityRepository` is irrelevant to the R5 write-path guard under test.
  return {
    findOrgMembership: async () => org,
    findProjectMembership: async () => membership,
  } as unknown as IdentityRepository;
}

function controllerFor(
  task: TaskRow,
  identity: IdentityRepository,
  visibleRows: RawTaskRow[] = [],
): BoardController {
  const tasks = fakeTaskRepository(task);
  tasks.visibleRows = visibleRows;
  return new BoardController(tasks, fakeAudit(), fakeDb(), identity);
}

const BASE_TASK: TaskRow = {
  id: "task-1",
  orgId: ORG,
  projectId: PROJECT,
  status: "todo",
  ownerUserId: "u-owner",
  executor: null,
};

describe("BoardController.changeStatus -- R5 write-path guard (found by independent review)", () => {
  it("rejects an observer with 403, not a silent status change", async () => {
    const identity = fakeIdentity({ projectRole: "observer", groupId: null, isHost: false });
    const controller = controllerFor(BASE_TASK, identity);

    await expect(
      controller.changeStatus({ userId: "u-observer", orgId: ORG }, "task-1", { toStatus: "in_progress" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects a member trying to move a card outside their own/group visibility", async () => {
    const identity = fakeIdentity({ projectRole: "member", groupId: "group-a", isHost: false });
    // `listVisibleWithin` (the same read-side rule) would not have returned this card for
    // this caller -- so the write must be refused too, mirroring the read rule exactly.
    const controller = controllerFor(BASE_TASK, identity, /* visibleRows */ []);

    await expect(
      controller.changeStatus({ userId: "u-stranger", orgId: ORG }, "task-1", { toStatus: "in_progress" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("allows a member who owns the card (it would appear in their own listVisibleWithin)", async () => {
    const identity = fakeIdentity({ projectRole: "member", groupId: "group-a", isHost: false });
    const visibleRow = { id: "task-1" } as RawTaskRow;
    const controller = controllerFor(BASE_TASK, identity, [visibleRow]);

    const result = await controller.changeStatus(
      { userId: "u-owner", orgId: ORG },
      "task-1",
      { toStatus: "in_progress" },
    );
    expect(result.toStatus).toBe("in_progress");
  });

  it("allows a facilitator/org-wide-admin to move any card in the project without a visibility round-trip", async () => {
    const identity = fakeIdentity({ projectRole: "facilitator", groupId: null, isHost: false });
    const controller = controllerFor(BASE_TASK, identity);

    const result = await controller.changeStatus(
      { userId: "u-facilitator", orgId: ORG },
      "task-1",
      { toStatus: "in_progress" },
    );
    expect(result.toStatus).toBe("in_progress");
  });

  it("a project-less (inbox) card can only be moved by its own owner/executor", async () => {
    const task: TaskRow = { ...BASE_TASK, projectId: null, ownerUserId: "u-owner", executor: "u-exec" };
    const identity = fakeIdentity(null);
    const controller = controllerFor(task, identity);

    await expect(
      controller.changeStatus({ userId: "u-stranger", orgId: ORG }, "task-1", { toStatus: "in_progress" }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const asExecutor = await controller.changeStatus(
      { userId: "u-exec", orgId: ORG },
      "task-1",
      { toStatus: "in_progress" },
    );
    expect(asExecutor.toStatus).toBe("in_progress");
  });
});
