import { randomUUID } from 'node:crypto';
import { expect,test } from '@playwright/test';
import { FULLSTACK_E2E } from './fullstack-smoke-fixture';
import { INTERVIEW_PERSONAS,personaAnchorId } from '../lib/interview-personas/persona-library';
/** Real authenticated routes/PG, no route interception or model calls. */
test('built-in experts and private custom experts persist and can be selected into a saved interview',async({page})=>{
 test.setTimeout(120_000);
 await page.goto('/login');await page.getByTestId('login-email').fill(FULLSTACK_E2E.email);await page.getByTestId('login-password').fill(FULLSTACK_E2E.password);await page.getByTestId('login-submit').click();await expect(page).toHaveURL(/\/home$/u);
 const token=await page.evaluate(()=>localStorage.getItem('wsx.sessionToken'));const headers={authorization:`Bearer ${token}`};
 await page.goto('/itv?tab=experts');
 const builtin=INTERVIEW_PERSONAS[0]!;await expect(page.getByTestId(`itv-library-${personaAnchorId(builtin)}`)).toBeVisible();
 const name=builtin.name;
 await page.getByTestId('itv-add-library-expert').click();const dialog=page.getByRole('dialog',{name:'添加专家画像'});
 for(const [label,value] of Object.entries({'名称':name,'专业角色':'采购决策顾问','专业领域':'采购','研究关注':'预算和决策责任','观点风格':'通过反例验证','能力简介':`自建验收 ${randomUUID()}`}))await dialog.getByLabel(label,{exact:true}).fill(value);
 await dialog.getByRole('button',{name:'保存专家',exact:true}).click();await expect(dialog).not.toBeVisible();
 const listed=await page.request.get('/__fullstack_api/interviews/digital/expert-library',{headers});expect(listed.status()).toBe(200);const result=await listed.json();const custom=result.items.find((item:{fields:{name:string}})=>item.fields.name===name);expect(custom).toBeTruthy();expect(custom.expertId).toMatch(/^custom-expert-/u);
 await page.reload();await expect(page.getByTestId(`itv-library-${custom.expertId}`)).toContainText('我的模拟画像');await expect(page.getByTestId(`itv-library-${personaAnchorId(builtin)}`)).toContainText('内置模拟画像');
 const created=await page.request.post('/__fullstack_api/interviews/digital',{headers,data:{name:'专家库选用验收',tags:[],scope:{kind:'none',projectId:null,researchProjectId:null},requestId:randomUUID()}});expect(created.status()).toBe(201);const {interviewId}=await created.json();const path=`/__fullstack_api/interviews/digital/${interviewId}/markdown`;
 let source=await (await page.request.get(path,{headers})).json();source=await(await page.request.post(`${path}/initialize`,{headers,data:{expectedVersion:source.version}})).json();
 const saved=await page.request.post(`${path}/experts`,{headers,data:{markdown:'# 专家\n',expectedVersion:source.version,expectedDocumentVersion:0}});expect(saved.status()).toBe(201);
 await page.goto(`/itv/${interviewId}/experts`);await page.getByTestId(`itv-library-${custom.expertId}`).getByRole('button',{name:`添加画像 ${name}`,exact:true}).click();
 await expect.poll(async()=>{const current=await(await page.request.get(path,{headers})).json();return current.documents.find((doc:{step:string})=>doc.step==='experts')?.markdown??'';}).toContain(`#expert-${custom.expertId}`);
 await page.reload();const current=await(await page.request.get(path,{headers})).json();const markdown=current.documents.find((doc:{step:string})=>doc.step==='experts').markdown;expect(markdown).toContain('采购决策顾问');expect(markdown).toContain('不作为真人访谈证据');
});
