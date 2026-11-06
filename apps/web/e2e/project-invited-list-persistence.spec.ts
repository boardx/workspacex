import { expect, test, type Page } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

const API = "/__fullstack_api";

async function loginMember(page: Page) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.memberEmail);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.memberPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/home$/);
}

test("受邀通用项目：返回全部项目、刷新和全新会话登录后仍可见，未受邀项目不泄露", async ({ page, browser, request, baseURL }, info) => {
  test.setTimeout(120_000);
  const ownerLogin = await request.post(`${API}/auth/login`, {
    data: { email: FULLSTACK_E2E.leadEmail, password: FULLSTACK_E2E.leadPassword },
  });
  expect(ownerLogin.ok()).toBe(true);
  const { sessionToken } = await ownerLogin.json() as { sessionToken: string };
  const headers = { Authorization: `Bearer ${sessionToken}` };
  const name = `受邀后保留-${Date.now()}`;
  const privateName = `${name}-未受邀`;
  async function createProject(projectName: string) {
    const response = await request.post(`${API}/projects`, {
      headers,
      data: { orgId: FULLSTACK_E2E.orgId, name: projectName, kind: "general", blueprintVersionId: null },
    });
    expect(response.status()).toBe(201);
    return (await response.json() as { id: string }).id;
  }
  const projectId = await createProject(name);
  await createProject(privateName);
  const invitation = await request.post(`${API}/projects/${projectId}/invitations/link`, {
    headers, data: { projectId },
  });
  expect(invitation.ok()).toBe(true);
  const { inviteUrl } = await invitation.json() as { inviteUrl: string };
  expect(new URL(inviteUrl).origin).toBe(new URL(baseURL!).origin);

  await loginMember(page);
  await page.goto("/projects");
  await expect(page.getByTestId("projects-screen")).toBeVisible();
  await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  await page.goto(inviteUrl);
  await page.getByTestId("project-join-accept-button").click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
  await expect(page.getByTestId("project-title")).toHaveText(name);
  await page.getByTestId("project-back-to-list").click();
  await expect(page).toHaveURL(/\/projects$/);
  for (const refresh of [false, true]) {
    if (refresh) await page.reload();
    await expect(page.getByTestId("projects-list").getByText(name, { exact: true })).toBeVisible();
    await expect(page.getByText(privateName, { exact: true })).toHaveCount(0);
  }
  await page.screenshot({ path: info.outputPath("joined-project-list-after-refresh.png"), fullPage: true });

  // No storage/cookies from the accepting browser: the project must come from persisted membership.
  const fresh = await browser.newContext({ baseURL });
  try {
    const returning = await fresh.newPage();
    await loginMember(returning);
    await returning.goto("/projects");
    await expect(returning.getByTestId("projects-list").getByText(name, { exact: true })).toBeVisible();
    await expect(returning.getByText(privateName, { exact: true })).toHaveCount(0);
    await returning.getByTestId("projects-list").getByText(name, { exact: true }).click();
    await expect(returning.getByTestId("project-title")).toHaveText(name);
    await returning.screenshot({ path: info.outputPath("joined-project-after-new-login.png"), fullPage: true });
  } finally {
    await fresh.close();
  }
});
