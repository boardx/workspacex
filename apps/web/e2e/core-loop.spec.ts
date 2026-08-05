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
import {
  EMPTY_DB_TAG, counterproofDuplicateReply, readDatabaseStat, readRunStat,
} from "./core-loop-fixture";

/** 把一个字面量安全地放进正则。前缀里有 `[` `]`，不转义会变成字符类。 */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

  test("步骤 6a：会话新建 → 刷新后仍在（#476 已交付；改名/删除见 6c）", async ({ page }) => {
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

  /* ── 步骤 6c：会话改名 → 删除 ─────────────────────────────────────────── */

  // 🔴 这一条是从上面 6a 里**分出来**的，因为 6a 的标题一直写着
  //   「新建 → **改名 → 删除**」而用例体只建、不改、不删 —— 标题在说谎。
  //
  // 这是本文件第六条同类缺陷，且是**新子类**：
  //   · 前五条是**锚点错** —— 会红，只是红得不对，至少还会红；
  //   · 这一条是**标题错** —— 它**一直是绿的**，于是「Chat 的删除路径」
  //     在人类八步里被逐字要求过（「Chat 功能，新增，**删除**，聊天」），
  //     却从未被任何断言碰过。**假绿比假红危险**，这就是为什么。
  //
  // 补上之后实跑，抓到的是一个真缺陷（#541，实测 SHA 7e22d3df）：
  //
  //   REQ  POST /chat/threads/mutate
  //   BODY {"op":"rename","threadId":"thr-a8322675-…","expectedVersion":0,…}
  //   RES  404  {"error":"not_found"}
  //
  // ⚠ 逐条排除过「是不是测试写错了」：
  //   · 不是路由缺失 —— `@Post("/chat/threads/mutate")` 在，`/chat/:path*` 也覆盖它；
  //   · **`op:"create"` 走同一个 URL、同一个方法，是通的**（上面 6a 就是证据）；
  //   · 不是前端守卫静默 return —— 请求真发出去了，`expectedVersion` 也带上了；
  //   · 不是线程不存在 —— 那个 id 是上一步刚建的，列表与详情都渲染出来了；
  //   · 不是竞态 —— 加「等 chat-thread-detail 可见」再改名，结果一模一样。
  //
  // 所以这里用 `test.fail()` 而不是把它写进 6a：缺口要**可见、有名字、
  // 修好之后会自动报 "expected to fail but passed" 逼人回来翻正**。
  test("步骤 6c：会话改名 → 删除，刷新后状态一致（#541 交付）", async ({ page }) => {
    await loginAs(page, FULLSTACK_E2E.email, FULLSTACK_E2E.password);
    await page.goto(`/chat?projectId=${FULLSTACK_E2E.projectId}`);

    const threadList = page.getByTestId("chat-read-thread-list");
    const title = `闭环改删 ${Date.now()}`;
    await page.getByTestId("chat-thread-create").click();
    await page.getByTestId("chat-thread-title-input").fill(title);
    await page.getByTestId("chat-thread-title-submit").click();

    // 改名与删除的入口都要 `hasSelection`（`chat-read-screen.tsx:494/497`），
    // 所以先点中那张卡。卡片 testid 是 `chat-thread-<id>`，id 在用例里拿不到，
    // 因此按标题在 `chat-thread-card-list` 内点 —— 那个容器**只包会话卡**，
    // 不含写入口，正是为这种定位准备的（见该组件注释）。
    const cardList = page.getByTestId("chat-thread-card-list");
    await cardList.getByText(title).click();
    await expect(page.getByTestId("chat-thread-detail")).toBeVisible();

    // ⚠ 新标题**刻意不包含原标题**。写成 `${title} 改名后` 的话，
    //   下面「旧名字消失」那条会因子串匹配恒假 —— 一个会自己骗自己的断言。
    const renamed = `闭环改名 ${Date.now()}`;
    await page.getByTestId("chat-thread-rename").click();
    await page.getByTestId("chat-thread-title-input").fill(renamed);
    await page.getByTestId("chat-thread-title-submit").click();

    await expect(cardList.getByText(renamed)).toBeVisible();
    await page.reload();
    await expect(cardList.getByText(renamed)).toBeVisible();
    // 只断言新名字出现是不够的：「新建了第二条而不是改名」的坏实现照样全绿。
    await expect(threadList.getByText(title)).toHaveCount(0);

    // ── 删除 ──────────────────────────────────────────────────────────
    await cardList.getByText(renamed).click();
    await page.getByTestId("chat-thread-delete").click();
    // 删除是可追溯动作，服务端要写审计 ⇒ 原因必填。
    // 这条守的是「删除不能无理由发生」：摘掉它，一个把 reason 改成可选的回退
    // 不会有任何测试变红。
    await expect(page.getByTestId("chat-thread-delete-submit")).toBeDisabled();
    await page.getByTestId("chat-thread-delete-reason").fill("闭环验收：走一遍删除路径");
    await page.getByTestId("chat-thread-delete-submit").click();

    // 刷新后仍然没有，才能区分「从库里删了」与「只从 React state 里删了」。
    await expect(threadList.getByText(renamed)).toHaveCount(0);
    await page.reload();
    await expect(threadList.getByText(renamed)).toHaveCount(0);
  });

  /**
   * ⚠ 这一条原本**锚在死代码上**，红了，但**红错了原因**。由 coord-chat-e2e 在 #492 写入，此处收口。
   *
   * 原文断言 `chat-composer-input`。实测该 testid **只定义在**
   * `apps/web/components/chat/composer.tsx:47`，而那条组件链**路由走不到**：
   * `composer.tsx` 的唯一引用者是 `components/chat/chat-main.tsx:11`，而 `chat-main.tsx`
   * 在 `apps/web` 里**零引用者**（`grep -rn chat-main apps` 只命中它自身的 `data-testid`
   * 与一条测试注释）。⇒ 它恒红的原因是「断言够不到那个元素」，不是「发消息没做」。
   * （`composer.tsx` 本身**不许删**：它被 `phases/phase-01-run-a-project/contracts/chat/ui.md:69`
   *   登记为已签核原型屏材料，删它是签核动作 —— #529 已正确拒绝。）
   *
   * 这不是从 import 图推断出来的，是**实测**的：临时探针在本夹具默认状态下
   * （登录 → `/chat?projectId=…` → 新建线程）同时量了两个锚点，结果
   * `chat-message-input=visible`、`chat-composer-input=0` —— 旧锚点整页零命中。
   *
   * ## 真实锚点（写进断言前逐个在源码里重新定位，并实测走得到）
   *   · `chat-message-input`        components/chat/chat-live-message-panel.tsx:316
   *   · `chat-message-submit`       components/chat/chat-live-message-panel.tsx:327
   *   · `chat-agent-select`         components/chat/chat-live-message-panel.tsx:305
   *   · `chat-roster-add-input`     components/chat/chat-read-screen.tsx:672
   *   · `chat-roster-add-submit`    components/chat/chat-read-screen.tsx:679
   *   · `chat-roster-agent-<id>`    components/chat/chat-read-screen.tsx:698
   *   活链路是 `app/chat/page.tsx` → `ChatReadScreen` → `ChatLiveMessagePanel`。
   *   编制表单在 `writable` 分支下**无条件渲染**（chat-read-screen.tsx:657-686，
   *   不在任何折叠面板里）—— 本文件此前栽过「锚点存在但默认折叠够不到」的跟头，
   *   所以这一条是单独确认过的，不是看见 testid 就写。
   *
   * ## 翻正（2026-08-05）：阻塞解除的**真正来源**是 #435，不是 #467/#546
   *
   * 上一版注释判定的红因是对的：提交键 disabled 条件是
   * `archived || submitting || text.trim() === "" || selectedAgentId === ""`
   * （`chat-live-message-panel.tsx:214`，现 :215 的 `submit()` 守卫同条件），
   * 新建线程编制为空 ⇒ `selectedAgentId === ""` ⇒ 键禁用。缺的是
   * 「新建会话里有一个可挂的 Agent」。
   *
   * 但补上这一段的**不是** skill 挂载（#467 / PR #546）—— 那条链走
   * `/threads/:id/skill-mounts`，跟 `selectedAgentId` 无关，挂满 skill 提交键照样禁用。
   * 真正补上的是 #435（PR #537）落地的**线程级编制写路径**
   * `POST /chat/threads/:threadId/agents`（packages/contracts/src/chat.ts:527），
   * 界面入口即上面那两个 `chat-roster-add-*` 锚点。步骤 8b 自 #537 起就一直在用它跑绿，
   * 也就是说 6b 的阻塞其实**在 #537 合入那天就已经解除了**，只是没人回来翻正。
   *
   * ⚠ 这里是走**界面**把 agent 加进编制，不是给夹具偷种一条 roster 行。
   *   真实用户也必须先给会话配一个 agent 才能开口，这就是那条产品路径；
   *   预种编制会让用例在「新建会话根本发不出消息」时照样绿 —— 那是假绿。
   *   夹具只种到 `org_agents` / `agents`（agent 在**组织目录**里存在），
   *   线程编制一行都不种（见 `fullstack-smoke-fixture.ts`，与 8b 同一约定）。
   *
   * ## 与步骤 8b 的分工（两条都留着，不是重复）
   *   8b 测的是 **agent 执行**：run 推进到 succeeded、库里**恰好一条**回复。
   *   6b 测的是 **human 消息本身的持久化**：POST 拿到 202、`reload()` 后正文仍在。
   *   8b 会因为 runtime 侧任何问题而红；6b 只依赖写端口 + 读端口，
   *   留着它，「消息写进库了吗」这件事才有一条不受 runtime 影响的独立断言。
   */
  test("[#462] 步骤 6b：在会话里发一条消息并刷新后仍在", async ({ page }) => {
    await loginAs(page, FULLSTACK_E2E.email, FULLSTACK_E2E.password);
    await page.goto(`/chat?projectId=${FULLSTACK_E2E.projectId}`);

    // 自己建线程，不蹭 6a 留下的那条：单独 grep 跑这一条时项目里可能一条线程都没有，
    // 蹭上一条用例的残留会让它在全量跑绿、单跑红。
    const threadList = page.getByTestId("chat-read-thread-list");
    await page.getByTestId("chat-thread-create").click();
    const title = `闭环发消息 ${Date.now()}`;
    await page.getByTestId("chat-thread-title-input").fill(title);
    await page.getByTestId("chat-thread-title-submit").click();
    await expect(threadList.getByText(title)).toBeVisible();
    await threadList.getByText(title).click();

    // ── 先钉住坏状态确实存在 ────────────────────────────────────────────────
    // 新建线程编制为空 ⇒ 提交键必须是**禁用**的。这一句不是装饰：没有它，
    // 下面那句 `toBeEnabled()` 就可能一直是真的（比如有人把 disabled 条件删了），
    // 而「加 agent」这一步是否真的起了作用就再也测不出来。
    await expect(page.getByTestId("chat-roster-empty")).toBeVisible();
    await expect(page.getByTestId("chat-message-submit")).toBeDisabled();

    // ── 走界面把 agent 加进本线程编制（真实用户路径） ───────────────────────
    await page.getByTestId("chat-roster-add-input").fill(FULLSTACK_E2E.agentId);
    await page.getByTestId("chat-roster-add-submit").click();
    await expect(page.getByTestId(`chat-roster-agent-${FULLSTACK_E2E.agentId}`)).toBeVisible();

    const text = `闭环消息 ${Date.now()}`;
    await expect(page.getByTestId("chat-message-input")).toBeVisible();
    await page.getByTestId("chat-agent-select").selectOption(FULLSTACK_E2E.agentId);
    await page.getByTestId("chat-message-input").fill(text);
    // 编制补上之后这一行才转绿——它是「阻塞已解除」这件事的断言本体。
    await expect(page.getByTestId("chat-message-submit")).toBeEnabled();

    // ⚠ 不要用 `$` 收尾：发消息的 URL 带 `?projectId=…`（同 8a 挂载踩过的坑），
    //   锚死结尾会永不匹配，表现为「等响应超时」而不是「功能没做」。
    //   契约路径 `POST /chat/threads/:threadId/messages`，packages/contracts/src/chat.ts:568。
    /* ── 反证开关：两档，各自钉死**不同**的一行 ────────────────────────────
     *
     * 一条用例「摘掉后端就变红」还不够，必须问「它是不是因为**对的原因**红的」。
     * 本条有两个独立断言，各配一档反证；实测红点落在哪一行都记在下面。
     *
     *   · `drop-write` —— 写端口坏掉（500）。红在 :426 的 `toBe(202)`：
     *       `expect(received).toBe(expected) … Received: 500`
     *     证明「202」不是摆设。但它**红得太早**，够不到刷新那一步 ⇒ 单靠它
     *     无法排除「消息只进了 React state」，所以才有下面这一档。
     *
     *   · `noop-write` —— 写端口**假装成功**：照常返回 202，但一个字节都不落库。
     *     前面所有断言（编制、提交键 enabled、202）**全部照常通过**，红点精确落在
     *     :431 刷新之后的 `toContainText`：`element(s) not found`。
     *     这才是真正考验「写进 PostgreSQL 而不是写进 React state」的那一刀 ——
     *     红在刷新**之后**，而不是刷新之前。
     */
    const counterproof = process.env.CORE_LOOP_COUNTERPROOF_6B;
    if (counterproof === "noop-write" || counterproof === "drop-write") {
      await page.route(/\/chat\/threads\/[^/]+\/messages(\?|$)/, async (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        await route.fulfill({
          status: counterproof === "noop-write" ? 202 : 500,
          contentType: "application/json",
          body: "{}",
        });
      });
    }
    const responsePromise = page.waitForResponse((response) => (
      response.request().method() === "POST" && /\/chat\/threads\/[^/]+\/messages(\?|$)/.test(response.url())
    ));
    await page.getByTestId("chat-message-submit").click();
    expect((await responsePromise).status()).toBe(202);

    // ── 刷新后仍在：唯一能区分「写进 PostgreSQL」与「写进 React state」的断言 ──
    await page.reload();
    await threadList.getByText(title).click();
    await expect(page.getByTestId("chat-message-list")).toContainText(text);
  });

  /* ── 步骤 7：实时录音在 chat 上 ───────────────────────────────────────── */

  /**
   * #466 —— 翻正。原文只断言 `chat-recording-start` 可见，那只能证明「画了一个按钮」，
   * 一个 `<button data-testid="chat-recording-start" />` 就能让它绿。
   *
   * 现在断言的是**真实往返**：
   *
   *     浏览器真实采音（`getUserMedia` + Chrome 假音频设备，**没有打桩**）
   *       → PCM16/16k/单声道
   *       → `WS /recording/sessions/:id/asr-stream`（本仓第一条流式面）
   *       → 服务端代理到已配置的 ASR 上游
   *       → 服务端调**既有** `ingestSegment` 落库
   *       → `asr.final` 回浏览器
   *       → 停止后 `GET …/segments` 重读
   *       → **刷新页面**，再 `GET` 一次，转录仍在
   *
   * ## 锚点在写断言前逐个在源码里定位过
   *   · `chat-live-recording-start` / `-stop` / `-status`  components/chat/chat-recording-panel.tsx
   *   · `chat-live-transcript`                              同上（容器）
   *   · `chat-live-transcript-partial`                      同上（中间结果，**不落库**）
   *
   * ⚠ 锚点用 `chat-live-*` 而**不是**原文那个 `chat-recording-start`：已签核的
   *   `design-deltas/realtime-asr/contract.md` §5 逐字指定了 `chat-live-recording-*`，
   *   而契约是权威。原文那个名字从未有实现引用过，改它不破坏任何东西 ——
   *   留着两套名字才是本仓点名的那个反模式。
   *
   * ## 断言的是「转录里有真实字节数」，不是「转录非空」
   *
   * 回环上游回的是 `<前缀> <它真实收到的 PCM 字节数>`。所以这条断言同时钉死了
   * **音频真的从浏览器流到了服务端**。只断 `前缀` 在的话，一个「前端自己合成一段
   * 文字」的实现照样绿；只断「有文字」的话，连桩都不用打。
   *
   * ## 反证开关：三档，各自钉死**不同**的一行（红线 2）
   *
   *   · `drop-persist` —— WS 面的落库调用整个失败（`ingestSegment` 500）。
   *     红在「转录出现」那一句：`asr.final` 永远不会发出来，因为它在落库之后才发。
   *   · `noop-persist` —— 落库**假装成功**：照常回 `asr.final`、`GET /segments`
   *     照常 200，但一行都不落库。前面每一步全部照常通过，红点精确落在
   *     **刷新之后**那一句。这才是真正考验「写进 PostgreSQL 而不是写进 React state」
   *     的那一刀（同步骤 6a `noop-write`、8a 的落法）。
   *   · `no-asr-provider` —— 上游没配置。必须红在「转录出现」之前，且界面上
   *     `chat-live-recording-error` 说出「未配置转写」——**诚实降级**，不是静默失败。
   */
  test("[#466] 步骤 7：会话内录音 → 停止 → 转录归属该会话且刷新仍在", async ({ page }) => {
    await loginAs(page, FULLSTACK_E2E.email, FULLSTACK_E2E.password);

    const counterproof = process.env.CORE_LOOP_COUNTERPROOF_7;
    if (counterproof === "drop-persist" || counterproof === "noop-persist") {
      // ⚠ 拦的是 **API 进程内部**那一条落库调用够不着的东西 —— 浏览器打不到它。
      //   所以这两档由 `WORKSPACEX_COUNTERPROOF_INGEST` 下发给 API 进程本身，
      //   见 `apps/api/src/interface/recording/segment-ingestion.ts` 的开关。
      //   这里只断言「开关确实开着」，避免有人把开关名改了而反证悄悄变成空转。
      expect(
        process.env.WORKSPACEX_COUNTERPROOF_INGEST,
        "反证必须下发给 API 进程；浏览器侧拦不住服务端内部的落库调用",
      ).toBe(counterproof);
    }

    await page.goto(`/chat?projectId=${FULLSTACK_E2E.projectId}`);
    const threadList = page.getByTestId("chat-read-thread-list");
    // 种子里那条**已完成录音授权**的线程。为什么它必须预置（而 6a/8a 的线程是现场建的），
    // 理由写在 `fullstack-smoke-fixture.ts`：契约里没有写授权格子的操作，
    // 而授权按 `source_ref_id` 存 —— 现场新建的线程 id 在种子跑的时候还不存在。
    await expect(threadList.getByText(FULLSTACK_E2E.recordingThreadTitle)).toBeVisible();
    await threadList.getByText(FULLSTACK_E2E.recordingThreadTitle).click();

    // ── 先钉住坏状态确实存在 ────────────────────────────────────────────────
    // 录之前这条线程必须**没有**转录。少了这一句，下面「转录出现了」就可能
    // 一直是真的（比如种子里塞了一条），而「录音是否真的生效」再也测不出来。
    const status = page.getByTestId("chat-live-recording-status");
    await expect(status).toHaveAttribute("data-phase", "idle");
    await expect(page.getByTestId("chat-live-transcript-empty")).toBeVisible();
    // 停止键在没开始录之前必须是**禁用**的 —— 同上，这是「开始真的起了作用」的对照组。
    await expect(page.getByTestId("chat-live-recording-stop")).toBeDisabled();

    // ── 开始录音：真实 getUserMedia + Chrome 假音频设备，没有任何打桩 ───────
    await page.getByTestId("chat-live-recording-start").click();
    await expect(status).toHaveAttribute("data-phase", "recording", { timeout: 30_000 });
    await expect(page.getByTestId("chat-live-recording-stop")).toBeEnabled();

    // 让假音频设备真的产出若干帧。`ScriptProcessor` 每 4096 采样回调一次，
    // 44.1kHz 下约 93ms —— 2 秒足够攒出上游能识别成一段的音频量。
    // ⚠ 这不是「等一等碰碰运气」：下面断言的是**上游收到的字节数 > 0**，
    //   等不够的话它会红在「转录出现」，而不是红成一条偶发的 flake。
    await page.waitForTimeout(2_000);

    await page.getByTestId("chat-live-recording-stop").click();

    if (counterproof === "no-asr-provider") {
      await expect(page.getByTestId("chat-live-recording-error"))
        .toContainText("尚未配置转写服务");
      return;
    }

    // ── 转录出现，且带着上游真实收到的 PCM 字节数 ───────────────────────────
    const transcript = page.getByTestId("chat-live-transcript");
    await expect(transcript).toContainText(FULLSTACK_E2E.asrTranscriptPrefix, { timeout: 30_000 });
    // 字节数 > 0 ⇒ 音频真的从浏览器流到了服务端。`\s0$` 会匹配「收到 0 字节」，
    // 所以这里要的是**非零**的那个形状。
    await expect(transcript).toHaveText(
      new RegExp(`${escapeRegExp(FULLSTACK_E2E.asrTranscriptPrefix)}\\s+[1-9]\\d*`),
    );
    // 中间结果（`asr.partial`）**不落库**，收尾后必须已经清掉 ——
    // 它留在界面上会让下面「刷新后仍在」有可能被一段没写库的文字满足。
    await expect(page.getByTestId("chat-live-transcript-partial")).toHaveCount(0);

    const recorded = (await transcript.textContent())?.trim() ?? "";
    expect(recorded).not.toBe("");

    // ── 刷新后仍在：唯一能区分「写进 PostgreSQL」与「写进 React state」的断言 ──
    //
    // 刷新会把整棵 React 树连同所有 state 丢掉。刷新之后界面上还有这段文字，
    // 只可能是因为 `GET /recording/sessions/:id/segments` 从 PostgreSQL 里读回来了它。
    await page.reload();
    await threadList.getByText(FULLSTACK_E2E.recordingThreadTitle).click();
    await expect(page.getByTestId("chat-live-transcript"))
      .toContainText(FULLSTACK_E2E.asrTranscriptPrefix, { timeout: 30_000 });
  });

  /* ── 步骤 8：使用 skill / 使用 agent / 使用可视化模板 ─────────────────── */

  /**
   * #467 / #509 —— 翻正。原文只断言按钮可见，那只能证明「画了一个按钮」。
   *
   * 现在断言的是**真实往返**：挂载走 `POST /threads/:id/skill-mounts`（201）、
   * 卸载走 `DELETE /threads/:id/skill-mounts/:mountId`（200），两次都对着网络响应断言，
   * 中间**刷新一次页面**——刷新后仍在，是唯一能区分「写进了 PostgreSQL」与
   * 「写进了 React state」的断言（同步骤 6a 的落法）。
   *
   * ## 锚点在写断言前逐个在源码里定位过
   *   · `chat-skill-mount`                     components/chat/chat-skill-mount-panel.tsx（开选择器）
   *   · `chat-skill-mount-option-<skillId>`    同上（池里的一项）
   *   · `chat-skill-mounted-<skillId>`         同上（已挂载的角标）
   *   · `chat-skill-unmount-<skillId>`         同上（卸载）
   *   · `chat-skill-mount-empty`               同上（真实空态）
   *
   * ⚠ 被挂的那个 skill 由夹具种成「已启用」，理由见 `fullstack-smoke-fixture.ts`：
   *   这套系统里目前不存在任何**产品路径**能把 skill 变成「已启用」（已上报）。
   *   夹具种的是前置条件，挂载/卸载本身一行都没种。
   */
  test("[#467] 步骤 8a：会话内挂载一个 skill → 生效 → 卸载", async ({ page }) => {
    await loginAs(page, FULLSTACK_E2E.email, FULLSTACK_E2E.password);
    await page.goto(`/chat?projectId=${FULLSTACK_E2E.projectId}`);

    // 自己建线程，不蹭别的用例留下的那条（单跑时项目里可能一条都没有）。
    await page.getByTestId("chat-thread-create").click();
    const title = `闭环挂 skill ${Date.now()}`;
    await page.getByTestId("chat-thread-title-input").fill(title);
    await page.getByTestId("chat-thread-title-submit").click();
    await expect(page.getByTestId("chat-read-thread-list").getByText(title)).toBeVisible();

    const skillId = FULLSTACK_E2E.mountableSkillId;
    // 新建的线程什么都没挂——先钉住这个真实空态，否则下面的「挂上了」可能一直就是真的。
    await expect(page.getByTestId("chat-skill-mount-empty")).toBeVisible();

    /* ── 挂载：POST 必须 201，且界面出现该 skill 的角标 ── */
    await expect(page.getByTestId("chat-skill-mount")).toBeEnabled();
    await page.getByTestId("chat-skill-mount").click();
    const mountResponse = page.waitForResponse((response) => (
      // ⚠ 不要用 `$` 收尾：挂载的 URL 带 `?projectId=…`（角色解析走 query，
      //   见 `skill-mount.controller.ts` 的 `requireProjectId`），锚死结尾会永不匹配。
      response.request().method() === "POST" && /\/threads\/[^/]+\/skill-mounts(\?|$)/.test(response.url())
    ));
    await page.getByTestId(`chat-skill-mount-option-${skillId}`).click();
    expect((await mountResponse).status()).toBe(201);
    await expect(page.getByTestId(`chat-skill-mounted-${skillId}`)).toBeVisible();

    /* ── 生效：刷新后仍在（区分 PostgreSQL 与 React state） ── */
    await page.reload();
    await page.getByTestId("chat-read-thread-list").getByText(title).click();
    await expect(page.getByTestId(`chat-skill-mounted-${skillId}`)).toBeVisible();

    /* ── 卸载：DELETE 必须 200，且刷新后不再出现 ── */
    const unmountResponse = page.waitForResponse((response) => (
      response.request().method() === "DELETE" && /\/threads\/[^/]+\/skill-mounts\/[^/?]+(\?|$)/.test(response.url())
    ));
    await page.getByTestId(`chat-skill-unmount-${skillId}`).click();
    expect((await unmountResponse).status()).toBe(200);
    await expect(page.getByTestId(`chat-skill-mounted-${skillId}`)).toHaveCount(0);

    await page.reload();
    await page.getByTestId("chat-read-thread-list").getByText(title).click();
    await expect(page.getByTestId("chat-skill-mount-empty")).toBeVisible();
  });

  test("步骤 8b：会话内的 agent **真的执行**并产生**恰好一条**回复（#435 交付）", async ({ page }) => {
    // ⚠ 这一步测的是**执行**，不是挂载关系。#467 交付之后
    // `capability-catalog-screen.tsx` 那句自陈「出现在目录中不代表已经具备可执行的
    // AgentRun 或 Skill 运行时」**依然成立** —— 别让一批全绿 PR 造成闭环已通的错觉。
    //
    // ## 这条断言原本锚在虚空上（#435 的起因，同型第五次）
    //
    // 原文是 `page.getByTestId("chat-agent-run-status")`。实测：那个名字在整个
    // `apps/web` 里**只出现在这一行**，也就是它在断言它自己。于是步骤 8b 从写下那天起
    // 就恒红，而且红得**不是因为对的原因** —— #414 / #413 早已合入 main，后端是通的，
    // 红的原因只是锚点不存在。前四次同型：`capability-catalog`（真名
    // `admin-agent-catalog`）· `canvas-template-create`（真名 `tpladmin-create`）·
    // `skill-create-submit`（存在但面板默认折叠）· `chat-composer-input`（只在死掉的
    // `composer.tsx` 里）。五次里有三次表现为「红着」，所以进度板看起来一直在正常工作。
    //
    // 真锚点：`components/chat/chat-live-message-panel.tsx` 的 `AgentRunStatus`，
    // testid `chat-live-agent-run-status`，跟随该组件既有的 `chat-live-*` 前缀。
    //
    // ## 为什么断言不止「status 可见」
    //
    // 「可见」太弱，会重蹈步骤 3 那种「绿了但没穿到后端」。这条走完整条链：
    //   发一条带唯一标记的消息 → run 状态**由服务端**推进到终态 → 库里**恰好一条**回复
    //   → 回复正文含该标记（证明模型真收到了它）→ 刷新后仍在（证明写进库不是写进 state）。
    // ⚠ Playwright 的**默认单条超时是 30s**，而本条要等一次真实 run 走完
    //   queued → running → writeback_pending → succeeded 外加轮询退避。
    //   实测：`expect(...).toHaveAttribute(..., { timeout: 120_000 })` 里那个 120s
    //   **不会**放宽用例总超时，用例仍在 30.2s 被判死 —— 报出来是
    //   「data-run-status 是 null」，看着像功能没做，其实只是没等到。
    test.setTimeout(180_000);
    await loginAs(page, FULLSTACK_E2E.email, FULLSTACK_E2E.password);
    await page.goto(`/chat?projectId=${FULLSTACK_E2E.projectId}`);

    // ── 一条本用例专属的线程 ───────────────────────────────────────────────
    // 不复用步骤 6a 留下的那条：两条用例共用一条线程，消息计数就会互相干扰，
    // 而那种干扰表现为间歇红，最后会被归因成「e2e 不稳」然后被人加重试掩盖过去。
    const title = `闭环 8b 会话 ${Date.now()}`;
    const threadList = page.getByTestId("chat-read-thread-list");
    await expect(page.getByTestId("chat-thread-create")).toBeVisible();
    await page.getByTestId("chat-thread-create").click();
    await page.getByTestId("chat-thread-title-input").fill(title);
    await page.getByTestId("chat-thread-title-submit").click();
    await expect(threadList.getByText(title)).toBeVisible();
    await threadList.getByText(title).click();

    // ── 把**可运行的**那个 agent 挂进本线程的编制 ─────────────────────────
    // 种子只种了 `org_agents`（可见）与 `agents`/`agent_versions`（可跑），线程级编制
    // 刻意留给这里做 —— 线程是现场建的，预种不了，而这一步顺带证明编制写路径是活的。
    await page.getByTestId("chat-roster-add-input").fill(FULLSTACK_E2E.agentId);
    await page.getByTestId("chat-roster-add-submit").click();
    await expect(page.getByTestId(`chat-roster-agent-${FULLSTACK_E2E.agentId}`)).toBeVisible();

    // ── 发一条带**唯一标记**的消息 ────────────────────────────────────────
    // 标记的作用：回复正文里必须能找到它。找不到就说明回复不是这次 run 产出的
    // （可能是上一次跑剩下的行，也可能是谁在前端合成的）。
    const marker = `CORE_LOOP_8B_${Date.now()}`;
    await page.getByTestId("chat-agent-select").selectOption(FULLSTACK_E2E.agentId);
    await page.getByTestId("chat-message-input").fill(marker);
    await page.getByTestId("chat-message-submit").click();

    // ── run 的状态由**服务端**推进到终态 ──────────────────────────────────
    const status = page.getByTestId("chat-live-agent-run-status");
    await expect(status).toBeVisible();
    // `data-run-status` 直接来自 `GET /agent-runs/:runId` 的 `status`。断言 `succeeded`
    // 而不是「非 queued」：`succeeded` 在库里被触发器保证「写回已提交」才可达
    // （`20260805150000_i413_chat_writeback.sql:74-91`），它本身就是一句关于持久化的断言。
    await expect(status).toHaveAttribute("data-run-status", "succeeded", { timeout: 120_000 });
    const runId = await status.getAttribute("data-run-id");
    expect(runId, "run status 必须带上它在讲哪一次 run").toBeTruthy();
    await expect(status).toHaveAttribute("data-result-message-id", /.+/);

    // ── 库侧终局：**恰好一条**回复 ────────────────────────────────────────
    //
    // ⚠ 这里数的是**最终条数**，不是「成功了几次」。#19 的坑：只断言成功数，
    //   一个「每次重试都追加一行」的坏实现会全绿。承载 exactly-once 的是唯一索引
    //   `chat_messages_agent_run_idx`，反证正是把它摘掉（见下方开关）。
    if (process.env.CORE_LOOP_COUNTERPROOF_8B === "1") {
      // 反证插在这里，是刻意的：上面「status 可见 / run succeeded」几条**必须先绿**，
      // 红点才会精确落在下面的 exactly-once 上。若红在更早的步骤，那就不是本反证
      // 要验的东西 —— 今天六个 agent 各抓到过一次「红得不对」。
      counterproofDuplicateReply(runId!);
    }
    const runStat = readRunStat(runId!);
    expect(runStat.runStatus, "库里的 run 也必须是 succeeded，不只是界面上是").toBe("succeeded");
    expect(runStat.runError).toBeNull();
    expect(
      runStat.assistantMessages,
      "一次 run 必须**恰好**产生一条回复：0 = 没写回，≥2 = exactly-once 破了",
    ).toBe(1);
    expect(
      runStat.assistantTexts[0],
      "回复正文必须含本次发出的标记，否则它不是这次 run 产出的",
    ).toContain(marker);
    expect(
      runStat.assistantTexts[0],
      "而且必须出自被显式选中的那个 provider，不是任何人合成的",
    ).toContain(FULLSTACK_E2E.agentReplyPrefix);
    expect(runStat.replyToMessageIds[0], "回复必须回指它所答的那条 human 消息").toBeTruthy();
    // human 一条 + agent 一条。多出来的行说明有人在写回之外又插了什么。
    expect(runStat.threadMessages, "该线程里应当只有 human 与 agent 各一条").toBe(2);

    // ── 读路径侧：刷新后仍在，且仍然只有一条 ──────────────────────────────
    // 「刷新后仍在」是唯一能区分「写进了库」与「写进了 React state」的断言。
    await page.reload();
    await threadList.getByText(title).click();
    const messageList = page.getByTestId("chat-message-list");
    await expect(messageList).toContainText(marker);
    await expect(
      messageList.getByTestId("chat-message-row").filter({ hasText: FULLSTACK_E2E.agentReplyPrefix }),
    ).toHaveCount(1);
  });

  test.fail("[#493] 步骤 8c：在项目/会话里真正**使用**一个 canvas 模板", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/canvas");
    // 54 个 open issue 里模板相关只有「能建、能看」，「能用」在 #493 之前零覆盖。
    await expect(page.getByTestId("canvas-template-apply")).toBeVisible();
  });
});
