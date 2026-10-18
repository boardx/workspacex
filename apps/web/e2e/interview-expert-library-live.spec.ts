import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
interface InterviewUxAuditClient { query(sql: string, params: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }> }
async function modelActivity() {
 if (!process.env.WORKSPACEX_ISOLATION_ID || !process.env.WORKSPACEX_DB?.startsWith('wsx_')) throw new Error('owned isolated database required');
 const { PgDatabase } = createRequire(resolve(process.cwd(), '../api/package.json'))('./src/infrastructure/db/pg-database.ts');
 const config = JSON.parse(execFileSync(process.execPath, ['--import','tsx','--input-type=module','-e',"import {appConfig} from '../api/src/infrastructure/db/pg-config.ts'; process.stdout.write(JSON.stringify(appConfig()));"], {cwd:process.cwd(),encoding:'utf8'}));
 const db = new PgDatabase(config);
 try { return (await db.withTenant(FULLSTACK_E2E.orgId,(client:InterviewUxAuditClient)=>client.query('SELECT (SELECT count(*) FROM agent_runs WHERE org_id=$1)::int AS runs,(SELECT count(*) FROM model_request_starts WHERE org_id=$1)::int AS requests',[FULLSTACK_E2E.orgId]))).rows[0]; }
 finally { await db.close(); }
}
import { expect,test } from '@playwright/test';
import { FULLSTACK_E2E } from './fullstack-smoke-fixture';
import { INTERVIEW_PERSONAS,personaAnchorId } from '../lib/interview-personas/persona-library';
/** Real authenticated routes/PG, no route interception or model calls. */
test('built-in experts and private custom experts persist and can be selected into a saved interview',async({page},testInfo)=>{
 test.setTimeout(120_000);
 await page.goto('/login');await page.getByTestId('login-email').fill(FULLSTACK_E2E.email);await page.getByTestId('login-password').fill(FULLSTACK_E2E.password);await page.getByTestId('login-submit').click();await expect(page).toHaveURL(/\/home$/u);
 const token=await page.evaluate(()=>localStorage.getItem('wsx.sessionToken'));const headers={authorization:`Bearer ${token}`};
 for(const width of [375,768,1280]){
  await page.setViewportSize({width,height:900});await page.goto('/itv');
  const create=page.getByTestId('itv-create');await expect(create).toBeEnabled();
  await expect(page.getByTestId('itv-create-card')).toHaveCount(0);
  expect(await create.evaluate(el=>el.getBoundingClientRect().height)).toBe(36);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath(`history-compact-${width}.png`)});
  await create.click();const creation=page.getByRole('dialog',{name:'新建访谈',exact:true});
  await expect(creation.getByLabel('访谈名称',{exact:true})).toBeFocused();
  await page.keyboard.press('Tab');await expect(creation.getByLabel('添加标签',{exact:true})).toBeFocused();
  const primary=creation.getByRole('button',{name:'开始访谈',exact:true});
  expect(await primary.evaluate(el=>el.getBoundingClientRect().height)).toBe(36);
  const primarySize=await primary.evaluate(el=>({width:el.getBoundingClientRect().width,available:el.closest('[data-workflow-action-bar="footer"]')!.clientWidth}));
  expect(primarySize.width).toBeGreaterThanOrEqual(112);
  if(width<768)expect(primarySize.width).toBe(primarySize.available);
  else expect(primarySize.width).toBeLessThan(primarySize.available);
  expect(await creation.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath(`create-compact-${width}.png`)});
  await page.keyboard.press('Escape');await expect(creation).not.toBeVisible();await expect(create).toBeFocused();
 }
 await page.goto('/itv?tab=experts');
 const builtin=INTERVIEW_PERSONAS[0]!;await expect(page.getByTestId(`itv-library-${personaAnchorId(builtin)}`)).toBeVisible();
 await page.getByTestId(`itv-library-${personaAnchorId(builtin)}`).getByRole('button',{name:`查看画像 ${builtin.name}`,exact:true}).click();
 const builtInDialog=page.getByRole('dialog',{name:builtin.name,exact:true});
 for(const value of [builtin.personality.locations,String(builtin.personality.age),builtin.personality.occupation,...builtin.goals,...builtin.interests,...builtin.pain_points,...builtin.motivations,...builtin.influences,builtin.service_value,builtin.typical_advice])await expect(builtInDialog).toContainText(value);
 await expect(builtInDialog).not.toContainText('局限与材料边界');await expect(builtInDialog).not.toContainText('背景与建议未经独立验证');
 for(const width of [375,768,1280]){await page.setViewportSize({width,height:900});expect(await builtInDialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);const box=await builtInDialog.boundingBox();expect(box).not.toBeNull();if(width===1280)expect(box!.width).toBeGreaterThanOrEqual(700);else expect(box!.width).toBeLessThanOrEqual(width-24);await builtInDialog.getByText(builtin.typical_advice,{exact:true}).scrollIntoViewIfNeeded();await expect(builtInDialog.getByText(builtin.typical_advice,{exact:true})).toBeVisible();await page.screenshot({path:testInfo.outputPath(`builtin-full-${width}.png`)});}
 await builtInDialog.getByRole('button',{name:'关闭',exact:true}).click();await expect(builtInDialog).not.toBeVisible();await expect(page.getByTestId(`itv-library-${personaAnchorId(builtin)}`).getByRole('button',{name:`查看画像 ${builtin.name}`,exact:true})).toBeFocused();
 const name=builtin.name;
 await page.getByTestId('itv-add-library-expert').click();const dialog=page.getByRole('dialog',{name:'添加专家画像'});
 for(const width of [375,768,1280]){await page.setViewportSize({width,height:900});const box=await dialog.boundingBox();expect(box).not.toBeNull();if(width===1280)expect(box!.width).toBeGreaterThanOrEqual(700);else expect(box!.width).toBeLessThanOrEqual(width-24);expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await dialog.getByRole('button',{name:'保存专家',exact:true}).scrollIntoViewIfNeeded();await expect(dialog.getByRole('button',{name:'保存专家',exact:true})).toBeVisible();if(width===375){await dialog.getByRole('button',{name:'保存专家',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('请填写完整');await page.screenshot({path:testInfo.outputPath('expert-form-validation-error-375.png')});}await dialog.getByRole('heading',{name:'添加专家画像',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath(`add-expert-${width}.png`)});}
 for(const [label,value] of Object.entries({'名称':name,'专业角色':'采购决策顾问','专业领域':'采购','研究关注':'预算和决策责任','观点风格':'通过反例验证','能力简介':`自建验收 ${randomUUID()}`}))await dialog.getByLabel(label,{exact:true}).fill(value);
 const fullProfile={'分类':'技术','所在地':'深圳','年龄':'42','职业':'研究员','目标':'理解需求\n验证假设','兴趣':'设计','痛点':'资料不足','动机':'改进体验','影响因素':'同行','内向—外向':'3','分析—创造':'7','忙碌—时间充裕':'5','服务价值':'检验假设','典型建议':'先验证问题'};
 for(const [label,value] of Object.entries(fullProfile))await dialog.getByLabel(label,{exact:true}).fill(value);
 await page.screenshot({path:testInfo.outputPath('custom-full-form.png')});
 await dialog.getByRole('button',{name:'保存专家',exact:true}).click();await expect(dialog).not.toBeVisible();
 const listed=await page.request.get('/__fullstack_api/interviews/digital/expert-library',{headers});expect(listed.status()).toBe(200);const result=await listed.json();const custom=result.items.find((item:{fields:{name:string}})=>item.fields.name===name);expect(custom).toBeTruthy();expect(custom.expertId).toMatch(/^custom-expert-/u);expect(custom.fields.profile).toEqual({category:'技术',location:'深圳',age:42,occupation:'研究员',goals:['理解需求','验证假设'],interests:['设计'],painPoints:['资料不足'],motivations:['改进体验'],influences:['同行'],personalityTraits:{introvertExtrovert:3,analyticalCreative:7,busyTimeRich:5},serviceValue:'检验假设',typicalAdvice:'先验证问题'});
 await page.reload();await expect(page.getByTestId(`itv-library-${custom.expertId}`)).toContainText('我的模拟画像');await expect(page.getByTestId(`itv-library-${personaAnchorId(builtin)}`)).toContainText('内置模拟画像');
 await page.getByTestId(`itv-library-${custom.expertId}`).getByRole('button',{name:`查看画像 ${name}`,exact:true}).click();
 const details=page.getByRole('dialog',{name,exact:true});for(const value of Object.values(fullProfile))for(const line of value.split('\n'))await expect(details).toContainText(line);
 await expect(details).not.toContainText('局限与材料边界');await expect(details).not.toContainText(custom.fields.limits);await details.getByText(fullProfile['典型建议'],{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath('custom-full-reloaded.png')});await page.keyboard.press('Escape');await expect(details).not.toBeVisible();await expect(page.getByTestId(`itv-library-${custom.expertId}`).getByRole('button',{name:`查看画像 ${name}`,exact:true})).toBeFocused();
 const legacyName=`旧版画像-${randomUUID()}`;const legacyResponse=await page.request.post('/__fullstack_api/interviews/digital/expert-library',{headers,data:{fields:{name:legacyName,role:'旧版顾问',domains:'研究',focus:'原有关注',style:'原有风格',bio:'原有简介',limits:'仅模拟'},requestId:randomUUID()}});expect(legacyResponse.status()).toBe(201);const legacy=await legacyResponse.json();
 await page.reload();await page.getByTestId(`itv-library-${legacy.expertId}`).getByRole('button',{name:`查看画像 ${legacyName}`,exact:true}).click();const legacyDialog=page.getByRole('dialog',{name:legacyName,exact:true});await expect(legacyDialog).toContainText('原有关注');await expect(legacyDialog).toContainText('原有风格');await expect(legacyDialog).toContainText('未填写');await legacyDialog.getByRole('button',{name:'关闭',exact:true}).click();
 const created=await page.request.post('/__fullstack_api/interviews/digital',{headers,data:{name:'专家库选用验收',tags:[],scope:{kind:'none',projectId:null,researchProjectId:null},requestId:randomUUID()}});expect(created.status()).toBe(201);const {interviewId}=await created.json();const path=`/__fullstack_api/interviews/digital/${interviewId}/markdown`;
 let source=await (await page.request.get(path,{headers})).json();source=await(await page.request.post(`${path}/initialize`,{headers,data:{expectedVersion:source.version}})).json();
 const saved=await page.request.post(`${path}/experts`,{headers,data:{markdown:'# 专家\n',expectedVersion:source.version,expectedDocumentVersion:0}});expect(saved.status()).toBe(201);
 await page.goto(`/itv/${interviewId}/experts`);await page.getByTestId(`itv-library-${custom.expertId}`).getByRole('button',{name:`添加画像 ${name}`,exact:true}).click();
 await expect.poll(async()=>{const current=await(await page.request.get(path,{headers})).json();return current.documents.find((doc:{step:string})=>doc.step==='experts')?.markdown??'';}).toContain(`#expert-${custom.expertId}`);
 await page.reload();const current=await(await page.request.get(path,{headers})).json();const markdown=current.documents.find((doc:{step:string})=>doc.step==='experts').markdown;expect(markdown).toContain('采购决策顾问');for(const value of Object.values(fullProfile))expect(markdown).toContain(value);expect(markdown).toContain('不作为真人访谈证据');
 const reportResponse=await page.request.post(`${path}/report`,{headers,data:{markdown:'# 紧凑报告界面验收\n\n模拟研究资料，需真人验证。',expectedVersion:current.version,expectedDocumentVersion:0}});expect(reportResponse.status()).toBe(201);
 for(const width of [375,768,1280]){
  await page.setViewportSize({width,height:900});await page.goto(`/itv/${interviewId}/report`);
  const footer=page.locator('[data-workflow-action-bar="footer"]');await expect(footer).toHaveCount(1);
  const nested=footer.getByTestId('report-file-actions');await expect(nested).toBeVisible();
  for(const label of ['生成 PDF','生成 Word','分享报告']){const action=footer.getByRole('button',{name:label,exact:true});await expect(action).toBeEnabled();expect(await action.evaluate(el=>el.getBoundingClientRect().height)).toBe(36);expect(await action.evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(96);}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await footer.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await footer.scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath(`report-nested-actions-${width}.png`),fullPage:true});
 }
});

/** Final production check for creation/editing/recovery, followed by R4 multi-viewport walk. No model command. */
test('four rounds of interview interaction with isolated saved data', async({page},testInfo)=>{
 test.setTimeout(180_000);
 const fs=await import('node:fs/promises');
 const dir=process.env.ITV_UX_EVIDENCE ?? testInfo.outputPath('four-rounds');await fs.mkdir(dir,{recursive:true});
 const modelBefore = await modelActivity(); const modelCommands: string[] = [];
 page.on('request',request=>{if(request.method()==='POST' && /runtime\/commands|report-files|\/(?:generate|execute)(?:\/|$)/u.test(new URL(request.url()).pathname)) modelCommands.push(new URL(request.url()).pathname);});
 const checkpoint=async(name:string,data:unknown)=>{await page.screenshot({path:`${dir}/${name}.png`,fullPage:true});await fs.writeFile(`${dir}/${name}.json`,JSON.stringify(data,null,2));console.log(`UX_CHECKPOINT ${name}`);};
 await page.goto('/login');await page.getByTestId('login-email').fill(FULLSTACK_E2E.email);await page.getByTestId('login-password').fill(FULLSTACK_E2E.password);await page.getByTestId('login-submit').click();await expect(page).toHaveURL(/\/home$/u);
 const token=await page.evaluate(()=>localStorage.getItem('wsx.sessionToken'));const headers={authorization:`Bearer ${token}`};
 // R1: keyboard entry and actual creation; no generation command.
 await page.goto('/itv');await page.getByTestId('itv-create').click();
 const name=page.getByLabel('访谈名称',{exact:true});await expect(name).toBeFocused();
 expect(await name.evaluate((el:HTMLInputElement)=>el.value.slice(el.selectionStart??0,el.selectionEnd??0))).toBe('未命名访谈');
 await page.keyboard.type('UX four rounds');await expect(name).toHaveValue('UX four rounds');
 await checkpoint('r1-after',{defaultSelected:true});await page.getByTestId('itv-create-submit').click();await expect(page).toHaveURL(/\/itv\/[^/]+\/intake/u);
 const interviewId=new URL(page.url()).pathname.split('/')[2]!;const path=`/__fullstack_api/interviews/digital/${interviewId}/markdown`;
 const save=async(step:string,markdown:string)=>{const current=await(await page.request.get(path,{headers})).json();const result=await page.request.post(`${path}/${step}`,{headers,data:{markdown,expectedVersion:current.version,expectedDocumentVersion:current.documents.find((d:{step:string})=>d.step===step)?.version??0}});expect(result.ok()).toBe(true);return result.json();};
 // R2: saved expert/question drafts and keyboard continuation after adding a question.
 await save('experts','# 专家\n\n## [合成顾问](#expert-ux-synthetic)\n\n### 专业角色\n采购顾问\n\n模拟画像，不作为真人证据。\n');
 await save('outline','# 访谈问题\n\n## [合成顾问](#expert-ux-synthetic)\n\n1. 请介绍最近一次采购决策？\n');
 await page.goto(`/itv/${interviewId}/outline`);await page.getByRole('button',{name:'添加问题',exact:true}).click();
 const added=page.getByRole('textbox',{name:'编辑问题 2',exact:true});await expect(added).toBeFocused();await added.fill('谁拥有预算批准权？');
 await page.getByRole('button',{name:'保存问题草稿',exact:true}).click();await expect(page.getByRole('button',{name:'保存问题草稿',exact:true})).toBeEnabled();await page.reload();await expect(page.getByRole('textbox',{name:'编辑问题 2',exact:true})).toHaveValue('谁拥有预算批准权？');await expect(page.getByRole('button',{name:'保存问题草稿',exact:true})).toBeEnabled();await checkpoint('r2-after',{savedAndReloaded:true});
 // R3: explicitly controlled unavailable HTTP response at create boundary, never a provider success.
 await page.goto('/itv');await page.getByTestId('itv-create').click();await name.fill('受控恢复验收');
 let failed=true;const attempts:string[]=[];await page.route('**/__fullstack_api/interviews/digital',async route=>{if(route.request().method()!=='POST'){await route.continue();return;}attempts.push(route.request().postDataJSON().requestId);if(failed){await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({reasonCode:'DEPENDENCY_UNAVAILABLE',message:'DEPENDENCY_UNAVAILABLE'})});}else await route.continue();});
 await page.getByTestId('itv-create-submit').click();await expect(page.getByRole('alert')).toContainText('服务暂时不可用');await expect(page.getByRole('alert')).not.toContainText('DEPENDENCY_UNAVAILABLE');await expect(name).toHaveValue('受控恢复验收');await expect(page.getByTestId('itv-create-submit')).toBeEnabled();await checkpoint('r3-after-error',{controlled503:true,preserved:true});
 failed=false;await page.getByTestId('itv-create-submit').click();await expect(page).toHaveURL(/\/itv\/[^/]+\/intake/u);expect(attempts).toHaveLength(2);expect(attempts[0]).toBe(attempts[1]);await page.unroute('**/__fullstack_api/interviews/digital');await checkpoint('r3-after-retry',{realApiCreated:true,sameRequestId:true});
 // R4: long saved content, experts/details and report file entry across three widths. No model dispatch.
 let long='请详细介绍在不同预算审批和跨部门协作条件下，最近一次采购决策的参与人、争议、证据以及最终取舍？'.repeat(5);
 await save('outline',`# 访谈问题\n\n## [合成顾问](#expert-ux-synthetic)\n\n1. ${long}\n\n2. 谁拥有预算批准权？\n`);
 await save('report',`# 合成验收报告\n\n模拟材料，需真人验证。\n\n## 核心发现\n${'采购责任需要与预算授权共同核验。'.repeat(40)}\n\n|事项|行动|\n|---|---|\n|采购|核验授权|`);
 for(const width of [375,768,1280]){
  await page.setViewportSize({width,height:900});await page.goto(`/itv/${interviewId}/outline`);const longQuestion=page.getByRole('textbox',{name:'编辑问题 1',exact:true});await expect(longQuestion).toHaveValue(long);await expect(page.getByRole('button',{name:'保存问题草稿',exact:true})).toBeEnabled();
  const geometry=await longQuestion.evaluate(el=>({height:el.getBoundingClientRect().height,width:el.getBoundingClientRect().width,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,whiteSpace:getComputedStyle(el).whiteSpace}));expect(geometry.height).toBeGreaterThan(48);expect(geometry.width).toBeGreaterThan(width===375?180:300);expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);expect(geometry.whiteSpace).toBe('pre-wrap');
  await longQuestion.focus();await page.keyboard.press('End');await page.keyboard.press('Enter');await expect(longQuestion).toHaveValue(long);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await checkpoint(`r4-outline-${width}`,{longQuestionPreserved:true,geometry});
  long += '补充？';await longQuestion.fill(long);await page.getByRole('button',{name:'保存问题草稿',exact:true}).click();await expect(page.getByRole('button',{name:'保存问题草稿',exact:true})).toBeEnabled();await page.reload();await expect(longQuestion).toHaveValue(long);
  await page.goto(`/itv/${interviewId}/report`);for(const label of ['生成 PDF','生成 Word','分享报告'])await expect(page.getByRole('button',{name:label,exact:true})).toBeEnabled();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.getByRole('button',{name:'生成 Word',exact:true}).focus();await expect(page.getByRole('button',{name:'生成 Word',exact:true})).toBeFocused();await checkpoint(`r4-report-${width}`,{fileEntriesEnabled:true,noGenerationClicked:true});
 }
 await page.goto('/itv?tab=experts');const builtin=INTERVIEW_PERSONAS[0]!;const viewBuiltin=page.getByTestId(`itv-library-${personaAnchorId(builtin)}`).getByRole('button',{name:`查看画像 ${builtin.name}`,exact:true});await viewBuiltin.click();await expect(page.getByRole('dialog',{name:builtin.name,exact:true})).toContainText(builtin.service_value);await page.keyboard.press('Escape');await expect(viewBuiltin).toBeFocused();await checkpoint('r4-expert-keyboard',{completeData:true,focusRestored:true});
 const modelAfter=await modelActivity();expect(modelAfter).toEqual(modelBefore);expect(modelCommands).toEqual([]);await fs.writeFile(`${dir}/model-activity.json`,JSON.stringify({before:modelBefore,after:modelAfter,commands:modelCommands},null,2));
});

/** Renders the sanitized actual model output; deliberately does not dispatch a model. */
test('contextual analysis advice survives persistence and responsive rendering',async({page},testInfo)=>{
 test.setTimeout(120_000);
 const {readFile}=await import('node:fs/promises');
 const markdown=await readFile(process.env.WX_ANALYSIS_RENDER_FILE ?? resolve(process.cwd(),'../../evidence/interview-analysis-5819/live-analysis.md'),'utf8');
 await page.goto('/login');await page.getByTestId('login-email').fill(FULLSTACK_E2E.email);await page.getByTestId('login-password').fill(FULLSTACK_E2E.password);await page.getByTestId('login-submit').click();await expect(page).toHaveURL(/\/home$/u);
 const token=await page.evaluate(()=>localStorage.getItem('wsx.sessionToken'));const headers={authorization:`Bearer ${token}`};
 await page.goto('/itv');await page.getByTestId('itv-create').click();await page.getByLabel('访谈名称',{exact:true}).fill('合成晚睡研究分析验收');await page.getByTestId('itv-create-submit').click();await expect(page).toHaveURL(/\/itv\/[^/]+\/intake/u);
 const interviewId=new URL(page.url()).pathname.split('/')[2]!;const path=`/__fullstack_api/interviews/digital/${interviewId}/markdown`;
 const save=async(body:string)=>{const current=await(await page.request.get(path,{headers})).json();const result=await page.request.post(`${path}/analysis`,{headers,data:{markdown:body,expectedVersion:current.version,expectedDocumentVersion:current.documents.find((d:{step:string})=>d.step==='analysis')?.version??0}});expect(result.ok()).toBe(true);};
 await save(markdown);
 for(const width of [375,768,1280]){
  await page.setViewportSize({width,height:900});await page.goto(`/itv/${interviewId}/analysis`);
  for(const title of ['研究建议','待验证假设','适用边界'])await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'研究目标',exact:true})).toBeVisible();
  await expect(page.getByText('当前文档未单列建议',{exact:false})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath(`analysis-live-${width}.png`),fullPage:true});
 }
 const saved=await(await page.request.get(path,{headers})).json();expect(saved.documents.find((d:{step:string})=>d.step==='analysis').markdown).toBe(markdown);
 await save('## 每天晚睡的主要弊端\n\n长期晚睡可能影响日常生活，尚需访谈核验。');await page.reload();await expect(page.getByRole('button',{name:'重新生成分析',exact:true})).toBeEnabled();await expect(page.getByText('缺少研究建议',{exact:false})).toBeVisible();
});
