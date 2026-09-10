import { join } from "node:path";
import { buildTraceFixture } from "./fixtures/build-trace-fixture";
import { test, expect } from "@playwright/test";

/**
 * issue #3316 ① —— 「正在执行工具操作」那一行的小动画是**静态的**，展开后里面的
 * 动画却在转。折叠行的 spinner 是用户判断「系统还活着还是卡死了」的唯一信号，
 * 不转传达的正是相反的意思。
 *
 * ## 判据为什么必须是「真的在动」
 * 缺陷的形状是**一个长得像 spinner 的静态图标**（`<Loader2>` 不带 `animate-spin`）。
 * 「元素存在」「aria-label 对」「class 名对」这三种断言在这个形状下**无法被证伪**：
 * 静态图标全都轻松通过。所以这里只认两件真浏览器才有的事实：
 *   1. `Element.getAnimations()` 里真有一条 `playState === "running"` 的动画；
 *   2. 隔开若干帧取两次 `getComputedStyle(...).transform`，两次**必须不同**。
 * 第 2 条是对第 1 条的反证：动画声明存在但被 `animation-play-state: paused`、
 * 被祖先的 `content-visibility`、被 0s duration 停掉时，1 可能仍绿而 2 会红。
 *
 * 另加一条命中测试：`getBoundingClientRect()` **读不出 overflow 裁剪**（本仓栽过的坑，
 * 几何全绿而用户看不见）。所以用 `elementFromPoint` 判这枚图标真的暴露在光标下。
 *
 * ## 为什么不起应用
 * 同 `chat-trace-disclosure-geometry.spec.ts`：被测对象是 `RunTracePanel` 一个组件在
 * 一种输入下的渲染与样式。夹具是**真组件** + **真编译样式**（tailwindcss CLI 按本应用
 * 的 config 编译），两侧都不是替身，只是没有数据链路。
 */
function buildFixture(): string {
  return buildTraceFixture(join(__dirname, "fixtures", "trace-liveness-fixture.tsx"), "trace-liveness-");
}

test("#3316 ①：run 还活着时，「正在执行」那一行的状态图标必须真的在转（两帧比对，不是判 class）", async ({ page }) => {
  // 判据是「有没有在动」，先把 reduced-motion 钉死在 no-preference——
  // 否则 CI 机器的系统偏好一变，这条门就会在无关的地方红。
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto(buildFixture());

  // 折叠行自己说这轮还活着——判据的前提，来自执行账本，与下面那枚图标读的应当是同一件事实。
  await expect(page.getByTestId("run-trace-toggle")).toContainText("正在执行");

  const icon = page.locator('[data-testid="run-trace-entry"][data-status="running"] [data-testid="run-trace-entry-status-icon"]');
  await expect(icon, "夹具里应当恰有一步处于 running（t2 只有 tool_start）").toHaveCount(1);

  const probe = await icon.evaluate(async (element) => {
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const animations = element.getAnimations().map((animation) => ({
      playState: animation.playState,
      duration: Number((animation.effect?.getTiming().duration as number | undefined) ?? 0),
    }));
    const first = getComputedStyle(element).transform;
    for (let i = 0; i < 20; i += 1) await frame();
    const second = getComputedStyle(element).transform;
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return { animations, first, second, hit: hit ? element.contains(hit) || hit.contains(element) : false };
  });

  expect(
    probe.animations.filter((a) => a.playState === "running" && a.duration > 0),
    ["【#3316 ①】折叠行那枚状态图标身上没有一条正在运行的动画。",
      `实测 getAnimations() = ${JSON.stringify(probe.animations)}`,
      "用户看到的就是这个：一个长得像 spinner 的静态图标，把「还活着」讲成了「卡死了」。",
    ].join("\n"),
  ).not.toHaveLength(0);

  expect(
    probe.second,
    ["【#3316 ①】隔了 20 帧，这枚图标的 transform 一个像素都没变——它没有在动。",
      `第 1 帧 transform = ${probe.first}`,
      `第 21 帧 transform = ${probe.second}`,
      "注意：这条断言故意不看 class 名，也不看 aria-label——静态图标在那两种判据下永远是绿的。",
    ].join("\n"),
  ).not.toBe(probe.first);

  expect(
    probe.hit,
    "【#3316 ①】图标中心点被别的元素盖住/裁掉了：getBoundingClientRect() 读不出 overflow 裁剪，转得再欢用户也看不见。",
  ).toBe(true);
});
