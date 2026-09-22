import { expect, test, type Locator } from "@playwright/test";
import { openFreshThread } from "./chat-task-workbench-fixture";
import { CHAT_READ_E2E } from "./chat-read-fixture";

test.setTimeout(150_000);
async function inViewport(locator: Locator, width: number, height: number) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(height);
}
for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 700 }]) {
  test(`skill picker scrolls internally with reachable first/last/cancel at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.route(/\/skills\?/, async route => {
      if (route.request().method() !== "GET") return route.continue();
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      const body = await response.json();
      const real = body.items.find((item: { skillId: string }) => item.skillId === CHAT_READ_E2E.mountableSkillId);
      expect(real, "the last option must be a real mountable seeded skill").toBeTruthy();
      await route.fulfill({ response, json: { ...body, items: Array.from({ length: 20 }, (_, index) => ({
        ...real, skillId: index === 19 ? real.skillId : `viewport-layout-${index}`,
        name: `技能 ${String(index + 1).padStart(2, "0")}`, duty: "用于验证列表视口边界和内部滚动的说明文字",
      })) } });
    });
    const threadId = await openFreshThread(page);
    await page.setViewportSize(viewport);
    const trigger = page.getByTestId("chat-skill-mount");
    const openPicker = async () => {
      // ⚠ 这里原本有一条兜底：`if (!await trigger.isVisible()) getByTestId("chat-composer-attach").click()`。
      // `chat-composer-attach` 这个 testid **在 apps/web 里从来没有存在过**（#2128 门控查出）——
      // 触发器今天是 composer 上常驻的图标按钮（`copilotkit-v2-panel-body.tsx` 的
      // `chat-skill-mount`），不藏在任何展开菜单里，所以那条分支一次都没走到过，也就
      // 没人发现它锚在虚空上。改成**如实断言这个前提**：触发器必须可见；哪天它真的被
      // 收进菜单了，这里会红，而不是抛一个"元素找不到"的噪声错误。
      await expect(trigger).toBeVisible();
      await expect(trigger).toBeEnabled(); await trigger.click();
    };
    await openPicker();
    const picker = page.getByTestId("chat-skill-mount-picker");
    const first = page.getByTestId("chat-skill-mount-option-viewport-layout-0");
    const last = page.getByTestId(`chat-skill-mount-option-${CHAT_READ_E2E.mountableSkillId}`);
    const cancel = page.getByTestId("chat-skill-mount-cancel");
    await expect(first).toBeVisible();
    await inViewport(picker, viewport.width, viewport.height);
    await inViewport(first, viewport.width, viewport.height);
    await inViewport(cancel, viewport.width, viewport.height);
    await expect(picker).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("skill-picker-expanded.png"), fullPage: true });
    const scrollBefore = await picker.evaluate(el => {
      const scrolling = [el, ...el.querySelectorAll("*")].find(node => /auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight);
      return scrolling ? { top: scrolling.scrollTop, height: scrolling.clientHeight } : null;
    });
    expect(scrollBefore, "a real internal scroll container must exist").not.toBeNull();
    await first.hover(); await page.mouse.wheel(0, 2000);
    await expect.poll(() => picker.evaluate(el => Math.max(...[el, ...el.querySelectorAll("*")].map(node => node.scrollTop)))).toBeGreaterThan(0);
    await inViewport(cancel, viewport.width, viewport.height);
    await cancel.click(); await expect(picker).toHaveCount(0);
    await openPicker();
    const mounted = page.waitForResponse(response => response.request().method() === "POST" && response.url().includes(`/threads/${threadId}/skill-mounts`));
    await last.click(); // Native Playwright actionability/scrolling; never force the click.
    expect((await mounted).ok()).toBe(true);
    await expect(page.getByTestId(`chat-skill-mounted-${CHAT_READ_E2E.mountableSkillId}`)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("skill-picker-selection.png"), fullPage: true });
  });
}
