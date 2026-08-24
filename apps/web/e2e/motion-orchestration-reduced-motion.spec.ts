import { test, expect } from "@playwright/test";

/**
 * F04 —— 编排级动效 · `prefers-reduced-motion: reduce` 降级（契约束
 * motion-microinteraction UC-2/UC-3，requirements/02-motion-token-system.md#R9）。
 *
 * `/kitchen-sink` 的 `MessageEntranceGallery`（`components/state/primitives-gallery.tsx`）
 * 是消息到达进场编排动效的签核①材料落点，与 F01/F02 同一套「不需要登录、不需要种子
 * 数据」的静态页面前提，复用同一个 project，不另起 webServer/依赖链
 *（同 `overlay-primitives-kitchen-sink.spec.ts` 头注说明的先例）。
 *
 * `page.emulateMedia({ reducedMotion })` 在 `page.goto` 之前设置，让首次渲染就
 * 命中对应的媒体查询分支，不是「先普通渲染再切换」。
 */

test.describe("reduced motion", () => {
  test("默认（无 reduced motion）：编排动效两段各自有非零 transition-duration", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/kitchen-sink");

    const positionLayer = page.getByTestId("message-entrance-demo");
    const fadeLayer = page.getByTestId("message-entrance-demo-fade");
    await expect(positionLayer).toBeVisible();

    const positionDuration = await positionLayer.evaluate((el) => getComputedStyle(el).transitionDuration);
    const fadeDuration = await fadeLayer.evaluate((el) => getComputedStyle(el).transitionDuration);

    // duration-base = 200ms（位移层），duration-fast = 150ms（淡入层）——两段不同，
    // 证明不是单一线性过渡在整条编排上套用同一个数值。
    expect(positionDuration).toBe("0.2s");
    expect(fadeDuration).toBe("0.15s");

    const positionDelay = await positionLayer.evaluate((el) => getComputedStyle(el).transitionDelay);
    expect(positionDelay).toBe("0.15s");
  });

  test("prefers-reduced-motion: reduce：编排动效降级为瞬时切换（transition-property 归 none）", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/kitchen-sink");

    const positionLayer = page.getByTestId("message-entrance-demo");
    const fadeLayer = page.getByTestId("message-entrance-demo-fade");
    await expect(positionLayer).toBeVisible();

    // Tailwind 的 `transition-none` 是 `transition-property: none`（不重置
    // `transition-duration` 这个独立 CSS 属性的字面量）——真正让降级生效、
    // 不产生任何视觉过渡的是 `transition-property`，所以断言这个而不是 duration。
    const positionProperty = await positionLayer.evaluate((el) => getComputedStyle(el).transitionProperty);
    const fadeProperty = await fadeLayer.evaluate((el) => getComputedStyle(el).transitionProperty);
    expect(positionProperty).toBe("none");
    expect(fadeProperty).toBe("none");

    // 终态直接钉死：位移无偏移、内容不透明——不依赖 JS 计时器先跑完再看到终态。
    const positionTransform = await positionLayer.evaluate((el) => getComputedStyle(el).transform);
    expect(["none", "matrix(1, 0, 0, 1, 0, 0)"]).toContain(positionTransform);
    const fadeOpacity = await fadeLayer.evaluate((el) => getComputedStyle(el).opacity);
    expect(fadeOpacity).toBe("1");

    // 重放（remount）之后依然是瞬时终态，不会在 reduce 模式下突然冒出动画。
    await page.getByTestId("message-entrance-replay").click();
    const fadeOpacityAfterReplay = await page.getByTestId("message-entrance-demo-fade").evaluate((el) => getComputedStyle(el).opacity);
    expect(fadeOpacityAfterReplay).toBe("1");
    const positionPropertyAfterReplay = await positionLayer.evaluate((el) => getComputedStyle(el).transitionProperty);
    expect(positionPropertyAfterReplay).toBe("none");
  });
});
