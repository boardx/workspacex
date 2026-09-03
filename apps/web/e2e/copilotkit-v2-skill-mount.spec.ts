import { test, expect, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";

/**
 * issue #2020（差距清单第 3 项）→ #2514（2026-09-02 服务端裁决）—— `/chat` 的 Skill
 * 加载与挂载入口。
 *
 * ## 规则（`message-roundtrip.ts` `resolveRunSkillVersionIds`）
 *
 *     run 的 skill = (agent 钉的非空 ? agent 钉的 : 组织全部已启用) ∪ 线程挂载
 *
 * 夹具 agent 没钉任何 skill ⇒ 走默认加载：**用户什么都不挂**，可挂载 skill 的正文也
 * 已经在第一轮 run 的模型输入里。composer 里的「技能」入口保留（#2517 裁决：技能功能
 * 不动、入口收进工具行），但它不再是 skill 生效的前提——挂一个默认已加载的 skill
 * 是幂等的（并集去重）。
 *
 * ## 取证信号
 *
 * 确定性替身 `loopback-deep-agent-provider.ts` 只在自己真的在 `role:"system"` 消息里
 * 看到哨兵 `MOUNTPROOF-9317`（只存在于可挂载 skill 的 SKILL.md 正文里，全仓别处零
 * 命中）时才把 `[skill:]MOUNTPROOF-9317` 回显进回复。哨兵出现 ⇔ skill 正文真的进了
 * system prompt。链上任何一环断掉——默认加载读口没接进 `acceptHumanMessage`、快照没
 * 带版本、`buildSystemPrompt` 没拼正文、`input.system` 没发给上游——哨兵都不会出现。
 *
 * ⚠ 此前的「挂载前无哨兵 → 挂载后有哨兵」对照在默认加载之下**不可能成立**，改成：
 *   ① 不挂即有（默认加载真的穿过整条链）；② 再挂同一个，回复照样有哨兵、挂载 POST
 *   照样成功（入口没坏），且挂载 chip 数从 0 变 1（挂载本身仍是真实落库的动作）。
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
 * `/chat/[threadId]` 动态路由的编译焐热。
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
  await page.goto("/chat/warmup-route-compile-only");
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

test("#2514：不挂任何 skill，已启用 skill 的正文已进第一轮 run 的模型输入；入口仍在，再挂同一个是幂等的", async ({ page }) => {
  await warmUpCopilotRuntimeRoute(page);
  await login(page);
  await warmUpThreadRoute(page);
  await page.goto("/chat");

  /* ═══════════ ① 新对话还没有线程：入口如实占位，不渲染假挂载面板 ═══════════ */
  await expect(page.getByTestId("chat-skill-mount")).toBeDisabled();
  await expect(page.getByTestId("chat-skill-mount")).toHaveAttribute("data-placeholder-reason", "no-thread");
  await expect(page.getByTestId("chat-skill-mount-panel")).toHaveCount(0);

  /* ═══════════ ② 什么都不挂，直接发：哨兵必须出现（默认加载） ═══════════ */
  const messages = page.getByTestId("copilotkit-v2-messages");
  const beforeText = "不挂 skill 直接发：agent 应默认加载已启用 skill";
  await page.getByTestId("copilotkit-v2-input").fill(beforeText);
  await page.getByTestId("copilotkit-v2-send").click();
  // deep-agent 替身默认剧本逐字回显用户原文——回复真的来自上游，不是前端合成。
  await expect(messages).toContainText(`根据查询结果回答你："${beforeText}"`, { timeout: 60_000 });
  await expect(
    messages,
    "#2514 核心验收：用户没挑任何 skill，已启用 skill 的正文也必须进入模型输入"
    + "（deep-agent 替身只在收到的 system 消息里真的看到哨兵时才回显）",
  ).toContainText(skillEcho);

  /* ═══════════ ③ 首条消息 resolve 出真实线程后，挂载入口可用且一个都没挂 ═══════════ */
  await page.waitForURL(/\/chat\/.+$/, { timeout: 30_000 });
  const threadId = /\/chat\/([^/?#]+)/.exec(page.url())?.[1];
  expect(threadId, "首条消息后地址栏应带上持久化线程 id").toBeTruthy();
  await expect(page.getByTestId("chat-skill-mount-panel")).toBeAttached();
  await expect(page.getByTestId("chat-skill-mount")).not.toHaveAttribute("data-placeholder-reason");
  // 前提：线程里一个都没挂——哨兵在 ② 出现靠的是默认加载，不是某次遗留挂载。
  await expect(page.getByTestId("chat-skill-mount")).toHaveAttribute("data-mounted-count", "0");

  /* ═══════════ ④ 挂上同一个 skill（真实 POST，落 thread_skill_mounts） ═══════════ */
  await mountSkillViaPanel(page, threadId!);
  await expect(page.getByTestId("chat-skill-mount")).toHaveAttribute("data-mounted-count", "1");

  /* ═══════════ ⑤ 再发一条：幂等——哨兵照样出现，run 没有因为重复而失败 ═══════════ */
  const afterText = "挂载后取证：第二条消息";
  await page.getByTestId("copilotkit-v2-input").fill(afterText);
  await page.getByTestId("copilotkit-v2-send").click();
  await expect(messages).toContainText(`根据查询结果回答你："${afterText}"`, { timeout: 60_000 });
  const echoes = await messages.locator(`text=${skillEcho}`).count();
  expect(echoes, "两轮回复都应带哨兵回显（默认加载一次、挂载后一次）").toBeGreaterThanOrEqual(2);
});

test("issue #2020/#2046：composer 敲 / 触发挂载候选（路径斜杠不误触），选中即挂载并清掉正文里的 /query", async ({ page }) => {
  await warmUpCopilotRuntimeRoute(page);
  await login(page);
  await warmUpThreadRoute(page);
  await page.goto("/chat");

  /* 走「新建对话」拿一条真实线程（`[threadId]` 路由挂载面板从首帧就在）——
     与上一条测试的「发首条消息 resolve 线程」互为另一条入口路径。 */
  await page.getByTestId("chat-thread-create").click();
  await page.waitForURL(/\/chat\/(?!warmup-)[^/]+$/, { timeout: 60_000 });
  const threadId = /\/chat\/([^/?#]+)/.exec(page.url())?.[1];
  expect(threadId).toBeTruthy();
  await expect(page.getByTestId("chat-skill-mount-panel")).toBeAttached();

  /* issue #2046（CK-P2）反例先行：路径里的斜杠（前一字符非空白）不触发 mention——
     没有这条，下面「/ 触发了」的断言证明不了误触规则真的存在。 */
  const input = page.getByTestId("copilotkit-v2-input");
  await input.click();
  await input.pressSequentially("看看 src/components 目录");
  await expect(page.getByTestId("chat-skill-mount-picker")).toHaveCount(0);
  await input.fill("");

  /* `/`（2026-08-25 人类裁决：v2 触发符从 `#` 改 `/`，对齐 Claude Code）+ 名字片段：
     候选面板以 mention 模式打开，并按片段过滤。
     `pressSequentially` 逐键真实敲入（onChange + onKeyUp 都会触发，与真实用户一致）。 */
  await input.pressSequentially("/假设");
  await expect(page.getByTestId("chat-skill-mount-picker")).toBeVisible();
  await expect(page.getByTestId("chat-skill-mount-mention-hint")).toContainText("/ 假设");

  const mountResponse = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && response.url().includes(`/threads/${threadId}/skill-mounts`)
  ));
  await page.getByTestId(`chat-skill-mount-option-${CHAT_READ_E2E.mountableSkillId}`).click();
  expect((await mountResponse).ok(), "mention 触发的挂载 POST 应成功").toBe(true);
  await expect(page.getByTestId(`chat-skill-mounted-${CHAT_READ_E2E.mountableSkillId}`)).toBeVisible();

  /* 挂载真的发生后，`/假设` 字面量从输入框正文里删掉——留着会让用户以为还要
     手动发一条以 `/` 开头的消息（同旧 composer `mentionResolvedNonce` 语义）。 */
  await expect(input).toHaveValue("");

  /* 落库复核：刷新丢掉全部前端状态，挂载 chip 仍在（不是 useState 里的一帧）。 */
  await page.reload();
  await expect(page.getByTestId(`chat-skill-mounted-${CHAT_READ_E2E.mountableSkillId}`)).toBeVisible({ timeout: 30_000 });
});
