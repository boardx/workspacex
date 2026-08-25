import { expect, type Page, type Locator } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";

/**
 * issue #2068 —— 「Chat 任务工作台」验收用例的共享外壳。
 *
 * ## 为什么是一个模块，不是每个 spec 各抄一份
 *
 * 本套件既有 spec（`copilotkit-v2-right-panel.spec.ts` 等）都把 `login` /
 * `warmUpCopilotRuntimeRoute` / `warmUpThreadRoute` **各自抄一份**——那是历史，
 * 不是规矩。本 issue 一次新增 10 个 spec，抄 10 份等于把「同一事实声明在多处」
 * （AGENTS.md 五次漂移那条）主动复现一次。焐热逻辑是**一个事实**（Next dev
 * 按需编译 `[threadId]` 动态段会挤爆 `waitForURL`，见
 * `copilotkit-v2-skill-mount.spec.ts` 头注记录的实测根因），收在这里。
 *
 * ⚠ 本文件**不是** spec：文件名不以 `.spec.ts` 结尾，不会被
 * `playwright.chat-read.config.ts` 的 `testMatch` 捞进去（同
 * `chat-read-fixture.ts` 的既有做法）。
 *
 * ## 缺口断言的纪律（本套件的全部价值所在）
 *
 * 人类 2026-08-26 给 `/chat` 空状态打 4/10，批评是「能力没被转化成用户可理解、
 * 可控制的工作流」。把这句话变成会红的数字，唯一办法是**让缺口以失败的形式存在**。
 * 因此本文件提供 `expectAnchor()`：锚不到就 **fail**，并在失败信息里逐字写明
 * 「该能力当前不存在，锚点待实现为 data-testid=X」+ 回指验收卡条目。
 *
 * **不许 `test.skip`**——skip 掉的差距等于不存在（issue #2068 验收条件第 3 条）。
 */

/** 验收卡单一事实源。判据只在那里定义，spec 只引用锚点编号。 */
export const ACCEPTANCE_DOC = ".harness/instructions/chat-task-workbench-acceptance.md";

export function gapMessage(clause: string, testId: string, what: string): string {
  return [
    `【差距 ${clause}】${what}`,
    `该能力当前不存在，锚点待实现为 data-testid=${testId}`,
    `判据见 ${ACCEPTANCE_DOC} 的 ${clause} 一节。`,
  ].join("\n");
}

/**
 * 断言一个验收锚点真实存在且可见。锚不到就红，并把「差距 + 待实现锚点」写进
 * 失败信息——这正是本套件要产出的那个「会红的数字」。
 */
export async function expectAnchor(
  page: Page,
  testId: string,
  clause: string,
  what: string,
  timeout = 15_000,
): Promise<Locator> {
  const locator = page.getByTestId(testId);
  await expect(locator, gapMessage(clause, testId, what)).toBeVisible({ timeout });
  return locator;
}

export async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/projects$/);
}

/** 同既有 spec：先把 CopilotRuntime 路由焐热。 */
export async function warmUpCopilotRuntimeRoute(page: Page): Promise<void> {
  await expect
    .poll(async () => (await page.request.get("/api/copilotkit/info")).status(), {
      timeout: 60_000,
      intervals: [500, 1_000, 2_000],
    })
    .toBe(200);
}

/**
 * `/chat/[threadId]` 动态路由的编译焐热——逐字同
 * `copilotkit-v2-right-panel.spec.ts` / `copilotkit-v2-skill-mount.spec.ts`
 * 的既有 `warmUpThreadRoute`，不是新发明。
 */
export async function warmUpThreadRoute(page: Page): Promise<void> {
  await page.goto("/chat/warmup-route-compile-only");
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible({ timeout: 120_000 });
}

/** 登录 + 焐热 + 停在 `/chat` 空状态（TW-P0-1/2/4/5 的共同起点）。 */
export async function openChatEmptyState(page: Page): Promise<void> {
  await warmUpCopilotRuntimeRoute(page);
  await login(page);
  await warmUpThreadRoute(page);
  await page.goto("/chat");
  // `/chat` 只在没有 `?projectId=` / `?thread=` 时渲染 v2 轨道，这里正是裸路径。
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible({ timeout: 120_000 });
}

/** 登录 + 焐热 + 新建一条持久化线程，返回 threadId（TW-P0-3/6/7 的共同起点）。 */
export async function openFreshThread(page: Page): Promise<string> {
  await openChatEmptyState(page);
  await page.getByTestId("chat-thread-create").click();
  await page.waitForURL(/\/chat\/(?!warmup-)[^/]+$/, { timeout: 60_000 });
  const threadId = /\/chat\/([^/?#]+)/.exec(page.url())?.[1];
  expect(threadId, "新建线程后 URL 应带上 threadId").toBeTruthy();
  return threadId as string;
}

/** 发一条消息并等到 run 落定（不断言回复内容，那是 chat-ux 卡的事）。 */
export async function sendAndSettle(page: Page, text: string): Promise<void> {
  await page.getByTestId("copilotkit-v2-input").fill(text);
  await page.getByTestId("copilotkit-v2-send").click();
  await expect(page.getByTestId("copilotkit-v2-running-indicator")).toHaveCount(0, {
    timeout: 120_000,
  });
}

export { CHAT_READ_E2E };
