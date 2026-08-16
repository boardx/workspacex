/**
 * 「后台 agent/skill 从 GitHub 导入 → 文件浏览+编辑 → 后台测试 → chat 里用 `#` 调用」
 * 这条完整用户旅程的**验收用真栈 e2e**。
 *
 * ## 为什么是这个形状
 *
 * 这不是一份"哪些代码存在"的静态盘点——那类结论会被 `static-trace-vs-live-fact.md`
 * 点名的陷阱骗（controller 存在 ≠ 有调用方；组件存在 ≠ 挂在真实路由上）。
 * 每一条 `test()` 都走真实浏览器 → 真实 Next 代理 → 真实 NestJS → 真实 Postgres，
 * 导入用的是**真实公网 GitHub**（`https://github.com/anthropics/skills/...`），
 * 不是 loopback 替身——因为要验收的正是"服务端真的会替我们连 GitHub"这件事本身。
 *
 * ## 红是证据，不是失败
 *
 * 与 `core-loop.spec.ts` 同一条纪律：尚未实现的能力用 `test.fail()` 显式标红
 * （而不是 `test.skip()`）——一条 skip 的用例在报表里看不出"从来没通过"和
 * "还没写"的区别；`test.fail()` 红着才是"这里有个洞"的诚实信号，且一旦真的实现了、
 * 断言意外转绿，Playwright 会把它报成"unexpected pass"，逼着这里同步把 `test.fail()`
 * 摘掉——这本身就是防止验收线漂移的机械门控。
 *
 * ## 覆盖的四个 UC 与本文件里的编号对应
 *
 * ① GitHub 链接导入 skill / agent
 * ② 后台文件浏览器 + code editor
 * ③ 后台测试（试跑）
 * ④ chat 里 `#` 调用
 */
import { expect, test, type Page } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

const GITHUB_SKILL_DIR_URL = "https://github.com/anthropics/skills/tree/main/skills/skill-creator";
/**
 * agent 导入是**单文件**（见 `import-agent-from-url.ts` 头注：agent 唯一的"内容"
 * 是 `agents.instructions`，一段文本，不是文件树）——用 raw.githubusercontent.com
 * 而不是 `github.com/.../blob/...`：后者是 GitHub 的网页查看器，返回一整页 HTML，
 * 不是文件的原始字节；这正是 #595 的 G1 在 `tree/` 目录 URL 上踩过的同一个坑，
 * 单文件导入这里从一开始就不允许它发生。
 */
const GITHUB_AGENT_URL = "https://raw.githubusercontent.com/anthropics/skills/main/template/SKILL.md";

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.adminEmail);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.adminPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

/**
 * `isSelfMountAllowed` 只认 `引导师`（facilitator）——`FULLSTACK_E2E.userId` 是
 * `addProjectMember(..., "facilitator", ...)` 那个账号，`adminEmail` 是组织管理员、
 * **不是**这个项目的 facilitator，用它登录会撞 `MEMBER_CANNOT_SELF_MOUNT`。
 */
async function loginAsFacilitator(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.email);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

/**
 * ① 走 `/skill` 的正式目录页，用真实 GitHub 目录 URL 触发一次导入，
 * 断言这不是"点了没报错"，而是**这份内容真的来自 GitHub**——
 * 断言文件数与仓库里这个目录实际的文件数一致（导入时手工核对过：
 * `skill-creator` 目录在写这份用例时有 `SKILL.md` + `scripts/` 等，
 * 这里只锚一个下限——"至少导入了根 SKILL.md 之外的内容"——不锚死绝对数字，
 * 免得上游仓库改动让这条用例无端变红）。
 */
test("① skill 从 GitHub 目录 URL 导入：落进目录，内容确实来自 GitHub", async ({ page }) => {
  test.slow();
  await loginAsAdmin(page);
  await page.goto("/skill?screen=library");
  await expect(page.getByTestId("skill-catalog-live")).toBeVisible();

  // 入口嵌两层：先开「新建 Skill」弹层，切到「从 GitHub 导入」tab，
  // 里面的 `SkillUrlImportPanel` 自己还有一个折叠头（`skill-url-import-open`）。
  await page.getByTestId("skill-create-open").click();
  await expect(page.getByTestId("skill-create-launcher")).toBeVisible();
  await page.getByTestId("skill-create-mode-import").click();
  await page.getByTestId("skill-url-import-open").click();
  await page.getByTestId("skill-url-import-url").fill(GITHUB_SKILL_DIR_URL);
  const importedName = FULLSTACK_E2E.skillName + "_GITHUB_IMPORT";
  await page.getByTestId("skill-url-import-name").fill(importedName);

  const importResponse = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && response.url().includes("/admin/skills/url-imports")
  ));
  await page.getByTestId("skill-url-import-confirm").click();
  const response = await importResponse;
  expect(response.status(), "真实 GitHub 目录导入应当 2xx——若这里超时/4xx/5xx，先看是不是被 SSRF 门或 admin 门拦了").toBeLessThan(300);

  const resultText = await page.getByTestId("skill-url-import-result").innerText();
  const fileCountMatch = /已导入 (\d+) 个文件/.exec(resultText);
  expect(fileCountMatch, `结果文案应报告文件数：${resultText}`).not.toBeNull();
  expect(
    Number(fileCountMatch![1]),
    "GitHub 上 skill-creator 目录实测有 18 个文件——大于 1 就证明这不是单文件导入分支接的糊涂账",
  ).toBeGreaterThan(1);

  // 目录列表必须真的刷新出这一行——不是前端乐观插入。
  await page.reload();
  await expect(page.getByTestId("skill-catalog-live")).toBeVisible();
  await expect(page.getByText(importedName).first()).toBeVisible({ timeout: 15_000 });
});

/**
 * ② 后台文件浏览器 + code editor：打开刚才那个 skill 的"查看/编辑源码"，
 * 断言左侧文件树里出现了不止一个真实文件（不是 mock 态的占位单文件），
 * 且切换到其中一个非根文件时，右侧显示的是**真实抓取的内容**，不是
 * "仅根文件展示完整内容，其余文件在此以占位呈现"那句原型态提示
 * （`ag-screens.tsx` 的 mock 分支原文,见该文件 632 行附近）。
 */
test("② 文件浏览器 + code editor：能看到 GitHub 导入的完整目录，非根文件不是占位符", async ({ page }) => {
  test.slow();
  await loginAsAdmin(page);
  await page.goto("/skill?screen=catalog");
  await expect(page.getByTestId("admin-skill-catalog")).toBeVisible();

  const importedName = FULLSTACK_E2E.skillName + "_GITHUB_IMPORT";
  await expect(page.getByText(importedName).first()).toBeVisible({ timeout: 15_000 });
  const row = page.locator('[data-testid^="admin-skill-row-"]').filter({ hasText: importedName });
  await row.getByRole("button", { name: "编辑" }).click();

  const toggle = row.locator('[data-testid$="-content-toggle"]');
  await toggle.click();
  const editor = row.locator('[data-testid$="-content-editor"]');
  await expect(editor).toBeVisible();

  // 真实数据态徽标——不是"预览态 mock"。
  await expect(editor.locator('[data-testid$="-data-source"]')).toContainText("真实数据");

  const fileTree = editor.locator('[data-testid$="-tree"]');
  const fileEntries = fileTree.locator('[data-testid$="-file"]');
  const fileCount = await fileEntries.count();
  expect(fileCount, "GitHub 导入的目录应该有不止一个文件（SKILL.md 之外还有别的）").toBeGreaterThan(1);

  // 点开一个非 SKILL.md 的文件，断言不是占位符文案。
  let openedNonRoot = false;
  for (let i = 0; i < fileCount; i += 1) {
    const entry = fileEntries.nth(i);
    const text = await entry.innerText();
    if (text.includes("SKILL.md")) continue;
    await entry.click();
    openedNonRoot = true;
    break;
  }
  expect(openedNonRoot, "本次导入的目录里应该存在至少一个非 SKILL.md 的文件可点").toBe(true);
  const code = editor.locator('[data-testid$="-code"]');
  await expect(code).not.toContainText("原型态：仅根文件展示完整内容");
});

/**
 * ①②③ 的 agent 版——#1415 补上的那条链：GitHub 单文件导入 → 编辑指令 →
 * 发布 → 试跑，全部在同一块 `AgentUrlImportPanel` 里完成（agent 这一阶段没有
 * `listAgents` 读路径，导入完不把用户扔回一个找不到刚建好那个 agent 的列表页，
 * 见该组件头注）。
 *
 * 与 skill 侧的关键差异，写在这里而不是散落在断言里：
 *   · agent 导入是**单文件**（`raw.githubusercontent.com` 直取字节），不是目录——
 *     `agents.instructions` 是一段文本，没有文件树的概念。
 *   · 编辑发生在**发布之前**（`agent_versions` 是不可变快照，发布之后再改
 *     `agents.instructions` 不会反映到已发布版本），所以本用例的顺序是
 *     导入 → 编辑 → 发布 → 试跑，不是 skill 那种"导入 → 试跑 → 也能编辑"。
 *   · 试跑读的是**已发布**版本（`PublishedAgentReader`），发布前点试跑没有意义，
 *     面板本身也按钮置灰到发布成功为止——这里断言的是"发布前确实不可点"。
 */
test("① agent 也能从 GitHub URL 导入，导入完可编辑指令、发布、试跑", async ({ page }) => {
  test.slow();
  await loginAsAdmin(page);
  await page.goto("/admin/agent");
  await expect(page.getByTestId("admin-agent-catalog")).toBeVisible();
  await expect(page.getByTestId("agent-url-import-open")).toBeVisible();
  await page.getByTestId("agent-url-import-open").click();
  await page.getByTestId("agent-url-import-url").fill(GITHUB_AGENT_URL);
  const importedName = FULLSTACK_E2E.agentName + "_GITHUB_IMPORT";
  await page.getByTestId("agent-url-import-name").fill(importedName);

  const importResponse = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && response.url().includes("/admin/agents/url-imports")
  ));
  await page.getByTestId("agent-url-import-confirm").click();
  const response = await importResponse;
  expect(response.status(), "真实 GitHub 单文件导入应当 2xx——若这里超时/4xx/5xx，先看是不是被 SSRF 门或 admin 门拦了").toBeLessThan(300);
  await expect(page.getByTestId("agent-url-import-result")).toContainText("已建成草稿 agent");

  // 导入响应回显了取回的指令全文（没有单独的 GET /agents/:id 读接口）——
  // 文本框不该是空的，这才证明"导入了"和"能看到导入了什么"是同一件事。
  const postPanel = page.getByTestId("agent-url-import-post-panel");
  await expect(postPanel).toBeVisible();
  const instructions = postPanel.getByTestId("agent-url-import-instructions");
  await expect(instructions).not.toHaveValue("");

  // ① 编辑：追加一句话，保存，断言真的调用了 PATCH /agents/:agentId。
  await instructions.fill(`${await instructions.inputValue()}\n\n(经后台编辑追加)`);
  const saveResponse = page.waitForResponse((response) => (
    response.request().method() === "PATCH" && response.url().includes("/agents/")
  ));
  await postPanel.getByTestId("agent-url-import-save-instructions").click();
  expect((await saveResponse).ok(), "编辑指令应当真的发出一次 PATCH /agents/:agentId 且服务端接受").toBe(true);

  // 发布前试跑按钮应当不可点——试跑读的是已发布版本，发布前点没有意义。
  await expect(postPanel.getByTestId("agent-url-import-trialrun-run")).toBeDisabled();

  // ② 发布：真调用既有的 selfPublishToollessAgent。
  const publishResponse = page.waitForResponse((response) => (
    response.request().method() === "POST" && response.url().includes("/self-publish")
  ));
  await postPanel.getByTestId("agent-url-import-publish").click();
  expect((await publishResponse).ok(), "发布应当真的调用 selfPublishToollessAgent 且服务端接受").toBe(true);
  await expect(postPanel.getByTestId("agent-url-import-publish")).toContainText("已发布");

  // ③ 试跑：发布后按钮可点，真调用 POST /agents/:agentId/trial-run，产出真实输出。
  await postPanel.getByTestId("agent-url-import-trialrun-scenario").fill("请给我一句自我介绍");
  const trialRunResponse = page.waitForResponse((response) => (
    response.request().method() === "POST" && response.url().includes("/trial-run")
  ));
  await postPanel.getByTestId("agent-url-import-trialrun-run").click();
  const trialRun = await trialRunResponse;
  expect(trialRun.ok(), "试跑请求应当被服务端接受（若这里失败，先看 KERNEL_DEEP_AGENT_BASE_URL 有没有配）").toBe(true);
  await expect(postPanel.getByTestId("agent-url-import-trialrun-result")).toBeVisible({ timeout: 15_000 });
  await expect(postPanel.getByTestId("agent-url-import-trialrun-error")).toHaveCount(0);
});

/**
 * ③ 后台测试（试跑）。`AgSkillEditor` 的「试跑」按钮真调
 * `POST /skill-versions/:versionId/trial-run`（`skill-trial-run.controller.ts`），
 * `versionId` 由 `GetAssetDirectory` 新增的 `currentVersionId` 字段带出——
 * `AgSkillEditor` 原本只知道 `skills.id`，不知道当前发布版本的 `skill_versions.id`。
 *
 * ⚠ 断言的是"真的发出了一次会被服务端接受的请求"，不断言模型回复的具体文字——
 * 上游是确定性替身没错，但这条测试要证的是"接线接对了"，不是"这个模型说了什么"。
 */
test("③ 在后台对刚导入的 skill 发起一次真实试跑，产出真实输出", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/skill?screen=catalog");
  const importedName = FULLSTACK_E2E.skillName + "_GITHUB_IMPORT";
  await expect(page.getByText(importedName).first()).toBeVisible({ timeout: 15_000 });
  const row = page.locator('[data-testid^="admin-skill-row-"]').filter({ hasText: importedName });
  await row.getByRole("button", { name: "编辑" }).click();
  await row.locator('[data-testid$="-content-toggle"]').click();
  const editor = row.locator('[data-testid$="-content-editor"]');

  const tryRunButton = editor.locator('[data-testid$="-tryrun"]');
  await expect(tryRunButton).toBeEnabled();
  await tryRunButton.click();

  const panel = editor.locator('[data-testid$="-trialrun-panel"]');
  await expect(panel).toBeVisible();
  await panel.locator('[data-testid$="-trialrun-input"]').fill("这是一条试跑样例输入");

  const trialRunResponse = page.waitForResponse((response) => (
    response.request().method() === "POST" && response.url().includes("/trial-run")
  ));
  await panel.locator('[data-testid$="-trialrun-run"]').click();
  const response = await trialRunResponse;
  expect(response.ok(), "试跑请求应当被服务端接受（若这里 503，先看 KERNEL_SKILL_TRIALRUN_MODEL_ID 有没有配）").toBe(true);

  await expect(panel.locator('[data-testid$="-trialrun-output"]')).toBeVisible({ timeout: 15_000 });
  await expect(panel.locator('[data-testid$="-trialrun-error"]')).toHaveCount(0);
});

/**
 * ④ chat 里用 `#` 触发/调用 skill。实现复用 `ChatSkillMountPanel` 已有的真实
 * 挂载状态（同一个 `version`/`mount()`，见该文件头注），composer 只做检测——
 * 敲 `#` 之后打的字就是过滤词，面板按词过滤同一批「已启用」skill，点开即真实
 * `POST .../skill-mounts`，成功后 `#query` 从输入框正文里被删掉。
 */
test("④ 在 chat 输入框敲 `#` 弹出 skill 候选并可选中挂载", async ({ page }) => {
  await loginAsFacilitator(page);
  // `thread`（不是 `threadId`）是 `app/chat/page.tsx` 认的查询参数；
  // `recordingThreadId` 是种子里这个项目下已存在的一条真实线程（#466）。
  await page.goto(`/chat?projectId=${FULLSTACK_E2E.projectId}&thread=${FULLSTACK_E2E.recordingThreadId}`);
  const input = page.getByRole("textbox", { name: "消息内容" });
  await expect(input).toBeVisible();

  await input.click();
  await input.pressSequentially(`#${FULLSTACK_E2E.mountableSkillName.slice(0, 2)}`);
  const picker = page.getByTestId("chat-skill-mount-picker");
  await expect(picker).toBeVisible({ timeout: 5_000 });
  await expect(picker.getByTestId("chat-skill-mount-mention-hint")).toBeVisible();

  const mountResponse = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && response.url().includes("/skill-mounts")
  ));
  await picker.getByTestId(`chat-skill-mount-option-${FULLSTACK_E2E.mountableSkillId}`).click();
  expect((await mountResponse).ok(), "点候选应当真的发出一次 POST .../skill-mounts，且服务端接受").toBe(true);

  // 面板真挂载成功后关闭；composer 正文里的 `#query` 应该被清掉，不留字面量。
  await expect(picker).toHaveCount(0);
  await expect(input).toHaveValue("");
  await expect(page.getByTestId(`chat-skill-mounted-${FULLSTACK_E2E.mountableSkillId}`)).toBeVisible();
});
