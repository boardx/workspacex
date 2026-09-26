import { expect, test, type Locator, type Page } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

const TEMPLATE_TITLE = "会议反馈调查";

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.adminEmail);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.adminPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

function question(page: Page, title: string): Locator {
  return page.getByRole("group", { name: title });
}

async function answerPublishedSurvey(page: Page) {
  await expect(page.getByRole("heading", { name: TEMPLATE_TITLE })).toBeVisible();
  await page.getByRole("textbox", { name: "会议名称" }).fill("季度产品复盘会");
  await page.getByLabel("会议日期").fill("2026-09-21");

  for (const title of [
    "会议目标和议程清晰。",
    "会议内容与我的工作相关。",
    "参会者有足够机会表达意见。",
    "会后行动项、负责人和时间明确。",
  ]) {
    await question(page, title).getByRole("radio").nth(3).check();
  }
  await question(page, "会议时长是否合适？")
    .getByLabel("合适", { exact: true })
    .check();
  await page
    .getByRole("textbox", { name: "下次会议最值得改进的地方是什么？" })
    .fill("减少状态同步，预留更多决策时间。");

  await page.getByRole("button", { name: "提交答卷" }).click();
  await expect(page.getByRole("status")).toHaveText("提交成功，感谢您的参与。");
}

test("用户可从模板完整走通创建、发布、答题、查看答卷和正式报告", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await loginAsAdmin(page);

  await page.goto("/studio/survey");
  await expect(page.getByRole("heading", { name: "我的问卷" })).toBeVisible();
  await page.getByRole("button", { name: "从模板创建" }).click();
  await expect(page).toHaveURL(/\/studio\/survey\?tab=modules$/);

  const template = page.locator("article").filter({
    has: page.getByRole("heading", { name: TEMPLATE_TITLE, exact: true }),
  });
  await expect(template).toContainText("8 道题目");
  await template.getByRole("button", { name: "使用并创建问卷" }).click();
  await expect(page).toHaveURL(/\/studio\/survey\/[0-9a-f-]+$/);

  await expect(page.getByLabel("问卷名称")).toHaveValue(TEMPLATE_TITLE);
  await expect(page.getByText("题目目录 · 8")).toBeVisible();
  await expect(page.getByText("1. 会议名称", { exact: true })).toBeVisible();
  await expect(page.getByText("2. 会议日期", { exact: true })).toBeVisible();
  await expect(page.getByText("8. 下次会议最值得改进的地方是什么？", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "2. 报告模板" }).click();
  await expect(page.getByText("报告章节 · 4")).toBeVisible();
  await expect(page.getByLabel("报告标题")).toHaveValue("会议反馈调查分析报告");
  await expect(page.getByRole("button", { name: "预览完整报告" })).toBeVisible();

  await page.getByRole("button", { name: "3. 发布回收" }).click();
  await page.getByRole("button", { name: "检查发布条件" }).click();
  await expect(page.getByText("发布准备已完成")).toBeVisible();
  await page.getByRole("button", { name: "开始回收" }).click();
  await expect(page.getByText(/正在回收 · 0 份答卷/)).toBeVisible();
  const publicUrl = await page.getByLabel("答题链接").inputValue();
  expect(publicUrl).toMatch(/\/surveys\/[A-Za-z0-9._-]+$/);

  const respondentContext = await browser.newContext();
  const respondent = await respondentContext.newPage();
  await respondent.goto(publicUrl);
  await answerPublishedSurvey(respondent);
  await respondentContext.close();

  await page.getByRole("button", { name: "刷新" }).click();
  await expect(page.getByText(/正在回收 · 1 份答卷/)).toBeVisible();
  await page.getByRole("button", { name: "4. 查看答卷" }).click();
  await expect(page.getByText("1 份答卷", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "查看完整答卷" }).click();
  await expect(page.getByRole("region", { name: "答卷详情" })).toContainText(
    "季度产品复盘会",
  );

  await page.getByRole("button", { name: "5. 分析报告" }).click();
  await page.getByRole("button", { name: "生成报告" }).click();
  const report = page.getByTestId("survey-report-document");
  await expect(report).toBeVisible();
  await expect(report).toContainText(`${TEMPLATE_TITLE}分析报告`);
  await expect(report).not.toContainText("草稿");
  await expect(report.getByTestId("survey-section-analysis").first()).toBeVisible();
  await expect(report).toContainText("受访者");
  await report.getByTestId("survey-section-analysis").first().screenshot({ path: test.info().outputPath("single-response-analysis.png") });
  await expect(report.locator("[data-chart] svg").first()).toBeVisible();
  await expect(report.locator("[data-report-block]").filter({ has: page.locator("[data-chart]") }).locator("table")).toHaveCount(0);
  await expect(report.locator("[data-chart] svg").first()).not.toContainText("会议时长是否合适？");
  await report.locator("[data-chart]").first().scrollIntoViewIfNeeded();
  await report.locator("[data-chart]").first().screenshot({ path: test.info().outputPath("template-chart.png") });

  // New answers arrive while the owner keeps the existing report open.
  const secondContext = await browser.newContext();
  const secondRespondent = await secondContext.newPage();
  await secondRespondent.goto(publicUrl);
  await answerPublishedSurvey(secondRespondent);
  await secondContext.close();
  const regenerated = page.waitForResponse(response => response.url().endsWith("/report") && response.request().method() === "POST");
  await page.getByRole("button", { name: "重新生成报告" }).click();
  expect((await regenerated).ok()).toBeTruthy();
  await expect(page.getByText("报告已按最新答卷和报告模板重新生成")).toBeVisible();
  await expect(page.getByTestId("survey-report-generated-at")).toBeVisible();
  await expect(report.locator("[data-chart] svg").first()).toContainText("2");

  await expect(page.getByTestId("survey-report-share-privacy-warning")).toHaveText(
    "纳入分析的样本不足 8 份，无法导出或共享报告",
  );
  await expect(page.getByRole("button", { name: "导出 Word" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "导出 PDF" })).toBeDisabled();

  await page.getByRole("button", { name: "← 返回列表" }).click();
  await expect(page).toHaveURL(/\/studio\/survey$/);
  const persistedSurvey = page.locator("article").filter({
    has: page.getByRole("link", { name: TEMPLATE_TITLE, exact: true }),
  });
  await expect(persistedSurvey).toContainText("8 道题 · 2 份答卷 · 回收中");
});
