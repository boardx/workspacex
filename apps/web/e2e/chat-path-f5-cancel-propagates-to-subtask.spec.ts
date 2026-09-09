/**
 * 路径矩阵 **F5 取消传播到子任务**（`.harness/instructions/chat-path-coverage-matrix.md`）——
 * 父取消后子任务**不再产出、不发布晚到产物**。
 *
 * ## 这条路径此前为什么是「部分」
 *
 * 矩阵原文：「`apps/api` 侧有；chat 侧无」。`apps/api` 侧那几条
 * （`tests/agent-runtime/subtask-run-store-real-db.test.ts`、
 *  `tests/agent-run/parent-run-control.test.ts:151`）是在 vitest 里**直接 UPDATE
 * `agent_runs.cancel_requested_at`** 再看存储层怎么反应——它们证的是存储层的语义，
 * 不是「一个真实用户在 chat 里发起的那次 run 被取消之后，它派出去的子任务真的停了」。
 * 中间隔着一整条 chat 链路：真登录 → 真线程 → 真 run → 替身真的调
 * `spawn_async_task` → 真 `SubtaskRunController.enqueue` → 真 `SubtaskRunExecutor`。
 * 这个文件补的是那一段。
 *
 * ## 判据（三条）——「不再产出」必须比「它现在不是 completed」更强
 *
 * 1. **子任务真的被派出去过** —— 取消之前先断言 `GET /agent-runs/:parentRunId/
 *    subtask-runs` 里有一条属于本轮的子任务，且它是 `pending`/`running`。
 *    没有这一条，后面两条就都是空转：一个从没派出去的子任务当然"不产出"。
 *    （本仓九次「全绿但空转」的第一形态就是它。）
 * 2. **取消传到了子任务** —— 取消父 run 之后，那条子任务落到 `cancelled`。
 * 3. **不发布晚到产物** —— **等过子任务本该自然完成的那个点**再复查：
 *    它仍是 `cancelled`、`result` 仍是 `null`、`artifactRefs` 仍是空数组，
 *    并且这条线程的 artifacts 列表里没有多出任何东西。
 *
 * 第 3 条是这条 spec 的重点，也是它**由构造保证、不靠时序运气**的地方：见下面
 * 「窗口是算出来的」。
 *
 * ## 窗口是算出来的，不是赌出来的（矩阵 F3 的教训）
 *
 * F3 那条曾经因为「状态窗口 974ms 短于轮询周期 3000ms」而永远命中不到——两层各自
 * 都对，乘起来是 0。这里的两个窗口都被显式拉开：
 *
 * · **取消要落在子任务仍在跑的窗口里**：子任务那次模型调用打的是同一个 deep-agent
 *   替身，默认只要 2 次状态轮询就终态（一两秒就完事，取消永远追不上）。
 *   `LOOPBACK_DEEP_AGENT_SUBTASK_HOLD_POLLS`（=`deepAgentSubtaskHoldPolls`，60）把它
 *   推迟到至少 60 次轮询之后。判据 1 先证「它此刻确实还在 pending/running」，
 *   所以这不是"我猜它还没完"，是**读出来的**。
 * · **"晚到产物"要有机会真的晚到**：hold 是**有限**的。如果取消没有传到子任务，
 *   它会在 60 轮之后**正常完成并写回结果**。判据 3 等过这个点再看，因此
 *   「取消没传播」会以 `completed` / `result` 非 null 现形——而不是靠"它一直没完成"
 *   这种和"卡住了"分不开的弱信号。
 *
 * ## 为什么取消走权威端点，而不是点界面上的按钮
 *
 * v2 的 chat 界面**今天没有**「取消这一轮」的可点控件（矩阵 F3 记的正是这条缺口：
 * 暂停/恢复/重试单步四个控制都还没有产品能力）。这里不为了"看起来更像 UI 测试"
 * 去发明一个 testid——那会变成断言一个不存在的能力。取消打的是产品自己的那条
 * `POST /agent-runs/:runId/cancel`（`agent-workbench-control-acceptance.spec.ts`
 * 用的同一条），且带着**这个真实浏览器会话自己的登录态**，鉴权一跳不省。
 * 界面侧的取消控件补上之后，把这一步换成点击即可，判据一个字都不用改。
 */
import { expect, test, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import { login, openFreshDeepAgentThread, sessionHeaders } from "./support/chat-path-coverage";

test.setTimeout(300_000);

interface SubtaskRunView {
  readonly id: string;
  readonly status: string;
  readonly result: string | null;
  readonly artifactRefs: readonly unknown[];
  readonly cancellation?: { readonly state: string };
}

async function listSubtasks(page: Page, parentRunId: string): Promise<readonly SubtaskRunView[]> {
  const response = await page.request.get(`/agent-runs/${parentRunId}/subtask-runs`, {
    headers: await sessionHeaders(page),
  });
  expect(response.ok(), `读子任务列表失败：HTTP ${response.status()}`).toBe(true);
  return (await response.json() as { subtaskRuns: SubtaskRunView[] }).subtaskRuns;
}

async function threadArtifactCount(page: Page, threadId: string): Promise<number> {
  const response = await page.request.get(`/chat/threads/${threadId}/artifacts`, {
    headers: await sessionHeaders(page),
  });
  expect(response.ok(), `读线程产物列表失败：HTTP ${response.status()}`).toBe(true);
  const body = await response.json() as { items?: unknown[]; artifacts?: unknown[] };
  return (body.items ?? body.artifacts ?? []).length;
}

test("@path:F5 父 run 取消之后，它派出去的子任务停下来，且不再发布晚到的产物", async ({ page }) => {
  await login(page);
  const threadId = await openFreshDeepAgentThread(page);

  /*
   * 捕获这一轮**真实的 run id**：v2 壳在 run 期间会轮询 `GET /agent-runs/:id`，
   * 手法逐字取自 `agent-workbench-control-acceptance.spec.ts`。不从落库的 agent 回复
   * 上读 `agentRunId`——那要等 run 结束，而这条用例要的正是"它还在跑"的那一刻。
   */
  const liveRun = page.waitForResponse(async (response) => {
    if (response.request().method() !== "GET") return false;
    if (!/\/agent-runs\/[^/?]+$/.test(new URL(response.url()).pathname) || !response.ok()) return false;
    return typeof (await response.json()).runId === "string";
  }, { timeout: 120_000 });

  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentMultiStepTrigger);
  await page.getByTestId("copilotkit-v2-send").click();
  const parentRunId = (await (await liveRun).json() as { runId: string }).runId;

  // ── 判据 1：子任务真的被派出去过，而且此刻确实还没跑完 ───────────────────────
  let subtaskId = "";
  try {
    await expect
      .poll(async () => {
        const live = (await listSubtasks(page, parentRunId))
          .filter((one) => one.status === "pending" || one.status === "running");
        if (live.length > 0) subtaskId = live[0]!.id;
        return live.length;
      }, { timeout: 120_000, intervals: [500, 1_000, 2_000] })
      .toBeGreaterThan(0);
  } catch (failure) {
    /*
     * 「红 ≠ 跑过」：等不到在跑的子任务时，「替身根本没派发」「派发了但立刻就跑完了
     * （hold 旋钮没生效）」「派发失败」是三个不同的结论。把这一刻真实的子任务列表
     * 摘进失败信息，让红自带答案；判据不放宽。
     */
    const all = await listSubtasks(page, parentRunId);
    const detail = all.length === 0
      ? "父 run 下一条子任务都没有——`spawn_async_task` 这一轮没有真的打到 `POST /internal/subtask-runs`"
        + "（通路四个 configurable 键缺一即降级，见替身的 `spawnAsyncTask` 头注）"
      : all.map((one) => `· ${one.id} status=${one.status} result=${JSON.stringify(one.result)}`).join("\n");
    throw new Error(
      `${failure instanceof Error ? failure.message : String(failure)}\n\n`
      + `【诊断】期待父 run ${parentRunId} 下有一条仍在 pending/running 的子任务，实际：\n${detail}\n`
      + `若它们已经是 completed，说明 hold 旋钮（deepAgentSubtaskHoldPolls=`
      + `${String(CHAT_READ_E2E.deepAgentSubtaskHoldPolls)}）没有生效——取消窗口是 0，这条用例测不到东西。`,
    );
  }

  const artifactsBeforeCancel = await threadArtifactCount(page, threadId);

  // ── 取消父 run（真实端点 + 本会话登录态）────────────────────────────────────
  const cancelled = await page.request.post(`/agent-runs/${parentRunId}/cancel`, {
    headers: await sessionHeaders(page),
  });
  expect(cancelled.ok(), `取消父 run 失败：HTTP ${cancelled.status()}`).toBe(true);

  // ── 判据 2：取消传到了子任务 ───────────────────────────────────────────────
  await expect
    .poll(async () => (await listSubtasks(page, parentRunId)).find((one) => one.id === subtaskId)?.status,
      { timeout: 120_000, intervals: [500, 1_000, 2_000] })
    .toBe("cancelled");

  // ── 判据 3：等过"它本该自然完成"的那个点，确认没有晚到的产物 ────────────────
  /*
   * 60 次状态轮询在 hold 之内；这里等的这段时间要**盖过**那个点，否则"没有晚到产物"
   * 只是"还没到发布的时候"。轮询周期是 provider 侧的状态轮询间隔（秒级），60 轮
   * 因此是几十秒量级——等 90 秒并在其间持续复查，比只在末尾看一眼更能抓住"中途冒出来
   * 又被抹掉"这种形态。
   */
  const settleUntil = Date.now() + 90_000;
  while (Date.now() < settleUntil) {
    const one = (await listSubtasks(page, parentRunId)).find((each) => each.id === subtaskId);
    expect(one, `子任务 ${subtaskId} 从列表里消失了——取消不该删掉这条记录`).toBeDefined();
    expect(
      one!.status,
      "取消之后子任务必须一直是 cancelled。变成 completed ⇒ 取消没有真的传下去，"
      + "它跑完了还写回了结果——这正是本条要防的失效。",
    ).toBe("cancelled");
    expect(one!.result, "被取消的子任务不许留下结果正文").toBeNull();
    expect(
      one!.artifactRefs,
      "被取消的子任务不许发布任何产物引用（晚到的产物必须被压掉，不是被展示）",
    ).toEqual([]);
    await page.waitForTimeout(3_000);
  }

  expect(
    await threadArtifactCount(page, threadId),
    "父会话的产物数量在取消之后不许增加——增加了就说明子任务的晚到产物真的发布到了会话里",
  ).toBe(artifactsBeforeCancel);
});

/**
 * ## 反证（这条 spec 不是空转的证据）
 *
 * | 破坏 | 预期红在哪一条 |
 * |---|---|
 * | 把 `LOOPBACK_DEEP_AGENT_SUBTASK_HOLD_POLLS` 拿掉（回到默认 2 轮） | 判据 1：等不到 pending/running 的子任务，诊断直接打印「它们已经是 completed ⇒ hold 没生效，取消窗口是 0」 |
 * | 替身的 `spawnAsyncTask` 改成不真的 POST（返回降级说明） | 判据 1：父 run 下一条子任务都没有，诊断打印那句「没有真的打到 `POST /internal/subtask-runs`」 |
 * | `PgSubtaskRunStore` 的 `cancelChildren` 不带 `status IN ('pending','running')` 那条 UPDATE（即取消不传播） | 判据 2 超时；随后判据 3 在 hold 到期后读到 `completed` + 非空 `result` |
 * | `completeWithArtifacts` 里那段「父/子已取消 ⇒ 写 `artifact_refs='[]'` 并落 cancelled」删掉 | 判据 3：`artifactRefs` 非空 / `result` 非 null |
 */
