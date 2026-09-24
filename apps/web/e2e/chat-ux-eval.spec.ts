/**
 * **chat 体验评测集**——「对标 Claude Code」那十项的机械测量。
 *
 * 判据文字的唯一权威是 `.harness/instructions/chat-ux-acceptance-criteria.md`；
 * 这里只负责量，量法与三态约定见 `support/chat-ux-rubric.ts` 头注。
 *
 * ## 为什么要有它（2026-09-24）
 *
 * 人类问「我们几分」，我只能给一个**推断**：功能项我读得出代码，可靠性与速度两项
 * 权重最大却只能靠印象。那份验收文档要求人用真实浏览器操作一遍再打分——这条纪律没错，
 * 但它产出的分不可复现：同一个人隔一天给 6 分还是 7 分，说不清是产品变了还是心情变了。
 *
 * 这个 spec 把十项里能机械量的部分固定下来：确定性上游替身（loopback）+ 固定剧本，
 * 每一项都留证据字符串。跑完落一份记分卡到 `evidence/`，**分数只准涨不准跌**（棘轮）。
 *
 * ## 它量不到什么（先说清楚，不假装）
 *
 * · 真实模型的质量（本车道全跑 loopback 替身，量的是**呈现与链路**，不是模型好坏）。
 * · 「看起来舒不舒服」——视觉保真度归 `chat-main-fidelity-rubric.md` 那份卡。
 * · 人类主观判断仍然要做，这份只是让主观判断有个可比的底座。
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CHAT_READ_E2E, openFreshThread } from "./chat-task-workbench-fixture";
// 同一条用例里开第二条线程：只建线程、**不重新登录**（`openFreshThread` 内含登录，
// 再调一次会撞夹具那条「这个 page 已经登录了」的守卫）。
import { openAuthoritativeFreshThread } from "./support/authoritative-thread";
import {
  DIMENSIONS, renderScorecard, totalScore, type ProbeResult, type Scorecard,
} from "./support/chat-ux-rubric";
import BASELINE from "./support/chat-ux-baseline.json";

const OUT = join(process.cwd(), "../../evidence/local-desktop/chat-quality/ux-scorecard.md");

/** 发一条消息，不等落定——要量流式就不能先等它跑完。 */
async function send(page: Page, text: string): Promise<void> {
  await page.getByTestId("copilotkit-v2-input").fill(text);
  await page.getByTestId("copilotkit-v2-send").click();
}

async function settle(page: Page): Promise<void> {
  await expect(page.getByTestId("copilotkit-v2-running-indicator")).toHaveCount(0, { timeout: 120_000 });
}

const card: Record<number, ProbeResult> = {};
const record = (id: number, r: ProbeResult): void => { card[id] = r; };

test.describe.configure({ mode: "serial" });
/*
 * 每条探针都包含「发一轮 + 等它跑完」，慢跑剧本单轮就可能吃掉大半分钟；
 * 默认 120s 会让探针自己先超时——那样量到的是**我的超时设置**，不是产品。
 * 放到 240s，并把采样窗口收到 45s（超过就按「没等到足够样本」记分，而不是挂掉）。
 */
test.beforeEach(() => { test.setTimeout(240_000); });

test.describe("chat 体验评测集", () => {
  test("① 流式反馈：立刻有反馈，正文逐段出现", async ({ page }) => {
    await openFreshThread(page);  // 内部已含焐热 + 登录（见夹具头注）

    const t0 = Date.now();
    await send(page, CHAT_READ_E2E.deepAgentSlowTrigger);
    // (a) 发出去之后多久有**任何**视觉反馈（运行态指示器绘制）。
    await page.getByTestId("copilotkit-v2-running-indicator").first().waitFor({ timeout: 10_000 });
    const firstFeedbackMs = Date.now() - t0;

    // (b) assistant 正文是否逐段变长（而不是跑完一次性出现）。
    const lengths: number[] = [];
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline && lengths.length < 6) {
      /*
       * ⚠ 必须先 count 再取文本，并给**短超时**。第一版直接 `.textContent()`：
       * 气泡还没出现时，每次调用都按 locator 的默认超时阻塞住，一次迭代就吃掉整个
       * 用例预算——量到的是我的超时设置，不是产品的流式表现。240s 那两次超时都是它。
       */
      const bubbles = await page.getByTestId("copilot-assistant-message").count();
      const text = bubbles > 0
        ? await page.getByTestId("copilot-assistant-message").last()
            .textContent({ timeout: 1_000 }).catch(() => null)
        : null;
      const n = (text ?? "").length;
      if (n > 0 && n !== lengths.at(-1)) lengths.push(n);
      await page.waitForTimeout(120);
      if (await page.getByTestId("copilotkit-v2-running-indicator").count() === 0) break;
    }
    await settle(page);

    const fast = firstFeedbackMs <= 1_200;          // 验收文档 SLO 的 PR 硬上限
    const streamed = lengths.length >= 4;            // 「至少 4 个不同长度样本」
    record(1, {
      measured: true,
      score: (fast ? 0.5 : 0) + (streamed ? 0.5 : 0),
      evidence: `首次反馈 ${String(firstFeedbackMs)}ms（≤1200 得 0.5）；正文长度样本 ${String(lengths.length)} 个（≥4 得 0.5）：${lengths.join("→")}`,
    });
  });

  test("②③④ 规划、工具可见、真实多步", async ({ page }) => {
    await openFreshThread(page);  // 内部已含焐热 + 登录（见夹具头注）
    await send(page, CHAT_READ_E2E.deepAgentMultiStepTrigger);
    await settle(page);

    // ② 执行工具之前是否先说了要做什么：计划面板或进展摘要里有非空文本。
    /*
     * ⚠ 第一版这里写的是 `chat-task-workbench-plan-item`——**那个 testid 根本不存在**，
     * 于是量出 0 条、判 0.5 分。0 分要先证明探针不瞎：真实的是 `agent-plan-item-N`
     * （`agent-plan-panel.tsx`）。下面 `expect` 那条正面断言就是防它再瞎一次。
     */
    const planCount = await page.locator('[data-testid^="agent-plan-item-"]').count()
      .catch(() => 0);
    const progressCount = await page.getByTestId("run-trace-progress-markdown").count()
      .catch(() => 0);
    /*
     * 「有没有计划」与「用户看不看得见」是两件事，分开量。
     * 右栏默认折叠（#2695），计划面板挂在里面——信息存在但默认不可见，
     * 与信息根本不存在，是完全不同的缺陷，修法也不同。
     */
    const expand = page.getByTestId("chat-task-workbench-inspector-expand");
    if (await expand.count() > 0) await expand.first().click();
    const planAfterExpand = await page.locator('[data-testid^="agent-plan-item-"]').count().catch(() => 0);

    record(2, {
      measured: true,
      score: planCount > 0 ? 1 : planAfterExpand > 0 ? 0.6 : progressCount > 0 ? 0.3 : 0,
      evidence: `默认可见的计划条目 ${String(planCount)} 条、展开右栏后 ${String(planAfterExpand)} 条、`
        + `进展摘要 ${String(progressCount)} 段（默认就看得见 1 分；要展开才看得见 0.6；只有进展摘要 0.3）`,
    });

    // ③ 工具调用可见：展开执行过程，看行上是否有中文名 + 调用对象 + 终态图标。
    const toggle = page.getByTestId("chat-task-workbench-trace-toggle");
    if (await toggle.count() > 0) await toggle.first().click();
    const rows = page.getByTestId("chat-task-workbench-event-row");
    const rowCount = await rows.count();
    const firstRow = rowCount > 0 ? (await rows.first().textContent()) ?? "" : "";
    const statusIcons = await page.getByTestId("run-trace-entry-status-icon").count();
    const hasChineseLabel = /[一-龥]/.test(firstRow);
    record(3, {
      measured: true,
      score: (rowCount > 0 ? 0.4 : 0) + (hasChineseLabel ? 0.3 : 0) + (statusIcons > 0 ? 0.3 : 0),
      evidence: `执行过程 ${String(rowCount)} 行、终态图标 ${String(statusIcons)} 个、首行「${firstRow.trim().slice(0, 40)}」`,
    });

    // ④ 真实多步：不同工具调用 ≥2 次，且不是同一条重复。
    const toolNames = new Set<string>();
    for (let i = 0; i < rowCount; i += 1) {
      toolNames.add(((await rows.nth(i).textContent()) ?? "").trim());
    }
    record(4, {
      measured: true,
      score: toolNames.size >= 3 ? 1 : toolNames.size === 2 ? 0.6 : toolNames.size === 1 ? 0.3 : 0,
      evidence: `不同执行行 ${String(toolNames.size)} 种（≥3 得 1 分）`,
    });
  });

  test("⑥ 多轮上下文：追问不需要重复交代背景", async ({ page }) => {
    await openFreshThread(page);  // 内部已含焐热 + 登录（见夹具头注）
    await send(page, CHAT_READ_E2E.deepAgentMultiStepTrigger);
    await settle(page);
    const firstCount = await page.getByTestId("copilot-assistant-message").count();

    await send(page, "再详细一点");
    await settle(page);
    const secondCount = await page.getByTestId("copilot-assistant-message").count();

    /*
     * loopback 替身不会真的「理解上下文」，所以这里量的是**链路**：追问是否在同一条
     * 线程上产生了新的一轮回复，而不是报错/丢线程/新开会话。语义上的记忆要真实模型
     * 才能判，那条归真实模型车道（`real-model-e2e.md`），不在这里假装量到了。
     */
    record(6, {
      measured: true,
      score: secondCount > firstCount ? 0.6 : 0,
      evidence: `首轮 ${String(firstCount)} 条 → 追问后 ${String(secondCount)} 条回复；`
        + `上限 0.6：loopback 替身判不了「真的记得」，语义记忆归真实模型车道`,
    });
  });

  test("⑦ 错误处理透明度：失败要如实出现，并给下一步", async ({ page }) => {
    await openFreshThread(page);  // 内部已含焐热 + 登录（见夹具头注）
    await send(page, CHAT_READ_E2E.deepAgentFailureTrigger);
    await settle(page);

    const body = (await page.locator("main").innerText().catch(() => "")) ?? "";
    const failureVisible = /失败|没能|出错|未完成/.test(body);
    const nextStep = /下一步|再试|重试|检查|稍后/.test(body);
    // 内部错误码不该上屏（与 lint-user-facing-error-text 同一条纪律）。
    const rawCode = /[A-Z][A-Z0-9]{2,}_[A-Z]/.test(body);
    record(7, {
      measured: true,
      score: (failureVisible ? 0.5 : 0) + (nextStep ? 0.3 : 0) + (rawCode ? 0 : 0.2),
      evidence: `失败可见=${String(failureVisible)}、有下一步=${String(nextStep)}、`
        + `屏上出现内部错误码=${String(rawCode)}`,
    });
  });

  test("⑧ 消息呈现质量：markdown 真渲染，不是原始文本", async ({ page }) => {
    await openFreshThread(page);  // 内部已含焐热 + 登录（见夹具头注）
    await send(page, CHAT_READ_E2E.deepAgentMarkdownTrigger);
    await settle(page);

    const last = page.getByTestId("copilot-assistant-message").last();
    const present = await last.count() > 0;
    const html = present ? (await last.innerHTML({ timeout: 5_000 }).catch(() => "")) : "";
    const text = present ? (await last.textContent({ timeout: 5_000 }).catch(() => "")) ?? "" : "";
    const rendered = /<(h[1-6]|ul|ol|pre|code|table|strong)\b/.test(html);
    const rawMarkdown = /(^|\n)#{1,6}\s|\*\*[^*]+\*\*|```/.test(text);
    record(8, {
      measured: true,
      score: (rendered ? 0.6 : 0) + (rawMarkdown ? 0 : 0.4),
      evidence: `渲染出结构标签=${String(rendered)}、正文里仍有原始 markdown 记号=${String(rawMarkdown)}`,
    });
  });

  test("⑨ 控制感：跑的时候看得见「现在在做什么」", async ({ page }) => {
    await openFreshThread(page);  // 内部已含焐热 + 登录（见夹具头注）
    await send(page, CHAT_READ_E2E.deepAgentSlowTrigger);

    await page.getByTestId("copilotkit-v2-running-indicator").first().waitFor({ timeout: 10_000 });

    /*
     * ⚠ 量的是**整段过程**，不是某一瞬间。前两版都栽在采样点上：
     *   · 第一版一出现运行指示器就取一次，那时状态条还没挂载（`!active` 返回 null）；
     *   · 第二版轮询到它出现，但只在最开头取两次 —— 那个窗口里一条工具都还没收尾，
     *     `settledLabel` 自然还没东西可说，于是读到两次一模一样的「正在推进任务」，
     *     被我记成「文案一字不变」。那是我的采样窗口，不是产品的表现。
     * 现在整轮每 500ms 采一次，收集**不同文案的个数**：用户看的是一段过程，
     * 判据也该打在一段过程上。
     */
    const strip = page.getByTestId("run-trace-live-strip");
    const seen: string[] = [];
    const rowSamples: number[] = [];
    const runDeadline = Date.now() + 90_000;
    while (Date.now() < runDeadline) {
      if (await strip.count() > 0) {
        const t = ((await strip.first().textContent({ timeout: 1_000 }).catch(() => "")) ?? "").trim();
        if (t !== "" && t !== seen.at(-1)) seen.push(t);
      }
      // 同时记录「此刻执行过程有几行」——用来分清两件完全不同的事：
      //   · 状态条文案不变，但行数在涨 ⇒ 事件到了，是**文案逻辑**的问题；
      //   · 行数也一直是 0 ⇒ 运行期间事件**根本没到前端**，那是链路问题，改文案没用。
      rowSamples.push(await page.getByTestId("chat-task-workbench-event-row").count());
      if (await page.getByTestId("copilotkit-v2-running-indicator").count() === 0) break;
      await page.waitForTimeout(500);
    }
    const rowsAfterSettle = await page.getByTestId("chat-task-workbench-event-row").count();
    await settle(page);

    const appeared = seen.length > 0;
    const distinct = new Set(seen).size;
    const waited = seen.map((t) => /已等待 (\d+) 秒/.exec(t)?.[1]).filter((n): n is string => n !== undefined);
    const elapsedShown = waited.length >= 2 && Number(waited.at(-1)) > Number(waited[0]);

    /*
     * ⚠ 第二个场景，必须换剧本。
     *
     * 上面用的是**静默**剧本（模拟模型思考，期间一条步骤都不收尾）——在它身上问
     * 「界面报不报得出刚完成了哪一步」是不可能成立的，那不是产品的问题，是我拿错了剧本。
     * 判据 ⑨ 其实是两件事：静默时别看起来像卡死（上面那段），以及有进展时说得出进展。
     * 所以这里再跑一轮**逐步推进**的剧本（十步滚动，事件逐个发出来）专门量后者。
     */
    await openAuthoritativeFreshThread(page);
    await send(page, CHAT_READ_E2E.deepAgentScrollAcceptanceTrigger);
    const activeSeen: string[] = [];
    const activeDeadline = Date.now() + 90_000;
    while (Date.now() < activeDeadline) {
      if (await strip.count() > 0) {
        const t = ((await strip.first().textContent({ timeout: 1_000 }).catch(() => "")) ?? "").trim();
        if (t !== "" && t !== activeSeen.at(-1)) activeSeen.push(t);
      }
      if (await page.getByTestId("copilotkit-v2-running-indicator").count() === 0) break;
      await page.waitForTimeout(500);
    }
    await settle(page);
    const namedAction = activeSeen.some((t) => /刚完成|刚失败|已完成 \d+ 个动作/.test(t));

    record(9, {
      measured: true,
      /*
       * ⚠ 判据不能只数「文案变了几种」——那样一个光会跳秒数的时钟就能买满分。
       * 三件分开给分：条在（0.3）、有随时间增长的**等待时长**（0.3，「没卡死」的真信号）、
       * 以及至少出现过一次**指名具体动作**的文案（0.4，这才是「现在在做什么」）。
       */
      score: (appeared ? 0.3 : 0) + (elapsedShown ? 0.3 : 0) + (namedAction ? 0.4 : 0),
      evidence: `整轮采样：状态条出现=${String(appeared)}、不同文案 ${String(distinct)} 种`
        + `、等待时长在增长=${String(elapsedShown)}、出现过指名动作的文案=${String(namedAction)}：${[...new Set(seen)].slice(0, 4).map((t) => `「${t.slice(0, 24)}」`).join("→")}`
        + `；静默剧本行数 ${rowSamples.join("/")} → 落定 ${String(rowsAfterSettle)}`
        + `；逐步剧本文案 ${[...new Set(activeSeen)].slice(0, 3).map((t) => `「${t.slice(0, 26)}」`).join("→")}`,
    });
  });

  test("⑩ 整体连贯性：没有假按钮、没有页面错误", async ({ page }) => {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

    await openFreshThread(page);  // 内部已含焐热 + 登录（见夹具头注）
    await send(page, CHAT_READ_E2E.deepAgentMultiStepTrigger);
    await settle(page);

    /*
     * 「假按钮」的机械判据：可见、可点、但既没有 onclick 也不是表单提交——
     * 这判不了「点了什么都不发生」的全部情形，所以它是**下界不是上界**。
     * 量得到的那部分先量，量不到的不假装量到了。
     */
    const deadButtons = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll("button"))) {
        const b = el as HTMLButtonElement;
        if (b.disabled || b.offsetParent === null) continue;
        const labelled = (b.getAttribute("aria-label") ?? b.textContent ?? "").trim();
        if (labelled === "") out.push(b.getAttribute("data-testid") ?? "(无名按钮)");
      }
      return out;
    });

    record(10, {
      measured: true,
      score: (pageErrors.length === 0 ? 0.5 : 0) + (consoleErrors.length === 0 ? 0.2 : 0)
        + (deadButtons.length === 0 ? 0.3 : 0),
      evidence: `pageerror ${String(pageErrors.length)} 条、console.error ${String(consoleErrors.length)} 条、`
        + `无可访问名的可点按钮 ${String(deadButtons.length)} 个 ${deadButtons.slice(0, 3).join("/")}`,
    });
  });

  test("落记分卡", async () => {
    // ⑤ 语音：本轮没有探针。**按 0 计入，但标成「未量」**，不混进已验证的缺陷里。
    const scorecard: Scorecard = card;
    const md = renderScorecard(scorecard);
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, `${md}\n`, "utf8");
    // eslint-disable-next-line no-console
    console.log(`\n${md}\n`);

    // 十项里每一项要么量到、要么显式缺席——不允许静默漏项。
    for (const d of DIMENSIONS) {
      if (d.id === 5) continue;
      expect(scorecard[d.id], `维度 ${String(d.id)} ${d.name} 没有探针结果`).toBeDefined();
    }
    /*
     * 棘轮：总分只准涨不准跌。不设这一条，这个 spec 就只是一份报告——
     * 明天有人把实时状态条改回不变文案，记分卡上那一格悄悄从 0.5 掉到 0，没有人会知道。
     * 逐维度也判：总分不变但某一项掉下去（另一项恰好涨上来）同样是回归。
     */
    const total = totalScore(scorecard);
    expect(total, `总分跌破基线 ${String(BASELINE.total)}（回归）`).toBeGreaterThanOrEqual(BASELINE.total);
    for (const d of DIMENSIONS) {
      const base = (BASELINE.perDimension as Record<string, number>)[String(d.id)] ?? 0;
      const now = scorecard[d.id]?.measured === true ? scorecard[d.id]!.score : 0;
      expect(now, `维度 ${String(d.id)} ${d.name} 从 ${String(base)} 跌到 ${String(now)}`)
        .toBeGreaterThanOrEqual(base);
    }
  });
});
