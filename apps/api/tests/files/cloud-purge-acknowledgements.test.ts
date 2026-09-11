import { expect, it, vi } from "vitest";
import { runPhysicalDeletion, type RunPhysicalDeletionDeps } from "../../src/application/files/run-physical-deletion";
import { ORG, FakeProvenanceWriter, SeqIdFactory } from "../support/trash-compliance-fakes";

it.each([
  [{ objectKey: "wrong", deleted: true }, { objectKey: "other", deleted: true }],
  [{ objectKey: "one", deleted: true }, { objectKey: "one", deleted: true }],
  [{ objectKey: "one", deleted: true }, { objectKey: "two", deleted: false }],
])("refuses a receipt unless every actual object key is acknowledged: %j", async (...results) => {
  const mark = vi.fn(), save = vi.fn();
  const deps: RunPhysicalDeletionDeps = {
    tasks: { listPendingPhysicalDeletion: async () => [{ taskId: "task", artifactId: "artifact", status: "running",
      receiptId: null, physicalDeletionDeadline: new Date(0), objects: ["one", "two"].map(objectKey => ({ objectKey, sha256: null })) }], markPhysicallyDeleted: mark },
    legalHold: { isActive: async () => false }, purge: { purgeAll: async () => results },
    receipts: { save, find: async () => null }, impact: { findDeletable: async () => null, countsFor: vi.fn() },
    ids: new SeqIdFactory(), provenance: new FakeProvenanceWriter(), now: () => new Date(), executor: "system",
  };
  expect(await runPhysicalDeletion(deps, ORG)).toEqual([{ taskId: "task", outcome: "skipped-purge-failed" }]);
  expect(mark).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
});
