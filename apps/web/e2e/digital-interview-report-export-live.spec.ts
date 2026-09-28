import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { interviewMarkdown } from "@repo/contracts";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

/** Real login, Next proxy, interview API and PostgreSQL; no response interception. */
test("Word and print use only the current saved report Markdown revision", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.email);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/u);
  const token = await page.evaluate(() => window.localStorage.getItem("wsx.sessionToken"));
  expect(token).toBeTruthy();
  const headers = { authorization: `Bearer ${token}` };
  const created = await page.request.post("/__fullstack_api/interviews/digital", {
    headers,
    data: { name: `报告导出版本验收 ${randomUUID().slice(0, 8)}`, tags: ["报告"],
      scope: { kind: "none", projectId: null, researchProjectId: null }, requestId: randomUUID() },
  });
  expect(created.status()).toBe(201);
  const { interviewId } = await created.json() as { interviewId: string };
  const path = `/__fullstack_api/interviews/digital/${encodeURIComponent(interviewId)}/markdown`;
  const initial = await page.request.get(path, { headers });
  expect(initial.status()).toBe(200);
  let source = interviewMarkdown.InterviewMarkdownEnvelope.parse(await initial.json());
  const initialized = await page.request.post(`${path}/initialize`, { headers, data: { expectedVersion: source.version } });
  expect(initialized.status()).toBe(201);
  source = interviewMarkdown.InterviewMarkdownEnvelope.parse(await initialized.json());

  const oldBody = "旧版报告独有句子：未验证的采购推断。";
  const currentBody = "当前报告独有句子：先追访真实采购负责人。";
  for (const body of [oldBody, currentBody]) {
    const document = source.documents.find((item) => item.step === "report");
    const saved = await page.request.post(`${path}/report`, {
      headers,
      data: { markdown: `# 采购决策报告\n\n## 核心发现\n${body}`, expectedVersion: source.version, expectedDocumentVersion: document?.version ?? 0 },
    });
    expect(saved.status()).toBe(201);
    source = interviewMarkdown.InterviewMarkdownEnvelope.parse(await saved.json());
  }
  const report = source.documents.find((item) => item.step === "report")!;
  expect(report.version).toBe(2);
  await page.goto(`/itv/${interviewId}/report`);
  await expect(page.getByTestId("itv-source-report-markdown")).toContainText(currentBody);
  await expect(page.locator("#itv-source-report-print")).not.toContainText(oldBody);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "导出 Word" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("采购决策报告.docx");
  const xml = execFileSync("unzip", ["-p", (await download.path())!, "word/document.xml"], { encoding: "utf8" });
  expect(xml).toContain(currentBody);
  expect(xml).not.toContain(oldBody);
  expect(xml).toContain(`文档版本 ${report.version}`);
  expect(xml).toContain(`内容哈希 ${report.contentHash}`);
  expect(xml).toContain("不代表已批准结论");
  expect(xml).toContain("模拟探索");

  await page.evaluate(() => {
    window.print = () => {
      const root = document.getElementById("itv-source-report-print");
      (window as Window & { interviewPrintSnapshot?: string }).interviewPrintSnapshot =
        `${document.body.dataset.printInterviewReport}|${root?.classList.contains("print-interview-report-root")}|${root?.textContent}`;
    };
  });
  await page.getByRole("button", { name: "导出 PDF" }).click();
  const printSnapshot = await page.evaluate(() => (window as Window & { interviewPrintSnapshot?: string }).interviewPrintSnapshot);
  expect(printSnapshot).toContain(`文档版本 ${report.version}`);
  expect(printSnapshot).toContain(currentBody);
  expect(printSnapshot).not.toContain(oldBody);
  expect(printSnapshot).toContain("不代表真实用户证据");
  expect(printSnapshot).toContain("不代表已批准结论");
  expect(printSnapshot).toMatch(/^true\|true\|/u);
  const pdf = await page.pdf({ printBackground: true });
  expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
});
