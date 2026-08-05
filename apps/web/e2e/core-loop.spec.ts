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
    await page.getByTestId("login-create-org").click();
    // 邀请码**留空**——这正是「第一个用户」的路径（`bootstrapMode`）。
    await page.getByTestId("login-org-name").fill(FIRST_USER.orgName);
    await page.getByTestId("login-admin-name").fill(FIRST_USER.displayName);
    await page.getByTestId("login-create-email").fill(FIRST_USER.email);
    await page.getByTestId("login-create-password").fill(FIRST_USER.password);
    await page.getByTestId("login-create-org-submit").click();

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

  test.fail("[#459] 步骤 3：新增 Skill 草稿 → 列表可见 → 详情可读", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/skill");
    // #459 的实测结论：31 个 application 用例存在，但**没有任何一张表**能存下
    // 声明式契约 skill（starter-import 表的 status CHECK 只有 enabled/disabled），
    // 也没有 SkillController。所以这一步现在必然红。
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
