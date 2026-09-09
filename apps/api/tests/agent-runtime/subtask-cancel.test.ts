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
it("running cancellation is durable and late results remain suppressed", async () => {
  const store = new InMemorySubtaskRunStore(); const org = toOrgId('cancel-test');
  const run = await store.enqueue(org, { parentRunId: 'parent', description: 'pending' });
  await store.claimQueued(org, 1);
  expect((await store.cancel(org, 'parent', run.id)).kind).toBe('cancel_requested');
  await store.complete(org, run.id, 'done');
  expect(await store.get(org,run.id)).toMatchObject({status:'cancelled',result:null});
  expect((await store.cancel(org, 'parent', run.id)).kind).toBe('cancelled');
});

/**
 * F5 反证（run 34409361606 / job 102659917921）：父 run 取消后子任务确实停了，
 * 但终态落在 `failed`；两分钟后对账把 cancellation 确认成 `confirmed` —— 系统此刻
 * 明知这是被取消的 —— 终态**仍然**是 `failed`，于是"用户主动取消"与"真出错"在界面上
 * 分不开。终态必须在**数据**上是 `cancelled`，不许只在展示层翻译。
 */
it("reconciliation that confirms the cancellation moves the terminal state to cancelled", async () => {
  const store = new InMemorySubtaskRunStore(); const org = toOrgId('cancel-reconcile');
  const run = await store.enqueue(org, { parentRunId: 'parent', description: 'stop me' });
  await store.claimQueued(org, 1);
  expect((await store.cancel(org, 'parent', run.id)).kind).toBe('cancel_requested');
  await store.bindRemoteRun(org, run.id, 'remote-1', 'thread-1');
  // 停机结果未知：这一跳落 failed + unknown 是对的（还没证据说它是被取消的）。
  await store.fail(org, run.id, 'aborted mid-flight');
  expect(await store.get(org, run.id)).toMatchObject({ status: 'failed', error: 'subtask_cancel_unknown', cancellation: { state: 'unknown' } });
  // 对账拿到了证据：远端 run 确实是被取消停下的。
  await store.recordCancellation(org, run.id, 'confirmed', 'remote-1');
  expect(await store.get(org, run.id)).toMatchObject({ status: 'cancelled', result: null, error: null, cancellation: { state: 'confirmed' } });
});

/**
 * 语义边界：**取消之前**就真的因别的原因失败的子任务必须保持 `failed` 并保留它自己的
 * 错因——不许为了让取消链路好看，把所有失败都翻译成取消。
 */
it("a subtask that genuinely failed before any cancellation stays failed with its own error", async () => {
  const store = new InMemorySubtaskRunStore(); const org = toOrgId('cancel-boundary');
  const run = await store.enqueue(org, { parentRunId: 'parent', description: 'really broken' });
  await store.claimQueued(org, 1);
  await store.fail(org, run.id, 'model_call_failed');
  expect(await store.get(org, run.id)).toMatchObject({ status: 'failed', error: 'model_call_failed' });
  expect(await store.get(org, run.id)).not.toHaveProperty('cancellation');
  // 取消请求到达一个已终态且非取消所致的 run:拒绝,且对账不得把它翻成 cancelled。
  expect((await store.cancel(org, 'parent', run.id)).kind).toBe('terminal_conflict');
  await store.recordCancellation(org, run.id, 'confirmed', null);
  expect(await store.get(org, run.id)).toMatchObject({ status: 'failed', error: 'model_call_failed' });
});
