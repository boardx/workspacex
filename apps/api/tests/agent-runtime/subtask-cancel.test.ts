import { expect, it } from "vitest";
import { InMemorySubtaskRunStore } from "../../src/infrastructure/agent-run/in-memory-subtask-run-store";
import { toOrgId } from "../../src/domain/org-id";

it("cancels pending atomically, is idempotent, and rejects late finish", async () => {
  const store = new InMemorySubtaskRunStore(); const org = toOrgId('cancel-test');
  const run = await store.enqueue(org, { parentRunId: 'parent', description: 'pending' });
  expect((await store.cancel(org, 'wrong-parent', run.id)).kind).toBe('not_found');
  expect((await store.cancel(toOrgId('other'), 'parent', run.id)).kind).toBe('not_found');
  expect((await store.cancel(org, 'parent', run.id)).kind).toBe('cancelled');
  expect((await store.cancel(org, 'parent', run.id)).kind).toBe('cancelled');
  expect(await store.claimQueued(org, 1)).toEqual([]);
  await store.complete(org, run.id, 'late'); await store.fail(org, run.id, 'late');
  expect(await store.get(org, run.id)).toMatchObject({ status: 'cancelled', result: null, error: null });
});
it("claim wins cancellation and finished tasks remain terminal", async () => {
  const store = new InMemorySubtaskRunStore(); const org = toOrgId('cancel-test');
  const run = await store.enqueue(org, { parentRunId: 'parent', description: 'pending' });
  await store.claimQueued(org, 1);
  expect((await store.cancel(org, 'parent', run.id)).kind).toBe('cancellation_not_supported_for_running');
  await store.complete(org, run.id, 'done');
  expect((await store.cancel(org, 'parent', run.id)).kind).toBe('terminal_conflict');
});
