/**
 * real-model-pdf-smoke.spec.ts —— **真实模型**下的 PDF 生成用例端到端门控（issue #2802）。
 *
 * ## 它补的是哪一块空白
 *
 * 本仓 86 个全栈 e2e spec 全部跑在 `playwright.fullstack-smoke.config.ts` 那个
 * **确定性回环模型提供方**上。那个设计是对的（回归门禁需要可预测的上游），但代价是：
 * 「真实模型思考数分钟 → 网关掐断」「模型自主多调一步工具」「真实技能端到端产出文件」
 * 这一整类行为，**从来没有任何自动化路径接触过**。#2786 / #2793 / #2795 三个 issue
 * 全部发生在 CI 全绿的提交上，最后靠人类手动打开 DevTools 截图才拿到第一份真实报错。
 *
 * 这条 spec 就是把那次人工动作变成机器动作。它**不替换**那 86 条，是**另加一条 lane**。
 *
 * ## 一份断言，两处运行
 *
 *   · devapp 自建 runner：`.github/workflows/real-model-chat-evidence.yml`（手动触发），
 *     打真实部署的公网入口——`#2795` 的 SSE/WS 掐断发生在网关那一层，绕开网关就测不到。
 *   · 本地 Mac：`pnpm run e2e:real-model-smoke`，打 `e2e-up.sh` 起的本地真栈。
 * 两条 lane 共用本文件与 `real-model-smoke-fixture.ts`，不分叉成两份会漂移的 spec。
 *
 * ## 断言的口径：结构事实，不是模型措辞
 *
 * 真实模型是不确定的，断言它说了什么就是在断言噪音。所以每一条断言判的都是**结构**：
 * 产物字节真的是 PDF（`%PDF-` 魔数）、审批弹窗节点在不在、两个气泡的正文是否逐字相同、
 * 错误横幅节点在不在、流有没有被 `loadingFailed`。这些与模型这次怎么措辞无关。
 *
 * ## 失败时不早退
 *
 * 每条断言先**记录**再判定，全部记完才让用例红。早退会丢掉后面几条的证据，而这条
 * lane 存在的全部意义就是产出证据——#2795 那次，人类要的正是"控制台到底报了什么"。
 */
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { REAL_MODEL_SKIP_REASON, REAL_MODEL_SMOKE } from "./real-model-smoke-fixture";
import { RealModelEvidence } from "./support/real-model-evidence";

// 缺凭据 ⇒ **文件级显式 skip 并点名缺了谁**（`REAL_MODEL_SKIP_REASON` 自己拼的原因）。
// 刻意用文件级 skip 而不是用例内 skip：后者要先把浏览器起起来才判得了，而这条 lane
// 在没有凭据的环境（比如任何一个普通 CI job）里应该连浏览器都不用起。
//
// ⚠ 原因必须**打进 stdout**：报告器对跳过的用例只会打一行「1 skipped」，不显示
//   annotation 里的原因——那就是 #2802 明令禁止的「无声跳过」。读日志的人必须一眼
//   看到缺的是哪个变量，而不是以为这条 lane 跑过了。
if (REAL_MODEL_SKIP_REASON !== null) {
  process.stdout.write(`\n[real-model-smoke] SKIP —— ${REAL_MODEL_SKIP_REASON}\n\n`);
}
test.skip(REAL_MODEL_SKIP_REASON !== null, REAL_MODEL_SKIP_REASON ?? "");

/**
 * 传输层失败的形态——#2795 那三行真实控制台报错逐字来源。
 *
 * ⚠ 这不是"按文本猜错误分类"（那是 #2790 已经栽过的路子）。这里判的是**浏览器自己
 *   报出来的传输事件**：WebSocket 建立失败、fetch 被中止、AG-UI 桥接层收到
 *   `agent_run_error_event`。它们不是模型措辞，是连接事实。
 */
const TRANSPORT_FAILURE_PATTERNS: readonly RegExp[] = [
  /WebSocket .*(closed before the connection is established|failed)/i,
  /agent_run_error_event/i,
  /\bError:\s*terminated\b/i,
  /net::ERR_/i,
  /Agent .* not found/i,
];

/** 归一化气泡正文：只做空白折叠，不做任何语义处理——重复的定义是"逐字相同"。 */
function normalizeBubble(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * 断言 ⑥ 的期望产物类型。默认 PDF —— 不配这两个环境变量时，两条 lane 的行为与
 * 本次改动之前**逐字节相同**。配上就能让同一份 spec 覆盖平台技能目录里的另外三个
 * 官方 skill（pptx/docx/xlsx-create），不必分叉第二份 spec。
 */
const EXPECT_EXT = REAL_MODEL_SMOKE.expectExt;
const EXPECT_MAGIC = REAL_MODEL_SMOKE.expectMagic;
/** 扩展名匹配按字面量转义，避免把 `.` 当成通配。 */
const EXPECT_NAME_RE = new RegExp(`\\.${EXPECT_EXT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`, "i");

/**
 * 本轮的证据采集器。放模块级是为了让下面那个 `afterEach` 兜底够得到它：
 * 用例在走到 `finish()` 之前抛错（比如登录就没过去、composer 一直不 ready）时，
 * 证据包**仍然要落盘**——一条以"什么都没留下"收场的取证通道是自相矛盾的。
 */
let evidence: RealModelEvidence | null = null;

// eslint-disable-next-line no-empty-pattern -- Playwright 强制第一个参数必须是对象解构
// 形态（不解构任何 fixture 也要写成 `{}`），否则 config 解析期直接报
// "First argument must use the object destructuring pattern"，整份文件一条用例都跑不了。
test.afterEach(async ({}, testInfo) => {
  if (evidence === null) return;
  if (testInfo.status !== testInfo.expectedStatus && testInfo.error !== undefined) {
    evidence.record(
      "⑨ 用例中途抛错，其后的断言没能取证",
      false,
      `${testInfo.error.message ?? String(testInfo.error)}`.slice(0, 800),
    );
  }
  // `finish()` 幂等：正常路径已经调过一次的话，这里不会重复落盘。
  evidence.finish();
});

async function login(page: Page, email: string, password: string): Promise<void> {
  // 同 `core-journey-03` 的既有做法：切账号前先清会话，否则 /login 会把已认证的人
  // 直接弹回 /projects，`login-email` 永远等不到。
  await page.context().clearCookies();
  await page.goto("/login");
  await page.evaluate(() => window.localStorage.clear()).catch(() => {});
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/, { timeout: 60_000 });
}

test("真实模型：/chat 发「生成一个 pdf…」→ 真的产出 PDF、无审批弹窗、无重复气泡、无兜底报错、连接不断", async ({ page }, testInfo) => {
  test.setTimeout(REAL_MODEL_SMOKE.runTimeoutMs + 300_000);

  const evidenceDir = path.isAbsolute(REAL_MODEL_SMOKE.evidenceDir)
    ? REAL_MODEL_SMOKE.evidenceDir
    : path.resolve(testInfo.project.testDir, "..", REAL_MODEL_SMOKE.evidenceDir);
  // 登录口令进脱敏表：它会出现在请求体里，而请求体可能被别的采集面带出来。
  evidence = new RealModelEvidence(evidenceDir, [REAL_MODEL_SMOKE.password]);
  await evidence.attach(page);
  evidence.setContext("lane", REAL_MODEL_SMOKE.lane);
  evidence.setContext("baseUrl", REAL_MODEL_SMOKE.baseUrl);
  evidence.setContext("prompt", REAL_MODEL_SMOKE.prompt);
  evidence.setContext("account", REAL_MODEL_SMOKE.email);
  evidence.setContext("credentialSource", REAL_MODEL_SMOKE.credentialSource);
  evidence.setContext("runTimeoutMs", REAL_MODEL_SMOKE.runTimeoutMs);

  /* ── ① 登录 + 打开真实 /chat ─────────────────────────────────────────── */
  await login(page, REAL_MODEL_SMOKE.email, REAL_MODEL_SMOKE.password);
  await page.goto("/chat");
  const composer = page.getByTestId("copilotkit-v2-input");
  await expect(composer).toBeVisible({ timeout: 120_000 });
  const send = page.getByTestId("copilotkit-v2-send");
  // `data-send-state` 是 composer 自己声明给 e2e 的判据（见 copilotkit-v2-panel-body.tsx），
  // 不去读 title/aria 文案——那些会随文案改动漂移。
  //
  // ⚠ 必须**先填字再等 ready**：`sendDisabled` 的四条理由里有一条就是"输入为空"
  //   （`inputDraft.trim() === ""` ⇒ EMPTY_INPUT_REASON，issue #2130 要求的产品行为）。
  //   本行原来在 fill 之前 poll `ready`，那是在等一个空输入永远到不了的状态——
  //   2026-09-06 本 lane 第一次真跑就卡在这里 120s 红退（#2805 合入时无 Docker/无凭据，
  //   这条路径从没被执行过）。填字之后再判 ready，判的才是"composer 真的可发送"。
  await composer.fill(REAL_MODEL_SMOKE.prompt);
  await expect
    .poll(() => send.getAttribute("data-send-state"), { timeout: 120_000, intervals: [500, 1_000, 2_000] })
    .toBe("ready");
  evidence.record("① 真实 /chat 可用（composer 就绪）", true, `baseURL=${REAL_MODEL_SMOKE.baseUrl}`);

  /* ── ② 发出那一句 ────────────────────────────────────────────────────── */
  const sentAt = Date.now();
  await send.click();

  /* ── ③ 边跑边取证：run 走到终态之前，持续观测四件会**转瞬即逝**的事 ──────
        审批弹窗出现过没有、错误横幅出现过没有、真实 runId 是多少、thread id 是多少。
        跑完再查这些的话，弹窗可能已经被关掉、横幅可能已经被下一次渲染顶掉。 */
  const permissionDialog = page.getByTestId("chat-tool-permission-dialog");
  const approvalCard = page.getByTestId("chat-approval-card");
  const errorBanner = page.getByTestId("copilotkit-v2-error");
  let approvalSeenAt: string | null = null;
  let errorSeenText: string | null = null;
  let observedRunId: string | null = null;
  let threadId: string | null = null;
  let finalSendState = "running";
  /**
   * 「run 真的起来过」的标记。
   *
   * ⚠ 没有它这条循环是错的：点下发送之后有一小段窗口 `agent.isRunning` 还是 false，
   *   `data-send-state` 仍是 `ready`——直接判「不等于 running 就是跑完了」会在毫秒级
   *   就"通过"，然后后面每一条断言都在一个还没开始的 run 上取证。真实模型这条用例
   *   要跑数分钟，秒级的"完成"只可能是这个误判。
   */
  let sawRunning = false;
  const deadline = sentAt + REAL_MODEL_SMOKE.runTimeoutMs;

  while (Date.now() < deadline) {
    // 弹窗/横幅：数节点，不等它可见——`toBeVisible` 会等，等就会错过下一次采样。
    if (approvalSeenAt === null && (await permissionDialog.count()) + (await approvalCard.count()) > 0) {
      approvalSeenAt = `+${((Date.now() - sentAt) / 1000).toFixed(1)}s`;
    }
    if (errorSeenText === null && (await errorBanner.count()) > 0) {
      errorSeenText = normalizeBubble(await errorBanner.innerText().catch(() => "<读不到正文>"));
    }
    if (observedRunId === null) {
      // 在途 run 的**真实 runId**挂在进度卡 `copilotkit-v2-running-indicator` 的 `data-run-id`
      // 上（原挂在 issue #2756 的插话框上，该框已撤）——浏览器侧唯一够得到的真实 run 标识。
      // ⚠ 先数节点再取属性：`getAttribute` 对不存在的节点会**等满 actionTimeout**，
      //   那会让这条 2 秒一轮的采样循环变成 60 秒一轮，前面几件转瞬即逝的事就都错过了。
      const interjection = page.getByTestId("copilotkit-v2-running-indicator");
      if (await interjection.count() > 0) {
        observedRunId = await interjection.first().getAttribute("data-run-id").catch(() => null);
      }
    }
    if (threadId === null) {
      const match = /\/chat\/([^/?#]+)/.exec(page.url());
      threadId = match?.[1] ?? null;
    }
    const state = await send.getAttribute("data-send-state").catch(() => null);
    if (state === "running") {
      sawRunning = true;
    } else if (sawRunning) {
      finalSendState = state ?? "<读不到>";
      break;
    } else if (Date.now() - sentAt > 120_000) {
      // 两分钟都没进 running：这次 run 压根没起来。如实记下来，不要继续等满上限——
      // 那样只会把"没起来"伪装成"超时"，两种失败的排查方向完全不同。
      finalSendState = `${state ?? "<读不到>"}（发出后 2 分钟内从未进入 running）`;
      break;
    }
    await page.waitForTimeout(2_000);
  }
  const elapsedMs = Date.now() - sentAt;
  evidence.setContext("threadId", threadId ?? "<未观测到>");
  evidence.setContext("agentRunId", observedRunId ?? "<未观测到：DOM 侧只有插话框会挂 data-run-id>");
  evidence.setContext("elapsedSeconds", Math.round(elapsedMs / 1000));

  await page.screenshot({ path: path.join(evidenceDir, "90-final-screen.png"), fullPage: true })
    .catch(() => undefined);

  evidence.setContext("runStartObserved", sawRunning);
  evidence.record(
    "② run 真的跑起来并走到终态（不是卡在生成中直到超时，也不是压根没起来）",
    sawRunning && finalSendState !== "running",
    `发出后 ${Math.round(elapsedMs / 1000)}s，composer data-send-state=${finalSendState}；`
      + `期间观测到 running 态：${sawRunning ? "是" : "否"}`
      + `（上限 ${Math.round(REAL_MODEL_SMOKE.runTimeoutMs / 1000)}s）`,
  );

  /* ── ④ 无工具审批弹窗（pdf-create 自 #2782 起是 L0）────────────────────── */
  evidence.record(
    "③ 全程没有出现工具授权/审批弹窗（pdf-create 是 L0，#2782）",
    approvalSeenAt === null,
    approvalSeenAt === null
      ? "chat-tool-permission-dialog / chat-approval-card 在整轮轮询中一次都没有出现"
      : `弹窗在 ${approvalSeenAt} 出现——L0 技能不该要人点确认`,
  );

  /* ── ⑤ 无兜底报错横幅（#2786 / #2795）──────────────────────────────────
        判"横幅节点在不在"，不判它写了什么——任何一条错误横幅都算失败，比对着
        兜底文案做子串匹配更严，也不会随文案改动而失效。 */
  const errorNow = (await errorBanner.count()) > 0
    ? normalizeBubble(await errorBanner.innerText().catch(() => "<读不到正文>"))
    : null;
  const errorText = errorSeenText ?? errorNow;
  evidence.record(
    "④ 全程没有出现错误横幅（#2786 兜底文案 / #2795 terminated 都落在这个节点上）",
    errorText === null,
    errorText === null ? "copilotkit-v2-error 从未出现" : `错误横幅正文：${errorText}`,
  );

  /* ── ⑥ 不重复规划句（#2780）────────────────────────────────────────────
        结构判据：两条不同的助手气泡正文逐字相同。#2780 修的正是"同一句经两条通道
        各发一遍，两个 messageId、内容逐字相同"。 */
  const bubbles = await page.getByTestId("copilotkit-v2-messages")
    .getByTestId("chat-ai-markdown").allInnerTexts();
  const normalized = bubbles.map(normalizeBubble).filter((t) => t.length >= 12);
  const duplicates = normalized.filter((t, i) => normalized.indexOf(t) !== i);
  evidence.writeJson("40-assistant-bubbles.json", bubbles.map(normalizeBubble));
  evidence.record(
    "⑤ 助手气泡没有逐字重复（#2780 规划句重复）",
    duplicates.length === 0,
    duplicates.length === 0
      ? `${normalized.length} 条助手气泡（长度≥12），两两不同`
      : `发现 ${duplicates.length} 条重复气泡，首条：「${duplicates[0]?.slice(0, 120)}」`,
  );

  /* ── ⑦ 真的产出了 PDF（不是模型嘴上说要生成）──────────────────────────
        判据是**字节**：把气泡下面那张下载卡的 blob 拉下来看魔数。`%PDF-` 之外的
        任何东西（包括一个 0 字节的占位、一个错误 JSON）都判失败。 */
  const producedCards = page.getByTestId("chat-produced-file-inline-card");
  const cardCount = await producedCards.count();
  const cardTexts: string[] = [];
  let pdfCard: Locator | null = null;
  for (let i = 0; i < cardCount; i += 1) {
    const card = producedCards.nth(i);
    const text = normalizeBubble(await card.innerText().catch(() => ""));
    cardTexts.push(text);
    if (pdfCard === null && EXPECT_NAME_RE.test(text)) pdfCard = card;
  }
  evidence.writeJson("41-produced-files.json", cardTexts);

  let pdfDetail = cardCount === 0
    ? "这条 run 一个产出文件卡都没有（chat-produced-file-inline-card 数量为 0）"
    : `有 ${cardCount} 张产出卡，但没有一张的文件名以 .${EXPECT_EXT} 结尾：${cardTexts.join(" | ")}`;
  let pdfOk = false;
  if (pdfCard !== null) {
    const failedBadge = await pdfCard.getByTestId("chat-produced-file-inline-failed").count();
    const href = await pdfCard.getByTestId("chat-produced-file-inline-download")
      .getAttribute("href").catch(() => null);
    if (failedBadge > 0) {
      pdfDetail = "产出卡在，但它自己显示「下载失败」（chat-produced-file-inline-failed）";
    } else if (href === null || href === "") {
      pdfDetail = "产出卡在、没有失败标记，但下载链接为空——文件没真的落到可下载的位置";
    } else {
      // blob: URL 只在页面上下文里可解引用，所以取字节这一步必须在页内做。
      const CAP_BYTES = 4 * 1024 * 1024;
      const probe = await page.evaluate(async ({ url, cap }) => {
        const response = await fetch(url);
        const buffer = new Uint8Array(await response.arrayBuffer());
        // 只带回前 4MB：证据包要能读，不要变成一个几十兆的附件。分块拼字符串——
        // 逐字节 `+=` 在几 MB 上会明显拖慢，而 `String.fromCharCode(...整个数组)`
        // 又会爆调用栈，分块是这两者之间唯一稳的写法。
        const capped = buffer.subarray(0, cap);
        let binary = "";
        for (let i = 0; i < capped.length; i += 8192) {
          binary += String.fromCharCode(...capped.subarray(i, i + 8192));
        }
        return {
          length: buffer.length,
          head: Array.from(buffer.subarray(0, 5)).map((b) => String.fromCharCode(b)).join(""),
          base64: btoa(binary),
        };
      }, { url: href, cap: CAP_BYTES })
        .catch((error: unknown) => ({ length: 0, head: `<取字节失败：${String(error)}>`, base64: "" }));
      // 判据：PDF 魔数 + 一个不可能是占位空壳的长度。两条都真才算"真的产出了"。
      pdfOk = probe.head.startsWith(EXPECT_MAGIC) && probe.length > 1_000;
      pdfDetail = `产出文件字节数=${probe.length}，前 ${EXPECT_MAGIC.length} 字节=`
        + `「${probe.head.slice(0, EXPECT_MAGIC.length)}」（合格的 ${EXPECT_EXT.toUpperCase()} 必须是 ${EXPECT_MAGIC}）`;
      if (probe.base64 !== "") {
        evidence.writeBinary(`91-produced.${EXPECT_EXT}`, Uint8Array.from(atob(probe.base64), (c) => c.charCodeAt(0)));
        if (probe.length > CAP_BYTES) {
          pdfDetail += `；⚠ 证据包里的 91-produced.${EXPECT_EXT} 只截了前 ${CAP_BYTES} 字节（原文件更大），`
            + `字节数与魔数的判定用的是完整响应，不是这份截断副本`;
        }
      }
    }
  }
  evidence.record(`⑥ 真的产出了一个 ${EXPECT_EXT.toUpperCase()} 产物（按字节判，不按模型措辞判）`, pdfOk, pdfDetail);

  /* ── ⑧ 连接全程没被掐断（#2795）────────────────────────────────────────
        两条独立证据：CDP 侧 AG-UI 流没有 loadingFailed；浏览器控制台没有传输层
        失败形态。任一命中都判失败——#2795 那次两条都命中了。 */
  const streamFailures = evidence.streamFailures();
  const transportConsole = evidence.consoleErrors()
    .filter((entry) => TRANSPORT_FAILURE_PATTERNS.some((pattern) => pattern.test(entry.text)));
  evidence.record(
    "⑦ SSE/WS 全程没有被掐断（#2795 空闲超时/WS 提前关闭）",
    streamFailures.length === 0 && transportConsole.length === 0,
    `流失败事件 ${streamFailures.length} 条；传输层控制台报错 ${transportConsole.length} 条`
      + (transportConsole.length > 0 ? `，首条：${transportConsole[0]?.text.slice(0, 200)}` : "")
      + (streamFailures.length > 0 ? `，首条：${streamFailures[0]?.detail ?? ""}` : ""),
  );

  /* ── ⑨ 页面级异常（不是断言目标，但必须出现在结论里）────────────────── */
  const pageErrors = evidence.consoleErrors().filter((entry) => entry.type === "pageerror");
  evidence.record(
    "⑧ 没有未捕获的页面异常",
    pageErrors.length === 0,
    pageErrors.length === 0 ? "pageerror 0 条" : `pageerror ${pageErrors.length} 条，首条：${pageErrors[0]?.text.slice(0, 200)}`,
  );

  const verdict = evidence.finish();
  // 证据全部落盘之后才判红——早退会丢掉后面几条的证据，而证据正是这条 lane 的产物。
  expect(
    verdict.failed,
    `真实模型 PDF 用例有 ${verdict.failed} 条断言未通过，逐条结论见 job log 与证据包 ${evidenceDir}`,
  ).toBe(0);
});
