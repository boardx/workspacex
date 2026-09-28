import { expect, test, type Locator, type Page } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

const TEMPLATE_TITLE = "会议反馈调查";

test('AI 提案先校对再应用并保存为 Markdown',async({page},testInfo)=>{
 test.setTimeout(120000);await loginAsAdmin(page);await page.goto('/studio/survey');
 await page.getByTestId('survey-create-primary').click();
 await page.getByLabel('问卷名称').fill('AI 校对验收');
 await page.getByLabel('标签',{exact:true}).fill('客户调研');await page.getByLabel('标签',{exact:true}).press('Enter');
 await page.getByRole('radio',{name:/AI 导入创建/}).check();
 await page.getByRole('button',{name:'下一步',exact:true}).click();
 await expect(page).toHaveURL(/step=import&mode=ai/);
 await page.getByRole('button',{name:'← 返回列表'}).click();
 const unfinished=page.locator('article').filter({has:page.getByRole('link',{name:'AI 校对验收'})});
 await unfinished.getByRole('button',{name:'继续设计'}).click();
 await expect(page).toHaveURL(/step=import&mode=ai/);
 await page.screenshot({path:testInfo.outputPath('survey-ai-import-step.png'),fullPage:true});
 await page.getByLabel('问卷需求').fill('调查客户最近一次使用体验');
 await page.getByLabel('上传问卷文件').setInputFiles({name:'研究目标.md',mimeType:'text/markdown',buffer:Buffer.from('研究软件用户近期的真实产品体验')});
 await expect(page.getByText(/研究目标.md/)).toBeVisible();
 await page.getByRole('button',{name:'生成问卷',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Markdown 预览与校对'});
 await expect(dialog).toBeVisible();
 await expect(dialog.getByLabel('AI 提案 Markdown')).toHaveValue(/#/);
 await dialog.getByLabel('AI 提案 Markdown').fill('# AI 校对验收\n\n## feedback [open]\n请描述具体建议\n');
 await dialog.getByRole('button',{name:'应用到问卷',exact:true}).click();
 await expect(page.getByRole('region',{name:'问卷设计画布'})).toContainText('请描述具体建议');
 await expect(page.getByLabel('问卷 Markdown',{exact:true})).toHaveCount(0);
 await page.screenshot({path:testInfo.outputPath('survey-ai-applied-designer.png'),fullPage:true});
 await expect(page.getByRole('status').filter({hasText:'所有修改已保存'})).toBeVisible();
 await page.reload();await expect(page.getByRole('region',{name:'问卷设计画布'})).toContainText('请描述具体建议');
});

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
},testInfo) => {
  test.setTimeout(120_000);
  await loginAsAdmin(page);

  await page.goto("/studio/survey");
  await expect(page.getByRole("heading", { name: "问卷", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "问卷二级导航" })).toBeVisible();
  await page.screenshot({path:testInfo.outputPath("survey-home-desktop.png"),fullPage:true});
  await page.getByRole("link", { name: "问卷模板", exact: true }).click();
  await expect(page).toHaveURL(/\/studio\/survey\?tab=modules$/);

  const template = page.locator("article").filter({
    has: page.getByRole("heading", { name: TEMPLATE_TITLE, exact: true }),
  });
  await expect(template).toContainText("8 道题目");
  await template.getByRole("button", { name: "使用并创建问卷" }).click();
  await expect(page).toHaveURL(/\/studio\/survey\/[0-9a-f-]+\/design$/);

  await expect(page.getByLabel("问卷名称")).toHaveValue(TEMPLATE_TITLE);
  await expect(page.getByText("题目目录 · 8")).toBeVisible();
  await expect(page.getByText("1. 会议名称", { exact: true })).toBeVisible();
  await expect(page.getByText("2. 会议日期", { exact: true })).toBeVisible();
  await expect(page.getByText("8. 下次会议最值得改进的地方是什么？", { exact: true })).toBeVisible();
  await page.screenshot({path:testInfo.outputPath("survey-designer-desktop.png"),fullPage:true});

  await expect(page.getByRole('heading',{name:'AI 智能生成问卷'})).toHaveCount(0);
  await expect(page.getByLabel('问卷 Markdown',{exact:true})).toHaveCount(0);

  await page.getByRole("button", { name: "设计报告模板（可选）" }).click();
  await expect(page.getByText("报告章节 · 4")).toBeVisible();
  await expect(page.getByLabel("报告标题")).toHaveValue("会议反馈调查分析报告");
  await expect(page.getByRole("button", { name: "预览完整报告" })).toBeVisible();

  await page.getByRole("button", { name: "2. 发布回收" }).click();
  await page.getByRole("button", { name: "检查发布条件" }).click();
  await expect(page.getByText("发布准备已完成")).toBeVisible();
  await page.getByRole("button", { name: "开始回收" }).click();
  await expect(page.getByText(/正在回收 · 0 份答卷/)).toBeVisible();
  await page.screenshot({path:testInfo.outputPath("survey-publish-desktop.png"),fullPage:true});
  const publicUrl = await page.getByLabel("答题链接").inputValue();
  await page.getByRole('button',{name:'生成二维码'}).click();
  await expect(page.getByRole('img',{name:'问卷分享二维码'})).toBeVisible();
  expect(publicUrl).toMatch(/\/surveys\/[A-Za-z0-9._-]+$/);

  const respondentContext = await browser.newContext();
  const respondent = await respondentContext.newPage();
  await respondent.goto(publicUrl);
  await answerPublishedSurvey(respondent);
  await respondentContext.close();

  await page.getByRole("button", { name: "刷新" }).click();
  await expect(page.getByText(/正在回收 · 1 份答卷/)).toBeVisible();
  await page.getByRole("button", { name: "3. 查看答卷" }).click();
  await expect(page.getByText("1 份答卷", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "查看完整答卷" }).click();
  await expect(page.getByRole("region", { name: "答卷详情" })).toContainText(
    "季度产品复盘会",
  );
  await page.screenshot({path:test.info().outputPath('response-workspace-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('region',{name:'答卷详情'})).toContainText('季度产品复盘会');
  await page.screenshot({path:test.info().outputPath('response-workspace-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:900});

  await page.getByRole("button", { name: "分析报告（可选）" }).click();
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
  await expect(persistedSurvey).toContainText("回收中");
  await expect(persistedSurvey).toContainText("8题目数");
  await expect(persistedSurvey).toContainText("2答卷数");
  await page.screenshot({path:testInfo.outputPath("survey-home-populated-desktop.png"),fullPage:true});
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("navigation", { name: "问卷二级导航" })).toBeVisible();
  await expect(page.getByRole("link", { name: TEMPLATE_TITLE, exact: true })).toBeVisible();
  await page.screenshot({path:testInfo.outputPath("survey-home-populated-mobile.png"),fullPage:true});
});

test('空白创建直接进入设计而不经过 AI 导入',async({page})=>{
  await loginAsAdmin(page);
  await page.goto('/studio/survey');
  await page.getByTestId('survey-create-primary').click();
  const creation=page.getByRole('dialog');
  await creation.getByLabel('问卷名称',{exact:true}).fill('空白创建验收');
  await creation.getByRole('radio',{name:/空白创建/}).check();
  await creation.getByRole('button',{name:'下一步'}).click();
  await expect(page).toHaveURL(/\/studio\/survey\/[0-9a-f-]+\/design$/);
  await expect(page.getByRole('region',{name:'问卷设计画布'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'AI 智能生成问卷'})).toHaveCount(0);
  await expect(page.getByLabel('问卷 Markdown',{exact:true})).toHaveCount(0);
  await page.screenshot({path:test.info().outputPath('survey-blank-designer.png'),fullPage:true});
});

test('新建弹窗可从真实模板创建并在刷新后保留名称',async({page})=>{
  await loginAsAdmin(page);await page.goto('/studio/survey');
  await page.getByTestId('survey-create-primary').click();
  const creation=page.getByRole('dialog');
  await creation.getByLabel('问卷名称',{exact:true}).fill('模板弹窗创建验证');
  await creation.getByRole('radio',{name:/从模板创建/}).check();
  await creation.getByLabel('选择问卷模板').selectOption({label:TEMPLATE_TITLE});
  await creation.getByRole('button',{name:'下一步'}).click();
  await expect(page.getByLabel('问卷名称')).toHaveValue('模板弹窗创建验证');
  await expect(page).toHaveURL(/\/studio\/survey\/[0-9a-f-]+\/design$/);
  await expect(page.getByText('题目目录 · 8')).toBeVisible();await page.reload();
  await expect(page.getByLabel('问卷名称')).toHaveValue('模板弹窗创建验证');
});
