import { randomUUID } from 'node:crypto';
import { expect,test } from '@playwright/test';
import { FULLSTACK_E2E } from './fullstack-smoke-fixture';
import { INTERVIEW_PERSONAS,personaAnchorId } from '../lib/interview-personas/persona-library';
/** Real authenticated routes/PG, no route interception or model calls. */
test('built-in experts and private custom experts persist and can be selected into a saved interview',async({page},testInfo)=>{
 test.setTimeout(120_000);
 await page.goto('/login');await page.getByTestId('login-email').fill(FULLSTACK_E2E.email);await page.getByTestId('login-password').fill(FULLSTACK_E2E.password);await page.getByTestId('login-submit').click();await expect(page).toHaveURL(/\/home$/u);
 const token=await page.evaluate(()=>localStorage.getItem('wsx.sessionToken'));const headers={authorization:`Bearer ${token}`};
 await page.goto('/itv?tab=experts');
 const builtin=INTERVIEW_PERSONAS[0]!;await expect(page.getByTestId(`itv-library-${personaAnchorId(builtin)}`)).toBeVisible();
 await page.getByTestId(`itv-library-${personaAnchorId(builtin)}`).getByRole('button',{name:`查看画像 ${builtin.name}`,exact:true}).click();
 const builtInDialog=page.getByRole('dialog',{name:builtin.name,exact:true});
 for(const value of [builtin.personality.locations,String(builtin.personality.age),builtin.personality.occupation,...builtin.goals,...builtin.interests,...builtin.pain_points,...builtin.motivations,...builtin.influences,builtin.service_value,builtin.typical_advice])await expect(builtInDialog).toContainText(value);
 await expect(builtInDialog).not.toContainText('局限与材料边界');await expect(builtInDialog).not.toContainText('背景与建议未经独立验证');
 for(const width of [375,1280]){await page.setViewportSize({width,height:900});expect(await builtInDialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);const box=await builtInDialog.boundingBox();expect(box).not.toBeNull();if(width===1280)expect(box!.width).toBeGreaterThanOrEqual(700);else expect(box!.width).toBeLessThanOrEqual(width-24);await builtInDialog.getByText(builtin.typical_advice,{exact:true}).scrollIntoViewIfNeeded();await expect(builtInDialog.getByText(builtin.typical_advice,{exact:true})).toBeVisible();await page.screenshot({path:testInfo.outputPath(`builtin-full-${width}.png`)});}
 await builtInDialog.getByRole('button',{name:'关闭',exact:true}).click();await expect(builtInDialog).not.toBeVisible();await expect(page.getByTestId(`itv-library-${personaAnchorId(builtin)}`).getByRole('button',{name:`查看画像 ${builtin.name}`,exact:true})).toBeFocused();
 const name=builtin.name;
 await page.getByTestId('itv-add-library-expert').click();const dialog=page.getByRole('dialog',{name:'添加专家画像'});
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
});
