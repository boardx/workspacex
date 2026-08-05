/**
 * #552 —— 「**用户自己造出来的 skill，用户自己用得了**」的真实浏览器门控。
 *
 * ## 这条 spec 补的那条断线
 *
 * 核心闭环第 3 步（新增 Skill 草稿）绿，第 8a 步（会话内挂载 skill）也绿，
 * **但 8a 挂的是种子 skill**：`fullstack-smoke-fixture.ts` 里 `mountableSkillId` 那段
 * 注释逐字记着为什么必须种它 ——「这套系统里目前**不存在**任何产品路径能把一个 skill
 * 变成『已启用』」。`advanceSkillStatus` / `reviewSkillVersion` / `releaseSkillVersion`
 * 在 interface 层的引用数都是 0。两个绿点之间那条线是断的，本文件就是那条线。
 *
 * 链路一节不许省：Chromium → Next 同源代理 → `SkillReviewController`
 * → `runSecurityScan` / `submitSkillForReview` / `reviewSkillVersion`
 * → `PgSkillContractRepository` → PostgreSQL → 再走 `SkillMountController` 挂上去。
 *
 * ## ⚠ 第二评审人**没有被简化掉**
 *
 * 整条链用**三个不同身份**走完，一个都不能省：
 *   · 提交人（`email`，consultant，team=fullstack，且**自己也是**方法论审核人）
 *   · 第二位方法论审核人（`memberEmail`）—— 唯一按得下 approve 的那位
 *   · 安全评审人（`securityReviewerEmail`）—— 按 approve 必须拿 `REVIEWER_FUNCTION_MISMATCH`
 * 用同一个 principal 一路到底会让 I-5/V14 那道门白做，而它正是
 * `SKILLS_FORBIDDEN_ROUTES` 要守的东西。
 *
 * ## ⚠ 三条反证都是**常驻用例**，不是一次手工实验
 *
 *   · 反证 A（本文件两条）：同一身份自审 ⇒ `SELF_REVIEW_FORBIDDEN`；安全评审人 ⇒
 *     `REVIEWER_FUNCTION_MISMATCH`。两条都**在刷新之后再断言库内状态未变** ——
 *     只断言错误码的话，一个「报错了但状态照改」的实现会全绿通过。
 *   · 反证 B：`WORKSPACEX_COUNTERPROOF_SKILL_REVIEW=skip-status-persist` 把**状态落库
 *     那一步**摘掉（开关在 API 进程里，见 `skill-review.controller.ts`）。
 *     批准那一步照常绿，红点精确落在**刷新之后**那一句。复现命令见文件末。
 *   · 反证 C（本文件最后一条）：拿一个**草稿**状态的 skill 去挂载，必须被
 *     `SKILL_NOT_ENABLED` 拒。
 *
 * ## ⚠ `describe.serial`，且新建出来的 skill 是 `team-only`
 *
 * 各条用例按顺序共享**库里那一行**（Playwright 每条用例是独立 context，所以身份切换
 * 靠的是各自重新登录，不是清 cookie）。`team-only` 归 fullstack 团队而不是 `org-wide`：
 * `skill-create-smoke.spec.ts:94` 断言**管理员**打开目录看到真实空态，那是一条反空转
 * 断言，管理员不属于任何团队 ⇒ 本文件建的两行对他都不可见，那条断言原样成立。
 */
import { expect, test, type Page } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";
// ⚠ 从产品代码 import 那个 key，**不在这里再写一份字面量**：鉴权是
//   `Authorization: Bearer <token>`（不是 cookie，见 `api-client.ts` 文件头），
//   token 存在 localStorage 的这个键下。抄一份副本就是本仓九次漂移的形状。
import { SESSION_TOKEN_STORAGE_KEY } from "../lib/api-client";

const API = "/__fullstack_api";

/**
 * 直连 API 时要带的头。
 *
 * ⚠ `page.request` **不会**自动带上身份：这套系统用 Bearer token，不用 cookie，
 *   而 token 由页面存进 localStorage。少了这一步，下面的直连调用会拿到 401 ——
 *   反证会红，但**不是因为对的原因**。
 */
async function authHeaders(page: Page): Promise<Record<string, string>> {
  const token = await page.evaluate((key) => window.localStorage.getItem(key), SESSION_TOKEN_STORAGE_KEY);
  expect(token, "登录之后 localStorage 里应有 session token").toBeTruthy();
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function loginAs(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

const loginAsSubmitter = (page: Page) =>
  loginAs(page, FULLSTACK_E2E.email, FULLSTACK_E2E.password);
/** 第二位方法论审核人 —— **唯一**按得下 approve 的那位。 */
const loginAsSecondReviewer = (page: Page) =>
  loginAs(page, FULLSTACK_E2E.memberEmail, FULLSTACK_E2E.memberPassword);
const loginAsSecurityReviewer = (page: Page) =>
  loginAs(page, FULLSTACK_E2E.securityReviewerEmail, FULLSTACK_E2E.securityReviewerPassword);

async function openCatalog(page: Page) {
  await page.goto("/skill");
  await expect(page.getByTestId("skill-catalog-live")).toBeVisible();
  // 先证明这次列表**真的读成功了**，再拿它做任何判断。少了这两条，一次读取失败
  // 会让下面所有 "not to contain" 恒成立 —— 那正是反证要防的空转。
  await expect(page.getByTestId("skill-catalog-loading")).toHaveCount(0);
  await expect(page.getByTestId("skill-catalog-error")).toHaveCount(0);
}

/**
 * 建一份**干净**的声明式契约。
 *
 * ⚠ `dataScope` 留空、`readsRawTranscript` 不勾：`FailClosedSubmitterGrants` 恒返回空集，
 *   任何非空范围都会被判 `DATA_SCOPE_EXCEEDS_SUBMITTER`（同 `skill-create-smoke.spec.ts`
 *   里逐字同一段理由）。#552 还多一层：那两项非空时**安全扫描**也会判
 *   `scope-elevation` / 待确认，于是本条会红在门禁一而不是走到门禁二。
 * ⚠ 提示词里不许出现「忽略以上指令」这类措辞 —— `declarative-scan.ts` 会判
 *   `prompt-injection` 并直接 `reject`。
 */
async function createTeamOnlySkill(page: Page, name: string) {
  await page.getByTestId("skill-create-open").click();
  await expect(page.getByTestId("skill-create-panel")).toBeVisible();
  await page.getByTestId("skill-create-name").fill(name);
  await page.getByTestId("skill-create-duty").fill("把一组假设按给定标准排序并给出理由");
  await page.getByTestId("skill-create-prompt").fill("对 {{hypotheses}} 按 {{criteria}} 排序");
  await page.getByTestId("skill-create-input-schema").fill('{"type":"object","properties":{"hypotheses":{"type":"array"}}}');
  await page.getByTestId("skill-create-output-schema").fill('{"type":"object","properties":{"ranked":{"type":"array"}}}');
  await page.getByTestId("skill-create-fallback").fill("信息不足时明确说明缺什么，不臆造");
  // ⚠ `team-only`，不是默认的 `org-wide`。理由见文件头最后一段。
  await page.getByTestId("skill-create-visibility-team-only").click();
  await page.getByTestId("skill-create-submit").click();
  await expect(page.getByTestId("skill-catalog-notice")).toContainText(name);
}

/** 打开某一行的契约详情（门禁面板在里面）。 */
async function openGatePanelOf(page: Page, name: string) {
  const row = page
    .getByTestId("skill-catalog-list")
    .locator("div")
    .filter({ hasText: name })
    .first();
  await row.getByTestId("skill-catalog-detail").first().click();
  await expect(page.getByTestId("skill-detail-panel")).toBeVisible();
  await expect(page.getByTestId("skill-gate-panel")).toBeVisible();
}

/** 该行**此刻在库里**的状态：先刷新，再从服务端读回来的那一行上取。 */
async function statusAfterReload(page: Page, name: string) {
  await page.reload();
  await openCatalog(page);
  const row = page
    .getByTestId("skill-catalog-list")
    .locator("div")
    .filter({ hasText: name })
    .first();
  return row;
}

const NAME = FULLSTACK_E2E.reviewedSkillName;
const DRAFT_ONLY = FULLSTACK_E2E.draftOnlySkillName;

test.describe.serial("#552 双重门禁：用户自己造出一个「已启用」skill 并在会话里用上它", () => {
  /* ── ① 提交人：建草稿 → 安全扫描 → 提交评审 ───────────────────────────── */

  test("提交人建出草稿，过安全扫描，提交进人工门禁（刷新后仍是「待审核」）", async ({ page }) => {
    const failures: string[] = [];
    page.on("pageerror", (e) => failures.push(`page error: ${e.message}`));

    await loginAsSubmitter(page);
    await openCatalog(page);

    await createTeamOnlySkill(page, NAME);
    // 反证 C 要用的那一个：建出来就一直停在草稿，从不提交、从不审核。
    await createTeamOnlySkill(page, DRAFT_ONLY);

    // 新建出来只能是**草稿** —— 契约禁止 `POST /skills/:id/enable`，创建这条路径
    // 结构上造不出别的状态。少了这条，创建可以被实现成绕开双门禁。
    await expect(page.getByTestId("skill-catalog-list")).toContainText("草稿");

    await openGatePanelOf(page, NAME);

    /* 门禁第一道：真的打到 `/skill-versions/:id/security-scan`，不是前端自己说过了。 */
    const scanResponse = page.waitForResponse(
      (r) => r.request().method() === "POST" && /\/skill-versions\/[^/]+\/security-scan$/.test(r.url()),
    );
    await page.getByTestId("skill-gate-scan").click();
    expect((await scanResponse).status()).toBe(201);
    // 这份契约是干净的 ⇒ `pass`。判拒/待确认都会让下一步走不下去，那是门禁在起作用。
    await expect(page.getByTestId("skill-gate-notice")).toContainText("pass");
    await expect(page.getByTestId("skill-gate-error")).toHaveCount(0);

    /* 草稿 → 待审核 */
    const submitResponse = page.waitForResponse(
      (r) => r.request().method() === "POST" && /\/skill-versions\/[^/]+\/submit$/.test(r.url()),
    );
    await page.getByTestId("skill-gate-submit").click();
    expect((await submitResponse).status()).toBe(201);
    await expect(page.getByTestId("skill-gate-notice")).toContainText("待审核");

    /* ⚠ 刷新后仍是「待审核」= 它写进了库，不是写进了 React state。 */
    const row = await statusAfterReload(page, NAME);
    await expect(row).toContainText("待审核");

    expect(failures).toEqual([]);
  });

  /* ── ② 反证 A-1：提交人自己审自己 ────────────────────────────────────── */

  /**
   * 🔴 提交人**本身持有** `methodology-reviewer` 职能（种子如此，理由见 seed 脚本），
   * 所以这条红在 `SELF_REVIEW_FORBIDDEN` 而不是「你根本没职能」——两码分开正是 I-4/A4。
   *
   * ⚠ 断言不止于错误码：**刷新之后库里那一行必须还是「待审核」**。
   *   只断言错误码时，一个「报了错但状态照改」的实现会全绿通过。
   */
  test("反证 A-1：同一个身份走完评审 ⇒ SELF_REVIEW_FORBIDDEN，且库内状态未变", async ({ page }) => {
    await loginAsSubmitter(page);
    await openCatalog(page);
    await openGatePanelOf(page, NAME);

    await page.getByTestId("skill-gate-approve").click();
    const error = page.getByTestId("skill-gate-error");
    await expect(error).toContainText("SELF_REVIEW_FORBIDDEN");
    await expect(error).toContainText("403");

    const row = await statusAfterReload(page, NAME);
    await expect(row).toContainText("待审核");
    await expect(row).not.toContainText("已启用");
  });

  /* ── ③ 反证 A-2：安全评审人批 skill ─────────────────────────────────── */

  /**
   * 🔴 I-5/V14：**两职能不合并**。安全评审人裁的是工具白名单越权申请，不是「批准发布 skill」。
   * 这条是 `SKILLS_FORBIDDEN_ROUTES` 真正要守的那道门 —— 简化掉它，那道门就白做了。
   */
  test("反证 A-2：安全评审人按下批准 ⇒ REVIEWER_FUNCTION_MISMATCH，且库内状态未变", async ({ page }) => {
    await loginAsSecurityReviewer(page);
    await openCatalog(page);
    // 他与提交人同属 fullstack 团队 ⇒ 看得见这一行。看不见的话本条会红在 404 上，
    // **不是因为对的原因**，所以先把「他确实看得见」钉死。
    await expect(page.getByTestId("skill-catalog-list")).toContainText(NAME);
    await openGatePanelOf(page, NAME);

    await page.getByTestId("skill-gate-approve").click();
    const error = page.getByTestId("skill-gate-error");
    await expect(error).toContainText("REVIEWER_FUNCTION_MISMATCH");
    await expect(error).toContainText("403");

    const row = await statusAfterReload(page, NAME);
    await expect(row).toContainText("待审核");
    await expect(row).not.toContainText("已启用");
  });

  /* ── ④ 第二位方法论审核人批准 ⇒ 已启用 ──────────────────────────────── */

  /**
   * **系统里唯一产生 `已启用` 的产品路径。**
   *
   * ⚠ 「刷新后仍是已启用」是 🔴 **反证 B 的红点**：
   *   `WORKSPACEX_COUNTERPROOF_SKILL_REVIEW=skip-status-persist` 之下，上面每一条都
   *   照常绿（HTTP 200、界面显示已启用），只有下面这一句会红。之所以能这样，是因为
   *   本屏批准之后**乐观更新本地那一行、不重读服务端**（`skill-catalog-live.tsx`
   *   的 `onStatusChanged` 注释写了为什么）。若改成「批准后立刻重读」，反证会红在
   *   刷新**之前**，那样它考验的是「请求有没有到服务端」，根本没考验到落库。
   */
  test("第二位方法论审核人批准 ⇒ 已启用，且刷新后仍是已启用", async ({ page }) => {
    await loginAsSecondReviewer(page);
    await openCatalog(page);
    await openGatePanelOf(page, NAME);

    const reviewResponse = page.waitForResponse(
      (r) => r.request().method() === "POST" && /\/skill-versions\/[^/]+\/review$/.test(r.url()),
    );
    await page.getByTestId("skill-gate-approve").click();
    expect((await reviewResponse).status()).toBe(201);

    // 评审记录 id 是契约要求的返回值：一次指不出来的批准，事后与「从未发生」不可区分。
    await expect(page.getByTestId("skill-gate-notice")).toContainText("已启用");
    await expect(page.getByTestId("skill-gate-notice")).toContainText("skill-review-");

    // 🔴 反证 B 的红点就在这一句。
    const row = await statusAfterReload(page, NAME);
    await expect(row).toContainText("已启用");
  });

  /* ── ⑤ 提交人在会话里挂上**自己建的**那一个（不是种子那个）────────────── */

  /**
   * 第 8a 步至今挂的都是 `mountableSkillId` —— **夹具种出来的**那一条。
   * 本条挂的是刚刚由真实门禁批准的 `NAME`，这正是 #552 之前不可能发生的事。
   *
   * ⚠ 顺带把 🔴 **反证 C** 打在同一条线程上：那个从没提交过的 `DRAFT_ONLY` 拿去挂载
   *   必须被 `SKILL_NOT_ENABLED` 拒。它走的是 `page.request`（同一份会话 cookie）
   *   而不是界面 —— 界面上的可选池已经按 `已启用` 过滤过了，点不到它，
   *   而「点不到」证明不了**服务端**会拒绝。要断的是服务端那一刀。
   */
  test("提交人在会话内挂上自己刚造出来的那个 skill；草稿状态的那个被服务端拒绝（反证 C）", async ({ page }) => {
    await loginAsSubmitter(page);

    /* 先从目录里拿到两个 skillId —— 名字是我们的，id 是服务端分配的。 */
    await openCatalog(page);
    const headers = await authHeaders(page);
    const catalog = await page.request.get(
      `${API}/skills?orgId=${encodeURIComponent(FULLSTACK_E2E.orgId)}&entry=library`,
      { headers },
    );
    expect(catalog.status()).toBe(200);
    const listed = (await catalog.json()) as {
      items: { skillId: string; name: string; status: string }[];
    };
    const approved = listed.items.find((i) => i.name === NAME);
    const draftOnly = listed.items.find((i) => i.name === DRAFT_ONLY);
    expect(approved, `目录里应有 ${NAME}`).toBeDefined();
    expect(draftOnly, `目录里应有 ${DRAFT_ONLY}`).toBeDefined();
    // 反证自身的自检：一个是已启用、一个仍是草稿，两者确实不同。
    expect(approved!.status).toBe("已启用");
    expect(draftOnly!.status).toBe("草稿");

    /* 建一条自己的线程，不蹭别的用例留下的那条。 */
    await page.goto(`/chat?projectId=${FULLSTACK_E2E.projectId}`);
    await page.getByTestId("chat-thread-create").click();
    const title = `#552 挂自建 skill ${Date.now()}`;
    await page.getByTestId("chat-thread-title-input").fill(title);
    await page.getByTestId("chat-thread-title-submit").click();
    await expect(page.getByTestId("chat-read-thread-list").getByText(title)).toBeVisible();

    // 新线程什么都没挂 —— 先钉住真实空态，否则「挂上了」可能一直就是真的。
    await expect(page.getByTestId("chat-skill-mount-empty")).toBeVisible();

    /* 挂载：POST 必须 201。⚠ URL 带 `?projectId=…`，不要用 `$` 收尾（8a 踩过）。 */
    await expect(page.getByTestId("chat-skill-mount")).toBeEnabled();
    await page.getByTestId("chat-skill-mount").click();
    const mountResponse = page.waitForResponse(
      (r) => r.request().method() === "POST" && /\/threads\/[^/]+\/skill-mounts(\?|$)/.test(r.url()),
    );
    await page.getByTestId(`chat-skill-mount-option-${approved!.skillId}`).click();
    const mounted = await mountResponse;
    expect(mounted.status()).toBe(201);
    await expect(page.getByTestId(`chat-skill-mounted-${approved!.skillId}`)).toBeVisible();

    /* 刷新后仍挂着 = 它在库里。 */
    await page.reload();
    await page.getByTestId("chat-read-thread-list").getByText(title).click();
    await expect(page.getByTestId(`chat-skill-mounted-${approved!.skillId}`)).toBeVisible();

    /* ── 🔴 反证 C：草稿状态的那个挂不上 ── */
    const threadId = /\/threads\/([^/]+)\/skill-mounts/.exec(new URL(mounted.url()).pathname)?.[1];
    expect(threadId, "从挂载请求里取得 threadId").toBeTruthy();
    const query = `?projectId=${encodeURIComponent(FULLSTACK_E2E.projectId)}`;

    // 乐观锁的版本号来自读端口，不能瞎编：编一个会红在 `SKILL_VERSION_CHANGED` 上，
    // **不是因为对的原因**。
    const deviations = await page.request.get(
      `${API}/threads/${threadId}/skill-deviations${query}`,
      { headers },
    );
    expect(deviations.status()).toBe(200);
    const version = ((await deviations.json()) as { version: string }).version;

    const rejected = await page.request.post(`${API}/threads/${threadId}/skill-mounts${query}`, {
      headers,
      data: { threadId, skillIds: [draftOnly!.skillId], expectedVersion: version },
    });
    expect(rejected.status()).toBe(422);
    expect(await rejected.json()).toMatchObject({ reasonCode: "SKILL_NOT_ENABLED" });

    // 被拒的东西没有混进挂载列表 —— 失败态不许留下半条记录。
    await page.reload();
    await page.getByTestId("chat-read-thread-list").getByText(title).click();
    await expect(page.getByTestId(`chat-skill-mounted-${draftOnly!.skillId}`)).toHaveCount(0);
    await expect(page.getByTestId(`chat-skill-mounted-${approved!.skillId}`)).toBeVisible();
  });
});

/**
 * ## 反证 B 的复现命令（红点必须落在「刷新后仍是已启用」那一句）
 *
 * ```bash
 * WORKSPACEX_COUNTERPROOF_SKILL_REVIEW=skip-status-persist \
 *   pnpm exec tsx .harness/scripts/with-test-isolation.ts -- \
 *   pnpm --filter @repo/web exec playwright test \
 *     --config playwright.fullstack-smoke.config.ts skill-review-gate.spec.ts
 * ```
 *
 * 预期：前四条用例里「批准 ⇒ 界面显示已启用」照常绿（HTTP 201、`skill-gate-notice`
 * 含「已启用」），**第 ④ 条红在 `statusAfterReload` 之后那句 `toContainText("已启用")`**，
 * 第 ⑤ 条随之红在 `SKILL_NOT_ENABLED`（库里那一行还是「待审核」）。
 * 若红在更早的地方，**先怀疑反证本身**：那说明这一刀砍到的不是落库那一步。
 */
