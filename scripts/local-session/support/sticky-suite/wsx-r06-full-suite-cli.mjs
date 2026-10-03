#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {verifyStickySuiteAuthority} from './wsx-r06-authority.mjs';
import {createOwnedStickyRoutes} from './wsx-r06-route-handler.mjs';
import {createRequire} from 'node:module';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createStickyContextFoundation} from './wsx-r06-context-foundation.mjs';
import {createStickyRasterReaders} from './wsx-r06-raster-readers.mjs';
import {createStickyNativeActions} from './wsx-r06-native-actions.mjs';
import {createOwnedStickyBoardLifecycle} from './wsx-r06-owned-board-lifecycle.mjs';
import {launchIndependentStickyActor} from './wsx-r06-two-user-cases.mjs';
import {runStickyPointerCancellationCoverage} from './wsx-r06-sticky-pointer-cancel.mjs';
import {runNormalToolRelease} from './wsx-r06-normal-tool-release-oracle.mjs';
import {createStickyOperationAdapters} from './wsx-r06-operation-adapters.mjs';
import {createExistingEdgeRasterAdapter,createCanonicalExistingEdgeRasterAdapter} from './wsx-r06-edge-raster.mjs';
import {assertStickyTransformHistory} from './wsx-r06-history-persistence-cases.mjs';
import {runStickyNativeDrop} from './wsx-r06-native-gesture-cases.mjs';
import {runStickyLiveResizeRotationEdges} from './wsx-r06-live-transform-edge-cases.mjs';
import {executeStickySuite} from './wsx-r06-suite-orchestration.mjs';
import {createReadonlyStickyAdapters} from './wsx-r06-readonly-adapters.mjs';
import {assertLiveStickyChrome} from './wsx-r06-live-chrome-cases.mjs';
import {runStickyRotatedGlyphAndLegacy} from './wsx-r06-rotated-legacy-cases.mjs';
import {runAllStickyHistoryTransactions,createStickyPersistenceFixture} from './wsx-r06-history-coverage.mjs';
import {runStickySideAndForbiddenControls} from './wsx-r06-side-control-cases.mjs';
import {assertRequiredRuntimeSourceHashes} from './wsx-r06-runtime-closure.mjs';

export async function runStickySuiteCli(args,ownedEvidenceDirectory){
const option=name=>args[args.indexOf(`--${name}`)+1];
for(const name of ['root','base','api','manifest','owner-state','peer-state','viewer-state','out'])assert(args.includes(`--${name}`),`--${name} required`);
const root=option('root'),base=option('base'),origin=option('api'),out=option('out'),manifestPath=option('manifest');
assert.equal(out,ownedEvidenceDirectory,'entry point must provide the exact private evidence directory');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const runnerDirectory=dirname(fileURLToPath(import.meta.url)),runnerHashes=()=>Object.fromEntries(readdirSync(runnerDirectory).filter(name=>name.startsWith('wsx-r06-')&&name.endsWith('.mjs')).sort().map(name=>[name,digest(readFileSync(join(runnerDirectory,name)))]));
const initialRunnerHashes=runnerHashes();
const {path:authority,sha256:authorityHash}=verifyStickySuiteAuthority(root);
const manifest=JSON.parse(readFileSync(manifestPath,'utf8')),{verifyRuntimeManifest}=await import(join(root,'scripts/local-session/board-acceptance-runtime.mjs'));
const {createAcceptanceRequestScheduler}=await import(join(root,'scripts/local-session/board-navigation-acceptance-scheduler.mjs'));
const selectorPath='scripts/local-session/board-runtime-source-files.mjs';
assert.equal(digest(readFileSync(join(root,selectorPath))),'a5de5ff1e0926e11ffc8883e69e663119e90117f6c03681853ca6e93887bb92c','approved sole runtime source selector required');
const {listRuntimeSourceFiles}=await import(join(root,selectorPath));
const requiredSourceFiles=listRuntimeSourceFiles(root).sort();
assert(requiredSourceFiles.includes(selectorPath),'runtime authority must include its own source selector');
assert.deepEqual(Object.keys(manifest.sourceHashes??{}).sort(),requiredSourceFiles,'manifest must cover the exact sole runtime source set');
assertRequiredRuntimeSourceHashes(manifest,requiredSourceFiles);
const attest=()=>verifyRuntimeManifest({manifestPath,root,base,origin,sourceFiles:requiredSourceFiles});
const initialAttestation=attest(),require=createRequire(join(root,'apps/web/package.json')),{chromium}=require('playwright-core');
const core=await import(join(root,'packages/whiteboard-core/src/index.ts')),{WhiteboardOperationRequest}=await import(join(root,'packages/contracts/src/whiteboard-operation.ts'));
const {WHITEBOARD_SYNC,WhiteboardClientMessage}=await import(join(root,'packages/contracts/src/whiteboard-sync.ts'));
assert(manifest.sourceHashes['apps/web/e2e/support/board-sync-status.ts']);assert(manifest.sourceHashes['apps/web/components/whiteboard/board-editor-header.tsx']);
const {expectBoardSynced}=await import(join(root,'apps/web/e2e/support/board-sync-status.ts'));
const scheduler=createAcceptanceRequestScheduler(),caseRecords=[],browserHttpFailures=[],browserPageErrors=[],cleanupEvidence=[];
const launch=async(role,options={})=>{
 const actor=await launchIndependentStickyActor({chromium,statePath:option(`${role}-state`),base,api:origin,role,...options}),close=actor.close;let closed=false;
 try{
 actor.mutationTransport={sockets:[],frames:[]};
 actor.page.on('websocket',socket=>{
  const boardId=actor.boardId,path=new URL(socket.url()).pathname,expected=WHITEBOARD_SYNC.path.replace(':boardId',encodeURIComponent(boardId));
  if(path!==expected)return;
  actor.mutationTransport.sockets.push({boardId,path});
  socket.on('framesent',event=>{
   let parsed;try{parsed=WhiteboardClientMessage.safeParse(JSON.parse(typeof event.payload==='string'?event.payload:event.payload.toString('utf8')));}catch{}
   actor.mutationTransport.frames.push({boardId,type:parsed?.success?parsed.data.type:'invalid'});
  });
 });
 actor.page.on('pageerror',error=>browserPageErrors.push({pid:actor.pid,userId:actor.identity.userId,message:error.message}));
 // launchIndependentStickyActor creates this fresh context; this is its sole route owner.
 const routes=createOwnedStickyRoutes({context:actor.context,exclusiveContext:true,matcher:/\/(?:v1|whiteboards)(?:\/|\?|$)/,scheduler,record:failure=>browserHttpFailures.push({userId:actor.identity.userId,pid:actor.pid,...failure})});
 await routes.install();let closePromise;
 actor.close=()=>closePromise??=(async()=>{if(closed)return;const failures=[];try{await routes.drain();}catch(error){failures.push(error);}try{await close();closed=true;}catch(error){failures.push(error);}if(failures.length)throw new AggregateError(failures,'sticky actor route drain and close failed');})();return actor;
 }catch(error){try{await close();}catch(cleanup){throw new AggregateError([error,cleanup],'actor route initialization and cleanup failed');}throw error;}
};
const createContext=async caseId=>{
 const screenshots=[],actors=[];let ctx,lifecycle,owner;
 const recordShot=async(actor,name)=>{
  const path=join(out,`${caseId}-${name}-${screenshots.length}.png`),bytes=await actor.page.screenshot({path,scale:'device'});
  screenshots.push({path,sha256:digest(bytes),bytes:bytes.length,actorUserId:actor.identity.userId});
 };
 try{
 owner=await launch('owner');actors.push(owner);
 ctx=createStickyContextFoundation({origin,base,owner,scheduler,colors:core.STICKY_COLOR_PRESETS,recordShot});
 lifecycle=createOwnedStickyBoardLifecycle({ctx,base,onReceipt:async receipt=>{
  writeFileSync(join(out,`owned-preserve-${cleanupEvidence.length}.json`),JSON.stringify(receipt,null,2),{flag:'wx',mode:0o600});cleanupEvidence.push(receipt);
 },launchOwner:async options=>{
  if(!owner.boardId)return owner;const actor=await launch('owner',options);actors.push(actor);return actor;
 }});
  await lifecycle.launchFreshOwner({dpr:1,viewport:{width:1440,height:900}});
  Object.assign(ctx,{owner,page:owner.page,screenshots,minimumFontToken:core.validateTextAttributes({preset:'caption'}).fontSize,rotationOffsetCss:40});
  ctx.expectSynced=actor=>expectBoardSynced(actor.page,30000,actor.role==='viewer');await ctx.expectSynced(owner);
  ctx.readMutationTransport=actor=>{
   const transport=actor.mutationTransport;assert(transport.sockets.some(socket=>socket.boardId===actor.boardId),'actual board WS must have been observed before testing zero mutation');
   const frames=transport.frames.filter(frame=>frame.boardId===actor.boardId);
   return{mutations:frames.filter(frame=>frame.type==='update'||frame.type==='restore-deletion').length,invalid:frames.filter(frame=>frame.type==='invalid').length};
  };
  Object.assign(ctx,createStickyRasterReaders(ctx),createStickyNativeActions(ctx,owner),createStickyOperationAdapters({ctx,owner,core,WhiteboardOperationRequest}),lifecycle);
  ctx.assertExistingEdgeRaster=createExistingEdgeRasterAdapter(ctx,owner);ctx.assertRenderedExistingEdge=createCanonicalExistingEdgeRasterAdapter(ctx);
  ctx.assertHistory=(before,after,name)=>assertStickyTransformHistory(ctx,owner,before,after,name);
  ctx.waitRendered=(actor,id)=>actor.page.getByTestId('board-a11y-mirror').locator(`li[data-object-id="${id}"]`).waitFor();
  ctx.createRectangleNative=async actor=>{
   const before=await ctx.state(actor),point=await ctx.blank(actor);await ctx.leaveEditor(actor);await actor.page.getByTestId('board-add-shape').click();await actor.page.getByTestId('board-shape-rectangle').click();await actor.page.mouse.click(point.x,point.y);
   const after=await ctx.poll(()=>ctx.state(actor),value=>value.head.seq===before.head.seq+1&&value.objects.length===before.objects.length+1),created=after.objects.filter(item=>!before.objects.some(old=>old.id===item.id));
   assert.equal(created.length,1);assert.equal(created[0].kind,'rectangle');assert.equal(await actor.page.getByTestId('board-tool-select').getAttribute('aria-pressed'),'true');await ctx.leaveEditor(actor);return created[0].id;
  };
  const peers={};
  const sharedActor=async role=>{
   if(peers[role])return peers[role];const actor=await launch(role);actors.push(actor);
   assert.notEqual(actor.identity.userId,owner.identity.userId);assert.equal(actor.identity.orgId,owner.identity.orgId);assert.notEqual(actor.pid,owner.pid);
   await ctx.setBoardMember(owner,actor.identity.userId,role==='peer'?'editor':'viewer');actor.boardId=owner.boardId;
   await actor.page.goto(`${base}/studio/board/${owner.boardId}`);await ctx.surface(actor).waitFor();assert.equal((await ctx.state(actor)).head.role,role==='peer'?'editor':'viewer');
   await ctx.expectSynced(actor);
   peers[role]=actor;return actor;
  };
  ctx.peerActor=()=>sharedActor('peer');ctx.viewerActor=()=>sharedActor('viewer');
  ctx.runLiveResizeRotationEdgeCoverage=()=>runStickyLiveResizeRotationEdges(ctx);
  ctx.runPointerCancellationCoverage=async()=>{const normalRelease=await runNormalToolRelease(ctx);return{...await runStickyPointerCancellationCoverage(ctx),normalRelease};};
  ctx.runSideAndForbiddenControlCoverage=()=>runStickySideAndForbiddenControls(ctx);
  ctx.runAllStickyHistoryTransactions=id=>runAllStickyHistoryTransactions(ctx,id);ctx.createPersistenceFixture=()=>createStickyPersistenceFixture(ctx);
  ctx.runRotatedGlyphAndLegacyCoverage=()=>runStickyRotatedGlyphAndLegacy(ctx);
  ctx.sampleLiveChrome=async(first,second,third,fourth)=>{
   const actor=typeof first==='string'?owner:first,id=typeof first==='string'?first:second,expected=typeof first==='string'?third:fourth;
   const geometry=expected??(await ctx.state(actor)).objects.find(item=>item.id===id)?.geometry;assert(geometry);
   return assertLiveStickyChrome(actor.page,id,geometry,await ctx.view(actor));
  };
  Object.assign(ctx,createReadonlyStickyAdapters(ctx));
  for(const [name,arg]of [['requireHardwareImeReceipt','ime-receipt'],['requireHardwareTrackpadReceipt','trackpad-receipt']])ctx[name]=async()=>{
   assert(args.includes(`--${arg}`),`actual native hardware receipt --${arg} is required`);const bytes=readFileSync(option(arg)),receipt=JSON.parse(bytes);
   assert.equal(receipt.head,manifest.head);assert.equal(receipt.authorityHash,authorityHash);assert.equal(receipt.humanVerified,true);assert(receipt.evidencePaths?.length>0);for(const path of receipt.evidencePaths)assert(readFileSync(path).length>0);return{...receipt,receiptSha256:digest(bytes)};
  };
  ctx.close=async()=>{
   const failures=[];for(const actor of actors.slice().reverse())try{if(lifecycle.trackedBoards().includes(actor.boardId)&&actor.identity.userId===owner.identity.userId)await lifecycle.cleanupFreshOwner(actor);else await actor.close();}catch(error){failures.push(error);}
   const httpFailures=browserHttpFailures.filter(value=>actors.some(actor=>actor.pid===value.pid));if(httpFailures.length)failures.push(Error(`actual browser HTTP failures: ${JSON.stringify(httpFailures)}`));
   const pageErrors=browserPageErrors.filter(value=>actors.some(actor=>actor.pid===value.pid));if(pageErrors.length)failures.push(Error(`actual page errors: ${JSON.stringify(pageErrors)}`));if(failures.length)throw new AggregateError(failures,`${caseId} cleanup failed`);
  };
  return ctx;
 }catch(error){
  const failures=[error];for(const actor of actors.slice().reverse())try{if(lifecycle?.trackedBoards().includes(actor.boardId))await lifecycle.cleanupFreshOwner(actor);else await actor.close();}catch(cleanup){failures.push(cleanup);}
  throw new AggregateError(failures,`${caseId} context initialization failed`);
 }
};
let result,error;
try{result=await executeStickySuite({createContext,recordCase:async receipt=>{
 caseRecords.push(receipt);writeFileSync(join(out,`${receipt.id}-result.json`),JSON.stringify(receipt,null,2),{flag:'wx',mode:0o600});
}});}catch(caught){error=caught;}
let finalAttestation,finalRunnerHashes;
try{finalAttestation=attest();assert.equal(digest(readFileSync(authority)),authorityHash);finalRunnerHashes=runnerHashes();assert.deepEqual(finalRunnerHashes,initialRunnerHashes,'runner source changed during actual acceptance');}
catch(attestationError){error=error?new AggregateError([error,attestationError],'suite and final attestation failed'):attestationError;}
const cleanupPending=cleanupEvidence.some(receipt=>receipt.cleanupPending);
if(cleanupPending&&result)result={...result,requiredSuiteComplete:false,cleanupPending:true};
writeFileSync(join(out,'report.json'),JSON.stringify({authority,authorityHash,requiredSourceFiles,initialRunnerHashes,finalRunnerHashes,initialAttestation,finalAttestation,result,cases:caseRecords,cleanupEvidence,cleanupPending,error:error?.stack??null,browserHttpFailures,browserPageErrors,requestPacing:scheduler.statistics},null,2),{flag:'wx',mode:0o600});
if(error||!result?.requiredSuiteComplete||cleanupPending||browserHttpFailures.length||browserPageErrors.length){process.exitCode=1;throw Error('STICKY_SUITE_REQUIRED_GATES_FAILED');}
}
