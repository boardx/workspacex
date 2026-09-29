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

test("a maintained persona survives Markdown save, reload and explicit confirmation", async ({ page }) => {
  let current = source;
  let savedMarkdown = "";
  let confirmed = false;
  await page.addInitScript(() => {
    localStorage.setItem("wsx.sessionToken", "e2e-token");
    localStorage.setItem("wsx.session", JSON.stringify({ version: 1, userId: "user-e2e", orgs: ["org-e2e"],
      currentOrgId: "org-e2e", expiresAt: "2099-01-01T00:00:00.000Z" }));
  });
  await page.route("**/identity/me**", (route) => route.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ org: { id: "org-e2e", name: "E2E", kind: "organization", team: null, modelPolicy: "any" },
      orgRole: "lead", teamId: null, projectRole: null, groupId: null, displayName: "E2E User", avatarUrl: null }) }));
  await page.route("**/interviews/digital/itv-quality-e2e", (route) => route.fulfill({ status: 200,
    contentType: "application/json", body: JSON.stringify({ ...view, status: "experts_pending", currentStep: "experts" }) }));
  await page.route("**/interviews/digital/experts", (route) => route.fulfill({ status: 200,
    contentType: "application/json", body: JSON.stringify({ items: [] }) }));
  await page.route("**/interviews/digital/itv-quality-e2e/markdown", (route) => route.fulfill({ status: 200,
    contentType: "application/json", body: JSON.stringify(current) }));
  await page.route("**/interviews/digital/itv-quality-e2e/markdown/experts", (route) => {
    expect(route.request().method()).toBe("POST");
    const input = route.request().postDataJSON() as { markdown: string; expectedVersion: number; expectedDocumentVersion: number };
    expect([input.expectedVersion, input.expectedDocumentVersion]).toEqual([4, 1]);
    savedMarkdown = input.markdown;
    expect(savedMarkdown).toContain("## [张浩宇](#expert-persona-68ecb1289191bb24396f9bd4)");
    expect(savedMarkdown).toContain("模拟画像；不是组织已发布专家或真人访谈证据");
    current = interviewMarkdown.InterviewMarkdownEnvelope.parse({ ...current, version: 5,
      documents: current.documents.map((doc) => doc.step === "experts" ? { ...doc, version: 2, markdown: savedMarkdown,
        contentHash: createHash("sha256").update(savedMarkdown).digest("hex") } : doc) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(current) });
  });
  await page.route("**/interviews/digital/itv-quality-e2e/markdown/experts/confirm", (route) => {
    expect(route.request().postDataJSON()).toEqual({ expectedVersion: 5, expectedDocumentVersion: 2 });
    confirmed = true;
    current = interviewMarkdown.InterviewMarkdownEnvelope.parse({ ...current, version: 6,
      states: current.states.map((state) => state.documentId === "document-e2e-experts" ? { ...state, status: "confirmed" } : state) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(current) });
  });
  await page.route("**/interviews/digital/itv-quality-e2e/markdown/outline/generate", (route) => {
    expect(route.request().postDataJSON()).toEqual({ expectedVersion: 6, expectedDocumentVersion: 0 });
    const markdown = "# 访谈问题\n\n## [张浩宇](#expert-persona-68ecb1289191bb24396f9bd4)\n\n1. 最重要的问题是什么？";
    current = interviewMarkdown.InterviewMarkdownEnvelope.parse({ ...current, version: 7,
      documents: [...current.documents, { documentId: "document-e2e-outline", step: "outline", version: 1, markdown,
        contentHash: createHash("sha256").update(markdown).digest("hex"), evidenceMode: "simulated", references: [] }],
      states: [...current.states, { documentId: "document-e2e-outline", status: "draft", failure: null }] });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(current) });
  });

  await page.goto("/itv/itv-quality-e2e/experts");
  await page.getByRole("button", { name: "添加画像 张浩宇" }).click();
  await expect(page.getByRole("button", { name: "移除专家 张浩宇" })).toBeVisible();
  await page.getByRole("button", { name: "保存专家草稿" }).click();
  await expect.poll(() => savedMarkdown).toContain("#expert-persona-68ecb1289191bb24396f9bd4");
  await page.reload();
  await expect(page.getByRole("button", { name: "移除专家 张浩宇" })).toBeVisible();
  await page.getByRole("button", { name: "确认专家并生成问题" }).click();
  await expect.poll(() => confirmed).toBe(true);
  await expect(page).toHaveURL(/\/itv\/itv-quality-e2e\/outline$/u);
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
  await expect(page.getByText("97 位模拟画像")).toBeVisible();
  await expect(page.getByTestId("itv-persona-card-persona-68ecb1289191bb24396f9bd4")).toContainText("张浩宇");
  await expect(page.getByRole("textbox", { name: "专家文档 Markdown" })).toHaveCount(0);
  await page.getByRole("button", { name: "添加虚拟专家" }).click();
  await expect(page.getByRole("dialog", { name: "添加虚拟专家" })).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();
  await page.reload();
  await expect(page.getByTestId("itv-markdown-experts")).toBeVisible();
  await expect(page.getByTestId("itv-workbench-step-experts")).toHaveAttribute("aria-current", "step");
});

test("virtual-expert model proposal stays unsaved until structured human review", async ({ page }) => {
  test.slow(); // Cold Next route compilation on the isolated browser server can exceed the default navigation budget.
  await page.addInitScript(() => {
    localStorage.setItem("wsx.sessionToken", "e2e-token");
    localStorage.setItem("wsx.session", JSON.stringify({ version: 1, userId: "user-e2e", orgs: ["org-e2e"],
      currentOrgId: "org-e2e", expiresAt: "2099-01-01T00:00:00.000Z" }));
  });
  await page.route("**/identity/me**", (route) => route.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ org: { id: "org-e2e", name: "E2E", kind: "organization", team: null, modelPolicy: "any" },
      orgRole: "lead", teamId: null, projectRole: null, groupId: null, displayName: "E2E User", avatarUrl: null }) }));
  await page.route("**/interviews/digital/itv-quality-e2e", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(view) }));
  await mockCanonicalSource(page);
  let proposals = 0;
  let writes = 0;
  await page.route("**/interviews/digital/itv-quality-e2e/markdown/virtual-expert/preview", (route) => {
    proposals++;
    expect(route.request().postDataJSON()).toMatchObject({ expectedVersion: 4 });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ markdown:
      "# 夜班护理顾问\n\n## 专业角色\n护理顾问\n\n## 专业领域\n护理管理\n\n## 研究关注\n交接流程\n\n## 观点风格\n审慎\n\n## 简介\n只基于已知材料模拟\n\n## 局限与材料边界\n不代表真人受访者" }) });
  });
  await page.route("**/interviews/digital/itv-quality-e2e/markdown/experts", (route) => { writes++; return route.abort(); });
  await page.goto("/itv/itv-quality-e2e/experts", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "添加虚拟专家" }).click();
  const dialog = page.getByRole("dialog", { name: "添加虚拟专家" });
  await dialog.getByRole("textbox", { name: "想添加怎样的专家" }).fill("请按已知材料设计一位关注夜班护理交接流程的模拟顾问，不声称真人访谈。");
  await dialog.getByRole("button", { name: "AI 生成专家画像" }).click();
  await expect(dialog.getByRole("textbox", { name: "专家名称" })).toHaveValue("夜班护理顾问");
  await expect(dialog.getByRole("button", { name: "保存并添加专家" })).toBeDisabled();
  expect(proposals).toBe(1); expect(writes).toBe(0);
  await dialog.getByRole("checkbox", { name: "已审阅画像及模拟边界" }).check();
  await dialog.getByRole("button", { name: "保存并添加专家" }).click();
  await expect(page.getByRole("button", { name: "移除专家 夜班护理顾问" })).toBeVisible();
  expect(writes).toBe(0);
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

test("report summary cards count only saved Markdown items and simulated completed tasks", async ({ page }) => {
  test.slow(); // An isolated Next dev server may compile this direct route on first request.
  const markdown = "# 采购研究报告\n\n## 核心发现\n\n- 否决角色待核实。\n- 审批记录待复核。\n\n## 建议行动\n\n正文建议未列为条目。";
  const report = { documentId: "report-metric-e2e", step: "report" as const, version: 2, markdown,
    contentHash: createHash("sha256").update(markdown).digest("hex"), evidenceMode: "simulated" as const, references: [] };
  const experts = { ...source.documents.find((item) => item.step === "experts")!, markdown: "## [采购顾问](#expert-purchase)\n\n模拟画像。\n\n## [财务顾问](#expert-finance)\n\n模拟画像。" };
  experts.contentHash = createHash("sha256").update(experts.markdown).digest("hex");
  const reportSource = interviewMarkdown.InterviewMarkdownEnvelope.parse({ ...source,
    documents: [...source.documents.filter((item) => item.step !== "experts"), experts, report],
    states: [...source.states, { documentId: report.documentId, status: "completed", failure: null }],
    execution: { status: "completed", tasks: [{ expertId: "purchase", status: "completed", errorCode: null }, { expertId: "finance", status: "failed", errorCode: "MODEL_UNAVAILABLE" }] },
  });
  await page.addInitScript(() => {
    localStorage.setItem("wsx.sessionToken", "e2e-token");
    localStorage.setItem("wsx.session", JSON.stringify({ version: 1, userId: "user-e2e", orgs: ["org-e2e"],
      currentOrgId: "org-e2e", expiresAt: "2099-01-01T00:00:00.000Z" }));
  });
  await page.route("**/identity/me**", (route) => route.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ org: { id: "org-e2e", name: "E2E", kind: "organization", team: null, modelPolicy: "any" },
      orgRole: "lead", teamId: null, projectRole: null, groupId: null, displayName: "E2E User", avatarUrl: null }) }));
  await page.route("**/interviews/digital/itv-quality-e2e", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...view, status: "completed", currentStep: "report" }) }));
  await page.route("**/interviews/digital/itv-quality-e2e/markdown", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reportSource) }));
  await page.goto("/itv/itv-quality-e2e/report", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("itv-report-metric-experts")).toContainText("2");
  await expect(page.getByTestId("itv-report-metric-completed")).toContainText("1");
  await expect(page.getByTestId("itv-report-metric-findings")).toContainText("2");
  await expect(page.getByTestId("itv-report-metric-actions")).toContainText("0");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("itv-report-metrics")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
});

test("prototype journey keeps the list shell separate from all six full-screen stages", async ({ page }, testInfo) => {
  const expert = { ...MOCK_DIGITAL_EXPERTS[0]!, expertId: "expert-audit" };
  const auditExperts = [expert, ...MOCK_DIGITAL_EXPERTS.slice(1, 5).map((candidate, index) => ({ ...candidate, expertId: `expert-audit-${index + 2}` }))];
  const expertHeading = (candidate: typeof expert) => `## [${candidate.displayName}](#expert-${candidate.expertId})`;
  const samples = [
    { step: "intake", markdown: "# 采购研究需求\n\n## 研究目标\n识别最终采购否决权。\n\n## 目标用户\n中型企业采购负责人。" },
    { step: "analysis", markdown: "# 采购研究分析\n\n## 研究目标\n识别最终采购否决权及决策角色。\n\n## 目标人群\n覆盖采购、财务和业务负责人。\n\n## 研究范围\n核对预算、法务、评审和最终签署。\n\n## 成功标准\n识别至少三条可验证的决策路径。\n\n## 建议访谈方向\n讨论采购评审、预算和否决流程。" },
    { step: "experts", markdown: `# 专家选择\n\n${auditExperts.map((candidate) => `${expertHeading(candidate)}\n\n专业角色：${candidate.role}\n\n访谈采购决策链路。`).join("\n\n")}` },
    { step: "outline", markdown: `# 访谈问题\n\n${auditExperts.map((candidate) => `${expertHeading(candidate)}\n\n1. 谁最终决定采购？\n2. 上次否决发生在什么环节？\n3. 如何复核预算？`).join("\n\n")}` },
    { step: "runs", markdown: `# 模拟访谈摘要\n\n${auditExperts.map((candidate) => `${expertHeading(candidate)}\n\n采购流程中存在跨部门复核。该观点仍需真实用户证据验证。`).join("\n\n")}` },
    { step: "report", markdown: [
      "# 采购决策研究报告", "## 执行摘要", "本报告来自 AI 模拟访谈，不代表真实用户证据。",
      "采购决策不是单个职位的一次选择。预算、法务、业务需求和运营交接各有独立的证据要求；在获得真人访谈与审批记录之前，下述结论仅用于设计下一轮研究，不应当被用于真实采购决策。",
      "## 研究背景与方法", "五位模拟专家从不同视角讨论采购链路。研究团队将各角色的主张整理为待验证问题，并明确区分模拟观点与可复核的真实受访者证据。",
      "本轮需要核对一次完整采购从需求提交、预算复核、供应商评估、法务签署到运营交接的时间顺序。若任何环节发生退回，应记录退回发起者、原因、最终解决方式及所需时长。",
      "## 访谈对象", "覆盖采购、财务、业务、法务与运营角色；每一位参与者只代表其自身职责，不能替其他部门回答审批权限。",
      "| 角色 | 待验证职责 | 预期证据 |\n| --- | --- | --- |\n| 采购负责人 | 汇总供应商材料与评审意见 | 评审记录和审批流 |\n| 财务负责人 | 确认预算及付款边界 | 预算审批单和例外处理记录 |\n| 法务负责人 | 检查合同条款与合规要求 | 合同修订记录 |",
      "## 核心发现", "采购否决权仍需真人访谈验证。模拟讨论提示：形式上的最终签字人不一定是实际最先提出否决的部门。",
      "- 需要区分审批、建议和否决三类动作。", "- 需要追踪预算不足和法务不通过时的不同回退路径。", "- 需要验证跨部门意见不一致时谁承担最终记录责任。",
      "## 关键引述", "> 我们需要看到明确的审批记录。", "这段引述是模拟专家意见，并非真实参与者原话；在报告中保留来源边界，避免读者误判证据等级。",
      "## 建议行动", "访谈真实采购负责人，并同步邀请财务、业务及法务角色分别复盘最近一次采购。访谈后把每个关键判断链接到可授权的记录，不能以模拟意见填补真实证据空白。",
      "## 附录：原始洞察摘要", "以上内容均为模拟产出，不应被当作真实受访者证据。后续每次修订都应保留 Markdown 文档版本、证据来源和审阅结果。",
    ].join("\n\n") },
  ] as const;
  const auditSource = interviewMarkdown.InterviewMarkdownEnvelope.parse({
    interviewId: view.interviewId, revisionId: view.revisionId, version: 18,
    documents: samples.map(({ step, markdown }, index) => ({ documentId: `audit-${step}`, step,
      version: 1, markdown, contentHash: createHash("sha256").update(markdown).digest("hex"),
      evidenceMode: "simulated", references: [] })),
    states: samples.map(({ step }) => ({ documentId: `audit-${step}`,
      status: ["intake", "analysis"].includes(step) ? "confirmed" : "draft", failure: null })),
    execution: { status: "paused", tasks: auditExperts.map((candidate, index) => ({ expertId: candidate.expertId,
      status: index < 2 ? "completed" : index === 2 ? "running" : "pending", errorCode: null })) },
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
    body: JSON.stringify({ items: Array.from({ length: 6 }, (_, index) => ({ interviewId: index ? `itv-audit-${index}` : view.interviewId,
      kind: "batch", name: index ? `采购研究 ${index + 1}` : view.name,
      tags: index ? ["采购", "决策链路"] : view.tags, topic: "采购决策研究",
      status: index < 2 ? "questions_pending" : index < 4 ? "running" : "completed", expertCount: 5,
      completedExpertCount: index < 2 ? 0 : index < 4 ? 2 : 5,
      primaryAction: index < 2 ? "confirm_questions" : index < 4 ? "continue" : "view_report",
      sourceStep: "intake", updatedAt: "2026-09-25T00:00:00.000Z" })) }) }));
  await page.route("**/interviews/digital/experts", (route) => route.fulfill({ status: 200,
    contentType: "application/json", body: JSON.stringify({ items: auditExperts.map(toDigitalExpertCatalogRow) }) }));
  await page.route("**/interviews/digital/itv-quality-e2e", (route) => route.fulfill({ status: 200,
    contentType: "application/json", body: JSON.stringify({ ...view, version: auditSource.version,
      status: "questions_pending", currentStep: "questions", topic: "仅元数据，研究正文来自 Markdown" }) }));
  await page.route("**/interviews/digital/itv-quality-e2e/markdown", (route) => route.fulfill({ status: 200,
    contentType: "application/json", body: JSON.stringify(auditSource) }));

  await page.goto("/itv");
  await expect(page.getByTestId("shell-rail")).toBeVisible();
  await expect(page.getByTestId(`itv-history-card-${view.interviewId}`)).toBeVisible();
  await expect(page.locator('[data-testid^="itv-history-card-"]')).toHaveCount(6);
  const listHeadingSize = await page.getByTestId("itv-home-page").getByRole("heading", { name: "用户访谈" })
    .evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize));
  expect(listHeadingSize, "list title should match the compact user-research heading scale").toBe(30);
  const searchBounds = await page.getByTestId("itv-history-search").boundingBox();
  expect(searchBounds?.width, "the list search should be a primary full-row control").toBeGreaterThanOrEqual(500);
  await page.screenshot({ path: testInfo.outputPath("00-list.png"), fullPage: true });
  await page.screenshot({ path: "../../docs/evidence/interview-density/list-1440.png", fullPage: true });
  await page.getByTestId("itv-create").click();
  const createDialog = page.getByTestId("itv-create-dialog");
  await expect(createDialog).toBeVisible();
  await expect(createDialog.getByTestId("itv-create-name")).toBeVisible();
  await expect(createDialog.getByTestId("itv-create-tag-input")).toBeVisible();
  await expect(page).toHaveURL(/\/itv$/u);
  await createDialog.getByRole("button", { name: "取消" }).click();
  await page.getByTestId(`itv-history-card-${view.interviewId}`).getByRole("link", { name: /继续访谈/u }).click();
  await expect(page).toHaveURL(/\/itv\/itv-quality-e2e\/intake$/u);
  await expect(page.getByTestId("shell-rail")).toHaveCount(0);
  await expect(page.getByTestId("itv-workbench-timeline")).toBeVisible();

  await page.goto("/itv/new");
  await expect(page).toHaveURL(/\/itv\?create=1$/u);
  await expect(page.getByTestId("itv-create-dialog")).toBeVisible();
  await expect(page.getByTestId("itv-create-tag-input")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("01-create.png"), fullPage: true });

  await page.setViewportSize({ width: 1280, height: 900 });
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
    if (step === "analysis") {
      const cards = page.locator('[data-testid^="itv-analysis-card-"]');
      await expect(cards).toHaveCount(4);
      const first = await cards.nth(0).boundingBox();
      const second = await cards.nth(1).boundingBox();
      expect(Math.abs((first?.y ?? -100) - (second?.y ?? 100)), "four analysis cards should use the prototype's compact two-column density").toBeLessThan(24);
    }
    if (step === "outline") {
      const groups = page.getByRole("navigation", { name: "访谈问题分组" });
      await expect(groups.getByRole("button")).toHaveCount(5);
      for (const candidate of auditExperts) {
        await expect(page.getByRole("list", { name: `${candidate.displayName}访谈问题` })).toBeVisible();
      }
      await expect(page.getByRole("button", { name: "删除该专家问题" })).toHaveCount(0);
      await groups.getByRole("button", { name: auditExperts[4]!.displayName }).click();
      await expect(groups.getByRole("button", { name: auditExperts[4]!.displayName })).toHaveAttribute("aria-current", "true");
      await groups.getByRole("button", { name: expert.displayName }).click();
    }
    if (step === "runs") {
      const runs = page.getByTestId("itv-source-runs");
      await expect(runs.getByRole("button", { name: /^查看.+的模拟访谈$/u })).toHaveCount(5);
      await expect(runs.getByRole("tablist")).toHaveCount(0);
    }
    if (step === "report") {
      await expect(page.getByRole("navigation", { name: "报告目录" }).getByRole("link")).toHaveCount(8);
      await expect(page.getByTestId("itv-report-metric-experts")).toContainText("5");
      await expect(page.getByTestId("itv-report-metric-completed")).toContainText("2");
      await expect(page.getByTestId("itv-report-metric-findings")).toContainText("3");
      await expect(page.getByTestId("itv-report-metric-actions")).toContainText("0");
      await expect(page.getByTestId("itv-report-metrics")).toContainText("不代表真人样本");
      const reportBodySize = await page.getByTestId("itv-source-report-markdown").getByText("本报告来自 AI 模拟访谈，不代表真实用户证据。")
        .evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize));
      expect(reportBodySize, "long-form report body must use the prototype's readable document type size").toBeGreaterThanOrEqual(16);
    }
    if (step !== "intake") {
      const headingSize = await page.getByTestId(step === "analysis" ? "itv-analysis-workbench" :
        step === "experts" ? "itv-markdown-experts" : step === "outline" ? "itv-markdown-outline" :
          step === "runs" ? "itv-source-runs" : "itv-source-report").getByRole("heading", { level: 2 }).first()
        .evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize));
      expect(headingSize, `${step} heading should retain the prototype's page hierarchy`).toBeGreaterThanOrEqual(30);
    }
    if (step === "intake") {
      const action = await page.getByTestId("itv-markdown-intake").getByRole("button", { name: /下一步：确认分析/u }).boundingBox();
      expect((action?.y ?? 900) + (action?.height ?? 0), "desktop intake primary action should fit in the first viewport without excess whitespace").toBeLessThan(800);
    }
    await page.screenshot({ path: testInfo.outputPath(`${index + 2}-${step}.png`), fullPage: true });
    if (step === "analysis") await page.screenshot({
      path: "../../docs/evidence/interview-density/analysis-1280.png", fullPage: true,
    });
    if (step === "report") {
      await page.screenshot({ path: "../../docs/evidence/interview-density/report-1280.png" });
      const appendix = page.getByTestId("itv-source-report-markdown").getByRole("heading", { name: "附录：原始洞察摘要" });
      await appendix.evaluate((node) => node.scrollIntoView({ block: "center" }));
      await expect(appendix).toBeVisible();
      await page.screenshot({ path: "../../docs/evidence/interview-density/report-1280-end.png" });
    }
    if (step === "experts") {
      await page.getByRole("button", { name: "添加虚拟专家" }).click();
      await expect(page.getByRole("dialog", { name: "添加虚拟专家" })).toBeVisible();
      await expect(page.getByTestId("itv-virtual-expert-preview-card")).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("04-virtual-expert.png"), fullPage: true });
      await page.getByRole("dialog", { name: "添加虚拟专家" }).press("Escape");
    }
    if (step === "outline") {
      const expertQuestions = page.getByRole("list", { name: `${expert.displayName}访谈问题` });
      await expect(expertQuestions).toBeVisible();
      await expect(expertQuestions.getByRole("textbox", { name: "编辑问题 1" })).toHaveValue("谁最终决定采购？");
    }
  }
  await page.getByTestId("itv-return-history").click();
  await expect(page).toHaveURL(/\/itv\?tab=history$/u);
  await expect(page.getByTestId("shell-rail")).toBeVisible();

  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const step of ["intake", "analysis", "experts", "outline", "runs", "report"] as const) {
      await page.goto(`/itv/${view.interviewId}/${step}`);
      await expect(page.getByTestId("itv-markdown-workbench")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
        `${step} must have no horizontal page overflow at ${width}px`).toBe(true);
      if (step === "report") {
        const report = page.getByTestId("itv-source-report-markdown");
        await expect(report.getByRole("table")).toBeVisible();
        await expect(report.getByText("采购决策不是单个职位的一次选择。", { exact: false })).toBeVisible();
        const bounds = await report.evaluate((element) => {
          const parent = element.getBoundingClientRect();
          return [...element.querySelectorAll("h1,h2,p,li,table")].map((node) => {
            const child = node.getBoundingClientRect();
            return { tag: node.tagName, width: child.width, left: child.left, right: child.right,
              parentLeft: parent.left, parentRight: parent.right };
          });
        });
        expect(bounds.length, "long report must render headings, paragraphs, lists and a table").toBeGreaterThan(20);
        for (const bound of bounds) {
          expect(bound.width, `${bound.tag} must have usable width at ${width}px`).toBeGreaterThan(100);
          expect(bound.left, `${bound.tag} must not clip past the left edge at ${width}px`).toBeGreaterThanOrEqual(bound.parentLeft - 2);
          expect(bound.right, `${bound.tag} must not clip past the right edge at ${width}px`).toBeLessThanOrEqual(bound.parentRight + 2);
        }
      }
      await page.screenshot({ path: testInfo.outputPath(`${step}-${width}.png`), fullPage: true });
      if (step === "report" && width === 390) {
        await page.screenshot({ path: "../../docs/evidence/interview-density/report-390.png" });
        const table = page.getByTestId("itv-source-report-markdown").getByRole("table");
        await table.evaluate((node) => node.scrollIntoView({ block: "center" }));
        const tableBounds = await table.boundingBox();
        const stickyBounds = await page.getByTestId("itv-workbench-header").boundingBox();
        expect(tableBounds?.y, "mobile table must not be hidden by the sticky header").toBeGreaterThan((stickyBounds?.y ?? 0) + (stickyBounds?.height ?? 0));
        await page.screenshot({ path: "../../docs/evidence/interview-density/report-390-table.png" });
        const appendix = page.getByTestId("itv-source-report-markdown").getByRole("heading", { name: "附录：原始洞察摘要" });
        await appendix.evaluate((node) => node.scrollIntoView({ block: "center" }));
        await expect(appendix).toBeVisible();
        await page.screenshot({ path: "../../docs/evidence/interview-density/report-390-end.png" });
      }
    }
  }
});

test("saved execution metadata and expert Markdown cards survive the direct route and reload", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const markdown = "# 模拟访谈摘要\n\n## [采购角色](#expert-purchase)\n\n### 关键观点\n\n- [采购审批经过两级](#question-q1)\n\n### 争议点与风险\n\n- 否决权人仍需真人核实。\n\n## [技术角色](#expert-tech)\n\n### 核心发现\n\n- 安全评审尚未完成。";
  const saved = interviewMarkdown.InterviewMarkdownEnvelope.parse({
    interviewId: view.interviewId, revisionId: view.revisionId, version: 7,
    documents: [
      { documentId: "runs-experts", step: "experts", version: 1,
        markdown: "# 专家\n\n## [采购角色](#expert-purchase)\n\n## [技术角色](#expert-tech)",
        contentHash: "a".repeat(64), evidenceMode: "simulated", references: [] },
      { documentId: "runs-saved", step: "runs", version: 2, markdown,
        contentHash: createHash("sha256").update(markdown).digest("hex"), evidenceMode: "simulated", references: [] },
    ],
    states: [{ documentId: "runs-experts", status: "confirmed", failure: null },
      { documentId: "runs-saved", status: "draft", failure: null }],
    execution: { status: "paused", tasks: [
      { expertId: "purchase", status: "completed", errorCode: null },
      { expertId: "tech", status: "pending", errorCode: null },
    ] }, review: null,
  });
  await page.addInitScript(() => {
    localStorage.setItem("wsx.sessionToken", "e2e-token");
    localStorage.setItem("wsx.session", JSON.stringify({ version: 1, userId: "user-e2e", orgs: ["org-e2e"], currentOrgId: "org-e2e", expiresAt: "2099-01-01T00:00:00.000Z" }));
  });
  await page.route("**/identity/me**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ org: { id: "org-e2e", name: "E2E", kind: "organization", team: null, modelPolicy: "any" }, orgRole: "lead", teamId: null, projectRole: null, groupId: null, displayName: "E2E User", avatarUrl: null }) }));
  await page.route("**/interviews/digital/itv-quality-e2e", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...view, version: saved.version, status: "running", currentStep: "interview" }) }));
  await page.route("**/interviews/digital/itv-quality-e2e/markdown", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(saved) }));
  await page.route("**/interviews/digital/itv-quality-e2e/markdown/initialize", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(saved) }));
  await page.goto(`/itv/${view.interviewId}/runs`);
  await expect(page.getByTestId("itv-source-runs")).toBeVisible();
  await expect(page.getByText(/^已完成专家 1\/2/u)).toBeVisible();
  await expect(page.getByRole("button", { name: "查看采购角色的模拟访谈" })).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("heading", { name: "采购角色模拟访谈" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "关键观点" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "争议点与风险" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "核心发现" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "采购审批经过两级" })).toHaveAttribute("href", "#question-q1");
  await page.getByRole("button", { name: "查看技术角色的模拟访谈" }).click();
  await expect(page.getByRole("heading", { name: "技术角色模拟访谈" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "核心发现" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "关键观点" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(/^已完成专家 1\/2/u)).toBeVisible();
  await expect(page.getByRole("heading", { name: "采购角色模拟访谈" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "核心发现" })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("saved-runs-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("saved-runs-mobile.png"), fullPage: true });
});
