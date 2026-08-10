/**
 * #520 —— 核心闭环第 3 步「**新增** Skill」的**真实浏览器**门控。
 *
 * 链路一节不许省：Chromium → Next 同源代理 → `SkillController`（#459 / PR #518）
 * → `create-skill-draft` 用例 → `PgSkillContractRepository` → PostgreSQL。
 * 中途没有任何一处塞假数据。
 *
 * ## 这里证明的三件事，别处证不了
 *
 * ① **「刷新后仍在」**。组件测试里的「刷新」只是再调一次 fetch mock；只有真的重新加载
 *    页面，才能区分「写进了库」和「写进了 React state」。
 * ② **真实空态**。种子没有预置任何声明式契约 skill，界面显示的是空态而**不是示例 skill**
 *    （契约 `listSkills` 逐字：空结果返回 `[]`，前端渲染真实空态，**不生成示例 skill**）。
 * ③ **失败态回显后端真实错误信封**。重名提交拿到的是 `SKILL_NAME_CONFLICT（HTTP 409）`，
 *    不是糊成一句「加载失败」。少了这条，界面可以把任何失败都显示成同一句话，
 *    而使用者永远不知道到底是权限、校验还是重名。
 *
 * ## ⚠ 反证是一条**常驻用例**，不是一次手工实验（见文件末）
 *
 * ⚠ 而且它必须**红在刷新那一步**。做法见下面 `createSkill()` 的注释：本屏在拿到 201 之后
 *   **乐观地把这一行插进本地列表**（内容是使用者自己填的 + 服务端分配的 skillId/status），
 *   **不**立刻重读列表。于是反证里那一行会照常显示出来 —— 只有 `page.reload()` 之后
 *   才露馅。若这里改成「创建后立刻重读服务端」，反证会红在刷新**之前**，
 *   那样它考验的是「创建请求到没到服务端」，**根本没考验到刷新**。
 *
 * ⚠ 单独成文件而不是并进 `fullstack-smoke.spec.ts`：那个文件的每一条 `page.goto`
 *   都被 `.harness/scripts/fullstack-smoke.test.ts` 按出现次数钉死（#387 的反空转手段）。
 *   本文件与 #387 / #458 / #496 共用同一套 webServer 与同一个库，串行执行。
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

const API = "/__fullstack_api";
const CREATE_PATH = `${API}/skills`;

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.adminEmail);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.adminPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

/** 只记 `POST /skills` 的状态码；`GET /skills` 列表不进这个数组。 */
function recordCreates(page: Page): number[] {
  const codes: number[] = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname === CREATE_PATH && response.request().method() === "POST") {
      codes.push(response.status());
    }
  });
  return codes;
}

async function openSkillCatalog(page: Page) {
  await page.goto("/skill");
  await expect(page.getByTestId("skill-catalog-live")).toBeVisible();
}

/**
 * 填完整份声明式契约并提交。
 *
 * ⚠ `dataScope` 留空、`readsRawTranscript` 不勾：不是图省事。`FailClosedSubmitterGrants`
 *   （`apps/api/src/infrastructure/skill/skill-gate-adapters.ts`）对任何**非空**范围一律
 *   判越权（`DATA_SCOPE_EXCEEDS_SUBMITTER`），因为「提交人有哪些数据范围」这份数据源
 *   全仓还不存在。同一处理由逐字写在 `apps/api/tests/skill/skill-contract-crud.test.ts:41`。
 */
async function createSkill(page: Page, name: string) {
  await page.getByTestId("skill-create-open").click();
  await expect(page.getByTestId("skill-create-panel")).toBeVisible();
  await page.getByTestId("skill-create-name").fill(name);
  await page.getByTestId("skill-create-duty").fill("把一组假设按给定标准排序并给出理由");
  await page.getByTestId("skill-create-prompt").fill("对 {{hypotheses}} 按 {{criteria}} 排序");
  await page.getByTestId("skill-create-input-schema").fill('{"type":"object"}');
  await page.getByTestId("skill-create-output-schema").fill('{"type":"object"}');
  await page.getByTestId("skill-create-fallback").fill("信息不足时明确说明缺什么，不臆造");
  await page.getByTestId("skill-create-submit").click();
}

test("admin creates a declarative-contract skill in the browser; PostgreSQL keeps it across reloads", async ({ page }) => {
  const failures: string[] = [];
  const creates = recordCreates(page);
  page.on("console", (m) => {
    if (m.type() === "error") failures.push(`console error: ${m.text()}`);
  });
  page.on("pageerror", (e) => failures.push(`page error: ${e.message}`));

  const NAME = FULLSTACK_E2E.skillName;

  await loginAsAdmin(page);
  await openSkillCatalog(page);

  // ── ① 真实空态：种子没有预置声明式契约 skill，界面**不生成示例** ──────────
  await expect(page.getByTestId("skill-catalog-empty")).toBeVisible();
  await expect(page.getByTestId("skill-catalog-list")).toHaveCount(0);

  // ── ② 新建 ───────────────────────────────────────────────────────────────
  await createSkill(page, NAME);

  await expect(page.getByTestId("skill-catalog-notice")).toContainText(NAME);
  await expect(page.getByTestId("skill-catalog-list")).toContainText(NAME);
  // 201，不是 200：这条路由真的造出了一行资源。
  expect(creates).toEqual([201]);

  // ── ③ 建出来的是**草稿**，而且只能是草稿 ────────────────────────────────
  //     契约禁止 `POST /skills/:id/enable`（`SKILLS_FORBIDDEN_ROUTES`），
  //     `已启用` 只能由第二个评审人产生。少了这条，创建可以被实现成绕开双门禁。
  await expect(page.getByTestId("skill-catalog-list")).toContainText("草稿");

  // ── ④ 刷新后仍在 = 它在库里，不在 React state 里 ────────────────────────
  await page.reload();
  await expect(page.getByTestId("skill-catalog-live")).toBeVisible();
  await expect(page.getByTestId("skill-catalog-loading")).toHaveCount(0);
  await expect(page.getByTestId("skill-catalog-error")).toHaveCount(0);
  await expect(page.getByTestId("skill-catalog-list")).toContainText(NAME);
  await expect(page.getByTestId("skill-catalog-empty")).toHaveCount(0);
  // 刷新没有再发一次创建请求——那一行来自 GET，不是重放。
  expect(creates).toEqual([201]);

  // ── ⑤ 详情可读：契约三件套来自 `GET /skills/:skillId` ────────────────────
  await page.getByTestId("skill-catalog-detail").first().click();
  const detail = page.getByTestId("skill-detail-panel");
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("对 {{hypotheses}} 按 {{criteria}} 排序");
  // 契约 :501 逐字：`latestTrialRun` 为 null 是**真实空态**（还没跑过），不是失败。
  await expect(page.getByTestId("skill-detail-trialrun-empty")).toBeVisible();

  expect(failures).toEqual([]);
});

/**
 * 失败态：后端**真实**错误信封原样回显（reasonCode ＋ HTTP 状态），不糊成「操作失败」。
 *
 * 触发方式是**声明一个非空数据范围**：`FailClosedSubmitterGrants` 恒返回空集
 * （`skill-gate-adapters.ts` 的文件头解释了为什么它 fail closed 而不是 fallback），
 * 于是任何非空 `dataScope` 都被判 `DATA_SCOPE_EXCEEDS_SUBMITTER` ⇒ 403。
 *
 * ⚠ 刻意**不**用重名来触发。重名走 `skill.controller.ts:353` 的 `rejectNameConflict`，
 *   而 `SKILL_NAME_CONFLICT` **不在** `skills.SkillError` 闭集里，会被
 *   `all-exceptions.filter.ts:253` 那道 `safeParse` 剥掉 —— 前端只看得到一个光秃秃的 409。
 *   用它当断言，等于把「reasonCode 显示得出来」这条验成「显示得出 HTTP 状态」。
 */
test("a rejected create shows the backend's real failure envelope (reasonCode + HTTP status)", async ({ page }) => {
  await loginAsAdmin(page);
  await openSkillCatalog(page);

  await page.getByTestId("skill-create-open").click();
  await page.getByTestId("skill-create-name").fill(`${FULLSTACK_E2E.skillName}_DENIED`);
  await page.getByTestId("skill-create-duty").fill("申请一个提交人并不持有的数据范围");
  await page.getByTestId("skill-create-prompt").fill("读取 {{crm}} 后总结");
  await page.getByTestId("skill-create-input-schema").fill('{"type":"object"}');
  await page.getByTestId("skill-create-output-schema").fill('{"type":"object"}');
  await page.getByTestId("skill-create-fallback").fill("读不到就说读不到");
  await page.getByTestId("skill-create-data-scope").fill("crm:customer:read");
  await page.getByTestId("skill-create-submit").click();

  const error = page.getByTestId("skill-create-error");
  await expect(error).toContainText("DATA_SCOPE_EXCEEDS_SUBMITTER");
  await expect(error).toContainText("403");

  // 被拒绝的东西**没有**混进列表——失败态不许留下一行乐观插入的残影。
  await expect(page.getByTestId("skill-catalog-list")).not.toContainText("_DENIED");
});

/**
 * 🔴 反证（常驻）：把创建的**后端调用摘掉**，上面那条「刷新后仍在」必须当场失效。
 *
 * 做法是在浏览器里拦截 `POST /skills`，用一个形状完全合法、但**没有落库**的 201 顶替它。
 * 界面收到的东西与真实成功一模一样，于是它会照常把那一行显示出来——这正是
 * 「写进 React state 就以为成了」的形状。**刷新之后真相才出现。**
 *
 * ⚠ 这条反证打在**刷新**这个接缝上，不是打在「请求有没有发出去」上：
 *   下面先断言那一行**确实一度显示了**（`intercepted === 1` ＋ 列表里看得见 NAME），
 *   然后才 `reload()`。若本屏改成「创建后立刻重读服务端」，那一行在刷新前就不会出现，
 *   本用例会红在 `toContainText(NAME)` 那一步——那样它考验的是别的东西。
 *   所以下面那条 `toContainText(NAME)` 是**反证自身的自检**，不许删。
 *
 * ⚠ 断言写成「刷新后**不在**」，而不是 `test.fail()`：后者只知道整条用例红了，
 *   不知道它是不是因为对的原因红的（比如登录挂了也会红）。
 */
test("counterproof: with the create request stubbed out in the browser, the skill does not survive a reload", async ({ page }) => {
  const NAME = FULLSTACK_E2E.skillCounterproofName;

  /**
   * #861 —— 首屏列表**扣住不放**，直到创建请求真的发生。
   *
   * 这不是「让用例慢一点」，是把一个原本偶发的窗口变成**必然**的窗口。CI 上本条用例
   * 间歇红在下面那句 `toContainText(NAME)`：提示出来了，列表里却没有那一行 ——
   * 因为本屏的乐观插入曾经写成「只有列表已经 ready 才插得进去」，于是提交落在
   * 「首屏 GET 还在飞」这段时间里时，那一行被静默丢掉，随后到达的响应再把
   * state 覆盖成纯服务端结果。stub 出来的 201 零网络延迟，最容易撞进这个窗口。
   *
   * ⚠ 修法不是加重试、不是调大 timeout —— 多等一会儿那一行永远不会自己回来。
   *   修的是本屏（`skill-catalog-live.tsx` 的 `pending`）：创建之前就已在飞的那次读取
   *   不许否定一件在它之后发生的事；创建之后发起的读取（刷新 / 本用例下面的
   *   `reload()`）照旧抹掉它 —— 所以本条反证的**红点没有被削弱一分**。
   * ⚠ 扣的是「直到 POST 发生」，不是一个固定毫秒数：后者在快机器上会漏掉窗口，
   *   于是这条门控会在最需要它的地方（快 CI）悄悄不再考验任何东西。
   */
  let releaseFirstList: () => void = () => {};
  const firstListHeld = new Promise<void>((resolve) => {
    releaseFirstList = resolve;
  });
  let listRequests = 0;
  let intercepted = 0;

  // ⚠ 一个 handler 管两个方法，匹配器用**函数**而不是 glob：`GET /skills?orgId=…` 带查询串，
  //   它与 `POST /skills` 能不能被同一个 glob 命中要看版本，两条 route 的先后与
  //   `fallback()` 的走向也随之而变——那是一个会随依赖升级悄悄失效的假设。
  //   按 pathname 判定则不依赖任何 glob 语义（详情 `GET /skills/:id` 的 pathname 不同，不受影响）。
  await page.route(
    (url: URL) => url.pathname === CREATE_PATH,
    async (route: Route) => {
      if (route.request().method() === "GET") {
        listRequests += 1;
        // 首屏那次扣住；`reload()` 之后那次照常放行——反证靠的就是它读回真实的库。
        if (listRequests === 1) await firstListHeld;
        return route.continue();
      }
      if (route.request().method() !== "POST") return route.continue();
      intercepted += 1;
      // 首屏列表在**创建之后**才回来：这正是 CI 上偶发命中的那个次序。
      releaseFirstList();
      // 契约 `createSkillDraft.out` 的合法形状，只是从来没有到过服务端。
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          skillId: "skill-counterproof-520",
          versionId: "skillver-counterproof-520",
          source: "自建",
          status: "草稿",
        }),
      });
    },
  );

  await loginAsAdmin(page);
  await openSkillCatalog(page);
  await createSkill(page, NAME);

  // 拦截真的发生了——否则下面的「刷新后不在」可能只是因为这次根本没建。
  expect(intercepted).toBe(1);
  // #861 的自检：首屏那次读取**确实**被扣在了创建之前（否则上面那段 route 就是个空转，
  // 本用例又退回成「碰运气命中窗口」——它在 CI 上正是因此偶发红的）。
  expect(listRequests).toBe(1);

  // ⚠ 反证自身的自检：界面一度显示成功，且那一行**确实出现在列表里**。
  //   有了这两条，下面的 `reload()` 才是本用例唯一变红的原因。
  await expect(page.getByTestId("skill-catalog-notice")).toContainText(NAME);
  await expect(page.getByTestId("skill-catalog-list")).toContainText(NAME);

  // ⚠ 关键：这一行从来没进过库。刷新之后它不在。
  await page.reload();
  await expect(page.getByTestId("skill-catalog-live")).toBeVisible();

  // ⚠ 先证明这次列表**真的读成功了**，再说「那一行不在」。
  //   少了这两条，一次读取失败会让「不在」恒成立，反证就变成了它自己要防的空转。
  await expect(page.getByTestId("skill-catalog-loading")).toHaveCount(0);
  await expect(page.getByTestId("skill-catalog-error")).toHaveCount(0);
  // 上一条用例建的那个**仍在**——列表这次是真的读出来了，不是一片空白。
  await expect(page.getByTestId("skill-catalog-list")).toContainText(FULLSTACK_E2E.skillName);

  await expect(page.getByText(NAME)).toHaveCount(0);
});
