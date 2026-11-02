import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, type Page } from "@playwright/test";
import { createDefaultSurveyReportTemplate } from "@repo/contracts/survey-report";
import { SurveyRuntimeSchema } from "@repo/contracts/survey-runtime";

export function surveyAccountFixture() {
  const id = randomUUID(), password = `Survey-R1-${randomUUID()}!`;
  function run(command: "seed" | "cleanup") {
    const stdout = execFileSync("pnpm", ["--filter", "@repo/api", "exec", "tsx", "scripts/survey-r1-fixture.ts", command], {
      cwd: resolve(__dirname, "../../../.."), encoding: "utf8", env: process.env, timeout: 60_000,
      input: JSON.stringify({ id, ...(command === "seed" ? { password } : {}) }),
      stdio: ["pipe", "pipe", "pipe"],
    });
    const payload = stdout.split("__SURVEY_R1_FIXTURE__")[1]?.trim();
    if (!payload) throw Error("survey_fixture_result_missing");
    return JSON.parse(payload) as { userId: string; orgId: string; email: string };
  }
  return { seed: () => ({ ...run("seed"), password }), cleanup: () => run("cleanup") };
}

/** Real API fixtures, restricted to the standard disposable fullstack stack. */
export function ownedSurveyApi(page: Page, identityUrl: string) {
  expect(process.env.WORKSPACEX_ISOLATION_ID).toBeTruthy();
  const observed = new URL(identityUrl);
  expect(observed.hostname).toBe("127.0.0.1");
  const base = `${observed.origin}${observed.pathname.replace(/\/identity\/me$/, "")}`;
  return async (path: string, data?: unknown) => {
    const token = await page.evaluate(() => localStorage.getItem("wsx.sessionToken"));
    expect(token).toBeTruthy();
    const response = await page.request.fetch(`${base}${path}`, {
      method: data === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${token}` },
      ...(data === undefined ? {} : { data }),
    });
    expect(response.ok(), `${response.status()} ${path}`).toBeTruthy();
    return response.json();
  };
}

export function ownedSurveyIdentity(page: Page, identityUrl: string, orgId: string) {
  return ownedSurveyApi(page, identityUrl)(`/identity/me?orgId=${encodeURIComponent(orgId)}`);
}

export async function createOwnedSurvey(page: Page, identityUrl: string, title: string) {
  return SurveyRuntimeSchema.parse(await ownedSurveyApi(page, identityUrl)("/surveys", {
    draft: { title, questions: [], template: createDefaultSurveyReportTemplate(title, []) },
  }));
}

export async function switchSurveyOrganization(page: Page, identityUrl: string, orgId: string) {
  await page.getByTestId("org-switcher").click();
  await page.getByTestId(`org-switcher-option-${orgId}`).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("wsx.session") ?? "null")?.currentOrgId)).toBe(orgId);
  await expect.poll(async () => (await ownedSurveyIdentity(page, identityUrl, orgId)).org.id).toBe(orgId);
}

export async function createSurveyOrganization(page: Page, identityUrl: string) {
  const created = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/auth/organizations") && response.request().method() === "POST");
  await page.getByTestId("org-switcher").click();
  await page.getByTestId("create-organization-entry").click();
  await page.getByLabel("组织名称", { exact: true }).fill(`Survey R1 ${randomUUID()}`);
  await page.getByTestId("create-organization-submit").click();
  const response = await created;
  expect(response.ok()).toBeTruthy();
  const { orgId } = await response.json() as { orgId: string };
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await switchSurveyOrganization(page, identityUrl, orgId);
  return orgId;
}
