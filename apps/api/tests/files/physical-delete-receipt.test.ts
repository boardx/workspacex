/**
 * F46 -- 物理删除 worker + 回执 (uc-22-4 R3.c step 11, E4/E5, N-18/N-19).
 *
 * Per issue #74, in-memory fakes rather than a real Postgres-backed run.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildDeletionReceipt,
  buildUncoverableStatement,
  isEligibleForPhysicalDeletion,
  isOverdue,
  PhysicalDeleteError,
} from "../../src/domain/files/physical-delete";
import { runPhysicalDeletion } from "../../src/application/files/run-physical-deletion";
import { getDeletionReceipt, GetDeletionReceiptError } from "../../src/application/files/get-deletion-receipt";
import type { FindTaskForPurgeRow, PhysicalDeleteTaskRepository, PhysicalPurgePort } from "../../src/application/files/physical-delete-ports";
import {
  FakeDeletionReceiptRepository,
  FakeDeletionTaskRepository,
  FakeLegalHoldRepository,
  FakeProvenanceWriter,
  ORG,
  SeqIdFactory,
} from "../support/trash-compliance-fakes";
import { CASCADE_KINDS, type CascadeResultEntry } from "../../src/domain/files/deletion-cascade";
import type { DeleteImpactRepository } from "../../src/application/files/deletion-ports";

const okCoverage: readonly CascadeResultEntry[] = CASCADE_KINDS.map((kind) => ({ kind, result: "ok", detail: null }));
const partialCoverage: readonly CascadeResultEntry[] = okCoverage.map((r) =>
  r.kind === "ontology-edges" ? { ...r, result: "failed" as const } : r,
);

describe("F46 · domain/files/physical-delete.ts pure rules", () => {
  const deadline = new Date("2026-08-01T00:00:00.000Z");
  const runningTask = { taskId: "t1", status: "running" as const, physicalDeletionDeadline: deadline, receiptId: null };

  it("eligible: status running, past deadline, no legal hold", () => {
    expect(isEligibleForPhysicalDeletion(runningTask, new Date("2026-08-02T00:00:00.000Z"), false)).toBe(true);
  });

  it("not eligible: legal hold active, even past deadline", () => {
    expect(isEligibleForPhysicalDeletion(runningTask, new Date("2026-08-02T00:00:00.000Z"), true)).toBe(false);
  });

  it("not eligible: before the deadline", () => {
    expect(isEligibleForPhysicalDeletion(runningTask, new Date("2026-07-01T00:00:00.000Z"), false)).toBe(false);
  });

  it("🔴 not eligible: partial-failure status, even past deadline and no hold (N-17's ceiling applies here too)", () => {
    const task = { ...runningTask, status: "partial-failure" as const };
    expect(isEligibleForPhysicalDeletion(task, new Date("2026-08-02T00:00:00.000Z"), false)).toBe(false);
  });

  it("not eligible: already has a receipt (idempotent -- do not re-purge a done task)", () => {
    const task = { ...runningTask, receiptId: "rcpt-1" };
    expect(isEligibleForPhysicalDeletion(task, new Date("2026-08-02T00:00:00.000Z"), false)).toBe(false);
  });

  it("E4/R5: overdue is TRUE past the deadline even while a legal hold correctly withholds physical deletion", () => {
    expect(isOverdue(runningTask, new Date("2026-08-02T00:00:00.000Z"))).toBe(true);
    expect(isEligibleForPhysicalDeletion(runningTask, new Date("2026-08-02T00:00:00.000Z"), true)).toBe(false);
  });

  it("a 'done' task is never reported overdue", () => {
    expect(isOverdue({ ...runningTask, status: "done" }, new Date("2026-09-01T00:00:00.000Z"))).toBe(false);
  });

  it("🔴 N-19: no exports -> uncoverableStatement is the explicit '无', never empty/absent", () => {
    expect(buildUncoverableStatement([])).toBe("无");
  });

  it("N-19: an export out of org is named explicitly, not summarized away", () => {
    const statement = buildUncoverableStatement([
      { jobId: "exp-1", exportedAt: "2026-07-01T00:00:00.000Z", exportedBy: "user-x", itemCount: 3 },
    ]);
    expect(statement).toContain("exp-1");
    expect(statement).toContain("user-x");
    expect(statement).not.toBe("");
  });

  it("🔴 buildDeletionReceipt refuses a 'partial-failure' status -- N-17: no receipt for an incomplete cascade", () => {
    expect(() =>
      buildDeletionReceipt({
        taskId: "t1", status: "partial-failure", objectRefs: ["k1"], hashes: ["h1"],
        deletedAt: new Date(), executor: "system", coverage: partialCoverage, exportedOutOfOrg: [],
      }),
    ).toThrow(PhysicalDeleteError);
  });

  it("buildDeletionReceipt succeeds for a 'done' status and carries the uncoverableStatement", () => {
    const receipt = buildDeletionReceipt({
      taskId: "t1", status: "done", objectRefs: ["k1", "k2"], hashes: ["h1"],
      deletedAt: new Date("2026-08-02T00:00:00.000Z"), executor: "system", coverage: okCoverage, exportedOutOfOrg: [],
    });
    expect(receipt.uncoverableStatement).toBe("无");
    expect(receipt.objectRefs).toEqual(["k1", "k2"]);
  });
});

describe("F46 · runPhysicalDeletion worker", () => {
  let tasks: FakeDeletionTaskRepository;
  let legalHold: FakeLegalHoldRepository;
  let receipts: FakeDeletionReceiptRepository;
  let provenance: FakeProvenanceWriter;
  let ids: SeqIdFactory;
  const now = () => new Date("2026-09-01T00:00:00.000Z");

  const artifactWithCounts = (exportedOutOfOrg: readonly { jobId: string; exportedAt: string; exportedBy: string; itemCount: number }[]): DeleteImpactRepository => ({
    findDeletable: async () => null,
    countsFor: async () => ({
      versionCount: 1, derivedCount: 0, segmentCount: 0, referencingClaims: [], referencingReportSections: [], exportedOutOfOrg,
    }),
  });

  function makeTaskRepo(rows: readonly FindTaskForPurgeRow[]): PhysicalDeleteTaskRepository {
    const marked: { taskId: string; receiptId: string }[] = [];
    return {
      listPendingPhysicalDeletion: async () => rows,
      markPhysicallyDeleted: async (_orgId, taskId, receiptId) => {
        marked.push({ taskId, receiptId });
      },
      // test-only introspection
      // @ts-expect-error test helper
      marked,
    };
  }

  const alwaysDeletes: PhysicalPurgePort = {
    purgeAll: async (keys) => keys.map((k) => ({ objectKey: k, deleted: true })),
  };

  const alwaysFails: PhysicalPurgePort = {
    purgeAll: async (keys) => keys.map((k) => ({ objectKey: k, deleted: false })),
  };

  beforeEach(() => {
    tasks = new FakeDeletionTaskRepository();
    legalHold = new FakeLegalHoldRepository();
    receipts = new FakeDeletionReceiptRepository();
    provenance = new FakeProvenanceWriter();
    ids = new SeqIdFactory();
  });

  it("a fully-eligible 'running' task past its deadline is purged, marked done, and gets a receipt", async () => {
    const row: FindTaskForPurgeRow = {
      taskId: "t1", artifactId: "a1", status: "running",
      physicalDeletionDeadline: new Date("2026-08-01T00:00:00.000Z"), receiptId: null,
      objects: [{ objectKey: "a1/v1", sha256: "h".repeat(64) }],
    };
    const taskRepo = makeTaskRepo([row]);
    const outcomes = await runPhysicalDeletion(
      { tasks: taskRepo, legalHold, purge: alwaysDeletes, receipts, impact: artifactWithCounts([]), ids, provenance, now, executor: "system" },
      ORG,
    );
    expect(outcomes).toEqual([{ taskId: "t1", outcome: "deleted" }]);
    const stored = await receipts.find(ORG, "t1");
    expect(stored).not.toBeNull();
    expect(stored!.uncoverableStatement).toBe("无");
    expect(stored!.objectRefs).toEqual(["a1/v1"]);
  });

  it("🔴 a task under an active legal hold is skipped, never purged, never gets a receipt", async () => {
    await legalHold.apply({ holdId: "h1", artifactId: "a1", reason: "hold", appliedBy: "compliance-1", appliedAt: new Date() });
    const row: FindTaskForPurgeRow = {
      taskId: "t1", artifactId: "a1", status: "running",
      physicalDeletionDeadline: new Date("2026-08-01T00:00:00.000Z"), receiptId: null,
      objects: [{ objectKey: "a1/v1", sha256: "h".repeat(64) }],
    };
    const outcomes = await runPhysicalDeletion(
      { tasks: makeTaskRepo([row]), legalHold, purge: alwaysDeletes, receipts, impact: artifactWithCounts([]), ids, provenance, now, executor: "system" },
      ORG,
    );
    expect(outcomes).toEqual([{ taskId: "t1", outcome: "skipped-not-eligible" }]);
    expect(await receipts.find(ORG, "t1")).toBeNull();
  });

  it("E5: object-store purge failure leaves the task un-marked and receiptless (retried on the next sweep)", async () => {
    const row: FindTaskForPurgeRow = {
      taskId: "t1", artifactId: "a1", status: "running",
      physicalDeletionDeadline: new Date("2026-08-01T00:00:00.000Z"), receiptId: null,
      objects: [{ objectKey: "a1/v1", sha256: "h".repeat(64) }],
    };
    const outcomes = await runPhysicalDeletion(
      { tasks: makeTaskRepo([row]), legalHold, purge: alwaysFails, receipts, impact: artifactWithCounts([]), ids, provenance, now, executor: "system" },
      ORG,
    );
    expect(outcomes).toEqual([{ taskId: "t1", outcome: "skipped-purge-failed" }]);
    expect(await receipts.find(ORG, "t1")).toBeNull();
  });

  it("a task not yet past its deadline is skipped as not-eligible", async () => {
    const row: FindTaskForPurgeRow = {
      taskId: "t1", artifactId: "a1", status: "running",
      physicalDeletionDeadline: new Date("2027-01-01T00:00:00.000Z"), receiptId: null,
      objects: [{ objectKey: "a1/v1", sha256: "h".repeat(64) }],
    };
    const outcomes = await runPhysicalDeletion(
      { tasks: makeTaskRepo([row]), legalHold, purge: alwaysDeletes, receipts, impact: artifactWithCounts([]), ids, provenance, now, executor: "system" },
      ORG,
    );
    expect(outcomes).toEqual([{ taskId: "t1", outcome: "skipped-not-eligible" }]);
  });

  it("N-19: an artifact exported out of org before physical deletion gets an honest, non-empty uncoverableStatement in its receipt", async () => {
    const row: FindTaskForPurgeRow = {
      taskId: "t1", artifactId: "a1", status: "running",
      physicalDeletionDeadline: new Date("2026-08-01T00:00:00.000Z"), receiptId: null,
      objects: [{ objectKey: "a1/v1", sha256: "h".repeat(64) }],
    };
    const outcomes = await runPhysicalDeletion(
      {
        tasks: makeTaskRepo([row]), legalHold, purge: alwaysDeletes, receipts,
        impact: artifactWithCounts([{ jobId: "exp-9", exportedAt: "2026-07-01T00:00:00.000Z", exportedBy: "user-x", itemCount: 2 }]),
        ids, provenance, now, executor: "system",
      },
      ORG,
    );
    expect(outcomes).toEqual([{ taskId: "t1", outcome: "deleted" }]);
    const stored = await receipts.find(ORG, "t1");
    expect(stored!.uncoverableStatement).not.toBe("无");
    expect(stored!.uncoverableStatement).toContain("exp-9");
  });
});

describe("F46 · getDeletionReceipt joins the stored receipt with F45's cascade coverage", () => {
  let tasks: FakeDeletionTaskRepository;
  let receipts: FakeDeletionReceiptRepository;

  beforeEach(() => {
    tasks = new FakeDeletionTaskRepository();
    receipts = new FakeDeletionReceiptRepository();
  });

  it("done task + stored receipt -> full response, coverage comes from the task's cascade results", async () => {
    tasks.seed({
      taskId: "t1", artifactId: "a1", status: "done",
      requestedAt: new Date("2026-07-01T00:00:00.000Z"),
      logicalInvalidationDeadline: new Date("2026-07-01T00:05:00.000Z"),
      physicalDeletionDeadline: new Date("2026-08-01T00:00:00.000Z"),
      receiptId: "rcpt-1", cascadeResults: okCoverage,
    });
    await receipts.save(ORG, {
      taskId: "t1", objectRefs: ["a1/v1"], hashes: ["h".repeat(64)],
      deletedAt: "2026-08-02T00:00:00.000Z", executor: "system",
      coverage: [], exportedOutOfOrg: [], uncoverableStatement: "无",
    });

    const out = await getDeletionReceipt({ receipts, tasks }, { orgId: ORG, taskId: "t1" });
    expect(out.coverage).toEqual(okCoverage.map((r) => ({ kind: r.kind, result: r.result })));
    expect(out.uncoverableStatement).toBe("无");
  });

  it("🔴 N-17: a 'partial-failure' task never has a fetchable receipt, even if a row somehow exists", async () => {
    tasks.seed({
      taskId: "t2", artifactId: "a2", status: "partial-failure",
      requestedAt: new Date(), logicalInvalidationDeadline: new Date(), physicalDeletionDeadline: new Date(),
      receiptId: null, cascadeResults: partialCoverage,
    });
    await expect(getDeletionReceipt({ receipts, tasks }, { orgId: ORG, taskId: "t2" })).rejects.toThrow(GetDeletionReceiptError);
  });

  it("unknown task -> DELETION_PARTIAL_FAILURE (collapsed, no NOT_FOUND code on this operation)", async () => {
    await expect(getDeletionReceipt({ receipts, tasks }, { orgId: ORG, taskId: "nope" })).rejects.toThrow(GetDeletionReceiptError);
  });
});
