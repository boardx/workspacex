/**
 * AG04 review 指出的缺口——`/agent` 目录页此前在 `lib/navigation.ts` 里零导航入口，
 * e2e 也是零，同 testing-standards.md 点名的 Ava/Surveys/Admin 先例：「e2e 全是
 * page.goto() 直连，没人断言入口」。这里补上一条最小的真实入口可达性验证：
 * 真实登录 → 左栏导航能看到「Agent 目录」→ 点击真的落到 `/agent` 并渲染目录屏
 * （不是 goto 直连，是从产品里点出来的）。
 */
import { expect, test } from "@playwright/test";
import { loginAsDevRole } from "./dev-mode-login";

test("Agent 目录从左栏导航可达，不是只能敲 URL 进的孤岛", async ({ page }) => {
  await loginAsDevRole(page, "lead");

  const navEntry = page.getByTestId("rail-agent-directory");
  await expect(navEntry).toBeVisible();
  await navEntry.click();

  await expect(page).toHaveURL(/\/agent$/);
  await expect(page.getByTestId("agent-directory")).toBeVisible();
});
