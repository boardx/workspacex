import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {boardLogin,createAcceptanceBoard,createCommands,object,operate,openBoard,canonicalBoardSnapshot,objectPoint,boardHead} from './board-acceptance-support';
import {runtimeSourceIdentity,observeRuntimeChunks,verifyRuntimeIdentity} from './board-runtime-evidence';
import {expectBoardSynced} from './support/board-sync-status';
import {deleteOwnedConnectorFixture} from './support/connector-acceptance-fixture';
import {FULLSTACK_E2E as F} from './fullstack-smoke-fixture';

for(const multiple of [false,true])for(const edge of ['left','right','top','bottom'] as const)test(`selected ${multiple?'multiple widgets':'widget'} drag pans ${edge} edge and commits once`,async({page,request},info)=>{
 const source=runtimeSourceIdentity(),chunks=observeRuntimeChunks(page);
 const token=await boardLogin(page),title=`Edge pan ${randomUUID()}`,board=await createAcceptanceBoard(request,token,title);let primary:unknown;
 try{
  await operate(request,token,board,createCommands([object('edge-a','sticky',200,200,'A',180,180),object('edge-b','sticky',440,200,'B',180,180)]));
  await openBoard(page,board,2);const runtimeBefore=await verifyRuntimeIdentity(request,source,await chunks());const baseline=await canonicalBoardSnapshot(request,token,board);
  const start=await objectPoint(page,'edge-a');
  if(multiple){await page.keyboard.press('ControlOrMeta+a');await expect(page.getByTestId('board-a11y-selection-announcement')).toHaveText('已选择 2 个对象');}
  const surface=page.getByTestId('board-fabric-surface'),bounds=(await surface.boundingBox())!;
  const pan=async()=>({x:Number(await surface.getAttribute('data-viewport-pan-x')),y:Number(await surface.getAttribute('data-viewport-pan-y'))});
  const before=await pan(),position={x:edge==='left'?bounds.x+8:edge==='right'?bounds.x+bounds.width-8:start.x,y:edge==='top'?bounds.y+8:edge==='bottom'?bounds.y+bounds.height-8:start.y};
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(position.x,position.y,{steps:12});
  await expect.poll(async()=>{const current=await pan();return edge==='left'?current.x-before.x:edge==='right'?before.x-current.x:edge==='top'?current.y-before.y:before.y-current.y;}).toBeGreaterThan(20);
  expect(await canonicalBoardSnapshot(request,token,board)).toEqual(baseline);
  const held=await pan();await page.screenshot({path:info.outputPath('held-edge.png')});await page.mouse.up();await expectBoardSynced(page);
  await expect.poll(()=>boardHead(request,token,board)).toEqual({epoch:baseline.revision.epoch,seq:baseline.revision.seq+1});
  const moved=await canonicalBoardSnapshot(request,token,board);expect(moved.objects).toHaveLength(2);
  expect(moved.objects.find(item=>item.id==='edge-a')!.geometry).not.toEqual(baseline.objects.find(item=>item.id==='edge-a')!.geometry);
  if(multiple){const [a,b]=moved.objects,[oldA,oldB]=baseline.objects;expect(a!.geometry.x-oldA!.geometry.x).toBeCloseTo(b!.geometry.x-oldB!.geometry.x,5);expect(a!.geometry.y-oldA!.geometry.y).toBeCloseTo(b!.geometry.y-oldB!.geometry.y,5);}
  else expect(moved.objects.find(item=>item.id==='edge-b')).toEqual(baseline.objects.find(item=>item.id==='edge-b'));
  const released=await pan();await page.waitForTimeout(150);expect(await pan()).toEqual(released);
  await info.attach('edge-pan-local-viewport',{body:JSON.stringify({edge,multiple,before,held,released}),contentType:'application/json'});
  await page.getByRole('button',{name:'撤销',exact:true}).click();await expect.poll(async()=>(await canonicalBoardSnapshot(request,token,board)).objects).toEqual(baseline.objects);
  await expect.poll(()=>boardHead(request,token,board)).toEqual({epoch:baseline.revision.epoch,seq:baseline.revision.seq+2});
  const runtimeAfter=await verifyRuntimeIdentity(request,source,await chunks());
  await info.attach('edge-pan-runtime-proof',{body:JSON.stringify({runtimeBefore,runtimeAfter}),contentType:'application/json'});
 }catch(error){primary=error;}
 finally{try{await page.mouse.up();await deleteOwnedConnectorFixture(request,token,board,F.userId,title);}catch(error){primary=new AggregateError([...(primary?[primary]:[]),error],'Edge pan execution or cleanup failed');}}
 if(primary)throw primary;
});
