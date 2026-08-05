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
 * ## 步骤 1 的前提：核心闭环必须从**空库**开始（已解决，不再是 `test.fail`）
 *
 * 「注册**第一个**用户」这件事，一旦种子脚本跑过就再也验不了 —— `credentials` 非空时
 * `isFirstUserBootstrapAvailable()` 永久返回 false。而本文件挂在
 * `playwright.fullstack-smoke.config.ts` 上，那套 `webServer` 的启动命令里**写死了**
 * `seed-fullstack-smoke.ts`，且 `webServer` 是 **config 级**而非 project 级 ——
 * 「让某个 project 不跑 seed」在那一层做不到。
 *
 * 解法不是新建 config，而是用 Playwright 的 **project `dependencies` 排顺序**：
 *
 *     seeded  ──▶  core-loop-reset  ──▶  core-loop-empty-db
 *   （吃种子的 spec，       （清库）        （只有下面带 @empty-db 的步骤 1）
 *    含本文件其余各步）
 *
 * 清库排在所有吃种子的 spec **之后**，所以 #387 / #458 / 步骤 2·5·6a 谁也不受影响。
 * 三个 project 都住在同一个 config、同一套 webServer、同一个 docker 栈、同一个 CI job 里。
 *
 * ## ⚠ 反证（#492 硬性验收，也是本仓的规矩：写完门控立刻造反证）
 *
 *     CORE_LOOP_COUNTERPROOF=1 pnpm run verify:fullstack-smoke
 *
 * 该开关让清库脚本清完之后**故意再种回一个用户**。步骤 1 必须因此变红。
 * 它若还绿，说明这条断言验的不是「第一个」，而是「恰好没人注册过」—— 从第一天起空转。
 */
import { expect, test, type Page } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";
import { EMPTY_DB_TAG, readDatabaseStat } from "./core-loop-fixture";

/** 步骤 1 注册出来的那一位。带时间戳没有意义：库是空的，它必须是**唯一**一个。 */
const FIRST_USER = {
  orgName: "闭环验收组织",
  displayName: "闭环管理员",
  email: "core-loop-first@example.test",
  password: "CoreLoop-first-492!",
} as const;

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

  // 标签把这一条分流到清库之后的 `core-loop-empty-db` project，本文件其余各步留在
  // 吃种子的 `seeded` project。一个文件、两个 project —— 不为一条用例新开一个 spec 文件。
  test(`${EMPTY_DB_TAG} 步骤 1：空库注册第一个用户并自动成为管理员`, async ({ page }) => {
    // ── 前提：库里**零用户**。这一步的全部意义在于「**第一个**」───────────────
    //
    // 这条断言不是装饰。少了它，本条用例在一个早有用户的库上**照样可能绿**——
    // 那时它验的是「有人能注册」，不是「第一个用户自动成为管理员」。
    // 反证见文件头：`CORE_LOOP_COUNTERPROOF=1` 会种回一个用户，这里必须红。
    const before = readDatabaseStat(FIRST_USER.email);
    expect(before.credentials, "注册前库里必须零用户，否则验的不是「第一个」").toBe(0);
    expect(before.bootstrapConsumed, "一次性 bootstrap 标记必须未被消费，否则门是关的").toBe(false);

    await page.goto("/login");
    // 「创建组织」不再是登录页上的一个内联面板，而是整页跳到 `/auth/register`
    // （`login-form.tsx` 里是 `window.location.assign`，不是 client-side 路由）。
    // 所以必须等 URL 真的落到注册页，不能点完就直接 fill——否则会在旧页上找新锚点。
    await page.getByTestId("login-create-org").click();
    await expect(page).toHaveURL(/\/auth\/register$/);

    // 邀请码 `registration-code` **留空**——这正是「第一个用户」的路径（`bootstrapMode`）。
    await page.getByTestId("registration-org-name").fill(FIRST_USER.orgName);
    await page.getByTestId("registration-display-name").fill(FIRST_USER.displayName);
    await page.getByTestId("registration-email").fill(FIRST_USER.email);
    await page.getByTestId("registration-password").fill(FIRST_USER.password);
    await page.getByTestId("registration-submit").click();

    // 「自动成为管理员」的第一半：注册完**直接就是登录态**，不必收邮件。
    // `bootstrap-first-user.ts` 直接置位 `emailVerifiedAt`，所以这一步不依赖邮件投递。
    await expect(page).toHaveURL(/\/projects$/);

    // 第二半：**库里**确实是管理员。只看 UI 会把「前端乐观渲染」也当成通过。
    //
    // 只查 `kind='organization'` 的组织：bootstrap 还会顺手建一个 personal-local 组织
    // 并把人放进去当 admin（见 `insertPersonalLocalOrg`），那条恒真，
    // 拿它当证据等于把断言写成空转。
    const after = readDatabaseStat(FIRST_USER.email);
    expect(after.credentials, "注册后全库应当**只有**这一个账号").toBe(1);
    expect(after.orgRoles, "第一个用户在正式组织里必须是 admin").toEqual(["admin"]);
    expect(after.orgNames, "而且是表单里填的那个组织，不是别处冒出来的").toEqual([FIRST_USER.orgName]);
    expect(after.bootstrapConsumed, "一次性门必须就此关闭，不许再有第二个 seed admin").toBe(true);
  });

  /* ── 步骤 2：新增 Agent（已交付，#458 / PR #478）───────────────────────── */

  test("步骤 2：管理员新增 Agent，刷新后仍在（复用 #458 已交付的写路径）", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/agent");
    // 只断言「这条路径是活的」——完整的增/停用/403 三件套由
    // `capability-mutate-smoke.spec.ts` 覆盖，这里不重复它，只证明它在闭环里可达。
    //
    // ⚠ testid 的来源，**实测得来的，不是凭印象写的**：
    //   `capability-catalog-screen.tsx:122` 渲染 ``data-testid={`${prefix}-catalog`}``，
    //   同文件 :51 有 ``const prefix = `admin-${kind}` ``，而 `agent-screen.tsx:8` 传
    //   `kind="agent"` ⇒ 真值是 `admin-agent-catalog`。
    //   它与 `capability-mutate-smoke.spec.ts:52 / :99 / :124` 用的是**同一个** testid。
    //
    // 这里原本写的是 `capability-catalog` —— 一个仓库里根本不存在的名字，于是这条
    // 「✅ 已交付」的断言从写下那天起就恒红。教训写在这儿而不是 commit message 里：
    // **断言一个 testid 存在之前，先实测它存在**；抄 spec 时连断言一起抄，别只抄登录函数。
    await expect(page.getByTestId("admin-agent-catalog")).toBeVisible();
  });

  /* ── 步骤 3：新增 Skill ───────────────────────────────────────────────── */

  // ✅ #520 交付后**翻正成真断言**。原文是 `test.fail("[#459] …")`：当时属实——31 个
  // application 用例存在，但没有任何一张表能存下声明式契约 skill，也没有 SkillController。
  // #518 补上后端（建草稿 / 列表 / 详情），#520 把 `/skill` 的默认屏接上去，这一步才真的通。
  test("步骤 3：新增 Skill 草稿 → 列表可见 → 详情可读", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/skill");
    // 与步骤 2 同一个分寸：这里只断言「这条路径是活的」——建草稿 / 刷新仍在 / 详情可读 /
    // 真实空态 / 失败信封 / 反证，六件由 `skill-create-smoke.spec.ts` 覆盖，不在这里重复。
    //
    // ⚠ testid **实测得来的，不是凭印象写的**：
    //   `components/skill/skill-catalog-live.tsx` 的 `data-testid="skill-catalog-live"`（根）
    //   与 `data-testid="skill-create-open"`（新建入口）；提交按钮 `skill-create-submit`
    //   在同文件的 `CreatePanel` 里，**只有展开面板后才存在** —— 所以要先点开。
    //   本条原文直接断言 `skill-create-submit` 可见，那在任何实现下都red：面板是收起的。
    await expect(page.getByTestId("skill-catalog-live")).toBeVisible();
    await page.getByTestId("skill-create-open").click();
    await expect(page.getByTestId("skill-create-submit")).toBeVisible();
  });

  /* ── 步骤 4：新增可视化模板 ───────────────────────────────────────────── */

  // ✅ #496 交付后**翻正成真断言**（PR #508）。原文是
  // `test.fail("[#464 契约缺口] …")`：当时属实——canvas 注册表契约的五个操作是
  // list/publish/trial/archive/restore，`publishTemplate` 读一行已存在的、不造一行，
  // 契约里根本没有「创建模板」。#496 补上 `createTemplate`（🟡 该契约面**待人类补签**），
  // 这一步才真的可交付。
  //
  // ⚠ 顺带修掉原文里的**第二个**红因：它断言 `/admin/canvasadmin` 上有一个
  //   `canvas-template-create` —— 那个 testid **在任何组件里都不存在**
  //   （`grep -rn canvas-template-create apps/web/{components,app,lib,e2e}` 只命中这一行；
  //   正样本 `tpladmin-create` 同法命中真实组件），与本文件步骤 2 那段 `capability-catalog`
  //   教训**同型**。只补契约不修它，这一步会继续红，而且是**红错原因**。
  //
  // 真实入口在**模板库屏**而不是后台屏，这是 #496 的刻意取舍：后台
  // `/admin/canvasadmin` 只做清单与去向，两处各放一个新建按钮 = 两个写入口。
  // testid 来源实测：`components/canvas/template-admin.tsx` 的 `tpladmin-create`
  // 与 `tpladmin-row-<key>-<version>`，与 `canvas-template-create-smoke.spec.ts` 同一批。
  test("步骤 4：新增 canvas 模板 → 刷新仍在（#496 / PR #508 交付）", async ({ page }) => {
    // ⚠ key 与 `canvas-template-create-smoke.spec.ts` 用的**不同**：同 project 同一个库，
    //   撞 key 会拿到 409 TEMPLATE_KEY_CONFLICT，这一步就红在一个与闭环无关的原因上。
    const key = "core-loop-492-tpl";
    const name = "闭环验收模板";

    await loginAsAdmin(page);
    await page.goto("/canvas?screen=template-admin");
    await expect(page.getByTestId("tpladmin-root")).toBeVisible();

    await page.getByTestId("tpladmin-create").click();
    await page.getByTestId("tpladmin-create-key").fill(key);
    await page.getByTestId("tpladmin-create-name").fill(name);
    await page.getByTestId("tpladmin-create-submit").click();

    await expect(page.getByTestId(`tpladmin-row-${key}-1`)).toContainText(name);

    // 「刷新仍在」才是这一步的全部意义：重新加载页面区分「写进了库」与「写进了 React state」。
    await page.reload();
    await expect(page.getByTestId(`tpladmin-row-${key}-1`)).toContainText(name);
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
    //
    // ⚠ 断言**限定在会话列表里**，不是 `page.getByText(title)` 满页找。
    //   满页找的写法实测撞 strict mode：新建成功后标题同时出现在列表项
    //   （`chat-thread-<id>`）与详情页的 `<h1>` 上，两个命中直接判失败——
    //   会话明明建出来了，报出来却像是没建成。
    //   收窄到列表**更严**，不是放宽：闭环真正要的就是「它在那份持久化的列表里」。
    const threadList = page.getByTestId("chat-read-thread-list");
    await expect(threadList.getByText(title)).toBeVisible();
    await page.reload();
    await expect(threadList.getByText(title)).toBeVisible();
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
