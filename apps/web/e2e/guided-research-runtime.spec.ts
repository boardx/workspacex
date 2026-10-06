import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";
test("research persists the confirmed-question pipeline through the real UI, API and PostgreSQL", async ({ page }, testInfo) => {
  test.setTimeout(180000);
  const researchName = `研究全链路验证 ${randomUUID()}`;
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.email);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goto("/research");
  await expect(page.getByTestId("research-home-page")).toHaveAttribute("data-reference-layout", "research-list");
  await page.getByTestId("research-create").click();
  await expect(page).toHaveURL(/\/research\/new$/);
  await expect(page.getByTestId("shell-rail")).not.toBeVisible();
  await expect(page.getByTestId("research-workspace-header")).toBeVisible();
  await page.getByText("完善研究信息", { exact: true }).click();
  await page.getByTestId("research-brief-topic").fill(researchName);
  await page.getByTestId("research-brief-goal").fill("核对储能并网政策");
  await page.getByTestId("research-brief-focus").fill("政策实施约束");
  let releaseGeneration!: () => void;
  const generationGate = new Promise<void>((resolve) => { releaseGeneration = resolve; });
  const submittedCommands: Array<{ node: string; action: string }> = [];
  await page.route("**/runtime/commands**", async (route) => {
    if (route.request().method() === "POST") {
      const command = route.request().postDataJSON();
      submittedCommands.push({ node: command.node, action: command.action });
      if (command.node === "brief" && command.action === "prepare_plan") await generationGate;
    }
    await route.continue();
  });
  await page.getByTestId("research-confirm-brief").click();
  try {
    await expect(page.getByRole("button", { name: /研究计划$/ })).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("button", { name: /研究计划$/ })).toHaveAttribute("aria-current", "step");
    await expect(page.getByTestId("research-step-report")).toHaveAttribute("aria-disabled", "true");
    await page.screenshot({ path: testInfo.outputPath("research-next-step-loading.png"), fullPage: true });
  } finally { releaseGeneration(); }
  await expect(page.getByRole("heading", { name: researchName, exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/research\/[^/]+\/plan$/);
  await expect(page.getByTestId("guided-research-plan-panel")).toHaveAttribute("data-reference-layout", "plan-workspace");
  expect(submittedCommands.filter(command => command.action === "prepare_plan")).toHaveLength(1);
  // The assistant still persists a proposal/application through the real API.
  await page.getByRole("button", { name: "AI 助手", exact: true }).click();
  await expect(page.getByRole("button", { name: "AI 助手", exact: true })).toHaveAttribute("aria-expanded", "true");
  await page.getByLabel("研究对话").fill("请检查研究方向");
  await page.getByRole("button", { name: "发送研究消息" }).click();
  const appliedSuggestion = page.waitForResponse(response => response.url().endsWith("/runtime/commands")
    && response.request().method() === "POST" && response.request().postDataJSON()?.action === "apply");
  await page.getByRole("button", { name: "应用建议" }).click();
  expect((await appliedSuggestion).ok()).toBe(true);
  await page.reload();
  await expect(page).toHaveURL(/\/research\/[^/]+\/plan$/);
  await page.getByRole("button", { name: "AI 助手", exact: true }).click();
  await expect(page.getByTestId("research-skill-messages")).toContainText("请检查研究方向");
  await page.getByRole("button", { name: "AI 助手", exact: true }).click();
  // Persistent plan editing replaces the retired manual direction/topic confirmation.
  const plans = page.getByRole("list", { name: "研究计划", exact: true });
  await expect(plans).toBeVisible();
  await expect(page.getByTestId("guided-research-markdown-editor")).toHaveCount(0);
  await page.getByRole("button", { name: /^编辑计划 1/ }).click();
  const editor = page.getByRole("textbox", { name: "计划 1", exact: true });
  await editor.fill("核实政策适用范围与实施约束");
  const savedDraft = page.waitForResponse(response => response.url().endsWith("/runtime/commands")
    && response.request().method() === "POST" && response.request().postDataJSON()?.action === "save");
  await page.getByRole("button", { name: "保存计划", exact: true }).click();
  await page.getByRole("button", { name: "确认保存", exact: true }).click();
  expect((await savedDraft).ok()).toBe(true);
  await page.reload();
  await expect(page).toHaveURL(/\/research\/[^/]+\/plan$/);
  await page.getByRole("button", { name: /^编辑计划 1/ }).click();
  await expect(page.getByRole("textbox", { name: "计划 1", exact: true })).toHaveValue("核实政策适用范围与实施约束");
  await page.getByRole("textbox", { name: "计划 1", exact: true }).press("Enter");
  await expect(page.getByTestId("research-intent-card")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("research-plan-markdown.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("research-plan-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  const reportResponse = page.waitForResponse(response => response.url().endsWith("/runtime/commands/stream")
    && response.request().postDataJSON()?.node === "outline" && response.request().postDataJSON()?.action === "generate_report");
  await page.getByRole("button", { name: "生成报告", exact: true }).click();
  const streamResponse = await reportResponse;
  expect(streamResponse.headers()["content-type"]).toContain("text/event-stream");
  await expect(page).toHaveURL(/\/research\/[^/]+\/report$/);
  await expect(page.getByTestId("research-execution-timeline")).toBeVisible();
  await expect(page.getByTestId("research-execution-timeline")).not.toContainText(/次尝试|批次/);
  await expect(page.getByTestId("research-report-history")).toHaveCount(0);
  await expect(page.getByTestId("research-report-preview-text")).toContainText("本章分析", { timeout: 30000 });
  await expect(page.getByTestId("research-report")).toHaveCount(0);
  await expect(page.getByTestId("execution-chapters")).toContainText("执行中");
  await expect(page.getByText("正在获取资料", { exact: true })).toHaveCount(0);
  expect(await page.getByTestId("research-execution-timeline").evaluate((timeline) => Boolean(timeline.compareDocumentPosition(document.querySelector('[data-testid="research-report-preview-text"]')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("research-report-streaming.png"), fullPage: true });
  // Reload disconnects SSE. The server-owned combined command continues without replay.
  await page.reload();
  await expect(page.getByTestId("research-report-preview-text")).toContainText("本章分析", { timeout: 10000 });
  await expect(page.getByTestId("research-report")).toContainText("并网政策报告", { timeout: 60000 });
  expect(submittedCommands.filter(command => command.action === "generate_report")).toHaveLength(1);
  await expect(page.getByTestId("guided-research-report-workspace")).toHaveAttribute("data-reference-layout", "report-document");
  await page.getByText(/^查看研究资料 ·/).click();
  const sourceWorkspace = page.getByTestId("guided-research-source-workspace");
  await expect(sourceWorkspace).toHaveAttribute("data-reference-layout", "research-sources");
  await expect(page.getByTestId("guided-research-source-chapters")).toHaveCount(0); // testid-gate: absent 章节编辑移至报告工作区，资料区不得重复呈现。
  const sourceLink = page.getByTestId("guided-research-source-evidence").locator('a[href$="/research-evidence"]');
  await expect(sourceLink).toBeVisible();
  await expect(sourceLink).toHaveAttribute("href", /\/research-evidence$/);
  await expect(sourceLink).toHaveAttribute("title", /\S/);
  await expect(page.getByRole("link", { name: /vehicle-inventory$/ })).toHaveCount(0);
  await expect(page.getByTestId("guided-research-source-activity")).toHaveCount(0); // testid-gate: absent 资料区不呈现旧活动卡，原缺席断言保留。
  await expect(page.getByTestId("research-search-summary")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "添加来源" })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("research-sources-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  const runtimeResponse = await page.request.get(streamResponse.url().replace(/\/commands\/stream$/, ""), { headers: { authorization: streamResponse.request().headers()["authorization"]! } });
  expect(runtimeResponse.ok()).toBeTruthy();
  const runtime = await runtimeResponse.json();
  expect(runtime.sessionId).toBe(streamResponse.request().postDataJSON().sessionId);
  expect(runtime.version).toBe(streamResponse.request().postDataJSON().expectedVersion + 1);
  expect(runtime.busy).toBe(false);
  expect(runtime.tasks.every((task: { status: string }) => task.status === "succeeded")).toBe(true);
  expect(runtime.modelCalls.filter((call: { node: string }) => call.node === "report")).toHaveLength(runtime.outline.filter((section: { enabled: boolean }) => section.enabled).length * 2 + 3);
  expect(runtime.researchPlan).toBeNull();
  const enabledSections = runtime.outline.filter((section: { enabled: boolean }) => section.enabled)
    .sort((a: { order: number }, b: { order: number }) => a.order - b.order);
  expect(runtime.tasks.map((task: { sectionId: string }) => task.sectionId)).toEqual(enabledSections.map((section: { id: string }) => section.id));
  expect(runtime.tasks.map((task: { objective: string }) => task.objective)).toEqual(enabledSections.map((section: { objective: string; title: string }) => (section.objective || section.title).slice(0, 2000)));
  expect(runtime.tasks.every((task: { questionId?: string }) => task.questionId === undefined)).toBe(true);
  for (const section of enabledSections) {
    const questionCount = new Set([...section.questions, ...(section.subsections ?? []).flatMap((subsection: { questions: string[] }) => subsection.questions)]).size;
    const coverage = runtime.coverage.filter((item: { sectionId: string }) => item.sectionId === section.id);
    expect(coverage).toHaveLength(questionCount);
    expect(new Set(coverage.map((item: { questionId: string }) => item.questionId)).size).toBe(questionCount);
    expect(coverage.every((item: { status: string; evidenceIds: string[] }) => item.status === "answered" && item.evidenceIds.length > 0)).toBe(true);
    expect(coverage.every((item: { questionId: string }) => runtime.questionEvidence.some((evidence: { sectionId: string; questionId: string; relevance: string }) => evidence.sectionId === section.id && evidence.questionId === item.questionId && evidence.relevance === "direct"))).toBe(true);
  }
  expect(runtime.reportSourceAliases.length).toBeGreaterThan(0);
  expect(runtime.reportCheckpoint.chapters).toHaveLength(runtime.outline.filter((section: { enabled: boolean }) => section.enabled).length);
  expect(runtime.report.sections.every((section: { sourceIds: string[] }) => section.sourceIds.every((id) => runtime.sources.some((source: { id: string }) => source.id === id)))).toBe(true);
  expect(runtime.outline[0].title).toBe("核实政策适用范围与实施约束");
  // One deliberately invalid evidence response is repaired automatically without a second UI command.
  expect(runtime.modelCalls.filter((call: { node: string; status: string }) => call.node === "report" && call.status === "failed")).toHaveLength(1);
  expect(runtime.errorCode).toBeNull();
  expect(runtime.reportEvidenceWarnings).toEqual([]);
  expect(runtime.intent).toBeFalsy();
  expect(runtime.sourcePolicy).toBeFalsy();
  expect(runtime.questionEvidence.length).toBeGreaterThan(0);
  expect(runtime.coverage.every((item: { status: string }) => item.status === "answered")).toBe(true);
  expect(runtime.claimEvidence.length).toBeGreaterThan(0);
  expect(runtime.publicationReadiness.status).toBe("ready");
  expect(runtime.activity.map((item: { stage: string }) => item.stage)).toEqual(expect.arrayContaining(["searching", "reading", "writing", "validating"]));
  expect(runtime.activity.filter((item: { stage: string }) => item.stage === "planning").map((item: { status: string }) => item.status)).toEqual(expect.arrayContaining(["started", "succeeded"]));
  expect(runtime.reportTimeline.map((step: { stage: string }) => step.stage)).toEqual(["evidence", "chapter", "review", "chapter", "review", "synthesis", "validation"]);
  expect(runtime.reportTimeline.every((step: { status: string }) => step.status === "completed")).toBe(true);
  expect(runtime.reportTimeline.find((step: { stage: string }) => step.stage === "evidence").attempts).toBe(2);
  await expect(page.getByRole("button", { name: "继续生成剩余章节", exact: true })).toHaveCount(0);
  expect(runtime.report.sections.map((section: { sectionId: string }) => section.sectionId)).toEqual(runtime.outline.filter((section: { enabled: boolean }) => section.enabled).map((section: { id: string }) => section.id));
  expect(runtime.report.introduction).toContain("检索摘要");
  expect(runtime.report.conclusion).toContain("综合各章");
  await expect(page.getByTestId("research-report").getByRole("heading", { name: "研究范围与方法", exact: true })).toBeVisible();
  await expect(page.getByTestId("research-report").getByRole("heading", { name: "综合结论", exact: true })).toBeVisible();
  await expect(page.getByTestId("research-report").locator("sup a").first()).toBeVisible();
  await expect(page.getByTestId("research-report")).not.toContainText("[[source:");
  await page.reload();
  await expect(page.getByTestId("research-report")).toContainText("并网政策报告");
  await expect(page.getByTestId("research-report-references").getByRole("link", { name: "Research E2E policy evidence", exact: true })).toHaveAttribute("href", /\/research-evidence$/);
  await expect(page.getByTestId("research-report-chapter")).toHaveCount(2);
  await expect(page.getByTestId("research-report-references").getByRole("listitem")).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("research-report-chapters.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("research-report-chapters-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  const reportActions = page.getByTestId("research-report-actions");
  await expect(reportActions.getByRole("status")).toHaveText("研究报告 · 已完成");
  await expect(page.getByRole("button", { name: "完成研究", exact: true })).toHaveCount(0);
  await expect(reportActions.getByRole("button", { name: "更多操作", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "导出报告", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "重新生成报告", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("research-report-action-menu.png"), fullPage: true });
  await page.keyboard.press("Escape");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 Word", exact: true }).click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/\.docx$/);
  await expect(page.getByRole("button", { name: "导出 PDF", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "导出 PDF", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("research-execution-timeline")).toContainText("执行完成");
  await expect(page.getByTestId("research-report-document")).toBeVisible();
  expect(runtime.completed).toBe(true);
  expect(runtime.executionGoal).toBe("report");
  expect(runtime.brief.goal).toBe("核对储能并网政策");
  expect(runtime.brief.focus).toBe("政策实施约束");
  // Chapter edits are explicitly opened inside the report; legacy /chapters is
  // canonicalized without issuing another generation or discarding saved evidence.
  await expect(page.getByTestId("research-chapters-workspace")).toHaveCount(0);
  await page.getByText("调整报告章节", { exact: true }).click();
  await expect(page.getByTestId("research-chapters-workspace")).toBeVisible();
  const chapterTitle = page.getByRole("textbox", { name: "章节标题", exact: true });
  await chapterTitle.fill("未保存的章节调整");
  await page.getByText("调整报告章节", { exact: true }).click();
  await expect(chapterTitle).not.toBeVisible();
  await page.getByText("调整报告章节", { exact: true }).click();
  await expect(chapterTitle).toHaveValue("未保存的章节调整");
  await chapterTitle.fill(runtime.outline[0].title);
  await page.screenshot({ path: testInfo.outputPath("research-chapters-route.png"), fullPage: true });
  const beforeLegacyNavigation = submittedCommands.length;
  const reportUrl = page.url();
  await page.goto(reportUrl.replace(/\/report$/, "/chapters"));
  await expect(page).toHaveURL(/\/research\/[^/]+\/report$/);
  await expect(page.getByTestId("research-report-document")).toBeVisible();
  expect(submittedCommands).toHaveLength(beforeLegacyNavigation);
  await page.screenshot({ path: testInfo.outputPath("research-completed.png"), fullPage: true });
  // A conversational regeneration must use the real report generation pipeline.
  const regenerated = page.waitForResponse((response) => response.url().endsWith("/runtime/commands/stream") && response.request().postDataJSON()?.action === "message");
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "修改报告", exact: true }).click();
  await page.getByRole("textbox", { name: "研究对话" }).fill("重新生成报告");
  await page.getByRole("button", { name: "发送研究消息" }).click();
  const regeneratedResponse = await regenerated;
  expect(regeneratedResponse.headers()["content-type"]).toContain("text/event-stream");
  const runtimeUrl = streamResponse.url().replace(/\/commands\/stream$/, "");
  const authorization = streamResponse.request().headers()["authorization"]!;
  // Wait for the new execution's durable terminal state, not an old report still
  // visible before the first SSE snapshot arrives.
  await expect.poll(async () => {
    const response = await page.request.get(runtimeUrl, { headers: { authorization } });
    expect(response.ok()).toBe(true);
    const saved = await response.json();
    return saved.version > regeneratedResponse.request().postDataJSON().expectedVersion
      && !saved.busy && !saved.errorCode && saved.report?.title === "并网政策报告"
      && saved.messages.at(-1)?.text === "已重新生成报告内容。";
  }, { timeout: 60000 }).toBe(true);
  await expect(page.getByTestId("research-report-document")).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId("research-report-execution-controls").getByRole("button", { name: "暂停生成", exact: true })).toHaveCount(0, { timeout: 60000 });
  await expect(page.getByTestId("research-report-document")).toContainText("并网政策报告");
  // Next's route announcer is a global alert; only research errors belong here.
  await expect(page.getByTestId("research-flow-report").getByRole("alert")).toHaveCount(0);
  // Quality rejection must preserve a complete, explicitly provisional report.
  const current = await (await page.request.get(runtimeUrl, { headers: { authorization } })).json();
  expect(current.errorCode).toBeNull();
  expect(current.busy).toBe(false);
  expect(current.report.title).toBe("并网政策报告");
  expect(current.modelCalls.length).toBeGreaterThan(runtime.modelCalls.length);
  expect(current.messages.at(-1)).toMatchObject({ role: "assistant", text: "已重新生成报告内容。" });
  // Legacy generate permits the controlled quality-rejection instruction; the
  // composite command intentionally forbids message overrides. The new UI must
  // still restore this persisted rejected draft without enabling completion.
  const draftResponse = await page.request.post(`${runtimeUrl}/commands`, { headers: { authorization }, timeout: 90000,
    data: { sessionId: current.sessionId, node: "report", action: "generate", requestId: `quality-draft-${Date.now()}`, expectedVersion: current.version, message: "e2e-quality-draft" } });
  expect(draftResponse.ok()).toBeTruthy();
  const qualityDraft = await draftResponse.json();
  expect(qualityDraft.report).toBeNull();
  expect(qualityDraft.reportDraft.sections).toHaveLength(2);
  expect(qualityDraft.reportDraft.conclusion).toContain("综合各章");
  expect(qualityDraft.reportQualityWarnings).toEqual(expect.arrayContaining([expect.objectContaining({ sectionId: "o-e2e" })]));
  expect(qualityDraft.busy).toBe(false);
  expect(qualityDraft.completed).toBe(false);
  await page.reload();
  await expect(page.getByTestId("research-quality-draft").getByText("草稿", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("research-quality-draft")).not.toContainText("完整草稿已生成并保存");
  await expect(page.getByTestId("research-report-preview-text")).not.toContainText("草稿");
  await expect(page.getByTestId("research-quality-draft").getByTestId("research-report-chapter")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "完成研究", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "下载 Word", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("research-quality-complete-draft.png"), fullPage: true });
  await page.keyboard.press("Escape");
  const openedSessionUrl = page.url();
  await page.getByRole("button", { name: "返回研究列表", exact: true }).click();
  await expect(page).toHaveURL(/\/research$/);
  await expect(page.getByTestId("shell-rail")).toBeVisible();
  await expect(page.getByTestId("research-home-page")).toBeVisible();
  await expect(page).toHaveURL(/\/research$/);
  await page.getByText("研究状态筛选", { exact: true }).click();
  const activeSummary = page.getByRole("button", { name: /进行中 \d+ 项研究/ });
  await activeSummary.click();
  await expect(activeSummary).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: researchName, exact: true })).toBeVisible();
  await page.getByTestId("research-history-search").fill("不存在的研究");
  await expect(page.getByTestId("research-history-empty")).toContainText("当前状态筛选与搜索条件下没有研究");
  await page.getByRole("button", { name: "清除状态筛选", exact: true }).click();
  await expect(page.getByRole("button", { name: "清除状态筛选", exact: true })).toHaveCount(0);
  await page.getByTestId("research-history-search").fill("");
  await page.screenshot({ path: testInfo.outputPath("research-home-status-filter.png"), fullPage: true });
  await page.reload();
  await expect(page.getByTestId("research-home-page")).toBeVisible();
  await page.goto(openedSessionUrl);
  await expect(page.getByTestId("research-quality-draft")).toBeVisible();


});
