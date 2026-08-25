import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  ACCEPTANCE_DOC,
  CHAT_READ_E2E,
  gapMessage,
  openFreshThread,
} from "./chat-task-workbench-fixture";

/**
 * issue #2068 —— **无障碍（TW-A11Y-1 ~ 8）**（判据见 `${ACCEPTANCE_DOC}` 第五节）。
 *
 * 人类 2026-08-26 明确要求：**截图只能看出风险，必须实测**。因此这份 spec 全部是
 * 真栈里对真实 DOM 的机械测量，不是对着设计稿的目视判断。
 *
 * ## 与既有 axe spec 的边界（不重复）
 * `axe-keyboard-focus.spec.ts` / `axe-image-alt.spec.ts` 跑的是 `/kitchen-sink`
 * （设计系统活文档，不读 DB、不登录）。本 spec 跑的是**登录后的真实 `/chat` 工作台**——
 * 同一套 axe 规则打在不同表面上，覆盖的是 kitchen-sink 里根本不存在的
 * composer / 线程列表 / HITL 弹窗 / 运行状态这些结构。不是把那两条重跑一遍。
 *
 * `chat-keyboard-navigation.spec.ts`（F05）覆盖的是既有 `/chat` 线程间键盘导航；
 * 本 spec 覆盖的是**任务工作台新增结构**的可达性（六态指示器、Inspector 页签、
 * 审批卡、语音状态），两者锚点不重叠。
 */

test.setTimeout(240_000);

test("TW-A11Y-1：/chat 工作台对比度零违规（axe color-contrast，含灰色辅助文字）", async ({ page }) => {
  await openFreshThread(page);

  const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
  const detail = results.violations
    .flatMap((v) => v.nodes.map((n) => `${v.id} @ ${n.target.join(" ")} :: ${n.failureSummary ?? ""}`))
    .join("\n");
  expect(
    results.violations,
    [
      "【差距 TW-A11Y-1 / TW-P2-4】/chat 存在对比度违规（灰色辅助文字是常见来源）。",
      detail,
      `判据见 ${ACCEPTANCE_DOC} 的无障碍一节。`,
    ].join("\n"),
  ).toEqual([]);
});

test("TW-A11Y-2/3：小图标与圆形按钮点击区 ≥24×24，且仅图标按钮有可访问名", async ({ page }) => {
  await openFreshThread(page);

  const offenders = await page.evaluate(() => {
    const tooSmall: string[] = [];
    const unnamed: string[] = [];
    for (const el of Array.from(document.querySelectorAll("button, [role='button']"))) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue; // 未渲染/隐藏
      const id = el.getAttribute("data-testid") ?? el.className?.toString().slice(0, 60) ?? "(anonymous)";
      if (rect.width < 24 || rect.height < 24) {
        tooSmall.push(`${id} → ${Math.round(rect.width)}×${Math.round(rect.height)}`);
      }
      const visibleText = (el.textContent ?? "").trim();
      const accessibleName =
        el.getAttribute("aria-label")
        ?? el.getAttribute("title")
        ?? (el.getAttribute("aria-labelledby")
          ? document.getElementById(el.getAttribute("aria-labelledby") as string)?.textContent ?? ""
          : "")
        ?? "";
      if (!visibleText && !accessibleName.trim()) unnamed.push(id);
    }
    return { tooSmall, unnamed };
  });

  expect(
    offenders.tooSmall,
    [
      "【差距 TW-A11Y-2】以下按钮点击区小于 24×24 CSS px：",
      offenders.tooSmall.join("\n"),
      `判据见 ${ACCEPTANCE_DOC} 的 TW-A11Y-2。`,
    ].join("\n"),
  ).toEqual([]);

  expect(
    offenders.unnamed,
    [
      "【差距 TW-A11Y-3】以下仅图标按钮没有可访问名（屏幕阅读器读不出来）：",
      offenders.unnamed.join("\n"),
      `判据见 ${ACCEPTANCE_DOC} 的 TW-A11Y-3。`,
    ].join("\n"),
  ).toEqual([]);
});

test("TW-A11Y-4：Agent 状态 / 工具完成 / 审批请求有 live region 播报", async ({ page }) => {
  await openFreshThread(page);

  const liveRegions = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[aria-live], [role='status'], [role='alert'], [role='log']")).map(
      (el) => el.getAttribute("data-testid") ?? el.tagName.toLowerCase(),
    ),
  );
  expect(
    liveRegions.length,
    [
      "【差距 TW-A11Y-4】/chat 工作台没有任何 live region——Agent 状态变化、工具完成、",
      "审批请求对屏幕阅读器用户完全静默（他们只能靠反复 Tab 去探测发生了什么）。",
      "锚点待实现为 data-testid=chat-task-workbench-live-announcer（role=status aria-live=polite）。",
      `判据见 ${ACCEPTANCE_DOC} 的 TW-A11Y-4。`,
    ].join("\n"),
  ).toBeGreaterThan(0);

  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentApprovalTrigger);
  await page.getByTestId("copilotkit-v2-send").click();

  // 审批请求这件事必须被播报出来——它是需要用户做决定的时刻，静默等于卡死。
  const announcer = page.getByTestId("chat-task-workbench-live-announcer");
  await expect(
    announcer,
    gapMessage("TW-A11Y-4", "chat-task-workbench-live-announcer", "审批请求没有被 live region 播报"),
  ).toBeVisible({ timeout: 120_000 });
  expect((await announcer.innerText()).trim().length, "播报内容不能为空").toBeGreaterThan(0);
});

test("TW-A11Y-5：审批弹窗焦点锁定 + Esc 关闭 + 焦点返回原处", async ({ page }) => {
  await openFreshThread(page);
  const composer = page.getByTestId("copilotkit-v2-input");
  await composer.fill(CHAT_READ_E2E.deepAgentApprovalTrigger);
  await page.getByTestId("copilotkit-v2-send").click();

  const dialog = page.getByTestId("copilotkit-v2-hitl-dialog");
  await expect(dialog).toBeVisible({ timeout: 120_000 });

  // ① 焦点锁定：连按 Tab 若干次，焦点必须始终落在弹窗内。
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press("Tab");
    const insideDialog = await page.evaluate(() => {
      const active = document.activeElement;
      const dlg = document.querySelector('[data-testid="copilotkit-v2-hitl-dialog"]');
      return Boolean(active && dlg && dlg.contains(active));
    });
    expect(
      insideDialog,
      [
        `【差距 TW-A11Y-5】第 ${i + 1} 次 Tab 后焦点逃出了审批弹窗——没有焦点锁定。`,
        "键盘用户会在弹窗背后的界面里迷路，且可能在看不见的地方触发操作。",
        `判据见 ${ACCEPTANCE_DOC} 的 TW-A11Y-5。`,
      ].join("\n"),
    ).toBe(true);
  }

  // ② Esc 关闭 + ③ 焦点返回触发它的地方。
  await page.keyboard.press("Escape");
  await expect(dialog, "TW-A11Y-5：Esc 没能关闭审批弹窗").toHaveCount(0, { timeout: 10_000 });
  const focusReturned = await page.evaluate(
    () => document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.tagName ?? "",
  );
  expect(
    focusReturned,
    [
      "【差距 TW-A11Y-5】弹窗关闭后焦点没有回到原处（落在了 " + focusReturned + "）。",
      "键盘用户会被弹回文档开头，丢失上下文。",
      `判据见 ${ACCEPTANCE_DOC} 的 TW-A11Y-5。`,
    ].join("\n"),
  ).toMatch(/copilotkit-v2-(input|send)/);
});

test("TW-A11Y-6：语音状态不能只靠颜色（须并存文本或图标差异）", async ({ page }) => {
  await openFreshThread(page);

  /*
   * ⚠ 这条**收紧**过一次（issue #2075，如实记录，不是悄悄改）。
   *
   * 原判据是在一个**没有在录音**的页面上扫 `chat-mic-connecting` /
   * `chat-mic-listening` / `chat-mic-stopping` / `chat-mic-error` 这四个**状态**锚点，
   * 要求至少命中一个。这四个按定义只在对应状态下渲染 ⇒ 静止页面上恒零命中，
   * 于是这条判据要么恒红，要么逼实现方在闲置态也挂一个「正在听……」的假状态节点
   * ——后者比没有骨架/没有状态更坏。
   *
   * 改成**真的把录音开起来再看**：本 config 已接了确定性 ASR 替身
   * （`loopback-asr-provider.ts`，`copilotkit-v2-voice-input.spec.ts` 的既有用法），
   * 点一下麦克风就进真实录音态。然后验这条真正要问的事——状态是不是**只**靠颜色：
   * 录音态必须同时有①非空文本、②按钮上可读的状态属性（`aria-pressed` /
   * `data-mic-status`）、③变化了的可访问名。比"四个锚点里有一个存在"严得多。
   */
  const micButton = page.getByTestId("chat-mic-button");
  await expect(micButton).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByTestId("chat-mic-listening")).toHaveCount(0);
  // 闲置态：按钮不得声称自己在录音。
  await expect(micButton).toHaveAttribute("data-mic-status", "idle");
  await expect(micButton).toHaveAttribute("aria-pressed", "false");

  await micButton.click();
  const listening = page.getByTestId("chat-mic-listening");
  await expect(
    listening,
    [
      "【差距 TW-A11Y-6】点了麦克风之后没有任何可读的录音状态节点——",
      "若录音态只是把按钮染红，色觉障碍用户与屏幕阅读器用户都读不出它在录音。",
      `判据见 ${ACCEPTANCE_DOC} 的 TW-A11Y-6。`,
    ].join("\n"),
  ).toBeVisible({ timeout: 30_000 });

  expect(
    (await listening.innerText()).trim().length,
    "【差距 TW-A11Y-6】录音状态节点没有文本，等于只靠颜色/动画表达状态。",
  ).toBeGreaterThan(0);

  await expect(
    micButton,
    "【差距 TW-A11Y-6】录音中麦克风按钮的 aria-pressed 没有翻真，状态只活在颜色里。",
  ).toHaveAttribute("aria-pressed", "true");
  await expect(micButton).toHaveAttribute("data-mic-status", "listening");
  await expect(
    micButton,
    "【差距 TW-A11Y-6】录音中按钮的可访问名没变，屏幕阅读器读到的仍是「开始语音输入」。",
  ).toHaveAttribute("aria-label", "停止语音输入");

  // 收尾：停掉录音，别把一条开着的采音管线留给后面的用例。
  await micButton.click();
  await expect(listening).toHaveCount(0, { timeout: 30_000 });
});

test("TW-A11Y-7：200% 缩放与窄屏重排不产生横向滚动", async ({ page }) => {
  await openFreshThread(page);

  // 200% 缩放 ≈ 视口 CSS 像素折半（WCAG 1.4.4 的等效实测手法）。
  await page.setViewportSize({ width: 640, height: 480 });
  await page.waitForTimeout(500);
  const zoomOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(
    zoomOverflow,
    [
      `【差距 TW-A11Y-7】200% 缩放等效视口下横向溢出 ${zoomOverflow}px。`,
      "低视力用户放大后必须左右拖动才能读完一行。",
      `判据见 ${ACCEPTANCE_DOC} 的 TW-A11Y-7。`,
    ].join("\n"),
  ).toBeLessThanOrEqual(1);

  // 窄屏重排。
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(500);
  const narrowOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(
    narrowOverflow,
    `【差距 TW-A11Y-7】375px 窄屏下横向溢出 ${narrowOverflow}px（应重排，不是横滚）。`,
  ).toBeLessThanOrEqual(1);
});

test("TW-A11Y-8：Tab 顺序与焦点可见性（axe cat.keyboard 打在真实 /chat 上）", async ({ page }) => {
  await openFreshThread(page);

  const results = await new AxeBuilder({ page }).withTags(["cat.keyboard"]).analyze();
  const detail = results.violations
    .flatMap((v) => v.nodes.map((n) => `${v.id} @ ${n.target.join(" ")}`))
    .join("\n");
  expect(
    results.violations,
    ["【差距 TW-A11Y-8】/chat 键盘规则违规：", detail].join("\n"),
  ).toEqual([]);

  // 焦点可见性：逐个 Tab，聚焦元素必须有可见的焦点样式（outline 或 box-shadow）。
  const invisible: string[] = [];
  for (let i = 0; i < 15; i += 1) {
    await page.keyboard.press("Tab");
    const probe = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const style = window.getComputedStyle(el);
      const hasOutline = style.outlineStyle !== "none" && parseFloat(style.outlineWidth || "0") > 0;
      const hasShadow = style.boxShadow !== "none" && style.boxShadow !== "";
      return {
        id: el.getAttribute("data-testid") ?? el.tagName.toLowerCase(),
        visible: hasOutline || hasShadow,
      };
    });
    if (probe && !probe.visible) invisible.push(probe.id);
  }
  expect(
    invisible,
    [
      "【差距 TW-A11Y-8】以下元素获得焦点时没有任何可见焦点样式：",
      invisible.join(", "),
      `判据见 ${ACCEPTANCE_DOC} 的 TW-A11Y-8。`,
    ].join("\n"),
  ).toEqual([]);
});
