import { test, expect } from "@playwright/test";
import { research } from "@repo/contracts";
import { runtimeFixture } from "../tests/guided-runtime-fixture";

test("real research routes retain data and edits while revalidating read-only backend changes", async ({ page }, info) => {
  let state = runtimeFixture("report", "route-continuity");
  let commands = 0, reads = 0;
  let release: (() => void) | undefined;
  let gate: Promise<void> | undefined;
  await page.addInitScript(() => {
    localStorage.setItem("wsx.sessionToken", "research-route-test-identity");
    localStorage.setItem("wsx.session", JSON.stringify({ version: 1, userId: "route-test-user", orgs: ["route-test-org"], currentOrgId: "route-test-org", expiresAt: "2099-01-01T00:00:00Z" }));
  });
  await page.route("**/identity/**", route => route.fulfill({ status: 503, contentType: "application/json", body: '{"reasonCode":"CONTROLLED_TEST_DEPENDENCY"}' }));
  await page.route("**/research/guided-sessions/route-continuity**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "POST") { commands++; await route.fulfill({ status: 500, body: "unexpected command" }); return; }
    let body: unknown = state;
    if (path.endsWith("/progress")) {
      reads++;
      await gate;
      body = research.GuidedResearchRuntimePatch.parse({ type: "patch", sessionId: state.sessionId, version: state.version, revision: state.revision, changes: { report: state.report }, removed: [] });
    } else if (!path.endsWith("/runtime")) body = research.GuidedResearchSession.parse({ sessionId: state.sessionId, title: "切换连续性研究", brief: state.brief,
      stage: "report", resumeStage: "report", status: "active", progress: 100, sourceCount: 1, reportId: null, createdAt: "2026-10-28", updatedAt: "2026-10-28" });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/research/route-continuity/import");
  const goal = page.getByRole("textbox", { name: "研究需求" });
  await expect(goal).toHaveValue(state.brief.goal, { timeout: 30000 });
  gate = new Promise<void>(resolve => { release = resolve; });
  await page.getByRole("button", { name: /研究计划$/ }).click();
  await expect(page.getByTestId("guided-research-plan-panel")).toBeVisible();
  await expect(page).toHaveURL(/\/plan$/);
  await expect.poll(() => reads).toBeGreaterThan(0);
  await expect(page.getByText("正在恢复研究会话…", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("plan-during-delayed-validation.png"), fullPage: true });
  state = { ...state, version: state.version + 1, revision: state.revision + 1, report: { ...state.report!, summary: "后端更新后的报告摘要" } };
  release?.(); gate = undefined;
  await page.getByRole("navigation", { name: "研究步骤" }).getByRole("button", { name: /生成报告$/ }).click();
  await expect(page.getByTestId("research-report")).toContainText("后端更新后的报告摘要");
  await page.getByRole("button", { name: /确认研究内容$/ }).click();
  await goal.fill("浏览器保留的未提交需求");
  await page.getByRole("button", { name: /研究计划$/ }).click();
  await page.getByRole("button", { name: "继续编辑" }).click();
  await expect(goal).toHaveValue("浏览器保留的未提交需求");
  await page.screenshot({ path: info.outputPath("retained-draft.png"), fullPage: true });

  expect(commands).toBe(0);
});
