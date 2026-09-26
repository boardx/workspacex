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
  const api = process.env.SURVEY_API_URL,
    base = process.env.SURVEY_WEB_URL;
  const login = await fetch(api + "/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "dev-mode-consultant@workspacex.test",
      password: "DevMode-Consultant-Preset-2026!",
    }),
  });
  const session = await login.json();
  const request = async (path, data, publicCall = false) => {
    const r = await fetch(api + path, {
      method: data ? "POST" : "GET",
      headers: {
        "content-type": "application/json",
        ...(publicCall
          ? {}
          : { authorization: "Bearer " + session.sessionToken }),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    if (!r.ok) throw Error(path + " " + r.status + " " + (await r.text()));
    return r.json();
  };
  const questions = ["组织协作", "工具支持", "知识共享"].map((title, i) => ({
    id: "q" + i,
    title,
    order: i + 1,
    type: "scale",
    chapterId: "general",
    required: true,
    options: ["1", "2", "3", "4", "5"],
  }));
  const blocks = ["text", "bar", "radar", "line", "gap", "table"].map(
    (type, i) => ({
      id: "b" + i,
      title:
        type === "text"
          ? "研究说明"
          : {
              bar: "能力得分",
              radar: "能力轮廓",
              line: "答题日期趋势",
              gap: "目标差距",
              table: "汇总数据",
            }[type],
      type,
      questionIds: type === "text" ? [] : questions.map((q) => q.id),
      statistic: "mean",
      samplePolicy: "valid",
      minGroupSize: 5,
      ...(type === "gap" ? { target: 5 } : {}),
      ...(type === "text"
        ? { text: "本报告统计本次回收的三项量表题，每项满分 5 分。" }
        : {}),
      caption: "真实答卷计算，不使用示例数值",
    }),
  );
  let m = await request("/surveys", {
    title: "报告组件验收",
    questions,
    template: {
      id: "tpl",
      title: "团队协作诊断报告",
      sections: [{ id: "sec", title: "能力分析", blocks }],
    },
  });
  m = await request("/surveys/" + m.id + "/publish", {
    expectedVersion: m.version,
  });
  await request(
    "/public/surveys/" + m.publication.token + "/responses",
    {
      submissionId: crypto.randomUUID(),
      answers: questions.map((q, i) => ({
        questionId: q.id,
        value: String(i + 2),
      })),
    },
    true,
  );
  m = await request("/surveys/" + m.id);
  m = await request("/surveys/" + m.id + "/report", {
    expectedVersion: m.version,
  });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await ctx.addInitScript((s) => {
    localStorage.setItem("wsx.sessionToken", s.sessionToken);
    localStorage.setItem(
      "wsx.session",
      JSON.stringify({
        version: 1,
        userId: s.userId,
        orgs: s.orgs,
        currentOrgId: s.orgs[0],
        expiresAt: s.expiresAt,
      }),
    );
    window.print = () => {};
  }, session);
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  await page.goto(base + "/studio/survey/" + m.id + "?step=report");
  await page.getByTestId("survey-report-document").waitFor();
  if ((await page.locator('svg[role="img"]').count()) < 3)
    throw Error("charts missing");
  const d = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 Word", exact: true }).click();
  await (await d).saveAs("../../docs/evidence/survey-3754/charts.docx");
  await page.screenshot({
    path: "../../docs/evidence/survey-3754/charts-desktop.png",
    fullPage: true,
  });
  await page.evaluate(() => {
    new MutationObserver(() => {
      for (const f of document.querySelectorAll(
        'iframe[title="调研报告 PDF"]',
      )) {
        if (f.contentWindow)
          f.contentWindow.print = () => {
            f.dataset.printCalled = "true";
          };
      }
    }).observe(document.body, { childList: true });
  });
  await page.getByRole("button", { name: "导出 PDF", exact: true }).click();
  await page.waitForTimeout(1500);
  const iframe = page.frameLocator('iframe[title="调研报告 PDF"]');
  await iframe
    .getByText("汇总数据", { exact: true })
    .waitFor({ state: "attached" });
  if (
    (await page
      .locator('iframe[title="调研报告 PDF"]')
      .getAttribute("data-print-called")) !== "true"
  )
    throw Error("print was never called");
  if (
    (await iframe
      .getByText("真实答卷计算，不使用示例数值", { exact: true })
      .count()) !== 6
  )
    throw Error("print captions incomplete");
  const root = await iframe.locator("body").innerHTML();
  fs.writeFileSync("../../docs/evidence/survey-3754/print-report.html", root);
  fs.writeFileSync(
    "../../docs/evidence/survey-3754/charts-result.json",
    JSON.stringify(
      {
        success: true,
        types: blocks.map((b) => b.type),
        scores: m.report.sections[0].blocks.find((b) => b.type === "table")
          .rows,
        word: true,
        pdfPrintFullDocument: true,
      },
      null,
      2,
    ),
  );
  await browser.close();
  console.log("charts, Word and complete print document passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
