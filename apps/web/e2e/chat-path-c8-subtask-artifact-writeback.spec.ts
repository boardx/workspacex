/**
 * 路径矩阵 **C8 子任务产物写回**（`.harness/instructions/chat-path-coverage-matrix.md`）——
 * durable subtask 产出的文件**回到父会话，可下载**。
 *
 * ## 先订正一条已经过期的前提
 *
 * 矩阵此前给 C8 的注是：「⛔ 未覆盖：需要 native 会话 + 沙箱编排，属新增 CI 预算的
 * 决策」，读起来像"这条链在本车道里根本不存在"。**那句话现在只对了一半。**
 * `1c3a10084`（#3170，已在 `origin/main` 血统里，`git merge-base --is-ancestor` 实测）
 * 把**编排那一半**建起来了，而且就在本车道里：
 *
 * · `apps/api/scripts/loopback-deep-agent-provider.ts::spawnAsyncTask` 逐字照
 *   `deep_agent_service/tools.py::spawn_async_task` 的线格式，**真的**
 *   `POST /internal/subtask-runs`（同一个 header 名、同一个 body 形状、同一条
 *   "四个 configurable 键缺一即降级"的判据），不是在替身里造一条假记录；
 * · `apps/web/playwright.chat-read.config.ts` 已下发 `KERNEL_SUBTASK_CALLBACK_BASE_URL`
 *   与内部 key（与 `SubtaskRunController.enqueue` 校验的是同一个环境变量）；
 * · 落的是真实的 `subtask_runs` 行，随后由真实的 `SubtaskRunExecutor` 真的执行、
 *   真的把工具明细写回去。
 *
 * 所以「需要 native 会话 + 沙箱编排」这句话，**编排**部分已经不成立了。
 *
 * ## 还没成立的，是**文件**那一半——而且它是一个具体的、可指名的阻塞
 *
 * 会产文件的子任务必须带 `outputFiles` 策略，而 `SubtaskRunExecutor.execute` 对这类
 * 子任务走的是 `bindNativeInvocation(this.nativeOwnerOrThrow(), …)`
 * （`subtask-run-executor.ts:137`）。`nativeOwnerOrThrow()` 要 `NATIVE_SESSION_OWNER`，
 * 而 `kernel.module.ts:2110` 那个 factory 只有在 `NATIVE_SESSION_SOCKET` +
 * `NATIVE_SESSION_BINDING_KEY` 都在时才 `new PgNativeSessionOwner(…)`，否则返回 `null`。
 * 本车道**一个都没有下发**（`playwright.chat-read.config.ts` 里 `NATIVE_SESSION_*`
 * 零命中），也没有任何一处替身在派发时带上 `outputFiles`。
 *
 * ⇒ 今天在本车道里派一个会产文件的子任务，得到的不是"文件没写回"，是
 *   `Error: subtask_artifact_staging_unavailable`——**这条路径的判据无法被证伪**。
 *   补它需要给本车道新增一个 native 会话替身（一个 unix socket 服务端），那是新增
 *   webServer 与 CI 时间预算的决策，仍不在本轮范围内。
 *
 * ## 这个文件因此分两条用例，界线画在"能不能被证伪"上
 *
 * · **会跑的那条**：断言 #3170 建起来的编排半段真的成立——一个真实用户在 chat 里发
 *   的那一轮，真的派出了一条 durable 子任务，它真的被真实执行器执行、真的把结果
 *   写回父会话可读的地方。这是本车道**此前零覆盖**的一段，不是 C8 判据的全部。
 * · **`test.fixme` 的那条**：C8 判据本身，逐字写着，**不放宽、不改成"有个产物就行"**。
 *   处置沿用本仓既有先例（矩阵 A3 挂 `test.fixme` 阻塞于 #3028；
 *   `chat-attachment-preview-download.spec.ts` 挂 `test.fixme` 阻塞于 #3019）：
 *   不删断言、不改宽判据、不用 `test.skip`。阻塞解除后把 `test.fixme` 改回 `test`，
 *   正文一个字都不用动。
 *
 * ⚠ 矩阵里 C8 那一行因此**仍然不是「已覆盖」**——机械门控第 6 条（`已覆盖` 的行必须
 * 有会真实执行的 `test(`）说的正是这件事，`test.fixme` 不算跑过。写成「已覆盖」会
 * 让这条路径从排期里消失，而那正是矩阵自己记着的那句话：**「当前红」比「未覆盖」
 * 更有害**，同理，假的「已覆盖」比诚实的「部分」更有害。
 */
import { expect, test, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import { login, openFreshDeepAgentThread, sessionHeaders } from "./support/chat-path-coverage";

test.setTimeout(300_000);

interface SubtaskRunView {
  readonly id: string;
  readonly status: string;
  readonly result: string | null;
  readonly artifactRefs: readonly { readonly artifactId: string; readonly versionId: string }[];
  readonly toolCalls?: readonly { readonly toolName: string }[];
}

async function listSubtasks(page: Page, parentRunId: string): Promise<readonly SubtaskRunView[]> {
  const response = await page.request.get(`/agent-runs/${parentRunId}/subtask-runs`, {
    headers: await sessionHeaders(page),
  });
  expect(response.ok(), `读子任务列表失败：HTTP ${response.status()}`).toBe(true);
  return (await response.json() as { subtaskRuns: SubtaskRunView[] }).subtaskRuns;
}

/** 发一轮会派发子任务的对话，回这一轮真实的父 run id。 */
async function sendAndCaptureRunId(page: Page): Promise<string> {
  const liveRun = page.waitForResponse(async (response) => {
    if (response.request().method() !== "GET") return false;
    if (!/\/agent-runs\/[^/?]+$/.test(new URL(response.url()).pathname) || !response.ok()) return false;
    return typeof (await response.json()).runId === "string";
  }, { timeout: 120_000 });
  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentMultiStepTrigger);
  await page.getByTestId("copilotkit-v2-send").click();
  return (await (await liveRun).json() as { runId: string }).runId;
}

test("@path:C8 chat 里发起的那一轮真的派出一条 durable 子任务，它被真实执行并把结果写回父会话", async ({ page }) => {
  await login(page);
  await openFreshDeepAgentThread(page);
  const parentRunId = await sendAndCaptureRunId(page);

  /*
   * 判据必须同时具备「只有被测分支才满足」∧「只有本轮才满足」（矩阵 C5 为此红了三跑）：
   * 这里等的是**这个父 run 自己**的子任务列表，parentRunId 是本轮捕获的 ⇒ 别的线程、
   * 别的用例、上一轮的子任务都不在这个列表里。
   */
  let subtaskId = "";
  try {
    await expect
      .poll(async () => {
        const rows = await listSubtasks(page, parentRunId);
        if (rows.length > 0) subtaskId = rows[0]!.id;
        return rows.length;
      }, { timeout: 120_000, intervals: [500, 1_000, 2_000] })
      .toBeGreaterThan(0);
  } catch (failure) {
    throw new Error(
      `${failure instanceof Error ? failure.message : String(failure)}\n\n`
      + `【诊断】父 run ${parentRunId} 下一条子任务都没有。这一轮的 \`spawn_async_task\` 没有真的打到 `
      + "`POST /internal/subtask-runs`——通路那四个 configurable 键"
      + "（subtask_callback_base_url / subtask_callback_key / org_id / parent_run_id）"
      + "缺一即降级，见 `loopback-deep-agent-provider.ts::spawnAsyncTask` 头注。",
    );
  }

  /*
   * 等它**真的被执行到终态**。这一步是本条用例的重点：一条只是"入了队"的记录证明不了
   * `SubtaskRunExecutor` 真的跑过它——`pending` 恒在，拿它当通过就是一道恒真的门
   *（矩阵十一跑小结第 2 条记的正是这个形状）。
   */
  await expect
    .poll(async () => (await listSubtasks(page, parentRunId)).find((one) => one.id === subtaskId)?.status,
      { timeout: 180_000, intervals: [1_000, 2_000, 3_000] })
    .toBe("completed");

  const done = (await listSubtasks(page, parentRunId)).find((one) => one.id === subtaskId)!;
  expect(
    done.result,
    "子任务跑完必须把结果正文写回来——`null` 说明写回那一跳没发生，"
    + "父会话看到的只会是一条永远'在后台跑'的空记录",
  ).not.toBeNull();
  expect((done.result ?? "").trim().length, "写回的结果不许是空串").toBeGreaterThan(0);
});

/**
 * ⛔ **C8 的判据本身**，逐字写着，阻塞于本车道没有 native 会话（见文件头注）。
 *
 * 阻塞点是具体的、可指名的：`SubtaskRunExecutor` 对带 `outputFiles` 的子任务走
 * `bindNativeInvocation(this.nativeOwnerOrThrow(), …)`，而本车道不下发
 * `NATIVE_SESSION_SOCKET` / `NATIVE_SESSION_BINDING_KEY` ⇒ `NATIVE_SESSION_OWNER`
 * 为 `null` ⇒ 抛 `subtask_artifact_staging_unavailable`。
 *
 * 解除方式（属新增 CI 预算的决策，不在本轮）：给本车道加一个 native 会话替身
 * （unix socket 服务端）并让派发侧带上 `outputFiles` 策略。补上之后把
 * `test.fixme` 改回 `test` 即可——**下面这段正文一个字都不用改**。
 *
 * 写回落点是已经存在的（`PgSubtaskRunStore.completeWithArtifacts`）：它按**父 run 的
 * `thread_id`** 插 `agent_artifacts` + `agent_artifact_versions`，所以子任务的产物
 * 确实是"回到父会话"，而不是挂在子任务自己身上——下面按这个落点断言。
 */
test.fixme("@path:C8 子任务产出的文件回到父会话，可下载且下载回来的字节能打开", async ({ page }) => {
  await login(page);
  const threadId = await openFreshDeepAgentThread(page);
  const parentRunId = await sendAndCaptureRunId(page);

  let subtaskId = "";
  await expect
    .poll(async () => {
      const rows = await listSubtasks(page, parentRunId);
      if (rows.length > 0) subtaskId = rows[0]!.id;
      return rows.length;
    }, { timeout: 120_000 })
    .toBeGreaterThan(0);
  await expect
    .poll(async () => (await listSubtasks(page, parentRunId)).find((one) => one.id === subtaskId)?.status,
      { timeout: 180_000 })
    .toBe("completed");

  // ① 子任务确实发布了产物引用（不是"跑完了就算"）。
  const done = (await listSubtasks(page, parentRunId)).find((one) => one.id === subtaskId)!;
  expect(done.artifactRefs.length, "会产文件的子任务跑完必须留下产物引用").toBeGreaterThan(0);
  const ref = done.artifactRefs[0]!;

  // ② 它真的落在**父会话**的产物列表里（`completeWithArtifacts` 用的是父 run 的 thread_id）。
  const listed = await page.request.get(`/agent-artifacts/threads/${threadId}`, {
    headers: await sessionHeaders(page),
  });
  expect(listed.ok(), `读父会话产物列表失败：HTTP ${listed.status()}`).toBe(true);
  const items = (await listed.json() as { items: { id: string; name: string }[] }).items;
  expect(
    items.map((one) => one.id),
    "子任务的产物必须出现在**父会话**的产物列表里——不在，就是没有'回到父会话'",
  ).toContain(ref.artifactId);

  // ③ 可下载 = 真的拿到字节，长度非零且与响应一致；不是"有个下载按钮"。
  const content = await page.request.get(
    `/artifacts/${ref.artifactId}/versions/1/content`,
    { headers: await sessionHeaders(page) },
  );
  expect(content.ok(), `下载子任务产物失败：HTTP ${content.status()}`).toBe(true);
  const bytes = Buffer.from(await content.body());
  expect(bytes.length, "下载回来必须是真的字节，不是 0 字节占位").toBeGreaterThan(0);

  // ④ 可重新打开 = 打开后的内容对。产物是 OOXML/PDF 时用仓库已有的那套真解析
  //    （`@repo/skill-sandbox/ooxml` / `inspect-pdf`），不用"文件大小 > 0"冒充。
  //    具体断哪一种由派发时 `outputFiles.mediaTypes` 定，解除阻塞时一并填上。
  expect(
    bytes.subarray(0, 2).toString("latin1") === "PK" || bytes.subarray(0, 4).toString("latin1") === "%PDF",
    `下载回来的字节既不是 zip（OOXML）也不是 PDF，前 8 字节：${bytes.subarray(0, 8).toString("hex")}`,
  ).toBe(true);
});
