import { expect, test } from "@playwright/test";

const view = {
  interviewId: "itv-quality-e2e", name: "采购决策研究", tags: ["用户研究"], topic: null,
  status: "topic_pending", sourceQuickInterviewId: null, selectedExpertIds: [], reportId: null,
  report: null, reportGeneration: null, version: 1,
  scope: { kind: "none", projectId: null, researchProjectId: null }, currentStep: "topic",
  revisionId: "revision-e2e", topicVersionId: null, expertSnapshotVersionId: null,
  questionVersionId: null, expertCandidates: [], questions: [], questionCandidates: [], expertRuns: [],
  skillThreadId: "thread-e2e", skillMessages: [], skillProposals: [], researchBrief: null,
  moderatorPolicy: null, reportReview: null,
  quality: { previewStatus: "unavailable", briefIssues: [], expertCoverage: [], questionFindings: [],
    readiness: null, readinessDecision: null, evidenceCoverage: [] },
};

test("research brief is keyboard reachable and responsive in a real browser", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("wsx.sessionToken", "e2e-token");
    localStorage.setItem("wsx.session", JSON.stringify({ version: 1, userId: "user-e2e", orgs: ["org-e2e"],
      currentOrgId: "org-e2e", expiresAt: "2099-01-01T00:00:00.000Z" }));
  });
  await page.route("**/identity/me**", async (route) => route.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ org: { id: "org-e2e", name: "E2E", kind: "organization", team: null, modelPolicy: "any" },
      orgRole: "lead", teamId: null, projectRole: null, groupId: null, displayName: "E2E User", avatarUrl: null }) }));
  await page.route("**/interviews/digital/itv-quality-e2e", async (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(view),
  }));
  await page.goto("/itv/itv-quality-e2e/setup");
  await expect(page.getByTestId("itv-research-brief")).toBeVisible();
  await page.getByTestId("itv-topic-input").fill("谁拥有最终采购否决权？");
  await page.getByTestId("itv-brief-decision").fill("决定是否调整进入市场路径");
  await expect(page.getByTestId("itv-confirm-topic")).toBeEnabled();
  await page.getByTestId("itv-topic-input").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("itv-brief-decision")).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("itv-research-brief")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});

test("a failed report keeps its partial content and exposes retry in a real browser", async ({ page }) => {
  const failed = { ...view, status: "report_pending", currentStep: "report", topic: "采购决策链路",
    version: 12, reportGeneration: { reportId: "report-failed", requestId: "request-failed", status: "failed",
      title: "采购决策研究报告", executiveSummary: "已保存的摘要", markdown: "## 已保存的分析\n\n采购否决权仍需验证。",
      findings: [], errorCode: "AI_GENERATION_UNAVAILABLE", updatedAt: "2026-09-24T14:00:00.000Z" } };
  await page.addInitScript(() => {
    localStorage.setItem("wsx.sessionToken", "e2e-token");
    localStorage.setItem("wsx.session", JSON.stringify({ version: 1, userId: "user-e2e", orgs: ["org-e2e"],
      currentOrgId: "org-e2e", expiresAt: "2099-01-01T00:00:00.000Z" }));
  });
  await page.route("**/identity/me**", async (route) => route.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ org: { id: "org-e2e", name: "E2E", kind: "organization", team: null, modelPolicy: "any" },
      orgRole: "lead", teamId: null, projectRole: null, groupId: null, displayName: "E2E User", avatarUrl: null }) }));
  await page.route("**/interviews/digital/itv-quality-e2e", async (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(failed),
  }));

  await page.goto("/itv/itv-quality-e2e/setup");

  await expect(page.getByTestId("itv-report-stream-markdown")).toContainText("采购否决权仍需验证");
  await expect(page.getByText("模型服务暂时不可用或返回内容不完整。", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "重新生成报告" }).click();
  await expect(page.getByRole("dialog")).toContainText("是否重新生成？");
  await expect(page.getByRole("button", { name: "确认重新生成" })).toBeVisible();
});

test("a completed report separates the decision brief and replaces an empty evidence table with guidance", async ({ page }) => {
  const completed = { ...view, status: "completed", currentStep: "report", topic: "采购决策链路", version: 13,
    reportId: "report-completed", reportGeneration: null, report: { reportId: "report-completed", title: "采购决策研究报告",
      executiveSummary: "先验证采购否决权，再决定进入路径。", markdown: "# 采购决策研究报告\n\n## 研究发现\n\n采购否决权仍需验证。",
      findings: [], generatedAt: "2026-09-25T00:00:00.000Z" },
    studyEvidenceMode: "simulated",
    reportEvidenceEligibility: { eligibility: "blocked_missing_participant_evidence",
      message: "需要真实受访者证据后才能批准。", action: "添加并复核真实受访者回答" } };
  await page.addInitScript(() => {
    localStorage.setItem("wsx.sessionToken", "e2e-token");
    localStorage.setItem("wsx.session", JSON.stringify({ version: 1, userId: "user-e2e", orgs: ["org-e2e"], currentOrgId: "org-e2e", expiresAt: "2099-01-01T00:00:00.000Z" }));
  });
  await page.route("**/identity/me**", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ org: { id: "org-e2e", name: "E2E", kind: "organization", team: null, modelPolicy: "any" }, orgRole: "lead", teamId: null, projectRole: null, groupId: null, displayName: "E2E User", avatarUrl: null }) }));
  await page.route("**/interviews/digital/itv-quality-e2e", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(completed) }));
  await page.goto("/itv/itv-quality-e2e/setup");
  await expect(page.getByTestId("itv-report-decision-brief")).toContainText("先验证采购否决权");
  await expect(page.getByTestId("itv-evidence-review-empty")).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
});
