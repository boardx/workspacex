import {clickBlankCanvas} from "./board-acceptance-support";
import AxeBuilder from '@axe-core/playwright';
import {expect,test} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {archiveAcceptanceBoard,boardLogin,createAcceptanceBoard,createCommands,object,operate,openBoard,canonicalRows,selectAll,BOARD_SYNCED_STATUS} from './board-acceptance-support';
import {canonicalSnapshot} from './board-performance-support';
import {observeRuntimeChunks,runtimeSourceIdentity,verifyRuntimeIdentity} from './board-runtime-evidence';
import {boardImagePngFixture} from './support/board-image-fixture';
import {captureVisual,visualViewports,sha256} from './support/board-visual-measurements';

// Browser observations are engineering evidence, never a subjective nine-point score.
test('visual and accessibility real object states, input and negative controls',async({page,request,browser,browserName},info)=>{
  const sha=runtimeSourceIdentity(),finishChunks=observeRuntimeChunks(page),token=await boardLogin(page);
  const boardId=await createAcceptanceBoard(request,token,`Visual accessibility ${browserName}`);
  const captures:Awaited<ReturnType<typeof captureVisual>>[]=[],axeResults:unknown[]=[],input:unknown[]=[];
  let complete=false;
  try {
    await page.goto('/studio/board');
    await expect(page.getByText(`Visual accessibility ${browserName}`,{exact:true})).toBeVisible();
    const browse=await page.screenshot();const browsePath=info.outputPath('browse.png');await writeFile(browsePath,browse);
    await openBoard(page,boardId,0);
    for(const viewport of visualViewports){await page.setViewportSize(viewport);captures.push(await captureVisual(page,info,`empty-${viewport.width}`));}
    // Keyboard path must create canonical content and retain editable focus.
    await page.getByTestId('board-tool-select').focus();await page.keyboard.press('n');await clickBlankCanvas(page);
    await expect(page.getByLabel('对象文字',{exact:true})).toBeFocused();
    const longText='用户不知道如何开始使用产品，需要清晰的下一步。'.repeat(18);
    await page.getByLabel('对象文字',{exact:true}).fill(longText);await page.keyboard.press('Tab');
    await expect(page.getByLabel('对象文字',{exact:true})).toBeFocused();await page.keyboard.type('Keyboard second idea');await page.keyboard.press('Escape');
    await expect.poll(async()=> (await canonicalRows(page)).length).toBe(2);
    // The outline is a local Yjs projection. Wait for the server acknowledgement
    // before reading head and issuing a CAS operation, otherwise an in-flight
    // browser update can advance the revision between those two API requests.
    await expect(page.getByTestId('board-sync-status')).toHaveAttribute('aria-label',BOARD_SYNCED_STATUS);
    input.push({kind:'keyboard-continuous-creation',count:2,objects:await canonicalRows(page)});
    const values=[object('visual-text','text',100,400,'研究标题与说明',280,96),object('visual-shape','rectangle',460,400,'Shape',200,140),
      {...object('visual-panel','frame',800,120,'Panel',400,420),extensionData:{spatial:{version:1,mode:'freeform',autoExpand:true,clipContent:false,padding:24,gap:24,columns:3,flowDirection:'horizontal'}}},
      {...object('visual-tile','extension',850,240,'研究资料',220,150),extensionData:{contentObject:{version:1,type:'tile',tileType:'document',title:'研究资料',description:'访谈证据',icon:null,coverAssetId:null,fields:[],tags:['research'],link:null,status:null,actions:[]}}},
      {...object('visual-connector','connector',0,0,'关联',1,1),connector:{from:'visual-text',to:'visual-shape',fromAnchor:'right' as const,toAnchor:'left' as const,type:'straight' as const,endStyle:'arrow' as const}}];
    await operate(request,token,boardId,createCommands(values));
    const png=boardImagePngFixture();
    await page.getByTestId('board-add-image').click();await expect(page.getByRole('dialog',{name:'添加图片'})).toBeVisible();
    await page.getByTestId('board-image-input').setInputFiles({name:'visual-reference.png',mimeType:'image/png',buffer:png});
    await expect.poll(async()=>(await canonicalRows(page)).filter(row=>row.kind==='image').length).toBe(1);
    // A real vector stroke through browser mouse input, not a background bitmap fixture.
    await page.getByTestId('board-add-draw').click();await page.mouse.move(320,310);await page.mouse.down();await page.mouse.move(400,350,{steps:12});await page.mouse.up();
    await expect.poll(async()=>(await canonicalSnapshot(request,token,boardId)).objects.filter(o=>(o.extensionData?.contentObject as {type?:string})?.type==='drawing').length).toBe(1);
    await page.getByTestId('board-tool-select').click();await page.getByTestId('board-zoom-fit-board').click();
    const rows=await canonicalRows(page);
    for(const viewport of visualViewports){
      await page.setViewportSize(viewport);await page.getByTestId('board-zoom-fit-board').click();
      captures.push(await captureVisual(page,info,`mixed-${viewport.width}`));
      for(const row of rows){
        const beforeConnectorSelection=row.id==='visual-connector'?await canonicalSnapshot(request,token,boardId):null;
        const outline=page.getByTestId('board-a11y-mirror').locator(`li[data-object-id="${row.id}"] button`);
        await outline.focus();await page.keyboard.press('Enter');
        await expect(page.getByTestId('board-a11y-selection-announcement')).toContainText('1');
        if(row.id==='visual-connector'){
          const layout=()=>page.evaluate(()=>{
            const bounds=(id:string)=>{const element=document.querySelector(`[data-testid="${id}"]`);if(!element)throw new Error(`Missing ${id}`);const rect=element.getBoundingClientRect();return{x:rect.x,y:rect.y,width:rect.width,height:rect.height};};
            const from=bounds('board-connector-handle-from'),to=bounds('board-connector-handle-to'),menu=bounds('board-context-toolbar');
            return{menu,path:{x:(from.x+from.width/2+to.x+to.width/2)/2,y:Math.min(from.y+from.height/2,to.y+to.height/2)},maxGap:Math.max(from.height,to.height)/2+16};
          });
          await expect.poll(async()=>{const {menu,path}=await layout();return path.y-menu.y-menu.height;}).toBeGreaterThanOrEqual(0);
          await expect.poll(async()=>{const {menu,path,maxGap}=await layout();return path.y-menu.y-menu.height-maxGap;}).toBeLessThanOrEqual(0);
          const measured=await layout();
          expect(Math.abs(measured.menu.x+measured.menu.width/2-measured.path.x)).toBeLessThanOrEqual(measured.menu.width/2+16);
          await info.attach(`connector-menu-layout-${viewport.width}`,{body:Buffer.from(JSON.stringify(measured)),contentType:'application/json'});
          expect(await canonicalSnapshot(request,token,boardId)).toEqual(beforeConnectorSelection);
        }
        captures.push(await captureVisual(page,info,`${row.kind}-${row.id}-${viewport.width}`));
        if(row.id==='visual-shape'){
          if(await page.getByLabel('对象文字',{exact:true}).isVisible())await page.keyboard.press('Escape');
          const trigger=page.getByRole('button',{name:'更多操作',exact:true});await trigger.click();
          await page.getByTestId('board-properties-open').click();await expect(page.getByTestId('board-shared-properties')).toBeVisible();
          captures.push(await captureVisual(page,info,`properties-${viewport.width}`,false));await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
        }
        await page.keyboard.press('Escape');
      }
      await selectAll(page,rows.length);captures.push(await captureVisual(page,info,`multiselect-${viewport.width}`,false));await page.keyboard.press('Escape');
      const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();axeResults.push({viewport,violations:audit.violations,incomplete:audit.incomplete});
      expect.soft(audit.violations.filter(v=>v.impact==='critical'||v.impact==='serious')).toEqual([]);
    }
    // Deliberately inaccessible independent document proves axe is actually executing.
    const negative=await page.context().newPage();await negative.setContent('<html lang="en"><title>Negative control</title><body><main><button></button></main></body></html>');
    const counterproof=await new AxeBuilder({page:negative}).analyze();expect(counterproof.violations.some(v=>v.id==='button-name')).toBe(true);await negative.close();
    for(const scale of [2,4]){
      // Equivalent reflow + text scaling, explicitly not native browser zoom evidence.
      await page.setViewportSize({width:Math.round(1280/scale),height:720});
      await page.addStyleTag({content:`html {font-size:${16*scale}px !important} textarea,input,button {font-size:${14*scale}px !important}`});
      await page.getByTestId('board-tool-select').focus();await page.keyboard.press('n');await clickBlankCanvas(page);
      await expect(page.getByLabel('对象文字',{exact:true})).toBeFocused();await page.getByLabel('对象文字',{exact:true}).fill(`Reflow ${scale*100}%`);
      const fontSize=await page.getByLabel('对象文字',{exact:true}).evaluate(element=>parseFloat(getComputedStyle(element).fontSize));expect(fontSize).toBeGreaterThanOrEqual(14*scale);
      captures.push(await captureVisual(page,info,`reflow-text-${scale*100}`,false));await page.keyboard.press('Escape');
    }
    await page.setViewportSize(visualViewports[0]);await page.emulateMedia({reducedMotion:'reduce',forcedColors:'active'});
    captures.push(await captureVisual(page,info,'forced-colors-reduced-motion',false));
    await page.evaluate(()=>{document.documentElement.dir='rtl';});captures.push(await captureVisual(page,info,'rtl',false));
    await page.evaluate(()=>{document.documentElement.dir='ltr';});await page.emulateMedia({forcedColors:'none'});
    await page.reload();await expect(page.getByTestId('board-fabric-surface')).toBeVisible();
    await expect(page.getByTestId('board-sync-status')).toHaveAttribute('aria-label',BOARD_SYNCED_STATUS,{timeout:30_000});
    const touchObjectCount=(await canonicalRows(page)).length;
    if(browserName==='chromium'){
      // Keep the long-running visual/reflow session's IndexedDB outbox separate
      // from physical-input emulation. A fresh authenticated browser context
      // proves touch against the same durable Board after reload has converged.
      const touchContext=await browser.newContext({baseURL:new URL(page.url()).origin});
      const touchPage=await touchContext.newPage();
      try{
      await boardLogin(touchPage);
      await openBoard(touchPage,boardId,touchObjectCount);
      const page=touchPage;
      const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
      await page.getByTestId('board-tool-hand').click();
      const surface=page.getByTestId('board-fabric-surface'),before=await surface.getAttribute('data-viewport-pan-x');
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:500,y:350}]});
      for(let step=1;step<=8;step++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:500+step*10,y:350+step*5}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect(surface).not.toHaveAttribute('data-viewport-pan-x',before!);
      input.push({kind:'cdp-touch-pan',hardware:false,before,after:await surface.getAttribute('data-viewport-pan-x')});
      const zoomBefore=Number(await surface.getAttribute('data-viewport-zoom'));
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:500,y:300},{id:2,x:600,y:300}]});
      for(let step=1;step<=8;step++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:500-step*5,y:300},{id:2,x:600+step*5,y:300}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await expect.poll(async()=>Number(await surface.getAttribute('data-viewport-zoom'))).not.toBe(zoomBefore);
      input.push({kind:'cdp-touch-pinch',hardware:false,before:zoomBefore,after:Number(await surface.getAttribute('data-viewport-zoom'))});
      await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:false});
      await page.keyboard.press('Escape');await page.getByTestId('board-add-draw').click();await expect(page.getByTestId('board-add-draw')).toHaveAttribute('aria-pressed','true');const beforeDrawing=(await canonicalSnapshot(request,token,boardId)).objects.length;
      const upperCanvas=page.locator('canvas[data-fabric="top"]');
      for(let attempt=0;attempt<3&&(await canonicalSnapshot(request,token,boardId)).objects.length===beforeDrawing;attempt++){
        const startY=160+attempt*40;await page.mouse.move(180,startY);await page.mouse.down();
        for(let i=1;i<=8;i++){const x=180+i*10,y=startY+i*4;await upperCanvas.dispatchEvent('pointermove',{pointerType:'pen',pointerId:9+attempt,isPrimary:true,clientX:x,clientY:y,pressure:i/10,bubbles:true});await page.mouse.move(x,y);}
        await page.mouse.up();await page.waitForTimeout(300);
      }
      await expect.poll(async()=>(await canonicalSnapshot(request,token,boardId)).objects.length).toBeGreaterThan(beforeDrawing);
      const snapshot=await canonicalSnapshot(request,token,boardId);const drawing=snapshot.objects.filter(o=>(o.extensionData?.contentObject as {type?:string})?.type==='drawing');
      const pressures=drawing.flatMap(o=>((o.extensionData?.contentObject as {strokes:Array<{points:Array<{pressure:number}>}>}).strokes??[]).flatMap(s=>s.points.map(p=>p.pressure)));
      expect(new Set(pressures.filter(p=>p>0)).size).toBeGreaterThan(1);input.push({kind:'browser-pen-pressure',hardware:false,pressures,objects:drawing});await cdp.detach();
      }finally{await touchContext.close();}
    }
    const runtimeIdentity=await verifyRuntimeIdentity(request,sha,await finishChunks());
    await writeFile(info.outputPath('visual-accessibility.json'),JSON.stringify({version:1,kind:'board-visual-accessibility',browserName,sha,runtimeIdentity,
      status:info.errors.length?'failed-not-acceptance':'engineering-observations-pending-human',boardId,browse:{path:browsePath,sha256:sha256(browse)},captures,axeResults,input,canonical:await canonicalSnapshot(request,token,boardId),
      counterproof:counterproof.violations.map(v=>v.id),approved:false,score:null,pending:['independent-human-visual-score','native-browser-200-400-zoom','real-screenreader-output','physical-touch-and-pressure-pen','cdp-touch-object-drag-issue-4717']},null,2));complete=true;
  }finally{if(!complete)await writeFile(info.outputPath('visual-accessibility-partial.json'),JSON.stringify({status:'failed-not-acceptance',sha,captures,axeResults,input},null,2));await archiveAcceptanceBoard(request,token,boardId);}
});
