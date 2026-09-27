import {test as base,expect,type Page} from '@playwright/test';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {observeRuntimeChunks,runtimeSourceIdentity,verifyRuntimeIdentity} from './board-runtime-evidence';
import {assertReload as reload,boardApi,canonicalBoardSnapshot} from './board-acceptance-support';
const digest=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
export const test=base.extend<{journeyEvidence:void}>({journeyEvidence:[async({page,request},use,info)=>{
 const sha=runtimeSourceIdentity(),chunks=observeRuntimeChunks(page),cdp=await page.context().newCDPSession(page);
 // Chrome timeline events exclude request headers/tokens; do not record Playwright login traces.
 await cdp.send('Tracing.start',{categories:'devtools.timeline,blink.user_timing',transferMode:'ReturnAsStream'});
 try{await use();}finally{
  const finished=new Promise<string>(resolve=>cdp.once('Tracing.tracingComplete',event=>resolve(event.stream!)));
  await cdp.send('Tracing.end');const stream=await finished;let trace='';
  for(;;){const part=await cdp.send('IO.read',{handle:stream});trace+=part.base64Encoded?Buffer.from(part.data,'base64').toString():part.data;if(part.eof)break;}
  await cdp.send('IO.close',{handle:stream});await cdp.detach();
  const tracePath=info.outputPath('journey-trace.json');await writeFile(tracePath,trace,{mode:0o600});
  expect(JSON.parse(trace).traceEvents.length).toBeGreaterThan(0);
  const runtimeIdentity=await verifyRuntimeIdentity(request,sha,await chunks());
  const observations=info.attachments.filter(a=>a.contentType==='application/json'&&a.body).map(a=>({name:a.name,value:JSON.parse(a.body!.toString())}));
  await writeFile(info.outputPath('journey-result.json'),JSON.stringify({version:1,kind:'board-journey',sha,title:info.title,testId:info.testId,retry:info.retry,
   status:info.status,errors:info.errors.map(e=>e.message),runtimeIdentity,trace:{path:tracePath,sha256:digest(trace)},observations,
   approved:false,score:null,modelOrganizeVerified:false},null,2),{mode:0o600});
 }
},{auto:true}]});
/** Require the persisted canonical API to agree with the independently observed browser after reload. */
export async function assertJourneyReload(page:Page,id:string,rows:Parameters<typeof reload>[2],request:Parameters<typeof boardApi>[0],token:string){
 await reload(page,id,rows);
 const snapshot=await canonicalBoardSnapshot(request,token,id);
 const metadata=await (await boardApi(request,token,'GET',`/whiteboards/${id}`)).json();
 expect(snapshot.boardId).toBe(id);expect(metadata.archived).toBe(false);
 expect(snapshot.objects.map((o:{id:string})=>o.id).sort()).toEqual(rows.map(r=>r.id).sort());
 for(const row of rows){const object=snapshot.objects.find((o:{id:string})=>o.id===row.id);expect(object!.text).toBe(row.text);expect(object!.geometry).toEqual(row.geometry);expect(object!.parentId??'').toBe(row.parentId);}
 await test.info().attach('canonical-reload-result',{body:JSON.stringify({boardId:id,revision:snapshot.revision,objects:snapshot.objects,browserRows:rows}),contentType:'application/json'});
}
