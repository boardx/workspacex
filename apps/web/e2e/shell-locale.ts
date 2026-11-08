import { expect, type Page } from "@playwright/test";

export async function setShellLocale(page: Page, locale: "en" | "zh-CN") {
  const suffix = (page.viewportSize()?.width ?? 1280) < 768 ? "-mobile" : "";
  await page.getByTestId(`rail-profile-menu${suffix}`).click();
  await page.getByTestId(`rail-personal-menu${suffix}`)
    .getByRole("menuitemradio", { name: locale === "en" ? "English" : "简体中文", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
}
