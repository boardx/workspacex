import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { computeRenderedLayoutHash, renderedLayoutToCommands } from '@repo/whiteboard-core';
import { SESSION_TOKEN_STORAGE_KEY } from '../lib/api-client';
import { FULLSTACK_E2E } from './fullstack-smoke-fixture';

test.describe.configure({mode:'serial',timeout:120_000});
const apiOrigin=()=>`http://127.0.0.1:${process.env.WORKSPACEX_API_PORT}`;
async function login(page:Page){await page.goto('/login');await page.getByTestId('login-email').fill(FULLSTACK_E2E.adminEmail);await page.getByTestId('login-password').fill(FULLSTACK_E2E.adminPassword);await page.getByTestId('login-submit').click();await expect(page).toHaveURL(/\/projects$/);const token=await page.evaluate(key=>localStorage.getItem(key),SESSION_TOKEN_STORAGE_KEY);expect(token).toBeTruthy();return token!;}
async function call(api:APIRequestContext,token:string,method:string,path:string,data?:unknown){const response=await api.fetch(`${apiOrigin()}${path}`,{method,headers:{Authorization:`Bearer ${token}`},data});expect(response.ok(),`${method} ${path}: ${response.status()} ${await response.text()}`).toBe(true);return response;}
const geometry=(index:number)=>({x:100+(index%6)*230,y:100+Math.floor(index/6)*190,width:200,height:160,rotation:0});

test('public API, AI proposal confirmation and event subscription use the canonical Board document',async({browser,request:api,baseURL})=>{
  const context=await browser.newContext({baseURL}),page=await context.newPage();let boardId:string|undefined,token:string|undefined;
  try{token=await login(page);const created=await call(api,token,'POST','/whiteboards',{requestId:randomUUID(),name:`AI API ${randomUUID()}`});boardId=(await created.json() as{id:string}).id;
    const notes=Array.from({length:30},(_,index)=>({type:'create',object:{id:`ai-note-${index}`,schemaVersion:1,kind:'sticky',geometry:geometry(index),text:`Customer theme ${index%3}`,style:{fill:'#FFF2A8'},parentId:null,orderKey:String(index).padStart(3,'0')}}));
    const actor={kind:'ai' as const,actorId:'agent-e2e',orgId:FULLSTACK_E2E.orgId,role:'owner' as const,scopes:['board:read' as const,'board:write' as const],delegatedBy:FULLSTACK_E2E.adminUserId};
    const first=await call(api,token,'POST',`/v1/whiteboards/${boardId}/operations`,{apiVersion:'2026-09-01',requestId:randomUUID(),boardId,expectedRevision:{epoch:1,seq:0},actor,commands:notes,provenance:{source:'ai-proposal',model:'e2e-deterministic',skill:'cluster',sourceArtifactId:null,sourceRevision:null,layoutHash:null,inputObjectIds:[]}});
    const receipt=await first.json() as{revision:{seq:number};events:{type:string}[]};expect(receipt.events).toHaveLength(1);expect(receipt.events[0]?.type).toBe('AIOrganized');
    const artifactId=randomUUID(),layoutBody={schemaVersion:1 as const,artifactId,orgId:FULLSTACK_E2E.orgId,sourceRevision:'chat-r1',diagramKind:'flowchart' as const,objects:[{sourceId:'artifact-node',kind:'node' as const,geometry:{x:1600,y:100,width:220,height:120,rotation:0},text:'Chat Mermaid node',style:{fill:'#FFFFFF'},fromSourceId:null,toSourceId:null}],selectedSourceIds:[]};
    const layout={...layoutBody,layoutHash:computeRenderedLayoutHash(layoutBody)},humanActor={...actor,kind:'human' as const,actorId:FULLSTACK_E2E.adminUserId,scopes:['board:read' as const,'board:write' as const,'artifact:read' as const],delegatedBy:null};
    const artifact=await call(api,token,'POST',`/v1/whiteboards/${boardId}/operations`,{apiVersion:'2026-09-01',requestId:randomUUID(),boardId,expectedRevision:{epoch:1,seq:receipt.revision.seq},actor:humanActor,commands:renderedLayoutToCommands(layout,humanActor,FULLSTACK_E2E.orgId),provenance:{source:'chat-artifact',model:null,skill:null,sourceArtifactId:artifactId,sourceRevision:'chat-r1',layoutHash:layout.layoutHash,inputObjectIds:[]}});
    const artifactReceipt=await artifact.json() as{revision:{seq:number}};
    const events=await call(api,token,'GET',`/v1/whiteboards/${boardId}/events?afterSeq=0&limit=100`);const pageOfEvents=await events.json() as{events:{type:string;provenance:{layoutHash:string|null}}[];nextSeq:number};expect(pageOfEvents.events.map(event=>event.type)).toEqual(['AIOrganized','ObjectCreated']);expect(pageOfEvents.events[1]?.provenance.layoutHash).toBe(layout.layoutHash);expect(pageOfEvents.nextSeq).toBe(artifactReceipt.revision.seq);
    await page.goto(`/studio/board/${boardId}`);await expect(page.getByTestId('collaborative-editor')).toBeVisible();await expect(page.getByRole('button',{name:'图形：Customer theme 0',exact:true}).first()).toBeVisible({timeout:30_000});await expect(page.getByRole('button',{name:'图形：Chat Mermaid node',exact:true})).toBeVisible();
  }finally{try{if(boardId&&token)await call(api,token,'PATCH',`/whiteboards/${boardId}`,{archived:true});}finally{await context.close();}}
});
