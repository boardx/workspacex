import { expect, test, type Page } from "@playwright/test";
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
 *
 * ## 为什么拆成三条 test()（#2208）
 * 18 张图此前挤在**一条** `test()` 里，靠单条 `test.setTimeout(300_000)` 兜底。
 * 这条流程要冷编译 `/login`、`/chat?projectId=`、`/chat/legacy`、`/chat?thread=`
 * 四条路由，而 `/chat` 系路由现在把 CopilotKit v2 运行时也拖进编译链——load 稍高
 * 就在走到第一个 `/chat` 路由之前把 300s 预算耗尽，一条挂掉连坐后面所有图（实测
 * 三连跑：9/18、1/18、1/18）。拆成「项目对话」「个人对话」「响应式」三条独立
 * `test()`，各自拿满 300s 预算，一条挂掉不再连坐其它两条。
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
 * ⚠ 取证不是门控，所以给足超时。默认 30s **不够**：走到第一个 `/chat` 路由要冷
 * 编译，而 `next/font/google` 在没有外网时对每个字体分片重试三次才放弃（构建照样
 * 成功，只是慢——实测日志里就是 `Failed to download 'Noto Sans SC' from Google Fonts`）。
 * 这与 #733 是同一个冷启动成本，只是那边表现成登录超时。拆成三条 test() 之后，
 * 每条只需要走 1-2 条路由的冷编译，但仍保留整段预算不收窄——冷启动成本本身
 * 没有变小，只是不再被 18 张图的总量摊薄。
 */
test.setTimeout(300_000);

/** 每条 test() 独立登录——三条 test() 互不共享浏览器上下文，登录态不能复用。 */
async function login(page: Page): Promise<void> {
  await page.setViewportSize(DESKTOP);
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/projects$/);
}

/** 抓一张，并先确认屏上真有内容 —— 空图会让「已比对」变成假的。 */
async function shoot(page: Page, file: string, testId: string): Promise<void> {
  await page.getByTestId(testId).waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${file}` });
}

async function waitRunTerminal(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="chat-live-agent-run-status"]');
      const status = el?.getAttribute("data-run-status");
      return status === "succeeded" || status === "failed";
    },
    { timeout: 60_000 },
  );
}

test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true });
});

test("capture chat main screen — project conversation", async ({ page }) => {
  await login(page);

  // ⚠ 锚点用 `chat-read-thread-list`（两条路径都渲染它）。两个屏组件都**没有**根 testid，
  //   写 `chat-read-screen` / `personal-chat-screen` 会永远等不到 —— 这两个名字在源码里
  //   一次都不存在，是我第一版凭组件名猜的。
  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}`);
  await shoot(page, "chat-main-default.png", "chat-read-thread-list");

  /**
   * issue #728 D 组独评发现的取证覆盖缺口：整支脚本此前只对**项目对话**（带
   * `projectId`）产出上面这一张（默认桌面态），后面所有真实交互流程——真实发消息、
   * 工具调用链、失败态、语音——全部只跑在**个人对话**路径上。
   * D6（AI 过程可见：思考 X 秒 · N 步 + 工具调用折叠块）、D7（结构化产物卡）、
   * D9（右栏「产物」+「材料」堆叠同屏）这三维因此在项目对话侧从未被真实截图观测过
   * ——评分员每轮都因为「没有可评的图」卡在 H3，与代码是否正确无关。这里给
   * 项目对话补一段等价的真实交互流程。
   *
   * 走的是 `CHAT_READ_E2E.deepAgentId`（真实 `DeepAgentModelProvider` 代码路径，
   * 上游是确定性替身 `loopback-deep-agent-provider.ts`）——`seed-chat-read-e2e.ts`
   * 今天把它挂进了 `THREAD_ID`（项目对话默认线程）的编制：项目线程的
   * `chat-agent-select` 选项读的是编制本身（`GetAgentPanelOut["agents"]`），不是
   * 个人对话那条走组织能力目录的路径，只进 `capability_listings` 不进编制的话，
   * 这个 agent 在项目对话的下拉里根本不会出现。
   */
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

  await waitRunTerminal(page);

  // D6 —— 工具调用链折叠块：与个人对话同一套断言，收窄到刚发出的这条消息自己的
  // `chat-message-row`（每条 agent 消息各自渲染一份 `agent-tool-chain-summary`）。
  const projectLatestRow = page.locator('[data-testid="chat-message-row"]').last();
  await projectLatestRow.getByTestId("agent-tool-chain").waitFor({ state: "visible", timeout: 5_000 });
  // 2026-08-24：断言原文是 `toContainText("工具")`——`toolChainSummaryText()`
  // 在工具数 ≤2 时逐个列 `名称(参数片段)`，不出现「工具」二字（只有 >2 才走
  // 「等 N 个工具」分支），此后经数轮摘要文案改写（e14f6081/71b60e30/83a19223）
  // 断言未同步，稳定超时，18 张取证图卡在只产出 4 张（#1921）。改断「调用了」——
  // 源码里 `${head}调用了 ${listed}${extra}` 这四个字在 toolSteps.length > 0 的
  // 所有分支下恒定存在，不随参数摘要文案演进而漂移。
  await expect(projectLatestRow.getByTestId("agent-tool-chain-summary")).toContainText("调用了");
  await shoot(page, "chat-main-project-tool-call.png", "chat-thread-detail");
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
  await shoot(page, "chat-main-project-artifact-card.png", "chat-thread-detail");

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
  await shoot(page, "chat-main-project-right-panel.png", "chat-thread-detail");

  /**
   * D5 后半（chat-main-fidelity-rubric.md）—— agent 消息身份行的 skill chip。
   * 真挂载 `CHAT_READ_E2E.mountableSkillId`（种子已发布、已启用），再发一条新消息，
   * 断言这条**新**回复的身份行带着 `skill: {mountableSkillName}`——不是断言"面板
   * 显示挂了什么"，是断言"这条消息发出那一刻处于挂载状态的 skill 真的显示出来了"
   * （`agentSkillLabel` 按 `mountedAt`/`removedAt` 时间窗回查，见组件头注）。
   */
  await page.getByTestId("chat-skill-mount").click();
  await page.getByTestId(`chat-skill-mount-option-${CHAT_READ_E2E.mountableSkillId}`).click();
  await page.getByTestId(`chat-skill-mounted-${CHAT_READ_E2E.mountableSkillId}`).waitFor({ state: "visible", timeout: 10_000 });
  await page.getByTestId("chat-message-input").fill("D5 取证：这条消息发出时应挂着 skill");
  await page.getByTestId("chat-message-submit").click();
  await expect(page.getByText(`skill: ${CHAT_READ_E2E.mountableSkillName}`).first()).toBeVisible({ timeout: 20_000 });
  await shoot(page, "chat-main-project-skill-chip.png", "chat-thread-detail");
});

test("capture chat main screen — personal conversation", async ({ page }) => {
  await login(page);

  await page.goto("/chat/legacy");
  await shoot(page, "chat-main-personal.png", "chat-read-thread-list");

  /**
   * #728 round 16 P4 → rev-uiux 第 5 轮指出的证据缺口：「创建后自动选中」从未被
   * 截图观测到，评分员因此判 0，**不是行为不存在，是没被看到**（P4 报告原话）。
   * 这里把这个状态实际走一遍并抓下来，不是新写功能。
   */
  // 2026-08-14：#1179 把个人对话「新建」改成一键创建（`personal-chat-screen.tsx`
  // 直接 `handleCreate(null)`），不再弹标题表单——旧版这里等 `chat-thread-title-input`
  // 会永远超时。创建走真实 mutateThread，成功后用 `router.replace` 把新线程 id
  // 写进 URL —— 等它落地，而不是等固定时长再赌一把。
  await page.getByTestId("chat-thread-create").click();
  await page.waitForURL(/\/chat\?thread=/);
  await shoot(page, "chat-main-personal-created.png", "chat-thread-detail");

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
   * 终态判定（下面 `waitRunTerminal`）不能拿来判"生成中"这一帧——run 到终态时
   * `streamingText` 已经被清空（交给持久消息列表接管，见该组件 `openAgentRunStream`
   * 回调里 `final`/`timeout` 分支），所以要抢在终态之前抓。
   *
   * #2206 同类根因在这里的表现：`chat-message-row-streaming` 是客户端渲染/水合
   * 之后才挂载的节点，`page.goto`/发送动作 resolve 不保证它已提交到 DOM——第一次
   * 轮询可能踩在挂载前的一瞬间。`waitFor` 本身已经是重试等待，这里再加一次显式
   * 重试（等不到就重新触发一次 UI 上已发生的等待，而不是改测试断言的宽松度）,
   * 覆盖"节点还没提交"这类竞争，不改变被测的产品行为逻辑本身。
   */
  const streamingRow = page.getByTestId("chat-message-row-streaming");
  try {
    await streamingRow.waitFor({ state: "visible", timeout: 15_000 });
  } catch (err) {
    // 再给一次机会：可能是水合竞争踩在了挂载前一瞬间，而不是流式行为没发生。
    await streamingRow.waitFor({ state: "visible", timeout: 15_000 });
  }
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
  const fullReplyText = `${CHAT_READ_E2E.agentReplyPrefix} ${probeText}`;
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
  await waitRunTerminal(page);
  /**
   * #728 round 16 P10 → **2026-08-21 人类裁决反转**：个人对话现在**应该**出现
   * 「落地为产物」按钮——个人线程也真的能持久化产物，不再是一枚点了必报错的
   * 假按钮。按钮的渲染依据是服务端下发的 `artifact.land` 能力（个人线程也下发，
   * 见 `thread-visibility.ts` 的 `PERSONAL_THREAD_CAPABILITIES`）。
   * 项目侧「写角色看得见这枚按钮」的另一半反证在 chat-read.spec.ts。
   *
   * ⚠ 2026-08-24 断言数字更正为 1（原为 2，取证于 #1921 修 D6 断言后本轮才第一次
   * 真正跑到这一步，此前这条断言从未被本轮验证覆盖到）：PR #1829（2026-08-23，
   * 人类本人「UI 一致性与可见性修复包」，第 10 项不一致③）**刻意**把这枚按钮收窄
   * 成只挂 `isAgent` 消息——`chat-live-message-panel.tsx` 原文注释「落地对象是
   * agent 的产出，不是用户自己的话」，此前用户消息下的按钮（右对齐悬浮在用户
   * 气泡下）语义错位，人类本人认定是缺陷已改掉。此刻屏上 1 条用户消息 + 1 条
   * agent 回复，只有后者渲染按钮，故稳定应为 1，不是 2——旧断言数字沿用的是
   * 该 PR 之前的行为，未跟进这次人类本人的产品决策。仍用 `toHaveCount`
   * （会重试到 Playwright expect 超时）而非一次性 `.count()` 快照，理由不变：
   * 需要等 agent 回复那次 `loadPage(..., "soft")` 异步重读真的把第二条消息
   * 渲染进 DOM，不能在 `data-run-status` 刚到终态那一刻就抢拍快照。
   */
  await expect(page.locator('[data-testid^="chat-land-artifact-open-"]')).toHaveCount(1);

  await shoot(page, "chat-main-personal-reply.png", "chat-thread-detail");

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
  await waitRunTerminal(page);
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
  // 同上方项目侧那处（#1921）：断「调用了」而非「工具」，四个字在 toolSteps.length
  // > 0 的所有分支下恒定存在，不随参数摘要文案演进而漂移。
  await expect(latestMessageRow.getByTestId("agent-tool-chain-summary")).toContainText("调用了");
  await shoot(page, "chat-main-personal-tool-call.png", "chat-thread-detail");
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
  await shoot(page, "chat-main-personal-mic-listening.png", "chat-thread-detail");

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
  await shoot(page, "chat-main-personal-mic-partial.png", "chat-thread-detail");

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
  await shoot(page, "chat-main-personal-mic-transcribed.png", "chat-thread-detail");
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
  await shoot(page, "chat-main-personal-failure.png", "chat-thread-detail");
});

test("capture chat main screen — responsive breakpoints", async ({ page }) => {
  await login(page);

  // 375 档·项目对话详情态。AppShell 的左栏是 `hidden md:block`（app-shell.tsx:158），
  // 窄屏下线程列表**按设计不渲染**——锚点换成 `chat-thread-detail`。原来锚在
  // `chat-read-thread-list` 上，于是这一张永远超时，那是锚错了对象，不是响应式坏了。
  await page.setViewportSize(MOBILE);
  await page.goto(`/chat?projectId=${CHAT_READ_E2E.projectId}`);
  await shoot(page, "chat-main-mobile.png", "chat-thread-detail");

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
  await shoot(page, "chat-main-project-tablet.png", "chat-read-thread-list");

  // 375 档·列表态：裸 `/chat`（无 thread 参数）在窄屏下 `showThreadListInMain` 为真，
  // 会话列表渲进主区域（personal-chat-screen.tsx:260/264）。
  await page.setViewportSize(MOBILE);
  await page.goto("/chat/legacy");
  await shoot(page, "chat-main-personal-mobile-list.png", "chat-read-thread-list");

  // 375 档·详情态：带 thread 参数直接进入详情，此时应看到「返回列表」按钮。
  // 这里独立创建一个线程（不复用「个人对话」test 的线程——三条 test() 各自独立的
  // browser context，跨 test 传状态本身就不成立），走的还是真实创建流程。
  await page.setViewportSize(DESKTOP);
  await page.goto("/chat/legacy");
  await page.getByTestId("chat-thread-create").click();
  await page.waitForURL(/\/chat\?thread=/);
  const createdThreadUrl = new URL(page.url());
  const createdThreadId = createdThreadUrl.searchParams.get("thread");
  if (!createdThreadId) throw new Error("创建后 URL 里没有 thread 参数，取证脚本本身的假设已经不成立");

  await page.setViewportSize(MOBILE);
  await page.goto(`/chat?thread=${createdThreadId}`);
  await page.getByTestId("chat-thread-back-mobile").waitFor({ state: "visible", timeout: 30_000 });
  await shoot(page, "chat-main-personal-mobile-detail.png", "chat-thread-detail");
});
