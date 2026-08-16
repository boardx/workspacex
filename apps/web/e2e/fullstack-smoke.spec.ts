import { expect, test } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

test("anonymous root fails closed in production HTML, RSC, and no-JS navigation", async ({ page, request, browser }) => {
  const htmlResponse = await request.get("/", { maxRedirects: 0 });
  const htmlBody = await htmlResponse.text();
  expect(htmlResponse.status()).toBe(307);
  expect(htmlResponse.headers().location).toBe("/login");
  expect(htmlBody).not.toContain("前端内核已就绪");
  expect(htmlBody).not.toContain("home-kitchen-sink-link");

  // Middleware must redirect the RSC request before a static route can emit a
  // body-only NEXT_REDIRECT record with no usable Location header.
  const rscResponse = await request.get("/", { headers: { RSC: "1" }, maxRedirects: 0 });
  const rscBody = await rscResponse.text();
  expect(rscResponse.status()).toBe(307);
  expect(rscResponse.headers().location).toBe("/login");
  expect(rscBody).not.toContain("前端内核已就绪");
  expect(rscBody).not.toContain("home-kitchen-sink-link");

  const noJsContext = await browser.newContext({ javaScriptEnabled: false });
  const noJsPage = await noJsContext.newPage();
  const noJsResponse = await noJsPage.goto("/");
  expect(noJsResponse?.status()).toBe(200);
  await expect(noJsPage).toHaveURL(/\/login$/);
  await expect(noJsPage.getByTestId("login-form")).toBeVisible();
  await expect(noJsPage.getByText("前端内核已就绪")).toHaveCount(0);
  await noJsContext.close();

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
  page.on("requestfailed", (request) => {
    const error = request.failure()?.errorText;
    const url = new URL(request.url());
    // Root -> login and the hydrated-session login -> projects handoff can
    // intentionally cancel the superseded login document or an RSC prefetch.
    if (
      error === "net::ERR_ABORTED" &&
      (url.pathname === "/login" || url.searchParams.has("_rsc"))
    ) return;
    failures.push(`requestfailed ${request.method()} ${request.url()}: ${error}`);
  });
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
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByTestId("app-shell")).toBeVisible();
  // 2026-08-11 信息架构调整：组织切换器从顶栏并入左上角组织菜单（org-menu.tsx，
  // 人类直接要求）。触发器（org-switcher）现在呈现组织头像/首字，完整组织名要点开
  // 菜单读当前项（aria-checked=true 的 menuitemradio）—— 验证的还是
  // 「当前选中的组织是谁」，交互路径变了读法跟着变。种子脚本把组织名写成
  // `org ${orgId}`（见 apps/api/tests/support/db.ts 的 seedOrg）。
  await page.getByTestId("org-switcher").click();
  const currentOrgOption = page.getByTestId(`org-switcher-option-${FULLSTACK_E2E.orgId}`);
  await expect(currentOrgOption).toHaveText(`org ${FULLSTACK_E2E.orgId}`);
  await expect(currentOrgOption).toHaveAttribute("aria-checked", "true");
  // 组织管理入口也在这同一个左上角菜单里（org-admin-entry → /org-admin）。
  await expect(page.getByTestId("org-admin-entry")).toHaveAttribute("href", "/org-admin");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("org-menu")).toHaveCount(0);
  // 退出已从顶栏挪进左下角个人菜单（2026-08-09 信息架构调整）——先展开菜单再断言。
  await page.getByTestId("rail-profile-menu").click();
  await expect(page.getByTestId("personal-menu-logout")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("/projects");
  await expect(page.getByTestId(`projects-card-${FULLSTACK_E2E.projectId}-enter`)).toBeVisible();
  await page.getByTestId(`projects-card-${FULLSTACK_E2E.projectId}-enter`).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${FULLSTACK_E2E.projectId}`));
  await expect(page.getByTestId("project-workbench")).toBeVisible();
  await expect(page.getByTestId("project-title")).toHaveText(FULLSTACK_E2E.projectName);
  await expect(page.getByTestId("project-overview-live-overview-body")).toBeVisible();

  // #978: 项目工作台「工作面」清单里的「推演画布」入口——PR #977 把 /canvas 从后台导航
  // 移除后，这是它唯一剩下的、带项目上下文（projectId）的真实入口。断言真点了会真的
  // 落到 /projects/:id/canvas 且画布壳体渲染出来，不是 getByText 空转。
  await page.getByTestId("project-home-surface-canvas").click();
  await expect(page).toHaveURL(new RegExp(`/projects/${FULLSTACK_E2E.projectId}/canvas`));
  await expect(page.getByTestId("canvas-main")).toBeVisible();
  await expect(page.getByTestId("canvas-left-panel")).toBeVisible();

  await page.goto(`/projects/${FULLSTACK_E2E.projectId}`);
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
