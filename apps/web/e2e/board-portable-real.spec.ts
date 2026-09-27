import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {expect,test,type Page} from '@playwright/test';
import {FULLSTACK_E2E as F} from './fullstack-smoke-fixture';
import {SESSION_TOKEN_STORAGE_KEY} from '../lib/api-client';
import {producePortableRoundtripEvidence,producePortableRevocationRaceEvidence} from './support/board-portable-producer';
const apiOrigin=()=>`http://127.0.0.1:${process.env.WORKSPACEX_API_PORT}`;
async function login(page:Page,peer=false){await page.goto('/login');await page.getByTestId('login-email').fill(peer?F.leadEmail:F.adminEmail);await page.getByTestId('login-password').fill(peer?F.leadPassword:F.adminPassword);await page.getByTestId('login-submit').click();await expect(page).toHaveURL(/\/projects$/);return(await page.evaluate(key=>localStorage.getItem(key),SESSION_TOKEN_STORAGE_KEY))!;}
async function pixels(page:Page){await expect.poll(()=>page.locator('canvas.lower-canvas').evaluateAll(items=>items.some(item=>{const canvas=item as HTMLCanvasElement,ctx=canvas.getContext('2d');if(!ctx)return false;const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;let n=0;for(let i=0;i<data.length;i+=4)if(data[i]===231&&data[i+1]===29&&data[i+2]===73&&data[i+3]===255)n++;return n>100;}))).toBe(true);}
test('portable nested board and media survive import, refresh, peer, and locked revocation',async({page,browser,request,baseURL},info)=>{
 const token=await login(page),headers={Authorization:`Bearer ${token}`};
 const call=async(method:string,path:string,data?:unknown)=>{const r=await request.fetch(apiOrigin()+path,{method,headers,data});expect(r.ok(),`${method} ${path}: ${r.status()}`).toBe(true);return r;};
 const boards:string[]=[];const peerContext=await browser.newContext({baseURL}),peer=await peerContext.newPage();
 try{
  const peerToken=await login(peer,true);const source=(await(await call('POST','/whiteboards',{requestId:randomUUID(),name:'Synthetic portable fixture'})).json()).id;boards.push(source);
  const object=(id:string,kind:string,x:number,y:number,parentId:string|null=null)=>({id,schemaVersion:1,kind,parentId,text:id,orderKey:id,geometry:{x,y,width:120,height:100,rotation:0},style:{}});
  await call('POST',`/whiteboards/${source}/commands`,{requestId:randomUUID(),epoch:1,commands:[{type:'create',object:{...object('panel','frame',0,0),geometry:{x:0,y:0,width:500,height:350,rotation:0}}},{type:'create',object:object('note-a','sticky',24,48,'panel')},{type:'create',object:object('note-b','sticky',210,48,'panel')},{type:'create',object:{...object('edge','connector',144,98),text:'depends on',connector:{from:'note-a',to:'note-b',label:'depends on',semanticRelation:'depends_on'}}}]});
  await page.goto(`/studio/board/${source}`);await expect(page.getByText(/^已同步/)).toBeVisible();
  const require=createRequire(resolve(__dirname,'../../api/package.json')),sharp=require('sharp');const png=await sharp({create:{width:64,height:48,channels:3,background:'#e71d49'}}).png().toBuffer();
  const upload=page.waitForResponse(r=>r.url().endsWith(`/whiteboards/${source}/assets`)&&r.request().method()==='POST');await page.getByTestId('board-image-input').setInputFiles({name:'portable.png',mimeType:'image/png',buffer:png});expect((await upload).ok()).toBe(true);await pixels(page);await expect(page.getByText(/^已同步/)).toBeVisible();
  const evidence=await producePortableRoundtripEvidence({api:request,sourceUrl:apiOrigin(),targetUrl:apiOrigin(),sourceToken:token,targetToken:token,sourceBoardId:source});boards.push(evidence.targetBoardId);
  await call('PUT',`/whiteboards/${evidence.targetBoardId}/members`,{userId:F.leadUserId,role:'viewer'});
  await page.goto(`/studio/board/${evidence.targetBoardId}`);await pixels(page);await page.reload();await pixels(page);await peer.goto(`/studio/board/${evidence.targetBoardId}`);await pixels(peer);
  await info.attach('portable-confirmed-canvas',{body:await page.screenshot(),contentType:'image/png'});await info.attach('portable-roundtrip',{body:JSON.stringify({...evidence,scope:'same-instance same-tenant distinct-user peer; cross-tenant not claimed'}),contentType:'application/json'});
  await call('PUT',`/whiteboards/${source}/members`,{userId:F.leadUserId,role:'editor'});const exported=await(await call('POST',`/whiteboards/${source}/portable/export`,{})).json();const file={sha256:exported.sha256,sizeBytes:exported.sizeBytes,contentBase64:exported.contentBase64};
  const {Client}=require('pg');const config={host:process.env.PGHOST,port:Number(process.env.PGPORT),database:process.env.PGDATABASE,user:process.env.PGUSER,password:process.env.PGPASSWORD};const locker=new Client(config),observer=new Client(config);await locker.connect();await observer.connect();
  try{await info.attach('portable-revocation-race',{body:JSON.stringify(await producePortableRevocationRaceEvidence({api:request,url:apiOrigin(),editorToken:peerToken,editorId:F.leadUserId,orgId:F.orgId,boardId:source,file,locker,observer})),contentType:'application/json'});}finally{await locker.end();await observer.end();}
 }finally{await peerContext.close();for(const id of boards){const b=await(await call('GET',`/whiteboards/${id}`)).json();if(!b.archived)await call('PATCH',`/whiteboards/${id}`,{archived:true,expectedLifecycleRevision:b.lifecycleRevision});}}
});
