import { test, expect, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";

/**
 * 2026-09-02 人类裁决：**skills 不由用户在 composer 里挑选**——agent 直接加载全部已启用
 * skill；选了具体 agent 时，该 agent 自己的 skill 编排覆盖全局列表。
 *
 * v2 composer 的挂载入口（「/技能」项、`/` 快捷挂载、已挂载 chip）已随之整体移除
 * （`copilotkit-v2-panel-body.tsx`）。本 spec 此前（issue #2020/#2046）证明的是
 * "用户挂载 → 正文进模型输入"；现在改成证明新的产品规则：**用户什么都不做**，
 * 可挂载 skill 的正文也要进下一轮 run 的模型输入。
 *
 * ## 取证信号（与此前逐字相同）
 *
 * 确定性替身 `loopback-deep-agent-provider.ts` 只在自己真的在 `role:"system"` 消息里
 * 看到哨兵 `MOUNTPROOF-9317`（只存在于可挂载 skill 的 SKILL.md 正文里，全仓别处
 * 零命中）时才把 `[skill:]MOUNTPROOF-9317` 回显进回复。哨兵出现 ⇔ skill 正文真的
 * 进了 system prompt。
 *
 * ## ⚠ 缺口如实（本条现在必然红）
 *
 * 服务端目前仍按线程的 `thread_skill_mounts` 决定哪些 skill 进 system prompt
 * （`agui-bridge.ts` → `acceptHumanMessage` → `activeMountedSkillVersionIds` →
 * `readPinnedSkills` → `buildSystemPrompt`）；"agent 默认加载全部已启用 skill +
 * 具体 agent 的编排覆盖全局"尚未落地——那是 deep-agent-service / 契约层的活，
 * 不在 composer UI 这条改动里。在它落地之前本条必然红，这正是它存在的意义
 * （`chat-task-workbench-fixture.ts` 头注：让缺口以失败的形式存在，不许 skip）。
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

const skillEcho = `${CHAT_READ_E2E.mountedSkillEchoPrefix}${CHAT_READ_E2E.mountedSkillSentinel}`;

test("2026-09-02 裁决：不经用户挑选，agent 自行加载的 skill 正文进入下一轮 run 的模型输入", async ({ page }) => {
  await warmUpCopilotRuntimeRoute(page);
  await login(page);
  await page.goto("/chat");
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible({ timeout: 120_000 });

  /* ═══════════ ① composer 里不再有任何 skill 挑选入口 ═══════════ */
  await page.getByTestId("chat-task-workbench-composer-menu").click();
  await expect(page.getByTestId("chat-task-workbench-composer-menu-panel")).toBeVisible();
  await expect(
    page.getByTestId("chat-skill-mount"),
    "skills 由 agent 直接加载，composer「+」菜单里不该再有挂载入口",
  ).toHaveCount(0);
  await expect(page.getByTestId("chat-task-workbench-composer-mention-skill")).toHaveCount(0);
  await page.keyboard.press("Escape");

  /* ═══════════ ② 什么都不挂，直接发一条：哨兵必须出现 ═══════════ */
  const messages = page.getByTestId("copilotkit-v2-messages");
  const text = "不挑 skill 直接发：agent 应自行加载已启用的 skill";
  await page.getByTestId("copilotkit-v2-input").fill(text);
  await page.getByTestId("copilotkit-v2-send").click();
  // deep-agent 替身默认剧本逐字回显用户原文——回复真的来自上游，不是前端合成。
  await expect(messages).toContainText(`根据查询结果回答你："${text}"`, { timeout: 60_000 });
  await expect(
    messages,
    [
      "【差距】用户未挑选任何 skill 时，agent 没有自行加载已启用 skill 的正文进模型输入。",
      "2026-09-02 裁决：agent 直接加载全部已启用 skill；具体 agent 的编排覆盖全局列表。",
      "待实现：deep-agent-service 侧默认加载 + agent 级覆盖（当前仍只读 thread_skill_mounts）。",
    ].join("\n"),
  ).toContainText(skillEcho);
});

/**
 * 2026-09-02 裁决第二条：输入框里的 `/` 命令**保留**，但编辑器下方不显示任何技能入口。
 * 这条证明 `/` 这条路仍然端到端通：路径斜杠不误触 → `/片段` 弹候选并过滤 → 选中即
 * 真实 POST 落库 → `/query` 从正文删掉 → 下一轮回复带哨兵（挂载正文真的进了模型输入）。
 * 不再断言挂载 chip（按裁决不显示），改用哨兵这条更强的信号。
 */
test("2026-09-02 裁决：composer 敲 / 仍能挑 skill（路径斜杠不误触），但编辑器下方不显示任何技能入口", async ({ page }) => {
  await warmUpCopilotRuntimeRoute(page);
  await login(page);
  await page.goto("/chat");
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible({ timeout: 120_000 });

  /* 走「新建对话」拿一条真实线程（`[threadId]` 路由上 headless 锚点从首帧就在）。 */
  await page.getByTestId("chat-thread-create").click();
  await page.waitForURL(/\/chat\/(?!warmup-)[^/]+$/, { timeout: 60_000 });
  const threadId = /\/chat\/([^/?#]+)/.exec(page.url())?.[1];
  expect(threadId).toBeTruthy();
  const anchor = page.getByTestId("chat-skill-mount-panel");
  await expect(anchor).toBeAttached();
  // 编辑器下方零尺寸：没有触发按钮、没有 chip、没有占位文案。
  await expect(page.getByTestId("chat-skill-mount")).toHaveCount(0);
  await expect(anchor).toBeEmpty();

  /* issue #2046（CK-P2）反例先行：路径里的斜杠（前一字符非空白）不触发 mention。 */
  const input = page.getByTestId("copilotkit-v2-input");
  await input.click();
  await input.pressSequentially("看看 src/components 目录");
  await expect(page.getByTestId("chat-skill-mount-picker")).toHaveCount(0);
  await input.fill("");

  /* `/` + 名字片段：候选浮层以 mention 模式打开，并按片段过滤。 */
  await input.pressSequentially("/假设");
  await expect(page.getByTestId("chat-skill-mount-picker")).toBeVisible();
  await expect(page.getByTestId("chat-skill-mount-mention-hint")).toContainText("/ 假设");

  const mountResponse = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && response.url().includes(`/threads/${threadId}/skill-mounts`)
  ));
  await page.getByTestId(`chat-skill-mount-option-${CHAT_READ_E2E.mountableSkillId}`).click();
  expect((await mountResponse).ok(), "mention 触发的挂载 POST 应成功").toBe(true);

  /* 挂载真的发生后，`/假设` 字面量从输入框正文里删掉；候选收起；下方仍然什么都不显示。 */
  await expect(input).toHaveValue("");
  await expect(page.getByTestId("chat-skill-mount-picker")).toHaveCount(0);
  await expect(anchor).toBeEmpty();

  /* 落库复核走哨兵：刷新丢掉全部前端状态，再发一条，挂载 skill 的正文进模型输入。 */
  await page.reload();
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible({ timeout: 60_000 });
  const messages = page.getByTestId("copilotkit-v2-messages");
  const afterText = "/ 挂载后取证：这条应带哨兵";
  await page.getByTestId("copilotkit-v2-input").fill(afterText);
  await page.getByTestId("copilotkit-v2-send").click();
  await expect(messages).toContainText(`根据查询结果回答你："${afterText}"`, { timeout: 60_000 });
  await expect(messages, "经 / 挂载的 skill 正文必须真的进入下一轮 run 的模型输入").toContainText(skillEcho);
});
