import { expect, test } from "@playwright/test";

for (const stage of ["home", "import", "topic", "plan", "research", "report"] as const) {
  test(`renders the ${stage} prototype composition without desktop overflow`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/research?preview=prototype-fidelity&stage=${stage}`);
    await expect(page.getByTestId("guided-research-prototype-preview")).toBeVisible();
    await expect(page.getByTestId(`guided-research-prototype-${stage}`)).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`prototype-${stage}.png`), fullPage: true });
  });
}
