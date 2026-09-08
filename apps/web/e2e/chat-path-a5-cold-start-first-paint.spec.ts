import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { login, warmUpCopilotRuntimeRoute } from "./support/chat-path-coverage";

/**
 * 路径矩阵 **A5 · 冷启动首屏**（判据见 `.harness/instructions/chat-path-coverage-matrix.md`）。
 *
 * ## 现状：只有"预热"，没有"到得了可输入"
 *
 * `chat-route-warmup.global-setup.ts` 做的是把 Next dev 的 `/chat` 路由**编译热**，
 * 它是所有其它用例的前置条件，本身不断言任何用户可见状态。于是"第一次打开 `/chat`
 * 的人，看到的是能用的输入框，还是一个卡住的骨架屏"这件事，此前没有任何断言。
 *
 * 这条路径的失效形态是安静的：首屏渲染出来了，但 composer 因为在等某个接口而永久
 * 禁用；或者线程列表一直停在骨架屏。两者都不报错，只是用不了。
 *
 * ## 为什么这里不判一个耗时阈值
 *
 * 延迟阈值的唯一事实源是 `.harness/instructions/chat-agent-performance-acceptance.md`
 * 的那张 SLO 表，而**冷启动首屏在那张表里目前没有行**（标准只说"单独记录"）。在这里
 * 现编一个数字，等于给同一件事造第二个事实源——本仓已经五次因此漂移。所以本条：
 *   · **断言**功能可达（可输入、无错误态、列表不停在骨架屏）——这是会红的部分；
 *   · **记录**实测耗时到证据文件，供将来往那张 SLO 表里加行时当基线用。
 * 往表里加行是那份标准的事，不是这条 spec 的事。
 */
test.setTimeout(180_000);

const OUT = resolve(process.env.CHAT_PATH_COVERAGE_OUT ?? "e2e/__evidence__/chat-path-coverage");

test("@path:A5 冷启动首屏：全新会话第一次进 /chat 就能输入，不停在骨架屏", async ({ page }) => {
  // 全新 context 由 Playwright 每个 test 各给一个（无 storageState、无 localStorage），
  // 这正是"第一次来的人"的形状——不需要额外造。
  await login(page);
  await warmUpCopilotRuntimeRoute(page);

  const startedAt = Date.now();
  await page.goto("/chat", { waitUntil: "commit" });

  const input = page.getByTestId("copilotkit-v2-input");
  await expect(
    input,
    "第一次进 /chat 必须走到可输入——渲染出来但永久禁用的 composer，和白屏对用户是同一件事",
  ).toBeVisible({ timeout: 120_000 });
  await expect(input).toBeEditable({ timeout: 60_000 });
  const readyMs = Date.now() - startedAt;

  // 诚实失败态必须为空：首屏不许以一条错误横幅收场。
  await expect(page.getByTestId("copilotkit-v2-error")).toHaveCount(0);

  // 记录（不判阈值，理由见文件头注）。
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    resolve(OUT, "a5-cold-start.json"),
    `${JSON.stringify({ path: "A5", measuredAt: new Date().toISOString(), composerReadyMs: readyMs }, null, 2)}\n`,
  );
  // 这条 expect 只挡"计时器根本没跑"这一种情况（0 或负数说明测量本身坏了），
  // 不是一个伪装成断言的性能阈值。
  expect(readyMs, "冷启动耗时必须是一个真实测到的正数").toBeGreaterThan(0);
});
