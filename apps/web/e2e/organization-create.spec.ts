import { test, expect } from "@playwright/test";
import { identity as contract } from "@repo/contracts";
import { mkdir } from "node:fs/promises";
import path from "node:path";

// Real browser on the developer's Mac; deterministic API fixtures, no production access.
test("organization menu creates, refreshes, switches, and cancels with stable retry", async ({ page }) => {
  let created = false; let current = "org-browser-current"; let attempts = 0;
  const requests: Array<{ orgName: string; requestId: string }> = [];
  const evidence = path.resolve(__dirname, "../../../evidence/org-create-5494");
  await mkdir(evidence, { recursive: true });
  await page.addInitScript(() => {
    localStorage.setItem("wsx.sessionToken", "browser-test-token");
    localStorage.setItem("wsx.session", JSON.stringify({ version: 2, revision: "browser-5494", userId: "browser-user", orgs: ["org-browser-current"], currentOrgId: "org-browser-current", expiresAt: "2099-01-01T00:00:00.000Z" }));
    localStorage.setItem("wsx.sessionCommit", "browser-5494");
  });
  await page.route("http://localhost:3200/**", async route => {
    const url = new URL(route.request().url());
    const headers = { "access-control-allow-origin": "http://127.0.0.1:30494", "access-control-allow-credentials": "true", "access-control-allow-headers": "authorization,content-type", "access-control-allow-methods": "GET,POST,OPTIONS" };
    if (route.request().method() === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
    let output: unknown = {};
    if (url.pathname === "/identity/me") {
      const id = url.searchParams.get("orgId") ?? current;
      output = contract.operations.resolveIdentity.out.parse({ org: { id, name: id === "org-browser-current" ? "本地测试组织" : "新建测试组织", kind: "organization", team: null, avatarUrl: null }, orgRole: "admin", teamId: null, projectRole: null, groupId: null, displayName: "测试账号", avatarUrl: null });
    } else if (url.pathname === "/auth/organizations") {
      requests.push(route.request().postDataJSON()); attempts++;
      if (attempts === 1) { await route.fulfill({ status: 503, json: { reasonCode: "DEPENDENCY_UNAVAILABLE" }, headers }); return; }
      created = true; output = { orgId: "org-browser-new", orgName: "新建测试组织" };
    } else if (url.pathname === "/auth/switch-org") {
      current = route.request().postDataJSON().toOrgId;
      output = { org: { id: current, name: "新建测试组织", kind: "organization", avatarUrl: null } };
    } else if (url.pathname === "/projects") output = { projects: [] };
    await route.fulfill({ status: 200, json: output, headers });
  });
  await page.goto("/projects");
  await page.getByTestId("org-switcher").click();
  await expect(page.getByTestId("create-organization-entry")).toBeVisible();
  await page.getByTestId("create-organization-entry").click();
  await expect(page.getByTestId("create-organization-dialog")).toBeVisible();
  await page.getByLabel("组织名称", { exact: true }).fill("新建测试组织");
  await page.screenshot({ path: path.join(evidence, "create-dialog.png"), fullPage: true });
  await page.getByText("取消", { exact: true }).click();
  expect(requests).toHaveLength(0);
  await page.getByTestId("org-switcher").click();
  await page.getByTestId("create-organization-entry").click();
  await page.getByLabel("组织名称", { exact: true }).fill("新建测试组织");
  await page.getByTestId("create-organization-submit").click();
  await expect(page.getByRole("alert")).toContainText("重试");
  await page.getByTestId("create-organization-submit").click();
  await expect(page.getByText("组织已创建", { exact: true })).toBeVisible();
  expect(created).toBe(true); expect(requests[0]).toEqual(requests[1]); expect(current).toBe("org-browser-current");
  await page.screenshot({ path: path.join(evidence, "created.png"), fullPage: true });
  await page.getByText("完成", { exact: true }).click();
  await page.getByTestId("org-switcher").click();
  await expect(page.getByTestId("org-switcher-option-org-browser-new")).toContainText("新建测试组织");
  await page.screenshot({ path: path.join(evidence, "refreshed-menu.png"), fullPage: true });
  await page.getByTestId("org-switcher-option-org-browser-new").click();
  await expect(page.getByTestId("org-menu-current")).not.toBeVisible();
  await expect.poll(() => current).toBe("org-browser-new");
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("wsx.session")!).currentOrgId)).toBe("org-browser-new");
});
