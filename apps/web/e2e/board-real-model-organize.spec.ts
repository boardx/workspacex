import {createHash,randomUUID} from 'node:crypto';
import {expect,test,type Page} from '@playwright/test';
import type {WhiteboardObject} from '@repo/contracts/whiteboard-document';
import type {WhiteboardAIProposal} from '@repo/contracts/whiteboard-operation';
import {SESSION_TOKEN_STORAGE_KEY} from '../lib/api-client';
import {REAL_MODEL_SMOKE,REAL_MODEL_SKIP_REASON} from './real-model-smoke-fixture';
import {scrubSecrets} from './support/real-model-evidence';

test.skip(REAL_MODEL_SKIP_REASON!==null,REAL_MODEL_SKIP_REASON??'');
if(REAL_MODEL_SKIP_REASON)console.info(REAL_MODEL_SKIP_REASON);
const themes=[
 ['入门','注册完成后不知道第一步','希望有示例项目引导','新成员找不到邀请入口','初次使用按钮含义不清','教程缺少实际案例','希望新手任务清单','创建第一个项目步骤太多','找不到产品帮助','第一次进来界面太复杂','新用户需要快速上手提示'],
 ['性能','画布拖动明显卡顿','图片加载等待很久','搜索结果返回太慢','大量便利贴滚动掉帧','导出文件耗时过长','多人编辑偶尔冻结','打开项目需要十秒','缩放画布反应迟缓','上传大图进度停住','移动端输入延迟很高'],
 ['费用','价格套餐难以比较','不知道哪些功能需要付费','希望支持按月订阅','团队席位价格偏高','账单明细不够透明','试用结束收费提醒太晚','需要教育组织折扣','购买席位审批流程复杂','付费后发票在哪里','希望明确免费版容量'],
] as const;
const texts=themes.flatMap(group=>group.slice(1));
const semanticSnapshot=(objects:WhiteboardObject[])=>objects.map(({id,kind,text,parentId,geometry,style})=>({id,kind,text,parentId,geometry,style})).sort((a,b)=>a.id.localeCompare(b.id));
async function login(page:Page){await page.goto('/login');await page.getByTestId('login-email').fill(REAL_MODEL_SMOKE.email);await page.getByTestId('login-password').fill(REAL_MODEL_SMOKE.password);await page.getByTestId('login-submit').click();await expect(page).toHaveURL(/\/projects/);const token=await page.evaluate(key=>localStorage.getItem(key),SESSION_TOKEN_STORAGE_KEY);expect(token).toBeTruthy();return token!;}

test('real model reads 30 notes → named clusters preview → atomic confirm → one server Undo',async({page,browser,request,baseURL},testInfo)=>{
 // The operator binds this to the configured published provider/model. No fixture fallback.
 const expectedModel=process.env.BOARD_REAL_MODEL_EXPECTED_MODEL;
 expect(expectedModel,'set BOARD_REAL_MODEL_EXPECTED_MODEL to the published real provider/model').toBeTruthy();
 expect(expectedModel).not.toMatch(/loopback|mock|fixture|e2e/i);
 const token=await login(page),prefix=process.env.NEXT_PUBLIC_API_PATH_PREFIX??'';
 const apiBase=new URL(prefix||'/',baseURL).toString().replace(/\/$/,'');
 let boardId='',peerContext:Awaited<ReturnType<typeof browser.newContext>>|undefined;
 const evidence:Record<string,unknown>={lane:'real-model',startedAt:new Date().toISOString(),expectedModel,subjectiveQuality:'pending-main-session-human-review'};
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 async function api(method:string,path:string,data?:unknown){const response=await request.fetch(`${apiBase}${path}`,{method,headers:{Authorization:`Bearer ${token}`},data});expect(response.ok(),`${method} ${path}: HTTP ${response.status()}`).toBe(true);return response;}
 try{
  boardId=(await(await api('POST','/whiteboards',{requestId:randomUUID(),name:`Real AI acceptance ${Date.now()}`})).json()).id;
  const available=await(await api('GET',`/v1/whiteboards/${boardId}/ai-organize/actors`)).json();
  const actors=Array.isArray(available)?available:available.actors;
  const actor=actors.find((value:{model:string;actorId:string})=>value.model===expectedModel&&(!process.env.BOARD_REAL_MODEL_ACTOR_ID||value.actorId===process.env.BOARD_REAL_MODEL_ACTOR_ID));
  expect(actor,'register a delegated published Agent with matching model and immutable pinned skill via trusted administration').toBeTruthy();
  evidence.actor=actor;
  const snapshot=async()=>await(await api('GET',`/v1/whiteboards/${boardId}/objects?actorId=${encodeURIComponent(actor.actorId)}`)).json() as {objects:WhiteboardObject[];revision:{epoch:number;seq:number}};
  await page.goto(`/studio/board/${boardId}`);await expect(page.getByTestId('board-organize-controls')).toBeVisible();
  await page.keyboard.press('Shift+N');await page.getByTestId('board-bulk-text').fill(texts.join('\n'));await page.getByTestId('board-bulk-apply').click();
  await expect.poll(async()=>(await snapshot()).objects.length).toBe(30);
  const before=await snapshot();evidence.before=before;
  peerContext=await browser.newContext({baseURL,storageState:await page.context().storageState()});const peer=await peerContext.newPage();await peer.goto(`/studio/board/${boardId}`);
  await expect(peer.getByRole('button',{name:`图形：${texts[0]}`,exact:true})).toHaveCount(1);
  if(actors.length>1)await page.getByLabel('整理 Agent').selectOption(actor.actorId);
  await expect(page.getByTestId('board-ai-organize')).toBeEnabled();
  const result=page.waitForResponse(response=>response.url().endsWith(`/v1/whiteboards/${boardId}/ai-organize`)&&response.request().method()==='POST');
  const started=Date.now();await page.getByTestId('board-ai-organize').click();const response=await result;
  expect(response.ok()).toBe(true);const proposal=await response.json() as WhiteboardAIProposal;
  evidence.modelElapsedMs=Date.now()-started;evidence.proposal=proposal;
  expect(proposal.runtimePin).toMatchObject({model:expectedModel,skill:actor.skill});expect(proposal.runtimePin?.agentVersionId).toBeTruthy();
  expect(proposal.action.type).toBe('cluster');
  const panels=proposal.action.commands.flatMap(command=>command.type==='create'&&command.object.kind==='frame'?[command.object]:[]);
  expect(panels.length).toBeGreaterThanOrEqual(2);expect(panels.length).toBeLessThanOrEqual(12);expect(panels.every(panel=>panel.text.trim().length>0)).toBe(true);
  const parentCommands=proposal.action.commands.flatMap(command=>command.type==='parent'?[command]:[]);
  expect(parentCommands.map(command=>command.id).sort()).toEqual(before.objects.map(object=>object.id).sort());
  expect(new Set(parentCommands.map(command=>command.id)).size).toBe(30);
  await expect(page.getByTestId('board-ai-proposal')).toBeVisible();expect(await snapshot()).toEqual(before);
  await testInfo.attach('preview',{body:await page.screenshot(),contentType:'image/png'});
  await page.getByTestId('board-ai-confirm').click();
  await expect.poll(async()=>(await snapshot()).objects.filter(object=>object.kind==='frame').length).toBe(panels.length);
  const applied=await snapshot();expect(applied.revision.seq).toBe(before.revision.seq+1);
  for(const panel of panels)await expect(peer.getByRole('button',{name:`图形：${panel.text}`,exact:true})).toHaveCount(1);
  await testInfo.attach('peer-confirmed-canvas',{body:await peer.screenshot(),contentType:'image/png'});
  evidence.applied=applied;
  await page.getByTestId('board-ai-undo').click();await expect.poll(async()=>semanticSnapshot((await snapshot()).objects)).toEqual(semanticSnapshot(before.objects));
  const undone=await snapshot();expect(undone.revision.seq).toBe(applied.revision.seq+1);evidence.undone=undone;
  for(const panel of panels)await expect(peer.getByRole('button',{name:`图形：${panel.text}`,exact:true})).toHaveCount(0);
  expect(errors).toEqual([]);
 }finally{
  evidence.finishedAt=new Date().toISOString();evidence.pageErrors=errors;evidence.boardId=boardId;
  const body=scrubSecrets(JSON.stringify(evidence,null,2),[token,REAL_MODEL_SMOKE.password]);
  await testInfo.attach('real-model-board-evidence',{body,contentType:'application/json'});
  await testInfo.attach('evidence-sha256',{body:createHash('sha256').update(body).digest('hex'),contentType:'text/plain'});
  if(peerContext)await peerContext.close();
  if(boardId){const board=await(await api('GET',`/whiteboards/${boardId}`)).json();await api('PATCH',`/whiteboards/${boardId}`,{archived:true,expectedLifecycleRevision:board.lifecycleRevision});}
 }
});
