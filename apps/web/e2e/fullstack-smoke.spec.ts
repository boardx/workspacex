import { expect, test } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

test("anonymous root fails closed to login without rendering the product shell", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByTestId("login-form")).toBeVisible();
  await expect(page.getByTestId("app-shell")).toHaveCount(0);
  await expect(page.getByText("前端内核已就绪")).toHaveCount(0);
});

test("real login reaches the PG-seeded sentinel through project and Files product entries", async ({ page }) => {
  const seen = new Set<string>();
  const failures: string[] = [];
  const requiredResponses: Record<string, (method: string, path: string) => boolean> = {
    login: (method, path) => method === "POST" && path === "/auth/login",
    identity: (method, path) => method === "GET" && path === "/identity/me",
    projects: (method, path) => method === "GET" && path === "/projects",
    overview: (method, path) => method === "GET" && path === `/projects/${FULLSTACK_E2E.projectId}/overview`,
    artifacts: (method, path) => method === "GET" && path === `/projects/${FULLSTACK_E2E.projectId}/artifacts`,
    "artifact-tree": (method, path) => method === "GET" && path === `/projects/${FULLSTACK_E2E.projectId}/artifact-tree`,
  };

  page.on("response", (response) => {
    const url = new URL(response.url());
    const path = url.pathname.replace(/^\/__fullstack_api/, "");
    const method = response.request().method();
    for (const [key, matches] of Object.entries(requiredResponses)) {
      if (!matches(method, path)) continue;
      if (response.status() < 200 || response.status() >= 300) {
        failures.push(`${key} returned ${response.status()} (${method} ${path})`);
      } else {
        seen.add(key);
      }
    }
  });
  page.on("requestfailed", (request) => failures.push(
    `requestfailed ${request.method()} ${request.url()}: ${request.failure()?.errorText}`,
  ));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console error: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`page error: ${error.message}`));

  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.email);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByTestId("org-switcher")).toHaveValue(FULLSTACK_E2E.orgId);
  await expect(page.getByTestId("session-logout")).toBeVisible();

  await page.goto("/projects");
  await expect(page.getByTestId(`projects-card-${FULLSTACK_E2E.projectId}-enter`)).toBeVisible();
  await page.getByTestId(`projects-card-${FULLSTACK_E2E.projectId}-enter`).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${FULLSTACK_E2E.projectId}`));
  await expect(page.getByTestId("project-workbench")).toBeVisible();
  await expect(page.getByTestId("project-title")).toHaveText(FULLSTACK_E2E.projectName);
  await expect(page.getByTestId("project-overview-live-overview-body")).toBeVisible();

  await page.getByTestId("project-home-surface-files").click();
  await expect(page).toHaveURL(new RegExp(`/projects/${FULLSTACK_E2E.projectId}/files`));
  await expect(page.getByTestId("live-files-browser")).toBeVisible();
  await expect(page.getByTestId("live-files-list")).toContainText(FULLSTACK_E2E.sentinelFile);
  await expect(page.getByTestId("live-files-row")).toHaveCount(1);

  expect([...seen].sort()).toEqual(Object.keys(requiredResponses).sort());
  expect(failures).toEqual([]);
  console.log(
    `[fullstack-smoke] responses=${[...seen].sort().join(",")} ` +
    `sentinel=${FULLSTACK_E2E.sentinelFile} failures=0`,
  );
});
