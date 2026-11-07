# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: survey-complete-flow.spec.ts >> 5840 三轮列表状态验收：真实创建、筛选、失败恢复与窄屏
- Location: e2e/survey-complete-flow.spec.ts:578:5

# Error details

```
Error: expect(page).toHaveURL(expected) failed

Expected pattern: /\/home$/
Received string:  "http://127.0.0.1:25467/login"
Timeout: 5000ms

Call log:
  - Expect "toHaveURL" with timeout 5000ms
    7 × locator resolved to <html lang="zh-CN" data-edition="cloud">…</html>
      - unexpected value "http://127.0.0.1:25467/login"
    - waiting for "http://127.0.0.1:25467/home" navigation to finish...

```

```yaml
- complementary:
  - img "WorkspaceX"
  - heading "与 AI 一起， 把工作做好。" [level=2]
  - paragraph: 团队协作与知识，汇于一个工作空间。
  - list:
    - listitem: 01 结茧 积累经验与知识
    - listitem: 02 破茧 与 AI 团队协作
    - listitem: 03 展翅 释放每个人的创造力
  - paragraph: © WorkspaceX
- main:
  - heading "登录 WorkspaceX" [level=1]
  - paragraph: 进入你的战略工作空间。
  - text: 工作邮箱
  - textbox "工作邮箱" [disabled]:
    - /placeholder: name@company.com
    - text: fullstack-admin-3v-b915388f-2ca5ec6b9ebd@example.test
  - text: 密码
  - button "忘记密码？"
  - textbox "密码" [disabled]:
    - /placeholder: 至少 12 位
    - text: Fullstack-E2E-admin-458!
  - button "显示密码"
  - button "正在进入…" [disabled]
  - separator
  - text: 其他登录方式 · 即将开放
  - separator
  - button "Google" [disabled]
  - button "飞书" [disabled]
  - button "SSO" [disabled]
  - paragraph:
    - text: 还没有账号？开一个新组织，成为首位管理员 ·
    - button "创建组织"
  - paragraph: 被邀请加入已有组织？请打开管理员发给你的激活链接设置密码，本页无法自行注册加入组织； 链接失效请联系管理员重发。
- alert
```

# Test source

```ts
  263 |  await expect(create).toBeFocused();
  264 |  await page.screenshot({path:testInfo.outputPath('r1-cancel-focus.png'),fullPage:true});
  265 |  await create.press('Enter');await dialog.getByLabel('问卷名称',{exact:true}).press('Escape');
  266 |  await expect(dialog).toHaveCount(0);await expect(create).toBeFocused();
  267 |  await create.press('Enter');await dialog.getByLabel('问卷名称',{exact:true}).fill('R1 成功导航');
  268 |  await dialog.getByRole('radio',{name:/AI 导入创建/}).check();
  269 |  await dialog.getByRole('button',{name:'下一步',exact:true}).click();
  270 |  await expect(page).toHaveURL(/\/studio\/survey\/new\/import\?draft=/);
  271 |  await expect(page.getByLabel('问卷需求')).toBeVisible();
  272 |  await page.screenshot({path:testInfo.outputPath('r1-created-ai-entry.png'),fullPage:true});
  273 | });
  274 | 
  275 | test('R1 问卷体验：读取失败后直接重选同一文件保留原文',async({page},testInfo)=>{
  276 |  test.setTimeout(120000);await loginAsAdmin(page);
  277 |  await page.goto('/studio/survey/new/import?draft='+encodeURIComponent(JSON.stringify({name:'R1 文件重试',tags:[]})));
  278 |  await page.getByLabel('问卷需求').fill('保留手动输入的研究目标');
  279 |  await page.evaluate(()=>{
  280 |    const read=FileReader.prototype.readAsDataURL;let attempts=0;
  281 |    FileReader.prototype.readAsDataURL=function(blob:Blob){
  282 |      attempts++;if(attempts===1){setTimeout(()=>this.dispatchEvent(new ProgressEvent('error')),0);return;}
  283 |      return read.call(this,blob);
  284 |    };
  285 |  });
  286 |  const source=testInfo.outputPath('r1-source.md');await mkdir(dirname(source),{recursive:true});await writeFile(source,'合成研究资料：关注最近一次使用体验。');
  287 |  const select=async()=>{const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'添加文件',exact:true}).click();await(await chooser).setFiles(source);};
  288 |  await select();await expect(page.getByRole('region',{name:'AI 问卷生成'}).getByRole('alert')).toHaveText('文件读取失败，请重新选择。');
  289 |  await page.screenshot({path:testInfo.outputPath('r1-file-read-error.png'),fullPage:true});
  290 |  await select();await expect(page.getByRole('button',{name:'移除文件 r1-source.md',exact:true})).toBeVisible();
  291 |  await expect(page.getByLabel('问卷需求')).toHaveValue('保留手动输入的研究目标');
  292 |  await expect(page.getByRole('region',{name:'AI 问卷生成'}).getByRole('alert')).toHaveCount(0);
  293 |  await page.screenshot({path:testInfo.outputPath('r1-file-reselected.png'),fullPage:true});
  294 | });
  295 | 
  296 | test('R2 问卷体验：自动保存保留标题焦点并可刷新恢复',async({page},testInfo)=>{
  297 |  test.setTimeout(120000);await loginAsAdmin(page);await page.request.get('/studio/survey/ux-route-warmup/design');await page.goto('/studio/survey?tab=modules');
  298 |  const template=page.locator('article').filter({has:page.getByRole('heading',{name:TEMPLATE_TITLE,exact:true})});
  299 |  await template.getByRole('button',{name:'使用并创建问卷'}).click();
  300 |  const title=page.getByRole('textbox',{name:'问卷名称',exact:true});await expect(title).toBeVisible();
  301 |  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  302 |  await page.route('**/surveys/*/source',async route=>{
  303 |    if(route.request().method()!=='PUT'){await route.continue();return;}
  304 |    const response=await route.fetch();await gate;await route.fulfill({response});
  305 |  });
  306 |  try{
  307 |    await title.fill('R2 自动保存后恢复的问卷');await expect(page.getByText('正在自动保存…',{exact:true})).toBeVisible();
  308 |    await expect(title).toBeFocused();await page.screenshot({path:testInfo.outputPath('r2-saving-focus.png'),fullPage:true});
  309 |  }finally{release();}
  310 |  await expect(page.getByText('正在自动保存…',{exact:true})).toHaveCount(0);await expect(title).toBeFocused();
  311 |  await page.unroute('**/surveys/*/source');await page.reload();
  312 |  await expect(page.getByRole('textbox',{name:'问卷名称',exact:true})).toHaveValue('R2 自动保存后恢复的问卷');
  313 |  await page.screenshot({path:testInfo.outputPath('r2-refreshed-title.png'),fullPage:true});
  314 | });
  315 | 
  316 | test('R3 问卷体验：生成失败重试与取消保留原文且未应用提案',async({page},testInfo)=>{
  317 |  test.setTimeout(120000);await loginAsAdmin(page);
  318 |  await page.goto('/studio/survey/new/import?draft='+encodeURIComponent(JSON.stringify({name:'R3 异常恢复',tags:[]})));
  319 |  const input=page.getByLabel('问卷需求');const original='保留原文：了解最近一次会议的改进机会';await input.fill(original);
  320 |  let attempts=0;let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  321 |  let finished!:()=>void;const lateFinished=new Promise<void>(resolve=>{finished=resolve;});
  322 |  await page.route('**/surveys/markdown-proposals',async route=>{
  323 |    attempts++;if(attempts===1){await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'controlled unavailable'})});return;}
  324 |    const delayed=attempts===2;if(delayed)await gate;
  325 |    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({markdown:'# R3 合成提案\n\n## recent [open]\n请描述最近一次体验\n',execution:{id:'85f6e172-8b43-4a75-a917-0e91742d1e8c',provider:'controlled-test',modelId:'synthetic',generatedAt:'2026-09-28T00:00:00.000Z'},source:{kind:'text',sha256:'a'.repeat(64)}})}).catch(()=>{});if(delayed)finished();
  326 |  });
  327 |  const generate=page.getByRole('button',{name:'生成问卷',exact:true});await generate.click();
  328 |  await expect(page.getByRole('region',{name:'AI 问卷生成'}).getByRole('alert')).toContainText('生成失败');await expect(input).toHaveValue(original);
  329 |  await page.screenshot({path:testInfo.outputPath('r3-generation-error.png'),fullPage:true});
  330 |  try{await generate.click();await expect(page.getByRole('button',{name:'正在生成…',exact:true})).toBeDisabled();
  331 |  await expect.poll(()=>attempts).toBe(2);await page.getByRole('button',{name:'取消生成',exact:true}).click();await expect(generate).toBeEnabled();await expect(input).toHaveValue(original);
  332 |  }finally{release();}
  333 |  await lateFinished;await expect(page.getByRole('dialog',{name:'Markdown 预览与校对'})).toHaveCount(0);
  334 |  await generate.click();const preview=page.getByRole('dialog',{name:'Markdown 预览与校对'});await expect(preview).toBeVisible();
  335 |  await expect(page).toHaveURL(/\/new\/import/);await preview.getByRole('button',{name:'返回输入',exact:true}).click();
  336 |  await expect(preview).toHaveCount(0);await expect(input).toHaveValue(original);
  337 |  await page.screenshot({path:testInfo.outputPath('r3-recovered-input.png'),fullPage:true});
  338 | });
  339 | 
  340 | test('R4 问卷体验：长需求在手机平板桌面保持单层输入与键盘工具入口',async({page},testInfo)=>{
  341 |  test.setTimeout(120000);await loginAsAdmin(page);
  342 |  await page.goto('/studio/survey/new/import?draft='+encodeURIComponent(JSON.stringify({name:'R4 长内容',tags:[]})));
  343 |  const text='了解用户最近一次使用体验、主要困难与下一步改进建议。'.repeat(240);
  344 |  const input=page.getByRole('textbox',{name:'问卷需求'});await input.fill(text);
  345 |  for(const width of [375,768,1280]){
  346 |    await page.setViewportSize({width,height:width===375?812:1000});await input.focus();await expect(input).toBeFocused();
  347 |    await expect(input).toHaveValue(text);await expect(input).toHaveCSS('border-top-width','0px');
  348 |    await input.press('Tab');await expect(page.getByRole('button',{name:'添加文件',exact:true})).toBeFocused();
  349 |    const composer=page.getByTestId('survey-intake-composer');
  350 |    for(const label of ['添加文件','语音输入','选择已保存录音'])await expect(composer.getByRole('button',{name:label,exact:true})).toBeVisible();
  351 |    const generate=page.getByRole('button',{name:'生成问卷',exact:true});await expect(generate).toBeEnabled();await generate.scrollIntoViewIfNeeded();
  352 |    expect(await page.locator('body').evaluate(el=>el.scrollWidth)).toBeLessThanOrEqual(width);
  353 |    if(width===375){const action=await generate.boundingBox();const nav=await page.getByRole('navigation',{name:'主导航（移动端）'}).boundingBox();expect(action&&nav&&action.y+action.height<=nav.y).toBeTruthy();}
  354 |    await page.screenshot({path:testInfo.outputPath(`r4-long-input-${width}.png`),fullPage:true});
  355 |  }
  356 | });
  357 | 
  358 | async function loginAsAdmin(page: Page) {
  359 |   await page.goto("/login");
  360 |   await page.getByTestId("login-email").fill(FULLSTACK_E2E.adminEmail);
  361 |   await page.getByTestId("login-password").fill(FULLSTACK_E2E.adminPassword);
  362 |   await page.getByTestId("login-submit").click();
> 363 |   await expect(page).toHaveURL(/\/home$/);
      |                      ^ Error: expect(page).toHaveURL(expected) failed
  364 | }
  365 | 
  366 | function question(page: Page, title: string): Locator {
  367 |   return page.getByRole("group", { name: title });
  368 | }
  369 | 
  370 | async function answerPublishedSurvey(page: Page) {
  371 |   await expect(page.getByRole("heading", { name: TEMPLATE_TITLE })).toBeVisible();
  372 |   await page.getByRole("textbox", { name: "会议名称" }).fill("季度产品复盘会");
  373 |   await page.getByLabel("会议日期").fill("2026-09-21");
  374 | 
  375 |   for (const title of [
  376 |     "会议目标和议程清晰。",
  377 |     "会议内容与我的工作相关。",
  378 |     "参会者有足够机会表达意见。",
  379 |     "会后行动项、负责人和时间明确。",
  380 |   ]) {
  381 |     await question(page, title).getByRole("radio").nth(3).check();
  382 |   }
  383 |   await question(page, "会议时长是否合适？")
  384 |     .getByLabel("合适", { exact: true })
  385 |     .check();
  386 |   await page
  387 |     .getByRole("textbox", { name: "下次会议最值得改进的地方是什么？" })
  388 |     .fill("减少状态同步，预留更多决策时间。");
  389 | 
  390 |   await page.getByRole("button", { name: "提交答卷" }).click();
  391 |   await expect(page.getByRole("status")).toHaveText("提交成功，感谢您的参与。");
  392 | }
  393 | 
  394 | test("用户可从模板完整走通创建、发布、答题、查看答卷和正式报告", async ({
  395 |   page,
  396 |   browser,
  397 | },testInfo) => {
  398 |   test.setTimeout(120_000);
  399 |   await loginAsAdmin(page);
  400 |   await page.setViewportSize({ width: 1586, height: 992 });
  401 | 
  402 |   await page.goto("/studio/survey");
  403 |   await expect(page.getByRole("heading", { name: "问卷", exact: true })).toBeVisible();
  404 |   await expect(page.getByRole("navigation", { name: "问卷二级导航" })).toBeVisible();
  405 |   await page.screenshot({path:testInfo.outputPath("survey-home-desktop.png"),fullPage:true});
  406 |   await page.getByRole("link", { name: "问卷模板", exact: true }).click();
  407 |   await expect(page).toHaveURL(/\/studio\/survey\?tab=modules$/);
  408 |   await page.screenshot({path:testInfo.outputPath("survey-template-library.png"),fullPage:true});
  409 | 
  410 |   const template = page.locator("article").filter({
  411 |     has: page.getByRole("heading", { name: TEMPLATE_TITLE, exact: true }),
  412 |   });
  413 |   await expect(template).toContainText("8 道题目");
  414 |   await template.getByRole("button", { name: "使用并创建问卷" }).click();
  415 |   await expect(page).toHaveURL(/\/studio\/survey\/[0-9a-f-]+\/design$/);
  416 |   const createdSurveyId = new URL(page.url()).pathname.split("/")[3];
  417 | 
  418 |   await expect(page.getByLabel("问卷名称")).toHaveValue(TEMPLATE_TITLE);
  419 |   await expect(page.getByText("题目目录 · 8")).toBeVisible();
  420 |   await expect(page.getByText("1. 会议名称", { exact: true })).toBeVisible();
  421 |   await expect(page.getByText("2. 会议日期", { exact: true })).toBeVisible();
  422 |   await expect(page.getByText("8. 下次会议最值得改进的地方是什么？", { exact: true })).toBeVisible();
  423 |   await page.screenshot({path:testInfo.outputPath("survey-designer-desktop.png"),fullPage:true});
  424 | 
  425 |   await expect(page.getByRole('heading',{name:'AI 智能生成问卷'})).toHaveCount(0);
  426 |   await expect(page.getByLabel('问卷 Markdown',{exact:true})).toHaveCount(0);
  427 | 
  428 |   await expect(page.getByRole('button',{name:'保存修改',exact:true})).toHaveCount(0);
  429 |   await expect(page.getByRole('button',{name:'使用问卷模板',exact:true})).toHaveCount(0);
  430 |   await expect(page.getByText('管理模板库',{exact:true})).toHaveCount(0);
  431 |   await expect(page.getByText('所有修改已保存',{exact:true})).toHaveCount(0);
  432 |   const publishAction=page.locator('header').getByRole('button',{name:'发布回收',exact:true});
  433 |   await expect(publishAction).toBeEnabled();
  434 |   // PAPER primary = hsl(30 6% 12%), converted to rounded sRGB channels.
  435 |   // Becoming enabled can precede Button's color transition completing. Keep
  436 |   // both exact final colors in one observation, using the default assertion budget.
  437 |   await expect.poll(()=>publishAction.evaluate(element=>({background:getComputedStyle(element).backgroundColor,color:getComputedStyle(element).color})))
  438 |     .toEqual({background:'rgb(32, 31, 29)',color:'rgb(255, 255, 255)'});
  439 |   // Check the resting paint after moving away from the newly positioned canvas.
  440 |   await page.getByLabel('问卷名称').hover();
  441 |   await expect(page.locator('[data-survey-inline-edit]').first()).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  442 |   const autosaved=page.waitForResponse(response=>response.url().endsWith('/source')&&response.request().method()==='PUT');
  443 |   await page.getByLabel('问卷名称').fill('会议反馈自动保存');
  444 |   expect((await autosaved).ok()).toBeTruthy();
  445 |   await page.reload();
  446 |   await expect(page.getByLabel('问卷名称')).toHaveValue('会议反馈自动保存');
  447 |   const restored=page.waitForResponse(response=>response.url().endsWith('/source')&&response.request().method()==='PUT');
  448 |   await page.getByLabel('问卷名称').fill(TEMPLATE_TITLE);
  449 |   expect((await restored).ok()).toBeTruthy();
  450 |   await page.getByRole('button',{name:'更多操作'}).click();
  451 |   await page.getByRole('button',{name:'保存为问卷模板',exact:true}).click();
  452 |   const saveTemplateDialog=page.getByRole('dialog',{name:'保存为问卷模板',exact:true});
  453 |   await expect(saveTemplateDialog).toBeVisible();
  454 |   await page.keyboard.press('Escape');
  455 |   await page.getByRole('button',{name:'更多操作'}).click();
  456 | 
  457 |   await page.getByRole("button", { name: "更多操作" }).click();
  458 |   await page.getByRole("button", { name: "设计报告模板（可选）" }).click();
  459 |   await expect(page.getByText("报告章节 · 4")).toBeVisible();
  460 |   await expect(page.getByLabel("报告标题")).toHaveValue("会议反馈调查分析报告");
  461 |   await expect(page.getByRole("button", { name: "预览完整报告" })).toBeVisible();
  462 | 
  463 |   await page.getByRole("button", { name: "2. 发布回收" }).click();
```