import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { ACCEPTANCE_DOC, expectAnchor, gapMessage, openFreshThread } from "./chat-task-workbench-fixture";

/**
 * issue #2068 —— **P2 精致度（TW-P2-1 ~ 8）**（判据见 `${ACCEPTANCE_DOC}` 第五节）。
 *
 * 人类 2026-08-26 审计原话：
 * > 中央内容合理最大宽度（约 720–880px，不许输入框横跨两千像素）；减少大面积边框，
 * > 靠背景层级/间距/局部卡片建立结构；标题/正文/辅助至少三个字阶；灰色辅助文字提高
 * > 对比度；颜色间距圆角阴影全部走设计系统语义变量（不许页面自创）；对话列表要有
 * > 选中态/悬停操作/置顶/搜索/更多菜单；Skeleton + 空态 + 错误态 + 恢复态；动画只用于
 * > 状态迁移（计划展开/步骤完成/产物生成/审批暂停），不许无意义缩放漂浮。
 *
 * ## 边界（不重复声明）
 * 「配色/组件形状是否照抄原型」属于 `.harness/rubrics/chat-main-fidelity-rubric.md`，
 * 本 spec 不评。本 spec 只取**可机械测量的结构事实**：宽度、字阶数、语义变量、
 * 列表操作齐不齐、四态齐不齐。目视审美不写进机械门控——写了也只会变成假绿。
 *
 * 「灰色辅助文字对比度」（TW-P2-4）不在这里重复实现：由
 * `chat-task-workbench-a11y.spec.ts` 的 TW-A11Y-1（axe color-contrast）一并覆盖。
 * 「减少大面积边框」（TW-P2-2）与「动画只用于状态迁移」（TW-P2-8）是审美判断，
 * 本 spec **不做假的机械近似**——它们留给人类目视复核，在验收卡里如实标注。
 */

test.setTimeout(180_000);

test("TW-P2-1：中央内容最大宽度落在 720–880px（输入框不得横跨全屏）", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openFreshThread(page);

  const box = await page.getByTestId("copilotkit-v2-input").boundingBox();
  expect(box, "输入框应可测量").toBeTruthy();
  const width = (box as { width: number }).width;

  expect(
    width,
    [
      `【差距 TW-P2-1】1920px 视口下中央输入框实测宽 ${Math.round(width)}px。`,
      "审计原话：中央内容合理最大宽度约 720–880px，不许输入框横跨两千像素。",
      "过宽的行长让阅读回扫困难，也让工作台看起来像一个没有布局的容器。",
      `判据见 ${ACCEPTANCE_DOC} 的 TW-P2-1。`,
    ].join("\n"),
  ).toBeLessThanOrEqual(880);
  expect(width, `TW-P2-1：中央内容 ${Math.round(width)}px 过窄（下限 720px）`).toBeGreaterThanOrEqual(720);
});

test("TW-P2-3：标题 / 正文 / 辅助至少三个字阶", async ({ page }) => {
  await openFreshThread(page);

  const scales = await page.evaluate(() => {
    const sizes = new Set<number>();
    const root = document.querySelector("main") ?? document.body;
    for (const el of Array.from(root.querySelectorAll("*"))) {
      // 只数自己直接承载文本的节点，避免把容器的继承字号重复计进来。
      const own = Array.from(el.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim().length > 0,
      );
      if (!own) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      sizes.add(Math.round(parseFloat(window.getComputedStyle(el).fontSize)));
    }
    return Array.from(sizes).sort((a, b) => a - b);
  });

  expect(
    scales.length,
    [
      `【差距 TW-P2-3】/chat 实测只有 ${scales.length} 个字阶：${scales.join(" / ")}px。`,
      "标题/正文/辅助至少三档，否则界面没有信息层级，全部内容看起来同等重要。",
      `判据见 ${ACCEPTANCE_DOC} 的 TW-P2-3。`,
    ].join("\n"),
  ).toBeGreaterThanOrEqual(3);
});

/**
 * TW-P2-5 的判定放在**源码层**而不是浏览器层，是刻意的：computed style 最终都会被
 * 解析成具体的 rgb/px 值，从浏览器里根本区分不出「走了 token」还是「页面自创」。
 * 唯一能机械区分两者的地方就是源码里写的是 `bg-surface-2` 还是 `bg-[#f5f5f5]`。
 */
const CHAT_SOURCES = [
  "components/chat/copilotkit-v2-panel.tsx",
  "components/chat/copilotkit-v2-shell.tsx",
  "components/chat/copilotkit-v2-tool-renderers.tsx",
  "components/chat/chat-composer-pickers.tsx",
];

test("TW-P2-5：颜色 / 圆角 / 阴影走设计系统语义变量，页面不自创裸值", async () => {
  const offenders: string[] = [];
  for (const relative of CHAT_SOURCES) {
    const absolute = join(__dirname, "..", relative);
    const source = readFileSync(absolute, "utf8");
    let inBlockComment = false;
    source.split("\n").forEach((line, index) => {
      /*
       * ⚠ 首轮实测这条判据是**假阳性**：原正则 `/#[0-9a-fA-F]{3,8}\b/` 把注释里的
       * issue 号逐个当成了颜色（`#2023` / `#1987` / `#787` 全部命中），报出一堆
       * 「裸 hex」，而它们一个都不是颜色。本仓 commit message 与代码注释里 issue 号
       * 极其密集，这个形状注定误报。
       *
       * 修法：① 跳过注释行（行注释与块注释）；② 裸 hex 必须落在**颜色上下文**里
       * ——引号内的值、CSS 属性值、或 style 对象——而不是散落在散文里。
       */
      const trimmed = line.trim();
      if (inBlockComment) {
        if (trimmed.includes("*/")) inBlockComment = false;
        return;
      }
      if (trimmed.startsWith("/*")) {
        if (!trimmed.includes("*/")) inBlockComment = true;
        return;
      }
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;

      // 颜色上下文里的裸 hex：`"#fff"` / `: #fff` / `[#fff]`。
      const bareHex = /["'`:\[(]\s*#[0-9a-fA-F]{3,8}\b/.exec(line);
      const arbitrary = /(bg|text|border|ring|shadow|rounded)-\[[^\]]+\]/.exec(line);
      if (bareHex) offenders.push(`${relative}:${index + 1} 裸 hex ${bareHex[0].trim()} → ${line.trim().slice(0, 100)}`);
      if (arbitrary) offenders.push(`${relative}:${index + 1} 任意值 ${arbitrary[0]} → ${line.trim().slice(0, 100)}`);
    });
  }

  expect(
    offenders,
    [
      "【差距 TW-P2-5】/chat 组件里存在页面自创的裸值，没走设计系统语义变量：",
      offenders.join("\n"),
      "自创值是「同一事实声明在两处」在样式层的形态——设计 token 一改，这些地方不会跟着变。",
      `判据见 ${ACCEPTANCE_DOC} 的 TW-P2-5。`,
    ].join("\n"),
  ).toEqual([]);
});

test("TW-P2-6：对话列表有选中态 / 悬停操作 / 置顶 / 搜索 / 更多菜单", async ({ page }) => {
  await openFreshThread(page);

  const sidebar = page.getByTestId("copilotkit-v2-thread-sidebar");
  await expect(sidebar).toBeVisible({ timeout: 30_000 });

  // 选中态：当前线程必须在列表里被标出来（`aria-current` 或 `data-selected`）。
  const selected = sidebar.locator("[aria-current='true'], [data-selected='true']");
  expect(
    await selected.count(),
    gapMessage("TW-P2-6", "chat-thread-<id>", "对话列表没有可判定的选中态，用户看不出自己在哪条线程上"),
  ).toBeGreaterThan(0);

  // 搜索与置顶是列表规模变大后唯一的活路。
  await expectAnchor(page, "chat-task-workbench-thread-search", "TW-P2-6", "对话列表没有搜索", 15_000);

  /*
   * ⚠ 置顶这条**收紧**过一次（issue #2075，如实记录，不是悄悄改）。
   *
   * 原判据是 `expectAnchor(page, "chat-task-workbench-thread-pin", …)`，即
   * `page.getByTestId(...)` 后直接 `toBeVisible()`。置顶是**逐卡片**的操作，列表里有
   * 几条对话就有几个同名锚点 ⇒ Playwright strict mode violation，报出来的是
   * "resolved to N elements"，**不是**那句写好的差距文案。也就是说：能力真做出来之后
   * 这条用例仍会因为一个与产品无关的理由继续红，读的人只会以为置顶没做。
   * 本 spec 自己对同样逐卡片的 `chat-thread-card-menu-trigger` 用的就是 `.first()`
   * （见下一段），这里沿用作者自己的约定。
   *
   * 同时**补了一条原来没有的行为断言**：点一下必须真的置顶（`aria-pressed` 翻真，
   * 且这条卡片排进列表最前的「置顶」组）。原判据只看"按钮在不在"，一个点了没反应的
   * 假按钮照样能过；现在过不了。净效果是更严，不是更松。
   */
  const pin = sidebar.getByTestId("chat-task-workbench-thread-pin").first();
  await expect(
    pin,
    gapMessage("TW-P2-6", "chat-task-workbench-thread-pin", "对话列表不能置顶"),
  ).toBeVisible({ timeout: 15_000 });
  await expect(pin, "TW-P2-6：置顶按钮初始应为未置顶").toHaveAttribute("aria-pressed", "false");
  await pin.click();
  await expect(
    sidebar.getByTestId("chat-task-workbench-thread-pin").first(),
    "TW-P2-6：点了置顶按钮但状态没变——这是一个点了没反应的假按钮",
  ).toHaveAttribute("aria-pressed", "true", { timeout: 10_000 });
  await expect(
    sidebar.getByTestId("copilotkit-v2-thread-list").locator("p").first(),
    "TW-P2-6：置顶后列表第一组应是「置顶」组，否则置顶没有真的改变排序",
  ).toHaveText("置顶", { timeout: 10_000 });

  // 更多菜单：既有实现已有 `chat-thread-card-menu-trigger`，这里是防回归。
  await expect(
    sidebar.getByTestId("chat-thread-card-menu-trigger").first(),
    "TW-P2-6：对话卡片没有「更多」菜单",
  ).toBeVisible({ timeout: 15_000 });
});

test("TW-P2-7：Skeleton + 空态 + 错误态 + 恢复态四态齐", async ({ page }) => {
  await openFreshThread(page);

  // ① 空态（既有 `chat-artifacts-empty` / `chat-materials-empty` 已具备，防回归）。
  await expect(page.getByTestId("chat-artifacts-empty")).toBeVisible({ timeout: 30_000 });

  // ② 错误态 + ③ 恢复态：把产物读接口打成 500，界面必须如实报错并给出重试。
  await page.route("**/chat/threads/**/artifacts**", (route) => route.fulfill({ status: 500, body: "{}" }));
  await page.reload();
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible({ timeout: 120_000 });

  await expect(
    page.getByTestId("chat-artifacts-error"),
    gapMessage("TW-P2-7", "chat-artifacts-error", "后端 500 时产物栏没有错误态（静默假装没事发生）"),
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByTestId("chat-artifacts-retry"),
    gapMessage("TW-P2-7", "chat-artifacts-retry", "错误态没有恢复态（用户只能刷整页）"),
  ).toBeVisible({ timeout: 15_000 });

  /*
   * ④ Skeleton：加载中必须有骨架屏，不是白屏或布局跳变。
   *
   * ⚠ 这条**收紧**过一次（issue #2075，如实记录）。原判据是在一个**已经加载完**的
   * 页面上 `expectAnchor(page, "chat-task-workbench-skeleton", …)`——骨架屏按定义只在
   * 请求在途时存在，在静止页面上断言它可见是一条**永远无法诚实满足**的判据：要么
   * 恒红，要么逼着实现方留一个永不消失的假骨架（那比没有骨架更坏）。
   *
   * 改成在**真实在途窗口内**观察：把产物读接口人为拖慢，断言骨架在途中出现、
   * 落定后消失。这比原判据多验了两件事（"确实在加载时出现"、"确实会收掉"），
   * 是收紧不是放宽。
   */
  await page.unroute("**/chat/threads/**/artifacts**");
  await page.route("**/chat/threads/**/artifacts**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    await route.continue();
  });
  await page.reload();

  const skeleton = page.getByTestId("chat-task-workbench-skeleton").first();
  await expect(
    skeleton,
    gapMessage("TW-P2-7", "chat-task-workbench-skeleton", "右栏读取中没有 Skeleton 骨架屏（只有一行灰字或白屏）"),
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByTestId("chat-task-workbench-skeleton"),
    "TW-P2-7：请求落定后骨架屏必须消失（留着不走的骨架屏是假加载态）",
  ).toHaveCount(0, { timeout: 60_000 });
});
