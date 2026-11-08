import { setShellLocale } from "./shell-locale";
import { expect, test, type Page } from "@playwright/test";
import { project as C } from "@repo/contracts";
import { parseCreatedProject } from "./project-create-contract";
import { FULLSTACK_E2E as F } from "./fullstack-smoke-fixture";
test.setTimeout(120_000);
const name = `I18N_${F.orgId.slice(-24)}_原文 {Project}`;
const tag = "原文 Client";
const pathOf = (url: string) => new URL(url).pathname.replace(/^\/__fullstack_api/, "");
async function login(page: Page, email: string, enteredText: string) {
  await page.goto("/login");
  await page.getByTestId("language-switcher").selectOption("en");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(enteredText);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/home$/);
}
async function openList(page: Page) {
  await page.goto("/projects");
  await expect(page.locator('[data-testid="projects-list"], [data-testid="projects-list-empty"]')).toBeVisible();
  // Observe the request started by this refresh, not a late response from the home page we left.
  const [items] = await Promise.all([page.waitForRequest((request) => pathOf(request.url()) === "/projects" && request.method() === "GET")
    .then(async (request) => {
      const response = await request.response();
      expect(response).not.toBeNull();
      expect(response!.ok()).toBe(true);
      return C.operations.listProjects.out.parse(await response!.json());
    }), page.getByTestId("projects-refresh").click()]);
  return items;
}
test("project list locale preserves real creation, tags and archive/restore state across reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let reads = 0;
  page.on("response", (response) => { if (pathOf(response.url()) === "/projects" && response.request().method() === "GET") reads++; });
  await login(page, F.leadEmail, F.leadPassword);
  expect((await openList(page)).some((item) => item.name === name)).toBe(false);
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
  await page.getByTestId("projects-new").click();
  await expect(page.getByRole("button", { name: "Close", exact: true })).toBeVisible();
  await page.getByTestId("project-new-name").fill(name);
  const [createdResponse] = await Promise.all([
    page.waitForResponse((r) => pathOf(r.url()) === "/projects" && r.request().method() === "POST"),
    page.getByTestId("project-new-create").click(),
  ]);
  expect(createdResponse.status()).toBe(201);
  const createdBody: unknown = await createdResponse.json();
  const created = parseCreatedProject(createdBody);
  expect(createdResponse.request().postDataJSON()).toEqual({ orgId: F.orgId, name, kind: "general", blueprintVersionId: null });
  await page.waitForURL(/\/projects\/[^/?]+/);
  expect((await openList(page)).find((item) => item.id === created.id)?.name).toBe(name);
  const prefix = `projects-card-${created.id}`;
  await expect(page.getByTestId(`${prefix}-name`)).toHaveText(name);
  await page.getByTestId("projects-search").fill(name);
  await page.getByTestId("projects-view-toggle-list").click();
  const beforeLocale = reads;
  await setShellLocale(page, "zh-CN");
  await expect(page.getByRole("heading", { name: "项目", exact: true })).toBeVisible();
  await expect(page.getByTestId("projects-search")).toHaveValue(name);
  await expect(page.getByTestId("projects-view-toggle-list")).toHaveAttribute("aria-pressed", "true");
  await setShellLocale(page, "en");
  await expect(page.getByTestId(`${prefix}-status`)).toHaveText("Active");
  expect(reads).toBe(beforeLocale);
  await page.getByTestId(`${prefix}-tag-add`).click();
  await page.getByTestId(`${prefix}-tag-input`).fill(tag);
  const [tagResponse] = await Promise.all([
    page.waitForResponse((r) => pathOf(r.url()) === `/projects/${created.id}/tags` && r.request().method() === "PATCH"),
    page.getByTestId(`${prefix}-tag-input`).press("Enter"),
  ]);
  expect(tagResponse.ok()).toBe(true);
  expect(C.operations.updateProjectTags.out.parse(await tagResponse.json()).tags).toEqual([tag]);
  expect(tagResponse.request().postDataJSON()).toEqual({ projectId: created.id, tags: [tag] });
  await expect(page.getByRole("button", { name: `Remove tag ${tag}`, exact: true })).toBeVisible();
  // One fresh navigation/GET proves both original fields persisted in PostgreSQL.
  const persisted = (await openList(page)).find((item) => item.id === created.id)!;
  expect(persisted.name).toBe(name); expect(persisted.tags).toEqual([tag]);
  await page.getByTestId("projects-search").fill(name);
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`projects-en-${width}.png`) });
  }
  for (const archived of [false, true]) {
    await page.getByTestId(`${prefix}-more`).click();
    await expect(page.getByTestId(`projects-more-${created.id}-archive`)).toHaveText(archived ? "Restore project" : "Archive project");
    await page.getByTestId(`projects-more-${created.id}-archive`).click();
    const [response] = await Promise.all([
      page.waitForResponse((r) => pathOf(r.url()) === `/projects/${created.id}/${archived ? "unarchive" : "archive"}` && r.request().method() === "POST"),
      page.getByTestId(`projects-archive-submit-${created.id}`).click(),
    ]);
    expect(response.ok()).toBe(true);
    await expect(page.getByTestId(`${prefix}-status`)).toHaveText(archived ? "Active" : "Archived");
  }
  await setShellLocale(page, "zh-CN");
  await expect(page.getByTestId(`${prefix}-name`)).toHaveText(name);
  await expect(page.getByTestId(`${prefix}-status`)).toHaveText("进行中");
  expect(errors).toEqual([]);
});
test("a consultant creation attempt is refused by the real API with localized recoverable feedback", async ({ page }) => {
  const denied = `${name}_denied`;
  await login(page, F.email, F.password);
  expect((await openList(page)).some((item) => item.name === denied)).toBe(false);
  await page.getByTestId("projects-new").click();
  await page.getByTestId("project-new-name").fill(denied);
  const [response] = await Promise.all([
    page.waitForResponse((r) => pathOf(r.url()) === "/projects" && r.request().method() === "POST"),
    page.getByTestId("project-new-create").click(),
  ]);
  expect(response.status()).toBe(403);
  await expect(page.getByTestId("project-new-error")).toHaveAttribute("data-reason", "ORG_ROLE_INSUFFICIENT");
  await expect(page.getByTestId("project-new-error")).toContainText("Your role in the current organization cannot create projects");
  await expect(page.getByTestId("project-new-name")).toHaveValue(denied);
  await expect(page.getByTestId("project-new-create")).toBeEnabled();
  await page.setViewportSize({ width: 375, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("project-create-denied-en-375.png") });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  expect((await openList(page)).some((item) => item.name === denied)).toBe(false);
});
