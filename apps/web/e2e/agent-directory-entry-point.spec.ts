/**
 * AG04 review 指出的缺口——`/agent` 目录页此前在 `lib/navigation.ts` 里零导航入口，
 * e2e 也是零，同 testing-standards.md 点名的 Ava/Surveys/Admin 先例：「e2e 全是
 * page.goto() 直连，没人断言入口」。这里补上一条最小的真实入口可达性验证：
 * 真实登录 → 左栏导航能看到「Agent 目录」→ 点击真的落到 `/agent` 并渲染目录屏
 * （不是 goto 直连，是从产品里点出来的）。
 */
import { expect, test, type Page } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

// 2026-09-29：本 spec 排在 fullstack-smoke 的 `seeded` project，那条链的种子
// （fullstack-smoke-fixture / seed）只提供 FULLSTACK_E2E 账号，不建 dev-mode 预设账号——
// 原先 `loginAsDevRole` 在 CI 上停在 /login（#4622）。改用与同 project 其他 spec
// （如 agenda-segment-create-smoke）相同的真实表单登录；「Agent 目录」入口不按角色门控。
async function loginAsSeededUser(page: Page) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.email);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

test("Agent 目录从左栏导航可达，不是只能敲 URL 进的孤岛", async ({ page }) => {
  await loginAsSeededUser(page);

  const navEntry = page.getByTestId("rail-agent-directory");
  await expect(navEntry).toBeVisible();
  await navEntry.click();

  await expect(page).toHaveURL(/\/agent$/);
  await expect(page.getByTestId("agent-directory")).toBeVisible();
});
