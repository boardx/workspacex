import { expect, test, type Locator, type Page } from "@playwright/test";
import { SELF_SERVICE_PROFILE_E2E } from "./self-service-profile-fixture";

async function fullyInsideHeader(page: Page, control: Locator, width: number) {
  await expect(control).toBeInViewport({ ratio: 1 });
  const box = await control.boundingBox();
  const header = await page.getByTestId("shell-topbar").boundingBox();
  expect(box).not.toBeNull();
  expect(header).not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.x).toBeGreaterThanOrEqual(header!.x);
  expect(box!.x + box!.width).toBeLessThanOrEqual(Math.min(width, header!.x + header!.width));
}

test("TopBar controls remain visible and operable without losing an unsaved profile draft", async ({ page }, testInfo) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(SELF_SERVICE_PROFILE_E2E.topbarEmail);
  await page.getByTestId("login-password").fill(SELF_SERVICE_PROFILE_E2E.topbarPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goto("/profile");
  await expect(page.getByTestId("profile-screen")).toBeVisible();
  const draft = "保持原文 {English}";
  const input = page.getByTestId("profile-display-name-input");
  await input.fill(draft);
  const header = page.getByTestId("shell-topbar");
  const language = header.getByTestId("language-switcher");
  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const locale of ["zh-CN", "en"]) {
      await fullyInsideHeader(page, language, width);
      await language.click();
      await page.keyboard.press("Escape");
      await language.selectOption(locale);
      await expect(language).toHaveValue(locale);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(input).toHaveValue(draft);
      await fullyInsideHeader(page, language, width);
      await language.focus();
      await expect(language).toBeFocused();
      if (width < 768) {
        await fullyInsideHeader(page, page.getByTestId("topbar-feedback"), width);
        await fullyInsideHeader(page, page.getByTestId("org-switcher-mobile"), width);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`topbar-${width}-${locale}.png`) });
    }
  }
});
