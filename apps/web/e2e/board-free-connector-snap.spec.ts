import {test,expect,type Page} from '@playwright/test';
import {FULLSTACK_E2E as F} from './fullstack-smoke-fixture';
import {boardLogin,canonicalBoardSnapshot,createAcceptanceBoard,object,createCommands,operate,dragObject} from './board-acceptance-support';
import {captureBoardLogin} from './support/board-login-capture.mjs';
import {deleteOwnedConnectorFixture} from './support/connector-acceptance-fixture';
import {expectBoardSynced} from './support/board-sync-status';
import {runtimeSourceIdentity,observeRuntimeChunks,verifyRuntimeIdentity} from './board-runtime-evidence';
async function screenPoint(page:Page,x:number,y:number){return page.getByTestId('board-fabric-surface').evaluate((surface,point)=>{const box=surface.getBoundingClientRect(),zoom=Number(surface.getAttribute('data-viewport-zoom')),px=Number(surface.getAttribute('data-viewport-pan-x')),py=Number(surface.getAttribute('data-viewport-pan-y'));const value={x:box.x+px+point.x*zoom,y:box.y+py+point.y*zoom};if(!Number.isFinite(zoom)||zoom<=0||value.x<=box.left||value.x>=box.right||value.y<=box.top||value.y>=box.bottom)throw new Error('FREE_SNAP_POINT_OUTSIDE_CANVAS');return value;},{x,y});}
for(const completion of ['enter','doubleclick'] as const)test(`#5677 free initial ${completion} binds sticky and follows its move after reload`,async({page,request:api},info)=>{
 test.setTimeout(180_000);await page.setViewportSize({width:1440,height:900});const source=runtimeSourceIdentity(),chunks=observeRuntimeChunks(page);const title=`#5677 free ${completion}`;let token='',board='',primary:unknown;
 try{
  const login=await captureBoardLogin(page,()=>boardLogin(page));token=login.token;expect(login.posts).toBe(1);expect(login.status).toBe(200);expect(login.body).toMatchObject({userId:F.userId,sessionToken:token});
  board=await createAcceptanceBoard(api,token,title);await operate(api,token,board,createCommands([object('free-target','sticky',600,320,'Target',160,100)]));await page.goto(`/studio/board/${board}`);await expectBoardSynced(page);await verifyRuntimeIdentity(api,source,await chunks());
  await page.getByTestId('board-add-connector').click();await page.getByTestId('board-connector-free').click();
  const start=await screenPoint(page,200,220),middle=await screenPoint(page,420,180),end=await screenPoint(page,680,320);
  await page.mouse.click(start.x,start.y);await page.mouse.click(middle.x,middle.y);await page.mouse.move(end.x,end.y);
  await expect(page.getByTestId('board-connector-snap-cue')).toHaveAttribute('data-target-id','free-target');
  if(completion==='doubleclick')await page.mouse.dblclick(end.x,end.y);else{await page.mouse.click(end.x,end.y);await page.keyboard.press('Enter');}
  await expectBoardSynced(page);const created=await canonicalBoardSnapshot(api,token,board),edge=created.objects.find(value=>value.kind==='connector')!;expect(created.objects).toHaveLength(2);expect(edge.connector).toMatchObject({type:'free',fromPoint:{x:200,y:220},to:'free-target',toAnchor:'top',route:{kind:'free',waypoints:[{x:420,y:180}]}});expect(edge.connector).not.toHaveProperty('toPoint');
  await page.reload();await expectBoardSynced(page);expect((await canonicalBoardSnapshot(api,token,board)).objects).toEqual(created.objects);
  await dragObject(page,'free-target',40,30);const moved=await canonicalBoardSnapshot(api,token,board),target=moved.objects.find(value=>value.id==='free-target')!,movedEdge=moved.objects.find(value=>value.id===edge.id)!;expect(movedEdge.connector).toEqual(edge.connector);expect(movedEdge.geometry).not.toEqual(edge.geometry);
  const row=page.getByTestId('board-a11y-mirror').locator(`[data-object-id="${edge.id}"]`);await expect(row).toHaveAttribute('data-connector-end',JSON.stringify({x:target.geometry.x+target.geometry.width/2,y:target.geometry.y}));await page.reload();await expectBoardSynced(page);expect((await canonicalBoardSnapshot(api,token,board)).objects).toEqual(moved.objects);await verifyRuntimeIdentity(api,source,await chunks());
  await info.attach('free-initial-binding',{body:JSON.stringify({source,completion,created:created.revision,moved:moved.revision,edgeId:edge.id}),contentType:'application/json'});
 }catch(error){primary=error;}finally{if(board&&token)try{await deleteOwnedConnectorFixture(api,token,board,F.userId,title);}catch(error){primary=new AggregateError([...(primary?[primary]:[]),error],'FREE_SNAP_EXECUTION_CLEANUP');}}if(primary)throw primary;
});
