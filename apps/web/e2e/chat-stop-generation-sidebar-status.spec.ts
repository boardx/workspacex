import { expect, test, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import { openFreshDeepAgentThread, sessionHeaders } from "./support/chat-path-coverage";

/**
 * issue #3463（来源 #3413 手册任务 T29/T30，F5「停止生成」场景）—— 真实浏览器点击
 * composer 的「停止生成」按钮后，侧边栏该会话卡的状态文案必须显示「已停止」，
 * 不能显示「未能完成」。
 *
 * ## 这条 spec 在验什么，为什么不能只测状态机
 *
 * #3413 的测试记录（SHA `fd9c6fb79`）里，`running` 确实归零（客户端 abort 生效），
 * 但侧边栏读到的文案是「未能完成」。当时 composer 停止按钮 `onClick` 走的是
 * `@copilotkit/react-core` `useAgent().abortRun()`——纯客户端中止本地流，从不告诉
 * 后端"这是用户主动取消"，于是后端把这次中止当成一次普通的模型调用失败
 * （`agent_runs.status='failed'`），落到线程卡文案表（`thread-list-shell.tsx` 的
 * `THREAD_STATUS_LABEL`）里的「未能完成」分支。
 *
 * `fd9c6fb79..HEAD` 之间（`d30ac48e8` / `1b49ddfe4`，「unify streaming execution,
 * run controls, and recovery」）把停止按钮换成了真实的 `useRunCancellation().cancel()`
 * ⇒ `POST /agent-runs/:runId/cancel`，服务端因此有了专门的 `agent_runs.status='cancelled'`
 * 终态，`threadCardStatus()`（`apps/api/src/domain/chat/thread-badges.ts`）与
 * `THREAD_STATUS_LABEL` 也已经各自补上 `cancelled` → 「已停止」这一档。
 * 存量的 vitest 单测（`thread-title-and-status.test.ts`、`workbench-run-cancellation.test.tsx`）
 * 只验了这条状态机内部的映射，**没有一条从真实点击这颗按钮开始、走到侧边栏渲染结束**——
 * 状态机内部是对的，不代表按钮真的接到了这条状态机上；这正是 #3413 挑出来的那种断层，
 * 只测其中一层测不出来。这条 spec 补的就是"点击 → 服务端真实落库 → 侧边栏真实渲染"
 * 这一条完整链路。
 *
 * ## 为什么用 `deepAgentMultiStepTrigger`
 *
 * 停止必须打在"run 确实还在 running"的窗口里，否则点下去时 run 早就终态了，
 * 这条用例什么都没测到。这条剧本（`chat-path-f5-cancel-propagates-to-subtask.spec.ts`
 * 已验证过）会让 run 保持足够久的 `running`，给真实点击留出窗口。
 */
test.setTimeout(180_000);

interface RunView {
  readonly runId?: string;
  readonly status: string;
}

async function readRun(page: Page, runId: string): Promise<RunView> {
  const response = await page.request.get(`/agent-runs/${runId}`, { headers: await sessionHeaders(page) });
  expect(response.ok(), `读 run 失败：HTTP ${response.status()}`).toBe(true);
  return await response.json() as RunView;
}

test("issue #3463：点击「停止生成」后，侧边栏状态显示「已停止」而不是「未能完成」", async ({ page }) => {
  await openFreshDeepAgentThread(page);

  // 捕获这一轮真实的 run id（手法取自 chat-path-f5-cancel-propagates-to-subtask.spec.ts）。
  const liveRun = page.waitForResponse(async (response) => {
    if (response.request().method() !== "GET") return false;
    if (!/\/agent-runs\/[^/?]+$/.test(new URL(response.url()).pathname) || !response.ok()) return false;
    return typeof (await response.json()).runId === "string";
  }, { timeout: 120_000 });

  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentMultiStepTrigger);
  await page.getByTestId("copilotkit-v2-send").click();
  const runId = (await (await liveRun).json() as { runId: string }).runId;

  // ── 前置：run 此刻确实还在 running，不是已经终态了才去点停止 ──────────────────
  await expect
    .poll(async () => (await readRun(page, runId)).status, { timeout: 60_000, intervals: [500, 1_000, 2_000] })
    .toBe("running");

  // ── 真实点击「停止生成」按钮（不是直接打 API）──────────────────────────────
  const stopButton = page.getByTestId("copilotkit-v2-send");
  await expect(stopButton).toHaveAttribute("aria-label", "停止生成");
  await stopButton.click();

  // ── 判据 1（服务端账本）：run 落成 `cancelled`，不是 `failed` ────────────────
  await expect
    .poll(async () => (await readRun(page, runId)).status, {
      timeout: 60_000, intervals: [500, 1_000, 2_000],
      message: "点击停止后 run 的终态应为 cancelled，不是 failed——如果这里红，说明停止按钮又退化成了纯客户端 abort",
    })
    .toBe("cancelled");

  // ── 判据 2（真实渲染）：侧边栏这条会话卡的文案是「已停止」，机器可读属性同步反映 cancelled ─
  const statusEl = page.getByTestId("chat-task-workbench-thread-status").first();
  await expect(
    statusEl,
    "【#3463】点击停止后侧边栏读不到线程状态锚点——文案映射或数据投影链路本身断了",
  ).toHaveAttribute("data-status", "cancelled", { timeout: 30_000 });

  const label = (await statusEl.innerText()).trim();
  expect(
    label,
    `【#3463】点击停止后侧边栏文案是「${label}」，不是「已停止」——用户主动停止被误判成了执行失败`
      + "（回归到 #3413 T29/T30 报的那个缺陷：composer 停止按钮又退化成纯客户端 abortRun，"
      + "没有真的调用 POST /agent-runs/:runId/cancel）。",
  ).toBe("已停止");
  expect(label, "「已停止」不应该等于「未能完成」——这条断言本身若失效说明常量被改串了").not.toBe("未能完成");
});

/**
 * ## 反证（这条 spec 不是空转的证据）
 *
 * | 破坏 | 预期红在哪一条 |
 * |---|---|
 * | composer 停止按钮 `onClick` 换回 `agent.abortRun()`（纯客户端 abort，不打真实 cancel 端点） | 判据 1：run 终态落成 `failed` 而非 `cancelled`（#3413 T29/T30 原始缺陷形状） |
 * | `POST /agent-runs/:runId/cancel` 正常但 `thread-badges.ts` 的 `threadCardStatus()` 漏掉 `case "cancelled"` 分支 | 判据 2：`data-status` 不是 `cancelled`（大概率落进 `switch` 的 `never` 分支编译期先红，运行期兜底成别的值） |
 * | `THREAD_STATUS_LABEL` 里把 `cancelled` 的文案改回 `未能完成` 或删掉这一档 | 判据 2 文案断言：读到「未能完成」或抛 `Record` 缺 key 的运行时错误 |
 */
