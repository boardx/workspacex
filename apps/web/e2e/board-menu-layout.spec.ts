import {test,expect,type Page,type Locator} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {FULLSTACK_E2E as F} from './fullstack-smoke-fixture';
import {boardLogin,canonicalBoardSnapshot,createAcceptanceBoard,object,createCommands,operate} from './board-acceptance-support';
import {runtimeSourceIdentity,observeRuntimeChunks,verifyRuntimeIdentity} from './board-runtime-evidence';
import {deleteOwnedConnectorFixture} from './support/connector-acceptance-fixture';
import {expectBoardSynced} from './support/board-sync-status';

const dock=['sticky','text','shape','draw','connector','more'];
async function checkCue(cue:Locator){
 await expect(cue).toBeVisible();
 const bounds=await cue.evaluate(el=>{
  const button=el.closest('button');if(!button)throw new Error('CUE_WITHOUT_BUTTON');
  const a=el.getBoundingClientRect(),b=button.getBoundingClientRect();
  const preview=button.querySelector('[data-board-drag-preview]');
  const p=preview?getComputedStyle(preview):null;
  return {width:a.width,height:a.height,inside:a.left>=b.left-.5&&a.top>=b.top-.5&&a.right<=b.right+.5&&a.bottom<=b.bottom+.5,
   inPreview:preview?.contains(el)??false,preview:p?{width:parseFloat(p.width),height:parseFloat(p.height)}:null};
 });
 expect(bounds.width).toBeCloseTo(8,1);expect(bounds.height).toBeCloseTo(8,1);
 expect(bounds.inside).toBe(true);expect(bounds.inPreview).toBe(false);
 if(bounds.preview)expect(bounds.preview).toEqual({width:24,height:24});
}
async function checkAllCues(page:Page){
 const cues=page.locator('button svg.submenu:visible');expect(await cues.count()).toBeGreaterThan(0);
 for(let i=0;i<await cues.count();i++)await checkCue(cues.nth(i));
}
async function select(page:Page,id:string){
 const row=page.getByTestId(`board-a11y-object-${id}`);await row.focus();await row.press('Enter');
 await expect(row).toHaveAttribute('aria-pressed','true');
 if(id!=='menu-edge'){
  await expect(page.getByTestId('board-thinking-editor')).toBeVisible();await page.keyboard.press('Escape');
  await expect(page.getByTestId('board-thinking-editor')).toBeHidden();
 }
}
async function checkPopover(page:Page,button:Locator){
 const icons=()=>button.locator('svg:not(.submenu)').evaluateAll(elements=>elements.map(el=>{const r=el.getBoundingClientRect();return {width:r.width,height:r.height};}));
 const before=await icons();await button.click();
 const panel=page.getByTestId('board-tool-popover');await expect(panel).toBeVisible();
 const direction=await panel.getAttribute('data-board-popover-placement');
 await expect(button.locator('svg.submenu')).toHaveAttribute('data-direction',direction!);
 await checkAllCues(page);expect(await icons()).toEqual(before);
 await page.keyboard.press('Escape');await expect(panel).toBeHidden();
}
for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
 test(`#5668/#5667 actual Board menus ${viewport.width}px`,async({page,request:api},info)=>{
  test.setTimeout(180_000);await page.setViewportSize(viewport);
  const source=runtimeSourceIdentity(),chunks=observeRuntimeChunks(page),records:unknown[]=[];
  let token='',boardId='',primary:unknown;const secondary:unknown[]=[];
  const title=`#5668 Board menu ${viewport.width}`;
  try{
   let posts=0;page.on('request',r=>{if(new URL(r.url()).pathname.endsWith('/auth/login')&&r.method()==='POST')posts++;});
   const response=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/auth/login')&&r.request().method()==='POST');
   token=await boardLogin(page);const login=await response;expect(login.status()).toBe(200);
   const actor=await login.json();expect(actor.userId).toBe(F.userId);expect(actor.sessionToken).toBe(token);expect(posts).toBe(1);
   boardId=await createAcceptanceBoard(api,token,title);
   await operate(api,token,boardId,createCommands([object('menu-a','sticky',100,180,'A',140,100),object('menu-b','sticky',420,180,'B',140,100),
    {...object('menu-edge','connector',240,230,'',180,1),connector:{from:'menu-a',to:'menu-b',fromAnchor:'right',toAnchor:'left',type:'straight',startStyle:'none',endStyle:'arrow'}}]));
   await page.goto(`/studio/board/${boardId}`);await expectBoardSynced(page,30_000);
   records.push({phase:'runtime-before',...await verifyRuntimeIdentity(api,source,await chunks())});
   for(const kind of dock){
    const button=page.getByTestId(`board-add-${kind}`);await button.scrollIntoViewIfNeeded();
    await checkCue(page.getByTestId(`board-add-${kind}-submenu`));
    await button.click();await expect(button).toHaveAttribute('aria-expanded','true');
    await expect(page.getByTestId(`board-add-${kind}-submenu`)).toHaveAttribute('data-direction','above');
    await checkAllCues(page);await page.screenshot({path:info.outputPath(`dock-${kind}-${viewport.width}.png`)});
    await page.keyboard.press('Escape');await expect(button).toHaveAttribute('aria-expanded','false');
    await page.getByTestId('board-tool-select').click();
   }
   await select(page,'menu-a');
   // Every contextual trigger present for this selected sticky is exercised.
   const contextual=page.getByTestId('board-object-quick-actions').locator('button').filter({has:page.locator('svg.submenu')});
   expect(await contextual.count()).toBeGreaterThan(0);
   for(let i=0;i<await contextual.count();i++)await checkPopover(page,contextual.nth(i));
   await select(page,'menu-edge');await expect(page.getByTestId('board-connector-toolbar')).toBeVisible();
   const connectorTriggers=page.getByTestId('board-connector-toolbar').locator('button').filter({has:page.locator('svg.submenu')});
   expect(await connectorTriggers.count()).toBeGreaterThanOrEqual(5);
   for(let i=0;i<await connectorTriggers.count();i++)await checkPopover(page,connectorTriggers.nth(i));
   await page.getByTestId('board-connector-color-open').click();
   // Native color wells have no universal textbox role; select by stable accessible name and type.
   const input=page.locator('input[type="color"][aria-label="连接线颜色自定义"]');
   await expect(input).toHaveCount(1);
   const shape=await input.evaluate(el=>{const a=el.getBoundingClientRect(),b=el.parentElement!.getBoundingClientRect();return{opacity:getComputedStyle(el).opacity,input:{x:a.x,y:a.y,w:a.width,h:a.height},label:{x:b.x,y:b.y,w:b.width,h:b.height}};});
   expect(shape.opacity).toBe('0');expect(shape.input).toEqual(shape.label);expect(shape.label.w).toBe(36);expect(shape.label.h).toBe(36);
   await input.focus();await expect(input).toBeFocused();await page.screenshot({path:info.outputPath(`custom-color-${viewport.width}.png`)});
   await input.fill('#123abc');await expectBoardSynced(page,30_000);
   await expect.poll(async()=> (await canonicalBoardSnapshot(api,token,boardId)).objects.find(o=>o.id==='menu-edge')?.style.stroke).toBe('#123ABC');
   await page.keyboard.press('Escape');await page.reload();await expectBoardSynced(page,30_000);
   expect((await canonicalBoardSnapshot(api,token,boardId)).objects.find(o=>o.id==='menu-edge')?.style.stroke).toBe('#123ABC');
   for(const height of [viewport.height,500]){
    await page.setViewportSize({width:viewport.width,height});
    await page.getByTestId('board-zoom-menu').click();const content=page.getByTestId('board-zoom-content');await expect(content).toBeVisible();
    const side=await content.getAttribute('data-side');const direction=({top:'above',bottom:'below',left:'left',right:'right'} as Record<string,string>)[side!];
    expect(direction).toBeTruthy();await expect(page.getByTestId('board-zoom-submenu-chevron')).toHaveAttribute('data-direction',direction);
    await checkAllCues(page);records.push({phase:'zoom-placement',viewport:{width:viewport.width,height},side,direction});
    await page.screenshot({path:info.outputPath(`zoom-${viewport.width}-${height}.png`)});
    await page.keyboard.press('Escape');await expect(content).toBeHidden();
   }
   expect(posts).toBe(1);records.push({phase:'runtime-after',...await verifyRuntimeIdentity(api,source,await chunks())});
  }catch(error){primary=error;try{await page.screenshot({path:info.outputPath('menu-primary-failure.png')});}catch(error){secondary.push(error);}}
  finally{
   if(boardId&&token)try{await deleteOwnedConnectorFixture(api,token,boardId,F.userId,title);}catch(error){secondary.push(error);}
   try{const path=info.outputPath('menu-layout.json');await writeFile(path,JSON.stringify({source,viewport,status:primary||secondary.length?'failed':'passed',records},null,2),{mode:0o600});await info.attach('menu-layout',{path,contentType:'application/json'});}catch(error){secondary.push(error);}
  }
  if(primary){if(secondary.length)throw new AggregateError([primary,...secondary],'MENU_PRIMARY_AND_CLEANUP_FAILURE');throw primary;}
  if(secondary.length)throw new AggregateError(secondary,'MENU_CLEANUP_FAILURE');
 });
}
