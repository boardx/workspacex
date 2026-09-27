import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validateRuntimeBinding} from './board-observation-policy.mjs';
const names=['Brainstorm:','Organize:','Panel:','Diagram:','Visual Research:','AI Ready API:'];
const requirements={'ttfi-ms':5000,'ten-stickies-ms':30000,'organize-actions-after-selection':2,'connection-clicks-per-edge':2,'screenshot-paste-actions':1,'prepared-proposal-confirm-actions':2};
export async function validateJourneyArtifact(report,sha,context){
 const failures=[],pending=['real-model semantic AI Organize and complete <=2-action journey'];
 try{
  if(report?.version!==1||report.kind!=='board-journey-bundle'||report.reports?.length!==6)throw new Error('JOURNEY_SCHEMA');
  if(new Set(report.reports.map(r=>r.testId)).size!==6)failures.push('DUPLICATE_JOURNEY_ID');
  const metrics=new Map();
  for(const prefix of names)if(report.reports.filter(r=>r.title?.startsWith(prefix)).length!==1)failures.push('MISSING_OR_DUPLICATE_JOURNEY');
  for(const r of report.reports){
   if(r.kind!=='board-journey'||r.version!==1||r.sha!==sha||r.status!=='passed'||r.retry!==0||r.errors?.length!==0||r.modelOrganizeVerified!==false||r.approved!==false||r.score!==null)failures.push('JOURNEY_NOT_PASSED');
   failures.push(...validateRuntimeBinding(r.runtimeIdentity,sha,context));
   const trace=await readFile(r.trace.path);
   if(createHash('sha256').update(trace).digest('hex')!==r.trace.sha256||!JSON.parse(trace).traceEvents?.length)failures.push('JOURNEY_TRACE');
   const snapshots=r.observations.filter(o=>o.name==='canonical-reload-result');
   if(!snapshots.length)failures.push('CANONICAL_RELOAD_MISSING');
   for(const {value:s} of snapshots){
    if(!s.boardId||!s.objects?.length||!Number.isInteger(s.revision?.seq)||!Number.isInteger(s.revision?.epoch)||s.objects.length!==s.browserRows?.length||new Set(s.objects.map(o=>o.id)).size!==s.objects.length)throw new Error('CANONICAL_RELOAD_SCHEMA');
    for(const row of s.browserRows){const object=s.objects.find(o=>o.id===row.id);if(!object||object.text!==row.text||JSON.stringify(object.geometry)!==JSON.stringify(row.geometry)||(object.parentId??'')!==row.parentId)failures.push('CANONICAL_BROWSER_MISMATCH');}
   }
   for(const o of r.observations)if(Object.hasOwn(requirements,o.name)){if(metrics.has(o.name))failures.push('DUPLICATE_METRIC');metrics.set(o.name,o.value);}
   if(r.title.startsWith('Brainstorm:')&&snapshots.at(-1)?.value.objects.length!==20)failures.push('BRAINSTORM_20_REQUIRED');
   if(r.title.startsWith('Panel:')&&snapshots.at(-1)?.value.objects.filter(o=>o.parentId).length!==10)failures.push('PANEL_10_REQUIRED');
   if(r.title.startsWith('AI Ready API:')&&!r.observations.some(o=>o.name==='ai-organize-coverage-boundary'&&o.value.unverifiedRequirements?.includes('semantic theme inference')))failures.push('MODEL_BOUNDARY_REQUIRED');
  }
  for(const [name,limit] of Object.entries(requirements)){const m=metrics.get(name);if(!m||m.limit!==limit||!Number.isFinite(m.observed)||m.observed<=0||(name.endsWith('-ms')?m.observed>=limit:m.observed>limit))failures.push(`INVALID_METRIC:${name}`);}
 }catch(error){failures.push(error.message??'JOURNEY_INVALID');}
 return{valid:failures.length===0,failures,pending,budgetStatus:'pending-independent-acceptance',score:null};
}
