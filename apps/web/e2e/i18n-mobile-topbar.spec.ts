import { expect, test } from "@playwright/test";
import { SELF_SERVICE_PROFILE_E2E } from "./self-service-profile-fixture";

test("Account language controls remain operable without a shared header without losing an unsaved profile draft", async ({ page }, testInfo) => {
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
  await expect(page.getByTestId("shell-topbar")).toHaveCount(0);
  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const locale of ["zh-CN", "en"]) {
      const account = page.getByTestId(width < 768 ? "rail-profile-menu-mobile" : "rail-profile-menu");
      await expect(account).toBeInViewport({ ratio: 1 });
      await account.click();
      const menu = page.getByTestId(width < 768 ? "rail-personal-menu-mobile" : "rail-personal-menu");
      await menu.getByRole("menuitemradio", { name: locale === "en" ? "English" : "简体中文", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(input).toHaveValue(draft);
      await page.keyboard.press("Escape");
      if (width < 768) {
        await expect(page.getByTestId("mobile-feedback")).toBeInViewport({ ratio: 1 });
        await expect(page.getByTestId("org-switcher-mobile")).toBeInViewport({ ratio: 1 });
      }
      await expect(page.getByTestId("shell-topbar")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`header-free-${width}-${locale}.png`) });
    }
  }
});
