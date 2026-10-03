import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page } from "@playwright/test";

const OUTPUT = resolve("test-results/paper");
const VIEWPORTS = [
  { name: "desktop", width: 1024, height: 600 },
  { name: "mobile", width: 375, height: 812 },
] as const;

/** Real product controls, authenticated isolated API; never injected mock DOM/theme. */
export async function capturePaperMatrix(page: Page, label: string, anchor: string, scrollMessages = false): Promise<void> {
  mkdirSync(OUTPUT, { recursive: true });
  for (const theme of ["light", "dark"] as const) {
    // Mobile's theme action lives on /profile; use the real desktop action first,
    // then resize the SAME authenticated product page for the mobile capture.
    await page.setViewportSize(VIEWPORTS[0]);
    const dark = await page.locator("html").evaluate(el => el.classList.contains("dark"));
    if (dark !== (theme === "dark")) {
      await page.getByRole("button", { name: "个人菜单", exact: true }).click();
      const toggle = page.getByTestId("personal-menu-theme");
      await expect(toggle).toBeVisible();
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", String(theme === "dark"));
      await toggle.press("Escape");
      await expect(page.getByTestId("rail-personal-menu")).toBeHidden();
    }
    await expect.poll(() => page.locator("html").evaluate(el => el.classList.contains("dark"))).toBe(theme === "dark");
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await expect(page.getByTestId(anchor).last()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      if (label === "chat-empty") {
        // Visibility alone accepts partially clipped headings. Require the
        // whole opening prompt and every real template inside the message pane.
        const pane = page.getByTestId("copilotkit-v2-messages");
        const targets = page.locator('[data-testid="chat-task-workbench-goal-headline"], [data-testid^="chat-task-workbench-template-"]');
        await expect(targets).toHaveCount(5);
        for (const target of await targets.all()) {
          await expect.poll(async () => {
            const frame = await pane.boundingBox();
            const box = await target.boundingBox();
            return Boolean(frame && box && box.y >= frame.y - 1
              && box.y + box.height <= frame.y + frame.height + 1
              && box.x >= frame.x - 1 && box.x + box.width <= frame.x + frame.width + 1);
          }, { message: "PAPER opening prompt and all templates must be fully visible on the first screen" }).toBe(true);
        }
      }
      if (scrollMessages) {
        const messages = page.getByTestId("copilotkit-v2-messages");
        await expect.poll(() => messages.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
        await messages.evaluate(el => el.scrollTo({ top: el.scrollHeight, behavior: "auto" }));
        await expect.poll(() => messages.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(2);
      }
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      const file = `${label}-${theme}-${viewport.name}`;
      await page.screenshot({ path: resolve(OUTPUT, `${file}.png`) });
      const receipt = await page.evaluate(() => ({
        path: location.pathname, dark: document.documentElement.classList.contains("dark"),
        background: getComputedStyle(document.body).backgroundColor,
        width: innerWidth, height: innerHeight,
      }));
      writeFileSync(resolve(OUTPUT, `${file}.json`), JSON.stringify({
        sourceSha: process.env.GITHUB_SHA ?? "local-unverified", runId: process.env.GITHUB_RUN_ID ?? null,
        runtime: "isolated real API/database and seed-account login; deterministic model upstream, not professional AI quality",
        screenshot: `${file}.png`, ...receipt,
      }, null, 2));
    }
  }
}
