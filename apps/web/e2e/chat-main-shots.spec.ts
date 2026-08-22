import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { CHAT_READ_E2E } from "./chat-read-fixture";

/**
 * 抓「对话主屏」的**产品侧截图**，与 `ui-preview/chat-main-ref/`（原型参照图，由
 * `scripts/shot-chat-prototype-ref.mjs` 从权威原型抓出）逐张比对，供 chat 主屏
 * 原型保真迭代使用。
 *
 * ## 为什么必须跑真栈而不是 mock
 * `/chat` 走 `AppShell` 的真实 `SessionProvider`，未登录直接 `router.replace("/login")`。
 * 拿 mock 抓出来的图和用户在 devapp 上看到的不是同一个东西 —— 本仓已经因为
 * 「评审签的和用户用的不是同一个产品」返工过一次（见 ui-preview/README.md 2026-07-30）。
 * 所以这里复用 `playwright.chat-read.config.ts` 的整栈（postgres + redis + API + web）。
 *
 * ## 这不是门控
 * 本 spec 只产出证据、不做断言判定，因此**不接** `verify:*`，由
 * `pnpm run shots:chat-main` 显式调用。它落在 `lint-spec-gate-coverage` 的
 * 豁免名单里（理由同上：它不是规格，是取证工具）。
 */

/**
 * ⚠ **不要**把它放回 `test-results/` 下面。那是 Playwright 自己的 scratch 目录，
 *   它在每次 run 开始时整个清空 —— 于是「上一轮抓的图」会在下一次跑任何 e2e 时
 *   静默消失，而评分员那边只会看到一个不存在的路径。实测踩过一次：
 *   verify:chat-read 跑完后 chat-main-live/ 三张图连目录一起没了。
 */
const OUT = resolve(process.env.CHAT_SHOTS_OUT ?? ".chat-shots");
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 375, height: 812 };
/** #728 D10 —— 三档响应式判据要求 1440/768/375 都能验证，这支脚本此前只有两档。 */
const TABLET = { width: 768, height: 1024 };

/**
 * ⚠ 取证不是门控，所以给足超时。默认 30s **不够**：这一条要冷编译 `/login`、`/chat`、
 * `/chat?projectId=…` 三条路由，而 `next/font/google` 在没有外网时对每个字体分片
 * 重试三次才放弃（构建照样成功，只是慢——实测日志里就是
 * `Failed to download 'Noto Sans SC' from Google Fonts`）。
 * 第一版用默认 30s，结果第一张抓到了、第二张就 `Test timeout of 30000ms exceeded`。
 * 这与 #733 是同一个冷启动成本，只是那边表现成登录超时。
 */
test.setTimeout(300_000);

test("capture chat main screen against the real stack", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });

  await page.setViewportSize(DESKTOP);
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/projects$/);

  /** 抓一张，并先确认屏上真有内容 —— 空图会让「已比对」变成假的。 */
  const shoot = async (file: string, testId: string) => {
    await page.getByTestId(testId).waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/${file}` });
  };

  // ⚠ 锚点用 `chat-read-thread-list`（两条路径都渲染它）。两个屏组件都**没有**根 testid，
  //   写 `chat-read-screen` / `personal-chat-screen` 会永远等不到 —— 这两个名字在源码里
  //   一次都不存在，是我第一版凭组件名猜的。
  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}`);
  await shoot("chat-main-default.png", "chat-read-thread-list");

  await page.goto("/chat");
  await shoot("chat-main-personal.png", "chat-read-thread-list");

  // 375 档锚点换成 `chat-thread-detail`：AppShell 的左栏是 `hidden md:block`
  // （app-shell.tsx:158），窄屏下线程列表**按设计不渲染**。原来锚在它上面，于是
  // 这一张永远超时 —— 那是锚错了对象，不是响应式坏了。
  await page.setViewportSize(MOBILE);
  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}`);
  await shoot("chat-main-mobile.png", "chat-thread-detail");

  /**
   * issue #728 D 组独评发现的取证覆盖缺口：整支脚本此前只对**项目对话**（带
   * `projectId`）产出上面这两张（默认桌面态 + 375 移动态），第 76 行往后所有真实
   * 交互流程——真实发消息、工具调用链、失败态、语音——全部只跑在**个人对话**路径上。
   * D6（AI 过程可见：思考 X 秒 · N 步 + 工具调用折叠块）、D7（结构化产物卡）、
   * D9（右栏「产物」+「材料」堆叠同屏）、D10（进行中状态条 + 三档响应式）这四维
   * 因此在项目对话侧从未被真实截图观测过——评分员每轮都因为「没有可评的图」卡在
   * H3，与代码是否正确无关。这里比照下面 76-280 行个人对话已验证过的手法，给
   * 项目对话补一段等价的真实交互流程。
   *
   * 走的是 `CHAT_READ_E2E.deepAgentId`（真实 `DeepAgentModelProvider` 代码路径，
   * 上游是确定性替身 `loopback-deep-agent-provider.ts`）——`seed-chat-read-e2e.ts`
   * 今天把它挂进了 `THREAD_ID`（项目对话默认线程）的编制：项目线程的
   * `chat-agent-select` 选项读的是编制本身（`GetAgentPanelOut["agents"]`），不是
   * 个人对话那条走组织能力目录的路径，只进 `capability_listings` 不进编制的话，
   * 这个 agent 在项目对话的下拉里根本不会出现。
   */
  await page.setViewportSize(DESKTOP);
  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}`);
  await page.getByTestId("chat-thread-detail").waitFor({ state: "visible", timeout: 30_000 });

  await page.getByTestId("chat-agent-select").click();
  await page.getByTestId(`chat-agent-select-option-${CHAT_READ_E2E.deepAgentId}`).click();
  await page.getByTestId("chat-message-input").fill("请帮我查一下现在几点");
  await page.getByTestId("chat-message-submit").click();

  /**
   * D10 —— 「进行中状态条」如实抓样。`chat-live-message-panel.tsx` 的 D10 挂载点
   * 注释写得很直白：输入框正上方那个位置目前挂的仍是 `ChatRecordingPanel`（会话
   * 录音面板），**不是**按原型重写出的行内「进行中」卡——那条注释原话「这是纯粹的
   * 位置改动，不是把 `ChatRecordingPanel` 重写成条件渲染」。所以这里如实抓当前
   * 真实样子（run 状态徽标 + 仍是空闲态的录音面板同屏），不假装它已经是原型要求的
   * 进行中卡。抓拍时机赶在终态之前——`chat-live-agent-run-status` 一出现就拍，
   * 不等 run 落定。
   */
  await page.getByTestId("chat-live-agent-run-status").waitFor({ state: "visible", timeout: 15_000 });
  await page.screenshot({ path: `${OUT}/chat-main-project-in-progress.png` });

  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="chat-live-agent-run-status"]');
      const status = el?.getAttribute("data-run-status");
      return status === "succeeded" || status === "failed";
    },
    { timeout: 60_000 },
  );

  // D6 —— 工具调用链折叠块：与个人对话同一套断言，收窄到刚发出的这条消息自己的
  // `chat-message-row`（每条 agent 消息各自渲染一份 `agent-tool-chain-summary`）。
  const projectLatestRow = page.locator('[data-testid="chat-message-row"]').last();
  await projectLatestRow.getByTestId("agent-tool-chain").waitFor({ state: "visible", timeout: 5_000 });
  await expect(projectLatestRow.getByTestId("agent-tool-chain-summary")).toContainText("工具");
  await shoot("chat-main-project-tool-call.png", "chat-thread-detail");
  await projectLatestRow.getByTestId("agent-tool-chain-toggle").click();
  await projectLatestRow.getByTestId("agent-tool-chain-step-0").waitFor({ state: "visible", timeout: 5_000 });

  /**
   * D7 —— 把这条 agent 回复真的落地为产物，抓下 `LandedArtifactCard` 结构化卡片
   * （标题 + AI 徽标 + 可展开），不是只断言按钮存在（`chat-read.spec.ts:119` 已经
   * 断言过按钮可见，这里走完整条落地流程，证明卡片本身长什么样）。
   */
  const projectLandOpen = projectLatestRow.locator('[data-testid^="chat-land-artifact-open-"]');
  await projectLandOpen.waitFor({ state: "visible", timeout: 10_000 });
  await projectLandOpen.click();
  const projectLandSubmit = projectLatestRow.locator('[data-testid^="chat-land-artifact-submit-"]');
  await projectLandSubmit.click();
  const projectLandDone = projectLatestRow.locator('[data-testid^="chat-land-artifact-done-"]');
  await projectLandDone.waitFor({ state: "visible", timeout: 10_000 });
  await projectLatestRow.locator('[data-testid^="chat-land-artifact-expand-"]').click();
  await shoot("chat-main-project-artifact-card.png", "chat-thread-detail");

  /**
   * D9 —— 右栏「产物」+「材料」两个堆叠区块同屏可见（issue #1758，PR #1715/#1761
   * 从 Tabs 改成纵向堆叠）。上面已经落地了一个产物，「产物」区块此刻应有真实内容；
   * 这里再走一遍「材料」头部的直传入口（`ChatSidebarUploadButton`，issue #1758
   * 裁决 C），真实上传一个文件、真实发一条消息把它带进材料列表，让两个区块
   * 同屏都有真实内容，不是一个有内容、一个还是空态。
   */
  await page.getByTestId("chat-right-panel-stack").waitFor({ state: "visible" });
  await expect(page.locator('[data-testid^="chat-artifact-"]').first()).toBeVisible({ timeout: 10_000 });

  const materialFile = {
    name: "project-shot-material.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("D9 取证素材：项目对话右栏材料区块。"),
  };
  const materialUploadInput = page.getByTestId("chat-materials-upload-input");
  if (await materialUploadInput.count() > 0) {
    await materialUploadInput.setInputFiles(materialFile);
    const materialChip = page.locator('[data-testid^="chat-attachment-chip-"]');
    await expect(materialChip).toHaveAttribute("data-status", "uploaded", { timeout: 15_000 });
    await page.getByTestId("chat-message-input").fill("D9 取证：这条消息带着刚上传的材料");
    await page.getByTestId("chat-message-submit").click();
    await expect(page.locator('[data-testid^="chat-material-"]').first()).toBeVisible({ timeout: 15_000 });
  }
  await shoot("chat-main-project-right-panel.png", "chat-thread-detail");

  /**
   * D10 三档响应式 —— 这支脚本此前只有 1440/375 两档，判据逐字要求三档都验证
   * 无横向溢出。768px 补齐中间档，且实测断言 `scrollWidth<=clientWidth`（不是只
   * 拍图靠肉眼看）。
   */
  await page.setViewportSize(TABLET);
  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}`);
  await page.getByTestId("chat-read-thread-list").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(300);
  const noHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  );
  if (!noHorizontalOverflow) {
    throw new Error("768px 视口下页面出现横向溢出——D10 三档判据要求的正是这件事不该发生");
  }
  await shoot("chat-main-project-tablet.png", "chat-read-thread-list");

  /**
   * #728 P4/P5 —— rev-uiux 第 5 轮指出的证据缺口：「创建后自动选中」与「个人对话
   * 375 档」两个状态从未被截图观测到，评分员因此判 0，**不是行为不存在，是没被看到**
   * （P4/P5 报告原话）。这里把这两个状态实际走一遍并抓下来，不是新写功能。
   */
  await page.setViewportSize(DESKTOP);
  await page.goto("/chat");
  // 2026-08-14：#1179 把个人对话「新建」改成一键创建（`personal-chat-screen.tsx`
  // 直接 `handleCreate(null)`），不再弹标题表单——旧版这里等 `chat-thread-title-input`
  // 会永远超时。创建走真实 mutateThread，成功后用 `router.replace` 把新线程 id
  // 写进 URL —— 等它落地，而不是等固定时长再赌一把。
  await page.getByTestId("chat-thread-create").click();
  await page.waitForURL(/\/chat\?thread=/);
  await shoot("chat-main-personal-created.png", "chat-thread-detail");

  const createdThreadUrl = new URL(page.url());
  const createdThreadId = createdThreadUrl.searchParams.get("thread");
  if (!createdThreadId) throw new Error("创建后 URL 里没有 thread 参数，取证脚本本身的假设已经不成立");

  /**
   * #728 P6/P7 —— 个人对话上一轮止步于「零线程空态」，评分员因此把 P6-P9 全判 0：
   * 「不是代码没写，是没有一次真实的发送-回复被观测到」。这里真的发一条消息、
   * 真的等服务端跑完，不是伪造一条已完成的假消息。
   *
   * `KERNEL_MODEL_PROVIDER` 由 `playwright.chat-read.config.ts` 接了确定性回环
   * 模型（与 `fullstack-smoke` 同一支 `scripts/loopback-model-provider.ts`），
   * run 会真的推进到终态，不会卡在 `MODEL_PROVIDER_NOT_CONFIGURED`。
   */
  await page.getByTestId("chat-agent-select").click();
  await page.getByTestId(`chat-agent-select-option-${CHAT_READ_E2E.agentId}`).click();
  const probeText = "对话保真取证：请回显这句话";
  await page.getByTestId("chat-message-input").fill(probeText);
  await page.getByTestId("chat-message-submit").click();

  /**
   * #728 P6 —— 逐字流式生成的证据。评分员判据原文：「token 是否真实逐个出现（不是
   * 等全部生成完再一次性渲染）」。`chat-live-message-panel.tsx` 的 `streamingText`
   * 早在 #654 阶段2d 就有渲染路径（`chat-message-row-streaming` testid），但此前
   * 没有一个真实 provider 会推进到这条分支——`playwright.chat-read.config.ts` 现在
   * 打开了 `KERNEL_MODEL_STREAM_ENABLED`，`loopback-model-provider.ts` 会真的把这句
   * 回显拆成多帧 SSE 发回来。这里等的是**真实 testid 可见**，不是固定时长再赌一把：
   * 等不到就说明流式没有真的发生，而不是"稍微等久一点就好了"。
   *
   * 终态判定（上面第一次 send 已验证过的 `data-run-status`）不能拿来判"生成中"这一帧
   * ——run 到终态时 `streamingText` 已经被清空（交给持久消息列表接管，见该组件
   * `openAgentRunStream` 回调里 `final`/`timeout` 分支），所以要抢在终态之前抓。
   */
  // `loopback-model-provider.ts` 回显的整段文本是已知的确定性值（前缀 + 原文），
  // 用它判定抓到的是不是"半截"——不是猜的，是这支回环脚本自己的协议。
  const fullReplyText = `${CHAT_READ_E2E.agentReplyPrefix} ${probeText}`;
  const streamingRow = page.getByTestId("chat-message-row-streaming");
  await streamingRow.waitFor({ state: "visible", timeout: 15_000 });
  // ⚠ 只读 `chat-ai-markdown`（`MarkdownMessage` 自己的 testid，见
  // `components/chat/markdown-message.tsx`）这一段——整行 `textContent` 还带着
  // "Agent" 名字标签与 `正在生成…` 状态徽标（`chat-live-message-panel.tsx` 同一个
  // `<li>` 里的兄弟节点）。第一版拿整行 `textContent` 去跟 `fullReplyText` 比长度：
  // 实测抓到的其实是真实的半截内容（"对话保真取"，回复原文 13 字里的前 5 字），
  // 但把 "Agent" + "正在生成…" 这两段标签文字也算进总长度后，`"Agent正在生成…" +
  // 半截内容` 反而比 `fullReplyText` 更长，被误判成"已经是完整回复"而拒绝——
  // 这里只取真正的回复内容，长度比较才对应得上 `loopback-model-provider.ts`
  // 自己的协议，不会被展示层的标签文字污染。
  // 2026-08-14 实测发现：这里原来选的 `.copilotkit-message-markdown` 在本仓
  // 从未存在过（`grep` 全仓零命中），选择器一直是错的——只是此前从没有一次
  // 跑到这一步真去读它（被更早的「等标题表单」步骤挡住了）。选择器错误时
  // `.textContent()` 没有自带超时，会一路等到整条测试的 300s 预算耗尽才报，
  // 表现成"卡死"而不是"选择器找不到元素"，掩盖了真正的原因。
  const midStreamText = (
    await streamingRow.getByTestId("chat-ai-markdown").textContent()
  )?.trim() ?? "";
  if (midStreamText === "") {
    throw new Error(
      "chat-message-row-streaming 可见但文本是空的——说明抓拍时机踩在了第一个 delta 落地之前，"
      + "取证脚本本身的假设不成立，不是产品行为不存在",
    );
  }
  if (midStreamText.length >= fullReplyText.length) {
    throw new Error(
      `抓到 chat-message-row-streaming 时文本已经是完整回复（"${midStreamText}"）——`
      + "说明抓拍时机踩在了最后一个 delta 之后，没有真的观测到「生成中」这一帧，"
      + "不是逐字流式行为不存在",
    );
  }
  await page.screenshot({ path: `${OUT}/chat-main-personal-streaming.png` });

  // run 状态由服务端推进，`data-run-status` 直接取自 `GET /agent-runs/:id` 的
  // 契约状态机原值——终态是 `succeeded`/`failed` 二选一，不猜测哪个先到。
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="chat-live-agent-run-status"]');
      const status = el?.getAttribute("data-run-status");
      return status === "succeeded" || status === "failed";
    },
    { timeout: 60_000 },
  );
  /**
   * #728 round 16 P10 → **2026-08-21 人类裁决反转**：个人对话现在**应该**出现
   * 「落地为产物」按钮——个人线程也真的能持久化产物，不再是一枚点了必报错的
   * 假按钮。按钮的渲染依据仍是服务端下发的 `artifact.land` 能力，只是这个能力
   * 现在对个人线程也下发了（`PERSONAL_THREAD_CAPABILITIES` 已含
   * `artifact.land`，见 `thread-visibility.ts`）。此刻屏上已有用户消息 + agent
   * 回复共两条，每条消息下都应该有这枚按钮——若渲染依据又漂移回「个人线程
   * 恒不给」，这里数出来会是 0，当场红。
   * 项目侧「写角色看得见这枚按钮」的另一半反证在 chat-read.spec.ts。
   *
   * issue #728 D 组 round 4 独评发现这里实测只数到 1（不是产品回归——分诊见
   * issue #1816）：真根因是上面这行的旧写法 `expect(await locator.count())
   * .toBeGreaterThanOrEqual(2)` 只读一次快照，不像 Playwright 的 web-first
   * 断言那样重试。断言语义本身没有过期：`chat-live-message-panel.tsx` 的
   * `MessageLandingControls` 不区分 `isAgent`，用户消息和 agent 回复都会渲染
   * 这枚按钮，1 条用户消息 + 1 条 agent 回复稳定应有 2 个——只是上面
   * `waitForFunction` 只等了 `data-run-status` 到终态，没有等 agent 回复那次
   * `loadPage(..., "soft")` 异步重读真的把第二条消息渲染进 DOM，`.count()`
   * 抢跑在只有第一个（用户自己那条）按钮落地的那一刻。改用 `toHaveCount`（会
   * 重试到 Playwright expect 超时）而不是放宽这个数字。
   */
  await expect(page.locator('[data-testid^="chat-land-artifact-open-"]')).toHaveCount(2);

  await shoot("chat-main-personal-reply.png", "chat-thread-detail");

  /**
   * #728 P6/P7 —— 上一条走的 loopback 回显 provider 天然不会规划、不会调工具（回显
   * agent 结构上不可能产生这些）。评分员多轮指出 P6（流式）/P7（计划+工具调用可见）
   * 卡住的根因是取证只跑过一条最顺的路径。这里换到走真实 `DeepAgentModelProvider`
   * 代码路径的第二个 agent（上游是确定性替身 `loopback-deep-agent-provider.ts`，
   * 不是凭空造的 UI），同一个线程里再发一条消息，抓下计划句 + 工具调用步骤。
   */
  await page.getByTestId("chat-agent-select").click();
  await page.getByTestId(`chat-agent-select-option-${CHAT_READ_E2E.deepAgentId}`).click();
  await page.getByTestId("chat-message-input").fill("请帮我查一下现在几点");
  await page.getByTestId("chat-message-submit").click();
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="chat-live-agent-run-status"]');
      const status = el?.getAttribute("data-run-status");
      return status === "succeeded" || status === "failed";
    },
    { timeout: 60_000 },
  );
  // TOOLCHAIN-01（人类裁决方案 A）—— 工具调用链改 Claude-Code 风**默认收起**一行摘要
  // （`思考了 X 秒 · 调用了 N 个工具`），不再默认铺一大块。收起态即拍，正是这次改的默认 UX。
  //
  // #1117 折叠式改造后，页面上此前已发的 loopback 回显消息与这条真实工具调用消息
  // 都会各自渲染一份 `agent-tool-chain-summary`（每条 agent 消息自带一份工具链，
  // 不是单例），全局 `getByTestId` 命中两个、strict mode 直接报错。这里改成先取
  // 到刚发出的这条消息自己的 `chat-message-row`（最新一条），再在它的作用域内找
  // 工具链摘要——同样是真实断言，只是把选择器收窄到具体消息容器，不再依赖"页面上
  // 只有一份"这个已经不成立的假设。
  const latestMessageRow = page.locator('[data-testid="chat-message-row"]').last();
  await latestMessageRow.getByTestId("agent-tool-chain").waitFor({ state: "visible", timeout: 5_000 });
  await expect(latestMessageRow.getByTestId("agent-tool-chain-summary")).toContainText("工具");
  await shoot("chat-main-personal-tool-call.png", "chat-thread-detail");
  // 点开摘要，证明细节一键可达、逐条真实 step 仍在（信息不丢，只是默认折起）。
  await latestMessageRow.getByTestId("agent-tool-chain-toggle").click();
  await latestMessageRow.getByTestId("agent-tool-chain-step-0").waitFor({ state: "visible", timeout: 5_000 });

  /**
   * #728 P8 —— 语音实时转录取证。评分员第 12 轮指出：判据第 5 项逐字要求「转录
   * 过程中用户能看到实时文字更新（不是录完一段才整体填入）」，上一轮两帧（听/停止后
   * 落地）证明的是"停止后整段填入"，不满足。这轮给 `loopback-asr-provider.ts` 加了
   * `LOOPBACK_ASR_EMIT_DELTA`（默认关闭，仅 `playwright.chat-read.config.ts` 打开，
   * 不影响 `fullstack-smoke` 共用的同一支脚本，见那个文件自己的头注），真的走
   * `getUserMedia`（`--use-fake-device-for-media-stream` 喂假音频源，采音代码是真实
   * 浏览器代码，不是打桩）、真的过服务端代理 ASR WS，抓三帧：
   *   ① 「正在听……」进行中状态（`chat-mic-listening` 可见，转录还没落地）
   *   ② **录音过程中**，转录文字已经出现在输入框里（这是本轮新增的一帧——证明的
   *      正是"实时更新"，不是"停止后落地"）
   *   ③ 停止后转录文字最终落地、可编辑
   */
  await page.getByTestId("chat-mic-button").click();
  await page.getByTestId("chat-mic-listening").waitFor({ state: "visible", timeout: 10_000 });
  await shoot("chat-main-personal-mic-listening.png", "chat-thread-detail");

  // #728 P8 —— 录音**仍在进行**时（还没点停止）就等到 delta 转录文字出现在输入框——
  // 这一帧就是"实时更新"本身的证据，不是靠时序猜的。
  await page.waitForFunction(
    (prefix) => {
      const el = document.querySelector('[data-testid="chat-message-input"]') as HTMLTextAreaElement | null;
      return !!el && el.value.includes(prefix);
    },
    CHAT_READ_E2E.asrTranscriptPrefix,
    { timeout: 15_000 },
  );
  await shoot("chat-main-personal-mic-partial.png", "chat-thread-detail");

  // 再等一下让假音频源多产出几块，字节数继续增长，证明不是只有一帧就不动了。
  await page.waitForTimeout(1_000);
  await page.getByTestId("chat-mic-button").click();
  await page.waitForFunction(
    (prefix) => {
      const el = document.querySelector('[data-testid="chat-message-input"]') as HTMLTextAreaElement | null;
      return !!el && el.value.includes(prefix);
    },
    CHAT_READ_E2E.asrTranscriptPrefix,
    { timeout: 15_000 },
  );
  await shoot("chat-main-personal-mic-transcribed.png", "chat-thread-detail");
  // 转录进来的文字只是草稿，不是断言"已发送"——清空它，不让它污染后面步骤的输入框状态。
  await page.getByTestId("chat-message-input").fill("");

  /**
   * #728 P9 —— 失败态取证。评分员多轮指出：8 张截图全是成功路径，没有一张证明
   * 「失败时界面如实展示，不静默卡住」。这里发一条**逐字等于**
   * `deepAgentFailureTrigger` 的消息——`loopback-deep-agent-provider.ts` 收到这句
   * 话时会让真实的轮询循环读到 `error` 状态、真实抛出 `ModelCallError`，run 真的
   * 落成 `failed`，不是前端拼一个假的失败卡片。
   */
  await page.getByTestId("chat-message-input").fill(CHAT_READ_E2E.deepAgentFailureTrigger);
  await page.getByTestId("chat-message-submit").click();
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="chat-live-agent-run-status"]');
      return el?.getAttribute("data-run-status") === "failed";
    },
    { timeout: 60_000 },
  );
  await shoot("chat-main-personal-failure.png", "chat-thread-detail");

  // 375 档·列表态：裸 `/chat`（无 thread 参数）在窄屏下 `showThreadListInMain` 为真，
  // 会话列表渲进主区域（personal-chat-screen.tsx:260/264）。
  await page.setViewportSize(MOBILE);
  await page.goto("/chat");
  await shoot("chat-main-personal-mobile-list.png", "chat-read-thread-list");

  // 375 档·详情态：带 thread 参数直接进入详情，此时应看到「返回列表」按钮。
  await page.goto(`/chat?thread=${createdThreadId}`);
  await page.getByTestId("chat-thread-back-mobile").waitFor({ state: "visible", timeout: 30_000 });
  await shoot("chat-main-personal-mobile-detail.png", "chat-thread-detail");
});
