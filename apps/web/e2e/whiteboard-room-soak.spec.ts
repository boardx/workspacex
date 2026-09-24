import {randomUUID} from 'node:crypto';
import {expect,test,type APIRequestContext,type Page} from '@playwright/test';
import {SESSION_TOKEN_STORAGE_KEY} from '../lib/api-client';
import {FULLSTACK_E2E} from './fullstack-smoke-fixture';

const enabled=process.env.BOARD_ROOM_SOAK==='1';
const minutes=Number(process.env.BOARD_ROOM_SOAK_MINUTES??'30');
const apiUrl=()=>process.env.WHITEBOARD_API_URL??(process.env.WORKSPACEX_API_PORT?`http://127.0.0.1:${process.env.WORKSPACEX_API_PORT}`:'');
async function login(page:Page){await page.goto('/login');await page.getByTestId('login-email').fill(process.env.WHITEBOARD_OWNER_EMAIL??FULLSTACK_E2E.adminEmail);await page.getByTestId('login-password').fill(process.env.WHITEBOARD_OWNER_PASSWORD??FULLSTACK_E2E.adminPassword);await page.getByTestId('login-submit').click();await expect(page).toHaveURL(/\/projects$/,{timeout:30_000});return (await page.evaluate(key=>localStorage.getItem(key),SESSION_TOKEN_STORAGE_KEY))!;}
async function call(api:APIRequestContext,token:string|null,method:string,path:string,data?:unknown){const response=await api.fetch(`${apiUrl().replace(/\/$/,'')}${path}`,{method,headers:token?{Authorization:`Bearer ${token}`}:{},data});expect(response.ok(),`${method} ${path}: ${response.status()}`).toBe(true);return response;}

test.describe('meeting-room convergence soak',()=>{
  test.skip(!enabled,'Dedicated real-service lane: BOARD_ROOM_SOAK=1 (default duration 30m).');
  test(`keeps revisions monotonic and converges for ${minutes} minutes`,async({browser,request:api,baseURL},testInfo)=>{
    test.setTimeout((minutes*60+180)*1_000);
    expect(Number.isFinite(minutes)&&minutes>=30,'incomplete runs cannot produce accepted soak evidence').toBe(true);
    expect(apiUrl(),'WHITEBOARD_API_URL or WORKSPACEX_API_PORT is required').toBeTruthy();
    const ownerContext=await browser.newContext({baseURL}),roomContext=await browser.newContext({baseURL});
    const owner=await ownerContext.newPage(),room=await roomContext.newPage();let boardId='',ownerToken='';
    const latencies:number[]=[];let lastRevision=-1,blankRegressions=0,iterations=0,lastExpected={x:0,y:0,zoom:1};const soakStarted=Date.now();
    try{
      ownerToken=await login(owner);const created=await call(api,ownerToken,'POST','/whiteboards',{requestId:randomUUID(),name:`Room soak ${randomUUID()}`});boardId=(await created.json() as {id:string}).id;
      await owner.goto(`/studio/board/${boardId}`);await expect(owner.getByTestId('collaborative-editor')).toBeVisible({timeout:30_000});
      await owner.getByTestId('room-present-open').click();const pairing=owner.getByTestId('room-pairing-payload');await expect(pairing).toBeVisible({timeout:20_000});
      await room.goto('/studio/board/room');await room.getByTestId('room-join-payload').fill(await pairing.inputValue());await room.getByTestId('room-join').click();await expect(room.getByTestId('collaborative-editor')).toBeVisible({timeout:20_000});await expect(owner.getByTestId('room-connected')).toBeVisible({timeout:10_000});
      const sessionId=await owner.evaluate(id=>sessionStorage.getItem(`wsx.board.presenter.${id}`),boardId);
      expect(sessionId).toBeTruthy();const deadline=Date.now()+minutes*60_000;
      while(Date.now()<deadline){iterations+=1;const x=(iterations%17)*37-300,y=(iterations%13)*29-180,zoom=0.75+(iterations%6)*0.15;lastExpected={x,y,zoom};const started=Date.now();
        if(iterations%60===0)await roomContext.setOffline(true);
        await call(api,ownerToken,'PUT',`/whiteboards/${boardId}/room-sessions/${sessionId}/viewport`,{x,y,zoom});
        if(iterations%120===0){const cdp=await roomContext.newCDPSession(room);await cdp.send('Page.setWebLifecycleState',{state:'frozen'});await new Promise(resolve=>setTimeout(resolve,2_000));await cdp.send('Page.setWebLifecycleState',{state:'active'});await cdp.detach();}
        if(iterations%60===0){await new Promise(resolve=>setTimeout(resolve,2_000));await roomContext.setOffline(false);}
        const canvas=room.getByTestId('board-live-surface').locator(':scope > div').first();const timeout=iterations%60===0?5_000:3_000;await expect(canvas).toHaveAttribute('style',new RegExp(`translate\\(${x}px,${y}px\\) scale\\(${zoom}\\)`),{timeout});latencies.push(Date.now()-started);
        if(await room.getByTestId('room-join-payload').count())blankRegressions+=1;
        const revision=Number(await room.getByTestId('room-display-active').getAttribute('data-room-viewport-revision'));expect(revision).toBeGreaterThan(lastRevision);lastRevision=revision;
        const remaining=5_000-(Date.now()-started);if(remaining>0)await new Promise(resolve=>setTimeout(resolve,remaining));
      }
      const finalStyle=await room.getByTestId('board-live-surface').locator(':scope > div').first().getAttribute('style')??'';const match=/translate\(([-\d.]+)px,([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(finalStyle);const finalError={x:Math.abs(Number(match?.[1])-lastExpected.x),y:Math.abs(Number(match?.[2])-lastExpected.y),zoom:Math.abs(Number(match?.[3])-lastExpected.zoom)};
      const sorted=[...latencies].sort((a,b)=>a-b),p95=sorted[Math.max(0,Math.ceil(sorted.length*.95)-1)]??Infinity;const report={requestedMinutes:minutes,elapsedMs:Date.now()-soakStarted,elapsedIterations:iterations,p95Ms:p95,finalRevision:lastRevision,blankRegressions,finalError};
      await testInfo.attach('meeting-room-soak-report.json',{body:Buffer.from(JSON.stringify(report,null,2)),contentType:'application/json'});
      expect(Date.now()-soakStarted).toBeGreaterThanOrEqual(minutes*60_000);expect(iterations).toBeGreaterThanOrEqual(Math.floor(minutes*60/5)*.95);expect(p95).toBeLessThanOrEqual(3_000);expect(finalError.x).toBeLessThanOrEqual(1);expect(finalError.y).toBeLessThanOrEqual(1);expect(finalError.zoom).toBeLessThanOrEqual(.01);expect(blankRegressions).toBe(0);
    }finally{if(boardId&&ownerToken)await call(api,ownerToken,'PATCH',`/whiteboards/${boardId}`,{archived:true});await Promise.all([ownerContext.close(),roomContext.close()]);}
  });
});
