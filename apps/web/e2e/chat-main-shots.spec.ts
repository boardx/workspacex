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
   * #728 P4/P5 —— rev-uiux 第 5 轮指出的证据缺口：「创建后自动选中」与「个人对话
   * 375 档」两个状态从未被截图观测到，评分员因此判 0，**不是行为不存在，是没被看到**
   * （P4/P5 报告原话）。这里把这两个状态实际走一遍并抓下来，不是新写功能。
   */
  await page.setViewportSize(DESKTOP);
  await page.goto("/chat");
  await page.getByTestId("chat-thread-create").click();
  await page.getByTestId("chat-thread-title-input").fill("对话保真取证专用");
  await page.getByTestId("chat-thread-title-submit").click();
  // 创建走真实 mutateThread，成功后 `personal-chat-screen.tsx` 用 `router.replace`
  // 把新线程 id 写进 URL —— 等它落地，而不是等固定时长再赌一把。
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
  // ⚠ 只读 `.copilotkit-message-markdown` 这一段——整行 `textContent` 还带着
  // "Agent" 名字标签与 `正在生成…` 状态徽标（`chat-live-message-panel.tsx` 同一个
  // `<li>` 里的兄弟节点）。第一版拿整行 `textContent` 去跟 `fullReplyText` 比长度：
  // 实测抓到的其实是真实的半截内容（"对话保真取"，回复原文 13 字里的前 5 字），
  // 但把 "Agent" + "正在生成…" 这两段标签文字也算进总长度后，`"Agent正在生成…" +
  // 半截内容` 反而比 `fullReplyText` 更长，被误判成"已经是完整回复"而拒绝——
  // 这里只取真正的回复内容，长度比较才对应得上 `loopback-model-provider.ts`
  // 自己的协议，不会被展示层的标签文字污染。
  const midStreamText = (
    await streamingRow.locator(".copilotkit-message-markdown").textContent()
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
   * #728 round 16 P10 —— 个人对话里**不得出现**「落地为产物」按钮。
   * 后端对个人线程恒拒（`land-as-artifact.ts` 的 `NoWriteRoleError`，个人线程
   * `projectRole` 恒 null），此前前端无条件渲染 = 每条消息下一枚点了必报错的
   * 假按钮，评分员据此判 P10 = 0。修法：按钮的渲染依据是服务端下发的
   * `artifact.land` 能力（个人线程恒无）。此刻屏上已有用户消息 + agent 回复
   * 至少两条——若按钮还在渲染，这里数出来就不是 0，会当场红。
   * 项目侧「写角色看得见这枚按钮」的另一半反证在 chat-read.spec.ts。
   */
  await expect(page.locator('[data-testid^="chat-land-artifact-open-"]')).toHaveCount(0);

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
  await page.getByTestId("chat-run-tool-call-steps").waitFor({ state: "visible", timeout: 5_000 });
  await shoot("chat-main-personal-tool-call.png", "chat-thread-detail");

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
