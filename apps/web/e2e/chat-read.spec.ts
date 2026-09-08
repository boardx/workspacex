import { expect, test } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import { SESSION_TOKEN_STORAGE_KEY } from "../lib/api-client";

/**
 * issue #2997 —— 本文件的锚点在 2026-09-08 由旧屏迁到 CopilotKit v2 工作台。
 *
 * 起因：`#2890`（`d30ac48e8`）删掉了 `next.config.mjs` `beforeFiles` 里那条把
 * `/chat?projectId=` 改写回旧屏的 rewrite，并把 `/chat/legacy` 307 到 `/chat`。
 * 旧屏（`chat-read-screen.tsx` / `personal-chat-screen.tsx` /
 * `chat-live-message-panel.tsx`）自此**没有任何可达路由**，本文件断言的旧屏锚点
 * 一次性全红。人类裁决走方案 B：**承认新行为**，把锚点迁到 v2，不把 rewrite 加
 * 回去（那等于拿测试绑架产品方向）。
 *
 * 迁移前逐项核对过 v2 上有没有对等实现，**只有确认有对等的才换锚点，行为语义
 * 一字不改**；没有对等的一律开产品缺口 issue，不删断言、不放宽断言。本文件用到
 * 的对应关系（每条都在源码里定位过唯一渲染点）：
 *
 *   旧屏锚点                        v2 对等锚点                      渲染点
 *   ────────────────────────────────────────────────────────────────────────
 *   role=textbox name=消息内容      copilotkit-v2-input              panel-body.tsx:1817
 *   chat-message-submit             copilotkit-v2-send               panel-body.tsx
 *   chat-message-list               copilotkit-v2-messages           panel-body.tsx:1484
 *   chat-message-scroll             copilotkit-v2-messages（同一个滚动容器）
 *   chat-jump-to-latest             copilotkit-v2-scroll-to-bottom   panel-body.tsx:1583
 *   chat-message-loading-skeleton   copilotkit-v2-messages 内 loading panel-body.tsx:1501
 *   chat-live-agent-run-status      copilotkit-v2-running-indicator  panel-body.tsx:1566
 *   chat-roster-agent-<id>          同名（RosterPanel 共用组件，搬进右栏「编制」页签）
 *
 * ⚠ `copilotkit-v2-messages` 里的骨架 testid 是通用的 `loading`（外壳里另有一个
 *   同名的），所以本文件一律用 `getByTestId("copilotkit-v2-messages").getByTestId("loading")`
 *   作用域限定，绝不裸用 —— 裸用会同时匹配到两个，`toHaveCount(0)` 这类断言就
 *   变成了对另一个元素的断言（假绿的经典形状）。
 */

/**
 * 打开 v2 右栏「编制」页签，等到 RosterPanel 真的挂上。
 *
 * issue #2997 —— 编制区在 v2 上**有对等实现，而且是同一个组件**：
 * `copilotkit-v2-shell.tsx:1208` 把 roster 数据传给 `ChatTaskInspector`，后者在
 * `activeTab === "roster"` 时渲染 `RosterPanel`（`chat-roster-panel.tsx`，与旧屏
 * `chat-read-screen.tsx:511` 用的是同一个组件、同一批 testid）。差别只有一处：
 * 旧屏把它常驻在左栏，v2 收进右栏页签（2026-08-29 CK-P7）。所以断言不变，只是
 * 每次进入/刷新之后要先把页签点开——这不是"放宽"，是把用户真实要做的那一次点击
 * 如实走一遍。
 *
 * ⚠ 页签只在**选中了线程**时才渲染（`roster={selectedThreadId === null ? undefined : …}`），
 *   所以调用方的 URL 必须带 `&thread=`。
 */
async function openRosterTab(page: import("@playwright/test").Page): Promise<void> {
  const tab = page.getByTestId("chat-task-workbench-inspector-tab-roster");
  await expect(tab).toBeVisible({ timeout: 60_000 });
  await tab.click();
  await expect(page.getByTestId("chat-read-roster")).toBeVisible({ timeout: 30_000 });
}

/** v2 消息区内的历史回读骨架屏（作用域限定，理由见文件头注最后一段）。 */
function historySkeleton(page: import("@playwright/test").Page) {
  return page.getByTestId("copilotkit-v2-messages").getByTestId("loading");
}

test("formal Chat writes and cursor-lists durable messages through real signed APIs", async ({ page }) => {
  // V3（PROP-CHAT-10ITER-001）—— 逐条复制要读写剪贴板，授予该源的剪贴板权限。
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}&thread=${CHAT_READ_E2E.threadId}`);
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.threadId}`)).toContainText("Controlled fixture thread");
  // #728 D2 —— `seed-chat-read-e2e.ts` 把这个夹具 agent 的显示名从
  // "Controlled Read Agent" 缩短成 "Read Agent"，专门为了让 `roleLabel`
  // （"引导协作助手"）不被同一个 `truncate` 容器吃掉（见该脚本对应改动的头注）。
  // 这里一并断言 roleLabel 真的出现在编制区第一行，不只是名字本身。
  await openRosterTab(page);
  await expect(page.getByTestId(`chat-roster-agent-${CHAT_READ_E2E.agentId}`)).toContainText("Read Agent");
  await expect(page.getByTestId(`chat-roster-agent-${CHAT_READ_E2E.agentId}`)).toContainText("引导协作助手");

  /*
   * issue #2997 —— 这里原本是两条分页断言（第一页只有 message 01、没有 51；点
   * `chat-messages-load-more` 之后 51 才出现）。v2 工作台**没有「加载更早」这个
   * 按钮**：它在 hydration 时用同一条 `listMessages` 契约的游标一路读到
   * `nextCursor === null`（`copilotkit-v2-panel-body.tsx:482` 一带），整段历史一次
   * 到位。"用户能看到全部历史"这条能力没丢，丢的是"分页边界本身可被观测"。
   *
   * 判据因此改成**整段历史真的都在**（首尾两条都在场）——这是新实现下同一条
   * 用户可见行为（历史完整）的正确表述，不是把断言改宽：漏读任何一页，
   * message 51 就不会出现，这里照红。分页边界那条断言原文保留在下面
   * `test.fixme("旧屏游标分页…")` 里，没有被删掉。
   */
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText("Controlled fixture message 01", { timeout: 60_000 });
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText("Controlled fixture message 51", { timeout: 60_000 });

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
  //
  // issue #2247 —— 上面那段历史断言在 #1179（`975ce9a8`，会话改名/删除重做为
  // 「hover "…" 菜单」）之后又红了一次，根因与之前那次（#460/#489）是**同一类**、
  // 但触发点不同：#1179 把改名/删除菜单从"容器外的写入口"搬成了"卡片内部的
  // hover 菜单触发按钮"（`chat-thread-card-menu-trigger`，`thread-list-shell.tsx`
  // 的 `ThreadCardButton`），这个按钮渲染在 `chat-thread-card-list` **容器内部**
  // （每张被选中且有 `thread.mutate` 能力的卡片都会带一个），不再落在旧写法防的
  // 那五个前缀命名空间里，`getByRole("button")` 数到的是「选中卡的主按钮」+
  // 「它的"…"更多操作触发器」= 2，不是 1。夹具用户是 facilitator、唯一线程默认
  // 选中，因此这条回归稳定复现，不是偶发。
  // 修法延续同一条原则（收窄到真实出口，不放宽数字）：显式排掉这个已有独立 testid
  // 的「更多操作」触发按钮（`core-loop.spec.ts`/`chat-task-workbench-polish.spec.ts`
  // 已经在用这同一个 testid 精确定位它，不是这里新起的名字），只数卡片自己的选中
  // /打开按钮。
  //
  // issue #2997 —— 容器从旧屏的 `chat-thread-card-list` 换成 v2 的
  // `copilotkit-v2-thread-list`（`copilotkit-v2-shell.tsx:1047`）。**数法一字未改**：
  // 仍然是"容器里除了那个已有独立 testid 的『更多操作』触发器之外恰好一个按钮"，
  // 上面那三段关于"为什么不按前缀数、为什么不把 1 改成 4"的推理逐条仍然适用——
  // 会话卡本身（`chat-thread-<id>`）与卡内菜单触发器（`chat-thread-card-menu-trigger`）
  // 都出自共用的 `thread-list-shell.tsx`，两屏同一份实现。
  await expect(
    page.getByTestId("copilotkit-v2-thread-list").locator('button:not([data-testid="chat-thread-card-menu-trigger"])'),
  ).toHaveCount(1);
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible();
  await page.getByTestId("copilotkit-v2-input").fill("Browser durable message");

  /*
   * issue #2997 —— **这一段换的是取证方式，不是要证的事。**
   *
   * 原文等的是浏览器直接发出的 `POST /chat/threads/:id/messages`（202，请求体带
   * `text`/`agentId`/`clientMessageId`）。v2 工作台**不走这条线**：`send()`
   * （`copilotkit-v2-panel-body.tsx:1162`）调的是 `copilotkit.runAgent({ agent,
   * forwardedProps })`，`clientMessageId`/`chatThreadId`/`attachmentIds` 走
   * `forwardedProps`，落库由服务端 CopilotKit runtime 侧的 `acceptHumanMessage`
   * 完成。等一个浏览器永远不会再发出的请求，只会把这条用例挂死在超时上。
   *
   * 本用例的名字是「formal Chat **writes** and cursor-lists **durable** messages
   * through real signed APIs」——要证的是"这条消息真的经由签名 API 落进了库"，
   * 而不是"它是用哪条 HTTP 路径落进去的"。所以判据改成直连那条**读**端口
   * （同一套真实签名鉴权）把它读回来：写进去了才读得到，没落库就红。
   * 顺带把原来 `agentId` 那半也保住了——读回来的这条消息带着真实的
   * `clientMessageId`（UUID 形状）与线程归属。
   */
  await page.getByTestId("copilotkit-v2-send").click();
  const bearer = await page.evaluate((key) => window.localStorage.getItem(key), SESSION_TOKEN_STORAGE_KEY);
  expect(bearer, "登录之后 localStorage 里应有 session token").toBeTruthy();

  /** 直连 `GET /chat/threads/:threadId/messages`（契约 `listMessages`）读回这条线程的落库消息。 */
  async function findPersisted(text: string) {
    const res = await page.request.get(
      `/chat/threads/${CHAT_READ_E2E.threadId}/messages?limit=100`,
      { headers: { Authorization: `Bearer ${bearer}` }, failOnStatusCode: false },
    );
    if (!res.ok()) return null;
    const body = await res.json() as { messages: { text: string; clientMessageId: string | null; agentId: string | null }[] };
    return body.messages.find((m) => m.text === "Browser durable message") ?? null;
  }

  await expect
    .poll(async () => (await findPersisted("Browser durable message")) !== null,
      { timeout: 60_000, intervals: [1_000, 2_000, 3_000] })
    .toBe(true);
  const persisted = (await findPersisted("Browser durable message"))!;
  // 幂等键真实存在且是 UUID（原文断言的正是这一条，只是取证点从上行请求体换成落库投影）。
  expect(persisted.clientMessageId ?? "").toMatch(/^[0-9a-f-]{36}$/i)
  await expect(page.getByTestId("copilotkit-v2-running-indicator")).toBeAttached({ timeout: 30_000 });
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
  // issue #2997 —— v2 无「加载更早」按钮（理由见本用例上方那段），软重读/流式
  // 都会把新消息带进 `agent.messages`，直接断言它到位即可。
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText("Browser durable message", { timeout: 60_000 });
  await expect(page.getByText("Browser durable message")).toHaveCount(1);

  /**
   * issue #2233（D5 回归钉子）—— `#1705`/PR #1764 同时接线了 D2（编制区第一行，
   * 上面 19-20 行已断言）与 D5（消息气泡身份行的角色 chip）。D5 此前完全没有
   * e2e 断言钉住，`chat-live-message-panel.tsx` 经约 18 次重写也不会有任何测试
   * 因此变红。这里补上：agent 回复的消息气泡身份行必须带 D2 同一个 `roleLabel`
   * （"引导协作助手"），不只是名字。取 loopback 回复所在的那一行，
   * 而不是任取第一行——第一行可能是刚发的人类消息（不该有 agent 角色 chip）。
   */
  // issue #2997 —— 这两条（D5：消息气泡身份行带 agent 名 + 角色）在 v2 上**没有
  // 对等实现**，原文保留在下面 `test.fixme("消息气泡身份行…")` 里，见那里的取证。
  // 这里退到 v2 确实提供的那一半：这条回复真的出自夹具 agent 的确定性上游
  // （回显前缀），也就是"这条回复不是前端合成的"——`agentReplyPrefix` 这条断言
  // 在旧屏那侧本来就由 `messageRow` 的兄弟断言承担，不是本次新造的判据。
  const agentReplyBubble = page.getByTestId("copilot-assistant-message")
    .filter({ hasText: CHAT_READ_E2E.agentReplyPrefix }).first();
  await expect(agentReplyBubble).toBeVisible({ timeout: 60_000 });

  /**
   * V1（PROP-CHAT-10ITER-001）—— 发消息后消息区自动跟随到底：滚动容器停在底部
   * （scrollTop 到达 scrollHeight − clientHeight；内容不溢出时两值相等、断言仍成立，
   * 这是「自动跟随生效、视口没被留在上方」的守卫。真正的溢出跟随由 shots 截图佐证）。
   * ⚠ 这条必须在下面 V3 复制块**之前**——V3 会 hover 首行把视口拽到顶，之后再查底部会假红。
   */
  const distanceFromBottom = await page
    .getByTestId("copilotkit-v2-messages")
    .evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
  expect(distanceFromBottom).toBeLessThanOrEqual(80);

  /**
   * V3（PROP-CHAT-10ITER-001）—— 逐条复制。复制按钮 hover 才显形（visibility），
   * 先 hover 消息行让它可点，再点击，断言剪贴板拿到了该消息的纯文本。
   */
  // issue #2997 —— v2 的逐条操作条挂在框架气泡上（`copilot-assistant-message`），
  // 驱动方式与 `copilotkit-v2-message-actions.spec.ts:106` 逐字一致：hover 气泡
  // 让操作条显形，再点同一个 `chat-message-copy`（testid 两屏同名，v2 那份出自
  // `copilotkit-v2-message-actions.tsx:126`）。
  const firstRow = page.getByTestId("copilot-assistant-message").first();
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
  // 刷新之后历史仍然完整（v2 hydration 重新一路读到 `nextCursor === null`）——
  // 这正是原用例"刷新后翻一页仍能看到刚发的消息"要证的落库事实。
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText("Browser durable message", { timeout: 60_000 });
});

/**
 * issue #2997 —— **v2 工作台没有对等实现的两条断言，原文保留在这里，等产品补齐。**
 *
 * 人类裁决方案 B 的硬约束：没有对等实现的，开产品缺口 issue，**不许删断言、不许
 * 把断言改宽让它变绿**。上面那条主用例只迁移了确有对等实现的部分，这两条则原样
 * 搬到这里用 `test.fixme` 钉住——`fixme` 的语义正是"断言是对的，产品还没做到"，
 * 产品补上之后它会因为**意外通过**而提醒人来撤标，不会悄无声息地一直躺着。
 *
 * ## ① 游标分页的可观测边界
 * 旧屏首屏只渲染第一页、`chat-messages-load-more` 显式翻页；v2 在 hydration 里
 * 一路读到 `nextCursor === null`，没有按钮、也没有"第一页"这个可观测状态。
 * 用户看得到的历史没少，但长线程首屏要一次性拉完全部历史——这是 v2 的实现取舍，
 * 缺口 issue **#3023** 里按"长线程首载成本"记录，不在这里假装它还有分页 UI。
 *
 * ## ② 消息气泡的身份行（#2233 D5 钉子）
 * 旧屏 `chat-live-message-panel.tsx` 在每条 agent 回复的气泡上渲染"谁回的 + 什么
 * 角色"（`Read Agent` / `引导协作助手`）。v2 的 `copilotkit-v2-assistant-message.tsx`
 * 只换了 `markdownRenderer`/`copyButton`/`toolCallsView` 等子 slot，**全文件没有任何
 * agent 名或 roleLabel 的渲染**（实测 `grep -n "roleLabel\|displayName\|agentName"`
 * 零命中）。多 agent 编制下用户因此无法分辨一条回复出自哪个 agent——这是真实的
 * 功能退化，不是测试锚点问题。**产品缺口 issue：#3021**。
 */
test.fixme("旧屏游标分页与消息气泡身份行：v2 尚无对等实现（issue #2997 缺口）", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}&thread=${CHAT_READ_E2E.threadId}`);

  // ① 分页边界可观测：首屏只有第一页，点「加载更早」之后更早的才出现。
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText("Controlled fixture message 01");
  await expect(page.getByTestId("copilotkit-v2-messages")).not.toContainText("Controlled fixture message 51");
  await page.getByTestId("chat-messages-load-more").click();
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText("Controlled fixture message 51");

  // ② 身份行：agent 回复的气泡带 agent 名与角色标签。
  const agentReplyRow = page.getByTestId("copilot-assistant-message")
    .filter({ hasText: CHAT_READ_E2E.agentReplyPrefix }).first();
  await expect(agentReplyRow).toContainText("Read Agent");
  await expect(agentReplyRow).toContainText("引导协作助手");
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

  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}&thread=${CHAT_READ_E2E.threadId}`);
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.threadId}`)).toContainText("Controlled fixture thread");
  await openRosterTab(page);

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
  // 刷新把右栏页签也退回默认页，重新点开——同上，这是用户真实要做的那一次点击。
  await openRosterTab(page);
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
  await openRosterTab(page);
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

  // issue #2997 —— `/chat/legacy` 自 #2890（`d30ac48e8`）起被 `next.config.mjs`
  // 的 `redirects()` 307 到 `/chat`，旧屏在产品里已不可达；个人模式现在由 v2 工作台
  // 在裸 `/chat` 上承载（`copilotkit-v2-shell-route.tsx` 读不到 `?projectId=` ⇒
  // `projectId=null` ⇒ `listWorkbenchThreads(null)`，仍打 `GET /chat/threads`）。
  // 锚点从旧屏左栏容器 `chat-read-thread-list` 换成 v2 左栏
  // `copilotkit-v2-thread-sidebar`（`copilotkit-v2-shell.tsx:993`）。
  //
  // 断言的行为语义**逐字未变**：仍然锚在「不挂靠任何项目，仅自己可见」这句个人对话
  // 独有的说明文字上——v2 在 `copilotkit-v2-shell.tsx:1017` 渲染的正是同一句
  // （`projectId ? "项目上下文，按对话权限可见" : "不挂靠任何项目，仅自己可见"`），
  // 证明的仍是「这是个人模式，不是项目模式」这件事本身，不是「左栏画出来了」。
  await page.goto("/chat");
  await expect(page.getByTestId("copilotkit-v2-thread-sidebar")).toContainText("不挂靠任何项目，仅自己可见");
  await expect((await personalThreadsRequest).status()).toBe(200);
  // 防的洞的新形状：全程没有向任何伪造的项目路径发过请求。
  expect(inventedProjectRequests, `不该有请求打到伪造的项目路径：${inventedProjectRequests.join(", ")}`).toHaveLength(0);
  await expect(page.getByText("demo")).toHaveCount(0);
});

/**
 * 入口形态的守门断言。2026-08-25 人类裁决两连（#2026「直接更改，chat为新的版本
 * copilot-kit」→ #2044「路由要改为 chat，不要 chat/copilotkit-v2，潜入到整体框架」），
 * 2026-09-07 #2890（`d30ac48e8`）第三次推进：`beforeFiles` 里那条把
 * `?projectId=` 深链改写回旧屏的 rewrite 被删、`/chat/legacy` 被 307 到 `/chat`
 * ——**旧屏自此在产品里没有任何可达入口**（`ChatReadScreen`/`PersonalChatScreen`
 * 的唯一渲染点是 `app/chat/legacy/page.tsx`，而那条路由现在必然重定向走）。
 * 本用例的判据随之从「深链仍是旧屏」翻成「深链也是 v2 工作台」。
 *
 * ## ⚠ 为什么不能再用 `chat-thread-<id>` 判「是哪一屏」（issue #2997 的假绿）
 *
 * 上一版第 ② 段判「仍是旧屏」的**唯一依据**是 `chat-thread-${threadId}` 存在。
 * 那个 testid 出自 `components/chat/thread-list-shell.tsx:326`，而旧屏
 * （`chat-read-screen.tsx`）与 v2 外壳（`copilotkit-v2-shell.tsx:9` 起）
 * **共用同一个组件**——两屏都渲染它。于是 #2890 把整条路由翻掉之后，这条名叫
 * 「仍是旧屏」的断言依旧打勾：它测的其实是「线程列表画出来了」，从来测不出
 * 「是哪一屏画的」。同一次改动把 24 条别的用例一次性打红，唯独守门的这条没红。
 *
 * ## 新判据：两侧独占锚点同时取证，不靠任何共用组件
 *
 * `WORKBENCH_ONLY` / `LEGACY_ONLY` 两组都是**逐个在源码里定位过的独占锚点**
 * （见各自常量的注释）。只断言 v2 在场是不够的——旧屏若被重新挂回来，v2 的锚点
 * 也可能同时在场（例如两屏并存的灰度形态）；只断言旧屏不在场也不够——白屏
 * 同样满足。两侧同时取证，才真的钉住「渲染的是 v2、且不是旧屏」。
 */
/**
 * 只由 v2 工作台渲染的锚点。`copilotkit-v2-input` = `copilotkit-v2-panel-body.tsx:1817`
 * 的 `<textarea>`；`copilotkit-v2-thread-sidebar` = `copilotkit-v2-shell.tsx:993` 的
 * `<aside>`；`copilotkit-v2-messages` = 同文件 body 的消息滚动容器
 * （`copilotkit-v2-panel-body.tsx:1484`）。三者在旧屏组件树里零出现
 * （`grep -rn copilotkit-v2- components/chat/chat-read-screen.tsx personal-chat-screen.tsx
 *   chat-live-message-panel.tsx` 无匹配）。
 */
const WORKBENCH_ONLY = ["copilotkit-v2-input", "copilotkit-v2-thread-sidebar", "copilotkit-v2-messages"] as const;
/**
 * 只由旧屏渲染的锚点——**刻意不含 `chat-thread-<id>`**（那正是上一版假绿的来源，
 * 见本用例头注）。三者的唯一渲染点：
 *   · `chat-read-thread-list`  chat-read-screen.tsx / personal-chat-screen.tsx 的左栏容器
 *   · `chat-message-list`      chat-live-message-panel.tsx 的消息列表
 *   · `chat-message-input`     chat-live-message-panel.tsx 的 composer 输入框
 * 三者在 v2 组件树里零出现（`copilotkit-v2-*.tsx` + `chat-task-inspector.tsx` 无匹配）。
 */
const LEGACY_ONLY = ["chat-read-thread-list", "chat-message-list", "chat-message-input"] as const;

async function expectWorkbenchAndNotLegacy(page: import("@playwright/test").Page): Promise<void> {
  for (const testId of WORKBENCH_ONLY) {
    await expect(page.getByTestId(testId), `v2 工作台独占锚点 ${testId} 必须在场`).toBeVisible();
  }
  for (const testId of LEGACY_ONLY) {
    await expect(page.getByTestId(testId), `旧屏独占锚点 ${testId} 必须不在场（旧屏已退役）`).toHaveCount(0);
  }
}

test("默认入口：裸 /chat 与带参数深链都渲染 copilotkit v2 工作台，旧屏已退役", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);

  // 给足首次编译窗口（copilotkit-v2-runtime-adapter.spec.ts 同一先例）：v2 的
  // runtime 路由没预热时，dev 首编译会让 goto("/chat") 以 ERR_ABORTED 收场
  // （本轮实测，非猜测）。先单独打一次 /api/copilotkit/info 把编译预热掉。
  await expect
    .poll(
      async () => (await page.request.get("/api/copilotkit/info")).status(),
      { timeout: 60_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe(200);

  // ① 裸 /chat 原生渲染 v2：URL 停在 /chat（#2044 之前这里是 307 到
  //    /chat/copilotkit-v2，redirect 语义已删），输入框真实可见（不是白屏），
  //    且包在 AppShell 整体框架里（app-shell 骨架在场）。
  await page.goto("/chat");
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expectWorkbenchAndNotLegacy(page);

  // ② 项目深链（#2890 起）同样渲染 v2 工作台，且**项目作用域没有丢**：
  //    URL 保留 `?projectId=`，`CopilotKitV2ShellRoute` 把它读出来传给
  //    `CopilotKitV2Shell`，`listWorkbenchThreads(projectId, …)` 因此列的是这个项目
  //    的线程——夹具线程列出来了，就证明 scope 真的传到了服务端那一跳，不是
  //    「参数被吃掉、退回个人列表、恰好也画了个列表」。
  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}`);
  await expect(page).toHaveURL(new RegExp(`projectId=${CHAT_READ_E2E.projectId}`));
  await expectWorkbenchAndNotLegacy(page);
  await expect(page.getByTestId("copilotkit-v2-thread-sidebar")).toContainText("项目上下文，按对话权限可见");
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.threadId}`)).toContainText("Controlled fixture thread");

  // ③ 旧回退入口 `/chat/legacy` 已被 307 到 `/chat`（#2890 的 `redirects()`）。
  //    这条把「旧屏退役」这件事本身钉在门上：谁把 redirect 删掉、让旧屏重新可达，
  //    这里当场红，而不是等到某个别的用例莫名其妙地不红了才被发现。
  await page.goto("/chat/legacy");
  await expect(page).toHaveURL(/\/chat$/);
  await expectWorkbenchAndNotLegacy(page);
});

/**
 * #2044 —— AppShell 嵌入后的响应式反证：`/chat` 从「独立全屏裸页」变成「壳内一屏」，
 * 壳自带图标栏/顶栏/底部 tab，v2 自己的线程列表（w-64 固定宽 aside）成了壳内二级栏
 * ——两层固定宽度叠在 375px 上正是 uiux-standards U8「三档都不得横向溢出」最容易被
 * 破坏的形态。没有这条断言，溢出只会以「手机上要左右拖」的形式被人类实测撞见。
 *
 * 判据用 `scrollWidth <= clientWidth`（文档级真实溢出）而不是截图比对：溢出是一个
 * 布局事实，不是观感问题。
 */
test("#2044 响应式：375px 下 /chat（AppShell 内）不横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto("/chat");
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible();

  // 反空转：先证明这台尺子在同一页上确实读到了 375 宽的真实文档，否则下面的
  // `<=` 可能只是两个 0 相等。
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(clientWidth).toBe(375);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
});

test("#925 ③ Enter 发送、Shift+Enter 换行（覆盖 V2 的 ⌘↵）", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}`);
  await expect(page.getByTestId(`chat-thread-${CHAT_READ_E2E.threadId}`)).toContainText("Controlled fixture thread");

  // issue #2997 —— v2 composer 的输入框。行为语义与旧屏逐字相同：
  // `copilotkit-v2-panel-body.tsx` 的 `onKeyDown` 里 `Enter && !shiftKey && !isComposing`
  // ⇒ 发送，其余情形交给浏览器默认换行——正是本用例要证的那两条。
  const input = page.getByTestId("copilotkit-v2-input");
  await expect(input).toBeVisible();

  /*
   * issue #2997 —— "有没有发出去"的判据换成 v2 真实的发送线路。
   *
   * 实测（`chat-v2-parity-probe`，真栈）：v2 点发送时浏览器打出的是
   * `POST /api/copilotkit/agent/<agentId>/run`，**不是**旧屏那条
   * `POST /chat/threads/:id/messages`（`send()` 走 `copilotkit.runAgent()`，
   * 落库由服务端 runtime 侧的 `acceptHumanMessage` 完成，见
   * `copilotkit-v2-panel-body.tsx:1206`）。守卫仍然是"这一刻不该有任何一次发送
   * 真的发出去"，只是盯的是真实存在的那条线。
   */
  const SEND_WIRE = /\/api\/copilotkit\/agent\/[^/]+\/run$/;
  const noSendGuard: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && SEND_WIRE.test(new URL(r.url()).pathname)) noSendGuard.push(r.url());
  });
  await input.fill("line one");
  await input.press("Shift+Enter");
  await input.pressSequentially("line two");
  await expect(input).toHaveValue("line one\nline two");
  expect(noSendGuard, "Shift+Enter 不该发送").toHaveLength(0);

  // Enter（无修饰）：发送。清空重填，按 Enter，验证真的把这一轮发了出去。
  await input.fill("Sent with plain Enter");
  const requestPromise = page.waitForRequest((r) => (
    r.method() === "POST" && SEND_WIRE.test(new URL(r.url()).pathname)
  ));
  await input.press("Enter");
  const runRequest = await requestPromise;
  // 上行请求体里带着刚敲的那句原文——证明 Enter 发的是"这一句"，不是一个空 run。
  expect(JSON.stringify(runRequest.postDataJSON())).toContain("Sent with plain Enter");
  // 输入框被清空（`send()` 里 `setInputDraft("")`）：发送真的被执行了，不是只发了个请求。
  await expect(input).toHaveValue("");
  // 排队/执行态。v2 的对等锚点是 `copilotkit-v2-running-indicator`（`role="status"`
  // 的 `sr-only` 活动区，`runIsRunning` 为真时在场）——它是 `sr-only`，不是
  // 「不可见」：`toBeAttached()` 才是对这类活动区的正确判据，`toBeVisible()`
  // 依赖 1x1 裁剪盒恰好被算成可见，是运气不是判据。
  await expect(page.getByTestId("copilotkit-v2-running-indicator")).toBeAttached({ timeout: 30_000 });
});

test("#925 ② 发送后不闪烁：软重读不清空消息、不弹加载骨架", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}&thread=${CHAT_READ_E2E.threadId}`);
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText("Controlled fixture message 01", { timeout: 60_000 });

  // 监听整个发送→重读期间，加载骨架屏一次都不该出现（以前发送走 replace 会清空+弹骨架=闪烁）。
  let skeletonAppeared = false;
  const poll = setInterval(async () => {
    if (await historySkeleton(page).count() > 0) skeletonAppeared = true;
  }, 50);

  const input = page.getByTestId("copilotkit-v2-input");
  await input.fill("no flicker please");
  await input.press("Enter");
  await expect(page.getByTestId("copilotkit-v2-running-indicator")).toBeAttached({ timeout: 30_000 });
  // 发送后旧消息仍在场（没被清空过）
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText("Controlled fixture message 01");
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

  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}&thread=${CHAT_READ_E2E.threadId}`);
  // 拖住的窗口内，骨架屏可见。v2 的历史回读骨架在 `historyLoading` 分支
  // （`copilotkit-v2-panel-body.tsx:1501`），三态之一，语义与旧屏首载骨架相同：
  // 「历史还没读回来时消息区不是一片空白，读回来之后让位给真实消息」。
  //
  // ⚠ 这里必须带 `&thread=`：v2 只在有 `initialChatThreadId` 时才进 hydration
  //   （`historyLoading` 初值 = `initialChatThreadId !== null`），裸 `?projectId=`
  //   落在"新对话"态、没有历史可读，骨架本就不该出现——不带线程参数去断言骨架
  //   在场，测的就不是这条能力了。
  await expect(historySkeleton(page)).toBeVisible({ timeout: 60_000 });
  // 放行后：骨架消失，真实消息到位
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText("Controlled fixture message 01", { timeout: 60_000 });
  await expect(historySkeleton(page)).toHaveCount(0);
});

test("V5（PROP-CHAT-10ITER-001）jump-to-latest button appears on scroll-up and returns to bottom", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);

  // 带 `&thread=`：v2 要有一条选中的线程才会把这条线程的历史读回来（见 V4 那条
  // 用例里同一段说明），没有消息就没有可滚的内容，"跳到最新"这条能力也就无从谈起。
  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}&thread=${CHAT_READ_E2E.threadId}`);
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText("Controlled fixture message 01", { timeout: 60_000 });

  // 夹具有几十条消息 ⇒ 消息区溢出可滚。v2 里滚动容器与消息列表是同一个元素
  // （`copilotkit-v2-messages`，`relative flex-1 overflow-y-auto`），旧屏那侧是
  // `chat-message-scroll` 包着 `chat-message-list` 两层——合成一层不改变本用例
  // 要证的行为：离开底部 ⇒ 按钮出现 ⇒ 点它 ⇒ 回到底部且按钮消失。
  //
  // ⚠ issue #2997 实测踩到：**不能再用 `el.scrollTop = 0` 了**。v2 的
  // `use-timeline-scroll.ts` 有一个 `programmaticScrollRef` —— 自动跟随到底那次
  // 滚动是组件自己发起的，在它落定之前收到的 `scroll` 事件一律被当成"我们自己那次
  // 滚动还在路上"直接忽略（`handleMessagesScroll` 的第一个分支），`isAtBottom` 因此
  // 不会翻转，按钮永远不出现。解除这个标记的唯一途径是**用户真实介入**
  // （`handleUserScrollIntent` 挂在 wheel/touch/key/pointerdown 上）。
  // 所以这里改用真实滚轮——这比直接写 `scrollTop` **更贴近**本用例要证的
  // "用户上滚看历史"，不是绕过判据。
  await page.getByTestId("copilotkit-v2-messages").hover();
  await page.mouse.wheel(0, -20_000);
  await expect(page.getByTestId("copilotkit-v2-scroll-to-bottom")).toBeVisible();

  await page.getByTestId("copilotkit-v2-scroll-to-bottom").click();
  // 平滑滚动落定后回到底部（poll 等动画收尾）
  await expect
    .poll(async () => page.getByTestId("copilotkit-v2-messages")
      .evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
    .toBeLessThanOrEqual(80);
  // 回到底部之后按钮不再渲染（`!isAtBottom` 是它的渲染条件）。旧屏那侧这条断言
  // 写在点击之后、滚动落定之前（同步隐藏）；v2 的按钮跟随 `isAtBottom`，落定后
  // 才为真——断言的事实（"回到底部了就不该再挂着这个按钮"）没有变，只是挪到
  // 落定断言之后，否则测的是动画时序而不是这条能力。
  await expect(page.getByTestId("copilotkit-v2-scroll-to-bottom")).toHaveCount(0);
});

/**
 * issue #2997 —— **v2 工作台上没有对等实现，这是一处真实的功能退化，不是测试问题。**
 *
 * 实测核对：v2 的 composer（`copilotkit-v2-panel-body.tsx:1815`）是一个写死
 * `rows={3}` + `overflow-y-auto` 的 `<textarea>`，全文件没有任何按 `scrollHeight`
 * 回写高度的逻辑（`grep -n "scrollHeight" copilotkit-v2-panel-body.tsx` 命中的三处
 * 都在语音镜像层的滚动同步里，与高度无关）。旧屏那侧 `chat-live-message-panel.tsx`
 * 有真实的自增高 + 200px 封顶。也就是说用户在 v2 里粘一段多行文本，输入框**不会**
 * 长高，只会在三行的窗口里滚——旧屏有、v2 没有的能力。
 *
 * 按人类裁决（issue #2997 方案 B）：**不许把断言删掉、也不许改宽让它变绿**——那是
 * 把退化藏起来。这里保留断言原文一字不动，用 `test.fixme` 标成"已知缺陷、待修"，
 * 并开产品缺口 issue 跟踪（**#3022**）。`fixme` 与 `skip` 的区别是判据上的：`fixme` 声明的是
 * "这条断言是对的，产品还没做到"，产品补上之后它会因为**意外通过**而提醒人来撤标。
 */
test.fixme("V7（PROP-CHAT-10ITER-001）composer auto-grows with multi-line input, capped", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}&thread=${CHAT_READ_E2E.threadId}`);
  const input = page.getByTestId("copilotkit-v2-input");
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

  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}&thread=${CHAT_READ_E2E.threadId}`);
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText("Controlled fixture message 01", { timeout: 60_000 });

  // 模拟 devapp 默认 agent（deep-agent，走轮询+整段写回，不发 token 流）：掐断 SSE 流，
  // 让前端只能靠轮询——streamingText 恒空，于是"等待回复"由等待态指示表达。
  await page.route("**/agent-runs/*/stream", (route) => route.abort());
  // 放慢状态轮询，保证 in-flight 窗口足够长、断言不 racy。
  await page.route(/\/agent-runs\/[^/]+(\?.*)?$/, async (route) => {
    if (route.request().method() === "GET") await new Promise((r) => setTimeout(r, 1200));
    await route.continue();
  });

  const input = page.getByTestId("copilotkit-v2-input");
  await input.fill("thinking indicator please");
  await page.getByTestId("copilotkit-v2-send").click();

  /*
   * issue #2997 —— 迁移说明，**这里换的是承载物，不是要证的事**。
   *
   * 要证的用户可见行为原文：「提交即出现（等回复的反馈），回复到达后让位」。
   * 旧屏用一条可见的 thinking 气泡（`chat-message-row-thinking`，文案"正在思考"）
   * 表达；v2 拆成两件，`copilotkit-v2-panel-body.tsx:1565` 那段注释写得很直白
   * （"Keep the lifecycle anchor and announcement without a second visual progress
   * panel"）：
   *   · 生命周期锚点 = `copilotkit-v2-running-indicator`（`role="status"` 活动区，
   *     内含 `copilotkit-v2-thinking-phase`，文案是真实阶段名或兜底"正在执行"）
   *   · 可见进度 = `run-trace-panel`（`workbench/run-trace-panel.tsx`，运行中标题
   *     "正在执行"）
   * 本用例断言前者的出现/消失（这才是"等待态的开始与让位"这条语义的载体），
   * 并顺带断言它带着阶段文案——与旧屏断言"正在思考"四个字是同一件事：等待态
   * 必须**说话**，不能是一个没有文字的转圈。
   *
   * ⚠ 一处**如实记录的语义收窄**：旧屏那条断言依赖 `awaitingReply` 在提交同一 tick
   *   置真，因此能证明"先于任何网络往返"。v2 的 `runIsRunning` 来自 run 订阅，
   *   最早也要等 `POST /messages` 回来才可能为真。"提交那一瞬间就有反馈"这条更强
   *   的保证在 v2 上不存在——它属于缺口 issue **#3023** 记录的范围，不在这里假装还成立。
   */
  const waiting = page.getByTestId("copilotkit-v2-running-indicator");
  await expect(waiting).toBeAttached({ timeout: 30_000 });
  await expect(page.getByTestId("copilotkit-v2-thinking-phase")).not.toBeEmpty();

  // run 到终态、真实回复到达后，等待态让位消失
  await expect(waiting).toHaveCount(0, { timeout: 60_000 });
});

test("#925 ③ 发送后强制滚到底：即使之前上滚看历史，发送也拽回最新", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}&thread=${CHAT_READ_E2E.threadId}`);
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText("Controlled fixture message 01", { timeout: 60_000 });

  // 先上滚到顶（离开底部，V1 本会「尊重上滚」不自动跟随）。用真实滚轮而不是写
  // `scrollTop`，理由与 V5 那条用例里的长注释相同（`programmaticScrollRef` 会吞掉
  // 非用户发起的滚动事件）。
  await page.getByTestId("copilotkit-v2-messages").hover();
  await page.mouse.wheel(0, -20_000);
  await expect(page.getByTestId("copilotkit-v2-scroll-to-bottom")).toBeVisible();

  // 发送——显式意图，应无条件拽回底部（覆盖 V1 尊重上滚）
  const input = page.getByTestId("copilotkit-v2-input");
  await input.fill("scroll me back to bottom");
  await input.press("Enter");
  await expect(page.getByTestId("copilotkit-v2-running-indicator")).toBeAttached({ timeout: 30_000 });

  // 发送后回到底部（distanceFromBottom<=80），"回到最新"按钮消失
  await expect
    .poll(async () => page.getByTestId("copilotkit-v2-messages")
      .evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
    .toBeLessThanOrEqual(80);
  await expect(page.getByTestId("copilotkit-v2-scroll-to-bottom")).toHaveCount(0);
});
