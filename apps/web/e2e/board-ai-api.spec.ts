import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page, type Request } from '@playwright/test';
import { computeRenderedLayoutHash } from '@repo/whiteboard-core';
import { SESSION_TOKEN_STORAGE_KEY } from '../lib/api-client';
import { FULLSTACK_E2E } from './fullstack-smoke-fixture';

test.describe.configure({mode:'serial',timeout:120_000});
const apiOrigin=()=>`http://127.0.0.1:${process.env.WORKSPACEX_API_PORT}`;
async function login(page:Page,email:string=FULLSTACK_E2E.email,password:string=FULLSTACK_E2E.password){await page.goto('/login');await page.getByTestId('login-email').fill(email);await page.getByTestId('login-password').fill(password);await page.getByTestId('login-submit').click();await expect(page).toHaveURL(/\/(?:home|projects)$/);const token=await page.evaluate(key=>localStorage.getItem(key),SESSION_TOKEN_STORAGE_KEY);expect(token).toBeTruthy();return token!;}
async function call(api:APIRequestContext,token:string,method:string,path:string,data?:unknown){const response=await api.fetch(`${apiOrigin()}${path}`,{method,headers:{Authorization:`Bearer ${token}`},data});expect(response.ok(),`${method} ${path}: ${response.status()} ${await response.text()}`).toBe(true);return response;}
const geometry=(index:number)=>({x:100+(index%6)*230,y:100+Math.floor(index/6)*190,width:200,height:160,rotation:0});

test('AI clustering <=2 actions · chat fabric layout handoff · meeting room follow',async({browser,request:api,baseURL},info)=>{
  const context=await browser.newContext({baseURL}),page=await context.newPage();let followerContext:Awaited<ReturnType<typeof browser.newContext>>|undefined,displayContext:Awaited<ReturnType<typeof browser.newContext>>|undefined,boardId:string|undefined,token:string|undefined;const failures:unknown[]=[];
  const pendingBrowserPresentation=new Set<Request>();
  const onBrowserRequest=(request:Request)=>{if(request.method()==='POST'&&new URL(request.url()).pathname.endsWith('/presentation'))pendingBrowserPresentation.add(request);};
  const onBrowserSettled=(request:Request)=>pendingBrowserPresentation.delete(request);
  page.on('request',onBrowserRequest);page.on('requestfinished',onBrowserSettled);page.on('requestfailed',onBrowserSettled);
  const presentationReceipts:Array<{phase:string;actorId:unknown;expectedRevision:number;committedRevision:number}>=[];
  try{token=await login(page);const created=await call(api,token,'POST','/whiteboards',{requestId:randomUUID(),name:`AI API ${randomUUID()}`});boardId=(await created.json() as{id:string}).id;
    const notes=Array.from({length:30},(_,index)=>({type:'create',object:{id:`ai-note-${index}`,schemaVersion:1,kind:'sticky',geometry:geometry(index),text:`Customer theme ${index%3}`,style:{fill:'#FFF2A8'},parentId:null,orderKey:String(index).padStart(3,'0')}}));
    const humanActor={kind:'human' as const,actorId:FULLSTACK_E2E.userId,orgId:FULLSTACK_E2E.orgId,role:'owner' as const,scopes:['board:read' as const,'board:write' as const],delegatedBy:null};
    const first=await call(api,token,'POST',`/v1/whiteboards/${boardId}/operations`,{apiVersion:'2026-09-01',requestId:randomUUID(),boardId,expectedRevision:{epoch:1,seq:0},actor:humanActor,commands:notes,provenance:{source:'human',model:null,skill:null,sourceArtifactId:null,sourceRevision:null,layoutHash:null,inputObjectIds:[]}});const receipt=await first.json() as{revision:{seq:number}};
    const proposalId=randomUUID(),aiActor={kind:'ai' as const,actorId:FULLSTACK_E2E.agentId,orgId:FULLSTACK_E2E.orgId,role:'owner' as const,scopes:['board:write' as const],delegatedBy:FULLSTACK_E2E.userId};const proposalResponse=await call(api,token,'POST',`/v1/whiteboards/${boardId}/ai-proposals`,{proposalId,actorId:aiActor.actorId,baseRevision:{epoch:1,seq:receipt.revision.seq},action:{type:'arrange',objectIds:notes.map((_,index)=>`ai-note-${index}`),layout:'grid',commands:notes.map((_,index)=>({type:'geometry',id:`ai-note-${index}`,geometry:geometry(index)}))},provenance:{source:'ai-proposal',model:'ignored-client',skill:'ignored-client',sourceArtifactId:null,sourceRevision:null,layoutHash:null,inputObjectIds:[]}});const previewStatus=(await proposalResponse.json()as{status:string}).status;expect(previewStatus).toBe('preview');
    await page.goto(`/studio/board/${boardId}?proposal=${proposalId}`);await expect(page.getByTestId('board-ai-proposal')).toBeVisible();await page.getByTestId('board-ai-confirm').click();await expect(page.getByTestId('board-ai-proposal')).toHaveCount(0);
    const confirmedStatus=((await(await call(api,token,'GET',`/v1/whiteboards/${boardId}/ai-proposals/${proposalId}`)).json())as{status:string}).status;expect(confirmedStatus).toBe('confirmed');
    const head=await(await call(api,token,'GET',`/v1/whiteboards/${boardId}/head`)).json()as{epoch:number;seq:number;role:string};const expectedRevision={epoch:head.epoch,seq:head.seq};const artifactId=FULLSTACK_E2E.boardArtifactId,layoutBody={schemaVersion:1 as const,artifactId,orgId:FULLSTACK_E2E.orgId,sourceRevision:'artifact-v1:1',diagramKind:'flowchart' as const,objects:[{sourceId:'artifact-node',kind:'node' as const,geometry:{x:1600,y:100,width:220,height:120,rotation:0},text:'Chat Mermaid node',style:{fill:'#FFFFFF',shape:'rect',direction:'TD'},fromSourceId:null,toSourceId:null}],selectedSourceIds:[]};
    const layout={...layoutBody,layoutHash:computeRenderedLayoutHash(layoutBody)};
    const artifact=await call(api,token,'POST',`/v1/whiteboards/${boardId}/artifact-handoffs`,{requestId:randomUUID(),expectedRevision,layout,offset:{x:24,y:24}});
    const artifactReceipt=await artifact.json() as{revision:{epoch:number;seq:number}};
    const events=await call(api,token,'GET',`/v1/whiteboards/${boardId}/events?afterSeq=0&limit=100`);const pageOfEvents=await events.json() as{events:{type:string;provenance:{layoutHash:string|null}}[];nextSeq:number};const eventTypes=pageOfEvents.events.map(event=>event.type),artifactLayoutHash=pageOfEvents.events[2]?.provenance.layoutHash;expect(eventTypes).toEqual(['ObjectCreated','AIOrganized','ObjectCreated']);expect(artifactLayoutHash).toBe(layout.layoutHash);expect(pageOfEvents.nextSeq).toBe(artifactReceipt.revision.seq);
    await call(api,token,'PUT',`/whiteboards/${boardId}/members`,{userId:FULLSTACK_E2E.memberUserId,role:'viewer'});await call(api,token,'PUT',`/whiteboards/${boardId}/members`,{userId:FULLSTACK_E2E.adminUserId,role:'editor'});displayContext=await browser.newContext({baseURL});const display=await displayContext.newPage(),displayToken=await login(display,FULLSTACK_E2E.adminEmail,FULLSTACK_E2E.adminPassword);const joined=await(await call(api,displayToken,'POST',`/v1/whiteboards/${boardId}/rooms/join`,{roomId:'e2e-room',deviceId:'meeting-room-display',deviceKind:'meeting-display'})).json()as{actorId:string;reconnectToken:string};expect(joined.actorId).toBe('room:e2e-room:meeting-room-display');expect(joined.reconnectToken.length).toBeGreaterThan(16);
    const presentationPath=`/v1/whiteboards/${boardId}/presentation`;
    type Presentation={revision:number;presenterId:string|null;followers:string[];viewport:{x:number;y:number;zoom:number}};
    const readPresentation=async()=>await(await call(api,token!,'GET',`${presentationPath}?roomId=e2e-room`)).json()as Presentation;
    const stablePresentation=async()=>{
      let previousRevision:number|undefined,stableReads=0,current:Presentation|undefined;
      // Room navigation can publish the owner's initial viewport. Observe its
      // real browser requests and stable server receipts before one strict CAS.
      await expect.poll(async()=>{
        current=await readPresentation();
        stableReads=pendingBrowserPresentation.size===0&&current.revision===previousRevision?stableReads+1:0;
        previousRevision=current.revision;return stableReads>=2;
      },{timeout:10_000,intervals:[250,250,500]}).toBe(true);
      return current!;
    };
    const presentationCommand=async(phase:string,authToken:string,command:Record<string,unknown>,reconnectToken?:string)=>test.step(`presentation ${phase}: stable receipt and single CAS`,async()=>{
      const current=await stablePresentation();
      const next=await(await call(api,authToken,'POST',presentationPath,{roomId:'e2e-room',...(reconnectToken?{reconnectToken}:{}),command:{...command,expectedRevision:current.revision}})).json()as Presentation;
      expect(next.revision).toBe(current.revision+1);
      presentationReceipts.push({phase,actorId:command.actorId,expectedRevision:current.revision,committedRevision:next.revision});return next;
    });
    const claimed=await presentationCommand('claim-presenter',token,{type:'claim-presenter',actorId:FULLSTACK_E2E.userId});
    expect(claimed.presenterId).toBe(FULLSTACK_E2E.userId);
    await page.goto(`/studio/board/${boardId}?room=e2e-room`);
    await expect(page.getByRole('button',{name:'图形：Customer theme 0',exact:true}).first()).toBeVisible({timeout:30_000});
    await expect(page.getByRole('button',{name:'图形：Chat Mermaid node',exact:true})).toBeVisible();
    // Playback UI was explicitly removed; meeting-room protocol and actual viewport following remain covered.
    const assertPlaybackHidden=async(target:Page)=>{
      await expect(target.getByTestId('board-presentation-controls')).toHaveCount(0);
      for(const name of ['开始演示','结束演示','交给会议室','跟随演示者','自由浏览'])await expect(target.getByRole('button',{name,exact:true})).toHaveCount(0);
    };
    await assertPlaybackHidden(page);
    const handoff=await presentationCommand('handoff',token,{type:'handoff',actorId:FULLSTACK_E2E.userId,toActorId:joined.actorId});
    const handoffActorId=handoff.presenterId;expect(handoffActorId).toBe(joined.actorId);expect((await readPresentation()).presenterId).toBe(joined.actorId);
    followerContext=await browser.newContext({baseURL});const follower=await followerContext.newPage();
    const followerToken=await login(follower,FULLSTACK_E2E.memberEmail,FULLSTACK_E2E.memberPassword);
    await follower.goto(`/studio/board/${boardId}?room=e2e-room`);
    await expect(follower.getByTestId('board-fabric-surface')).toBeVisible({timeout:30_000});await assertPlaybackHidden(follower);
    const followed=await presentationCommand('follow',followerToken,{type:'follow',actorId:FULLSTACK_E2E.memberUserId});
    expect(followed.followers).toContain(FULLSTACK_E2E.memberUserId);
    const publishViewport=async(viewport:Presentation['viewport'])=>{
      return presentationCommand('viewport',displayToken,{type:'viewport',actorId:joined.actorId,viewport},joined.reconnectToken);
    };
    const visibleViewport=async()=>({x:Number(await follower.getByTestId('board-fabric-surface').getAttribute('data-viewport-pan-x')),y:Number(await follower.getByTestId('board-fabric-surface').getAttribute('data-viewport-pan-y')),zoom:Number(await follower.getByTestId('board-fabric-surface').getAttribute('data-viewport-zoom'))});
    const firstViewport={x:137,y:-91,zoom:.7},secondViewport={x:-215,y:164,zoom:.85};
    await publishViewport(firstViewport);await expect.poll(visibleViewport,{timeout:15_000}).toEqual(firstViewport);
    await publishViewport(secondViewport);await expect.poll(visibleViewport,{timeout:15_000}).toEqual(secondViewport);const enteredFollowMode=true;
    const left=await presentationCommand('leave-follow',followerToken,{type:'leave-follow',actorId:FULLSTACK_E2E.memberUserId});
    expect(left.followers).not.toContain(FULLSTACK_E2E.memberUserId);
    // Wait for the existing room polling response to acknowledge leaving before publishing another viewport.
    await follower.waitForResponse(async response=>response.request().method()==='GET'&&response.url().includes(`/whiteboards/${boardId}/presentation?roomId=e2e-room`)&&response.ok()&&((await response.json())as Presentation).revision>=left.revision);
    const thirdViewport={x:430,y:-287,zoom:1.1};const finalPresentation=await publishViewport(thirdViewport);
    await follower.waitForResponse(async response=>response.request().method()==='GET'&&response.url().includes(`/whiteboards/${boardId}/presentation?roomId=e2e-room`)&&response.ok()&&((await response.json())as Presentation).revision>=finalPresentation.revision);
    await expect.poll(visibleViewport).toEqual(secondViewport);const leftFollowMode=true;
    await assertPlaybackHidden(follower);
    await info.attach('ai-api-evidence',{body:JSON.stringify({version:1,kind:'board-ai-api',proposal:{id:proposalId,previewStatus,confirmedStatus},artifact:{artifactId,sourceRevision:layout.sourceRevision,layoutHash:layout.layoutHash,expectedRevision,committedRevision:artifactReceipt.revision},events:{types:eventTypes,nextSeq:pageOfEvents.nextSeq,artifactLayoutHash},meetingRoom:{roomId:'e2e-room',joinedActorId:joined.actorId,handoffActorId,presentationReceipts},follower:{enteredFollowMode,leftFollowMode,firstViewport,secondViewport,thirdViewport,finalVisibleViewport:await visibleViewport()},playbackControlsHidden:true}),contentType:'application/json'});
  }catch(error){failures.push(error);}finally{page.off('request',onBrowserRequest);page.off('requestfinished',onBrowserSettled);page.off('requestfailed',onBrowserSettled);try{if(boardId&&token){const board=await(await call(api,token,'GET',`/whiteboards/${boardId}`)).json()as{archived:boolean;lifecycleRevision:number};if(!board.archived)await call(api,token,'PATCH',`/whiteboards/${boardId}`,{archived:true,expectedLifecycleRevision:board.lifecycleRevision});}}catch(error){failures.push(error);}finally{for(const ownedContext of [followerContext,displayContext,context]){if(ownedContext)try{await ownedContext.close();}catch(error){failures.push(error);}}}}
  if(failures.length)throw new AggregateError(failures,'Board AI API first acceptance failure followed by owned cleanup failures');
});
