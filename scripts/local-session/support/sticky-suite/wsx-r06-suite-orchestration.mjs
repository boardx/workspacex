import assert from 'node:assert/strict';
import {runStickyPickerMemory,runStickySingleShot} from './wsx-r06-picker-single-shot-cases.mjs';
import {runStickyOverlap,runStickyNativeDrop,runStickyNativeCancel} from './wsx-r06-native-gesture-cases.mjs';
import {runStickyInlineText,runStickyCompositionIntegration,runStickyLongText} from './wsx-r06-inline-text-cases.mjs';
import {runStickyResize,runStickyRotation} from './wsx-r06-transform-cases.mjs';
import {runStickyLiveGraph} from './wsx-r06-live-chrome-cases.mjs';
import {assertStickyCreateHistory,runStickyPersistence} from './wsx-r06-history-persistence-cases.mjs';
import {runStickyUnsentDraftConflict} from './wsx-r06-draft-conflict-cases.mjs';
import {runStickyTwoUserConvergence} from './wsx-r06-two-user-cases.mjs';
import {runStickyViewerDenials,runStickyLockedAndAuthorityRaces} from './wsx-r06-authority-race-cases.mjs';
import {runStickyZoomDpr,runStickyNarrow} from './wsx-r06-viewport-cases.mjs';

export const STICKY_CASE_IDS=Array.from({length:18},(_,index)=>`S${String(index+1).padStart(2,'0')}`);
const requireMethod=(ctx,name)=>{assert.equal(typeof ctx[name],'function',`actual adapter ${name} is required; absent callbacks cannot pass`);return ctx[name];};
function completeSupplementedCase(base,supplement){
 assert.equal(base.requiredSuiteComplete,false,'supplement must target an explicitly partial original section');
 assert(base.pending?.length>0&&supplement.coverage?.length>0);
 for(const item of base.pending)assert(supplement.coverage.includes(item),`original coverage ${item} has no executed supplement`);
 assert(supplement.receipts?.length>0,'supplement requires actual action receipts');
 const{requiredSuiteComplete,pending,status,...observations}=base;
 return{...observations,supplement,coveredPending:pending,originalSubscopeStatus:status};
}
export const stickyCaseExecutors={
 S01:ctx=>runStickyPickerMemory(ctx),S02:ctx=>runStickySingleShot(ctx),
 S03:async ctx=>{await ctx.createStickyNative('square','yellow');await requireMethod(ctx,'createRectangleNative')(ctx.owner);return runStickyOverlap(ctx);},
 S04:ctx=>runStickyNativeDrop(ctx),
 S05:async ctx=>completeSupplementedCase(await runStickyNativeCancel(ctx),await requireMethod(ctx,'runPointerCancellationCoverage')()),
 S06:async ctx=>runStickyInlineText(ctx,await ctx.createStickyNative('rectangle','yellow')),
 S07:async ctx=>({case:'S07',integration:await runStickyCompositionIntegration(ctx,await ctx.createStickyNative('square','pink')),hardware:await requireMethod(ctx,'requireHardwareImeReceipt')()}),
 S08:async ctx=>completeSupplementedCase(await runStickyLongText(ctx),await requireMethod(ctx,'runRotatedGlyphAndLegacyCoverage')()),
 S09:async ctx=>completeSupplementedCase(await runStickyResize(ctx),await requireMethod(ctx,'runSideAndForbiddenControlCoverage')()),
 S10:ctx=>runStickyRotation(ctx),
 S11:async ctx=>completeSupplementedCase(await runStickyLiveGraph(ctx),await requireMethod(ctx,'runLiveResizeRotationEdgeCoverage')()),
 S12:async ctx=>{
  const before=await ctx.state(),id=await ctx.createStickyNative('rectangle','blue'),after=await ctx.state();
  const create=await assertStickyCreateHistory(ctx,ctx.owner,before,after,id),peer=await requireMethod(ctx,'peerActor')();
  const transactions=await requireMethod(ctx,'runAllStickyHistoryTransactions')(create.redoId);
  const draft=await runStickyUnsentDraftConflict(ctx,ctx.owner,peer,create.redoId);return{case:'S12',create,transactions,draft};
 },
 S13:async ctx=>{
  const fixture=await requireMethod(ctx,'createPersistenceFixture')();return runStickyPersistence(ctx,ctx.owner,fixture.id,fixture.edgeId);
 },
 S14:async ctx=>runStickyTwoUserConvergence(ctx,ctx.owner,await requireMethod(ctx,'peerActor')()),
 S15:async ctx=>{
  const id=await ctx.createStickyNative('rectangle','pink');await ctx.editNative(ctx.owner,id,'Viewer readable long text\n'.repeat(80),'command');
  return runStickyViewerDenials(ctx,ctx.owner,await requireMethod(ctx,'viewerActor')(),id);
 },
 S16:async ctx=>runStickyLockedAndAuthorityRaces(ctx,ctx.owner,await requireMethod(ctx,'peerActor')()),
 S17:async ctx=>({case:'S17',automation:await runStickyZoomDpr(ctx),hardware:await requireMethod(ctx,'requireHardwareTrackpadReceipt')()}),
 S18:ctx=>runStickyNarrow(ctx),
};
function rejectIncompleteReceipts(value,path){
 if(!value||typeof value!=='object')return;
 assert.notEqual(value.requiredSuiteComplete,false,`incomplete coverage at ${path}`);
 if(Array.isArray(value.pending))assert.equal(value.pending.length,0,`pending coverage at ${path}`);
 for(const[key,child]of Object.entries(value))rejectIncompleteReceipts(child,`${path}.${key}`);
}
export async function executeStickySuite({createContext,recordCase,executors=stickyCaseExecutors}){
 assert.deepEqual(Object.keys(executors).sort(),STICKY_CASE_IDS,'every original S01-S18 case must have an actual executor');
 const results=[];
 for(const id of STICKY_CASE_IDS){
  let ctx,receipt,error;
  try{
   ctx=await createContext(id);receipt=await executors[id](ctx);assert.equal(receipt?.case,id);rejectIncompleteReceipts(receipt,id);
   assert(ctx.screenshots.length>0,'case must produce actual screenshot evidence');
  }catch(caught){error=caught;}
  finally{if(ctx)try{await ctx.close();}catch(cleanupError){error=error?new AggregateError([error,cleanupError],`${id} execution and cleanup failed`):cleanupError;}}
  const result={id,status:error?'fail':'pass',receipt,error:error?.stack??null,screenshots:ctx?.screenshots??[]};
  results.push(result);await recordCase(result);
 }
 return{requiredSuiteComplete:results.length===18&&results.every(result=>result.status==='pass'),results};
}
