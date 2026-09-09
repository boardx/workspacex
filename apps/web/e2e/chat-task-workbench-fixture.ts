import { expect, type Page, type Locator } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import { openAuthoritativeFreshThread } from "./support/authoritative-thread";

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
  /*
   * ⚠ **已登录时再调本函数，这里立刻红并说明原因**——而不是等 `fill()` 超时。
   *
   * `LoginSessionGate`（`components/entry/login-session-gate.tsx`）在 `useSession()`
   * 的 `status` 还是初始值 `"loading"` 时渲染登录表单，等会话恢复完翻成
   * `"authenticated"` 就 `router.replace` 走掉、改渲 `login-session-loading`。所以
   * 「已登录之后再 goto('/login')」看不看得见 `login-email` 是一场**赛跑**：赢了就绿，
   * 输了 `fill()` 一路等到用例超时（240s），**一条业务断言都不执行**。
   * run 34311571065 首跑 C6/F2 赢了、F5 输了，就是这个形状；早前 D4/F2/F6/F7 四条
   * 也各以同一形态烧掉 4–5 分钟（见 `support/chat-path-coverage.ts` 头注）。
   *
   * 那条「不要在 `openFresh*Thread` 之前再 `login()`」的规矩此前只写在注释里——
   * 「没有脚本的规范条目视为未落地」，本仓已为此栽了两轮。这个 race 把它变成会红的东西：
   * 输了赛跑 ⇒ 这里给出指名根因的错误；赢了赛跑 ⇒ 照旧登录（不改变任何既有行为）。
   */
  const gate = await Promise.race([
    page.getByTestId("login-email").waitFor({ state: "visible", timeout: 30_000 })
      .then(() => "form" as const),
    page.getByTestId("login-session-loading").waitFor({ state: "visible", timeout: 30_000 })
      .then(() => "already-authed" as const),
  ]).catch(() => "form" as const);
  expect(
    gate,
    "这个 page 已经登录了：`/login` 被 LoginSessionGate 重定向走，`login-email` 永远不会出现。"
      + "不要在 `openChatEmptyState` / `openFresh*Thread` 之前再自己 `login()`——它们内部已经登录过一次。",
  ).toBe("form");
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
 * ⚠ 这里**故意不复制**既有 spec 里的 `warmUpThreadRoute`。
 *
 * 那个 helper 的做法是 `goto("/chat/warmup-route-compile-only")` 然后等
 * `copilotkit-v2-input` 可见 120s。本轮第一次真栈跑（44 tests，5 workers）**全部 44 条
 * 以 3.0m 收场**，error-context 逐条指向同一处：
 *
 *     Locator: getByTestId('copilotkit-v2-input')
 *     Timeout: 120000ms — element(s) not found
 *
 * 即那条 warmup 线程 id 根本不存在，`/chat/[threadId]` 对不存在的线程不渲染输入框，
 * 这个等待**必然**走满 120s 再失败——它焐的是编译，却拿一个业务态当就绪信号。
 * 于是每条用例都在 setup 里烧光预算，一条真实断言都没跑到，整轮零信号。
 *
 * 编译预热这件事**已经有单一事实源**：`chat-route-warmup.global-setup.ts` 在所有
 * webServer ready 之后、任何 worker 起来之前，对 `/api/copilotkit/info`、`/chat`、
 * `/chat/warmup-route-compile-only`、`/login` 各发一次真实 HTTP GET（预算 300s）。
 * Next dev 的编译结果是**进程级**的，所有 worker 随后走的都是热路径。再在每个 spec
 * 里复制一份等待，既是「同一事实声明在两处」，又正好是本轮零信号的直接原因。
 */

/** 登录 + 焐热 + 停在 `/chat` 空状态（TW-P0-1/2/4/5 的共同起点）。 */
export async function openChatEmptyState(page: Page): Promise<void> {
  await warmUpCopilotRuntimeRoute(page);
  await login(page);
  await page.goto("/chat");
  // `/chat` 只在没有 `?projectId=` / `?thread=` 时渲染 v2 轨道，这里正是裸路径。
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible({ timeout: 120_000 });
}

/**
 * 登录 + 焐热 + 新建一条持久化线程，返回 threadId（TW-P0-3/6/7 的共同起点）。
 *
 * ## issue #3118：这里此前点的是「新建对话」按钮
 *
 * 旧实现点 `chat-thread-create` 然后 `waitForURL(/\/chat\/…/)`——**恢复出来的旧线程
 * 同样匹配那个正则**，它判的是「URL 变了」而不是「线程是新的」。而该按钮按产品设计
 * 在列表顶部已是 `not-started` 空线程时复用那一条（#2094 裁决）。于是本车道 ~48 个
 * 调用点全都可能落到别的用例刚建出来的线程上。
 *
 * 现在改走权威端口，并由 `openAuthoritativeFreshThread` **在 helper 内部**断言
 * 「是新的 + 是空的」。理由与例外清单逐字见 `support/authoritative-thread.ts` 头注。
 */
export async function openFreshThread(page: Page): Promise<string> {
  await openChatEmptyState(page);
  return await openAuthoritativeFreshThread(page);
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
