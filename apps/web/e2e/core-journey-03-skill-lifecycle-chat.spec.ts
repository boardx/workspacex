/**
 * 核心旅程 ③：skill 从 GitHub 导入（=上线）→ 挂进 chat → agent 真的执行它、产出唯一一条回复。
 *
 * ## 真实实测推翻了本文件最初的设计假设——如实记录下来，而不是悄悄改掉
 *
 * 最初设想的链路是"导入 → 落草稿 → 走双人复核门禁 → 已启用"，仿照
 * `skill-review-gate.spec.ts` 的双人复核。真实浏览器实测（管理员登录、走
 * `/skill?screen=library` → 「从 GitHub 导入」，与 `skill-agent-import-usecase-
 * audit.spec.ts①` 同一条真实路径）发现：管理员导入出来的 skill 卡片直接带着
 * 「自建 / 已启用 / 组织可见」三个徽标——**没有草稿态，不经过复核门禁**。
 *
 * 对照 `apps/api/scripts/seed-fullstack-smoke.ts` 里 `reviewedSkillName`/
 * `draftOnlySkillName` 那两行草稿的种子注释才想明白根因：F192（issue #598）冻结了
 * `/skill` 的「完全新建」面板（`POST /skills` 现在恒 410，见 `skill-create-smoke
 * .spec.ts`）之后，**全仓已经没有任何一条真实用户路径能创建出一个"团队私有、
 * 等待复核"的草稿 skill**——那两行种子是种子脚本直接写库造出来的，不是任何 UI
 * 操作的产物。`skill-review-gate.spec.ts` 验的复核门禁本身是真实、能走通的
 * （`POST /skill-versions/:id/review` 等端口都在），只是**它的输入（一个团队私有
 * 草稿）今天没有任何真实用户能自己造出来**——URL 导入这条唯一的创建路径，走的是
 * 管理员权限（`import-skill-from-url.ts` 判 `orgRole === "admin"`），而管理员自己
 * 导入的东西直接进入"已启用/组织可见"，不落草稿、不必复核。
 *
 * 这不是本文件要修的产品缺口（那是 CLR track 的事），但**如实反映**它，比硬凑一条
 * "导入的东西也能走复核"的假链路更诚实——本文件因此改证一条完全真实、可复现的链：
 * **导入即上线**（管理员导入 = 立即可用，这就是这条路径上"上线发布"的全部含义）→
 * 挂进 chat → agent **真的执行**它并产出唯一一条回复。
 *
 * 与既有两份 spec 的分工（不重复，是互补）：
 *   · `skill-agent-import-usecase-audit.spec.ts` 证明"能从 GitHub 导入 + 后台编辑/
 *     试跑 + chat 里 `#` 挂载"——但它④步挂进 chat 的是**种子里另一个已启用的 skill**
 *     （`mountableSkillId`），从未验证"刚导入的那个"能被真的挂载、更没有发消息验证
 *     它是否真的被 agent 执行。
 *   · 本文件补的正是这两段：刚导入的这一个（不是种子那个）→ 真的挂进 chat → agent
 *     真的执行、产出**恰好一条**回复（`core-loop.spec.ts` 步骤 8b 同一套 exactly-once
 *     纪律），此前没有任何一份 spec 把"导入"与"真实执行"接在同一条 skill 上过。
 *
 * ⚠ 与 `skill-agent-import-usecase-audit.spec.ts` 同理，注册进 `seeded-github-import`
 *   project（依赖 `seeded` 之后跑）——本文件也会往目录里真实落一行导入的 skill，
 *   混进 `seeded` 会打红 `skill-create-smoke.spec.ts` 的"管理员看到真实空态"反空转
 *   断言，理由与那个文件头注逐字相同，不重复贴一遍。
 */
import { expect, test, type Page } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";
import { SESSION_TOKEN_STORAGE_KEY } from "../lib/api-client";

test.setTimeout(240_000);

// 与 `skill-agent-import-usecase-audit.spec.ts①` 同一个真实公网目录——目录导入才会
// 走完整的多文件抓取路径（真实实测：单文件 raw URL 那条是 agent 导入专用的形状，
// 拿它导入 skill 会走出完全不同的分支，见文件头注的推翻记录）。
const GITHUB_SKILL_DIR_URL = "https://github.com/anthropics/skills/tree/main/skills/skill-creator";

/**
 * 切账号前必须先清掉上一个人的会话——`/login` 在已认证会话下会直接把人弹回
 * `/projects`（不渲染登录表单），`login-email` 因此永远等不到。同
 * core-loop.spec.ts 步骤 5 的既有做法（本文件从管理员切到引导师时踩过这个坑，
 * 表现为 `login-email` 卡到用例超时——页面其实已经在 `/projects`，只是还是
 * 上一个人的会话）。
 */
async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.context().clearCookies();
  await page.evaluate(() => window.localStorage.clear()).catch(() => {});
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

test("旅程③：管理员从 GitHub 导入 skill（=立即上线）→ 挂进 chat 线程 → agent 真的执行它并产出唯一一条回复", async ({ page }) => {
  test.slow();
  const unique = Date.now();
  const importedName = `JOURNEY03_SKILL_${unique}`;

  /* ── ① 导入：只有组织管理员能导入 ──────────────────────────────────────
        实测：`POST /skills/url-imports` 服务端判 `membership.orgRole !== "admin"`
        即拒（`import-skill-from-url.ts`，与 starter-pack 导入同一条门槛）。 */
  await loginAs(page, FULLSTACK_E2E.adminEmail, FULLSTACK_E2E.adminPassword);
  await page.goto("/skill?screen=library");
  await expect(page.getByTestId("skill-catalog-live")).toBeVisible();

  await page.getByTestId("skill-create-open").click();
  await expect(page.getByTestId("skill-create-launcher")).toBeVisible();
  await page.getByTestId("skill-create-mode-import").click();
  const urlImportOpener = page.getByTestId("skill-url-import-open");
  if ((await urlImportOpener.getAttribute("aria-expanded")) !== "true") {
    await urlImportOpener.click();
  }
  await page.getByTestId("skill-url-import-url").fill(GITHUB_SKILL_DIR_URL);
  await page.getByTestId("skill-url-import-name").fill(importedName);

  const importResponse = page.waitForResponse((response) => (
    response.request().method() === "POST" && response.url().includes("/skills/url-imports")
  ));
  await page.getByTestId("skill-url-import-confirm").click();
  const imported = await importResponse;
  expect(imported.status(), "真实 GitHub 目录导入应当 2xx").toBeLessThan(300);

  await page.reload();
  await expect(page.getByTestId("skill-catalog-live")).toBeVisible();
  await expect(page.getByText(importedName).first()).toBeVisible({ timeout: 15_000 });
  // 真实行为：管理员导入 = 立即「已启用」，不落草稿——这正是本文件头注推翻原设计
  // 假设之后钉住的那件事。断言它而不是断言"草稿"，是因为**这才是真的会发生的**。
  const row = page.getByTestId("skill-catalog-list").locator("div")
    .filter({ hasText: importedName }).first();
  await expect(row).toContainText("已启用");

  /* ── ② 拿到真实 skillId ── */
  const token = await page.evaluate((key) => window.localStorage.getItem(key), SESSION_TOKEN_STORAGE_KEY);
  expect(token).toBeTruthy();
  const catalog = await page.request.get(
    `/__fullstack_api/skills?orgId=${encodeURIComponent(FULLSTACK_E2E.orgId)}&entry=library`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(catalog.status()).toBe(200);
  const listed = (await catalog.json()) as { items: { skillId: string; name: string; status: string }[] };
  const skill = listed.items.find((i) => i.name === importedName);
  expect(skill, `目录里应能找到刚导入的 ${importedName}`).toBeDefined();
  expect(skill!.status).toBe("已启用");

  /* ── ③ 挂进一条真实 chat 线程，配一个可运行的 agent，发消息，agent 真的执行 ──
        用引导师账号（这个项目/线程编制的真实操作者，同 core-loop.spec.ts 步骤 8a/8b
        用的账号），不是继续用管理员——管理员不是这个项目的成员。 */
  await loginAs(page, FULLSTACK_E2E.email, FULLSTACK_E2E.password);
  await page.goto(`/chat?projectId=${FULLSTACK_E2E.projectId}`);
  await page.getByTestId("chat-thread-create").click();
  const title = `旅程③ ${unique}`;
  await page.getByTestId("chat-thread-title-input").fill(title);
  await page.getByTestId("chat-thread-title-submit").click();
  await expect(page.getByTestId("chat-read-thread-list").getByText(title)).toBeVisible();

  await expect(page.getByTestId("chat-skill-mount-empty")).toBeVisible();
  await expect(page.getByTestId("chat-skill-mount")).toBeEnabled();
  await page.getByTestId("chat-skill-mount").click();
  const mountResponse = page.waitForResponse(
    (r) => r.request().method() === "POST" && /\/threads\/[^/]+\/skill-mounts(\?|$)/.test(r.url()),
  );
  await page.getByTestId(`chat-skill-mount-option-${skill!.skillId}`).click();
  expect((await mountResponse).status()).toBe(201);
  await expect(page.getByTestId(`chat-skill-mounted-${skill!.skillId}`)).toBeVisible();

  // 把可运行的 agent 挂进编制（同 core-loop.spec.ts 步骤 8b 同一条路径）。
  await page.getByTestId("chat-roster-edit").click();
  await page.getByTestId("chat-roster-add-input").selectOption(FULLSTACK_E2E.agentId);
  await page.getByTestId("chat-roster-add-submit").click();
  await expect(page.getByTestId(`chat-roster-agent-${FULLSTACK_E2E.agentId}`)).toBeVisible();

  const marker = `JOURNEY03_${unique}`;
  await page.getByTestId("chat-agent-select").click();
  await page.getByTestId(`chat-agent-select-option-${FULLSTACK_E2E.agentId}`).click();
  await page.getByTestId("chat-message-input").fill(marker);
  await expect(page.getByTestId("chat-message-submit")).toBeEnabled();
  await page.getByTestId("chat-message-submit").click();

  // run 真的推进到终态，且**恰好一条**回复——同 core-loop.spec.ts 步骤 8b 的纪律：
  // 数最终条数，不数成功次数；一次 run 必须只留下一条回复，不多不少。
  const status = page.getByTestId("chat-live-agent-run-status");
  await expect(status).toHaveAttribute("data-run-status", "succeeded", { timeout: 120_000 });

  await page.reload();
  await page.getByTestId("chat-read-thread-list").getByText(title).click();
  const messageList = page.getByTestId("chat-message-list");
  await expect(messageList).toContainText(marker);
  // 真实实测：挂了 skill 之后，这条 run 走的不是 core-loop.spec.ts 8b 那条纯 echo
  // 的 loopback 路径，而是真的经由 deep-agent + skill 沙箱执行。对照
  // `execute-run.ts`（挂了 skill 且沙箱/对象存储都注入时，system prompt 会拼上
  // `RUN_SCRIPT_PROTOCOL_PROMPT`）与 `loopback-model-provider.ts`
  // 的 `isTrialRunRequest`/`trialRunScriptReply`（命中该协议就确定性地回一段写
  // `deck.pptx` 的脚本，不掺随机）——这条链路对"挂了 skill 的普通 chat 消息"同样
  // 成立，不是只在试跑页才触发。`run-skill-script.ts` 的 `renderSuccess` 在真的
  // 产出文件时，会把"已在沙箱中执行上面的脚本，生成以下文件（见本条消息的附件）："
  // 与文件名逐字拼进回复正文——断言这段文字与文件名，而不是只数消息行数，才能把
  // "真的执行了 skill"与"agent 只是简单回显了一句"区分开：后者不会产出这段文字。
  await expect(messageList).toContainText("已在沙箱中执行上面的脚本，生成以下文件");
  await expect(messageList).toContainText("deck.pptx");
  // exactly-once 的纪律不丢：断言总行数恰好 2（human 一条 + agent 一条），同
  // core-loop.spec.ts 8b `runStat.threadMessages` 检查同一件事，只是从 API 读改成
  // 从 DOM 数——这里没有 runId 可直接查库，DOM 计数是本条唯一够得到的等价证据。
  await expect(messageList.getByTestId("chat-message-row")).toHaveCount(2);
});
