import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import { expectAssistantTurnSettled } from "./support/chat-path-coverage";

/**
 * issue #2039 —— `/chat/copilotkit-v2` UIUX 三轮迭代的**取证截图 spec**。
 *
 * 它不是功能断言 spec（功能各有专属 spec），职责是把这块屏的关键视觉状态在真栈、
 * 真登录下抓成 PNG 落进 `.copilotkit-v2-uiux/`，供：
 *   ① 每轮迭代的前后对比留档（同一支 spec、同一批状态、同一组文件名，跑两次 diff 图）；
 *   ② 后续 rev-uiux / fidelity 流程复核时有真栈截图可看，不用只读代码打分。
 *
 * 断言刻意最小化（元素存在 + 无横向溢出），不断言像素——像素对比由人看图完成，
 * 机器断言只守住「截图里真的有内容」（H1 反空转）与「375px 不横向溢出」（U8）。
 */

const OUT = resolve(process.env.COPILOTKIT_V2_UIUX_OUT ?? ".copilotkit-v2-uiux");

test.setTimeout(180_000);

/*
 * issue #3072 —— 这里原本自带一份读 `title` 的 `expectSendNotBlockedOnRun`
 * （判 `title !== "Agent 正在处理上一条消息，请稍候…"`）。那是**死门**：产品自
 * 2026-09-06「agent 还在生成时也要能回复 A/B」之后已经删掉这条禁用理由——
 * `copilotkit-v2-panel-body.tsx` 的 `sendDisabledReason` 里只剩注释，判据因此恒真，
 * run 还没起来就在第一次采样"通过"，等于不等。
 *
 * #3000 已经把同一形状的另外两份副本（`copilotkit-v2-stream-frame-timing.spec.ts`
 * 与 `copilotkit-v2-runtime-adapter.spec.ts`）收敛到 `support/chat-path-coverage.ts`；
 * 这是第三份，一并收敛，不在本文件重新声明同一个事实。改用那里的
 * `expectAssistantTurnSettled`：先等 assistant 正文真的渲出非空文本（run 没起来 /
 * 没产出时会如实红），再读 `data-send-state` 等运行态落定。
 *
 * ⚠ 这三处截图用例（:82 多轮 markdown、:98 多步工具卡）此前因为这道死门根本没等，
 * 抓到的可能是"还在流式组装中途"的画面。换成真门之后它们会真的等到回合落定再截图，
 * 这是判据变强，不是放宽。
 */

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/projects$/);
  await expect
    .poll(
      async () => (await page.request.get("/api/copilotkit/info")).status(),
      { timeout: 60_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe(200);
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `horizontal overflow of ${overflow}px at ${page.viewportSize()?.width}px`).toBeLessThanOrEqual(0);
}

test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true });
});

test("空态 + 移动端宽度：桌面/375px 两档截图，375 不横向溢出", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/chat");
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible();
  // 让线程列表/agent 目录读完再抓（空态或列表都算稳态；这里等 composer 卡片出现即可）。
  await expect(page.getByTestId("chat-task-workbench-composer")).toBeVisible();
  await page.waitForTimeout(1_000);
  await page.screenshot({ path: resolve(OUT, "empty-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(OUT, "empty-mobile-375.png"), fullPage: true });
  await noHorizontalOverflow(page);
});

test("多轮对话 + markdown 回复 + 追问建议：桌面截图", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/chat");
  const input = page.getByTestId("copilotkit-v2-input");
  await input.fill("你好，请介绍一下你自己");
  await page.getByTestId("copilotkit-v2-send").click();
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText("你好，请介绍一下你自己", { timeout: 30_000 });
  await expectAssistantTurnSettled(page);
  await input.fill(CHAT_READ_E2E.deepAgentMarkdownTrigger);
  await page.getByTestId("copilotkit-v2-send").click();
  await expectAssistantTurnSettled(page);
  await page.waitForTimeout(1_000);
  await page.screenshot({ path: resolve(OUT, "conversation-markdown.png"), fullPage: true });
});

test("工具调用卡（多步剧本）：桌面截图", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/chat");
  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentMultiStepTrigger);
  await page.getByTestId("copilotkit-v2-send").click();
  await expectAssistantTurnSettled(page);
  await page.waitForTimeout(1_000);
  await page.screenshot({ path: resolve(OUT, "tool-cards.png"), fullPage: true });
});

test("错误横幅：真实失败链路下的视觉层级截图", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/chat");
  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentFailureTrigger);
  await page.getByTestId("copilotkit-v2-send").click();
  await expect(page.getByTestId("copilotkit-v2-error")).toHaveCount(1, { timeout: 60_000 });
  await page.screenshot({ path: resolve(OUT, "error-banner.png"), fullPage: true });
});

test("工具权限确认弹层：等待裁决态截图（issue #2767 起为 F08 ToolPermissionCard 四选一）", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/chat");
  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentApprovalTrigger);
  await page.getByTestId("copilotkit-v2-send").click();
  const dialog = page.getByTestId("chat-tool-permission-dialog");
  /*
   * issue #3072 / #3068 —— 这条在干净基线 run 34198904439 上红成一句读不出所以然的
   * `element(s) not found`（60s）。真实原因写在同一份 `error-context.md` 的页面快照里：
   *
   *     - status: 正在执行技能脚本（quarterly-report）…
   *
   * 弹层没出现，run **直接执行**了那个技能——因为 `copilotkit-v2-hitl.spec.ts` 的
   * 「forever」用例已经往这个**共享** e2e 组织写下了一条 `scope='forever'`、
   * `run_id` 为空、组织级跨 run 无过期的授权（`tool_permission_grants`），此后同一个
   * 工具的审批一律自动放行。
   *
   * ⚠ 这条红**修不掉，也不该在这里绕过去**：`20260905120000_f06_tool_permission_tiering.sql`
   * 只给 `app_rw` 授了 `SELECT, INSERT`，逐字写明「只增不改不删……没有 UPDATE/DELETE
   * 授权即是这个纪律在权限层面的落地」。所以撤销一条 forever 授权在**当前 schema 下
   * 不可能**——这正是 #3068（forever 无撤销路径，卡片文案承诺的撤销方式永远不会发生）
   * 那个真实产品缺口，修它需要迁移 + 端口 + 端点，不在本 spec 范围。
   *
   * 在 #3068 落地之前，这里只把失败变得**可读**：判据一字未放宽（弹层仍然必须出现），
   * 但超时时把页面上那条 status 摘进失败信息，让下一个人一眼看出是"被自动放行"
   * 而不是"弹层组件坏了"。
   */
  try {
    await expect(dialog).toBeVisible({ timeout: 60_000 });
  } catch (failure) {
    const status = (await page.getByRole("status").last().textContent().catch(() => null))?.trim();
    throw new Error(
      `${failure instanceof Error ? failure.message : String(failure)}\n\n`
      + `【诊断】页面最后一条 status：${status ?? "（读不到）"}\n`
      + "若它显示 run 已经在执行技能而不是在等你确认，说明本组织已被 hitl.spec.ts 的 "
      + "forever 用例写下组织级常驻授权，审批被自动放行 —— 根因见 #3068（forever 无撤销路径），"
      + "不是审批弹层本身坏了。",
    );
  }
  // 四个决策按钮都渲染出来才算真的到了"等待裁决"这一态，不是流式组装中途的截图。
  await expect(page.getByTestId("perm-deny")).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: resolve(OUT, "hitl-dialog.png"), fullPage: true });
  // 收尾：拒绝，让 run 干净结束，不留挂起的审批。
  await page.getByTestId("perm-deny").click();
});
