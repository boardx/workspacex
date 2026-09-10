import { expect, test, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import {
  login,
  openFreshDeepAgentThread,
  openFreshDeepAgentThreadOnAuthedPage,
  sessionHeaders,
  storedMessages,
} from "./support/chat-path-coverage";

/**
 * 路径矩阵 **A4 / A5 / B1 / B4 / B5 / B6** 的补强（判据见
 * `.harness/instructions/chat-path-coverage-matrix.md`，本文件只引用编号，不复述判据）。
 *
 * # 这个文件为什么存在
 *
 * 2026-09-09/10 人类在 devapp 上人肉验收，报了 11 个真实缺陷。**B 组现有 spec 当时全绿，
 * 一个都没抓住。** 与 A/B 两组直接相关的三个是：
 *
 * | # | 人类原话 | issue |
 * | --- | --- | --- |
 * | ① | 审批弹窗点了没反应，用户被完全锁死（真机理：批准生效 → 引擎又中断 → 弹出**逐像素相同**的新框） | #3186 / #3212 |
 * | ② | 该弹的确认窗口不弹（左上角提醒读**权威 REST**、弹窗只读**事件流**；中断早于订阅建立 ⇒ 事件永不再来） | #3207 |
 * | ③ | HITL 确认卡片提交之后又出现一次 | #3244 ① |
 *
 * ## 它们逃过既有 spec 的**机械原因**（不是"没人想到"）
 *
 * 三条的共同前提都是「**一条 run 中断两次**」或「**订阅晚于中断**」。而替身里每一个
 * 中断剧本都由 `record.decision === null` 把关——**裁决一到就再也不中断**；既有 B 组
 * spec 因此从头到尾只见过一次中断、且那次中断永远发生在页面订阅**之后**。
 * 判据写得再对，被测的那个状态根本不可达。
 *
 * 所以本文件配套给替身加了一条二次中断剧本（`TWO_INTERRUPT_TRIGGER`）和一个
 * **由构造撑开**的 hold 窗口（`TWO_INTERRUPT_HOLD_POLLS`），让这三个状态**因果上必然
 * 发生**，而不是靠赢一次赛跑采样到。
 *
 * # 三条纪律，逐条对应本仓踩过的坑
 *
 * 1. **判据是行为，不是痕迹**：本文件没有一句把 `toBeVisible()` / 元素存在当业务断言。
 *    「弹窗在」只在它同时**可点、点了真的推进 run** 时才算数；「卡片没了」只在
 *    **权威读说此刻没有待决请求**的前提下判，否则那是恒真门。
 * 2. **状态一致性**：同一语义值出现两处必须恒等——「左上角提醒说等待确认」与
 *    「有一个可裁决的弹窗」是同一个事实的两处声明（#3207 的根因就是这两处漂移）。
 * 3. **失败可诊断**：每条断言都带一句说清**是哪一步没成立**的失败信息；红在前置
 *    条件上而业务断言零执行，是本仓这条车道十二跑里最常见的浪费。
 */
test.setTimeout(240_000);

type PendingApproval = {
  readonly permissionRequestId: string;
  readonly toolName: string;
  readonly argsSummary?: string | null;
  readonly interrupt?: { toolName: string };
} | null;

type RunView = {
  readonly runId: string;
  readonly status: string;
  readonly pendingApproval: PendingApproval;
  readonly error?: string | null;
};

/** 权威读：这条 run 此刻的服务端事实。界面上的任何东西都以它为准。 */
async function readRun(page: Page, runUrl: string, headers: Record<string, string>): Promise<RunView> {
  const response = await page.request.get(runUrl, { headers });
  expect(response.ok(), `权威读 ${runUrl} 失败（HTTP ${response.status()}）——后面所有断言都无从判起`).toBe(true);
  return await response.json() as RunView;
}

/**
 * 发出触发词并等到**服务端权威读**给出第一个待决请求。
 *
 * ⚠ 不在这里 `login()`：`openFreshDeepAgentThread` 内部已经登录过一次，重复登录会与
 * 会话恢复赛跑，输了就烧满 240s（本车道首跑 D4/F2/F6/F7 四条全死在这个形状上，
 * #3197/#3198 同一签名）。
 */
async function startTwoInterruptRun(page: Page): Promise<{
  threadId: string;
  runUrl: string;
  headers: Record<string, string>;
  first: RunView;
}> {
  const threadId = await openFreshDeepAgentThread(page);
  const pendingResponse = page.waitForResponse(async (response) => {
    if (response.request().method() !== "GET") return false;
    if (!/\/agent-runs\/[^/?]+$/.test(new URL(response.url()).pathname) || !response.ok()) return false;
    const body = await response.json() as RunView;
    return body.status === "awaiting_tool_permission"
      && body.pendingApproval?.toolName === "confirm_task_intent";
  }, { timeout: 90_000 });
  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentTwoInterruptTrigger);
  await page.getByTestId("copilotkit-v2-send").click();
  const http = await pendingResponse;
  const first = await http.json() as RunView;
  expect(
    first.pendingApproval?.permissionRequestId,
    "第一次中断必须带一个服务端生成的 permissionRequestId——没有它，「同一个请求」这件事无从谈起",
  ).toEqual(expect.any(String));
  return { threadId, runUrl: http.url(), headers: await sessionHeaders(page), first };
}

/** 等权威读给出一个**与 `previousId` 不同**的待决请求（= 第二次中断真的到了）。 */
async function awaitNextPendingRequest(
  page: Page,
  runUrl: string,
  headers: Record<string, string>,
  previousId: string,
): Promise<RunView> {
  await expect
    .poll(async () => {
      const run = await readRun(page, runUrl, headers);
      return run.status === "awaiting_tool_permission"
        && Boolean(run.pendingApproval?.permissionRequestId)
        && run.pendingApproval!.permissionRequestId !== previousId;
    }, { timeout: 120_000, intervals: [500, 1_000, 2_000] })
    .toBe(true);
  return await readRun(page, runUrl, headers);
}

/** 「这条 run 落终态了」——用权威读判，不用界面判。 */
async function awaitTerminal(page: Page, runUrl: string, headers: Record<string, string>): Promise<RunView> {
  await expect
    .poll(async () => (await readRun(page, runUrl, headers)).status,
      { timeout: 150_000, intervals: [500, 1_000, 2_000] })
    .toMatch(/^(succeeded|failed|cancelled)$/);
  return await readRun(page, runUrl, headers);
}

const CONFIRM_INTENT_DIALOG = "确认任务意图";
const FILL_PARAMS_DIALOG = "等待你补充信息";

/* ────────────────────────────────────────────────────────────────────────────
 * ① #3244 ① —— 已经提交过的确认卡片，不得在同一条 run 上再出现一次
 * ────────────────────────────────────────────────────────────────────────── */

test(
  "@path:B6 @path:B1 二次中断：提交过的确认卡片不再出现，两次裁决都真的推进 run 到终态",
  async ({ page }) => {
    const { threadId, runUrl, headers, first } = await startTwoInterruptRun(page);
    const firstRequestId = first.pendingApproval!.permissionRequestId;

    const confirmDialog = page.getByRole("dialog", { name: CONFIRM_INTENT_DIALOG });
    await expect(
      confirmDialog,
      "第一次中断：确认意图卡片必须真的出现——这是本条后面所有断言的被测对象",
    ).toBeVisible({ timeout: 90_000 });

    // 裁决一：点「继续」。POST 必须 200 —— 409/失败都属于"点了没反应"（#3186）。
    const firstDecision = page.waitForResponse((response) =>
      response.request().method() === "POST" && response.url().endsWith(`/agent-runs/${first.runId}/decision`));
    await confirmDialog.getByTestId("agent-interrupt-confirm-intent-continue").click();
    const firstResult = await firstDecision;
    expect(
      firstResult.status(),
      "第一次裁决的 POST 必须成功。非 200 = 用户点了但服务端没接受，界面上表现为「点了没反应」（#3186）",
    ).toBe(200);
    expect(firstResult.request().postDataJSON()).toEqual({
      permissionRequestId: firstRequestId,
      decision: "approve",
    });

    /*
     * ## 核心断言（#3244 ①）：hold 窗口内，已裁决的那张卡片不得重现
     *
     * 这段窗口由替身**构造**出来（`TWO_INTERRUPT_HOLD_POLLS`）：第一次裁决已生效、
     * 第二次中断还没来，run 就是普通地在跑。所以此刻的服务端事实是
     * **「这条 run 上没有任何待决请求」**——先用权威读把这个前提钉死，再判界面。
     *
     * ⚠ 顺序不能反。先判界面再读库，就分不出「卡片确实不该在」和「卡片该在、只是
     *   我采样早了」——本车道十二跑里这个形状出现过三次。
     */
    await expect
      .poll(async () => {
        const run = await readRun(page, runUrl, headers);
        return run.pendingApproval === null && !["succeeded", "failed", "cancelled"].includes(run.status);
      }, { timeout: 60_000, intervals: [250, 500, 1_000] })
      .toBe(true);

    const holdRun = await readRun(page, runUrl, headers);
    expect(holdRun.pendingApproval, "hold 窗口的前提：权威读此刻没有任何待决请求").toBeNull();

    // 在这个前提下，下面三条都不是恒真门——服务端明说"没有要你确认的事"。
    await expect(
      page.getByTestId("interrupt-awaiting-persistence"),
      "#3244 ①：已经裁决过的确认卡片又以「等待服务端确认此请求」的形态回到会话里。"
      + "权威读此刻 pendingApproval 为 null，界面却仍在请人确认——这正是人类原话"
      + "「提交以后在 chat 上又看到了这个界面」",
    ).toHaveCount(0);
    /*
     * #3244 ①：真正的危害是**还能再点一次**（用户会以为上一次没生效）。
     *
     * issue #3310 起这条判据从「不得存在」改为「不得可点」：#3244 自己裁的是「留痕，不是
     * 抹掉」（`workbench-restored-approval.test.tsx` 的
     * 「a decided confirmation is kept as a finished record」逐字断言按钮在且 disabled），
     * 而 #3310 之前这段 hold 窗口里那张已裁决的卡片**根本没被渲染**——判据因此长期落在一个
     * 更强的代理命题上，看起来更严格，其实只是在一段"什么都没画"的窗口上恒真。
     * 现在它真的被画出来了（一张已结束的记录），代理命题不再成立，而危害的判据不变。
     */
    for (const continueButton of await page.getByTestId("agent-interrupt-confirm-intent-continue").all()) {
      await expect(
        continueButton,
        "#3244 ①：确认意图卡片的「继续」按钮在裁决之后仍然可点——用户会以为上一次没生效而再点一次",
      ).toBeDisabled();
    }
    await expect(
      page.getByRole("dialog", { name: CONFIRM_INTENT_DIALOG }),
      "#3244 ①：确认意图弹窗在裁决之后又弹了一次（此刻服务端没有任何待决请求）",
    ).toHaveCount(0);

    /*
     * ## 第二次中断（#3186 的真机理）：它是**一个新请求**，必须能被裁决
     *
     * 「批准生效 → 引擎又中断 → 弹出新框」本身是**正确**行为。会把用户锁死的是：
     * 新框绑的仍是旧的 permissionRequestId（点了 409）、或新框根本不弹。
     * 下面两条分别挡这两种。
     */
    const second = await awaitNextPendingRequest(page, runUrl, headers, firstRequestId);
    const secondRequestId = second.pendingApproval!.permissionRequestId;
    expect(
      second.runId,
      "第二次中断必须发生在**同一条 run** 上——换了 run 就不是本条要测的那个形状了",
    ).toBe(first.runId);
    expect(second.pendingApproval?.toolName).toBe("fill_run_params");

    const fillDialog = page.getByRole("dialog", { name: FILL_PARAMS_DIALOG });
    await expect(
      fillDialog,
      "#3207/#3186：服务端已经在等第二个确认（权威读 status=awaiting_tool_permission），"
      + "界面必须给出可裁决的弹窗。只有提醒没有弹窗 = 用户被锁死",
    ).toBeVisible({ timeout: 90_000 });

    const secondDecision = page.waitForResponse((response) =>
      response.request().method() === "POST" && response.url().endsWith(`/agent-runs/${first.runId}/decision`));
    await fillDialog.getByTestId("agent-interrupt-fill-params-input-persona_source")
      .fill(CHAT_READ_E2E.deepAgentTwoInterruptPersonaSource);
    await fillDialog.getByRole("button", { name: "提交并继续", exact: true }).click();
    const secondResult = await secondDecision;
    expect(
      secondResult.status(),
      "#3186：第二次弹窗提交必须 200。若是 409，说明弹窗绑的还是上一次那个已被消费的"
      + "请求身份——用户点几次都不会生效，界面上与「点了没反应」完全一样",
    ).toBe(200);
    expect(
      secondResult.request().postDataJSON().permissionRequestId,
      "#3186：弹窗提交时带的请求身份必须逐字等于权威读此刻的那一个（同一事实两处必须恒等）",
    ).toBe(secondRequestId);

    /*
     * ## 有界活性：两次裁决之内必须落终态
     *
     * 「用户被完全锁死」的可证伪形态就是这一句：裁决都被接受了，run 却永远不终态。
     * 替身的第二次中断**有界**（第二次裁决之后必落终态），所以这条不是在赌时长。
     */
    const terminal = await awaitTerminal(page, runUrl, headers);
    expect(
      terminal.status,
      `两次裁决都被服务端接受之后，run 必须走完。实际停在 ${terminal.status}`
      + `（error=${terminal.error ?? "null"}）——这就是「用户被锁死」的可证伪形态`,
    ).toBe("succeeded");

    // 终态之后：落库的终稿正文里必须真的有那句只在两次裁决都到齐后才产生的回答。
    await expect
      .poll(async () => (await storedMessages(page, threadId))
        .some((m) => m.authorKind === "agent"
          && m.text.includes(CHAT_READ_E2E.deepAgentTwoInterruptFinalReply)), {
        timeout: 90_000, intervals: [500, 1_000, 2_000],
      })
      .toBe(true);

    // 终态之后弹窗不得残留；刷新（= 事件流整条重放）之后也不得复活。
    await expect(page.getByRole("dialog", { name: CONFIRM_INTENT_DIALOG })).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: FILL_PARAMS_DIALOG })).toHaveCount(0);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("copilotkit-v2-messages"))
      .toContainText(CHAT_READ_E2E.deepAgentTwoInterruptFinalReply, { timeout: 90_000 });
    await expect(
      page.getByTestId("interrupt-awaiting-persistence"),
      "#3244 ①：刷新后事件流整条重放，已结束的确认请求被重新演成「等待确认」",
    ).toHaveCount(0);
    await expect(
      page.getByRole("dialog", { name: CONFIRM_INTENT_DIALOG }),
      "#3244 ①：run 已经 succeeded，刷新后确认弹窗不得再弹",
    ).toHaveCount(0);
  },
);

/* ────────────────────────────────────────────────────────────────────────────
 * ② #3207 —— 订阅晚于中断：提醒与弹窗是同一个事实，不得只出现一个
 * ────────────────────────────────────────────────────────────────────────── */

test(
  "@path:B5 @path:A4 订阅晚于中断：切走再切回、以及从未见过那条中断事件的第二个标签页，都必须能裁决",
  async ({ page, context }) => {
    const { threadId, runUrl, headers, first } = await startTwoInterruptRun(page);
    const firstRequestId = first.pendingApproval!.permissionRequestId;
    await expect(page.getByRole("dialog", { name: CONFIRM_INTENT_DIALOG })).toBeVisible({ timeout: 90_000 });

    /*
     * ## A4 那一半：切走再切回
     *
     * 切走再切回会重建一次订阅，而那条 `awaiting_tool_permission` 的 status 事件**早已
     * 过去**。#3207 之前，弹窗的挂载条件只读事件流投影 ⇒ 回来之后它永远不再挂载，
     * 而左上角提醒读的是权威读 ⇒ 提醒在、弹窗没有。
     */
    const otherThreadId = await openFreshDeepAgentThreadOnAuthedPage(page);
    expect(otherThreadId, "切走的必须是另一条线程").not.toBe(threadId);
    await page.goto(`/chat/${threadId}`);
    await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible({ timeout: 120_000 });

    const backRun = await readRun(page, runUrl, headers);
    expect(
      backRun.status,
      "前置：切回来的时候这条 run 仍然在等人裁决——否则本条测不到任何东西",
    ).toBe("awaiting_tool_permission");

    /*
     * ## 状态一致性：提醒与弹窗是同一个事实的两处声明
     *
     * 这不是"多断言一遍"：#3207 的整个缺陷就是这两处**漂移**。哪一处先到都不要紧，
     * 要紧的是不许只有一处成立。所以两条一起判，并把它们各自的实际状态写进失败信息
     * ——失败时要能一眼看出漂移的是哪一边。
     */
    const phase = page.getByTestId("copilotkit-v2-thinking-phase");
    const dialogBack = page.getByRole("dialog", { name: CONFIRM_INTENT_DIALOG });
    await expect(
      dialogBack,
      "#3207：切走再切回之后，权威读说这条 run 在等人裁决，界面必须给出可裁决的弹窗。"
      + "只剩一条「等待确认」的提醒而没有弹窗，用户知道有事要确认却没有可确认的界面",
    ).toBeVisible({ timeout: 90_000 });
    const phaseText = (await phase.count()) > 0 ? (await phase.first().innerText()).trim() : "(无提醒)";
    expect(
      phaseText,
      "同一事实两处必须恒等：弹窗在，提醒也必须如实说在等确认（实测提醒文案见左值）",
    ).toContain("等待确认");

    /*
     * ## B5 那一半：一个**从未见过那条中断事件**的页面
     *
     * 第二个标签页是现开的，它的订阅从建立起就在中断之后——事件流对它而言永远沉默。
     * 这是 #3207 的极端形状，也是最干净的形状：不依赖"切走再切回"里任何时序。
     */
    const latecomer = await context.newPage();
    await latecomer.goto(`/chat/${threadId}`);
    await expect(latecomer.getByTestId("copilotkit-v2-input")).toBeVisible({ timeout: 120_000 });
    const latecomerDialog = latecomer.getByRole("dialog", { name: CONFIRM_INTENT_DIALOG });
    await expect(
      latecomerDialog,
      "#3207：这一页从未收到过那条中断事件（订阅建立于中断之后）。弹窗若只读事件流，"
      + "它永远不会挂载——而服务端权威读明说这条 run 在等人裁决",
    ).toBeVisible({ timeout: 90_000 });

    /*
     * ## 「弹窗在」还不够：它必须真的能裁决
     *
     * 一个渲染出来但绑着过期身份、点了 409 的弹窗，对用户与"没弹"是同一件事。
     * 所以这条不以 `toBeVisible` 收尾——由这个**后来者**页面完成裁决，并要求 200。
     */
    const decision = latecomer.waitForResponse((response) =>
      response.request().method() === "POST" && response.url().endsWith(`/agent-runs/${first.runId}/decision`));
    await latecomerDialog.getByTestId("agent-interrupt-confirm-intent-continue").click();
    const result = await decision;
    expect(
      result.status(),
      "#3207/#3186：后来者页面上的弹窗必须绑着**当前**那个请求身份并真的裁决得动",
    ).toBe(200);
    expect(result.request().postDataJSON().permissionRequestId).toBe(firstRequestId);

    // 裁决真的推进了这条 run：第二个请求随后到来（同一条 run，不同身份）。
    const second = await awaitNextPendingRequest(latecomer, runUrl, headers, firstRequestId);
    expect(second.runId).toBe(first.runId);
    expect(second.pendingApproval?.toolName).toBe("fill_run_params");
    await latecomer.close();
  },
);

/* ────────────────────────────────────────────────────────────────────────────
 * ③ #3212 —— 第二次弹窗必须与第一次可区分
 * ────────────────────────────────────────────────────────────────────────── */

test(
  "@path:B4 @path:A5 冷启动进入等待审批的线程要能裁决；同一 run 第二次授权必须是可分辨的新请求",
  async ({ page, browser }) => {
    const threadId = await openFreshDeepAgentThread(page);
    const pendingResponse = page.waitForResponse(async (response) => {
      if (response.request().method() !== "GET") return false;
      if (!/\/agent-runs\/[^/?]+$/.test(new URL(response.url()).pathname) || !response.ok()) return false;
      const body = await response.json() as RunView;
      return body.status === "awaiting_tool_permission" && Boolean(body.pendingApproval?.permissionRequestId);
    }, { timeout: 90_000 });
    await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentTwoApprovalTrigger);
    await page.getByTestId("copilotkit-v2-send").click();
    const http = await pendingResponse;
    const run = await http.json() as RunView;
    const runUrl = http.url();
    const headers = await sessionHeaders(page);
    const firstRequestId = run.pendingApproval!.permissionRequestId;

    /*
     * ## A5 那一半：**全新会话**冷启动进一条正在等审批的线程
     *
     * 全新 context = 无 localStorage、无任何事件流历史，正是"第一次来的人"的形状。
     * A5 既有 spec 断言的是空会话能走到可输入；这里加的是**线程上挂着一个待批审批**时
     * 它同样要走到可输入**并且**看得到那个审批——#3207 的冷启动那一臂。
     */
    const freshContext = await browser.newContext();
    const fresh = await freshContext.newPage();
    await login(fresh);
    await fresh.goto(`/chat/${threadId}`);
    const freshInput = fresh.getByTestId("copilotkit-v2-input");
    await expect(
      freshInput,
      "A5：进一条正在等审批的线程，composer 仍然必须走到可输入——卡在骨架屏或永久禁用，"
      + "与白屏对用户是同一件事",
    ).toBeVisible({ timeout: 120_000 });
    await expect(freshInput).toBeEditable({ timeout: 60_000 });
    await expect(
      fresh.getByTestId("chat-tool-permission-dialog"),
      "#3207：冷启动这一页从未见过那条中断事件，审批弹窗仍必须挂载（权威读说在等审批）",
    ).toBeVisible({ timeout: 90_000 });
    await freshContext.close();

    /*
     * ## #3212 那一半：第二次授权弹窗必须与第一次可分辨
     *
     * 「仅本次允许」按 I-4 本来就不落授权记录，所以同类调用**再问一次是正确的**。
     * 会把人逼疯的不是"又问"，是"又问得逐像素相同"——用户无法把"这是第二次询问"与
     * "上次点击没生效"分开，于是反复点同一个按钮（#3186 的界面表现）。#3212 的修法有两半：
     * ① 卡片指名**这次要调哪个技能**；② 第二次起显示"这是第几次询问、上次选了哪档"。
     * 同一提交还把审批组件的 key 从 `runId:seq` 收成 `runId`——带 seq 时同一条 run 的
     * 第二次中断会把组件整个重挂、它刚记下的次数当场清零，②因此永远不出现。
     * **本条正是靠②与①一起红来指认那次回归。**
     */
    const dialog = page.getByTestId("chat-tool-permission-dialog");
    await expect(dialog).toBeVisible({ timeout: 90_000 });
    await expect(
      dialog.getByTestId("perm-repeat-notice"),
      "第一次弹窗不该出现「第几次询问」的说明——它出现说明计数本身是错的",
    ).toHaveCount(0);
    await expect(
      dialog,
      "#3212 ①：授权卡必须指名这次要调的技能，否则每一次弹窗逐字相同",
    ).toContainText(CHAT_READ_E2E.deepAgentTwoApprovalFirstSkill);

    const firstDecision = page.waitForResponse((response) => response.request().method() === "POST"
      && response.url().includes(`/permission-requests/${firstRequestId}/decision`));
    await dialog.getByTestId("perm-once").click();
    expect((await firstDecision).status(), "#3186：授权点击必须真的被服务端接受").toBe(200);

    // hold 窗口（由构造撑开）：第一次已生效、第二次还没提出 —— 权威读此刻无待决请求。
    await expect
      .poll(async () => {
        const value = await readRun(page, runUrl, headers);
        return value.pendingApproval === null && !["succeeded", "failed", "cancelled"].includes(value.status);
      }, { timeout: 60_000, intervals: [250, 500, 1_000] })
      .toBe(true);
    await expect(
      page.getByTestId("chat-tool-permission-dialog"),
      "权威读此刻没有任何待决请求，界面却仍在请人授权——点下去只会拿到 409，"
      + "对用户与「点了没反应」完全一样（#3186）",
    ).toHaveCount(0);

    // 第二次授权请求：同一条 run、新的请求身份、点名的是**另一个**技能。
    const second = await awaitNextPendingRequest(page, runUrl, headers, firstRequestId);
    expect(second.runId, "第二次授权必须发生在同一条 run 上").toBe(run.runId);
    const secondRequestId = second.pendingApproval!.permissionRequestId;

    const secondDialog = page.getByTestId("chat-tool-permission-dialog");
    await expect(
      secondDialog,
      "#3186：服务端在等第二次授权，界面必须重新给出可裁决的弹窗",
    ).toBeVisible({ timeout: 90_000 });
    await expect(
      secondDialog,
      "#3212 ①：第二次弹窗必须指名**这一次**要调的技能（与第一次不同），否则两次逐字相同",
    ).toContainText(CHAT_READ_E2E.deepAgentTwoApprovalSecondSkill);
    await expect(
      secondDialog.getByTestId("perm-repeat-notice"),
      "#3212 ②：同一条 run 的第二次授权弹窗必须说明「这是第几次询问、上次选了哪档」。"
      + "缺了它，用户无法把「这是一次新请求」与「上次点击没生效」分开——那正是 #3186 的界面表现。"
      + "⚠ 审批组件若按 `runId:seq` 换 key，第二次中断会把它整个重挂、计数清零，本条即红",
    ).toBeVisible({ timeout: 30_000 });
    /*
     * #3302 —— 「可见」还不够，**那句话说的次数必须是对的**。
     *
     * 这个计数曾经存在审批组件的 `useState` 里，而组件的挂载门是
     * `status === "awaiting_tool_permission"`：上面那段 hold 窗口整段是 `running`，
     * 组件被**正确地**卸载、计数清零，于是 ② 在同一条 run 的第二次授权上从未出现过。
     * 判次数（而不是只判存在）挡的是「让组件别卸载」「把本地状态缓存住」那一类修法——
     * 它们能让元素出现，却让「第几次」重新变成一个不受服务端约束的数字。
     */
    await expect(
      secondDialog.getByTestId("perm-repeat-notice"),
      "#3302：跨过那段 running 窗口之后，用户看见的那句话必须仍然是「第 2 次」。"
      + "计数的事实源是服务端（AgentRunView.permissionDecisions），不是组件的生命周期",
    ).toContainText("第 2 次请求授权");
    await expect(
      secondDialog.getByTestId("perm-repeat-notice"),
      "#3302：上一次点的是「仅本次允许」，文案必须说得出是哪一档——"
      + "只说次数、说不出上次选了什么，用户仍然不知道为什么又被问一遍",
    ).toContainText("仅本次允许");

    const secondDecision = page.waitForResponse((response) => response.request().method() === "POST"
      && response.url().includes(`/permission-requests/${secondRequestId}/decision`));
    await secondDialog.getByTestId("perm-once").click();
    expect(
      (await secondDecision).status(),
      "#3186：第二次授权提交必须 200。409 = 弹窗绑的还是已被消费的旧请求身份，用户被锁死",
    ).toBe(200);

    const terminal = await awaitTerminal(page, runUrl, headers);
    expect(
      terminal.status,
      `两次授权都被接受之后 run 必须走完，实际停在 ${terminal.status}`,
    ).toBe("succeeded");
    await expect
      .poll(async () => (await storedMessages(page, threadId))
        .some((m) => m.authorKind === "agent"
          && m.text.includes(CHAT_READ_E2E.deepAgentTwoApprovalFinalReply)), {
        timeout: 90_000, intervals: [500, 1_000, 2_000],
      })
      .toBe(true);
    await expect(
      page.getByTestId("chat-tool-permission-dialog"),
      "run 已终态，审批弹窗不得残留",
    ).toHaveCount(0);
  },
);
