import { expect, type Page } from "@playwright/test";

/**
 * Click a skill through the same pointer path a user must be able to use.
 *
 * `toBeVisible()` alone is insufficient here: Playwright considers an element
 * visible even when an unbounded, bottom-anchored picker lays it out above the
 * viewport. Keep the viewport assertion separate so that this regression fails
 * immediately at the broken presentation boundary instead of spending the
 * enclosing test timeout retrying a click that can never receive a pointer.
 */
export async function clickActionableSkillMountOption(page: Page, skillId: string): Promise<void> {
  const picker = page.getByTestId("chat-skill-mount-picker");
  const option = picker.getByTestId(`chat-skill-mount-option-${skillId}`);

  await expect(picker, "skill mount picker should open").toBeVisible();
  await expect(option, "requested enabled skill should be rendered in the picker").toBeVisible();
  await expect(
    option,
    "rendered skill mount option must remain inside the viewport and pointer-actionable",
  ).toBeInViewport();
  await option.click();
}
