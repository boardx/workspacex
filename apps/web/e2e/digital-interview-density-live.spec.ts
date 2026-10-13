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
  await expect(page).toHaveURL(/\/home$/u);
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
  await expect(page.getByTestId("itv-report-details")).toHaveCount(0); // testid-gate: absent duplicate report details intentionally removed; assert they stay absent
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

/** Read/observe only after real fixture saves; never trigger a generation command. */
test("interview workflow actions share footer placement and remain usable at 375 768 and 1280", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const forbidden: string[] = [];
  page.on('request', request => { if(request.method()==='POST' && /\/(?:generate|execute|report-files)(?:\/|$)/u.test(new URL(request.url()).pathname)) forbidden.push(new URL(request.url()).pathname); });
  await page.goto('/login');
  await page.getByTestId('login-email').fill(FULLSTACK_E2E.email);
  await page.getByTestId('login-password').fill(FULLSTACK_E2E.password);
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/home$/u);
  const token=await page.evaluate(()=>localStorage.getItem('wsx.sessionToken'));
  const headers={authorization:`Bearer ${token}`};
  const create=await page.request.post('/__fullstack_api/interviews/digital',{headers,data:{name:`操作栏验收 ${randomUUID().slice(0,8)}`,tags:[],scope:{kind:'none',projectId:null,researchProjectId:null},requestId:randomUUID()}});
  expect(create.status()).toBe(201);
  const {interviewId}=await create.json();
  const path=`/__fullstack_api/interviews/digital/${interviewId}/markdown`;
  let source=interviewMarkdown.InterviewMarkdownEnvelope.parse(await(await page.request.get(path,{headers})).json());
  source=interviewMarkdown.InterviewMarkdownEnvelope.parse(await(await page.request.post(`${path}/initialize`,{headers,data:{expectedVersion:source.version}})).json());
  for(const [step,markdown] of [
    ['intake','# 研究需求\n\n核对采购授权与预算。'],
    ['analysis','# 分析\n\n## 目标\n核对角色与预算。'],
    ['experts','# 专家\n\n## [模拟采购专家](#expert-virtual-style-5671)\n\n仅模拟角色，不代表真人证据。'],
    ['outline','# 问题\n\n## [模拟采购专家](#expert-virtual-style-5671)\n\n1. 谁负责预算？'],
    ['report','# 研究报告\n\n## 核心发现\n- 模拟观点，需真人验证。\n\n## 下一步\n追访真实采购负责人。'],
  ] as const){
    const existing=source.documents.find(doc=>doc.step===step);
    const save=await page.request.post(`${path}/${step}`,{headers,data:{markdown,expectedVersion:source.version,expectedDocumentVersion:existing?.version??0}});
    expect(save.status()).toBe(201);source=interviewMarkdown.InterviewMarkdownEnvelope.parse(await save.json());
  }
  await page.addInitScript(()=>{
    const snapshots:Array<{label:string;disabled:boolean}>=[];
    Object.assign(window,{__itvActionBusySnapshots:snapshots});
    new MutationObserver(()=>{
      for(const node of document.querySelectorAll<HTMLButtonElement>('[data-testid="itv-step-actions"] button[aria-busy="true"]'))
        snapshots.push({label:node.textContent??'',disabled:node.disabled});
    }).observe(document,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-busy']});
  });
  const samples=[];
  for(const width of [375,768,1280]){
    await page.setViewportSize({width,height:900});
    for(const step of ['intake','analysis','experts','outline','runs','report']){
      await page.goto(`/itv/${interviewId}/${step}`);
      const bar=page.locator('[data-testid="itv-step-actions"][data-workflow-action-bar="footer"]');
      await expect(bar).toHaveCount(1);
      await expect(bar.locator('[data-workflow-action-bar]')).toHaveCount(0);
      await expect(page.getByTestId('itv-return-history')).toBeEnabled();
      await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      const expectedHeight=await page.getByTestId('itv-return-history').evaluate(button=>Math.round(button.getBoundingClientRect().height));
      await expect.poll(()=>bar.locator('button').evaluateAll((buttons,height)=>buttons.every(button=>Math.round(button.getBoundingClientRect().height)===height),expectedHeight)).toBe(true);
      expect(await bar.evaluate(node=>node.previousElementSibling!==null)).toBe(true);
      const buttons=await bar.locator('button').evaluateAll(nodes=>nodes.map(node=>({label:node.textContent,height:node.getBoundingClientRect().height,background:getComputedStyle(node).backgroundColor,color:getComputedStyle(node).color,disabled:node.matches(':disabled')})));
      samples.push({width,step,buttons});
      if(step==='runs')await expect(bar.getByRole('button',{name:'生成报告',exact:true})).toBeDisabled();
      if(step==='report'){await expect(bar.getByRole('button',{name:'生成 PDF'})).toBeEnabled();await expect(bar.getByRole('button',{name:'生成 Word'})).toBeEnabled();}
      await bar.scrollIntoViewIfNeeded();
      if(width===375||width===1280)await page.screenshot({path:testInfo.outputPath(`itv-${step}-${width}.png`),fullPage:true});
    }
  }
  // Throttle real transport (no route/response mocking) to observe a real PG save in flight.
  await page.goto(`/itv/${interviewId}/outline`);
  const save=page.getByRole('button',{name:'保存问题草稿',exact:true});
  await expect(save).toBeEnabled();
  await page.getByRole('textbox',{name:'编辑问题 1',exact:true}).first().fill('谁负责修改后的预算？');
  const network=await page.context().newCDPSession(page);
  await network.send('Network.enable');
  try {
    await network.send('Network.emulateNetworkConditions',{offline:false,latency:1500,downloadThroughput:-1,uploadThroughput:-1});
    await save.click();
    await expect(save).toHaveAttribute('aria-busy','true');
    const footer=page.getByTestId('itv-step-actions');
    await expect(footer.locator('[aria-busy="true"]')).toHaveCount(1);
    await expect(footer.locator('.animate-spin')).toHaveCount(1);
    for(const name of ['生成访谈问题','确认问题并开始访谈']) {
      const other=footer.getByRole('button',{name,exact:true});
      await expect(other).toBeDisabled();await expect(other).not.toHaveAttribute('aria-busy','true');
    }
    await page.screenshot({path:testInfo.outputPath('itv-outline-save-pending.png'),fullPage:true});
    await expect(save).not.toHaveAttribute('aria-busy','true');
    await expect(save).toBeEnabled();
  } finally {
    await network.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
    await network.detach();
  }
  await page.getByTestId('itv-workbench-step-intake').click();
  await expect(page).toHaveURL(new RegExp(`/itv/${interviewId}/intake$`));
  await page.getByTestId('itv-return-history').click();await expect(page).toHaveURL(/\/itv\?tab=history$/u);
  const finalSource=interviewMarkdown.InterviewMarkdownEnvelope.parse(await(await page.request.get(path,{headers})).json());expect(finalSource.version).toBe(source.version+1);expect(finalSource.documents.find(doc=>doc.step==='outline')?.markdown).toContain('谁负责修改后的预算？');
  expect(forbidden).toEqual([]);
  await testInfo.attach('workflow-action-styles',{body:JSON.stringify(samples,null,2),contentType:'application/json'});
});
