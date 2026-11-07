import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { interviewMarkdown } from "@repo/contracts";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

/** Real login, Next proxy, interview API and PostgreSQL; no response interception. */
test("Skill file controls use the current saved canonical source and reject an outdated request", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.email);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/home$/u);
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

  // This standard lane proves real login/API/DB source and stale-request guards.
  // Actual registered Skill execution and PDF/Word files are verified in the native lane.
  for (const label of ["PDF", "Word"]) await expect(page.getByRole("button", { name: `生成 ${label}` })).toBeEnabled();
  await expect(page.getByRole("button", { name: "生成 PPT" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "下载 PPT" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "导出 Word" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "导出 PDF" })).toHaveCount(0);
  const bound = await page.request.get(`/__fullstack_api/report-files/sources/interview/${encodeURIComponent(interviewId)}`, { headers });
  expect(bound.status()).toBe(200);
  const metadata = await bound.json();
  expect(metadata).toMatchObject({ kind: "interview", id: interviewId, reportVersion: report.version, reportHash: report.contentHash });
  expect(metadata.notices.join(" ")).toContain("未批准");
  expect(metadata.notices.join(" ")).toContain("模拟");
  const oldMarkdown = `# 采购决策报告\n\n## 核心发现\n${oldBody}`;
  const stale = await page.request.post("/__fullstack_api/report-files", { headers, data: {
    source: { kind: "interview", id: interviewId, reportVersion: report.version - 1, reportHash: createHash("sha256").update(oldMarkdown).digest("hex") },
    format: "docx", requestId: randomUUID(),
  } });
  expect(stale.status()).toBe(409);
  expect(await stale.text()).toContain("REPORT_CHANGED");
  await expect(page.getByTestId("itv-source-report-markdown")).toContainText(currentBody);
});

/** Controlled completed-job responses test browser filename/byte delivery, not native generation. */
test('browser downloads use the canonical Chinese title for PDF and Word',async({page})=>{
 const {createRequire}=await import('node:module');const {resolve}=await import('node:path');
 const requireApi=createRequire(resolve(process.cwd(),'../api/package.json'));
 const {PDFDocument,StandardFonts}=requireApi('pdf-lib');const {Document,Packer,Paragraph}=requireApi('docx');
 await page.goto('/login');await page.getByTestId('login-email').fill(FULLSTACK_E2E.email);await page.getByTestId('login-password').fill(FULLSTACK_E2E.password);await page.getByTestId('login-submit').click();await expect(page).toHaveURL(/\/home$/u);
 const token=await page.evaluate(()=>localStorage.getItem('wsx.sessionToken'));const headers={authorization:`Bearer ${token}`};
 const created=await page.request.post('/__fullstack_api/interviews/digital',{headers,data:{name:'导出命名验收',tags:[],scope:{kind:'none',projectId:null,researchProjectId:null},requestId:randomUUID()}});expect(created.ok()).toBe(true);
 const {interviewId}=await created.json();const path=`/__fullstack_api/interviews/digital/${interviewId}/markdown`;
 let envelope=await(await page.request.get(path,{headers})).json();envelope=await(await page.request.post(`${path}/initialize`,{headers,data:{expectedVersion:envelope.version}})).json();
 const title='系统韧性与体验优化研究报告';
 const saved=await page.request.post(`${path}/report`,{headers,data:{markdown:`# ${title}\n\n报告本身的模拟材料说明保持不变。`,expectedVersion:envelope.version,expectedDocumentVersion:0}});expect(saved.ok()).toBe(true);
 const document=(await saved.json()).documents.find((d:{step:string})=>d.step==='report');
 const source={kind:'interview',id:interviewId,reportVersion:document.version,reportHash:document.contentHash};
 const pdf=await PDFDocument.create();const font=await pdf.embedFont(StandardFonts.Helvetica);pdf.addPage().drawText('Filename delivery fixture',{font,size:12});
 const binaries={pdf:Buffer.from(await pdf.save()),docx:Buffer.from(await Packer.toBuffer(new Document({sections:[{children:[new Paragraph(title),new Paragraph('报告本身的模拟材料说明保持不变。')]}]})))};
 const jobs=Object.fromEntries((['pdf','docx'] as const).map(format=>[format,{id:randomUUID(),source,format,createdAt:new Date().toISOString(),status:'succeeded',skill:{stableName:format==='pdf'?'pdf-create':'docx-create',versionId:'controlled-browser-job',digest:'a'.repeat(64)},file:{filename:`${title}.${format}`,mediaType:format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',sizeBytes:binaries[format].length,sha256:createHash('sha256').update(binaries[format]).digest('hex')}}]));
 await page.route('**/report-files',async route=>{const format=route.request().postDataJSON().format as 'pdf'|'docx';await route.fulfill({status:201,contentType:'application/json',body:JSON.stringify(jobs[format])});});
 for(const format of ['pdf','docx'] as const){
  const job=jobs[format]!;
  await page.route(`**/report-files/${job.id}`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(job)}));
  await page.route(`**/report-files/${job.id}/download`,route=>route.fulfill({status:200,contentType:job.file.mediaType,body:binaries[format],headers:{'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(job.file.filename)}`}}));
 }
 await page.goto(`/itv/${interviewId}/report`);
 for(const [format,label] of [['pdf','PDF'],['docx','Word']] as const){
  const event=page.waitForEvent('download');await page.getByRole('button',{name:`生成 ${label}`,exact:true}).click();const downloaded=await event;
  expect(downloaded.suggestedFilename()).toBe(`${title}.${format}`);
  const {readFile}=await import('node:fs/promises');expect(createHash('sha256').update(await readFile((await downloaded.path())!)).digest('hex')).toBe(jobs[format]!.file.sha256);
 }
});
