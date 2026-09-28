import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { interviewMarkdown } from "@repo/contracts";
import { MOCK_DIGITAL_EXPERTS, toDigitalExpertCatalogRow } from "../lib/mock/digital-expert-personas";

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

const source = interviewMarkdown.InterviewMarkdownEnvelope.parse({
  interviewId: view.interviewId, revisionId: view.revisionId, version: 4,
  documents: [
    { step: "intake", markdown: "# 采购研究需求\n\n研究谁拥有最终采购否决权。" },
    { step: "analysis", markdown: "# 采购决策分析\n\n## 研究目标\n\n识别最终采购否决权及决策角色。\n\n## 研究建议\n\n先验证采购流程假设，再审阅专家意见。" },
    // Catalogue identity remains separate from this not-yet-confirmed selection draft.
    { step: "experts", markdown: "# 专家选择草稿\n\n从已授权专家库选择采购决策顾问。" },
  ].map(({ step, markdown }) => ({ documentId: `document-e2e-${step}`, step, version: 1, markdown,
    contentHash: createHash("sha256").update(markdown).digest("hex"), evidenceMode: "simulated", references: [] })),
  states: [
    { documentId: "document-e2e-intake", status: "confirmed", failure: null },
    { documentId: "document-e2e-analysis", status: "draft", failure: null },
    { documentId: "document-e2e-experts", status: "draft", failure: null },
  ], execution: null, review: null,
});

async function mockCanonicalSource(page: Page) {
  await page.route("**/interviews/digital/itv-quality-e2e/markdown", (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(source) });
  });
  await page.route("**/interviews/digital/experts", (route) => route.fulfill({ status: 200,
    contentType: "application/json", body: JSON.stringify({ items: [toDigitalExpertCatalogRow(MOCK_DIGITAL_EXPERTS[0]!)] }) }));
}

test("expert avatar changes persist, reset and fit desktop/tablet/mobile", async ({ page }, testInfo) => {
  const expert = MOCK_DIGITAL_EXPERTS[0]!;
  const expertsView = { ...view, version: source.version, topic: "旧 JSON 主题不应成为 canonical 研究正文", status: "experts_pending", currentStep: "experts" };
  await page.addInitScript(() => {
    localStorage.setItem("wsx.sessionToken", "e2e-token");
    localStorage.setItem("wsx.session", JSON.stringify({ version: 1, userId: "user-e2e", orgs: ["org-e2e"], currentOrgId: "org-e2e", expiresAt: "2099-01-01T00:00:00.000Z" }));
  });
  await page.route("**/identity/me**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ org: { id: "org-e2e", name: "E2E", kind: "organization", team: null, modelPolicy: "any" }, orgRole: "lead", teamId: null, projectRole: null, groupId: null, displayName: "E2E User", avatarUrl: null }) }));
  await page.route("**/interviews/digital/itv-quality-e2e", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(expertsView) }));
  await mockCanonicalSource(page);
  let preference: { expertId: string; avatarKey: string | null; version: number } = { expertId: expert.expertId, avatarKey: null, version: 0 };
  const savedKeys: (string | null)[] = [];
  await page.route(`**/interviews/digital/experts/${encodeURIComponent(expert.expertId)}/avatar`, (route) => {
    if (route.request().method() === "PATCH") {
      const input = route.request().postDataJSON() as { avatarKey: string | null; expectedVersion: number };
      expect(input.expectedVersion).toBe(preference.version);
      expect(Object.keys(input).sort()).toEqual(["avatarKey", "expectedVersion"]);
      savedKeys.push(input.avatarKey);
      preference = { ...preference, avatarKey: input.avatarKey, version: preference.version + 1 };
    } else expect(route.request().method()).toBe("GET");
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(preference) });
  });
  await page.goto("/itv/itv-quality-e2e/experts");
  const expertCard = page.getByTestId("itv-markdown-experts").getByRole("heading", { name: expert.displayName, exact: true }).locator("..");
  await expect(expertCard).toContainText(expert.role);
  await expertCard.getByRole("button", { name: `修改${expert.displayName}头像` }).click();
  const editor = page.getByRole("dialog", { name: `修改${expert.displayName}头像` });
  await expect(editor).toContainText("保存到当前账号并跨会话同步");
  for (const width of [1280, 768, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(editor.getByRole("button", { name: "机器人头像" })).toBeVisible();
    expect(await editor.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`avatar-${width}.png`) });
  }
  await editor.getByRole("button", { name: "机器人头像" }).click();
  await editor.getByRole("button", { name: "保存头像" }).click();
  await expect(editor).not.toBeVisible();
  await expect(expertCard.getByRole("img")).toHaveAttribute("data-avatar-key", "robot");
  expect(savedKeys).toEqual(["robot"]);
  await page.goto(`/itv/experts/${encodeURIComponent(expert.expertId)}`);
  await expect(page.getByTestId("itv-expert-detail").getByRole("img")).toHaveAttribute("data-avatar-key", "robot");
  await expect(page.getByRole("button", { name: `修改${expert.displayName}头像` })).toBeVisible();
  await page.goto("/itv/itv-quality-e2e/experts");
  await page.reload();
  await expect(expertCard.getByRole("img")).toHaveAttribute("data-avatar-key", "robot");
  await expertCard.getByRole("button", { name: `修改${expert.displayName}头像` }).click();
  await editor.getByRole("button", { name: "恢复默认" }).click();
  await editor.getByRole("button", { name: "保存头像" }).click();
  await expect(editor).not.toBeVisible();
  await expect(expertCard.getByRole("img")).not.toHaveAttribute("data-avatar-key", "robot");
  expect(savedKeys).toEqual(["robot", null]);
  await page.reload();
  await expect(expertCard.getByRole("img")).not.toHaveAttribute("data-avatar-key", "robot");
});

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
  // The retained JSON setup owns its legacy assistant; named source routes do not.
  await page.getByTestId("itv-skill-drawer-trigger").click();
  await expect(page.getByTestId("itv-skill-drawer")).toHaveAttribute("aria-hidden", "false");
});

test("the six-stage workbench restores a direct stage route and updates it from the timeline", async ({ page }) => {
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

  await mockCanonicalSource(page);
  await page.goto("/itv/itv-quality-e2e/analysis");
  await expect(page.getByTestId("shell-rail")).toHaveCount(0);
  await expect(page.getByTestId("itv-workbench-header")).toBeVisible();
  await expect(page.getByTestId("itv-workbench-navigation")).toBeVisible();
  await expect(page.getByTestId("itv-workbench-step-intake")).toContainText("导入需求");
  await expect(page.getByTestId("itv-workbench-step-analysis")).toContainText("确认分析");
  await expect(page.getByTestId("itv-workbench-step-report")).toContainText("生成报告");
  await expect(page.getByTestId("itv-workbench-step-experts")).toContainText("选择专家");
  await expect(page.getByTestId("itv-workbench-step-outline")).toContainText("访谈问题");
  await expect(page.getByTestId("itv-workbench-step-runs")).toContainText("开始访谈");
  await expect(page.getByTestId("itv-workbench-step-analysis")).toHaveAttribute("aria-current", "step");

  await expect(page.getByTestId("itv-analysis-workbench")).toContainText("研究目标");
  await expect(page.getByTestId("itv-analysis-workbench")).toContainText("文档版本 1");
  await expect(page.getByRole("article").filter({ has: page.getByRole("heading", { name: "研究目标", exact: true }) })).toContainText("识别最终采购否决权及决策角色。");
  await expect(page.getByTestId("itv-analysis-suggestion-section-3")).toContainText("先验证采购流程假设，再审阅专家意见。");
  await page.getByTestId("itv-workbench-step-experts").click();
  await expect(page).toHaveURL(/\/itv\/itv-quality-e2e\/experts$/);
  await expect(page.getByTestId("itv-markdown-experts")).toBeVisible();
  await expect(page.getByTestId("itv-workbench-step-experts")).toHaveAttribute("aria-current", "step");
  await page.getByText("审阅与编辑专家画像 Markdown", { exact: true }).click();
  await expect(page.getByRole("textbox", { name: "专家文档 Markdown" })).toHaveValue(source.documents[2]!.markdown);
  await expect(page.getByTestId("itv-expert-document-preview")).toContainText("从已授权专家库选择采购决策顾问。");
  await page.reload();
  await expect(page.getByTestId("itv-markdown-experts")).toBeVisible();
  await expect(page.getByTestId("itv-workbench-step-experts")).toHaveAttribute("aria-current", "step");
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
  await expect(page.getByTestId("itv-evidence-review").getByTestId("itv-evidence-review-blocked")).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
});

test("prototype journey keeps the list shell separate from all six full-screen stages", async ({ page }, testInfo) => {
  const expert = { ...MOCK_DIGITAL_EXPERTS[0]!, expertId: "expert-audit" };
  const samples = [
    { step: "intake", markdown: "# 采购研究需求\n\n## 研究目标\n识别最终采购否决权。\n\n## 目标用户\n中型企业采购负责人。" },
    { step: "analysis", markdown: "# 采购研究分析\n\n## 研究目标\n识别最终采购否决权及决策角色。\n\n## 建议访谈方向\n讨论采购评审、预算和否决流程。" },
    { step: "experts", markdown: `# 专家选择\n\n## [${expert.displayName}](#expert-${expert.expertId})\n\n专业角色：${expert.role}\n\n访谈采购决策链路。` },
    { step: "outline", markdown: `# 访谈问题\n\n## [${expert.displayName}](#expert-${expert.expertId})\n\n1. 谁最终决定采购？\n2. 上次否决发生在什么环节？` },
    { step: "runs", markdown: `# 模拟访谈摘要\n\n## [${expert.displayName}](#expert-${expert.expertId})\n\n采购流程中存在跨部门复核。` },
    { step: "report", markdown: "# 采购决策研究报告\n\n## 执行摘要\n本报告来自 AI 模拟访谈，不代表真实用户证据。\n\n## 核心发现\n采购否决权仍需真人访谈验证。\n\n## 建议行动\n访谈真实采购负责人。" },
  ] as const;
  const auditSource = interviewMarkdown.InterviewMarkdownEnvelope.parse({
    interviewId: view.interviewId, revisionId: view.revisionId, version: 18,
    documents: samples.map(({ step, markdown }, index) => ({ documentId: `audit-${step}`, step,
      version: 1, markdown, contentHash: createHash("sha256").update(markdown).digest("hex"),
      evidenceMode: "simulated", references: [] })),
    states: samples.map(({ step }) => ({ documentId: `audit-${step}`,
      status: ["intake", "analysis"].includes(step) ? "confirmed" : "draft", failure: null })),
    execution: { status: "paused", tasks: [{ expertId: expert.expertId, status: "completed", errorCode: null }] },
    review: null,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => {
    localStorage.setItem("wsx.sessionToken", "e2e-token");
    localStorage.setItem("wsx.session", JSON.stringify({ version: 1, userId: "user-e2e", orgs: ["org-e2e"],
      currentOrgId: "org-e2e", expiresAt: "2099-01-01T00:00:00.000Z" }));
  });
  await page.route("**/identity/me**", (route) => route.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ org: { id: "org-e2e", name: "E2E", kind: "organization", team: null, modelPolicy: "any" },
      orgRole: "lead", teamId: null, projectRole: null, groupId: null, displayName: "E2E User", avatarUrl: null }) }));
  await page.route("**/interviews/digital", (route) => route.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ items: [{ interviewId: view.interviewId, kind: "batch", name: view.name,
      tags: view.tags, topic: "采购决策研究", status: "questions_pending", expertCount: 1,
      completedExpertCount: 0, primaryAction: "confirm_questions", sourceStep: "intake",
      updatedAt: "2026-09-25T00:00:00.000Z" }] }) }));
  await page.route("**/interviews/digital/experts", (route) => route.fulfill({ status: 200,
    contentType: "application/json", body: JSON.stringify({ items: [toDigitalExpertCatalogRow(expert)] }) }));
  await page.route("**/interviews/digital/itv-quality-e2e", (route) => route.fulfill({ status: 200,
    contentType: "application/json", body: JSON.stringify({ ...view, version: auditSource.version,
      status: "questions_pending", currentStep: "questions", topic: "仅元数据，研究正文来自 Markdown" }) }));
  await page.route("**/interviews/digital/itv-quality-e2e/markdown", (route) => route.fulfill({ status: 200,
    contentType: "application/json", body: JSON.stringify(auditSource) }));

  await page.goto("/itv");
  await expect(page.getByTestId("shell-rail")).toBeVisible();
  await expect(page.getByTestId(`itv-history-card-${view.interviewId}`)).toBeVisible();
  const listHeadingSize = await page.getByTestId("itv-home-page").getByRole("heading", { name: "用户访谈" })
    .evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize));
  expect(listHeadingSize, "list title should be the primary visual anchor").toBeGreaterThanOrEqual(36);
  const searchBounds = await page.getByTestId("itv-history-search").boundingBox();
  expect(searchBounds?.width, "the list search should be a primary full-row control").toBeGreaterThanOrEqual(500);
  await page.screenshot({ path: testInfo.outputPath("00-list.png"), fullPage: true });
  await page.getByTestId(`itv-history-card-${view.interviewId}`).getByRole("link", { name: /继续访谈/u }).click();
  await expect(page).toHaveURL(/\/itv\/itv-quality-e2e\/intake$/u);
  await expect(page.getByTestId("shell-rail")).toHaveCount(0);
  await expect(page.getByTestId("itv-workbench-timeline")).toBeVisible();

  await page.goto("/itv/new");
  await expect(page.getByTestId("itv-markdown-intake")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("01-create.png"), fullPage: true });

  for (const [index, step] of ["intake", "analysis", "experts", "outline", "runs", "report"].entries()) {
    await page.goto(`/itv/${view.interviewId}/${step}`);
    await expect(page.getByTestId("itv-markdown-workbench")).toBeVisible();
    const headerBounds = await page.getByTestId("itv-workbench-header").boundingBox();
    expect(headerBounds?.height, "shared stage header must not push primary content below the fold").toBeLessThan(220);
    await expect(page.getByTestId(`itv-workbench-step-${step}`)).toHaveAttribute("aria-current", "step");
    await expect(page.getByTestId("shell-rail")).toHaveCount(0);
    await expect(page.getByTestId(step === "analysis" ? "itv-analysis-workbench" :
      step === "experts" ? "itv-markdown-experts" : step === "outline" ? "itv-markdown-outline" :
        step === "runs" ? "itv-source-runs" : step === "report" ? "itv-source-report" : "itv-markdown-intake")).toBeVisible();
    if (step !== "intake") {
      const headingSize = await page.getByTestId(step === "analysis" ? "itv-analysis-workbench" :
        step === "experts" ? "itv-markdown-experts" : step === "outline" ? "itv-markdown-outline" :
          step === "runs" ? "itv-source-runs" : "itv-source-report").getByRole("heading", { level: 2 }).first()
        .evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize));
      expect(headingSize, `${step} heading should retain the prototype's page hierarchy`).toBeGreaterThanOrEqual(30);
    }
    await page.screenshot({ path: testInfo.outputPath(`${index + 2}-${step}.png`), fullPage: true });
    if (step === "experts") {
      await page.getByRole("button", { name: "添加虚拟专家" }).click();
      await expect(page.getByRole("dialog", { name: "添加虚拟专家" })).toBeVisible();
      await expect(page.getByTestId("itv-virtual-expert-preview-card")).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("04-virtual-expert.png"), fullPage: true });
      await page.getByRole("dialog", { name: "添加虚拟专家" }).press("Escape");
    }
    if (step === "outline") {
      await expect(page.getByRole("list", { name: `${expert.displayName}访谈问题` })).toBeVisible();
      await expect(page.getByRole("textbox", { name: "编辑问题 1" })).toHaveValue("谁最终决定采购？");
    }
  }
  await page.getByTestId("itv-return-history").click();
  await expect(page).toHaveURL(/\/itv\?tab=history$/u);
  await expect(page.getByTestId("shell-rail")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/itv/${view.interviewId}/report`);
  await expect(page.getByTestId("itv-source-report")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("09-report-mobile.png"), fullPage: true });
});
