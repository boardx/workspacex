import { expect, test } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";

test("formal Chat writes and cursor-lists durable messages through real signed APIs", async ({ page }) => {
  // V3（PROP-CHAT-10ITER-001）—— 逐条复制要读写剪贴板，授予该源的剪贴板权限。
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}`);
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.threadId}`)).toContainText("Controlled fixture thread");
  // #728 D2 —— `seed-chat-read-e2e.ts` 把这个夹具 agent 的显示名从
  // "Controlled Read Agent" 缩短成 "Read Agent"，专门为了让 `roleLabel`
  // （"引导协作助手"）不被同一个 `truncate` 容器吃掉（见该脚本对应改动的头注）。
  // 这里一并断言 roleLabel 真的出现在编制区第一行，不只是名字本身。
  await expect(page.getByTestId(`chat-roster-agent-${CHAT_READ_E2E.agentId}`)).toContainText("Read Agent");
  await expect(page.getByTestId(`chat-roster-agent-${CHAT_READ_E2E.agentId}`)).toContainText("引导协作助手");
  await expect(page.getByTestId("chat-message-list")).toContainText("Controlled fixture message 01");
  await expect(page.getByTestId("chat-message-list")).not.toContainText("Controlled fixture message 51");

  await page.getByTestId("chat-messages-load-more").click();
  await expect(page.getByTestId("chat-message-list")).toContainText("Controlled fixture message 51");

  // 数的是**会话卡**，不是容器里所有 button。
  //
  // 这条原本写作 `getByTestId("chat-read-thread-list").getByRole("button")`，
  // 数的是整个左栏容器里的按钮数。#460 把「新建 / 改名 / 删除」三个写入口放进了
  // 同一个容器（`chat-read-screen.tsx` 的 `ThreadActions`，渲染依据是服务端下发的
  // `thread.mutate`），#489 又让这份能力在零会话时也能拿到 ⇒ 该断言从 1 变成 4，
  // **在 main 上红着**。这是 #460/#489 的回归，由 coord-chat-e2e 引入、在此收口。
  //
  // 修法是**收窄到真实出口**，不是放宽数字：这条断言的本意一直是「夹具里只有一条
  // 会话，列表就只列一条」，而会话卡有自己的 testid（`chat-thread-${card.id}`，
  // 见 `apps/web/components/chat/chat-read-screen.tsx:364`）。按前缀数会话卡，
  // 写入口按钮再增减都不会误伤它，而「多列出一条会话」仍然会红。
  //
  // ⚠ 不要改回按整个左栏计数，也不要把 1 改成 4 —— 后者是把断言绑死在
  // 「当前恰好有三个写入口」上，下一个人加一个按钮它又红，而它本来就不该管这件事。
  // ⚠ 也不要用 `data-testid^="chat-thread-"` 前缀：写入口的 testid
  // （`chat-thread-actions` / `-create` / `-rename` / `-delete`）与会话卡
  // `chat-thread-${card.id}` **共用同一前缀**，前缀匹配数出来是 5 不是 1。
  // （这一步我先写错过一次，实测 `Received: 5` 才发现是自己起的名撞了命名空间。）
  await expect(page.getByTestId("chat-thread-card-list").getByRole("button")).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "消息内容" })).toBeVisible();
  await page.getByRole("textbox", { name: "消息内容" }).fill("Browser durable message");

  const requestPromise = page.waitForRequest((request) => (
    request.method() === "POST" && request.url().endsWith(`/chat/threads/${CHAT_READ_E2E.threadId}/messages`)
  ));
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === "POST" && response.url().endsWith(`/chat/threads/${CHAT_READ_E2E.threadId}/messages`)
  ));
  await page.getByTestId("chat-message-submit").click();
  const [request, response] = await Promise.all([requestPromise, responsePromise]);
  expect(response.status()).toBe(202);
  expect(request.postDataJSON()).toMatchObject({
    text: "Browser durable message",
    agentId: CHAT_READ_E2E.agentId,
  });
  expect(request.postDataJSON().clientMessageId).toMatch(/^[0-9a-f-]{36}$/i);
  await expect(page.getByTestId("chat-live-agent-run-status")).toBeVisible(); // 排队态：chat-message-queued 已删（同屏与此重复），2026-08-19 #1589
  /**
   * issue #728 D 组 round 3 独评发现的 H3 阻塞回归——**反证结论：不是 nextCursor 的 bug**。
   *
   * round 3 的假设是「软重读（发送后触发）无条件覆盖 `nextCursor`，一旦软重读追新时
   * 恰好 `hasMore=false`，按钮就会永久消失，哪怕真的还有更早历史没加载」。这条假设
   * 本反证测试实测**不成立**：真实跑一遍（SHA 与本 PR 基线一致，`5e34e093`，即 PR #1786
   * 已合入之后）发现，`chat-messages-load-more` 在这一步之前就已经真的不存在了——
   * 但**不是因为漏加载了什么**：120s 超时快照（`error-context.md`）里
   * "Browser durable message"（刚发的消息）与它的助手回复 `[loopback] Controlled
   * fixture message 01` **都已经在 DOM 里可见**。也就是说触发这次断言之前，
   * `submit()`（`chat-live-message-panel.tsx:763`）里那次 `loadPage(catchUpCursorRef.
   * current, "soft")` 已经把这条新消息真实拉回来并渲染了——`nextCursor` 之所以是
   * `null`，是因为在这之前（本文件 19 行）已经点过一次「加载更早之后的消息」，
   * 那次点击已经把全部 51 条夹具消息 + 这条新发消息一次性追到底（`hasMore` 服务端
   * 如实回答"没有更多了"）。按钮消失是**正确行为**，不是数据丢失——原因见
   * `message-roundtrip.ts:211` 的游标分页不变量：`after=X` 的响应必然把 X 之后到
   * 当前真实末尾之间的全部内容按顺序返回（不会跳过任何一条），`hasMore=false`
   * 就代表真的没有更多，不存在"看起来没有、其实还有一段没追到"的中间态。
   *
   * 真正的 bug 在**这条测试自己**：它继承了 H3 修复前的旧假设（软重读不会自动追新，
   * 手动点按钮才能看到刚发的消息），在按钮已经因为真正追到底而合法消失之后，仍然
   * 无条件 `.click()` 一个不会再出现的元素，白等 120s 预算耗尽。修法对齐
   * `chat-diagram-save-reopen-roundtrip.spec.ts` 的 `loadAllMessagePages` 同一个道理——
   * 按钮不在就不点，因为软重读已经把内容追回来了，不需要再手动翻一页。
   */
  if (await page.getByTestId("chat-messages-load-more").count() > 0) {
    await page.getByTestId("chat-messages-load-more").click();
  }
  await expect(page.getByTestId("chat-message-list")).toContainText("Browser durable message");
  await expect(page.getByText("Browser durable message")).toHaveCount(1);

  /**
   * V1（PROP-CHAT-10ITER-001）—— 发消息后消息区自动跟随到底：滚动容器停在底部
   * （scrollTop 到达 scrollHeight − clientHeight；内容不溢出时两值相等、断言仍成立，
   * 这是「自动跟随生效、视口没被留在上方」的守卫。真正的溢出跟随由 shots 截图佐证）。
   * ⚠ 这条必须在下面 V3 复制块**之前**——V3 会 hover 首行把视口拽到顶，之后再查底部会假红。
   */
  const distanceFromBottom = await page
    .getByTestId("chat-message-scroll")
    .evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
  expect(distanceFromBottom).toBeLessThanOrEqual(80);

  /**
   * V3（PROP-CHAT-10ITER-001）—— 逐条复制。复制按钮 hover 才显形（visibility），
   * 先 hover 消息行让它可点，再点击，断言剪贴板拿到了该消息的纯文本。
   */
  const firstRow = page.getByTestId("chat-message-row").first();
  await firstRow.hover();
  await firstRow.getByTestId("chat-message-copy").click();
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboardText.length).toBeGreaterThan(0);

  /**
   * #728 round 16 P10 —— 「落地为产物」按钮改为按服务端下发的 `artifact.land`
   * 能力渲染（个人线程恒无该能力 ⇒ 不渲染，见 chat-main-shots.spec.ts 的
   * count=0 断言）。这条是另一半反证：夹具用户是 facilitator（写角色，
   * `capabilitiesFor` 含 `artifact.land`），项目线程里按钮必须**还在**——
   * 把「按能力渲染」写歪成「一律不渲染」时，这里当场红。
   */
  await expect(page.locator('[data-testid^="chat-land-artifact-open-"]').first()).toBeVisible();
  // 2026-08-14：常驻免责声明式提示已整个删除（人类实测反馈是多余噪音）——
  // 不再有对应断言，本用例其余断言已完整覆盖"落地为产物"按钮按能力渲染这条真正要证的事。

  await page.reload();
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.threadId}`)).toContainText("Controlled fixture thread");
  await page.getByTestId("chat-messages-load-more").click();
  await expect(page.getByTestId("chat-message-list")).toContainText("Browser durable message");
});

/**
 * #467（roster 半边）—— 在会话里**加一个 agent**，**刷新后它还在**；再移出，刷新后没了。
 *
 * ## 「刷新后仍在」是这条用例唯一的重点
 *
 * 不刷新的话，`useState` 里的一个数组就能让界面看起来是对的。**刷新**把
 * React state 全部丢掉，页面重新走 login session → `GET /chat/threads/:id/agents`
 * → `PgChatRepository` → `chat_thread_agents`。只有真的写进了库才活得过这一下。
 *
 * ## data-testid 出处（写进断言前逐个在源码里定位过）
 *   · `chat-roster-add-input`            components/chat/chat-read-screen.tsx:644
 *   · `chat-roster-add-submit`           components/chat/chat-read-screen.tsx:651
 *   · `chat-roster-agent-${id}`          components/chat/chat-read-screen.tsx:670
 *   · `chat-roster-remove-${id}`         components/chat/chat-read-screen.tsx:682
 *   · `chat-thread-${id}`                components/chat/chat-read-screen.tsx:425
 *   · `login-email` / `login-password` / `login-submit`   components/entry/login-form.tsx:272 一带
 *
 * ## ⚠ 范围诚实
 *
 * 本用例证明的是**编制关系落库**，**不是**「agent 真的执行并产生回复」（那是 #414 + #413）。
 * 加进编制的 agent 不会因此就能跑。
 */
test("#467/#513 roster mount survives a reload, and the post-reload edit now succeeds", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}`);
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.threadId}`)).toContainText("Controlled fixture thread");

  // 前提：目录里那个 agent 现在**不在**编制里。没有这条，下面的断言可能一开始就是真的。
  await expect(page.getByTestId(`chat-roster-agent-${CHAT_READ_E2E.agentId}`)).toBeVisible();
  await expect(page.getByTestId(`chat-roster-agent-${CHAT_READ_E2E.catalogOnlyAgentId}`)).toHaveCount(0);

  // ── 加入 ──────────────────────────────────────────────────────────────────
  const addResponse = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && response.url().includes(`/chat/threads/${CHAT_READ_E2E.threadId}/agents`)
  ));
  // #728 D2：加入 agent 的输入框现在收在编制栏头的「编辑」后面（照原型：编制区常态只
  // 显示谁在场，编辑是显式动作）。此前它常驻，等于永远挂着一个裸 agent id 输入框 ——
  // 正是 #594 人类要求消灭的形态。
  // ⚠ 断言一条没放宽：没有写权时「编辑」按钮本身不渲染，下面这行会如实红。
  // #619 叠加：点开之后那个字段是**选择器**（选自组织 agent 目录），所以是 selectOption
  // 而不是 fill —— 两件事都要成立：藏在编辑动作后面 ∧ 不是裸文本框。
  await page.getByTestId("chat-roster-edit").click();
  await page.getByTestId("chat-roster-add-input").selectOption(CHAT_READ_E2E.catalogOnlyAgentId);
  await page.getByTestId("chat-roster-add-submit").click();
  expect((await addResponse).status()).toBe(200);
  await expect(page.getByTestId(`chat-roster-agent-${CHAT_READ_E2E.catalogOnlyAgentId}`)).toBeVisible();

  // ⚠ 关键一步：刷新丢掉全部前端状态，再读一次服务端。
  await page.reload();
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.threadId}`)).toContainText("Controlled fixture thread");
  await expect(page.getByTestId(`chat-roster-agent-${CHAT_READ_E2E.catalogOnlyAgentId}`)).toBeVisible();

  // 原本就在编制里的那个没被误伤。
  await expect(page.getByTestId(`chat-roster-agent-${CHAT_READ_E2E.agentId}`)).toBeVisible();

  /* ── ✅ #513：这里曾经是一颗钉住契约缺口的 `toBe(409)`，现在翻正了 ──────────
   *
   * **PR #510 当时的现状**：刷新之后再改编制必定 409。原因不是实现偷懒——
   * `expectedRosterVersion` 是必填的乐观锁，而当时**没有任何读端口下发
   * `rosterVersion`**（它只在 `updateAgentRoster.out` 里）。⇒ 刷新丢掉前端状态之后
   * 客户端无从得知版本号。#510 没有发明字段、没有静默重试、没有猜 +1，而是把
   * 现状钉成 `toBe(409)`，并写明「有人补上读侧版本号之后这条会变红，那正是提醒
   * 更新它的时刻」。
   *
   * **那一刻就是 #513。** `getAgentPanel.out` 现在下发 `rosterVersion`
   * （🟡 该契约面**待人类补签**，见 `packages/contracts/src/chat.ts` 里
   * `getAgentPanel` 的文件头；**没有任何 `design-signoff.md` 被改动**），前端从那份
   * 响应里取版本号 ⇒ **上面那次 `page.reload()` 之后的这次「移出」现在应当成功**。
   *
   * ⚠ 这条断言的价值全在它**跨过了一次 `page.reload()`**：不刷新的话，写端口自己的
   *   回声就够用了，#513 修的那段路根本不会被走到。
   *
   * ⛔ 「读不到就传 0」不是修法：那等于把乐观锁摘了。真并发冲突仍然回 409
   *   ——那条由 `apps/api/tests/chat/agent-roster-version-read.test.ts` 的
   *   「乐观锁没被摘掉」守着。 */
  const removeResponse = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && response.url().includes(`/chat/threads/${CHAT_READ_E2E.threadId}/agents`)
  ));
  await page.getByTestId(`chat-roster-remove-${CHAT_READ_E2E.catalogOnlyAgentId}`).click();
  expect(
    (await removeResponse).status(),
    "#513 补上读侧 rosterVersion 后，跨页面加载的编制变更从 409 变为成功",
  ).toBe(200);
  await expect(page.getByTestId("chat-roster-mutate-error")).toHaveCount(0);
  // 真的移出了，并且**再刷新一次**它还是不在——落库了，不是界面上抹掉一行。
  await expect(page.getByTestId(`chat-roster-agent-${CHAT_READ_E2E.catalogOnlyAgentId}`)).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.threadId}`)).toContainText("Controlled fixture thread");
  await expect(page.getByTestId(`chat-roster-agent-${CHAT_READ_E2E.catalogOnlyAgentId}`)).toHaveCount(0);
  // 原本就在编制里的那个仍然没被误伤。
  await expect(page.getByTestId(`chat-roster-agent-${CHAT_READ_E2E.agentId}`)).toBeVisible();
});

/**
 * 🔴 #594（人类本人直接推翻此前裁决，方案 A）：无 `projectId` 时**不再拒绝**——
 * 走个人对话模式。这条用例原名"refuses to invent a project context"，原判据是
 * "请先选择项目"的拦截空态。**判据反过来了，防的洞没变**：原来防的是"读端口没有
 * 真实上下文时界面编一个项目出来"（mock 数据或悄悄挑一个真实项目装作用户选了它）；
 * 现在防的是**同一个洞的新形状**——无 `projectId` 时**不得**悄悄向任何
 * `/chat/projects/<任意 id>/threads` 发请求（那会是"编了一个项目"的铁证，
 * 字符串匹配挡不住这类洞，网络断言才挡得住，同 #602 那次分析的思路）。
 *
 * 正样本：个人模式确实调用了它自己的端口 `/chat/threads`（无 `:projectId` 段）。
 */
test("formal Chat with no projectId goes personal, never invents a project context", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);

  const personalThreadsRequest = page.waitForResponse((response) => (
    response.request().method() === "GET" && /\/chat\/threads(\?|$)/.test(response.url())
  ));
  const inventedProjectRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/chat\/projects\/[^/]+\/threads/.test(request.url())) inventedProjectRequests.push(request.url());
  });

  await page.goto("/chat/legacy");
  // 不再是"请先选择项目"的拦截空态——个人模式的左栏可见。
  // #728：栏头文案从「我的对话」改成「对话」（与项目对话共用同一个 `ThreadListHeader`，
  // 人类裁决：个人对话复用项目对话的壳，不许存在第二套视觉实现）。断言改锚在
  // 「不挂靠任何项目，仅自己可见」这句个人对话独有的说明文字上——它不会随共用组件
  // 的文案调整而漂移，且专门证明的是「这是个人模式，不是项目模式」这件事本身。
  await expect(page.getByTestId("chat-read-thread-list")).toContainText("不挂靠任何项目，仅自己可见");
  await expect((await personalThreadsRequest).status()).toBe(200);
  // 防的洞的新形状：全程没有向任何伪造的项目路径发过请求。
  expect(inventedProjectRequests, `不该有请求打到伪造的项目路径：${inventedProjectRequests.join(", ")}`).toHaveLength(0);
  await expect(page.getByText("demo")).toHaveCount(0);
});

/**
 * 2026-08-25 人类裁决（「直接更改，chat为新的版本copilot-kit」）：默认入口翻转的
 * 三条反证——① 裸 `/chat` 真的落在 CopilotKit v2 轨道；② 带参数的深链没有被
 * 误伤（仍是旧屏，理由见 app/chat/page.tsx 头注：v2 尚无 projectId/thread 概念，
 * redirect 深链 = 功能破坏）；③ `/chat/legacy` 回退入口真实可用（上面那条个人
 * 模式测试已从它进，这里不重复断言）。没有这条测试，redirect 被谁改掉/改错都
 * 不会有任何门变红。
 */
test("默认入口翻转：裸 /chat → copilotkit-v2；带参数深链仍是旧屏", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);

  // 给足首次编译窗口（copilotkit-v2-runtime-adapter.spec.ts 同一先例）：redirect 目标
  // 的 runtime 路由没预热时，dev 首编译会让 goto("/chat") 以 ERR_ABORTED 收场
  // （本轮实测，非猜测）。先单独打一次 /api/copilotkit/info 把编译预热掉。
  await expect
    .poll(
      async () => (await page.request.get("/api/copilotkit/info")).status(),
      { timeout: 60_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe(200);

  // ① 裸 /chat redirect 到 v2 轨道，且 v2 的输入框真实渲染（不是白屏 redirect）。
  await page.goto("/chat");
  await expect(page).toHaveURL(/\/chat\/copilotkit-v2/);
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible();

  // ② 项目深链没有被 redirect 误伤——仍是旧屏的线程列表。
  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}`);
  await expect(page).toHaveURL(new RegExp(`projectId=${CHAT_READ_E2E.projectId}`));
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.threadId}`)).toContainText("Controlled fixture thread");
});

test("#925 ③ Enter 发送、Shift+Enter 换行（覆盖 V2 的 ⌘↵）", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}`);
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.threadId}`)).toContainText("Controlled fixture thread");

  const input = page.getByRole("textbox", { name: "消息内容" });
  await expect(input).toBeVisible();

  // Shift+Enter：换行、不发送。填一行后按 Shift+Enter 再打字，断言输入框里有换行、且没触发 POST。
  const noSendGuard: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith(`/chat/threads/${CHAT_READ_E2E.threadId}/messages`)) {
      noSendGuard.push(r.url());
    }
  });
  await input.fill("line one");
  await input.press("Shift+Enter");
  await input.pressSequentially("line two");
  await expect(input).toHaveValue("line one\nline two");
  expect(noSendGuard, "Shift+Enter 不该发送").toHaveLength(0);

  // Enter（无修饰）：发送。清空重填，按 Enter，验证真的触发 POST。
  await input.fill("Sent with plain Enter");
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === "POST" &&
    response.url().endsWith(`/chat/threads/${CHAT_READ_E2E.threadId}/messages`)
  ));
  await input.press("Enter");
  const response = await responsePromise;
  expect(response.status()).toBe(202);
  expect(response.request().postDataJSON()).toMatchObject({
    text: "Sent with plain Enter",
    agentId: CHAT_READ_E2E.agentId,
  });
  await expect(page.getByTestId("chat-live-agent-run-status")).toBeVisible(); // 排队态：chat-message-queued 已删（同屏与此重复），2026-08-19 #1589
});

test("#925 ② 发送后不闪烁：软重读不清空消息、不弹加载骨架", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}`);
  await expect(page.getByTestId("chat-message-list")).toContainText("Controlled fixture message 01");

  // 监听整个发送→重读期间，加载骨架屏一次都不该出现（以前发送走 replace 会清空+弹骨架=闪烁）。
  let skeletonAppeared = false;
  const poll = setInterval(async () => {
    if (await page.getByTestId("chat-message-loading-skeleton").count() > 0) skeletonAppeared = true;
  }, 50);

  const input = page.getByRole("textbox", { name: "消息内容" });
  await input.fill("no flicker please");
  await input.press("Enter");
  await expect(page.getByTestId("chat-live-agent-run-status")).toBeVisible(); // 排队态：chat-message-queued 已删（同屏与此重复），2026-08-19 #1589
  // 发送后旧消息仍在场（没被清空过）
  await expect(page.getByTestId("chat-message-list")).toContainText("Controlled fixture message 01");
  clearInterval(poll);
  expect(skeletonAppeared, "发送后不该出现加载骨架（那是闪烁的来源）").toBe(false);
});

test("V4（PROP-CHAT-10ITER-001）loading skeleton shows while messages load, then yields to real messages", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);

  // 把消息 GET 拖住 ~2s，让首载骨架屏必然在场（否则真实上游太快、骨架一闪而过、
  // 断言会 racy）。延迟结束后放行，验证骨架被真实消息接管、不再残留。
  await page.route(`**/chat/threads/${CHAT_READ_E2E.threadId}/messages*`, async (route) => {
    if (route.request().method() === "GET") {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    await route.continue();
  });

  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}`);
  // 拖住的窗口内，骨架屏可见
  await expect(page.getByTestId("chat-message-loading-skeleton")).toBeVisible();
  // 放行后：骨架消失，真实消息到位
  await expect(page.getByTestId("chat-message-list")).toContainText("Controlled fixture message 01");
  await expect(page.getByTestId("chat-message-loading-skeleton")).toHaveCount(0);
});

test("V5（PROP-CHAT-10ITER-001）jump-to-latest button appears on scroll-up and returns to bottom", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}`);
  await expect(page.getByTestId("chat-message-list")).toContainText("Controlled fixture message 01");

  // 夹具有几十条消息 ⇒ 消息区溢出可滚。程序化把 scrollTop 置 0 会触发 scroll 事件，
  // 让「不在底部」判定成立、按钮出现。
  await page.getByTestId("chat-message-scroll").evaluate((el) => { el.scrollTop = 0; });
  await expect(page.getByTestId("chat-jump-to-latest")).toBeVisible();

  await page.getByTestId("chat-jump-to-latest").click();
  // 点击同步隐藏按钮（存在性断言，确定性）
  await expect(page.getByTestId("chat-jump-to-latest")).toHaveCount(0);
  // 平滑滚动落定后回到底部（poll 等动画收尾）
  await expect
    .poll(async () => page.getByTestId("chat-message-scroll")
      .evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
    .toBeLessThanOrEqual(80);
});

test("V7（PROP-CHAT-10ITER-001）composer auto-grows with multi-line input, capped", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}`);
  const input = page.getByRole("textbox", { name: "消息内容" });
  await expect(input).toBeVisible();

  const heightOf = () => input.evaluate((el) => (el as HTMLTextAreaElement).offsetHeight);
  await input.fill("single line");
  const singleLine = await heightOf();

  // 多行输入应把输入框撑高
  await input.fill(Array.from({ length: 12 }, (_, i) => `line ${i}`).join("\n"));
  const manyLines = await heightOf();
  expect(manyLines).toBeGreaterThan(singleLine);
  // 封顶：不超过上限（200px）+ 边框余量
  expect(manyLines).toBeLessThanOrEqual(210);
});

test("发送后 thinking 等待动画（非流式/deep-agent 情形）—— 提交即出现，回复到达后让位", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}`);
  await expect(page.getByTestId("chat-message-list")).toContainText("Controlled fixture message 01");

  // 模拟 devapp 默认 agent（deep-agent，走轮询+整段写回，不发 token 流）：掐断 SSE 流，
  // 让前端只能靠轮询——streamingText 恒空，于是"等待回复"由 thinking 动画表达。
  await page.route("**/agent-runs/*/stream", (route) => route.abort());
  // 放慢状态轮询，保证 in-flight 窗口足够长、断言不 racy。
  await page.route(/\/agent-runs\/[^/]+(\?.*)?$/, async (route) => {
    if (route.request().method() === "GET") await new Promise((r) => setTimeout(r, 1200));
    await route.continue();
  });

  const input = page.getByRole("textbox", { name: "消息内容" });
  await input.fill("thinking indicator please");
  await page.getByTestId("chat-message-submit").click();

  // 发送后立刻出现 thinking 动画（awaitingReply 在提交同一 tick 置真，先于任何网络往返）
  await expect(page.getByTestId("chat-message-row-thinking")).toBeVisible();
  await expect(page.getByTestId("chat-message-row-thinking")).toContainText("正在思考");

  // run 到终态、真实回复由 loadPage 接管后，thinking 让位消失
  await expect(page.getByTestId("chat-message-row-thinking")).toHaveCount(0, { timeout: 30_000 });
});

test("#925 ③ 发送后强制滚到底：即使之前上滚看历史，发送也拽回最新", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}`);
  await expect(page.getByTestId("chat-message-list")).toContainText("Controlled fixture message 01");

  // 先上滚到顶（离开底部，V1 本会「尊重上滚」不自动跟随）
  await page.getByTestId("chat-message-scroll").evaluate((el) => { el.scrollTop = 0; });
  await expect(page.getByTestId("chat-jump-to-latest")).toBeVisible();

  // 发送——显式意图，应无条件拽回底部（覆盖 V1 尊重上滚）
  const input = page.getByRole("textbox", { name: "消息内容" });
  await input.fill("scroll me back to bottom");
  await input.press("Enter");
  await expect(page.getByTestId("chat-live-agent-run-status")).toBeVisible(); // 排队态：chat-message-queued 已删（同屏与此重复），2026-08-19 #1589

  // 发送后回到底部（distanceFromBottom<=80），jump-to-latest 按钮消失
  await expect
    .poll(async () => page.getByTestId("chat-message-scroll")
      .evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
    .toBeLessThanOrEqual(80);
  await expect(page.getByTestId("chat-jump-to-latest")).toHaveCount(0);
});
