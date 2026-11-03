import { test, expect } from "@playwright/test";
test.setTimeout(90_000);
// Runs against the real entry route; no authentication or content API is mocked.
test("root redirects to localized login and preserves language and form values", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByTestId("login-email")).toBeEnabled();
  await page.getByTestId("login-email").fill("locale-test@example.com");
  await page.getByTestId("language-switcher").selectOption("en");
  await expect(page.getByRole("heading", { name: "Sign in to WorkspaceX" })).toBeVisible();
  await expect(page.getByTestId("login-email")).toHaveValue("locale-test@example.com");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in to WorkspaceX" })).toBeVisible();
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByTestId("language-switcher")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.getByTestId("language-switcher").selectOption("zh-CN");
  await expect(page.getByRole("heading", { name: "登录 WorkspaceX" })).toBeVisible();
});


test("account entry pages translate live and preserve pending values", async ({ page }) => {
  await page.goto("/auth/register");
  await page.getByTestId("language-switcher").selectOption("en");
  await expect(page.getByRole("heading", { name: "Create organization", exact: true })).toBeVisible();
  const inputs = {
    "registration-org-name": "原文 Org",
    "registration-display-name": "原文 Alice",
    "registration-email": "entry-locale@example.test",
    "registration-password": "typed-value-kept",
  };
  for (const [id, value] of Object.entries(inputs)) await page.getByTestId(id).fill(value);
  await page.getByTestId("language-switcher").selectOption("zh-CN");
  await expect(page.getByRole("heading", { name: "创建组织", exact: true })).toBeVisible();
  for (const [id, value] of Object.entries(inputs)) await expect(page.getByTestId(id)).toHaveValue(value);
  await page.getByTestId("language-switcher").selectOption("en");
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("heading", { name: "Create organization", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`registration-en-${width}.png`) });
  }
  await page.reload();
  await expect(page.getByRole("heading", { name: "Create organization", exact: true })).toBeVisible();
  await page.goto("/auth/reset-password?token=entry-test-token");
  await expect(page.getByRole("heading", { name: "Reset password", exact: true })).toBeVisible();
  await page.getByTestId("reset-password-pwd").fill("typed-value-kept");
  await page.getByTestId("reset-password-confirm").fill("different-entry");
  await expect(page.getByText("Passwords do not match.", { exact: true })).toBeVisible();
  await page.getByTestId("language-switcher").selectOption("zh-CN");
  await expect(page.getByRole("heading", { name: "重置密码", exact: true })).toBeVisible();
  await expect(page.getByTestId("reset-password-pwd")).toHaveValue("typed-value-kept");
  await expect(page.getByText("两次输入的密码不一致。", { exact: true })).toBeVisible();
  await page.getByTestId("language-switcher").selectOption("en");
  const animation = page.getByTestId("auth-metamorphosis");
  await expect(animation.getByText("Cocoon", { exact: true })).toBeVisible();
  await expect(animation.getByText("Collaborate with your AI team", { exact: true })).toBeVisible();
  expect(await animation.innerText()).not.toMatch(/[\u3400-\u9fff]/);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const stage of ["Cocoon", "Emerge", "Take flight"]) {
    const label = animation.getByText(stage, { exact: true });
    await expect(label).toBeVisible();
    expect(await label.evaluate((node) => getComputedStyle(node.parentElement!).animationName)).toBe("none");
  }
  expect(await animation.locator("ol").evaluate((list) => list.scrollWidth <= list.clientWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("reset-password-en.png") });
  await page.goto("/auth/verify-email");
  await expect(page.getByRole("heading", { name: "Verification link unavailable", exact: true })).toBeVisible();
  await page.getByTestId("language-switcher").selectOption("zh-CN");
  await expect(page.getByRole("heading", { name: "验证链接不可用", exact: true })).toBeVisible();
  await page.getByTestId("language-switcher").selectOption("en");
  await page.screenshot({ path: test.info().outputPath("email-verification-invalid-en.png") });
});

test("invitation entry translates both token modes without losing pending inputs", async ({ page }) => {
  for (const kind of ["single", "shared"] as const) {
    const prefix = kind === "single" ? "activate" : "link-activate";
    const route = kind === "single" ? "/auth/activate?t=original-invite&org=original-org&role=original-role&team=original-team" : "/auth/activate?lt=original-link";
    await page.goto(route);
    await page.getByTestId("language-switcher").selectOption("en");
    await expect(page.getByRole("heading", { name: kind === "single" ? "Activate organization invitation" : "Join organization", exact: true })).toBeVisible();
    if (kind === "shared") await page.getByTestId(`${prefix}-email`).fill("invite-entry@example.test");
    await page.getByTestId(`${prefix}-name`).fill("原文 Alice");
    await page.getByTestId(`${prefix}-pwd`).fill("original-input-phrase");
    await page.getByTestId("language-switcher").selectOption("zh-CN");
    await expect(page.getByRole("heading", { name: kind === "single" ? "激活组织邀请" : "加入组织", exact: true })).toBeVisible();
    await expect(page.getByTestId(`${prefix}-name`)).toHaveValue("原文 Alice");
    await expect(page.getByTestId(`${prefix}-pwd`)).toHaveValue("original-input-phrase");
    await page.getByTestId("language-switcher").selectOption("en");
    if (kind === "single") {
      await page.getByTestId("activate-mode-existing").click();
      await expect(page.getByTestId("activate-existing-need-login")).toContainText("You are not signed in");
      await expect(page.getByTestId("activate-submit")).toBeDisabled();
      await page.getByTestId("activate-mode-new").click();
      await expect(page.getByTestId("activate-name")).toHaveValue("原文 Alice");
    }
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await expect(page.getByTestId("language-switcher")).toHaveValue("en");
      // Language autonyms remain in their own language, including unselected native options.
      const systemCopy = await page.getByTestId("auth-shell").evaluate((node) => {
        const copy = node.cloneNode(true) as HTMLElement;
        copy.querySelector('[data-testid="language-switcher"]')?.remove();
        return copy.textContent ?? "";
      });
      expect(systemCopy).not.toMatch(/[\u3400-\u9fff]/);
      await page.screenshot({ path: test.info().outputPath(`invite-${kind}-en-${width}.png`) });
    }
  }
  await page.goto("/auth/activate");
  await expect(page.getByTestId("activate-missing-token")).toContainText("This link is incomplete");
  await page.getByTestId("language-switcher").selectOption("zh-CN");
  await expect(page.getByTestId("activate-missing-token")).toContainText("链接不完整");
});
