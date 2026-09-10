/**
 * issue #3321 —— 计划面板 / 阶段条「只在需要时显示」的真实链路回归。
 *
 * 人类**两次**提出同一诉求：「只有在有需要的时候才显示，plan panel 平常时间，
 * 不在 plan execute 的场景时，不要显示」。第一次（#3208/#3214/#3245/#3263）没修干净：
 * #3263 那道终态卸载门因为宿主裸读 `gate.required`（`evaluatePlanGate` 只看
 * `todoCount`，`done` 之后恒为 true）而**永不触发**。
 *
 * ## 这条 spec 与单测的分工
 *
 * `derivePlanSurface` 的真值表由契约层全叉积单测钉死；本 spec 只回答单测**回答不了**的
 * 那一半：真实浏览器里，那块像素到底在不在屏幕上。
 *
 * 判可见用四项事实，其中 **`hitTest` 是权威**：
 * `attached`（在不在 DOM）/ `bboxNonZero` / `inViewport` / `hitTest`
 * （`document.elementFromPoint(中心点)` 命中它或它的后代）。
 * issue 点名的两种假修法——「只判元素不存在于 DOM」与「只判 `display:none`」——都被
 * `hitTest` 挡住；本仓另栽过 `getBoundingClientRect` 读不出 overflow 裁剪的坑，
 * 所以几何三项只作诊断，判定看命中测试。
 *
 * ## ⚠ 取样指针自检（上一轮取证作废的直接原因）
 *
 * #3321 第一版矩阵里 S8 / S9 两行：DOM 量的是画面上那条已完成线程，`phase`/`runStatus`
 * 两列却读的是另一条刚建的空白线程——同一行里两个指针指向不同线程，据此写出的
 * 「同一账本状态两种界面」是**假结论**，取证方已公开作废。
 *
 * 防线：`captureCell` **不接受调用方传入的 threadId**，每次从 `page.url()` 现取，
 * 并断言账本读回来的 `threadId` 等于画面上那条。错位就让这一格**红**出来，
 * 而不是记下一行自洽但无意义的数据。
 */
import { expect, test, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import { openFreshThread } from "./chat-task-workbench-fixture";
import { selectWorkbenchAgent } from "./support/workbench-run-evidence";
import { openAuthoritativeFreshThread, sessionHeaders } from "./support/authoritative-thread";

test.setTimeout(600_000);

const PLAN_PANEL = "chat-task-workbench-plan-control";
const PHASE_INDICATOR = "chat-task-workbench-phase-indicator";

type Facts = { attached: boolean; bboxNonZero: boolean; inViewport: boolean; hitTest: boolean };
type Cell = {
  state: string;
  threadId: string;
  pointerSelfCheck: "ok" | string;
  phase: string | null;
  runStatus: string | null;
  ledgerDetail: string;
  planPanel: Facts;
  phaseIndicator: Facts;
};

const cells: Cell[] = [];

/** 四项可见性事实。`hitTest` 是权威那一项。 */
async function facts(page: Page, testId: string): Promise<Facts> {
  return page.evaluate((tid) => {
    const el = document.querySelector(`[data-testid="${tid}"]`);
    if (!el) return { attached: false, bboxNonZero: false, inViewport: false, hitTest: false };
    const r = el.getBoundingClientRect();
    const bboxNonZero = r.width > 0 && r.height > 0;
    const inViewport = r.top < window.innerHeight && r.bottom > 0 && r.left < window.innerWidth && r.right > 0;
    let hitTest = false;
    if (bboxNonZero && inViewport) {
      // 中心点被别的东西盖住 / 被祖先 overflow 裁掉时，这里就命中不到——
      // 这正是 getBoundingClientRect 看不见的那一类"几何全绿但用户看不见"。
      const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
      hitTest = hit !== null && (el === hit || el.contains(hit));
    }
    return { attached: true, bboxNonZero, inViewport, hitTest };
  }, testId);
}

/** 画面上**当前**那条线程——唯一的 threadId 来源，不许缓存在外层变量里。 */
function threadIdFromPage(page: Page): string {
  return new URL(page.url()).pathname.split("/").filter(Boolean).pop() ?? "";
}

async function readLedger(page: Page, threadId: string) {
  // ⚠ 必须走同源相对路径：硬编码 :3200 在隔离栈上端口是错的，而且会被 CORS 拦死
  //   （症状是 phase/runStatus 整列 null）。
  const res = await page.request.get(`/plan-control/threads/${threadId}/ledger`, {
    headers: await sessionHeaders(page),
  });
  if (!res.ok()) return null;
  return await res.json() as Record<string, any>;
}

async function captureCell(page: Page, state: string): Promise<Cell> {
  const threadId = threadIdFromPage(page);
  const ledger = await readLedger(page, threadId);
  /*
   * 自检：账本读的那条线程必须就是屏幕上画着的那条。
   *
   * ⚠ `getPlanLedger.out` 是 `.strict()` 且**不含 threadId**，所以「拿响应里的
   * threadId 比对」是做不到的——那样写会退化成 `threadId === threadId` 的恒真式
   * （本仓已九次「全绿但空转」）。真正能失败的比对是面板自己带出来的
   * `data-thread-id`（宿主的机器可读绑定证据）：它由渲染时的 tid 出，与这里
   * 用来读账本的 URL 末段是两条独立来源，错位就能抓到。
   * 面板不可见的格子没有这个属性，此时自检退化为「URL 末段可解析 + 账本读成功」，
   * 如实记为 `ok(面板未挂载)`，不假装比对过。
   */
  const domThreadId = await page.evaluate(
    (tid) => document.querySelector(`[data-testid="${tid}"]`)?.getAttribute("data-thread-id") ?? null,
    PLAN_PANEL,
  );
  const pointerSelfCheck = ledger === null
    ? "账本读失败"
    : threadId === "" ? "画面 URL 里解析不出 threadId"
    : domThreadId === null ? "ok(面板未挂载)"
    : domThreadId === threadId ? "ok" : `错位: 面板=${domThreadId} 账本/画面=${threadId}`;
  const cell: Cell = {
    state,
    threadId,
    pointerSelfCheck,
    phase: ledger?.phase ?? null,
    runStatus: ledger?.runStatus ?? null,
    ledgerDetail: `steps=${(ledger?.steps ?? []).length} prog=${ledger?.progress?.completed}/${ledger?.progress?.total}`
      + ` gate=${ledger?.gate?.required} pendApply=${ledger?.pendingApplyAtNextRun}`
      + ` orphan=${(ledger?.orphanedConstraints ?? []).length} paused=${Boolean(ledger?.pausedAt)}`,
    planPanel: await facts(page, PLAN_PANEL),
    phaseIndicator: await facts(page, PHASE_INDICATOR),
  };
  cells.push(cell);
  console.log(`[3321] ${JSON.stringify(cell)}`);
  // 指针不自洽 ⇒ 这一格的数据没有意义，直接红，不留下一行假数据。
  expect(cell.pointerSelfCheck, `${state}: 账本线程与画面线程必须是同一条`).toMatch(/^ok/);
  return cell;
}

/** 等账本真正进入某个 phase（不是固定 sleep——固定等待正是上一轮采样时机存疑的来源）。 */
async function waitForPhase(page: Page, phases: string[], timeoutMs = 120_000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  let last: string | null = null;
  while (Date.now() < deadline) {
    const ledger = await readLedger(page, threadIdFromPage(page));
    last = ledger?.phase ?? null;
    if (last && phases.includes(last)) {
      // 账本轮询是 3s 一次；再等一拍让界面确实反映到这个 phase 上。
      await page.waitForTimeout(3_500);
      return last;
    }
    await page.waitForTimeout(1_000);
  }
  return last;
}

function visible(f: Facts): boolean { return f.hitTest; }

test.afterAll(() => {
  console.log("\n=== #3321 九格矩阵（att/bbox/vp/hit，hit 为权威）===");
  console.log("state | phase | runStatus | 指针自检 | planPanel | 阶段条");
  for (const c of cells) {
    const t = (f: Facts) => `${+f.attached}${+f.bboxNonZero}${+f.inViewport}${+f.hitTest}`;
    console.log(`${c.state} | ${c.phase} | ${c.runStatus} | ${c.pointerSelfCheck} | ${t(c.planPanel)} | ${t(c.phaseIndicator)}`);
  }
});

test("#3321 计划面板/阶段条：九状态可见性矩阵 + 回归断言", async ({ page }) => {
  // ── S1 全新空白会话（从未有过 run）⇒ 都不该显示 ────────────────────────
  await openFreshThread(page); // 内含登录，一个 page 只能调一次；后续用 openAuthoritativeFreshThread
  await selectWorkbenchAgent(page, CHAT_READ_E2E.deepAgentId);
  const s1 = await captureCell(page, "S1-全新空白会话");
  expect(visible(s1.planPanel), "S1 全新空白会话不该有 plan panel").toBe(false);
  expect(visible(s1.phaseIndicator), "S1 全新空白会话不该有阶段条").toBe(false);

  // ── S3 有计划、执行中 ⇒ 该显示 ────────────────────────────────────────
  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentMultiStepTrigger);
  await page.getByTestId("copilotkit-v2-send").click();
  const execPhase = await waitForPhase(page, ["executing"], 120_000);
  const s3 = await captureCell(page, "S3-有计划执行中");
  if (execPhase === "executing") {
    expect(visible(s3.planPanel), "S3 执行中该显示 plan panel").toBe(true);
  }

  // ── S5 run 成功结束后 ⇒ 不该显示（人类投诉的直接来源）────────────────
  const donePhase = await waitForPhase(page, ["done", "failed", "cancelled"], 240_000);
  expect(donePhase, "S5 需要一条真正跑完的 run").toBe("done");
  const doneThreadUrl = page.url();
  const s5 = await captureCell(page, "S5-run成功结束后");
  expect(s5.runStatus, "S5 应为 succeeded").toBe("succeeded");
  expect(visible(s5.planPanel), "S5 run 已结束、账本跑满：plan panel 不该常驻（#3321 回归）").toBe(false);
  expect(visible(s5.phaseIndicator), "S5 run 已结束：阶段条也不该常驻").toBe(false);

  // ── S8 切走再切回同一会话 ⇒ 与 S5 同（不该凭空出现）──────────────────
  await openAuthoritativeFreshThread(page);
  await page.goto(doneThreadUrl);
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible({ timeout: 120_000 });
  await waitForPhase(page, ["done"], 60_000);
  const s8 = await captureCell(page, "S8-切走再切回");
  expect(visible(s8.planPanel), "S8 切回一条已结束的会话：plan panel 不该出现").toBe(false);

  // ── S9 刷新页面后恢复 ⇒ 与 S8 同 ──────────────────────────────────────
  await page.reload();
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible({ timeout: 120_000 });
  await waitForPhase(page, ["done"], 60_000);
  const s9 = await captureCell(page, "S9-刷新后恢复");
  expect(visible(s9.planPanel), "S9 刷新后：plan panel 不该出现").toBe(false);

  // ── S2 刚发消息、run 尚未产出计划 ────────────────────────────────────
  await openAuthoritativeFreshThread(page);
  await selectWorkbenchAgent(page, CHAT_READ_E2E.deepAgentId);
  const s2Pre = await captureCell(page, "S2a-发消息前");
  expect(visible(s2Pre.planPanel), "S2a 发消息前不该显示").toBe(false);
  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentMultiStepTrigger);
  await page.getByTestId("copilotkit-v2-send").click();
  await page.waitForTimeout(2_000);
  await captureCell(page, "S2b-消息已发run刚起");

  // ── S4 等待人类审批（HITL 中断）⇒ 该显示，且阶段条属契约常驻四态 ──────
  await openAuthoritativeFreshThread(page);
  await selectWorkbenchAgent(page, CHAT_READ_E2E.deepAgentId);
  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentApprovalTrigger);
  await page.getByTestId("copilotkit-v2-send").click();
  const approvingPhase = await waitForPhase(page, ["approving"], 180_000);
  const s4 = await captureCell(page, "S4-等待人类审批");
  if (approvingPhase === "approving") {
    // 契约 `PLAN_PHASE_INDICATOR_PINNED_PHASES` 明写 approving 常驻。
    expect(visible(s4.phaseIndicator), "S4 approving：阶段条属契约常驻四态").toBe(true);
  }

  // ── S6 run 失败后 ⇒ 该显示（要有恢复入口）────────────────────────────
  await openAuthoritativeFreshThread(page);
  await selectWorkbenchAgent(page, CHAT_READ_E2E.deepAgentId);
  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentFailureTrigger);
  await page.getByTestId("copilotkit-v2-send").click();
  const failedPhase = await waitForPhase(page, ["failed"], 180_000);
  const s6 = await captureCell(page, "S6-run失败后");
  if (failedPhase === "failed") {
    expect(visible(s6.planPanel), "S6 失败一定要有可操作入口").toBe(true);
    expect(visible(s6.phaseIndicator), "S6 failed 属契约常驻四态").toBe(true);
  }

  // ── S7 取消后 ⇒ 面板卸载，但阶段条常驻（契约常驻四态之一，不许被父连坐）──
  //   ⚠ #3328 之后「取消」入口不是独立按钮，是发送按钮变形态「停止生成」。
  //   上一轮找 `copilotkit-v2-cancel` 找不到（cancelBtnFound:false），那一格根本没采到。
  await openAuthoritativeFreshThread(page);
  await selectWorkbenchAgent(page, CHAT_READ_E2E.deepAgentId);
  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentSlowTrigger);
  await page.getByTestId("copilotkit-v2-send").click();
  await waitForPhase(page, ["executing", "planning"], 120_000);
  const stopBtn = page.locator('[data-testid="copilotkit-v2-send"][data-send-state="running"]');
  await expect(stopBtn, "S7 需要「停止生成」入口才能采到 cancelled").toBeVisible({ timeout: 60_000 });
  await stopBtn.click();
  const cancelledPhase = await waitForPhase(page, ["cancelled"], 120_000);
  const s7 = await captureCell(page, "S7-取消后");
  if (cancelledPhase === "cancelled") {
    // 矛盾 1 的那一格：契约说 cancelled 常驻阶段条，改动前宿主的终态卸载门
    // 把父整块 return null，阶段条被连坐卸载。
    expect(visible(s7.phaseIndicator), "S7 cancelled：阶段条属契约常驻四态，不许被父连坐卸载").toBe(true);
  }
});
