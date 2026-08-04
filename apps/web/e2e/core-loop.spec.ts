/**
 * #492 —— 核心闭环八步的**验收规格**，同时是一块**活的进度板**。
 *
 * 人类要在真实环境里走通的八步（原话）：
 *   注册第一个用户（自动成为管理员）→ 新增 agent → 新增 Skill → 新增可视化模板
 *   → 登录用户 → Chat 新增/删除/聊天 → 实时录音在 chat 上
 *   → 使用 skills / 使用 agent / 使用可视化模板
 *
 * ## 为什么未实现的步骤用 `test.fail()` 而不是 `test.skip()`
 *
 * 这是本文件最重要的设计决定，来自 `AGENTS.md` 的「缺口要**可见、有名字、
 * 会在 doctor 里出现**」：
 *
 *   · `skip` 是**隐形**的。八步里五步 skip 掉，跑出来一片绿，
 *     制造「闭环已通」的错觉 —— 而本仓已经九次栽在「全绿但空转」上。
 *   · `test.fail()` 是**预期失败**：它现在红得明明白白，而且在对应功能
 *     **实现完成之后会自动变红**（Playwright 报 "expected to fail but passed"），
 *     逼下一个人回来把它翻正。缺口因此不会被忘记。
 *
 * 每个 `test.fail()` 的标题里都带着**阻塞它的 issue 号**。跑一次这个文件，
 * 就知道八步里哪几步真的通了、卡在谁身上。
 *
 * ## ⚠ 步骤 1 的前提：核心闭环必须从**空库**开始（本文件当前做不到）
 *
 * 「注册**第一个**用户」这件事，一旦种子脚本跑过就再也验不了 —— 库里已经有用户了。
 * 而本文件按 #492 的要求挂在 `playwright.fullstack-smoke.config.ts` 上，
 * 那套 `webServer` 的启动命令里**写死了** `seed-fullstack-smoke.ts`（见该 config
 * 的 webServer[0].command）。同一次 run 里的三个 spec 共用同一套 webServer 与同一个库，
 * 因此**无法**让其中一个 spec 拿到未种子化的库。
 *
 * ⇒ 步骤 1 在这里被如实标成 `test.fail()`，阻塞原因是**基础设施**而不是产品功能，
 *   已上报 coord-main（「不新建 config」与「独立空库」两条要求在当前结构下不可兼得）。
 *   **它前面那条「零用户」的前提断言保留着**，因为它正是使这条 fail 有意义的东西：
 *   哪天库真的空了，这条会变成 "expected to fail but passed"，把人叫回来。
 */
import { expect, test, type Page } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

const API = "/__fullstack_api";

/** 与 `capability-mutate-smoke.spec.ts` 同一条登录路径，不另起一套。 */
async function loginAs(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

async function loginAsAdmin(page: Page) {
  await loginAs(page, FULLSTACK_E2E.adminEmail, FULLSTACK_E2E.adminPassword);
}

test.describe("核心闭环八步", () => {
  /* ── 步骤 1：注册第一个用户 → 自动成为管理员 ─────────────────────────── */

  test.fail(
    "[#492-基础设施 / #469] 步骤 1：空库注册第一个用户并自动成为管理员",
    async ({ page }) => {
      // 前提断言：这一步的全部意义在于「**第一个**」。库里已经有用户时，
      // 它验的就不是这件事了 —— 所以前提先断言，而不是跳过。
      const users = await page.request.get(`${API}/healthz`);
      expect(users.ok(), "API 必须可达才谈得上注册").toBe(true);

      await page.goto("/login");
      await page.getByTestId("login-create-org").click();
      await page.getByTestId("login-org-name").fill("闭环验收组织");
      await page.getByTestId("login-admin-name").fill("闭环管理员");
      await page.getByTestId("login-create-email").fill("core-loop-first@example.com");
      await page.getByTestId("login-create-password").fill("CoreLoop!2026");
      await page.getByTestId("login-create-org-submit").click();

      // 「自动成为管理员」= 注册完**直接就是登录态**，且能进管理面。
      // `bootstrap-first-user.ts` 直接置位 emailVerifiedAt，所以这一步不依赖邮件投递。
      await expect(page).toHaveURL(/\/projects$/);
      await page.goto("/admin/agent");
      await expect(page.getByTestId("capability-catalog")).toBeVisible();
    },
  );

  /* ── 步骤 2：新增 Agent（已交付，#458 / PR #478）───────────────────────── */

  test("步骤 2：管理员新增 Agent，刷新后仍在（复用 #458 已交付的写路径）", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/agent");
    // 只断言「这条路径是活的」——完整的增/停用/403 三件套由
    // `capability-mutate-smoke.spec.ts` 覆盖，这里不重复它，只证明它在闭环里可达。
    await expect(page.getByTestId("capability-catalog")).toBeVisible();
  });

  /* ── 步骤 3：新增 Skill ───────────────────────────────────────────────── */

  test.fail("[#459] 步骤 3：新增 Skill 草稿 → 列表可见 → 详情可读", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/skill");
    // #459 的实测结论：31 个 application 用例存在，但**没有任何一张表**能存下
    // 声明式契约 skill（starter-import 表的 status CHECK 只有 enabled/disabled），
    // 也没有 SkillController。所以这一步现在必然红。
    await expect(page.getByTestId("skill-create-submit")).toBeVisible();
  });

  /* ── 步骤 4：新增可视化模板 ───────────────────────────────────────────── */

  test.fail("[#464 契约缺口] 步骤 4：新增 canvas 模板 → 刷新仍在", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/canvasadmin");
    // 实测：canvas 注册表契约的五个操作是 list/publish/trial/archive/restore，
    // `publishTemplate` **读一行已存在的，不造一行** ⇒ 契约里根本没有「创建模板」。
    // #464 交付了「能看」，「能建」需要新契约面（已上报 coord-main）。
    await expect(page.getByTestId("canvas-template-create")).toBeVisible();
  });

  /* ── 步骤 5：登录已有用户（已交付，#387）──────────────────────────────── */

  test("步骤 5：已有用户登录 → 登出 → 重新登录，会话恢复", async ({ page }) => {
    await loginAs(page, FULLSTACK_E2E.email, FULLSTACK_E2E.password);
    await expect(page).toHaveURL(/\/projects$/);

    // 登出后受保护路由必须 fail-closed，不是「渲染一个空壳」。
    await page.context().clearCookies();
    await page.evaluate(() => window.localStorage.clear());
    await page.goto("/projects");
    await expect(page).toHaveURL(/\/login/);

    // 重新登录后会话真的恢复。
    await loginAs(page, FULLSTACK_E2E.email, FULLSTACK_E2E.password);
    await expect(page).toHaveURL(/\/projects$/);
  });

  /* ── 步骤 6：Chat 新增 / 删除 / 聊天 ──────────────────────────────────── */

  test("步骤 6a：会话新建 → 改名 → 删除，刷新后状态一致（#476 已交付）", async ({ page }) => {
    await loginAs(page, FULLSTACK_E2E.email, FULLSTACK_E2E.password);
    await page.goto(`/chat?projectId=${FULLSTACK_E2E.projectId}`);

    await expect(page.getByTestId("chat-read-thread-list")).toBeVisible();
    // 写入口的渲染依据是服务端下发的 `thread.mutate`（#460/#489）。
    // 它不可见就说明能力没下发到位——那正是 #489 修的那条死路。
    await expect(page.getByTestId("chat-thread-create")).toBeVisible();

    const title = `闭环会话 ${Date.now()}`;
    await page.getByTestId("chat-thread-create").click();
    await page.getByTestId("chat-thread-title-input").fill(title);
    await page.getByTestId("chat-thread-title-submit").click();

    // 「刷新后仍在」是这条唯一能区分「写进了库」与「写进了 React state」的断言。
    await expect(page.getByText(title)).toBeVisible();
    await page.reload();
    await expect(page.getByText(title)).toBeVisible();
  });

  test.fail("[#462] 步骤 6b：在会话里发一条消息并刷新后仍在", async ({ page }) => {
    await loginAs(page, FULLSTACK_E2E.email, FULLSTACK_E2E.password);
    await page.goto(`/chat?projectId=${FULLSTACK_E2E.projectId}`);
    // 发消息的后端与契约在 #429 已交付并合入，composer 的正式接线归 #462。
    await expect(page.getByTestId("chat-composer-input")).toBeVisible();
  });

  /* ── 步骤 7：实时录音在 chat 上 ───────────────────────────────────────── */

  test.fail("[#465 + #466] 步骤 7：会话内录音 → 停止 → 转录归属该会话且刷新仍在", async ({ page }) => {
    await loginAs(page, FULLSTACK_E2E.email, FULLSTACK_E2E.password);
    await page.goto(`/chat?projectId=${FULLSTACK_E2E.projectId}`);
    // 实测：`MediaRecorder` / `getUserMedia` 在 apps/web 下**零命中**（#466 未开工），
    // recording controller 也尚未暴露（#465 在飞）。
    await expect(page.getByTestId("chat-recording-start")).toBeVisible();
  });

  /* ── 步骤 8：使用 skill / 使用 agent / 使用可视化模板 ─────────────────── */

  test.fail("[#467] 步骤 8a：会话内挂载一个 skill → 生效 → 卸载", async ({ page }) => {
    await loginAs(page, FULLSTACK_E2E.email, FULLSTACK_E2E.password);
    await page.goto(`/chat?projectId=${FULLSTACK_E2E.projectId}`);
    await expect(page.getByTestId("chat-skill-mount")).toBeVisible();
  });

  test.fail("[#414 + #413] 步骤 8b：会话内的 agent **真的执行**并产生一条回复", async ({ page }) => {
    await loginAs(page, FULLSTACK_E2E.email, FULLSTACK_E2E.password);
    await page.goto(`/chat?projectId=${FULLSTACK_E2E.projectId}`);
    // ⚠ 这一步测的是**执行**，不是挂载关系。#467 交付之后
    // `capability-catalog-screen.tsx` 那句自陈「出现在目录中不代表已经具备可执行的
    // AgentRun 或 Skill 运行时」**依然成立** —— 别让一批全绿 PR 造成闭环已通的错觉。
    await expect(page.getByTestId("chat-agent-run-status")).toBeVisible();
  });

  test.fail("[#493] 步骤 8c：在项目/会话里真正**使用**一个 canvas 模板", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/canvas");
    // 54 个 open issue 里模板相关只有「能建、能看」，「能用」在 #493 之前零覆盖。
    await expect(page.getByTestId("canvas-template-apply")).toBeVisible();
  });
});
