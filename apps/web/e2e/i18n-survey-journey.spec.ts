import { evaluateSurveyForPublish } from "@repo/contracts/survey-publish-readiness";
import { expect, test, type Page, type Locator, type Route, type TestInfo } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { SURVEY_REPORT_SHARE_MIN_SAMPLE } from "@repo/contracts/survey-report";
import { readFile, writeFile } from "node:fs/promises";
import { SurveyRuntimeSchema, type SurveyRuntime } from "@repo/contracts/survey-runtime";
import { SurveyLibraryTemplateSchema } from "@repo/contracts/survey-template-library";
import { parseSurveyPublicationMarkdown } from "@repo/contracts/survey-source";
import { surveyChoices } from "@repo/contracts/survey-question-types";
import { balancedMeetingSupplementalAnswers, firstSupplementalBatchSize, supplementalWindowPauseMs } from "./support/survey-balanced-report-samples";
import { surveyAccountFixture } from "./support/survey-owned-organization";
import { surveyI18nDatabaseEvidence } from "./support/survey-i18n-evidence";
import { FULLSTACK_E2E as F } from "./fullstack-smoke-fixture";
const API = "/__fullstack_api";
const pathOf = (url: string) => new URL(url).pathname.replace(/^\/__fullstack_api/, "");
const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function login(page: Page, account: {
    email: string;
    password: string;
}) {
    await page.goto("/login");
    await page.getByTestId("language-switcher").selectOption("en");
    await page.getByTestId("login-email").fill(account.email);
    await page.getByTestId("login-password").fill(account.password);
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(/\/home$/);
}
async function api(page: Page, path: string, method = "GET", body?: unknown) {
    const token = await page.evaluate(() => localStorage.getItem("wsx.sessionToken"));
    expect(token).toBeTruthy();
    const response = await page.request.fetch(`${API}${path}`, { method, headers: { authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { data: body }) });
    expect(response.ok(), `${method} ${path}: ${response.status()}`).toBe(true);
    return response.json();
}
async function runtime(page: Page, id: string): Promise<SurveyRuntime> { return SurveyRuntimeSchema.parse(await api(page, `/surveys/${encodeURIComponent(id)}`)); }
async function capture(page: Page, info: TestInfo, name: string, target?: Locator) {
    for (const width of [375, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        if (target)
            await target.scrollIntoViewIfNeeded();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        for (const dialog of await page.getByRole("dialog").all()) {
            const bounds = await dialog.boundingBox();
            expect(bounds).not.toBeNull();
            expect(bounds!.x).toBeGreaterThanOrEqual(0);
            expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        }
        await page.screenshot({ path: info.outputPath(`${name}-${width}.png`), fullPage: false });
    }
}
async function holdResponse(page: Page, path: string) {
    let arrived!: (body: unknown) => void, rejected!: (error: unknown) => void, release!: () => void, captured = false;
    const reached = new Promise<unknown>((resolve, reject) => { arrived = resolve; rejected = reject; }), gate = new Promise<void>(resolve => { release = resolve; });
    const handler = async (route: Route) => {
        if (captured || route.request().method() !== "POST" || pathOf(route.request().url()) !== path)
            return route.continue();
        captured = true;
        try {
            const response = await route.fetch({ timeout: 0 });
            if (!response.ok()) {
                rejected(new Error(`Held upstream request failed: ${response.status()} ${path}`));
                await route.fulfill({ response });
                return;
            }
            arrived(route.request().postDataJSON());
            await gate;
            await route.fulfill({ response });
        }
        catch (error) {
            rejected(error);
            await route.abort();
        }
    };
    await page.route("**/__fullstack_api/**", handler);
    return { reached, release, dispose: async () => { release(); await page.unroute("**/__fullstack_api/**", handler); } };
}
async function languageTab(page: Page) {
    const other = await page.context().newPage();
    await other.goto("/studio/survey");
    return { language: async (locale: "en" | "zh-CN") => { await other.getByTestId("language-switcher").first().selectOption(locale); await expect(page.locator("html")).toHaveAttribute("lang", locale); }, close: () => other.close() };
}
/** Inspect actual downloaded OOXML independently of the browser document builder. */
function zipText(bytes: Buffer, entry: string): string {
    for (let offset = 0; offset + 46 <= bytes.length; offset++) {
        if (bytes.readUInt32LE(offset) !== 0x02014b50) continue;
        const nameLength = bytes.readUInt16LE(offset + 28);
        if (bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8") !== entry) continue;
        const local = bytes.readUInt32LE(offset + 42);
        expect(bytes.readUInt32LE(local)).toBe(0x04034b50);
        const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
        const data = bytes.subarray(start, start + bytes.readUInt32LE(offset + 20)), method = bytes.readUInt16LE(offset + 10);
        expect([0, 8]).toContain(method);
        return (method === 8 ? inflateRawSync(data) : data).toString("utf8");
    }
    throw Error(`Downloaded archive entry missing: ${entry}`);
}
// Scope product diagnostics to the actual surface. Next's separate route
// announcer is also role=alert; it is not a survey error or a permission notice.
const surveySurface = (page: Page) => page.getByRole("main", { includeHidden: true }).last();
const meeting = "会议反馈调查";
async function fillMeeting(page: Page, firstTitle: string) {
    await page.getByRole("textbox", { name: firstTitle, exact: true }).fill("原会议回答 {count}");
    await page.getByLabel("会议日期", { exact: true }).fill("2026-11-04");
    // The fieldset's accessible name includes the required marker in its legend.
    for (const title of ["会议目标和议程清晰。", "会议内容与我的工作相关。", "参会者有足够机会表达意见。", "会后行动项、负责人和时间明确。"]) {
        const question = page.getByRole("group", { name: `${title} *`, exact: true });
        await expect(question).toHaveCount(1);
        await expect(question.getByRole("radio")).toHaveCount(5);
        await question.getByRole("radio").nth(3).check();
        await expect(question.getByRole("radio").nth(3)).toBeChecked();
    }
    const duration = page.getByRole("group", { name: "会议时长是否合适？ *", exact: true });
    await expect(duration).toHaveCount(1);
    await duration.getByLabel("合适", { exact: true }).check();
    await expect(duration.getByLabel("合适", { exact: true })).toBeChecked();
    await page.getByRole("textbox", { name: "下次会议最值得改进的地方是什么？", exact: true }).fill("原建议 {name}\nKeep the original answer.");
}
test("survey locale preserves real author publishing, anonymous file submission, review, report and PostgreSQL identities", async ({ page, browser }, info) => {
    test.setTimeout(180000);
    const fixture = surveyAccountFixture(), account = fixture.seed();
    let languages: Awaited<ReturnType<typeof languageTab>> | undefined;
    let anonymous: Awaited<ReturnType<typeof browser.newContext>> | undefined;
    let held: Awaited<ReturnType<typeof holdResponse>> | undefined;
    const errors: string[] = [], requests: {
        method: string;
        path: string;
    }[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { const path = pathOf(request.url()); if (path.startsWith("/surveys"))
        requests.push({ method: request.method(), path }); });
    try {
        await login(page, account);
        languages = await languageTab(page);
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto("/studio/survey?tab=modules");
        const card = page.locator("article").filter({ has: page.getByRole("heading", { name: meeting, exact: true }) });
        await expect(card).toBeVisible();
        await expect(card.getByRole("button", { name: "Use and create survey", exact: true })).toBeVisible();
        await capture(page, info, "question-library-en", card);
        const created = page.waitForResponse(response => pathOf(response.url()) === "/surveys" && response.request().method() === "POST");
        await card.getByRole("button", { name: "Use and create survey", exact: true }).click();
        expect((await created).ok()).toBe(true);
        await expect(page).toHaveURL(/\/studio\/survey\/[0-9a-f-]+\/design$/);
        const id = new URL(page.url()).pathname.split("/")[3]!;
        const rawTitle = `原问卷 {count} ${randomUUID()}`, rawFirst = "原会议名称 {count}", rawFile = "原文件问题 {name}";
        await page.getByRole("textbox", { name: "Survey name", exact: true }).fill(rawTitle);
        const canvas = page.getByRole("region", { name: "Survey design canvas" });
        await canvas.getByRole("button", { name: "Edit question 1: 会议名称", exact: true }).click();
        await canvas.getByRole("textbox", { name: "Question content", exact: true }).fill(rawFirst);
        await page.getByRole("textbox", { name: "Survey name", exact: true }).click();
        await page.getByTestId("add-question-file").click();
        await canvas.getByRole("button", { name: "Edit question 9: File upload", exact: true }).click();
        await canvas.getByRole("textbox", { name: "Question content", exact: true }).fill(rawFile);
        await page.getByRole("checkbox", { name: "Required", exact: true }).uncheck();
        await page.getByRole("textbox", { name: "Survey name", exact: true }).click();
        await expect.poll(async () => { const value = await runtime(page, id); return [value.title, value.questions[0]?.title, value.questions.at(-1)?.title, value.questions.at(-1)?.required]; }).toEqual([rawTitle, rawFirst, rawFile, false]);
        const stable = await runtime(page, id), nameInput = page.getByRole("textbox", { name: "Survey name", exact: true }), nameHandle = await nameInput.elementHandle();
        await nameInput.focus();
        await nameInput.evaluate(element => (element as HTMLInputElement).setSelectionRange(1, 4));
        const beforeLocale = requests.length;
        await languages.language("zh-CN");
        await expect(page.getByRole("textbox", { name: "问卷名称", exact: true })).toHaveValue(rawTitle);
        expect(await nameHandle!.evaluate(element => element === document.activeElement)).toBe(true);
        expect(await nameHandle!.evaluate(element => [(element as HTMLInputElement).selectionStart, (element as HTMLInputElement).selectionEnd])).toEqual([1, 4]);
        await languages.language("en");
        expect(requests).toHaveLength(beforeLocale);
        expect((await runtime(page, id)).source).toEqual(stable.source);
        await capture(page, info, "designer-raw-en", nameInput);
        await page.reload();
        await expect(page.getByRole("textbox", { name: "Survey name", exact: true })).toHaveValue(rawTitle);
        // The existing publish gate requires every added answerable question to
        // have a report binding. Use the real editor; do not bypass the gate.
        const beforeBinding = await runtime(page, id);
        const fileBeforePublish = beforeBinding.questions.find(question => question.type === "file")!;
        const answerBlock = beforeBinding.template.sections.flatMap(section => section.blocks).find(block => block.statistic === "responses" && block.questionIds.includes(beforeBinding.questions[0]!.id));
        expect(answerBlock).toBeDefined();
        await page.getByRole("button", { name: "More actions", exact: true }).click();
        await page.getByRole("button", { name: "Design report template (optional)", exact: true }).click();
        const bindingBlock = page.getByTestId(`template-block-${answerBlock!.id}`);
        await bindingBlock.getByRole("checkbox", { name: `${fileBeforePublish.order}. ${rawFile}`, exact: true }).check();
        const boundSource = page.waitForResponse(response => pathOf(response.url()) === `/surveys/${id}/source` && response.request().method() === "PUT");
        await page.getByRole("button", { name: "Save changes", exact: true }).click();
        expect((await boundSource).ok()).toBe(true);
        const bound = await runtime(page, id);
        expect(bound.template.sections.flatMap(section => section.blocks).find(block => block.id === answerBlock!.id)?.questionIds).toEqual([...answerBlock!.questionIds, fileBeforePublish.id]);
        expect(evaluateSurveyForPublish(bound)).toEqual([]);
        await capture(page, info, "report-file-binding-en", bindingBlock.getByRole("checkbox", { name: `${fileBeforePublish.order}. ${rawFile}`, exact: true }));
        await page.getByRole("button", { name: "2. Publish and collect", exact: true }).click();
        await capture(page, info, "publication-en", page.getByRole("button", { name: "Start collection", exact: true }));
        await capture(page, info, "publication-settings-en", page.getByRole("textbox", { name: "Success-page Markdown", exact: true }));
        expect(bound.status).toBe("draft");
        const published = page.waitForResponse(response => pathOf(response.url()) === `/surveys/${id}/publish` && response.request().method() === "POST");
        await page.getByRole("button", { name: "Start collection", exact: true }).click();
        const publicationResponse = await published;
        expect(publicationResponse.status()).toBe(201);
        expect(publicationResponse.ok()).toBe(true);
        const publicUrl = await page.getByRole("textbox", { name: "Response link", exact: true }).inputValue(), initialPublication = await runtime(page, id);
        expect(initialPublication.publication?.sourceSnapshot).toBeDefined();
        expect(initialPublication.activeCollectionBatchId).toBeTruthy();
        anonymous = await browser.newContext();
        const respondent = await anonymous.newPage();
        respondent.on("pageerror", error => errors.push(error.message));
        const publicRequests: {
            method: string;
            path: string;
        }[] = [];
        respondent.on("request", request => { if (pathOf(request.url()).startsWith("/public/surveys/"))
            publicRequests.push({ method: request.method(), path: pathOf(request.url()) }); });
        await respondent.goto(publicUrl);
        await respondent.getByTestId("language-switcher").selectOption("en");
        await expect(respondent.getByRole("heading", { name: rawTitle, exact: true })).toBeVisible();
        await respondent.getByRole("button", { name: "Submit response", exact: true }).click();
        const validationError = surveySurface(respondent).getByRole("alert");
        await expect(validationError).toHaveCount(1);
        await expect(validationError).toBeVisible();
        await expect(validationError).toContainText("Your answers are retained.");
        await capture(respondent, info, "public-validation-en", validationError);
        await fillMeeting(respondent, rawFirst);
        const token = initialPublication.publication!.token, fileQuestion = initialPublication.questions.find(question => question.type === "file")!;
        held = await holdResponse(respondent, `/public/surveys/${token}/upload-sessions`);
        const bytes = Buffer.from("原附件字节 {count}\nRaw file bytes stay unchanged.\n", "utf8"), filename = "原附件 {name}.txt";
        await respondent.getByLabel("Choose file", { exact: true }).setInputFiles({ name: filename, mimeType: "text/plain", buffer: bytes });
        const uploadSessionBody = await held.reached as {
            submissionId: string;
        };
        expect(uploadSessionBody.submissionId).toBeTruthy();
        const beforeUploadLocale = publicRequests.length;
        await respondent.getByTestId("language-switcher").selectOption("zh-CN");
        await expect(respondent.getByRole("textbox", { name: rawFirst, exact: true })).toHaveValue("原会议回答 {count}");
        await expect(respondent.getByRole("button", { name: "提交答卷", exact: true })).toBeDisabled();
        expect(publicRequests).toHaveLength(beforeUploadLocale);
        await respondent.getByTestId("language-switcher").selectOption("en");
        held.release();
        await expect(respondent.getByText(filename, { exact: true })).toBeVisible();
        await expect(respondent.getByRole("button", { name: "Submit response", exact: true })).toBeEnabled();
        await capture(respondent, info, "public-file-raw-en", respondent.getByText(filename, { exact: true }));
        const submitted = respondent.waitForResponse(response => pathOf(response.url()) === `/public/surveys/${token}/responses` && response.request().method() === "POST");
        await respondent.getByRole("button", { name: "Submit response", exact: true }).click();
        const receipt = await submitted;
        expect(receipt.ok()).toBe(true);
        const submission = receipt.request().postDataJSON() as {
            submissionId: string;
            answers: {
                questionId: string;
                value: unknown;
            }[];
        };
        expect(submission.submissionId).toBe(uploadSessionBody.submissionId);
        const { responseId } = await receipt.json() as {
            responseId: string;
        };
        // Success-page Markdown is frozen authored data, even when its text is Chinese.
        const frozenSettings = parseSurveyPublicationMarkdown(initialPublication.publication!.sourceSnapshot!.documents.publication.markdown);
        expect(frozenSettings.ok).toBe(true);
        if (!frozenSettings.ok) throw Error("Published collection settings must parse");
        const rawSuccess = frozenSettings.settings.successMessageMarkdown;
        await expect(respondent.getByRole("status")).toHaveText(rawSuccess);
        const beforeSuccessLocale = publicRequests.length;
        await respondent.getByTestId("language-switcher").selectOption("zh-CN");
        await expect(respondent.getByRole("status")).toHaveText(rawSuccess);
        await respondent.getByTestId("language-switcher").selectOption("en");
        await expect(respondent.getByRole("status")).toHaveText(rawSuccess);
        expect(publicRequests).toHaveLength(beforeSuccessLocale);
        await capture(respondent, info, "public-success-en", respondent.getByRole("status"));
        expect(publicRequests.filter(request => request.method === "POST" && request.path.endsWith("/upload-sessions"))).toHaveLength(1);
        expect(publicRequests.filter(request => request.method === "POST" && request.path.endsWith("/responses"))).toHaveLength(1);
        const saved = await runtime(page, id);
        expect(saved.responses).toHaveLength(1);
        expect(saved.responses[0]!.answers).toEqual(submission.answers);
        expect(saved.publication).toEqual(initialPublication.publication);
        expect(saved.activeCollectionBatchId).toBe(initialPublication.activeCollectionBatchId);
        const database = surveyI18nDatabaseEvidence(account.userId, id);
        expect(database.questions).toEqual(saved.questions);
        expect(database.responses).toEqual(saved.responses);
        expect(database.publication?.sourceHash).toBe(initialPublication.publication!.sourceSnapshot!.contentHash);
        expect(database.uploadSessions).toEqual([{ submission_id: submission.submissionId, response_id: responseId, publication_version: initialPublication.publication!.version }]);
        expect(database.attachments).toHaveLength(1);
        const attachment = database.attachments[0]!;
        expect(attachment).toMatchObject({ question_id: fileQuestion.id, response_id: responseId, name: filename, status: "claimed", size_bytes: bytes.length, sha256: sha(bytes) });
        const authToken = await page.evaluate(() => localStorage.getItem("wsx.sessionToken"));
        const downloaded = await page.request.get(`${API}/surveys/${id}/responses/${responseId}/attachments/${attachment.id}/content`, { headers: { authorization: `Bearer ${authToken}` } });
        expect(downloaded.ok()).toBe(true);
        expect(sha(await downloaded.body())).toBe(sha(bytes));
        await page.goto(`/studio/survey/${id}/responses`);
        await page.getByRole("button", { name: "View full response", exact: true }).click();
        const details = page.getByRole("region", { name: "Response details", exact: true });
        await expect(details).toContainText("原建议 {name}");
        const reason = "原排除原因 {count}";
        await details.getByRole("textbox", { name: "Reason for exclusion", exact: true }).fill(reason);
        const review = page.waitForResponse(response => pathOf(response.url()) === `/surveys/${id}/responses/${responseId}` && response.request().method() === "PATCH");
        await details.getByRole("button", { name: "Exclude from analysis", exact: true }).click();
        expect((await review).ok()).toBe(true);
        await expect(details).toContainText(reason);
        const beforeReviewLocale = requests.length;
        await languages.language("zh-CN");
        await expect(page.getByRole("region", { name: "答卷详情" })).toContainText(reason);
        await languages.language("en");
        expect(requests).toHaveLength(beforeReviewLocale);
        await capture(page, info, "response-governance-en", details);
        const include = page.waitForResponse(response => pathOf(response.url()) === `/surveys/${id}/responses/${responseId}` && response.request().method() === "PATCH");
        await details.getByRole("button", { name: "Include in analysis again", exact: true }).click();
        expect((await include).ok()).toBe(true);
        const reportGroup = page.getByRole("group", { name: "Analysis report (optional)", exact: true });
        await reportGroup.locator("summary").click();
        await reportGroup.getByRole("button", { name: "Generate analysis report", exact: true }).click();
        const generated = page.waitForResponse(response => pathOf(response.url()) === `/surveys/${id}/report` && response.request().method() === "POST");
        await page.getByRole("button", { name: "Generate report", exact: true }).click();
        expect((await generated).ok()).toBe(true);
        await expect(page.getByTestId("survey-report-generated-at")).toBeVisible();
        const report = page.getByTestId("survey-report-document");
        await expect(page.getByTestId("survey-report-sample-summary")).toContainText("Included in analysis 1");
        await expect(page.getByRole("status", { name: "Low sample notice", exact: true })).toBeVisible();
        await capture(page, info, "report-low-sample-en", page.getByTestId("survey-report-sample-summary"));
        await expect(page.getByRole("button", { name: "Export Word", exact: true })).toBeDisabled();
        await expect(page.getByRole("button", { name: "Export Markdown", exact: true })).toBeDisabled();
        const supplementalAnswers = balancedMeetingSupplementalAnswers(saved.questions, submission.answers);
        const supplementalCount = supplementalAnswers.length, expectedResponseCount = supplementalCount + 1;
        expect(expectedResponseCount).toBe(4 * SURVEY_REPORT_SHARE_MIN_SAMPLE);
        let rateWindowPauses = 0, rateWindowWaitMs = 0;
        for (let index = 0; index < supplementalCount; index++) {
            if (index === firstSupplementalBatchSize) {
                // The first batch plus the real upload-session/UI submission
                // fills the guard's actual budget. Age every prior hit out,
                // measured after the last response; do not spoof peers or time.
                const pauseStarted = performance.now();
                await page.waitForTimeout(supplementalWindowPauseMs);
                rateWindowWaitMs += performance.now() - pauseStarted;
                rateWindowPauses++;
            }
            const respondentApi = await browser.newContext();
            try {
                const endpoint = `${new URL(publicUrl).origin}${API}/public/surveys/${token}`;
                const publicRead = await respondentApi.request.get(endpoint);
                expect(publicRead.ok()).toBe(true);
                const accepted = await respondentApi.request.post(`${endpoint}/responses`, { data: { submissionId: randomUUID(), answers: supplementalAnswers[index], durationSeconds: 120, role: `原API补充样本 ${index + 1}`, companySize: "原范围" } });
                expect(accepted.ok()).toBe(true);
                expect((await accepted.json()).replayed).toBe(false);
            } finally { await respondentApi.close(); }
        }
        expect(rateWindowPauses).toBe(Number(supplementalCount > firstSupplementalBatchSize));
        const regenerated = page.waitForResponse(response => pathOf(response.url()) === `/surveys/${id}/report` && response.request().method() === "POST");
        await page.getByRole("button", { name: "Regenerate report", exact: true }).click();
        expect((await regenerated).ok()).toBe(true);
        await expect(page.getByTestId("survey-report-sample-summary")).toContainText(`Included in analysis ${expectedResponseCount}`);
        await expect(page.getByRole("button", { name: "Export Word", exact: true })).toBeEnabled();
        await expect(page.getByRole("button", { name: "Export Markdown", exact: true })).toBeEnabled();
        await capture(page, info, "report-ready-exports-en", page.getByRole("button", { name: "Export Word", exact: true }));
        const englishDownload = page.waitForEvent("download");
        await page.getByRole("button", { name: "Export Markdown", exact: true }).click();
        const englishFile = await englishDownload;
        expect(englishFile.suggestedFilename()).toBe("survey-report.md");
        const englishMarkdown = await readFile((await englishFile.path())!, "utf8");
        expect(englishMarkdown).toContain("原建议 {name}");
        const beforeExportLocale = requests.length;
        await languages.language("zh-CN");
        expect(requests).toHaveLength(beforeExportLocale);
        const chineseDownload = page.waitForEvent("download");
        await page.getByRole("button", { name: "导出 Markdown", exact: true }).click();
        const chineseFile = await chineseDownload;
        expect(chineseFile.suggestedFilename()).toBe(englishFile.suggestedFilename());
        expect(await readFile((await chineseFile.path())!, "utf8")).toBe(englishMarkdown);
        await languages.language("en");
        const wordDownload = page.waitForEvent("download");
        await page.getByRole("button", { name: "Export Word", exact: true }).click();
        const wordFile = await wordDownload;
        expect(wordFile.suggestedFilename()).toMatch(/\.docx$/);
        const wordBytes = await readFile((await wordFile.path())!);
        const documentXml = zipText(wordBytes, "word/document.xml");
        expect(documentXml).toContain("原建议 {name}");
        expect(documentXml).toContain("</w:document>");
        const final = await runtime(page, id), finalDb = surveyI18nDatabaseEvidence(account.userId, id);
        expect(final.responses).toHaveLength(expectedResponseCount);
        const durationQuestion = final.questions.find(question => question.type === "single" && question.title === "会议时长是否合适？")!;
        const outputGroupCounts = surveyChoices(durationQuestion).map(choice => ({ optionId: choice.id, count: final.responses.filter(response => response.answers.find(answer => answer.questionId === durationQuestion.id)?.value === choice.id).length }));
        for (const group of outputGroupCounts) expect(group.count).toBe(SURVEY_REPORT_SHARE_MIN_SAMPLE);
        expect(finalDb.responses).toEqual(final.responses);
        expect(finalDb.report).toEqual(final.report);
        expect(finalDb.responses[0]!.analysisHistory).toHaveLength(2);
        expect(finalDb.responses[0]!.analysisHistory![0]!.reason).toBe(reason);
        expect(final.publication).toEqual(initialPublication.publication);
        expect(final.activeCollectionBatchId).toBe(initialPublication.activeCollectionBatchId);
        const reportBeforeLanguage = JSON.stringify(final.report), reportRequests = requests.length;
        await languages.language("zh-CN");
        await languages.language("en");
        expect(requests).toHaveLength(reportRequests);
        expect(JSON.stringify((await runtime(page, id)).report)).toBe(reportBeforeLanguage);
        await expect(report.locator("[data-chart] svg").first()).toBeVisible();
        await capture(page, info, "report-chart-en", report.locator("[data-chart]").first());
        expect(errors).toEqual([]);
        await writeFile(info.outputPath("survey-mutation-receipt.json"), JSON.stringify({ testRetry: info.retry, testTimeoutMs: info.timeout, surveyId: id, responseId, batchId: final.activeCollectionBatchId, publicationVersion: final.publication!.version, sourceHash: final.publication!.sourceSnapshot!.contentHash, fileSha256: sha(bytes), fileSize: bytes.length, answerSha256: sha(JSON.stringify(submission.answers)), responseCount: final.responses.length, uiSubmissions: 1, supplementalApiSubmissions: supplementalCount, outputGroupCounts, rateWindowPauses, rateWindowWaitMs, canonicalMarkdownSha256: sha(englishMarkdown), wordBytesSha256: sha(wordBytes), wordDocumentXmlSha256: sha(documentXml), governanceEvents: finalDb.responses[0]!.analysisHistory!.length, uploadSessions: database.uploadSessions.length, attachments: database.attachments.length, apiAndPgAgree: true }, null, 2));
    }
    finally {
        await held?.dispose();
        await anonymous?.close();
        await languages?.close();
        fixture.cleanup();
    }
});
test("survey template locale preserves real CAS saves, independent copies, report bindings, undo and raw JSON exports", async ({ page }, info) => {
    test.setTimeout(180000);
    const fixture = surveyAccountFixture(), account = fixture.seed();
    let languages: Awaited<ReturnType<typeof languageTab>> | undefined;
    let held: Awaited<ReturnType<typeof holdResponse>> | undefined;
    const errors: string[] = [], calls: {
        method: string;
        path: string;
    }[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { const path = pathOf(request.url()); if (path.startsWith("/surveys"))
        calls.push({ method: request.method(), path }); });
    try {
        await login(page, account);
        languages = await languageTab(page);
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto("/studio/survey/question-templates/new");
        await expect(page.getByRole("textbox", { name: "Template name", exact: true })).toHaveValue("Untitled question template");
        const rawName = `原问卷模板 {count} ${randomUUID()}`, rawQuestion = "原数值题 {name}", rawDescription = "原说明 {count}", rawBody = "原报告正文 **{name}**";
        await page.getByRole("textbox", { name: "Template name", exact: true }).fill(rawName);
        await page.getByRole("textbox", { name: "Template description", exact: true }).fill(rawDescription);
        await page.getByRole("button", { name: "Add question", exact: true }).click();
        await page.getByRole("button", { name: /^Number A number/ }).click();
        await page.getByRole("textbox", { name: "Question content", exact: true }).fill(rawQuestion);
        await page.getByRole("tab", { name: "Report settings", exact: true }).click();
        await page.getByRole("button", { name: "Add chapter", exact: true }).click();
        await page.getByRole("textbox", { name: "Chapter title", exact: true }).fill("原章节 {count}");
        await page.getByRole("button", { name: "Add Text note", exact: true }).click();
        await page.getByRole("textbox", { name: "Body", exact: true }).fill(rawBody);
        await page.getByRole("button", { name: "Add Data table", exact: true }).click();
        const tableBlock = page.getByTestId(/^template-block-/).last();
        await tableBlock.getByRole("textbox", { name: "Content title", exact: true }).fill("原数据表 {name}");
        await tableBlock.getByRole("checkbox", { name: `1. ${rawQuestion}`, exact: true }).check();
        await expect(tableBlock.getByRole("combobox", { name: "Statistic", exact: true })).toHaveValue("mean");
        const description = page.getByRole("textbox", { name: "Template description", exact: true }), descriptionHandle = await description.elementHandle();
        await description.focus();
        await description.evaluate(element => (element as HTMLTextAreaElement).setSelectionRange(1, 4));
        const beforeLocale = calls.length;
        await languages.language("zh-CN");
        await expect(page.getByRole("textbox", { name: "模板说明", exact: true })).toHaveValue(rawDescription);
        expect(await descriptionHandle!.evaluate(element => element === document.activeElement)).toBe(true);
        await languages.language("en");
        expect(calls).toHaveLength(beforeLocale);
        await capture(page, info, "template-unsaved-raw-en", page.getByRole("textbox", { name: "Body", exact: true }));
        await page.getByRole("button", { name: "Preview full report", exact: true }).click();
        await expect(page.getByTestId("survey-report-document")).toContainText("原报告正文 {name}");
        await capture(page, info, "template-preview-raw-en", page.getByTestId("survey-report-document"));
        await page.getByRole("button", { name: "Back to editing", exact: true }).click();
        held = await holdResponse(page, "/surveys/templates");
        const savedResponse = page.waitForResponse(response => pathOf(response.url()) === "/surveys/templates" && response.request().method() === "POST");
        await page.getByRole("button", { name: "Save template", exact: true }).click();
        const firstBody = await held.reached as {
            kind: string;
            title: string;
        };
        expect(firstBody).toMatchObject({ kind: "question", title: rawName });
        const beforePendingLocale = calls.length;
        await languages.language("zh-CN");
        await expect(page.getByRole("textbox", { name: "模板名称", exact: true })).toHaveValue(rawName);
        await expect(page.getByRole("button", { name: "正在保存…", exact: true })).toBeDisabled();
        expect(calls).toHaveLength(beforePendingLocale);
        await languages.language("en");
        held.release();
        const savedRow = SurveyLibraryTemplateSchema.parse(await (await savedResponse).json());
        await held.dispose();
        held = undefined;
        await expect(page).toHaveURL(new RegExp(`/question-templates/${savedRow.id}$`));
        await expect(page.getByRole("textbox", { name: "Template name", exact: true })).toHaveValue(rawName);
        const original = SurveyLibraryTemplateSchema.parse(await api(page, `/surveys/templates/${savedRow.id}`));
        expect(original.questions[0]!.title).toBe(rawQuestion);
        expect(original.template.sections[0]!.blocks[0]!.text).toBe(rawBody);
        await page.reload();
        await expect(page.getByRole("textbox", { name: "Template description", exact: true })).toHaveValue(rawDescription);
        const changedDescription = "原失败后保留说明 {name}";
        await page.getByRole("textbox", { name: "Template description", exact: true }).fill(changedDescription);
        let refused = false, failedBody: unknown;
        const failOnce = async (route: Route) => { if (!refused && route.request().method() === "PUT") {
            refused = true;
            failedBody = route.request().postDataJSON();
            await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "forbidden", reasonCode: "CONTROLLED_TEMPLATE_PERMISSION" }) });
        }
        else
            await route.continue(); };
        await page.route(`**/__fullstack_api/surveys/templates/${savedRow.id}`, failOnce);
        await page.getByRole("button", { name: "Save template", exact: true }).click();
        const permissionError = surveySurface(page).getByRole("alert");
        await expect(permissionError).toHaveCount(1);
        await expect(permissionError).toBeVisible();
        await expect(permissionError).toContainText("You do not have permission to perform this action.");
        await expect(permissionError).not.toContainText("Sign in");
        await expect(page.getByRole("textbox", { name: "Template description", exact: true })).toHaveValue(changedDescription);
        const beforeFailureLocale = calls.length;
        await languages.language("zh-CN");
        await expect(permissionError).not.toContainText("CONTROLLED_TEMPLATE_PERMISSION");
        await languages.language("en");
        expect(calls).toHaveLength(beforeFailureLocale);
        expect((await api(page, `/surveys/templates/${savedRow.id}`)).version).toBe(original.version);
        await capture(page, info, "template-controlled-permission-en", permissionError);
        await page.unroute(`**/__fullstack_api/surveys/templates/${savedRow.id}`, failOnce);
        const retried = page.waitForResponse(response => pathOf(response.url()) === `/surveys/templates/${savedRow.id}` && response.request().method() === "PUT");
        await page.getByRole("button", { name: "Save template", exact: true }).click();
        const retryResponse = await retried;
        expect(retryResponse.ok()).toBe(true);
        expect(retryResponse.request().postDataJSON()).toEqual(failedBody);
        const updatedOriginal = SurveyLibraryTemplateSchema.parse(await retryResponse.json());
        expect(updatedOriginal.version).toBe(original.version + 1);
        await expect(page.getByRole("button", { name: "Save template", exact: true })).toBeDisabled();
        const copied = page.waitForResponse(response => pathOf(response.url()) === "/surveys/templates" && response.request().method() === "POST");
        await page.getByRole("button", { name: "Save a copy", exact: true }).click();
        const copy = SurveyLibraryTemplateSchema.parse(await (await copied).json());
        expect(copy.id).not.toBe(original.id);
        expect(copy.title).toBe(`${rawName} copy`);
        expect(copy.questions).toEqual(updatedOriginal.questions);
        expect(copy.template).toEqual(updatedOriginal.template);
        await expect(page).toHaveURL(new RegExp(`/question-templates/${copy.id}$`));
        await page.getByRole("button", { name: "Edit question 1", exact: true }).click();
        const copyQuestion = "原副本独立问题 {name}";
        await page.getByRole("textbox", { name: "Question content", exact: true }).fill(copyQuestion);
        const copyWrite = page.waitForResponse(response => pathOf(response.url()) === `/surveys/templates/${copy.id}` && response.request().method() === "PUT");
        await page.getByRole("button", { name: "Save template", exact: true }).click();
        const copySaved = SurveyLibraryTemplateSchema.parse(await (await copyWrite).json());
        expect(copySaved.questions[0]!.title).toBe(copyQuestion);
        expect(SurveyLibraryTemplateSchema.parse(await api(page, `/surveys/templates/${original.id}`))).toEqual(updatedOriginal);
        await page.getByRole("tab", { name: "Report settings", exact: true }).click();
        const jsonDownload = page.waitForEvent("download");
        await page.getByRole("button", { name: "Export JSON", exact: true }).click();
        const jsonFile = await jsonDownload;
        expect(jsonFile.suggestedFilename()).toBe("report-template.json");
        const exportedJson = await readFile((await jsonFile.path())!, "utf8");
        expect(exportedJson).toBe(JSON.stringify(copySaved.template, null, 2));
        await capture(page, info, "template-copy-editor-en", page.getByRole("textbox", { name: "Chapter title", exact: true }));
        await page.getByRole("button", { name: "Back to template library", exact: true }).click();
        const copyCard = page.locator("article").filter({ has: page.getByRole("heading", { name: copy.title, exact: true }) });
        const surveyCreated = page.waitForResponse(response => pathOf(response.url()) === "/surveys" && response.request().method() === "POST");
        await copyCard.getByRole("button", { name: "Create survey from template", exact: true }).click();
        const survey = SurveyRuntimeSchema.parse(await (await surveyCreated).json());
        await expect(page).toHaveURL(new RegExp(`/studio/survey/${survey.id}/design$`));
        expect(survey.questions[0]!.title).toBe(copyQuestion);
        await page.getByRole("button", { name: "More actions", exact: true }).click();
        await page.getByRole("button", { name: "Design report template (optional)", exact: true }).click();
        await page.getByRole("button", { name: "Save as report template", exact: true }).click();
        const dialog = page.getByRole("dialog"), reportName = `原报告配置 {count} ${randomUUID()}`;
        await dialog.getByRole("textbox", { name: "Save template name", exact: true }).fill(reportName);
        const reportSave = page.waitForResponse(response => pathOf(response.url()) === "/surveys/templates" && response.request().method() === "POST");
        await dialog.getByRole("button", { name: "Save to template library", exact: true }).click();
        const reportSource = SurveyLibraryTemplateSchema.parse(await (await reportSave).json());
        expect(reportSource.kind).toBe("report");
        await expect(dialog).not.toBeVisible();
        await page.getByRole("button", { name: "Use report template", exact: true }).click();
        const useDialog = page.getByRole("dialog");
        await useDialog.getByRole("combobox", { name: "Select report template", exact: true }).selectOption(reportSource.id);
        const binding = useDialog.getByRole("combobox", { name: `Match question: ${copyQuestion}`, exact: true });
        await binding.selectOption(survey.questions[0]!.id);
        const beforeBindingLocale = calls.length;
        await languages.language("zh-CN");
        await expect(useDialog.getByRole("combobox", { name: `对应题目：${copyQuestion}`, exact: true })).toHaveValue(survey.questions[0]!.id);
        await languages.language("en");
        expect(calls).toHaveLength(beforeBindingLocale);
        await capture(page, info, "report-template-binding-en", binding);
        page.once("dialog", confirmation => confirmation.accept());
        await useDialog.getByRole("button", { name: "Apply template", exact: true }).click();
        await expect(useDialog).not.toBeVisible();
        const reportApplied = page.waitForResponse(response => pathOf(response.url()) === `/surveys/${survey.id}/source` && response.request().method() === "PUT");
        await page.getByRole("button", { name: "Save changes", exact: true }).click();
        expect((await reportApplied).ok()).toBe(true);
        const applied = await runtime(page, survey.id);
        expect(applied.template.id).not.toBe(reportSource.template.id);
        expect(applied.template.sections[0]!.blocks[1]!.questionIds).toEqual([survey.questions[0]!.id]);
        expect(applied.template.sections[0]!.blocks[1]!.id).not.toBe(reportSource.template.sections[0]!.blocks[1]!.id);
        expect(SurveyLibraryTemplateSchema.parse(await api(page, `/surveys/templates/${reportSource.id}`))).toEqual(reportSource);
        const unlinked = page.waitForResponse(response => pathOf(response.url()) === `/surveys/${survey.id}/source` && response.request().method() === "PUT");
        await page.getByRole("button", { name: "Unlink report template", exact: true }).click();
        expect((await unlinked).ok()).toBe(true);
        expect((await runtime(page, survey.id)).template.sections).toEqual([]);
        const beforeUndoLocale = calls.length;
        await languages.language("zh-CN");
        await languages.language("en");
        expect(calls).toHaveLength(beforeUndoLocale);
        await expect(page.getByRole("button", { name: "Undo unlink", exact: true })).toBeVisible();
        const undone = page.waitForResponse(response => pathOf(response.url()) === `/surveys/${survey.id}/source` && response.request().method() === "PUT");
        await page.getByRole("button", { name: "Undo unlink", exact: true }).click();
        expect((await undone).ok()).toBe(true);
        const restored = await runtime(page, survey.id);
        expect(restored.template).toEqual(applied.template);
        await capture(page, info, "report-template-restored-en", page.getByRole("textbox", { name: "Body", exact: true }));
        const database = surveyI18nDatabaseEvidence(account.userId, survey.id, [original.id, copy.id, reportSource.id]);
        expect(database.template).toEqual(restored.template);
        expect(database.questions).toEqual(restored.questions);
        expect(database.templates.find(row => row.id === original.id)).toEqual(updatedOriginal);
        expect(database.templates.find(row => row.id === copy.id)).toEqual(copySaved);
        expect(database.templates.find(row => row.id === reportSource.id)).toEqual(reportSource);
        expect(errors).toEqual([]);
        await writeFile(info.outputPath("template-mutation-receipt.json"), JSON.stringify({ testRetry: info.retry, testTimeoutMs: info.timeout, surveyId: survey.id, sourceTemplateId: original.id, copyTemplateId: copy.id, reportTemplateId: reportSource.id, sourceVersion: updatedOriginal.version, copyVersion: copySaved.version, independentQuestionSha256: sha(JSON.stringify(copySaved.questions)), rawTemplateJsonSha256: sha(exportedJson), reportSourceSha256: sha(JSON.stringify(reportSource.template)), restoredTemplateSha256: sha(JSON.stringify(restored.template)), controlledPermissionFailure: true, explicitRetrySameBody: true, apiAndPgAgree: true }, null, 2));
    }
    finally {
        await held?.dispose();
        await languages?.close();
        fixture.cleanup();
    }
});
test("survey intake locale preserves real file bytes, one configured proposal, corrected Markdown and explicit application retry", async ({ page }, info) => {
    test.setTimeout(180000);
    let languages: Awaited<ReturnType<typeof languageTab>> | undefined;
    let held: Awaited<ReturnType<typeof holdResponse>> | undefined;
    const errors: string[] = [], writes: {
        method: string;
        path: string;
    }[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { const path = pathOf(request.url()); if (path.startsWith("/surveys") && request.method() !== "GET")
        writes.push({ method: request.method(), path }); });
    try {
        await login(page, { email: F.adminEmail, password: F.adminPassword });
        languages = await languageTab(page);
        await page.goto("/studio/survey");
        const rawTitle = `原导入问卷 {count} ${randomUUID()}`, rawRequirements = "原始需求 {name}\nReview a concrete recent experience.";
        await page.getByTestId("survey-create-primary").click();
        const create = page.getByRole("dialog", { name: "New survey", exact: true });
        await create.getByRole("textbox", { name: "Survey name", exact: true }).fill(rawTitle);
        await create.getByRole("radio", { name: /^Create with AI/ }).check();
        const beforeCreateLanguage = writes.length;
        await languages.language("zh-CN");
        await expect(page.getByRole("dialog", { name: "新建问卷", exact: true }).getByRole("textbox", { name: "问卷名称", exact: true })).toHaveValue(rawTitle);
        await languages.language("en");
        expect(writes).toHaveLength(beforeCreateLanguage);
        await capture(page, info, "intake-create-en", create);
        await create.getByRole("button", { name: "Next", exact: true }).click();
        await expect(page).toHaveURL(/\/studio\/survey\/new\/import\?draft=/);
        expect(writes).toHaveLength(beforeCreateLanguage);
        const requirements = page.getByRole("textbox", { name: "Survey requirements", exact: true });
        await requirements.fill(rawRequirements);
        const fileBytes = Buffer.from("# 原需求文件 {count}\n\n保留原始文件文字与相反案例。\n", "utf8"), filename = "原需求 {name}.md";
        await page.getByLabel("Upload survey file", { exact: true }).setInputFiles({ name: filename, mimeType: "text/markdown", buffer: fileBytes });
        await expect(page.getByText(filename, { exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Generate survey", exact: true })).toBeEnabled();
        await capture(page, info, "intake-file-raw-en", requirements);
        held = await holdResponse(page, "/surveys/markdown-proposals");
        const proposalResponse = page.waitForResponse(response => pathOf(response.url()) === "/surveys/markdown-proposals" && response.request().method() === "POST");
        await page.getByRole("button", { name: "Generate survey", exact: true }).click();
        const requestBody = await held.reached as {
            text: string;
            file: {
                name: string;
                base64: string;
            };
        };
        expect(requestBody.text).toBe(rawRequirements);
        expect(requestBody.file.name).toBe(filename);
        expect(sha(Buffer.from(requestBody.file.base64, "base64"))).toBe(sha(fileBytes));
        const beforePendingLocale = writes.length;
        await languages.language("zh-CN");
        await expect(page.getByRole("textbox", { name: "问卷需求", exact: true })).toHaveValue(rawRequirements);
        await expect(page.getByRole("button", { name: "正在生成…", exact: true })).toBeDisabled();
        expect(writes).toHaveLength(beforePendingLocale);
        await languages.language("en");
        held.release();
        const proposalHttp = await proposalResponse;
        expect(proposalHttp.ok()).toBe(true);
        const proposal = await proposalHttp.json() as {
            markdown: string;
            execution: {
                provider: string;
                modelId: string;
            };
            source: {
                kind: string;
                sha256: string;
            };
        };
        expect(proposal.markdown.length).toBeGreaterThan(0);
        expect(proposal.execution.provider).toBeTruthy();
        expect(proposal.execution.modelId).toBeTruthy();
        expect(proposal.source.kind).toBe("file");
        const dialog = page.getByRole("dialog"), markdown = dialog.getByRole("textbox", { name: "AI proposal Markdown", exact: true });
        await expect(dialog).toHaveCount(1);
        await expect(dialog).toHaveAccessibleName("Markdown preview and review");
        await expect(markdown).toHaveValue(proposal.markdown);
        const rawQuestion = "原始开放题 {name}", edited = `# 原模型标题 {count}\n\n## feedback [open]\n${rawQuestion}\n`;
        await markdown.fill(edited);
        const editorHandle = await markdown.elementHandle();
        await markdown.focus();
        await markdown.evaluate(element => (element as HTMLTextAreaElement).setSelectionRange(2, 8));
        const beforeModalLocale = writes.length;
        await languages.language("zh-CN");
        await expect(dialog).toHaveAccessibleName("Markdown 预览与校对");
        await expect(page.getByRole("textbox", { name: "AI 提案 Markdown", exact: true })).toHaveValue(edited);
        expect(await editorHandle!.evaluate(element => element === document.activeElement)).toBe(true);
        await languages.language("en");
        await expect(dialog).toHaveAccessibleName("Markdown preview and review");
        expect(writes).toHaveLength(beforeModalLocale);
        await capture(page, info, "proposal-corrected-raw-en", markdown);
        let refused = false;
        const failSourceOnce = async (route: Route) => {
            if (!refused && route.request().method() === "PUT") {
                refused = true;
                await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "forbidden", reasonCode: "CONTROLLED_INTAKE_PERMISSION" }) });
            } else await route.continue();
        };
        await page.route("**/__fullstack_api/surveys/*/source", failSourceOnce);
        const firstCreated = page.waitForResponse(response => pathOf(response.url()) === "/surveys" && response.request().method() === "POST");
        await dialog.getByRole("button", { name: "Apply to survey", exact: true }).click();
        const firstCreatedResponse = await firstCreated;
        expect(firstCreatedResponse.ok()).toBe(true);
        const partial = SurveyRuntimeSchema.parse(await firstCreatedResponse.json());
        await expect(dialog.getByRole("alert")).toHaveCount(1);
        await expect(dialog.getByRole("alert")).toBeVisible();
        await expect(dialog.getByRole("alert")).toContainText("You do not have permission to perform this action.");
        expect(refused).toBe(true);
        // Radix hides the underlying main while review is open. Check both
        // retained inline states as well as the visible dialog error above.
        const retainedErrors = surveySurface(page).getByRole("alert", { includeHidden: true });
        await expect(retainedErrors).toHaveCount(2);
        for (const alert of await retainedErrors.all())
            await expect(alert).toContainText("You do not have permission to perform this action.");
        await expect(dialog.getByRole("textbox", { name: "AI proposal Markdown", exact: true })).toHaveValue(edited);
        const failedWrites = writes.length;
        await languages.language("zh-CN");
        await expect(dialog).toHaveAccessibleName("Markdown 预览与校对");
        expect(writes).toHaveLength(failedWrites);
        await expect(page.getByRole("textbox", { name: "AI 提案 Markdown", exact: true })).toHaveValue(edited);
        await capture(page, info, "proposal-controlled-permission-zh", dialog.getByRole("button", { name: "应用到问卷", exact: true }));
        await page.unroute("**/__fullstack_api/surveys/*/source", failSourceOnce);
        const sourceSaved = page.waitForResponse(response => pathOf(response.url()) === `/surveys/${partial.id}/source` && response.request().method() === "PUT");
        await dialog.getByRole("button", { name: "应用到问卷", exact: true }).click();
        expect((await sourceSaved).ok()).toBe(true);
        await expect(page).toHaveURL(new RegExp(`/studio/survey/${partial.id}/design$`));
        await expect(page.getByRole("textbox", { name: "问卷名称", exact: true })).toHaveValue(rawTitle);
        const id = partial.id, saved = await runtime(page, id);
        expect(saved.template).toEqual(partial.template);
        await languages.language("en");
        expect(saved.title).toBe(rawTitle);
        expect(saved.questions).toHaveLength(1);
        expect(saved.questions[0]!.title).toBe(rawQuestion);
        expect(saved.source?.documents.design.markdown).toContain(rawTitle);
        expect(saved.source?.documents.design.markdown).toContain(rawQuestion);
        await page.reload();
        await expect(page.getByRole("textbox", { name: "Survey name", exact: true })).toHaveValue(rawTitle);
        await expect(page.getByRole("button", { name: `Edit question 1: ${rawQuestion}`, exact: true })).toBeVisible();
        await capture(page, info, "import-persisted-design-en", page.getByRole("textbox", { name: "Survey name", exact: true }));
        expect(writes.filter(call => call.path === "/surveys/markdown-proposals")).toHaveLength(1);
        expect(writes.filter(call => call.path === "/surveys" && call.method === "POST")).toHaveLength(1);
        expect(writes.filter(call => call.path === `/surveys/${id}/source` && call.method === "PUT")).toHaveLength(2);
        expect(errors).toEqual([]);
        await writeFile(info.outputPath("intake-mutation-receipt.json"), JSON.stringify({ testRetry: info.retry, testTimeoutMs: info.timeout, surveyId: id, fileSha256: sha(fileBytes), fileSize: fileBytes.length, proposalSourceKind: proposal.source.kind, proposalSourceSha256: proposal.source.sha256, provider: proposal.execution.provider, modelId: proposal.execution.modelId, correctedMarkdownSha256: sha(edited), persistedDesignSha256: sha(saved.source!.documents.design.markdown), sourceHash: saved.source!.contentHash, proposalRequests: 1, createAttempts: 1, sourceSaveAttempts: 2, originalReportIdentityRetained: true, controlledPermissionFailure: true, configuredModelExecution: true, vendorQualityClaim: false }, null, 2));
    }
    finally {
        await held?.dispose();
        await languages?.close();
    }
});
