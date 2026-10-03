import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {rotatedPoint,assertNotePlacement} from './wsx-r06-sticky-oracles.mjs';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function createStickyContextFoundation({origin,base,owner,boardId,scheduler,colors,recordShot}){
 const request=async(actor,method,path,data,expectedStatus)=>scheduler.run(async()=>{
  const token=await actor.page.evaluate(()=>localStorage.getItem('wsx.sessionToken'));assert(token);
  const response=await actor.page.request.fetch(origin+path,{method,data,headers:{authorization:`Bearer ${token}`}});
  assert.notEqual(response.status(),429,'429 is a failure, not a retryable acceptance exception');
  if(expectedStatus!==undefined)assert.equal(response.status(),expectedStatus);else assert(response.ok(),`${method} ${path} status ${response.status()}`);
  return response;
 });
 const api=async(actor,method,path,data)=>(await request(actor,method,path,data)).json();
 const board=actor=>actor.boardId??boardId;
 const state=async(actor=owner)=>{
  const id=board(actor),until=Date.now()+5000;
  while(Date.now()<until){
   const before=await api(actor,'GET',`/v1/whiteboards/${id}/head`);
   const exp=await api(actor,'POST',`/whiteboards/${id}/imports/standard-export`,{requestId:randomUUID()}),payload=await api(actor,'GET',exp.downloadPath);
   const bytes=Buffer.from(payload.contentBase64,'base64');assert.equal(bytes.length,exp.sizeBytes);assert.equal(digest(bytes),exp.sha256);
   const parsed=JSON.parse(bytes),after=await api(actor,'GET',`/v1/whiteboards/${id}/head`);
   for(const head of [before,after]){
    assert(Number.isSafeInteger(head.epoch)&&head.epoch>0&&Number.isSafeInteger(head.seq)&&head.seq>=0,'actual head epoch/sequence must be valid');
    assert(['owner','editor','viewer','commenter'].includes(head.role),'actual head role must be explicit');
   }
   assert(Array.isArray(parsed.objects),'actual export must contain the canonical objects array');
   assert.equal(parsed.board.id,id);assert.equal(parsed.board.epoch,exp.epoch);assert.equal(parsed.board.seq,exp.seq);
   if(before.epoch===after.epoch&&before.seq===after.seq&&before.role===after.role&&after.epoch===exp.epoch&&after.seq===exp.seq)return{head:after,objects:parsed.objects};
   await new Promise(resolve=>setTimeout(resolve,150));
  }throw Error('coherent actual head/export snapshot did not settle');
 };
 const poll=async(readerOrPredicate,predicate)=>{
  const reader=predicate?readerOrPredicate:()=>state(),accept=predicate??readerOrPredicate,until=Date.now()+30000;
  while(Date.now()<until){const value=await reader();if(accept(value))return value;await new Promise(resolve=>setTimeout(resolve,150));}
  throw Error('actual canonical/head predicate timeout');
 };
 const surface=(actor=owner)=>actor.page.getByTestId('board-fabric-surface');
 const view=async(actor=owner)=>{
  const bounds=await surface(actor).boundingBox();assert(bounds);
  const values=await surface(actor).evaluate(element=>({panX:Number(element.dataset.viewportPanX),panY:Number(element.dataset.viewportPanY),zoom:Number(element.dataset.viewportZoom),dpr:devicePixelRatio}));
  return{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height,...values};
 };
 const blank=async(actor=owner)=>{
  const v=await view(actor),objects=(await state(actor)).objects;
  for(const[fx,fy]of [[.65,.28],[.25,.28],[.65,.55],[.25,.55],[.5,.4],...[.15,.35,.55,.75,.9].flatMap(x=>[.15,.35,.55,.75].map(y=>[x,y]))]){
   const point={x:v.x+v.width*fx,y:v.y+v.height*fy};
   const blocked=objects.some(object=>{const g=object.geometry,angle=-g.rotation*Math.PI/180,dx=(point.x-v.x-v.panX)/v.zoom-g.x,dy=(point.y-v.y-v.panY)/v.zoom-g.y,x=dx*Math.cos(angle)-dy*Math.sin(angle),y=dx*Math.sin(angle)+dy*Math.cos(angle);return x>=-15/v.zoom&&x<=g.width+15/v.zoom&&y>=-15/v.zoom&&y<=g.height+15/v.zoom;});
   if(!blocked&&await actor.page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.getAttribute('data-fabric')==='top',point))return point;
  }throw Error('native placement lacks a genuinely empty unobstructed point');
 };
 const leaveEditor=async(actor=owner)=>{const input=actor.page.getByTestId('board-thinking-editor');if(await input.isVisible())await input.press('Escape');};
 const clearSelectionNative=async(actor=owner)=>{
  await leaveEditor(actor);const before=await state(actor);await actor.page.getByTestId('board-tool-select').click();const point=await blank(actor);await actor.page.mouse.click(point.x,point.y);
  await actor.page.getByTestId('board-context-toolbar').waitFor({state:'hidden'});assert.deepEqual(await state(actor),before,'native deselection must not write canonical state');
 };
 const choose=async(first,second,third)=>{
  const actor=typeof first==='string'?owner:first,variant=typeof first==='string'?first:second,color=typeof first==='string'?second:third;
  assert(colors[color]);await leaveEditor(actor);await actor.page.getByTestId('board-tool-select').click();
  await actor.page.getByTestId('board-add-sticky').click();await actor.page.getByTestId(`board-sticky-default-${color}`).click();await actor.page.getByTestId(`board-sticky-${variant}`).click();
 };
 const placeArmedStickyNative=async(actor,point)=>{
  const before=await state(actor),v=await view(actor);await actor.page.mouse.click(point.x,point.y);
  const after=await poll(()=>state(actor),value=>value.head.seq===before.head.seq+1&&value.objects.length===before.objects.length+1),created=after.objects.filter(object=>!before.objects.some(old=>old.id===object.id));
  assert.equal(created.length,1);assert.equal(await actor.page.getByTestId('board-tool-select').getAttribute('aria-pressed'),'true');
  assertNotePlacement(created[0].geometry,point,v);await leaveEditor(actor);return created[0].id;
 };
 const createStickyNative=async(first,second,third,fourth)=>{
  const actor=typeof first==='string'?owner:first,variant=typeof first==='string'?first:second,color=typeof first==='string'?second:third;
  const point=typeof first==='string'?third:fourth;await choose(actor,variant,color);
  return placeArmedStickyNative(actor,point??await blank(actor));
 };
 const selectNative=async(actor,id)=>{
  await leaveEditor(actor);await actor.page.getByTestId('board-tool-select').click();
  await actor.page.getByTestId('board-a11y-mirror').locator(`li[data-object-id="${id}"]`).getByRole('button').focus();await actor.page.keyboard.press('Enter');await leaveEditor(actor);
 };
 const activateEditorNative=async(actor,id)=>{
  const object=(await state(actor)).objects.find(item=>item.id===id);assert(object);const v=await view(actor),p=rotatedPoint(object.geometry,{x:object.geometry.width/2,y:object.geometry.height/2});
  await actor.page.mouse.dblclick(v.x+v.panX+p.x*v.zoom,v.y+v.panY+p.y*v.zoom);await actor.page.getByTestId('board-thinking-editor').waitFor();
 };
 const editNative=async(actor,id,text,mode)=>{
  await activateEditorNative(actor,id);const input=actor.page.getByTestId('board-thinking-editor');await input.fill(text);
  if(mode==='blur')await actor.page.getByTestId('board-tool-select').click();else await input.press('ControlOrMeta+Enter');
  await poll(()=>state(actor),value=>value.objects.find(object=>object.id===id)?.text===text);await leaveEditor(actor);
 };
 const deleteStickyNative=async(actor,id)=>{
  await selectNative(actor,id);const before=await state(actor);await actor.page.keyboard.press('Delete');
  return poll(()=>state(actor),value=>value.head.seq===before.head.seq+1&&!value.objects.some(object=>object.id===id));
 };
 const reloadActor=async(actor)=>{await actor.page.reload();await surface(actor).waitFor();return state(actor);};
 const shot=async(first,second)=>typeof first==='string'?recordShot(owner,first):recordShot(first,second);
 return{request,api,state,poll,view,blank,surface,colors,choose,leaveEditor,clearSelectionNative,createStickyNative,placeArmedStickyNative,selectNative,activateEditorNative,editNative,deleteStickyNative,reloadActor,shot};
}
