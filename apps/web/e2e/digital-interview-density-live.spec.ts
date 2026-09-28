import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { interviewMarkdown } from "@repo/contracts";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

/** No page.route: Chromium, Next proxy, Nest and PostgreSQL must all participate. */
test("six populated interviews and a long Markdown report survive a real API/DB browser reload", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.email);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/u);
  const token = await page.evaluate(() => window.localStorage.getItem("wsx.sessionToken"));
  expect(token).toBeTruthy();
  const headers = { authorization: `Bearer ${token}` };
  const prefix = `密度验收 ${randomUUID().slice(0, 8)}`;
  const interviewIds: string[] = [];

  for (let index = 0; index < 6; index += 1) {
    const response = await page.request.post("/__fullstack_api/interviews/digital", {
      headers,
      data: { name: `${prefix} ${index + 1}`, tags: ["采购", "决策链路"],
        scope: { kind: "none", projectId: null, researchProjectId: null }, requestId: randomUUID() },
    });
    expect(response.status(), `create interview ${index + 1} through the live controller`).toBe(201);
    const created = await response.json() as { interviewId: string };
    interviewIds.push(created.interviewId);
  }

  const interviewId = interviewIds[0]!;
  const path = `/__fullstack_api/interviews/digital/${encodeURIComponent(interviewId)}/markdown`;
  const first = await page.request.get(path, { headers });
  expect(first.status()).toBe(200);
  let source = interviewMarkdown.InterviewMarkdownEnvelope.parse(await first.json());
  expect(source.documents).toHaveLength(0);
  const initialized = await page.request.post(`${path}/initialize`, { headers, data: { expectedVersion: source.version } });
  expect(initialized.status()).toBe(201);
  source = interviewMarkdown.InterviewMarkdownEnvelope.parse(await initialized.json());

  const documents = [
    { step: "intake", markdown: `# ${prefix}\n\n## 研究目标\n核对采购中的最终否决权。` },
    { step: "analysis", markdown: "# 采购决策分析\n\n## 研究目标\n核对否决权。\n\n## 目标人群\n采购与财务。\n\n## 研究范围\n预算及审批。\n\n## 成功标准\n三条可验证路径。" },
    { step: "experts", markdown: "# 专家选择\n\n## [采购专家](#expert-density_purchase)\n\n采购流程。\n\n## [财务专家](#expert-density_finance)\n\n预算复核。" },
    { step: "outline", markdown: "# 访谈问题\n\n## [采购专家](#expert-density_purchase)\n\n1. 谁能否决采购？\n2. 如何记录退回？\n\n## [财务专家](#expert-density_finance)\n\n1. 谁复核预算？" },
    { step: "report", markdown: "# 采购决策研究报告\n\n## 执行摘要\n模拟观点须由真人访谈验证。\n\n## 研究背景与方法\n采购、财务与业务部门分别提出审批要求。\n\n## 访谈对象\n两位模拟专家，不代表真实参与者。\n\n## 核心发现\n尚未确认最终否决权。\n\n## 关键引述\n> 需核对审批记录。\n\n## 建议行动\n追访真实采购负责人。\n\n## 附录：原始洞察摘要\n仅保留模拟研究上下文。" },
  ] as const;
  for (const { step, markdown } of documents) {
    const existing = source.documents.find((document) => document.step === step);
    const response = await page.request.post(`${path}/${step}`, {
      headers, data: { markdown, expectedVersion: source.version, expectedDocumentVersion: existing?.version ?? 0 },
    });
    expect(response.status(), `persist ${step} Markdown in PostgreSQL`).toBe(201);
    source = interviewMarkdown.InterviewMarkdownEnvelope.parse(await response.json());
    expect(source.documents.find((document) => document.step === step)?.markdown).toBe(markdown);
  }

  await page.goto("/itv?tab=history");
  await expect(page.getByTestId("shell-rail")).toBeVisible();
  for (const id of interviewIds) await expect(page.getByTestId(`itv-history-card-${id}`)).toBeVisible();
  await page.goto(`/itv/${interviewId}/report`);
  await expect(page.getByTestId("itv-source-report-markdown")).toContainText("模拟观点须由真人访谈验证");
  await expect(page.getByRole("navigation", { name: "报告目录" }).getByRole("link")).toHaveCount(8);
  await page.reload();
  await expect(page.getByTestId("itv-source-report-markdown")).toContainText("追访真实采购负责人");
  const reloaded = await page.request.get(path, { headers });
  expect(reloaded.status()).toBe(200);
  const saved = interviewMarkdown.InterviewMarkdownEnvelope.parse(await reloaded.json());
  expect(saved.version).toBe(source.version);
  for (const { step, markdown } of documents) expect(saved.documents.find((document) => document.step === step)?.markdown).toBe(markdown);
});
