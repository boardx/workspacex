import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CHAT_READ_E2E } from "./chat-read-fixture";

/**
 * DA-19c 工具可见性（框架版 Gap 1/4，backlog `DA-19c`）—— 证明 `/chat/copilotkit-v2`
 * 路由上用 `useRenderTool` 注册的 `write_todos`/`search_documents` 定制卡片真的渲染出来
 * （`copilotkit-v2-tool-renderers.tsx`），不是只在代码里写完就算数。
 *
 * ## 为什么用 `LOOPBACK_DEEP_AGENT_MULTISTEP_TRIGGER` 取 `search_documents` 证据
 *
 * 默认剧本（`loopback-deep-agent-provider.ts` 的 `/state` 兜底分支）只发
 * `write_todos` + `LOOPBACK_DEEP_AGENT_TOOL_NAME`（默认 `lookup_time`）两个工具，没有
 * `search_documents`。`deepAgentMultiStepTrigger` 那句触发词的剧本是
 * write_todos → search_documents → read_document → 终稿——`playwright.chat-read.config.ts`
 * 已经把 `CHAT_READ_E2E.deepAgentMultiStepTrigger` 下发给替身进程的
 * `LOOPBACK_DEEP_AGENT_MULTISTEP_TRIGGER`，本 spec 直接复用，不需要新的进程或环境变量。
 *
 * ## 已知限制①——与 `copilotkit-v2-runtime-adapter.spec.ts` 同一条登记
 *
 * 该 spec 文件头「已知限制①」记录过：`@copilotkit/react-core/v2` 客户端对"主回答流式增量"
 * 与"`onStep` 为工具调用步骤单独开关的 planningNote 文本消息"这种在 wire 上交叉重叠的
 * AG-UI 消息重建不完整，偶发导致 `agent.messages` 最终只剩一条空文本 assistant 消息。
 * 工具调用（`TOOL_CALL_START/ARGS/END/RESULT`）走的是按 `toolCallId` 独立累积的另一条
 * 通道，本轮实测下面会记录它是否受同一限制影响；不确定的情况下用同一套"每次重试整页
 * 刷新"纪律排除偶然，而不是放宽断言掩盖问题。
 *
 * ## 已知限制③（本轮 DA-19c 实测新发现，登记但不在本任务范围内修——纯后端问题，
 * 与本任务改动的前端文件无关）
 *
 * `search_documents`/`read_document` 的 `TOOL_CALL_RESULT.content` 在多步剧本下
 * **稳定复现为空字符串**（4/4 次实测，wire 字节实锤见下方 test 2 用
 * `page.route()+route.fetch()` 抓的原始 SSE，与 `copilotkit-v2-runtime-adapter.spec.ts`
 * test 1 同一套取证手法）——即使 `chat-behavior-shots.spec.ts` 用旧手写面板
 * （走 `AgentRunView.steps` 轮询接口，不经过 AG-UI 桥）对同一个多步剧本已经证明过
 * `search_documents` 的结果文本在数据库层是真实存在的（`pg-agent-run-repository.ts`
 * 的折叠查询 `ORDER BY (status<>'in_progress') DESC, seq DESC` 能选出终态行）。
 *
 * 根因初步定位（读代码得出，未做代码改动验证，如实标注"初步"）：
 *   1. `agui-bridge.ts` 的 `RunStepPublic` 契约**不携带 `toolCallId`**（该文件自己的
 *      注释写着"it stops here ... never reaches the public contract"）——同一个逻辑工具
 *      调用的 `in_progress`/`succeeded` 两次上报因此在 AG-UI 层没有稳定 id 可以关联。
 *   2. `agui-bridge.ts` 的 `onStep` 用 `projection.steps.slice(reportedStepCount)`
 *      （纯长度游标）判断"这次轮询有没有新 step"——但 `pg-agent-run-repository.ts`
 *      的折叠查询按"胜出行的 seq"重新排序整个数组，同一个 `tool_call_id` 从
 *      `in_progress` 行胜出切换到 `succeeded` 行胜出时，它在数组里的**位置会前移到
 *      更靠后**，而数组总长度不变（同一个分组，不是新分组）——一旦这个位置已经被
 *      `reportedStepCount` 跨过，那次"从 in_progress 变成 succeeded、真正带着结果文本"
 *      的更新就再也不会进入 `slice(reportedStepCount)`，`onStep` 只看到过第一次
 *      （`in_progress`，`toolResultSummary` 恒为 `null`）的版本。
 *   3. `copilotkit-agui.controller.ts` 的 `writeToolCallStep` 收到任何 `RunStepPublic`
 *      （不区分 `status`）都无条件发送完整的
 *      `TOOL_CALL_START→ARGS→END→RESULT→STEP_FINISHED` 序列——该文件自己的注释
 *      "Every RunStepPublic ... is ALREADY COMPLETE by the time onStep fires" 是 #742
 *      Gap 1（引入真实 `in_progress` 上报）之前的前提，Gap 1 落地时没有同步更新这段
 *      注释和逻辑：一个真正"进行中"的 `RunStepPublic` 也会被当作已终结的调用发出去
 *      （`content` 用 `toolResultSummary ?? ""`，此刻恒为 `""`），于是 CopilotKit 客户端
 *      看到的是一个"已完成但结果为空"的假终态，而不是真正的 `executing` 中间态。
 *
 * 这三点合起来能完整解释观测到的现象（`data-tool-status` 稳定到达 `"complete"`，
 * `result` 稳定为空），但**没有改代码验证过修复方案本身**——如实标注为诊断，不是已验证
 * 的修复。这是三处共享基础设施代码（`agui-bridge.ts`/`copilotkit-agui.controller.ts`/
 * `RunStepPublic` 契约）的改动，被 `copilotkit-agui-state-snapshot.spec.ts`/
 * `copilotkit-v2-runtime-adapter.spec.ts` 等既有 spec 共用，不在"给两个工具注册
 * `useRenderTool` 定制卡片"这个任务范围内一并动它——下面 test 2 因此只断言协议层面
 * 真实可验证的部分（卡片挂载、`query` 参数可见、状态机走到终态），不对 `result` 文本
 * 断言，避免用一条会稳定红的断言把整个任务判死，也避免悄悄放宽断言掩盖问题——
 * 断言收窄的理由和证据都写在这里，不是拍脑袋。
 */

const OUT = resolve(process.env.COPILOTKIT_V2_TOOL_RENDERING_OUT ?? ".copilotkit-v2-tool-rendering");
test.setTimeout(180_000);

// issue #2033 —— unroute 必须拿注册时**同一个函数引用**：函数 matcher 配字符串
// pattern（此前的 `unroute("**/api/copilotkit/**")`）按 url 参数相等匹配永远卸不掉，
// route 处理器里的 `route.fetch()` 会在测试主体结束后被 CopilotKit 异步追问建议请求
// 命中，撞上 `route.fetch: Test ended` 且归因到后续测试名下（2026-08-25 本 spec
// search_documents 用例在 #2033 修复验证 run 里实测撞到，与 runtime-adapter test 1
// 同一泄漏类）。
const runRouteMatcher = (u: URL): boolean =>
  u.pathname.includes("/api/copilotkit/") && u.pathname !== "/api/copilotkit/info";

async function login(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/projects$/);
}

/** 与 `copilotkit-v2-runtime-adapter.spec.ts` 逐字相同的预热手法——见该文件头注。 */
async function warmUpCopilotRuntimeRoute(page: import("@playwright/test").Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const res = await page.request.get("/api/copilotkit/info");
        return res.status();
      },
      { timeout: 60_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe(200);
}

test("DA-19c write_todos 定制卡片——进行中/完成两态真实渲染出计划条目", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await login(page);

  const MAX_ATTEMPTS = 4;
  let renderedList = false;
  let lastNote = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    await warmUpCopilotRuntimeRoute(page);
    await page.goto("/chat/copilotkit-v2");
    await page.getByTestId("copilotkit-v2-input").fill("DA-19c 取证：随便问一句触发默认剧本");
    await page.getByTestId("copilotkit-v2-send").click();

    const errorBanner = page.getByTestId("copilotkit-v2-error");
    const card = page.getByTestId("copilotkit-v2-tool-write-todos").first();

    // 默认剧本先发「宣布」（in_progress 语义，卡片应处于 inProgress/executing 态），
    // 给足时间窗口后再检查终态——与 runtime-adapter spec 的 12s 观测窗同数量级。
    const appeared = await card
      .waitFor({ state: "attached", timeout: 20_000 })
      .then(() => true)
      .catch(() => false);

    if (!appeared) {
      if ((await errorBanner.count()) > 0) {
        lastNote = `attempt ${attempt}: error banner present: ${await errorBanner.first().textContent()}`;
      } else {
        lastNote = `attempt ${attempt}: copilotkit-v2-tool-write-todos never attached (known limitation① candidate)`;
      }
      continue;
    }

    // 等它落到终态（`data-tool-status="complete"`）——真实计划条目列表只在这一态渲染。
    await expect
      .poll(async () => card.getAttribute("data-tool-status"), { timeout: 20_000 })
      .toBe("complete");

    const list = page.getByTestId("copilotkit-v2-tool-write-todos-list");
    if ((await list.count()) === 0) {
      lastNote = `attempt ${attempt}: card reached complete but no todos list rendered`;
      continue;
    }

    // ── 反证：真实计划条目文本可见，不是一个空壳卡片。
    const items = list.locator("li");
    await expect(items.first()).toBeVisible();
    const itemCount = await items.count();
    expect(itemCount).toBeGreaterThan(0);

    writeFileSync(resolve(OUT, "write-todos-attempts.txt"), `succeeded on attempt ${attempt}/${MAX_ATTEMPTS}`, "utf8");
    await page.screenshot({ path: resolve(OUT, "copilotkit-v2-write-todos.png") });
    renderedList = true;
    break;
  }

  expect(renderedList, `all ${MAX_ATTEMPTS} attempts failed; last: ${lastNote}`).toBe(true);
});

test("DA-19c search_documents 定制卡片——检索词参数真实渲染、状态机走到终态（result 文本断言见文件头已知限制③）", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await login(page);

  const MAX_ATTEMPTS = 4;
  let renderedCard = false;
  let lastNote = "";
  let wireCaptured = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let capturedBody: Buffer | null = null;
    // 只在第一次成功抓到 wire 字节的那次落盘一份证据（已知限制③引用的原始数据），
    // 不需要每次重试都写一份。
    await page.route(runRouteMatcher, async (route) => {
      if (route.request().method() !== "POST") { await route.continue(); return; }
      const fetched = await route.fetch();
      capturedBody = await fetched.body();
      await route.fulfill({ response: fetched });
    });

    await warmUpCopilotRuntimeRoute(page);
    await page.goto("/chat/copilotkit-v2");
    await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentMultiStepTrigger);
    await page.getByTestId("copilotkit-v2-send").click();

    await expect.poll(() => capturedBody !== null, { timeout: 60_000 }).toBe(true);
    await page.unroute(runRouteMatcher);
    if (capturedBody !== null && !wireCaptured) {
      writeFileSync(resolve(OUT, "wire-known-limitation-3-evidence.txt"), (capturedBody as Buffer).toString("utf8"), "utf8");
      wireCaptured = true;
    }

    const errorBanner = page.getByTestId("copilotkit-v2-error");
    const card = page.getByTestId("copilotkit-v2-tool-search-documents").first();

    const appeared = await card
      .waitFor({ state: "attached", timeout: 20_000 })
      .then(() => true)
      .catch(() => false);

    if (!appeared) {
      if ((await errorBanner.count()) > 0) {
        lastNote = `attempt ${attempt}: error banner present: ${await errorBanner.first().textContent()}`;
      } else {
        lastNote = `attempt ${attempt}: copilotkit-v2-tool-search-documents never attached (known limitation① candidate)`;
      }
      continue;
    }

    // ── 反证① 检索词（args.query，逐字等于剧本里的 `record.userText`，即触发词本身）可见——
    // 这条走的是 TOOL_CALL_ARGS，不受已知限制③（只影响 TOOL_CALL_RESULT）波及。
    await expect(card).toContainText(CHAT_READ_E2E.deepAgentMultiStepTrigger);

    // ── 反证② 状态机真的走到了框架定义的终态（`data-tool-status="complete"`）——
    // 证明 `useRenderTool` 的三态注册确实接线成功、响应了真实的 AG-UI 事件序列，
    // 不是卡在一个假的"永远 inProgress"状态。已知限制③只影响 `result` 文本内容，
    // 不影响状态机本身能否走完。
    await expect
      .poll(async () => card.getAttribute("data-tool-status"), { timeout: 20_000 })
      .toBe("complete");

    writeFileSync(resolve(OUT, "search-documents-attempts.txt"), `succeeded on attempt ${attempt}/${MAX_ATTEMPTS}`, "utf8");
    await page.screenshot({ path: resolve(OUT, "copilotkit-v2-search-documents.png") });
    renderedCard = true;
    break;
  }

  expect(renderedCard, `all ${MAX_ATTEMPTS} attempts failed; last: ${lastNote}`).toBe(true);
});
