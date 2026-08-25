import { test, expect, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";

/**
 * issue #2020（差距清单第 3 项，阻断级）—— `/chat/copilotkit-v2` 的 Skill 挂载入口。
 *
 * ## 取证链路：挂载 → run 快照 → 模型输入，前后对照
 *
 * 挂载生效机制完全在服务端：`agui-bridge.ts` 的 `runAguiBridgeTurn` 调用
 * `acceptHumanMessage`（与旧 REST 轨道**同一个** application 入口），后者经
 * `threadMounts.activeMountedSkillVersionIds` 把线程挂载合进 run 的不可变快照，
 * `execute-run.ts` 再经 `readPinnedSkills` → `buildSystemPrompt` 把挂载 skill 的
 * `SKILL.md` 正文拼进 system prompt。浏览器侧唯一可信的观察信号与
 * `chat-agent-skill-context.spec.ts`（#1559）同一条纪律：确定性替身
 * （这条轨道是 `loopback-deep-agent-provider.ts`）只在自己真的在 `role:"system"`
 * 消息里看到哨兵 `MOUNTPROOF-9317`（只存在于可挂载 skill 的 SKILL.md 正文里，
 * 全仓别处零命中）时才把 `[skill:]MOUNTPROOF-9317` 回显进回复。
 *
 * 顺序是判据的一部分：挂载**前**先发一条对照消息、断言回复里**没有**哨兵——
 * 没有这一轮，「挂载后哨兵出现了」证明不了是挂载带来的（一个把哨兵写进每条
 * 回复的上游也能让那条断言绿）。链上任何一环断掉——挂载没写进
 * `thread_skill_mounts`、v2 的 run 没续接同一条线程、快照没带版本、
 * `buildSystemPrompt` 没拼正文、`input.system` 没发给上游——哨兵都不会出现，
 * 断言如实红。
 *
 * ## 范围诚实
 *
 * 上游是确定性替身，本文件不证明「skill 改变了模型回答的质量」——那需要真实
 * 模型语义（与 #1559 的边界逐字相同）。
 */

test.setTimeout(180_000);

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/projects$/);
}

/** Next dev 首访编译 `/api/copilotkit` 路由可能超过单条断言超时——先把路由焐热
 *  （逐字同 `copilotkit-v2-attachments.spec.ts` 的既有做法）。 */
async function warmUpCopilotRuntimeRoute(page: Page): Promise<void> {
  await expect
    .poll(
      async () => (await page.request.get("/api/copilotkit/info")).status(),
      { timeout: 60_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe(200);
}

/**
 * `/chat/copilotkit-v2/[threadId]` 动态路由的编译焐热。
 *
 * 实测根因（本 spec 首轮 serial 复跑，trace + console 取证）：本文件是整个套件里
 * 第一个**以客户端导航方式**进入 `[threadId]` 动态段的用例——`router.push` 触发
 * Next dev 的按需编译（console 里 `[Fast Refresh] rebuilding` → `done in 17088ms`），
 * 期间导航不提交、地址栏不更新，`waitForURL` 的 30s 刚好被这次编译 + 高负载挤爆
 * （网络层证据：`POST /chat/threads/mutate` 本身 80ms 就 200 了，随后 30s 零网络
 * 活动，页面在超时那一刻才 mount）。先用一次直接 `goto` 把这个路由段编译出来，
 * 后面的计时步骤量的才是产品行为，不是 dev 编译器。线程 id 用一个不存在的占位值
 * ——路由编译与 id 无关，页面对不存在的线程如实报错，不影响焐热目的。
 */
async function warmUpThreadRoute(page: Page): Promise<void> {
  await page.goto("/chat/copilotkit-v2/warmup-route-compile-only");
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible({ timeout: 120_000 });
}

/** 挂一个 skill 并等真实 POST 落库 + chip 出现（同 `chat-agent-skill-context.spec.ts`
 *  的 `mountSkill`，只是线程 id 来自 v2 的 URL 而不是夹具常量）。 */
async function mountSkillViaPanel(page: Page, threadId: string): Promise<void> {
  const mountResponse = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && response.url().includes(`/threads/${threadId}/skill-mounts`)
  ));
  // 「加 skill」在乐观锁版本号读到之前是禁用的（拒绝盲写），等它可点而不是硬点。
  await expect(page.getByTestId("chat-skill-mount")).toBeEnabled();
  await page.getByTestId("chat-skill-mount").click();
  await expect(page.getByTestId("chat-skill-mount-picker")).toBeVisible();
  await page.getByTestId(`chat-skill-mount-option-${CHAT_READ_E2E.mountableSkillId}`).click();
  const settled = await mountResponse;
  expect(settled.ok(), "挂载 POST 应成功").toBe(true);
  await expect(page.getByTestId(`chat-skill-mounted-${CHAT_READ_E2E.mountableSkillId}`)).toBeVisible();
}

const skillEcho = `${CHAT_READ_E2E.mountedSkillEchoPrefix}${CHAT_READ_E2E.mountedSkillSentinel}`;

test("issue #2020：v2 面板挂载 skill 后，它的正文真的进了下一轮 run 的模型输入（前后对照）", async ({ page }) => {
  await warmUpCopilotRuntimeRoute(page);
  await login(page);
  await warmUpThreadRoute(page);
  await page.goto("/chat/copilotkit-v2");

  /* ═══════════ ① 新对话还没有线程：如实占位，不渲染假挂载面板 ═══════════ */
  await expect(page.getByTestId("copilotkit-v2-skill-mount-placeholder")).toBeVisible();
  await expect(page.getByTestId("chat-skill-mount-panel")).toHaveCount(0);

  /* ═══════════ ② 反向对照：还没挂任何 skill，先发一条 ═══════════ */
  const messages = page.getByTestId("copilotkit-v2-messages");
  const beforeText = "挂载前对照：第一条取证消息";
  await page.getByTestId("copilotkit-v2-input").fill(beforeText);
  await page.getByTestId("copilotkit-v2-send").click();
  // deep-agent 替身默认剧本逐字回显用户原文——回复真的来自上游，不是前端合成。
  await expect(messages).toContainText(`根据查询结果回答你："${beforeText}"`, { timeout: 60_000 });
  await expect(
    messages,
    "还没挂 skill 时，回复里不该出现哨兵——否则下面的断言恒绿、证明不了任何事",
  ).not.toContainText(CHAT_READ_E2E.mountedSkillSentinel);

  /* ═══════════ ③ 首条消息 resolve 出真实线程后，挂载面板自动出现 ═══════════ */
  // 线程 id 经 CUSTOM {chat_thread_id} 事件回显 → 外壳 history.replaceState 写回地址栏。
  await page.waitForURL(/\/chat\/copilotkit-v2\/.+$/, { timeout: 30_000 });
  const threadId = /\/chat\/copilotkit-v2\/([^/?#]+)/.exec(page.url())?.[1];
  expect(threadId, "首条消息后地址栏应带上持久化线程 id").toBeTruthy();
  await expect(page.getByTestId("chat-skill-mount-panel")).toBeVisible();
  await expect(page.getByTestId("copilotkit-v2-skill-mount-placeholder")).toHaveCount(0);
  // 前提：现在一个都没挂。没有这条，「挂上了」的断言可能一开始就是真的。
  await expect(page.getByTestId("chat-skill-mount-empty")).toBeVisible();

  /* ═══════════ ④ 挂上那个 skill（真实 POST，落 thread_skill_mounts） ═══════════ */
  await mountSkillViaPanel(page, threadId!);

  /* ═══════════ ⑤ 同一条线程再发一条：哨兵必须出现 ═══════════ */
  const afterText = "挂载后取证：第二条消息";
  await page.getByTestId("copilotkit-v2-input").fill(afterText);
  await page.getByTestId("copilotkit-v2-send").click();
  await expect(messages).toContainText(`根据查询结果回答你："${afterText}"`, { timeout: 60_000 });
  await expect(
    messages,
    "issue #2020 核心验收：挂载 skill 的正文必须真的进入 v2 这轮 run 的模型输入"
    + "（deep-agent 替身只在收到的 system 消息里真的看到哨兵时才回显）",
  ).toContainText(skillEcho);
});

test("issue #2020：composer 敲 # 触发挂载候选，选中即挂载并清掉正文里的 #query", async ({ page }) => {
  await warmUpCopilotRuntimeRoute(page);
  await login(page);
  await warmUpThreadRoute(page);
  await page.goto("/chat/copilotkit-v2");

  /* 走「新建对话」拿一条真实线程（`[threadId]` 路由挂载面板从首帧就在）——
     与上一条测试的「发首条消息 resolve 线程」互为另一条入口路径。 */
  await page.getByTestId("chat-thread-create").click();
  await page.waitForURL(/\/chat\/copilotkit-v2\/(?!warmup-)[^/]+$/, { timeout: 60_000 });
  const threadId = /\/chat\/copilotkit-v2\/([^/?#]+)/.exec(page.url())?.[1];
  expect(threadId).toBeTruthy();
  await expect(page.getByTestId("chat-skill-mount-panel")).toBeVisible();

  /* `#` + 名字片段：候选面板以 mention 模式打开，并按片段过滤。
     `pressSequentially` 逐键真实敲入（onChange + onKeyUp 都会触发，与真实用户一致）。 */
  const input = page.getByTestId("copilotkit-v2-input");
  await input.click();
  await input.pressSequentially("#假设");
  await expect(page.getByTestId("chat-skill-mount-picker")).toBeVisible();
  await expect(page.getByTestId("chat-skill-mount-mention-hint")).toContainText("假设");

  const mountResponse = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && response.url().includes(`/threads/${threadId}/skill-mounts`)
  ));
  await page.getByTestId(`chat-skill-mount-option-${CHAT_READ_E2E.mountableSkillId}`).click();
  expect((await mountResponse).ok(), "mention 触发的挂载 POST 应成功").toBe(true);
  await expect(page.getByTestId(`chat-skill-mounted-${CHAT_READ_E2E.mountableSkillId}`)).toBeVisible();

  /* 挂载真的发生后，`#假设` 字面量从输入框正文里删掉——留着会让用户以为还要
     手动发一条以 `#` 开头的消息（同旧 composer `mentionResolvedNonce` 语义）。 */
  await expect(input).toHaveValue("");

  /* 落库复核：刷新丢掉全部前端状态，挂载 chip 仍在（不是 useState 里的一帧）。 */
  await page.reload();
  await expect(page.getByTestId(`chat-skill-mounted-${CHAT_READ_E2E.mountableSkillId}`)).toBeVisible({ timeout: 30_000 });
});
