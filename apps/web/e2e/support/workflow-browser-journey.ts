import { expect, type Page, type TestInfo } from "@playwright/test";
import { agentRole } from "@repo/contracts";
import { FULLSTACK_E2E } from "../fullstack-smoke-fixture";

export async function readWorkflowJourneyApi(page: Page, path: string): Promise<unknown> {
  return page.evaluate(async (url) => {
    const token = localStorage.getItem("wsx.sessionToken");
    if (!token) throw new Error("Authenticated browser required");
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Authoritative read failed: HTTP ${response.status}`);
    return response.json();
  }, `/__fullstack_api${path}`);
}
export async function workflowJourneyShot(page: Page, info: TestInfo, name: string): Promise<void> {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await info.attach(name, { path, contentType: "image/png" });
}
/** Real admin login and explicit enable UI; safely reuses an already enabled real pack. */
export async function prepareOfficialWorkflowAdmin(page: Page, info: TestInfo): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.adminEmail);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.adminPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/home$/);
  await workflowJourneyShot(page, info, "01-workflow-admin-login");
  const offer = agentRole.operations.getOfficialRolePackOffer.out.parse(
    await readWorkflowJourneyApi(page, agentRole.operations.getOfficialRolePackOffer.path),
  );
  await page.goto("/platform-admin/agent");
  await expect(page.getByTestId("admin-agent-catalog")).toBeVisible();
  await page.getByRole("button", { name: "官方数字人", exact: true }).click();
  const modal = page.getByTestId("official-digital-human-modal");
  await expect(modal).toBeVisible();
  if (offer.pending.length > 0) {
    expect(offer.canEnable).toBe(true);
    await modal.getByRole("button", { name: "启用官方数字人", exact: true }).click();
    await expect(modal.getByText("官方数字人已启用。", { exact: true })).toBeVisible({ timeout: 180_000 });
  } else {
    await expect(modal.getByText("本组织已启用全部官方数字人。", { exact: true })).toBeVisible();
  }
  await workflowJourneyShot(page, info, "02-workflow-official-pack-ready");
  await page.getByTestId("official-digital-human-modal-close").click();
  const latest = agentRole.operations.getOfficialRolePackOffer.out.parse(
    await readWorkflowJourneyApi(page, agentRole.operations.getOfficialRolePackOffer.path),
  );
  expect(latest.pending).toHaveLength(0);
}
