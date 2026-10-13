import {test, expect, type Page} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {FULLSTACK_E2E as F} from './fullstack-smoke-fixture';
import {boardLogin, boardApi, canonicalBoardSnapshot, createAcceptanceBoard} from './board-acceptance-support';
import {runtimeSourceIdentity, observeRuntimeChunks, verifyRuntimeIdentity} from './board-runtime-evidence';
import {connectorAuthorityTransport} from './support/connector-authority-transport';
import {deleteOwnedConnectorFixture} from './support/connector-acceptance-fixture';
import {expectBoardSynced} from './support/board-sync-status';

type View = {zoom:number;panX:number;panY:number};
const initial: View = {zoom:1,panX:0,panY:0};
async function view(page:Page):Promise<View> {
  return page.getByTestId('board-fabric-surface').evaluate(surface=>{
    const value={zoom:Number(surface.getAttribute('data-viewport-zoom')),
      panX:Number(surface.getAttribute('data-viewport-pan-x')),panY:Number(surface.getAttribute('data-viewport-pan-y'))};
    if (![value.zoom,value.panX,value.panY].every(Number.isFinite)||value.zoom<=0) throw new Error('INVALID_ACTUAL_VIEWPORT');
    return value;
  });
}
async function restored(page:Page,expected:View) {
  await expectBoardSynced(page,30_000);
  await expect.poll(()=>view(page)).toEqual(expected);
  await expect(page.getByTestId('board-zoom-value')).toHaveText(`${Math.round(expected.zoom*100)}%`);
}
async function canvasAnchor(page:Page) {
  return page.getByTestId('board-fabric-surface').evaluate(surface=>{
    const canvas=surface.querySelector('canvas.upper-canvas');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('ACTUAL_UPPER_CANVAS_REQUIRED');
    const box=canvas.getBoundingClientRect();
    if (![box.x,box.y,box.width,box.height].every(Number.isFinite)||box.width<160||box.height<160) throw new Error('INVALID_CANVAS_BOUNDS');
    for(const [localX,localY] of [[80,100],[120,140],[200,120]]) {
      const x=box.x+localX!,y=box.y+localY!;
      if (document.elementFromPoint(x,y)===canvas) return {x,y,localX:localX!,localY:localY!};
    }
    throw new Error('NO_REAL_CANVAS_WHEEL_TARGET');
  });
}

test('#5675 real pan/zoom persist immediately across reload, boards and users',async({page,request:api},info)=>{
  test.setTimeout(240_000); await page.setViewportSize({width:1440,height:900});
  const source=runtimeSourceIdentity(),chunks=observeRuntimeChunks(page),transport=connectorAuthorityTransport();
  let actor:string=F.userId; transport.observe(page,'original',()=>actor);
  const owned:Array<{id:string;title:string}>=[],records:unknown[]=[],cleanupErrors:unknown[]=[];
  let ownerToken='',primary:unknown;
  try {
    let loginPosts=0;
    page.on('request',request=>{if(new URL(request.url()).pathname.endsWith('/auth/login')&&request.method()==='POST')loginPosts++;});
    const login=async(email:string,password:string,userId:string)=>{
      actor=userId;const previous=loginPosts;
      const pending=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/auth/login')&&response.request().method()==='POST');
      const token=await boardLogin(page,email,password),response=await pending;
      expect(response.status()).toBe(200);const identity=await response.json();
      expect(identity.userId).toBe(userId);expect(identity.sessionToken).toBe(token);expect(loginPosts).toBe(previous+1);
      return token;
    };
    const logout=async()=>{
      await page.goto('/home');await page.getByTestId('rail-profile-menu').click();
      await page.getByTestId('personal-menu-logout').click();await expect(page).toHaveURL(/\/login$/);
    };
    ownerToken=await login(F.email,F.password,F.userId);
    for(const label of ['A','B']) {
      const title=`#5675 viewport ${label}`,id=await createAcceptanceBoard(api,ownerToken,title);owned.push({id,title});
      await boardApi(api,ownerToken,'PUT',`/whiteboards/${id}/members`,{userId:F.adminUserId,role:'editor'});
    }
    const [a,b]=owned;expect(a).toBeTruthy();expect(b).toBeTruthy();
    const canonicalBefore=await Promise.all(owned.map(board=>canonicalBoardSnapshot(api,ownerToken,board.id)));
    const open=async(id:string,expected:View)=>{await page.goto(`/studio/board/${id}`);await restored(page,expected);await page.getByTestId('board-tool-select').click();};
    const panReload=async(label:string,dx:number,dy:number)=>{
      const previous=await view(page),anchor=await canvasAnchor(page);
      const expected={...previous,panX:previous.panX-dx,panY:previous.panY-dy};
      await page.mouse.move(anchor.x,anchor.y);
      // Real wheel pan followed immediately by navigation: no storage read, RAF,
      // debounce wait or pre-reload DOM poll can conceal a lost last event.
      await page.mouse.wheel(dx,dy);await page.reload();await restored(page,expected);
      records.push({phase:label,previous,expected,actual:await view(page),delta:{x:dx,y:dy}});return expected;
    };
    const zoomReload=async(label:string,deltaY:number)=>{
      const previous=await view(page),anchor=await canvasAnchor(page);
      // Independent fixture oracle for pixel-mode wheel input, safely inside
      // zoom limits: Fabric zoomToPoint preserves the cursor's world position.
      const zoom=previous.zoom*Math.pow(.998,deltaY);
      const expected={zoom,panX:anchor.localX-(anchor.localX-previous.panX)*(zoom/previous.zoom),
        panY:anchor.localY-(anchor.localY-previous.panY)*(zoom/previous.zoom)};
      await page.mouse.move(anchor.x,anchor.y);await page.keyboard.down('Control');
      try {await page.mouse.wheel(0,deltaY);await page.reload();} finally {await page.keyboard.up('Control');}
      await expectBoardSynced(page,30_000);
      // The same floating-point affine computation may round at its final ulp.
      await expect.poll(async()=>{const actual=await view(page);return Math.max(Math.abs(actual.zoom-expected.zoom),Math.abs(actual.panX-expected.panX),Math.abs(actual.panY-expected.panY));}).toBeLessThan(1e-10);
      const actual=await view(page);await expect(page.getByTestId('board-zoom-value')).toHaveText(`${Math.round(expected.zoom*100)}%`);
      records.push({phase:label,previous,expected,actual,deltaY,anchor});return actual;
    };
    await open(a!.id,initial);records.push({phase:'runtime-before',...await verifyRuntimeIdentity(api,source,await chunks())});
    await panReload('owner-A-immediate-pan',47,31);const ownerA=await zoomReload('owner-A-immediate-zoom',-83);
    await open(b!.id,initial);await panReload('owner-B-immediate-pan',-61,53);const ownerB=await zoomReload('owner-B-immediate-zoom',67);
    expect(ownerA).not.toEqual(ownerB);await open(a!.id,ownerA);await open(b!.id,ownerB);
    // Reuse the SAME context/storage origin. A fresh context would hide an
    // incorrectly board-only key and cannot prove current-user isolation.
    await logout();await login(F.adminEmail,F.adminPassword,F.adminUserId);
    await open(a!.id,initial);await panReload('editor-A-immediate-pan',-29,-73);const editorA=await zoomReload('editor-A-immediate-zoom',51);
    expect(editorA).not.toEqual(ownerA);await open(b!.id,initial);await open(a!.id,editorA);
    await logout();await login(F.email,F.password,F.userId);
    await open(a!.id,ownerA);await open(b!.id,ownerB);
    await logout();await login(F.adminEmail,F.adminPassword,F.adminUserId);
    await open(a!.id,editorA);await open(b!.id,initial);
    expect(loginPosts).toBe(4);
    expect(await Promise.all(owned.map(board=>canonicalBoardSnapshot(api,ownerToken,board.id)))).toEqual(canonicalBefore);
    expect(transport.snapshot().dropped).toBe(0);
    expect(transport.snapshot().events.filter(event=>event.direction==='sent'&&event.type==='update')).toEqual([]);
    records.push({phase:'final',ownerA,ownerB,editorA,canonicalBefore,runtimeAfter:await verifyRuntimeIdentity(api,source,await chunks())});
    await page.screenshot({path:info.outputPath('viewport-isolation-final.png')});
  } catch(error) {primary=error;try{await page.screenshot({path:info.outputPath('viewport-primary-failure.png')});}catch(captureError){cleanupErrors.push(captureError);}}
  finally {
    records.push({phase:'safe-transport',...transport.snapshot()});
    for(const board of owned)try{await deleteOwnedConnectorFixture(api,ownerToken,board.id,F.userId,board.title);}catch(error){cleanupErrors.push(error);}
    const path=info.outputPath('viewport-persistence.json');
    try{await writeFile(path,JSON.stringify({source,status:primary||cleanupErrors.length?'failed':'passed',records},null,2),{mode:0o600});await info.attach('viewport-persistence',{path,contentType:'application/json'});}catch(error){cleanupErrors.push(error);}
  }
  if(primary){if(cleanupErrors.length)throw new AggregateError([primary,...cleanupErrors],'VIEWPORT_PRIMARY_AND_CLEANUP_FAILURE');throw primary;}
  if(cleanupErrors.length)throw new AggregateError(cleanupErrors,'VIEWPORT_CLEANUP_FAILURE');
});
