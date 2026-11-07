import {test, expect, type Page, type CDPSession, type BrowserContext} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {FULLSTACK_E2E as F} from './fullstack-smoke-fixture';
import {boardLogin, canonicalBoardSnapshot, createAcceptanceBoard, object, createCommands, operate, canonicalRows, boardApi} from './board-acceptance-support';
import {runtimeSourceIdentity, observeRuntimeChunks, verifyRuntimeIdentity} from './board-runtime-evidence';
import {connectorAuthorityTransport} from './support/connector-authority-transport';
import {deleteOwnedConnectorFixture} from './support/connector-acceptance-fixture';
import {expectBoardSynced} from './support/board-sync-status';

const target = 'snap-c', releaseTarget = 'snap-d', edgeId = 'snap-edge';
async function select(page: Page, id: string, connector = id === edgeId) {
  const row = page.getByTestId(`board-a11y-object-${id}`);
  await row.focus(); await row.press('Enter');
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  if (!connector) {
    await expect(page.getByTestId('board-thinking-editor')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('board-thinking-editor')).toBeHidden();
  }
}
async function targetPoint(page: Page, worldX = 700, worldY = 350) {
  return page.getByTestId('board-fabric-surface').evaluate((surface, anchor) => {
    const rect = surface.getBoundingClientRect();
    const zoom = Number(surface.getAttribute('data-viewport-zoom'));
    const px = Number(surface.getAttribute('data-viewport-pan-x'));
    const py = Number(surface.getAttribute('data-viewport-pan-y'));
    // Independent fixture oracle: each supplied point is a real left anchor, rotation 0.
    const x = rect.x + px + anchor.x * zoom, y = rect.y + py + anchor.y * zoom;
    if (![x,y,zoom,px,py].every(Number.isFinite) || zoom <= 0 ||
        x <= rect.left || x >= rect.right || y <= rect.top || y >= rect.bottom) {
      throw new Error('SNAP_TARGET_OUTSIDE_ACTUAL_SURFACE');
    }
    return {x,y};
  }, {x:worldX,y:worldY});
}
for (const creating of [true, false]) for (const mode of ['fast','slow','cancel','lock','release-lock','release-delete'] as const) {
  test(`#5666 ${creating ? 'create' : 'rebind'} ${mode} endpoint snap survives release`, async ({page,request:api,browser,baseURL},info) => {
    test.setTimeout(180_000); await page.setViewportSize({width:1440,height:900});
    const source = runtimeSourceIdentity(), chunks = observeRuntimeChunks(page);
    const transport = connectorAuthorityTransport(); transport.observe(page,'original',()=>F.userId);
    const title = `#5666 ${creating ? 'create' : 'rebind'} ${mode}`;
    const records: unknown[] = []; let token = '', boardId = '', primary: unknown;
    const cleanupErrors: unknown[] = []; let peer: Page | undefined, peerContext: BrowserContext | undefined, nativeInput: CDPSession | undefined;
    const releaseOnly = mode === 'release-lock' || mode === 'release-delete';
    const expectedTarget = releaseOnly ? releaseTarget : target;
    try {
      let loginPosts = 0;
      page.on('request', request => {if (new URL(request.url()).pathname.endsWith('/auth/login') && request.method() === 'POST') loginPosts++;});
      const loginResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/auth/login') && response.request().method() === 'POST');
      token = await boardLogin(page);
      const login = await loginResponse; expect(login.status()).toBe(200);
      const identity = await login.json(); expect(identity.userId).toBe(F.userId); expect(identity.sessionToken).toBe(token);
      expect(loginPosts).toBe(1);
      boardId = await createAcceptanceBoard(api,token,title);
      const seed = [object('snap-a','sticky',120,300,'A',140,100),
        object('snap-b','sticky',420,500,'B',140,100),object(target,'sticky',700,300,'C',140,100)];
      if (releaseOnly) seed.push(object(releaseTarget,'sticky',940,300,'D',140,100));
      if (!creating) seed.push({...object(edgeId,'connector',260,350,'',160,200),
        connector:{from:'snap-a',to:'snap-b',fromAnchor:'right',toAnchor:'left',type:'straight',startStyle:'none',endStyle:'arrow',lineStyle:'solid',label:'',semanticRelation:''}});
      await operate(api,token,boardId,createCommands(seed));
      await page.goto(`/studio/board/${boardId}`); await expectBoardSynced(page,30_000);
      peerContext = await browser.newContext({baseURL,viewport:{width:1440,height:900}});
      peer = await peerContext.newPage(); const peerChunks = observeRuntimeChunks(peer); let peerLoginPosts = 0;
      peer.on('request',request=>{if(new URL(request.url()).pathname.endsWith('/auth/login')&&request.method()==='POST')peerLoginPosts++;});
      const peerLoginResponse = peer.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/auth/login')&&response.request().method()==='POST');
      const peerToken = await boardLogin(peer,F.adminEmail,F.adminPassword);
      const peerLogin = await peerLoginResponse; expect(peerLogin.status()).toBe(200);
      expect(await peerLogin.json()).toMatchObject({userId:F.adminUserId,sessionToken:peerToken});
      expect(peerLoginPosts).toBe(1);
      await boardApi(api,token,'PUT',`/whiteboards/${boardId}/members`,{userId:F.adminUserId,role:'editor'});
      transport.observe(peer,'peer',()=>F.adminUserId);
      await peer.goto(`/studio/board/${boardId}`); await expectBoardSynced(peer,30_000);
      await expect.poll(()=>canonicalRows(peer!)).toEqual(await canonicalRows(page));
      records.push({phase:'runtime-before',...await verifyRuntimeIdentity(api,source,await chunks()),peer:await verifyRuntimeIdentity(api,source,await peerChunks())});
      await select(page,creating ? 'snap-a' : edgeId);
      const handle = page.getByTestId(creating ? 'connector-handle-snap-a-right' : 'board-connector-handle-to');
      await expect(handle).toBeVisible(); const box = await handle.boundingBox(); expect(box).not.toBeNull();
      const destination = await targetPoint(page);
      const before = await canonicalBoardSnapshot(api,token,boardId), offset = transport.snapshot().events.length;
      records.push({phase:'before-gesture',before,destination,sourceHandle:creating?'connector-handle-snap-a-right':'board-connector-handle-to'});
      let commitBefore = before;
      await page.mouse.move(box!.x+box!.width/2,box!.y+box!.height/2); await page.mouse.down();
      await page.mouse.move(destination.x,destination.y,{steps:mode === 'fast' ? 1 : 12});
      // Deliberately no assertion, evaluate, RAF, or timer between fast move/up.
      if (mode === 'fast') await page.mouse.up();
      else if (releaseOnly) {
        await expect(page.getByTestId('board-connector-snap-cue')).toHaveAttribute('data-target-id',target);
        await operate(api,token,boardId,[mode === 'release-lock' ? {type:'state',id:target,locked:true} : {type:'delete',id:target}]);
        commitBefore = await canonicalBoardSnapshot(api,token,boardId);
        const finalPoint = await targetPoint(page,940);
        nativeInput = await page.context().newCDPSession(page);
        // Native input deliberately releases beyond the last delivered move.
        // No JS dispatch, product-state writes, or synthetic projection changes.
        await nativeInput.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:finalPoint.x,y:finalPoint.y,button:'left',clickCount:1});
        await page.mouse.up(); // Duplicate completion must not dispatch twice.
      } else {
        await expect(page.getByTestId('board-connector-snap-cue')).toHaveAttribute('data-target-id',target);
        if (mode === 'cancel') await page.keyboard.press('Escape');
        if (mode === 'lock') {
          await operate(api,token,boardId,[{type:'state',id:target,locked:true}]);
          await expect(page.getByTestId('board-connector-snap-cue')).toHaveCount(0);
        }
        await page.mouse.up();
      }
      await expectBoardSynced(page,30_000);
      await expectBoardSynced(peer,30_000);
      const frames = () => transport.snapshot().events.slice(offset).filter(event => event.boardId === boardId && event.client === 'original');
      if(mode !== 'cancel' && mode !== 'lock')await expect.poll(()=>frames().filter(event=>event.direction==='received'&&event.type==='ack').length).toBe(1);
      let after = await canonicalBoardSnapshot(api,token,boardId);
      records.push({phase:'after-gesture',after});
      if (mode === 'cancel' || mode === 'lock') {
        const expected = mode === 'lock' ? {...before,revision:{...before.revision,seq:before.revision.seq+1},
          objects:before.objects.map(item=>item.id===target?{...item,locked:true}:item)} : before;
        expect(after).toEqual(expected);
        expect(frames().filter(event=>event.direction==='sent'&&event.type==='update')).toEqual([]);
        expect(frames().filter(event=>event.direction==='received'&&event.type==='ack')).toEqual([]);
      } else {
        expect(after.revision).toEqual({...commitBefore.revision,seq:commitBefore.revision.seq+1});
        const edges = after.objects.filter(item=>item.kind==='connector'); expect(edges).toHaveLength(1);
        const edge = edges[0]!; if (!creating) expect(edge.id).toBe(edgeId);
        expect(edge.connector).toMatchObject({from:'snap-a',to:expectedTarget,fromAnchor:'right',toAnchor:'left',type:'straight'});
        expect(edge.connector!.toPoint).toBeUndefined();
        expect(after.objects.filter(item=>item.kind!=='connector')).toEqual(commitBefore.objects.filter(item=>item.kind!=='connector'));
        await expect.poll(()=>frames().filter(event=>event.direction==='received'&&event.type==='ack').length).toBe(1);
        const updates = frames().filter(event=>event.direction==='sent'&&event.type==='update');
        const acks = frames().filter(event=>event.direction==='received'&&event.type==='ack');
        expect(updates).toHaveLength(1); expect(acks).toHaveLength(1);
        expect(typeof updates[0]!.updateId).toBe('string'); expect(typeof updates[0]!.gestureId).toBe('string');
        expect(acks[0]).toMatchObject({updateId:updates[0]!.updateId,gestureId:updates[0]!.gestureId,seq:after.revision.seq});
        expect(updates[0]!.epoch).toBe(before.revision.epoch);
      }
      await expect.poll(()=>canonicalRows(peer!)).toEqual(await canonicalRows(page));
      expect(transport.snapshot().events.filter(event=>event.boardId===boardId&&event.client==='peer'&&event.direction==='sent'&&event.type==='update')).toEqual([]);
      await page.reload(); await peer.reload(); await expectBoardSynced(page,30_000); await expectBoardSynced(peer,30_000);
      await expect.poll(()=>canonicalRows(peer!)).toEqual(await canonicalRows(page));
      expect(await canonicalBoardSnapshot(api,token,boardId)).toEqual(after);
      if (mode === 'fast' || mode === 'slow' || releaseOnly) {
        const row = page.getByTestId('board-a11y-mirror').locator('li[data-object-kind="connector"]');
        await expect(row).toHaveAttribute('data-connector-to',expectedTarget);
        await expect(row).toHaveAttribute('data-connector-end',JSON.stringify({x:releaseOnly?940:700,y:350}));
        await expect(row).toHaveAttribute('data-connector-start',JSON.stringify({x:260,y:350}));
      }
      if (mode === 'cancel' || mode === 'lock') {
        expect(frames().filter(event=>event.direction==='sent'&&event.type==='update')).toEqual([]);
        expect(frames().filter(event=>event.direction==='received'&&event.type==='ack')).toEqual([]);
      }
      if(mode === 'fast') {
        // Ordinary stable targets still exercise repeated native fast release,
        // independent of the lock/delete race. Each repetition has its own ACK.
        const stableEdgeId = after.objects.find(item=>item.kind==='connector')!.id;
        let baseline = after;
        for(let round=0;round<12;round++) {
          await select(page,stableEdgeId,true);
          const endpoint = page.getByTestId('board-connector-handle-to');
          await expect(endpoint).toBeVisible(); const origin = await endpoint.boundingBox(); expect(origin).not.toBeNull();
          const nextTarget = round%2===0 ? 'snap-b' : target;
          const nextPoint = await targetPoint(page,round%2===0?420:700,round%2===0?550:350);
          const eventOffset = transport.snapshot().events.length;
          await page.mouse.move(origin!.x+origin!.width/2,origin!.y+origin!.height/2);await page.mouse.down();
          await page.mouse.move(nextPoint.x,nextPoint.y,{steps:1});await page.mouse.up();
          const gestureFrames=()=>transport.snapshot().events.slice(eventOffset).filter(event=>event.boardId===boardId&&event.client==='original');
          await expect.poll(()=>gestureFrames().filter(event=>event.direction==='received'&&event.type==='ack').length).toBe(1);
          const updates=gestureFrames().filter(event=>event.direction==='sent'&&event.type==='update');
          const acks=gestureFrames().filter(event=>event.direction==='received'&&event.type==='ack');
          expect(updates).toHaveLength(1);expect(acks).toHaveLength(1);
          const current=await canonicalBoardSnapshot(api,token,boardId);
          expect(current.revision).toEqual({...baseline.revision,seq:baseline.revision.seq+1});
          expect(acks[0]).toMatchObject({updateId:updates[0]!.updateId,gestureId:updates[0]!.gestureId,seq:current.revision.seq});
          expect(current.objects.find(item=>item.id===stableEdgeId)!.connector).toMatchObject({from:'snap-a',to:nextTarget});
          expect(current.objects.filter(item=>item.kind!=='connector')).toEqual(baseline.objects.filter(item=>item.kind!=='connector'));
          await expect.poll(()=>canonicalRows(peer!)).toEqual(await canonicalRows(page));
          records.push({phase:'ordinary-fast-repetition',round,before:baseline.revision,after:current.revision,target:nextTarget,updates,acks});baseline=current;
        }
        await page.reload();await peer.reload();await expectBoardSynced(page,30_000);await expectBoardSynced(peer,30_000);
        await expect.poll(()=>canonicalRows(peer!)).toEqual(await canonicalRows(page));
        expect(await canonicalBoardSnapshot(api,token,boardId)).toEqual(baseline);after=baseline;
        await expect(page.getByTestId('board-a11y-mirror').locator('li[data-object-kind="connector"]')).toHaveAttribute('data-connector-to',target);
      }
      expect(loginPosts).toBe(1); expect(peerLoginPosts).toBe(1); expect(transport.snapshot().dropped).toBe(0);
      records.push({phase:'result',creating,mode,before,after,transport:transport.snapshot(),
        runtimeAfter:await verifyRuntimeIdentity(api,source,await chunks()),peerRuntimeAfter:await verifyRuntimeIdentity(api,source,await peerChunks())});
      await page.screenshot({path:info.outputPath('snap-after-reload.png')});
    } catch (error) {primary=error;
      try {await page.screenshot({path:info.outputPath('snap-primary-failure.png')});} catch (captureError) {cleanupErrors.push(captureError);}
    }
    finally {
      // Metadata contains protocol identities only, never tokens or document bytes.
      records.push({phase:'final-transport',...transport.snapshot()});
      if (nativeInput) try {await nativeInput.detach();} catch(error){cleanupErrors.push(error);}
      if (peerContext) try {await peerContext.close();} catch(error){cleanupErrors.push(error);}
      if (boardId && token) try {await deleteOwnedConnectorFixture(api,token,boardId,F.userId,title);} catch(error){cleanupErrors.push(error);}
      const path = info.outputPath('connector-fast-snap.json');
      try {await writeFile(path,JSON.stringify({source,creating,mode,status:primary||cleanupErrors.length?'failed':'passed',records},null,2),{mode:0o600});await info.attach('connector-fast-snap',{path,contentType:'application/json'});} catch(error){cleanupErrors.push(error);}
    }
    if (primary) {if(cleanupErrors.length)throw new AggregateError([primary,...cleanupErrors],'SNAP_PRIMARY_AND_CLEANUP_FAILURE');throw primary;}
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors,'SNAP_CLEANUP_FAILURE');
  });
}
