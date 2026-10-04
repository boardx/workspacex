import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tsImport} from 'tsx/esm/api';
import {observationMode,observationArtifactKinds} from '../e2e/support/board-observation-categories.mjs';
export function validateRuntimeBinding(identity,sha,context){
 const failures=[];
 if(!identity||identity.sha!==sha||identity.buildSha!==sha||identity.dirty!==false||identity.method!=='fresh-server-marker-and-built-chunk-hashes'||!identity.buildId||!identity.deploymentMarker||!identity.chunks?.length||identity.chunks.some(c=>!c.url||!/^[a-f0-9]{64}$/.test(c.sha256??'')||c.sha256!==c.localSha256))failures.push('RUNTIME_IDENTITY');
 const start=Date.parse(identity?.runStartedAt),build=Date.parse(identity?.buildCreatedAt);
 if(!Number.isFinite(start)||!Number.isFinite(build)||build<start)failures.push('RUNTIME_DATE');
 if(context&&(identity?.deploymentMarker!==context.runtimeMarker||identity?.runStartedAt!==context.startedAt||!(build<=Date.parse(context.endedAt))))failures.push('RUNTIME_RUN_BINDING');
 return failures;
}
export function validateNativeCreationEvidence(report){
 return report.input?.some(input=>input.kind==='keyboard-armed-single-creation'&&input.count===2)&&report.canonical?.objects?.length?[]:['REAL_OBJECT_INPUT_REQUIRED'];
}
async function image(ref){const bytes=await readFile(ref.path);if(createHash('sha256').update(bytes).digest('hex')!==ref.sha256||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new Error('SCREENSHOT_HASH_OR_FORMAT');}
export async function validateBoardObservationArtifact(report,lane,sha,context,key=process.env.BOARD_ACCEPTANCE_LEDGER_KEY,expectedMode='all'){
 const failures=[];let pending=[];
 try{
 if(lane==='meeting-room'){
  if(!key||key.length<32)throw new Error('LEDGER_KEY_REQUIRED');
  const {validateRoomArtifact}=await tsImport(new URL('../e2e/support/board-meeting-room-evidence.ts',import.meta.url).href,{parentURL:import.meta.url});
  failures.push(...validateRoomArtifact(report,sha,key),...validateRuntimeBinding(report.runtimeBefore,sha,context),...validateRuntimeBinding(report.runtimeAfter,sha,context));
  if(Date.parse(report.ledger?.finishedAt)>Date.parse(context?.endedAt))failures.push('ROOM_OUTSIDE_RUN');
  pending=['physical-meeting-room-hardware'];
 }else{
  const mode=observationMode(expectedMode),functional=mode==='functional';
  const {bundle:bundleKind,report:reportKind}=observationArtifactKinds(mode);
  if(report?.version!==1||report.kind!==bundleKind||report.reports?.length!==3||new Set(report.reports.map(r=>r.browserName)).size!==3||report.reports.some(r=>!['chromium','firefox','webkit'].includes(r.browserName)))throw new Error('VISUAL_BROWSER_SET');
  const {visualViewports,validateVisualMeasurement}=await tsImport(new URL('../e2e/support/board-visual-policy.ts',import.meta.url).href,{parentURL:import.meta.url});
  for(const r of report.reports){
   if(r.kind!==reportKind||(functional?r.observationMode!=='functional':r.observationMode!==undefined&&r.observationMode!=='all')||r.version!==1||r.sha!==sha||r.status!=='engineering-observations-pending-human'||r.approved!==false||r.score!==null||!r.boardId)failures.push('VISUAL_SCHEMA');
   failures.push(...validateRuntimeBinding(r.runtimeIdentity,sha,context));
   if(functional){if(r.browse!==null)failures.push('FUNCTIONAL_SCREENSHOT_CLAIM');}else await image(r.browse);
   if(!r.captures?.length||r.captures.some(c=>c.failures?.length))failures.push('VISUAL_MEASUREMENTS');
   for(const viewport of visualViewports){
    for(const prefix of ['empty','mixed','multiselect','properties'])if(!r.captures.some(c=>c.label===`${prefix}-${viewport.width}`&&c.measurement?.viewport?.width===viewport.width&&c.measurement?.viewport?.height===viewport.height))failures.push('VISUAL_STATE_VIEWPORT_MISSING');
   }
   for(const capture of r.captures??[]){
    if(functional){if(capture.screenshot!==null)failures.push('FUNCTIONAL_SCREENSHOT_CLAIM');}else await image(capture.screenshot);
    if(!Number.isFinite(Date.parse(capture.at))||(context&&(Date.parse(capture.at)<Date.parse(context.startedAt)||Date.parse(capture.at)>Date.parse(context.endedAt))))failures.push('SCREENSHOT_OUTSIDE_RUN');
    if(capture.strict!==false)failures.push(...validateVisualMeasurement(capture.measurement));
    if(capture.measurement?.editorReachable===false)failures.push('EDITOR_TEXT_OCCLUDED');
   }
   if(r.axeResults?.length!==3||r.axeResults.some(a=>!Array.isArray(a.violations)||a.violations.some(v=>['serious','critical'].includes(v.impact)))||!r.counterproof?.includes('button-name'))failures.push('ACCESSIBILITY_AUDIT');
   failures.push(...validateNativeCreationEvidence(r));
  }
  pending=lane==='visual'?['independent-human-visual-score']:['native-browser-200-400-zoom','real-screenreader-output','physical-touch-and-pressure-pen'];
  if(functional)pending.push('visual-heavy-deferred-not-verified');
 }
 }catch(error){failures.push(error.message??'OBSERVATION_INVALID');}
 return{valid:failures.length===0,failures,pending,score:null,budgetStatus:'pending-independent-acceptance'};
}
