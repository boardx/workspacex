import {createHash,randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {expect,test,type APIRequestContext,type Page} from '@playwright/test';
import type {RenderedDiagramLayout,WhiteboardObjectsSnapshot} from '@repo/contracts/whiteboard-operation';
import {whiteboard as BoardContract,chat as Chat} from '@repo/contracts';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tsImport} from 'tsx/esm/api';
import {extractMermaidBlocks} from '../../../packages/fabric-markdown/src/markdown';
import {SESSION_TOKEN_STORAGE_KEY} from '../lib/api-client';
import {FULLSTACK_E2E} from './fullstack-smoke-fixture';
import {createThreadViaApi} from './support/authoritative-thread';
import {boardViewportStorageKey} from '../components/whiteboard/use-board-persisted-viewport';

/** Only the assistant-message precondition is inserted into an owned, isolated real thread.
 * Generation is not executed. No HTTP interception: message readback, explicit source save,
 * immutable revision, Board handoff, canonical objects and reload all use real APIs. */
type FixtureConnection={query(sql:string,params:unknown[]):Promise<{rows:Record<string,unknown>[]}>};
type DatabaseFixture={asOwner<T>(fn:(connection:FixtureConnection)=>Promise<T>):Promise<T>};
async function ownedDatabase<T>(fn:(connection:FixtureConnection)=>Promise<T>){
  const database=process.env.WORKSPACEX_DB;
  if(!process.env.WORKSPACEX_ISOLATION_ID||!database?.startsWith('wsx_'))throw new Error('PLACEMENT_FIXTURE_REQUIRES_ISOLATED_WSX_DATABASE');
  const {asOwner}=await tsImport(pathToFileURL(resolve(__dirname,'../../api/tests/support/db.ts')).href,{parentURL:pathToFileURL(__filename).href,tsconfig:resolve(__dirname,'../../api/tsconfig.json')}) as DatabaseFixture;
  return asOwner(async connection=>{
    const actual=(await connection.query('SELECT current_database() AS name',[])).rows[0];
    if(actual?.name!==database)throw new Error('PLACEMENT_FIXTURE_DATABASE_MISMATCH');
    return fn(connection);
  });
}
test.describe.configure({mode:'serial',timeout:300_000});
const origin=()=>{
  if(!process.env.WORKSPACEX_API_PORT)throw new Error('WORKSPACEX_API_PORT is required');
  return `http://127.0.0.1:${process.env.WORKSPACEX_API_PORT}`;
};
async function call(api:APIRequestContext,token:string,method:string,path:string,data?:unknown){
  const response=await api.fetch(`${origin()}${path}`,{method,headers:{Authorization:`Bearer ${token}`},data});
  expect(response.ok(),`${method} ${path}: HTTP ${response.status()} ${await response.text()}`).toBe(true);
  return response;
}
async function login(page:Page){
  await page.goto('/login');await page.getByTestId('login-email').fill(FULLSTACK_E2E.email);
  await page.getByTestId('login-password').fill(FULLSTACK_E2E.password);await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/(?:home|projects)(?:\?.*)?$/);
  const token=await page.evaluate(key=>localStorage.getItem(key),SESSION_TOKEN_STORAGE_KEY);
  expect(token).toBeTruthy();return token!;
}
type Handoff={requestId:string;layout:RenderedDiagramLayout;offset:{x:number;y:number}};
async function expectInsertedContentVisible(page:Page,ids:string[]) {
  const surface=page.getByTestId('board-fabric-surface');
  await expect.poll(()=>surface.evaluate((element,expected)=>{
    const canvas=element.querySelector('canvas.upper-canvas');if(!canvas)return false;
    const rect=canvas.getBoundingClientRect(),zoom=Number(element.getAttribute('data-viewport-zoom')),panX=Number(element.getAttribute('data-viewport-pan-x')),panY=Number(element.getAttribute('data-viewport-pan-y'));
    const scenes=JSON.parse(element.getAttribute('data-object-scenes')??'[]') as Array<{id:string;left:number;top:number;width:number;height:number}>;
    return expected.every(id=>{const object=scenes.find(item=>item.id===id);if(!object)return false;
      const left=object.left*zoom+panX,top=object.top*zoom+panY;
      return left>=20&&top>=20&&left+object.width*zoom<=rect.width-20&&top+object.height*zoom<=rect.height-80;
    });
  },ids),{timeout:30_000,message:'Every actual inserted Fabric object must be visible after focusing, beyond the screen-reader outline'}).toBe(true);
}

test('project and organization Board targets · real placement handoff, cancel and reload',async({browser,request:api,baseURL},info)=>{
  const context=await browser.newContext({baseURL}),page=await context.newPage();
  const boards:Array<{id:string;name:string}>=[],threads:Array<{id:string;projectId:string|null;messageId?:string}>=[];
  let token:string|undefined,linked=false;const failures:unknown[]=[],evidence:unknown[]=[];
  const posted:Array<{url:string;body:Handoff}>=[],sourceWrites:Array<{threadId:string;body:unknown}>=[],wireOrder:string[]=[],listReads:string[]=[];
  page.on('request',request=>{
    const url=new URL(request.url());
    if(request.method()==='POST'&&url.pathname.endsWith('/artifact-handoffs')){posted.push({url:request.url(),body:request.postDataJSON() as Handoff});wireOrder.push(`handoff:${url.pathname}`);}
    const sourceSave=/\/chat\/threads\/([^/]+)\/artifacts$/.exec(url.pathname);
    if(request.method()==='POST'&&sourceSave){sourceWrites.push({threadId:sourceSave[1]!,body:request.postDataJSON()});wireOrder.push(`save:${url.pathname}`);}
    if(request.method()==='GET'&&/\/chat\/threads\/[^/]+\/artifacts\/[^/]+\/source$/.test(url.pathname))wireOrder.push(`source:${url.pathname}`);
    if(request.method()==='GET'&&(url.pathname.endsWith('/whiteboards')||url.pathname.endsWith(`/projects/${FULLSTACK_E2E.projectId}/resources`)))listReads.push(request.url());
  });
  try{
    token=await login(page);
    const customKey=`placement-six-${randomUUID()}`;
    const customSections=Array.from({length:6},(_,i)=>({sectionId:`s${i}`,name:`分区${i}`,type:'便利贴列表',order:i,required:false,capacity:3,layout:{col:(i%3)*2+1,row:Math.floor(i/3)*4+1,w:2,h:4,cols:1,max:3,tone:1,overflow:'缩小字号'}}));
    await ownedDatabase(async connection=>{
      await connection.query(`INSERT INTO canvas_templates (org_id,key,version,display_name,status,builtin,visibility,underlying_type,sections,tags,layout_source,size,grid_cols,grid_rows) VALUES ($1,$2,1,$3,'published',false,'org-wide','canvas',$4::jsonb,'{}','user-edited','A1',6,8)`,[FULLSTACK_E2E.orgId,customKey,'六格组织模板',JSON.stringify(customSections)]);
    });
    const createBoard=async(name:string)=>{
      const board=await(await call(api,token!,'POST','/whiteboards',{requestId:randomUUID(),name})).json() as {id:string;name:string};
      boards.push(board);return board;
    };
    const projectBoard=await createBoard(`Placement project ${randomUUID()}`),organizationBoard=await createBoard(`Placement organization ${randomUUID()}`);
    const original=new Map<string,WhiteboardObjectsSnapshot>();
    const read=async(id:string)=>(await(await call(api,token!,'GET',`/v1/whiteboards/${id}/objects?actorId=${encodeURIComponent(FULLSTACK_E2E.agentId)}`)).json()) as WhiteboardObjectsSnapshot;
    for(const board of [projectBoard,organizationBoard]){
      const object={id:`existing-${randomUUID()}`,schemaVersion:1,kind:'sticky',geometry:{x:100,y:100,width:240,height:160,rotation:0},text:`Existing ${board.id}`,style:{fill:'#FFF2A8'},parentId:null,orderKey:'a'};
      await call(api,token,'POST',`/v1/whiteboards/${board.id}/operations`,{apiVersion:'2026-09-01',requestId:randomUUID(),boardId:board.id,expectedRevision:{epoch:1,seq:0},actor:{kind:'human',actorId:FULLSTACK_E2E.userId,orgId:FULLSTACK_E2E.orgId,role:'owner',scopes:['board:read','board:write'],delegatedBy:null},commands:[{type:'create',object}],provenance:{source:'human',model:null,skill:null,sourceArtifactId:null,sourceRevision:null,layoutHash:null,inputObjectIds:[]}});
      original.set(board.id,await read(board.id));
    }
    await call(api,token,'POST',`/projects/${FULLSTACK_E2E.projectId}/resources`,{projectId:FULLSTACK_E2E.projectId,kind:'whiteboard',resourceId:projectBoard.id});linked=true;
    const resources=await(await call(api,token,'GET',`/projects/${FULLSTACK_E2E.projectId}/resources`)).json() as {items:Array<{id:string;kind:string;title:string}>};
    const expectedProjectTargets=resources.items.filter(item=>item.kind==='whiteboard');
    expect(expectedProjectTargets.map(item=>item.id)).toContain(projectBoard.id);expect(expectedProjectTargets.map(item=>item.id)).not.toContain(organizationBoard.id);
    // > one real default-sized page, with the untouched organization target older than every filler.
    const pageSize=BoardContract.ListBoards.parse({}).limit;
    for(let i=0;i<pageSize+1;i++)await createBoard(`Placement pagination ${i} ${randomUUID()}`);
    const firstPage=await(await call(api,token,'GET',`/whiteboards?archived=active&limit=${pageSize}`)).json() as {items:Array<{id:string}>;nextCursor:string|null};
    expect(firstPage.nextCursor).toBeTruthy();expect(firstPage.items.map(item=>item.id)).not.toContain(organizationBoard.id);

    const makeThread=async(projectId:string|null)=>{
      // Shared authoritative helper owns personal-thread creation; it does not support project threads.
      const threadId=projectId===null?await createThreadViaApi(page,'/__fullstack_api'):(await(await call(api,token!,'POST','/chat/threads/mutate',{op:'create',projectId,threadId:null,groupId:null,title:`Placement ${randomUUID()}`,visibilityScope:'private',expectedVersion:null,reason:null})).json() as {threadId:string}).threadId;
      const ownedThread:{id:string;projectId:string|null;messageId?:string}={id:threadId,projectId};threads.push(ownedThread);
      const projectQuery=projectId?`?projectId=${encodeURIComponent(projectId)}`:'';
      const nonce=randomUUID(),label=`Fresh placement ${nonce.slice(0,8)}`;
      const lang=projectId?'canvas':'mermaid',prefix=lang==='canvas'?'chat-canvas':'chat-diagram';
      const diagram=lang==='canvas'?[`模板: ${customKey}`,'',...customSections.flatMap(section=>[`## ${section.name}`,`- ${label} ${section.name}`,''])]:['flowchart TD',` FreshA["${label}"] --> FreshB["Fresh target"]`];
      const body=[`Board placement source ${nonce}`,'','```'+lang,...diagram,'```'].join('\n');
      const messageId=`placement-source-${randomUUID()}`;
      await ownedDatabase(async connection=>{
        // The API created this thread in this invocation; never seed into a shared thread.
        if(!threads.includes(ownedThread))throw new Error('PLACEMENT_THREAD_NOT_OWNED');
        const thread=(await connection.query('SELECT id,org_id,created_by,project_id FROM chat_threads WHERE id=$1 AND org_id=$2',[threadId,FULLSTACK_E2E.orgId])).rows[0];
        if(thread?.created_by!==FULLSTACK_E2E.userId||thread.project_id!==projectId)throw new Error('PLACEMENT_THREAD_OWNER_MISMATCH');
        const existing=await connection.query('SELECT id FROM chat_messages WHERE org_id=$1 AND thread_id=$2',[FULLSTACK_E2E.orgId,threadId]);
        if(existing.rows.length!==0)throw new Error('PLACEMENT_THREAD_NOT_EMPTY');
        await connection.query("INSERT INTO chat_messages (id,org_id,thread_id,author_kind,author_id,agent_id,body) VALUES ($1,$2,$3,'agent',$4,$4,$5)",[messageId,FULLSTACK_E2E.orgId,threadId,FULLSTACK_E2E.agentId,body]);
        ownedThread.messageId=messageId;
      });
      const messages=Chat.operations.listMessages.out.parse(await(await call(api,token!,'GET',`/chat/threads/${threadId}/messages?limit=100`)).json()).messages;
      expect(messages).toHaveLength(1);
      const reply=messages[0]!;
      expect(reply).toMatchObject({id:messageId,authorKind:'agent',agentId:FULLSTACK_E2E.agentId,agentRunId:null,text:body});
      const blocks=extractMermaidBlocks(reply.text);
      expect(blocks).toHaveLength(1);expect(blocks[0]).toMatchObject({closed:true,lang});expect(blocks[0]!.code).toContain(label);
      const artifactPath=`/chat/threads/${threadId}/artifacts${projectQuery}`;
      expect(Chat.operations.listThreadArtifacts.out.parse(await(await call(api,token!,'GET',artifactPath)).json()).items).toEqual([]);
      await page.goto(`/chat/${threadId}${projectQuery}`);
      // The durable assistant message is read by the ordinary Chat UI.
      const fabric=page.getByTestId('chat-ai-markdown').last().getByTestId(`${prefix}-fabric`).first();
      await expect(fabric.locator('canvas').first()).toBeVisible({timeout:60_000});
      await expect(fabric.getByTestId('chat-diagram-insert-board')).toBeEnabled();
      const insertBox=await fabric.getByTestId('chat-diagram-insert-board').boundingBox(),maximizeBox=await fabric.getByTestId(`${prefix}-maximize`).boundingBox();
      expect(insertBox).not.toBeNull();expect(maximizeBox).not.toBeNull();expect(maximizeBox!.x).toBeGreaterThanOrEqual(insertBox!.x+insertBox!.width);
      return {fabric,threadId,projectQuery,reply,label,lang,artifactPath};
    };
    for(const scope of ['project','organization'] as const){
      const board=scope==='project'?projectBoard:organizationBoard,readStart=listReads.length;
      const fixtureSource=await makeThread(scope==='project'?FULLSTACK_E2E.projectId:null),{fabric,threadId,projectQuery,reply,label,lang,artifactPath}=fixtureSource;
      await fabric.getByTestId('chat-diagram-insert-board').click();await expect(page.getByTestId('chat-board-target')).toBeEnabled();
      await page.getByTestId('chat-board-target').click();
      if(scope==='project'){
        expect((await page.getByRole('menuitemradio').allTextContents()).map(text=>text.trim()).sort()).toEqual(expectedProjectTargets.map(item=>item.title).sort());
        await expect(page.getByRole('menuitemradio',{name:organizationBoard.name,exact:true})).toHaveCount(0);
      }else await expect(page.getByRole('menuitemradio',{name:organizationBoard.name,exact:true})).toBeVisible();
      await page.getByRole('menuitemradio',{name:board.name,exact:true}).click();
      const preview=page.getByTestId('chat-board-placement-preview'),range=page.getByTestId('chat-board-placement-range');
      await expect(preview).toHaveAttribute('viewBox','0 0 240 160');await expect(preview.locator('rect[fill="#FFF2A8"]')).toHaveCount(1);
      await expect(range).toHaveClass(/stroke-destructive/);
      const dragRange=async()=>{
        const beforeDrag={x:await range.getAttribute('x'),y:await range.getAttribute('y')};
        const box=await range.boundingBox(),svg=await preview.boundingBox();expect(box).not.toBeNull();expect(svg).not.toBeNull();
        await page.mouse.move(box!.x+box!.width/2,box!.y+box!.height/2);await page.mouse.down();
        await page.mouse.move(Math.min(svg!.x+svg!.width-12,box!.x+box!.width/2+35),Math.min(svg!.y+svg!.height-12,box!.y+box!.height/2+18),{steps:6});await page.mouse.up();
        expect({x:await range.getAttribute('x'),y:await range.getAttribute('y')}).not.toEqual(beforeDrag);
      };
      await dragRange();
      const beforeCancel=posted.length,beforeSourceSave=sourceWrites.length;await page.getByRole('button',{name:'取消',exact:true}).click();
      await expect(preview).toHaveCount(0);expect(posted).toHaveLength(beforeCancel);expect(sourceWrites).toHaveLength(beforeSourceSave);expect(await read(board.id)).toEqual(original.get(board.id));
      expect(Chat.operations.listThreadArtifacts.out.parse(await(await call(api,token!,'GET',artifactPath)).json()).items).toEqual([]);
      await fabric.getByTestId('chat-diagram-insert-board').click();await expect(page.getByTestId('chat-board-target')).toBeEnabled();
      await page.getByTestId('chat-board-target').click();await page.getByRole('menuitemradio',{name:board.name,exact:true}).click();
      await expect(preview).toBeVisible();await dragRange();await preview.focus();await page.keyboard.press('ArrowRight');
      const previewPath=info.outputPath(`placement-${scope}-preview.png`);await page.screenshot({path:previewPath,fullPage:false});
      await info.attach(`placement-${scope}-preview.png`,{path:previewPath,contentType:'image/png'});
      const savePromise=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname.endsWith(`/chat/threads/${threadId}/artifacts`));
      const sourcePromise=page.waitForResponse(response=>response.request().method()==='GET'&&new URL(response.url()).pathname.includes(`/chat/threads/${threadId}/artifacts/`)&&new URL(response.url()).pathname.endsWith('/source'));
      const receiptPromise=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname.endsWith(`/whiteboards/${board.id}/artifact-handoffs`));
      await page.getByTestId('chat-board-handoff-confirm').click();
      const [saveResponse,sourceResponse,receipt]=await Promise.all([savePromise,sourcePromise,receiptPromise]);
      expect(receipt.ok(),await receipt.text()).toBe(true);expect(posted).toHaveLength(beforeCancel+1);
      expect(saveResponse.ok(),await saveResponse.text()).toBe(true);expect(sourceResponse.ok(),await sourceResponse.text()).toBe(true);
      const landed=Chat.operations.landAsArtifact.out.parse(await saveResponse.json());
      const savedSource=Chat.operations.getThreadArtifactSource.out.parse(await sourceResponse.json());
      const artifactId=landed.artifactId,sourceRevision=savedSource.immutableRevision;
      expect(landed.provenanceBacklink).toMatchObject({conversationId:threadId,messageId:reply.id});
      expect(new URL(sourceResponse.url()).pathname).toContain(`/artifacts/${artifactId}/source`);
      expect(sourceWrites).toHaveLength(beforeSourceSave+1);expect(sourceWrites.at(-1)!.body).toMatchObject({threadId,messageId:reply.id});
      const savedBlocks=extractMermaidBlocks(savedSource.markdown),replyBlocks=extractMermaidBlocks(reply.text);
      expect(savedBlocks).toHaveLength(1);expect(replyBlocks).toHaveLength(1);
      // Saving serializes the actual rendered model, so canonical text may differ from the reply.
      for(const block of [savedBlocks[0]!,replyBlocks[0]!]){
        expect(block.closed).toBe(true);expect(block.lang).toBe(lang);expect(block.code).toContain(label);
        if(lang==='canvas')expect(block.code).toContain(`模板: ${customKey}`);
        else expect(block.code).toMatch(/^flowchart\s/m);
      }
      const sourceHash=createHash('sha256').update(savedSource.markdown).digest('hex');
      const actual=Chat.operations.getThreadArtifactSource.out.parse(await(await call(api,token!,'GET',`/chat/threads/${threadId}/artifacts/${artifactId}/source${projectQuery}`)).json());
      expect(actual).toEqual(savedSource);
      if(landed.contentHash!==null)expect(sourceHash).toBe(landed.contentHash);
      const handoff=receipt.request().postDataJSON() as Handoff;expect(handoff.layout.artifactId).toBe(artifactId);expect(handoff.layout.sourceRevision).toBe(sourceRevision);
      expect(handoff.layout.diagramKind).toBe(lang==='canvas'?'template':'flowchart');
      expect(handoff.layout.objects.some(object=>object.text.includes(label))).toBe(true);
      if(lang==='canvas')expect(handoff.layout.objects.filter(object=>object.style.dataJson&&JSON.parse(String(object.style.dataJson)).role==='section')).toHaveLength(6);
      const saveIndex=wireOrder.indexOf(`save:${new URL(saveResponse.url()).pathname}`),sourceIndex=wireOrder.indexOf(`source:${new URL(sourceResponse.url()).pathname}`),handoffIndex=wireOrder.indexOf(`handoff:${new URL(receipt.url()).pathname}`);
      expect(saveIndex).toBeGreaterThanOrEqual(0);expect(sourceIndex).toBeGreaterThan(saveIndex);expect(handoffIndex).toBeGreaterThan(sourceIndex);
      const committed=await read(board.id);expect(committed.revision.seq).toBeGreaterThan(original.get(board.id)!.revision.seq);
      for(const old of original.get(board.id)!.objects)expect(committed.objects.find(item=>item.id===old.id)).toEqual(old);
      for(const incoming of handoff.layout.objects){
        const object=committed.objects.find(item=>(item.extensionData?.content as {sourceId?:string;type?:string}|undefined)?.sourceId===incoming.sourceId);
        expect(object,`Canonical source ${incoming.sourceId}`).toBeTruthy();expect(object!.text).toBe(incoming.text);
        expect(object!.geometry.x).toBeCloseTo(incoming.geometry.x+handoff.offset.x,6);expect(object!.geometry.y).toBeCloseTo(incoming.geometry.y+handoff.offset.y,6);
        expect(object!.geometry.width).toBe(incoming.geometry.width);expect(object!.geometry.height).toBe(incoming.geometry.height);
      }
      const link=fabric.getByTestId('chat-board-open-inserted');await expect(link).toBeVisible();
      const target=new URL((await link.getAttribute('href'))!,baseURL);
      expect(target.pathname).toBe(`/studio/board/${board.id}`);expect(target.searchParams.get('projectId')).toBe(scope==='project'?FULLSTACK_E2E.projectId:null);
      expect(target.searchParams.get('focusArtifact')).toBe(artifactId);expect(target.searchParams.get('focusLayout')).toBe(handoff.layout.layoutHash);
      // An old viewport must not hide the newly inserted objects on arrival.
      await page.evaluate(key=>localStorage.setItem(key,JSON.stringify({version:1,zoom:1,panX:100000,panY:100000})),boardViewportStorageKey(board.id,FULLSTACK_E2E.userId)!);
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/studio/board/${board.id}(?:\\?|$)`));await expect(page.getByTestId('board-fabric-surface')).toBeVisible({timeout:30_000});
      const insertedIds=committed.objects.filter(object=>!original.get(board.id)!.objects.some(old=>old.id===object.id)).map(object=>object.id);
      await expectInsertedContentVisible(page,insertedIds);
      await expect(page.getByRole('button',{name:new RegExp(label)})).toHaveCount(lang==='canvas'?6:1);
      for(const object of await page.getByRole('button',{name:new RegExp(label)}).all())await expect(object).toBeVisible();
      await page.reload();await expect(page.getByRole('button',{name:new RegExp(label)})).toHaveCount(lang==='canvas'?6:1,{timeout:30_000});
      for(const object of await page.getByRole('button',{name:new RegExp(label)}).all())await expect(object).toBeVisible();
      await expectInsertedContentVisible(page,insertedIds);
      expect((await read(board.id)).objects).toEqual(committed.objects);
      const boardPath=info.outputPath(`placement-${scope}-board-after-reload.png`);await page.screenshot({path:boardPath,fullPage:false});
      await info.attach(`placement-${scope}-board-after-reload.png`,{path:boardPath,contentType:'image/png'});
      const scopeReads=listReads.slice(readStart);
      if(scope==='project')expect(scopeReads.some(url=>new URL(url).pathname.endsWith(`/projects/${FULLSTACK_E2E.projectId}/resources`))).toBe(true);
      else expect(scopeReads.some(url=>new URL(url).pathname.endsWith('/whiteboards')&&new URL(url).searchParams.has('cursor'))).toBe(true);
      evidence.push({scope,lang,templateKey:lang==='canvas'?customKey:null,boardId:board.id,threadId,messageId:reply.id,generation:'not-executed',assistantHash:createHash('sha256').update(reply.text).digest('hex'),artifactId,sourceHash,layoutHash:handoff.layout.layoutHash,revision:committed.revision,sourceRevision,cancelWrites:0,sourceSaves:1,saveIndex,sourceIndex,handoffIndex,listReads:scopeReads});
    }
    const evidencePath=info.outputPath('chat-board-target-placement-evidence.json');writeFileSync(evidencePath,JSON.stringify({boundary:'Generation not executed: only an assistant message was inserted into this spec-owned real thread in the isolated database. No HTTP fixtures: actual message readback, source save/readback/revision, project links, board pagination, handoffs and persistence.',scopes:evidence},null,2));
    await info.attach('chat-board-target-placement-evidence',{path:evidencePath,contentType:'application/json'});
  }catch(error){failures.push(error);}finally{
    if(token){
      if(linked&&boards[0])try{await call(api,token,'DELETE',`/projects/${FULLSTACK_E2E.projectId}/resources/whiteboard/${boards[0].id}`);}catch(error){failures.push(error);}
      for(const board of boards)try{let current=await(await call(api,token,'GET',`/whiteboards/${board.id}`)).json() as {archived:boolean;lifecycleRevision:number};if(!current.archived)current=await(await call(api,token,'PATCH',`/whiteboards/${board.id}`,{archived:true,expectedLifecycleRevision:current.lifecycleRevision})).json() as typeof current;await call(api,token,'DELETE',`/whiteboards/${board.id}`,{requestId:randomUUID(),confirmation:'PERMANENTLY_DELETE',expectedLifecycleRevision:current.lifecycleRevision});}catch(error){failures.push(error);}
      for(const thread of threads)try{const current=await(await call(api,token,'GET',`/chat/threads/${thread.id}${thread.projectId?`?projectId=${thread.projectId}`:''}`)).json() as {thread:{version:number}};await call(api,token,'POST','/chat/threads/mutate',{op:'delete',projectId:thread.projectId,threadId:thread.id,groupId:null,title:null,visibilityScope:null,expectedVersion:current.thread.version,reason:'Owned placement E2E cleanup'});}catch(error){failures.push(error);}
    }
    for(const thread of threads)if(thread.messageId)try{
      await ownedDatabase(async connection=>{
        await connection.query('DELETE FROM chat_messages WHERE id=$1 AND thread_id=$2 AND org_id=$3',[thread.messageId!,thread.id,FULLSTACK_E2E.orgId]);
        const remaining=await connection.query('SELECT id FROM chat_messages WHERE id=$1 AND thread_id=$2 AND org_id=$3',[thread.messageId!,thread.id,FULLSTACK_E2E.orgId]);
        expect(remaining.rows).toEqual([]);
      });
    }catch(error){failures.push(error);}
    try{await context.close();}catch(error){failures.push(error);}
  }
  if(failures.length)throw new AggregateError(failures,'Chat Board placement failed; subsequent errors are owned cleanup failures');
});
