import { expect, test } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { interviewMarkdown as C } from "@repo/contracts";
import { FULLSTACK_E2E as F } from "./fullstack-smoke-fixture";

const apiPath = (url: string) => new URL(url).pathname.replace(/^\/__fullstack_api/, "");

test("interview locale preserves the real private-profile, canonical six-step and history journey", async ({ page, context }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  let writes = 0;
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.method() === "POST" && apiPath(request.url()).startsWith("/interviews/digital")) writes++; });
  const rawName = `原始访谈 {count} ${randomUUID()}`;
  const rawExpert = `私有专家 {count} ${randomUUID()}`;
  const rawGoal = "# 原始研究需求\n\n## 研究目标\n核对最近一次任务的具体经过和相反案例，保留客户原文。";
  await page.goto("/login");
  await page.getByTestId("language-switcher").selectOption("en");
  await page.getByTestId("login-email").fill(F.email);
  await page.getByTestId("login-password").fill(F.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/home$/);
  const token = await page.evaluate(() => localStorage.getItem("wsx.sessionToken"));
  expect(token).toBeTruthy();
  const headers = { authorization: `Bearer ${token}` };
  const languagePage = await context.newPage();
  await languagePage.goto("/itv");
  const language = async (locale: "en" | "zh-CN") => { await languagePage.getByTestId("language-switcher").first().selectOption(locale); };
  const capture = async (name: string, workflow = false) => {
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => {
        window.scrollTo(0, 0);
        document.querySelectorAll("main, [role=dialog]").forEach(element => { element.scrollTop = 0; element.scrollLeft = 0; });
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const nav = page.getByTestId("itv-workbench-navigation");
      await expect(nav).toHaveCount(workflow ? 1 : 0);
      if (workflow) {
        for (const label of ["Import requirements", "Confirm analysis", "Select experts", "Interview questions", "Start interviews", "Generate report"]) {
          expect(await nav.getByText(label, { exact: true }).evaluate(element => {
            const cell = element.closest("li")!.getBoundingClientRect(); const bounds = element.getBoundingClientRect();
            return element.scrollWidth <= element.clientWidth && bounds.left >= cell.left - 1 && bounds.right <= cell.right + 1;
          })).toBe(true);
        }
      }
      if (new URL(page.url()).pathname.endsWith("/outline")) {
        const outline = page.getByTestId("itv-markdown-outline");
        for (const panel of await outline.locator("aside, article").all()) {
          const box = await panel.boundingBox(); expect(box).not.toBeNull();
          expect(box!.x).toBeGreaterThanOrEqual(8); expect(box!.x + box!.width).toBeLessThanOrEqual(width - 8);
          expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
        }
        for (const heading of await outline.locator("article h3").all()) {
          expect(await heading.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
        }
      }
      for (const button of await page.getByTestId("itv-step-actions").getByRole("button").all()) {
        const box = await button.boundingBox(); expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(8); expect(box!.x + box!.width).toBeLessThanOrEqual(width - 8);
        expect(await button.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      }
      const dialog = page.getByRole("dialog");
      if (await dialog.count()) {
        const box = await dialog.boundingBox(); expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(8); expect(box!.x + box!.width).toBeLessThanOrEqual(width - 8);
        expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      }
      await page.screenshot({ path: test.info().outputPath(`${name}-${width}.png`), fullPage: true });
    }
  };
  await page.goto("/itv?tab=experts");
  await page.getByTestId("itv-add-library-expert").click();
  const profile = page.getByRole("dialog");
  await expect(profile).toHaveCount(1);
  await expect(profile.getByRole("heading", { name: "Add expert profile", exact: true })).toBeVisible();
  for (const [name, value] of Object.entries({ Name: rawExpert, "Professional role": "原专业角色", "Professional domains": "研究", "Research focus": "原始任务与反例", "Perspective style": "原始观点风格", Capabilities: "仅用于模拟研究的私有画像", "Limitations and material boundary": "原始材料边界，仅模拟" })) {
    await profile.getByRole("textbox", { name, exact: true }).fill(value);
  }
  await profile.getByRole("textbox", { name: "Occupation", exact: true }).fill("原始职业");
  await language("zh-CN"); await expect(profile.getByRole("heading", { name: "添加专家画像", exact: true })).toBeVisible(); await expect(profile.getByRole("textbox", { name: "名称", exact: true })).toHaveValue(rawExpert);
  await language("en"); await expect(profile.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(rawExpert);
  await capture("private-profile-en");
  await profile.getByRole("button", { name: "Save expert", exact: true }).click();
  await expect(profile).not.toBeVisible();
  const catalogResponse = await page.request.get("/__fullstack_api/interviews/digital/expert-library", { headers });
  expect(catalogResponse.ok()).toBe(true);
  const catalog = await catalogResponse.json();
  const custom = catalog.items.find((item: { fields: { name: string } }) => item.fields.name === rawExpert);
  expect(custom).toBeTruthy(); expect(custom.fields.profile.occupation).toBe("原始职业");
  await page.reload();
  const customCard = page.getByTestId(`itv-library-${custom.expertId}`);
  await expect(customCard).toContainText(rawExpert);
  await customCard.getByRole("button", { name: `View profile ${rawExpert}`, exact: true }).click();
  await expect(page.getByRole("dialog", { name: rawExpert, exact: true })).toContainText("原始职业");
  await capture("private-profile-detail-en");
  await page.keyboard.press("Escape");
  await expect(customCard.getByRole("button", { name: `View profile ${rawExpert}`, exact: true })).toBeFocused();
  await page.goto("/itv/new");
  const create = page.getByRole("dialog", { name: "New interview", exact: true });
  await create.getByRole("textbox", { name: "Interview name", exact: true }).fill(rawName);
  await capture("create-interview-en");
  await create.getByRole("button", { name: "Start interview", exact: true }).click();
  await expect(page).toHaveURL(/\/itv\/[^/]+\/intake$/);
  const id = new URL(page.url()).pathname.split("/")[2]!;
  const sourceUrl = `/__fullstack_api/interviews/digital/${encodeURIComponent(id)}/markdown`;
  const readSource = async () => { const response = await page.request.get(sourceUrl, { headers }); expect(response.ok()).toBe(true); return C.InterviewMarkdownEnvelope.parse(await response.json()); };
  const demand = page.getByRole("textbox", { name: "Research requirements Markdown", exact: true });
  await expect(demand).toBeEnabled(); await demand.fill(rawGoal);
  const beforeSwitch = writes;
  await language("zh-CN"); await expect(page.getByRole("textbox", { name: "研究需求 Markdown", exact: true })).toHaveValue(rawGoal);
  await language("en"); await expect(demand).toHaveValue(rawGoal); expect(writes).toBe(beforeSwitch);
  page.once("dialog", async dialog => { expect(dialog.message()).toContain("unsaved Markdown"); await dialog.dismiss(); });
  await page.getByRole("button", { name: "Back to interviews", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/itv/${id}/intake$`));
  await capture("interview-intake-en", true);
  await page.getByRole("button", { name: "Next: confirm analysis", exact: true }).click();
  await expect(page).toHaveURL(/\/analysis$/);
  await capture("interview-analysis-en", true);
  expect((await readSource()).documents.find(document => document.step === "intake")?.markdown).toBe(rawGoal);
  await page.getByRole("button", { name: "Select experts", exact: true }).click();
  await expect(page).toHaveURL(/\/experts$/);
  await page.getByTestId(`itv-library-${custom.expertId}`).getByRole("button", { name: `Add profile ${rawExpert}`, exact: true }).click();
  await expect.poll(async () => (await readSource()).documents.find(document => document.step === "experts")?.markdown).toContain(`#expert-${custom.expertId}`);
  await capture("interview-experts-en", true);
  await page.getByRole("button", { name: "Confirm experts and generate questions", exact: true }).click();
  // Expert confirmation also confirms the generated outline and starts execution.
  // Edit through the real revision action; confirmed source must remain read-only.
  await expect(page).toHaveURL(/\/runs$/);
  await expect(page.getByRole("button", { name: "Generate report", exact: true })).toBeEnabled();
  const beforeRevision = await readSource();
  expect(beforeRevision.execution?.status).toBe("completed");
  const confirmedOutline = beforeRevision.documents.find(document => document.step === "outline")!;
  await page.getByTestId("itv-workbench-step-outline").click();
  await expect(page).toHaveURL(/\/outline$/);
  const question = page.getByRole("textbox", { name: "Edit question 1", exact: true });
  await expect(question).toBeDisabled();
  page.once("dialog", async dialog => { expect(dialog.message()).toContain("preserves the previous version"); await dialog.accept(); });
  await page.getByRole("button", { name: "Create revision and edit", exact: true }).click();
  await expect(question).toBeEnabled();
  const revised = await readSource();
  expect(revised.revisionId).not.toBe(beforeRevision.revisionId);
  expect(revised.version).toBeGreaterThan(beforeRevision.version);
  expect(revised.documents.find(document => document.step === "outline")?.markdown).toBe(confirmedOutline.markdown);
  await question.fill("用户原始修改的问题？");
  await language("zh-CN"); await language("en"); await expect(question).toHaveValue("用户原始修改的问题？");
  await page.getByRole("button", { name: "Save question draft", exact: true }).click();
  await expect.poll(async () => (await readSource()).documents.find(document => document.step === "outline")?.markdown).toContain("用户原始修改的问题？");
  await page.reload(); await expect(question).toHaveValue("用户原始修改的问题？");
  await capture("interview-outline-en", true);
  await page.getByRole("button", { name: "Confirm questions and start interviews", exact: true }).click();
  await expect(page).toHaveURL(/\/runs$/);
  const generateReport = page.getByRole("button", { name: "Generate report", exact: true });
  await expect(generateReport).toBeEnabled({ timeout: 60_000 });
  await capture("interview-runs-en", true);
  const beforeReport = await readSource();
  const sourceDocuments = beforeReport.documents.filter(document => document.step !== "report" && beforeReport.states.some(state => state.documentId === document.documentId && ["confirmed", "completed"].includes(state.status)));
  expect(sourceDocuments).toHaveLength(5);
  const expectedReferences = sourceDocuments.map((document, index) => ({ anchor: `source-${index + 1}`, documentId: document.documentId, version: document.version }));
  await generateReport.click();
  await expect(page).toHaveURL(/\/report$/);
  await expect(page.getByTestId("itv-source-report-markdown")).toContainText("确定性测试模型", { timeout: 60_000 });
  await expect.poll(async () => {
    const current = await readSource(); const report = current.documents.find(document => document.step === "report");
    const state = current.states.find(state => state.documentId === report?.documentId);
    return Boolean(report && state && ["draft", "confirmed", "completed"].includes(state.status) && !state.failure && report.references.length === expectedReferences.length);
  }, { timeout: 60_000 }).toBe(true);
  const saved = await readSource(); const report = saved.documents.find(document => document.step === "report")!;
  // The active professional stream binds source documents and versions. It does
  // not provide per-answer locators; the separate grounded helper tests cover those.
  expect(report.references.map(({ anchor, documentId, version }) => ({ anchor, documentId, version }))).toEqual(expectedReferences);
  expect(report.markdown).toMatch(/^# 确定性测试模型的模拟研究报告/);
  expect(report.contentHash).toBe(createHash("sha256").update(report.markdown).digest("hex"));
  expect(saved.documents.filter(document => document.step !== "report")).toEqual(beforeReport.documents.filter(document => document.step !== "report"));
  const terminalWrites = writes;
  await language("zh-CN"); await expect(page.getByRole("navigation", { name: "报告目录", exact: true })).toBeVisible();
  await language("en"); await expect(page.getByRole("navigation", { name: "Report contents", exact: true })).toBeVisible();
  const unchanged = await readSource(); expect(unchanged.version).toBe(saved.version);
  expect(unchanged.documents.find(document => document.step === "report")).toEqual(report); expect(writes).toBe(terminalWrites);
  await capture("interview-report-en", true);
  await page.getByRole("button", { name: "Back to interviews", exact: true }).click();
  await page.getByTestId(`itv-history-actions-${id}`).click(); await page.getByTestId(`itv-history-edit-${id}`).click();
  await page.getByTestId("itv-edit-name").fill(rawName); await page.getByTestId("itv-edit-tag-input").fill("原始标签");
  await language("zh-CN"); await language("en"); await expect(page.getByTestId("itv-edit-tag-input")).toHaveValue("原始标签");
  await capture("interview-metadata-en"); await page.getByTestId("itv-edit-submit").click();
  await expect(page.getByTestId("itv-edit-dialog")).not.toBeVisible(); await page.reload();
  await expect(page.getByTestId(`itv-history-card-${id}`)).toContainText("原始标签");
  await capture("interview-history-en");
  await page.getByTestId(`itv-history-actions-${id}`).click(); await page.getByTestId(`itv-history-delete-${id}`).click();
  await expect(page.getByRole("dialog")).toContainText("interview");
  await page.getByRole("button", { name: "Cancel", exact: true }).click(); await expect(page.getByTestId(`itv-history-card-${id}`)).toBeVisible();
  expect(errors).toEqual([]);
});
