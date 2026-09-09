import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import { awaitStoredHumanMessage, openFreshDeepAgentThread, storedRun } from "./support/chat-path-coverage";
import { sessionHeaders } from "./support/authoritative-thread";

/**
 * 路径矩阵 **F3 · 暂停 / 恢复 / 重试单步**（判据见
 * `.harness/instructions/chat-path-coverage-matrix.md`）。
 *
 * ## 这条路径此前的状态是「未覆盖」，而且是被订正过一次的
 *
 * 矩阵 F3 行原先写着 `agent-workbench-control-acceptance` / `当前红`。独立验收
 * （rev-e2e，SHA `303d0022`）查实并开了 **#3081**：那个文件的三条 `test()` 断言的是
 * **审批仲裁 / 取消 / 刷新恢复**，「暂停」「恢复」「重试单步」这三个词在该文件里
 * **一次都没出现**。验收员那句评语值得原样引在这里：
 *
 *   > **`当前红` 比 `未覆盖` 更有害** —— 「未覆盖」会被看见并排期，「当前红」会被当成
 *   > 已知欠账放着，而红的其实是另一件事。
 *
 * 本文件补的是那条真空里**最要紧的一半**：暂停与恢复这一对控制的**状态一致性**。
 *
 * ## 判据：控制"可点"不算数，"真生效"且"界面跟着翻"才算
 *
 * 2026-09-09 人类人肉验收在这条路径上报的缺陷不是"按钮点不动"——按钮修好之后暴露出来的
 * 是下一层：**暂停可点，但点完不翻成恢复**。这正是本仓反复吃亏的那个形状：
 * 服务端那一层对（run 真的停了）、UI 那一层自己也对（喂给它一个 `pausedAt` 非空的
 * 账本，它确实渲染「继续执行」——`tests/ui/plan-control-gate-and-recovery.test.tsx`
 * 就是这么测的，而且是绿的），**乘起来却是 0**：真实链路上账本没有回来，于是按钮
 * 永远停在「暂停中…」。两层各自的单元测试一条都拦不住它，只有端到端能。
 *
 * 所以每一步都断言**两处**，并且分开断言：
 *   ① **权威读**（`GET /plan-control/threads/:id/ledger`）——服务端真的进/出了暂停态；
 *   ② **界面**——那一对按钮真的翻了面。
 * 分开的理由是让红有指向性：只红①=服务端没停；只红②=停了但界面不说（本轮要抓的那个）；
 * 两个都红=这条控制链整条没通。
 *
 * ## 不在本文件范围内的那一半（如实写明，不含糊过去）
 *
 * F3 判据里的**「重试单步」**需要先有一个**失败的步骤**才谈得上重试，那是 F4（失败态修复）
 * 的前置条件，与本文件的 live-run 场景不是同一个装配。本文件**不假装**覆盖它——
 * 按矩阵既有纪律，覆盖到哪写到哪，不把没断言的东西算进来。
 */

/** 账本权威读——`pausedAt` / `pauseRequestedAt` 的唯一事实源是服务端，不是按钮上的字。 */
async function readLedger(page: Page, threadId: string): Promise<{
  pausedAt: string | null;
  pauseRequestedAt: string | null;
}> {
  const response = await page.request.get(`/plan-control/threads/${threadId}/ledger`, {
    headers: await sessionHeaders(page),
  });
  expect(response.ok(), `账本读取失败：${response.status()}`).toBe(true);
  const body = await response.json() as { pausedAt?: string | null; pauseRequestedAt?: string | null };
  return { pausedAt: body.pausedAt ?? null, pauseRequestedAt: body.pauseRequestedAt ?? null };
}

const PAUSE = "chat-task-workbench-run-pause";
const RESUME = "chat-task-workbench-run-resume";

test.setTimeout(300_000);

test("@path:F3 暂停真的停下来、界面真的翻成恢复；恢复之后真的接着跑", async ({ page }) => {
  const threadId = await openFreshDeepAgentThread(page);

  /*
   * 用多步剧本：它要 8 次状态轮询才终态（`MULTISTEP_MIN_STATUS_POLLS`），
   * 按下发的轮询周期算 ≈ 16 秒的 live 窗口——够点一次暂停。
   * ⚠ 窗口是**算出来的**（两个因子都在 `chat-read-fixture.ts` 单点声明并下发给被测
   * 进程），不是"大概来得及"。矩阵里 F3 自己的历史教训正是这一条：live 窗口 974ms
   * 短于轮询周期 3000ms，命中期望次数恒为 0，两层各自都对、乘起来是 0。
   */
  const trigger = CHAT_READ_E2E.deepAgentMultiStepTrigger;
  await page.getByTestId("copilotkit-v2-input").fill(trigger);
  await page.getByTestId("copilotkit-v2-send").click();
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText(trigger, { timeout: 60_000 });

  const messages = await awaitStoredHumanMessage(page, threadId, trigger);
  const humanTurn = messages.find((message) => message.authorKind === "human" && message.text === trigger);
  expect(humanTurn, "用户那条消息必须已落库").toBeDefined();
  const runId = humanTurn!.agentRunId;
  expect(runId, "落库的用户消息必须挂着这次 run").toEqual(expect.any(String));

  // ── 前置：暂停控制出现（这是**前置条件**，不是本条的业务判据） ───────────────
  const pauseButton = page.getByTestId(PAUSE);
  await expect(pauseButton, "run 在跑的时候必须给得出暂停入口").toHaveCount(1, { timeout: 60_000 });
  await expect(pauseButton).toBeEnabled({ timeout: 30_000 });

  /*
   * 自检：点下去的那一刻这条 run 必须**还没终态**。少了这一条，一次"跑得太快、
   * 暂停根本没机会生效"的空转会以绿色收场——F2 二跑就是被它自己的同类自检拦下来的。
   */
  const beforeClick = await storedRun(page, runId!);
  expect(
    ["queued", "running"],
    `点暂停时这条 run 已经是 ${beforeClick.status} 了——这一跑根本没测到暂停。`
      + "多步剧本的 live 窗口不够长，或轮询周期变了。",
  ).toContain(beforeClick.status);

  await pauseButton.click();

  // ── ① 权威读：服务端真的进了暂停态 ──────────────────────────────────────
  await expect
    .poll(async () => (await readLedger(page, threadId)).pausedAt !== null, {
      timeout: 90_000,
      intervals: [500, 1_000, 2_000],
    })
    .toBe(true);

  // ── ② 界面：那一对按钮真的翻了面 ────────────────────────────────────────
  /*
   * **这就是 2026-09-09 人肉验收报的那个缺口。** 服务端已经停了（①刚断言过），
   * 如果这里红，结论只有一个：账本没有回到界面，按钮永远停在「暂停中…」。
   * 断言写成"恢复出现 ∧ 暂停消失"两半，是因为只断言前者的话，一个把两个按钮同时
   * 渲染出来的实现也能过——那种界面同样是坏的（用户不知道该点哪个）。
   */
  await expect(
    page.getByTestId(RESUME),
    "服务端已经进入暂停态，但界面没有翻成「继续执行」——"
      + "暂停可点、点完不翻面，用户无从判断这次暂停到底生效没有",
  ).toHaveCount(1, { timeout: 60_000 });
  await expect(
    page.getByTestId(PAUSE),
    "翻面之后暂停按钮必须让位——两个控制同时在，用户不知道该点哪个",
  ).toHaveCount(0);

  // ── ③ 恢复：真的出了暂停态，且界面翻回去 ─────────────────────────────────
  await expect(page.getByTestId(RESUME)).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId(RESUME).click();

  await expect
    .poll(async () => (await readLedger(page, threadId)).pausedAt === null, {
      timeout: 90_000,
      intervals: [500, 1_000, 2_000],
    })
    .toBe(true);

  /*
   * ④ 恢复不是"把标志位清掉"就算数——这条 run 必须真的**接着跑到终态**。
   * 少了这一条，一个"点恢复只改账本、执行器再也没被唤醒"的实现照样全绿，
   * 而用户看到的是一条永远跑不完的任务。
   */
  await expect
    .poll(async () => (await storedRun(page, runId!)).status, {
      timeout: 150_000,
      intervals: [1_000, 2_000, 5_000],
    })
    .toBe("succeeded");
});

/**
 * ## 反证（这条 spec 不是空转的证据）
 *
 * | 破坏 | 预期红在哪一条 |
 * |---|---|
 * | `copilotkit-v2-plan-control.tsx` 的 `runControls.canResume` 恒为 `false`（即"点完不翻面"这个存量缺口本身） | ② `chat-task-workbench-run-resume` 60s 内 0 个，①（权威读）仍然绿 —— 红的指向性正是本文件的设计目标 |
 * | `pausePlanRun` 改成不真的 POST（只置本地 state） | ① 账本 `pausedAt` 永远是 null，90s 超时 |
 * | `resumePlanRun` 只清账本、不唤醒执行器 | ④ run 停在 `running`，等不到 `succeeded` |
 * | 两个按钮同时渲染 | ② 后半条 `toHaveCount(0)` 立即红 |
 * | 把多步触发词换成普通触发词（live 窗口塌成 1~2 秒） | 前置自检：`点暂停时这条 run 已经是 succeeded 了` —— 不会以"暂停生效了"的假绿收场 |
 */
