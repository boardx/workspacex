for (const key of ["SURVEY_API_URL", "SURVEY_WEB_URL"]) {
  if (
    !process.env[key] ||
    !["localhost", "127.0.0.1"].includes(new URL(process.env[key]).hostname)
  )
    throw new Error(key + " must target an isolated local test service");
}
const { chromium } = require("@playwright/test");
const fs = require("fs");
(async () => {
  const base = process.env.SURVEY_WEB_URL,
    api = process.env.SURVEY_API_URL;
  const auth = await fetch(api + "/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "dev-mode-consultant@workspacex.test",
      password: "DevMode-Consultant-Preset-2026!",
    }),
  });
  if (!auth.ok) throw Error("login " + auth.status);
  const session = await auth.json();
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
  });
  await context.addInitScript((session) => {
    localStorage.setItem("wsx.sessionToken", session.sessionToken);
    localStorage.setItem(
      "wsx.session",
      JSON.stringify({
        version: 1,
        userId: session.userId,
        orgs: session.orgs,
        currentOrgId: session.orgs[0],
        expiresAt: session.expiresAt,
      }),
    );
  }, session);
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.on("pageerror", (error) => console.log("PAGE ERROR", error.message));
  await page.goto(base + "/studio/survey/new");
  await page.getByLabel("问卷名称").fill("团队协作调查");
  await page.getByRole("button", { name: "新增题目" }).click();
  await page.getByLabel("问题内容").fill("团队协作满意度");
  await page.getByLabel("题型", { exact: true }).selectOption("scale");
  await page.getByRole("button", { name: "2. 报告模板" }).click();
  await page.getByLabel("报告标题", { exact: true }).fill("团队协作分析报告");
  await page.getByRole("button", { name: "新增章节" }).click();
  await page.getByLabel("章节标题", { exact: true }).fill("协作现状");
  await page.getByRole("button", { name: "添加指标卡" }).click();
  await page.getByLabel("内容标题", { exact: true }).fill("满意度均值");
  await page.getByLabel("1. 团队协作满意度", { exact: true }).check();
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await page.waitForURL(/studio\/survey\/[a-f0-9-]+\?step=template/);
  console.log("saved");
  await page.reload();
  await page.getByLabel("报告标题", { exact: true }).waitFor();
  if (
    (await page.getByLabel("报告标题", { exact: true }).inputValue()) !==
    "团队协作分析报告"
  )
    throw Error("persistence");
  await page.screenshot({
    path: "../../docs/evidence/survey-3754/template-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "3. 发布回收" }).click();
  await page.getByRole("button", { name: "发布问卷", exact: true }).click();
  await page.getByLabel("答题链接", { exact: true }).waitFor();
  const url = await page.getByLabel("答题链接", { exact: true }).inputValue();
  const anon = await browser.newContext();
  const answer = await anon.newPage();
  answer.setDefaultTimeout(60000);
  await answer.goto(url);
  await answer.getByLabel("4", { exact: true }).check();
  await answer.getByRole("button", { name: "提交答卷", exact: true }).click();
  await answer.getByText("提交成功，感谢您的参与。", { exact: true }).waitFor();
  console.log("submitted anonymously");
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page.getByRole("button", { name: "4. 查看答卷" }).click();
  await page.getByText("1 份答卷", { exact: true }).waitFor();
  await page.getByRole("button", { name: "查看完整答卷" }).click();
  await page.getByRole("heading", { name: "完整答卷" }).waitFor();
  await page.getByRole("button", { name: "5. 分析报告" }).click();
  await page.getByRole("button", { name: "生成报告", exact: true }).click();
  await page.getByTestId("survey-report-document").waitFor();
  const text = await page.getByTestId("survey-report-document").innerText();
  if (!text.includes("4")) throw Error("mean absent");
  await page.screenshot({
    path: "../../docs/evidence/survey-3754/report-desktop.png",
    fullPage: true,
  });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 Word", exact: true }).click();
  await (
    await downloadPromise
  ).saveAs("../../docs/evidence/survey-3754/report.docx");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "../../docs/evidence/survey-3754/report-mobile.png",
    fullPage: true,
  });
  await page.reload();
  await page.getByTestId("survey-report-document").waitFor();
  console.log("report snapshot survives reload, Word downloaded");
  fs.writeFileSync(
    "../../docs/evidence/survey-3754/browser-result.json",
    JSON.stringify(
      {
        journey:
          "create/edit/template/save/reload/publish/anonymous-submit/responses/report/export/reload",
        success: true,
        reportText: text,
      },
      null,
      2,
    ),
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
