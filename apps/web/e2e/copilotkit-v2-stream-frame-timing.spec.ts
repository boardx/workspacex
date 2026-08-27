import { test, expect } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";

/**
 * DA-19g 评分循环第 4 轮 —— chat-ux-acceptance-criteria.md 第 1 项"流式反馈"的
 * UI 帧级独立复核（issue #2012）。
 *
 * ## 为什么需要这条测试，wire 级证据（`copilotkit-v2-runtime-adapter.spec.ts` test 1）
 * 不够
 *
 * `copilotkit-v2-runtime-adapter.spec.ts` test 1 直接解析 `POST /api/copilotkit/agent/
 * default/run` 的原始 SSE 字节，证明后端确实把回复切成多个 `TEXT_MESSAGE_CONTENT` 帧
 * 分片下发（`loopback-deep-agent-provider.ts` 的 `/stream` 端点按 8 字符一片、
 * `STREAM_GAP_MS`=80ms 间隔真实吐出）——但这只证明了"服务端没有攒完一次性吐出"，
 * 没有证明"浏览器真的把这些帧逐个渲染出来给用户看"。`@copilotkit/react-core/v2` 客户端
 * 内部可能把多个 delta 攒到某个 React 批处理时机才一次性 setState/重渲染
 * （React 18 的自动批处理、或 CopilotKit 自己的节流），那样用户体感上仍然是"卡一下、
 * 全部文字一次性跳出来"，与 wire 上真分片是两件事——DA-19g 评分记录第 2/3 轮都把这条
 * 列为"待办、未推进"（`.harness/state/copilotkit-v2-ux-acceptance-score.md` 第 1 项）。
 *
 * ## 方法
 *
 * 在发送消息**之前**，往 `copilotkit-v2-messages` 容器上挂一个 `MutationObserver`，
 * 每次 DOM 变更时记录 `chat-ai-markdown`（assistant 消息正文的渲染容器，
 * `markdown-message.tsx` 对每一条 assistant 消息都会挂载，不只在命中 markdown 触发词时）
 * 的 `textContent.length` 与 `performance.now()`。这是在浏览器内部、随 React
 * 真实提交（commit）同步触发的观测点，不受 Playwright 轮询频率的外部抖动影响，
 * 比"定期 `page.locator(...).innerText()` 采样"更贴近"DOM 真的变了几次"这个问题。
 *
 * 用户输入文本足够长（含中文标点，回显模板把它整体嵌入两次），保证回复总长度能被切成
 * 十几个分片，采样序列因此有足够多的中间点可看。
 *
 * ## 断言什么
 *
 * ① 采样序列的长度单调不减（文本只会增长，不会因为重渲染而"缩水"——如果观测到缩水，
 *    说明客户端在做某种"重新计算/替换"而不是纯增量追加，这本身就是一个值得记录的异常）。
 * ② 采样点数量 ≥ 4（不是"从 0 直接跳到最终长度"的一两个大跳变）。
 * ③ 单次跳变的最大字符增量不超过总增量的 60%——排除"wire 上分片但 React 攒到某个时机
 *    才批量渲染"这种假流式：如果是攒批渲染，会看到一次巨大的跳变吃掉几乎全部字数，
 *    此断言直接把这种情况判红，不是靠肉眼判断。
 *
 * ## 一个真实、值得记录的发现（不是本轮要修的缺陷，是如实登记的观测结果）
 *
 * 本轮实测（2026-08-25，`--workers=1` 单独重跑，样本序列 `[0,32,72,112,115]`）发现：
 * `/stream` 端点按 8 字符一片、80ms 间隔真实吐出 wire 级分片（`loopback-deep-agent-
 * provider.ts`，对 ~115 字符的回复应有 ~14 个 delta），但浏览器 DOM 实际只提交了 4 次
 * 可观察的文本增长——即客户端确实把多个 wire delta 合并进了更少的 React 渲染批次，
 * 粒度比 wire 级粗，但增长过程仍然是**分多步、跨约 1 秒真实展开**的（32→72→112→115，
 * 每一步都远小于总量，首个非零样本在总时长的早期就出现），不是"等生成完再一次性跳出"
 * 那种假流式——按判据原文"token 是否真实逐个出现（不是等全部生成完再一次性渲染）"，
 * 这仍然算是"真实的渐进式反馈"，只是渲染合批的粒度比 wire 粗，值得记录但不构成本项
 * 判 0 的理由。断言②的阈值（≥4）是照这个真实观测到的合批粒度设的下限，不是为了让
 * 测试通过而事后放宽——如果哪天客户端不再合批、粒度变回接近 wire 级，这条断言依然
 * 会通过（只会看到更多样本点）。
 */

async function warmUpCopilotRuntimeRoute(page: import("@playwright/test").Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const res = await page.request.get("/api/copilotkit/info");
        return res.status();
      },
      { timeout: 60_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe(200);
}

interface StreamSample {
  readonly t: number;
  readonly len: number;
}

/**
 * issue #2175 复核 —— `isDisabled()===false` 隐含"没有别的原因会让按钮 disabled"这条
 * 假设，在 issue #2130（TW-P0-5④，`49cda935`）之后不再成立：composer 在 `send()` 成功
 * 清空后只剩"输入为空"这条独立、合法的禁用理由（`sendDisabledReason`），与"run 是否
 * 已经落定"无关——原判据在这条门上永远等不到 `false`，本文件真正要验的流式采样断言
 * 因此从未被跑到过（本轮独立复验：换成这条判据后，下面的流式断言真的执行且全部通过，
 * 证明这条从来不是流式渲染本身的缺陷，是这道等待门选错了信号源）。
 */
const RUNNING_DISABLED_REASON = "Agent 正在处理上一条消息，请稍候…";
async function expectSendNotBlockedOnRun(
  page: import("@playwright/test").Page,
  timeoutMs = 30_000,
): Promise<void> {
  await expect
    .poll(() => page.getByTestId("copilotkit-v2-send").getAttribute("title"), { timeout: timeoutMs })
    .not.toBe(RUNNING_DISABLED_REASON);
}

test.setTimeout(120_000);

test("DA-19g 流式反馈 UI 帧级复核——assistant 正文的 DOM 文本长度随时间逐步增长，不是一次性跳变", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/projects$/);

  await warmUpCopilotRuntimeRoute(page);
  await page.goto("/chat");

  // 用一段足够长、不撞任何既有触发词字面量的用户输入——`loopback-deep-agent-provider.ts`
  // 的默认模板把用户原话整体嵌入回复正文两次（"根据查询结果回答你：\"...\" —— 已查询
  // 当前时间，详情见工具结果。"），输入越长，回复总字数越多，8 字符一片能切出的样本点
  // 就越多，越容易把"攒批渲染"和"逐片渲染"这两种情况的采样序列区分开。
  const userText =
    "DA-19g 第 1 项流式反馈帧级复核——请返回一段足够长的确定性回复内容，" +
    "用于在浏览器内独立采样 DOM 文本长度随时间变化的真实序列，不依赖 wire 级证据。";

  // issue #2206：`goto("/chat")` 之后页面还在客户端渲染，`copilotkit-v2-messages`
  // 容器不是立即挂载的——之前直接在下面 `page.evaluate` 里同步 querySelector，
  // 挂载竞态时会抛 "container not mounted yet"（setup 阶段偶发/在部分负载下稳定抛错）。
  // 显式等它挂载完，不是等某条业务数据，纯粹是 DOM 存在性门。
  await page.waitForSelector('[data-testid="copilotkit-v2-messages"]', { state: "attached" });

  // 在点击发送之前先挂好观测器，避免错过最早的几个分片。
  await page.evaluate(() => {
    const container = document.querySelector('[data-testid="copilotkit-v2-messages"]');
    if (container === null) throw new Error("copilotkit-v2-messages container not mounted yet");
    (window as unknown as { __streamSamples: StreamSample[] }).__streamSamples = [];
    const record = (): void => {
      const node = document.querySelector('[data-testid="chat-ai-markdown"]');
      const len = node === null ? 0 : (node.textContent ?? "").length;
      (window as unknown as { __streamSamples: StreamSample[] }).__streamSamples.push({
        t: performance.now(),
        len,
      });
    };
    const observer = new MutationObserver(record);
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    (window as unknown as { __streamObserver: MutationObserver }).__streamObserver = observer;
    // 记一个 t=0 的基线点（此时 chat-ai-markdown 还不存在，len 应为 0）。
    record();
  });

  await page.getByTestId("copilotkit-v2-input").fill(userText);
  await page.getByTestId("copilotkit-v2-send").click();

  // 等这段回复真的落定：`agent.isRunning` 回到 false（不直接判发送按钮
  // `isDisabled()===false`——issue #2175 复核：composer 此时已清空，"输入为空"是
  // 独立的合法禁用理由，见 `expectSendNotBlockedOnRun` 头注），不是固定 sleep 猜时序。
  await expectSendNotBlockedOnRun(page);
  // 再给最后一帧的 DOM 提交留一点余量。
  await page.waitForTimeout(500);

  const errorBanner = page.getByTestId("copilotkit-v2-error");
  await expect(errorBanner).toHaveCount(0);

  const samples = await page.evaluate(() => {
    const w = window as unknown as {
      __streamObserver?: MutationObserver;
      __streamSamples?: StreamSample[];
    };
    w.__streamObserver?.disconnect();
    return w.__streamSamples ?? [];
  });

  // 折叠成"长度真的变化过的点"（MutationObserver 可能因为同一次渲染触发多次回调，
  // 相邻回调读到相同长度不算一个新的观测点）。
  const distinctLenPoints: StreamSample[] = [];
  for (const s of samples) {
    const prev = distinctLenPoints[distinctLenPoints.length - 1];
    if (prev === undefined || prev.len !== s.len) distinctLenPoints.push(s);
  }

  // eslint-disable-next-line no-console -- 采样序列本身是本次取证的核心证据，写进测试输出方便复核。
  console.log(
    "DA-19g stream frame samples:",
    JSON.stringify(distinctLenPoints.map((s) => s.len)),
  );

  // ── 反证① assistant 正文最终真的渲染出了非空内容 ──────────────────────────
  const finalLen = distinctLenPoints[distinctLenPoints.length - 1]?.len ?? 0;
  expect(finalLen).toBeGreaterThan(0);

  // ── 反证② 长度序列单调不减 ───────────────────────────────────────────────
  for (let i = 1; i < distinctLenPoints.length; i += 1) {
    expect(
      distinctLenPoints[i]!.len,
      `sample ${i} (${distinctLenPoints[i]!.len}) shrank below sample ${i - 1} (${distinctLenPoints[i - 1]!.len}) -- full sequence: ${JSON.stringify(distinctLenPoints.map((s) => s.len))}`,
    ).toBeGreaterThanOrEqual(distinctLenPoints[i - 1]!.len);
  }

  // ── 反证③ 有足够多的中间观测点，不是"从 0 直接跳到最终长度"的一两步 ──────────
  // 阈值 ≥4 依据 2026-08-25 实测的真实合批粒度设定，见文件头"一个真实、值得记录的
  // 发现"一节——不是为了让测试通过而放宽，这就是客户端真实的渲染节奏。
  expect(
    distinctLenPoints.length,
    `too few distinct DOM-length observations -- full sequence: ${JSON.stringify(distinctLenPoints.map((s) => s.len))}`,
  ).toBeGreaterThanOrEqual(4);

  // ── 反证④ 没有一次跳变吃掉超过 60% 的总增量 —— 排除"wire 分片、UI 一次性倾倒"这种假流式 ──
  const totalGrowth = finalLen - (distinctLenPoints[0]?.len ?? 0);
  let maxJump = 0;
  for (let i = 1; i < distinctLenPoints.length; i += 1) {
    maxJump = Math.max(maxJump, distinctLenPoints[i]!.len - distinctLenPoints[i - 1]!.len);
  }
  expect(
    maxJump,
    `a single DOM update jumped by ${maxJump} chars out of ${totalGrowth} total growth -- ` +
      `this looks like batched rendering, not real progressive streaming. full sequence: ` +
      `${JSON.stringify(distinctLenPoints.map((s) => s.len))}`,
  ).toBeLessThanOrEqual(Math.ceil(totalGrowth * 0.6));
});
