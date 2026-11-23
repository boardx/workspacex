/** #6976: one fresh-project scenario. This closed subset never enables cases 02–07. */
import { createHash } from 'node:crypto';
import { createV2VoicePlan } from './devapp-aidt-v2-plan.mjs';
import { ProbeFailure } from './devapp-aidt-auth-readonly.mjs';
export { CASE01_PROFILE } from './devapp-aidt-v2-profile.mjs';
import { CASE01_PROFILE } from './devapp-aidt-v2-profile.mjs';
export const CASE01_ID = 'AIDT-E2E-01';
export const CASE01_LIMITS = Object.freeze({ teaching: 44, physicalWrites: 263, designs: 1, overallMinutes: 142 });
const fail=code=>{throw new ProbeFailure(code);};
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export const case01Digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const roles=new Set(['problem-main','source-interview','source-observation','surprise-main','persona-main','hmw-main','method-free','idea-one','idea-two','idea-three','prototype-single','test-survey','group-report']);
const unused=/(?:candidate-cancel|asr|audio|unconfirmed-v3|history-from|found-edit|found-refresh|found-outcome|found-confirm|single-candidate-preview-cancel|photo-revoke|photo-regrant|photo-reuse|photo-reconfirm|revocation-|revoked-outcome|regrant-|reconfirmed-refresh)/;
const outputs=new Set(['confirmed-problem-reflection','source-1-guide','source-1-discovery-card','source-2-guide','source-2-discovery-card','confirmed-surprise','confirmed-persona','confirmed-hmw','confirmed-classification-and-selection','idea-description-1','idea-description-2','idea-description-3','prototype-single-confirmed-text','prototype-single-verification-question','prototype-single-image','survey-test-learning-record','survey-native-questionnaire','survey-native-response-report','confirmed-group-report']);
export const CASE01_ASSERTIONS=Object.freeze(['fresh-normal-project','six-real-stage-handoffs','six-stage-files','ordinary-actor','reviewed-s1-s2','confirmed-image-text-basis','actual-survey-response','saved-return-four','continued-round-four','frozen-system-report','native-readable-pdf','same-runtime']);
export function createCase01Plan(){
  const source=createV2VoicePlan();
  const operations=source.operations.filter(row=>roles.has(row.entityRole)&&!unused.test(row.id)&&!row.id.startsWith('ui-')&&!row.id.startsWith('read-')&&!(row.stage===5&&row.kind==='design')).map(row=>({...row,caseIds:[CASE01_ID]}));
  const add=(stage,entityRole,kind,id)=>operations.push({id,kind,stage,entityRole,caseIds:[CASE01_ID]});
  // Normal source-image/Design helpers keep their existing operation names; exactly one generation.
  add(5,'prototype-single','design','s5-prototype-single-html-generate');
  for(const phase of ['design-html-entry','design-html-return','html-formal'])add(5,'prototype-single','write','s5-prototype-single-entity-thread-'+phase);
  for(const suffix of ['html-version-select','html-basis-bind'])add(5,'prototype-single','write','s5-prototype-single-'+suffix);
  add(6,'test-survey','write','s6-test-survey-return-four');
  add(4,'method-free','write','s4-method-free-return-four-save');
  add(4,'method-free','write','s4-method-free-return-four-complete');
  add(4,'method-free','write','s4-method-free-entity-thread-return-four-refresh');
  add(4,'method-free','write','s4-method-free-entity-thread-return-four');
  for(let stage=1;stage<=6;stage++)add(stage,stage===1?'problem-main':stage===2?'source-interview':stage===3?'surprise-main':stage===4?'method-free':stage===5?'prototype-single':'test-survey','write','case01-stage-'+stage+'-attachment');
  const formalOutputs=source.formalOutputs.filter(row=>outputs.has(row.name)).map(row=>({...row,caseIds:[CASE01_ID]}));
  const printJobs=formalOutputs.map(row=>({name:row.name+'-'+row.defaultPaper.toLowerCase(),outputName:row.name,stage:row.stage,entityRole:row.entityRole,paper:row.defaultPaper,defaultPaper:row.defaultPaper,caseIds:[CASE01_ID]}));
  const byKind=Object.fromEntries(['ui','read','write','teaching','design','asr','survey','research'].map(kind=>[kind,operations.filter(row=>row.kind===kind).length]));
  const mutations=operations.filter(row=>!['ui','read'].includes(row.kind)).length;
  if(new Set(operations.map(row=>row.id)).size!==operations.length||byKind.teaching>44||mutations+2>263||byKind.design!==1||byKind.asr!==0)fail('CASE01_PLAN_LIMIT_OR_DUPLICATE');
  const plan={schemaVersion:1,profile:CASE01_PROFILE,manualPath:'docs/evidence/aidt-native/completion-20261116/a6/aidt-v2-human-acceptance.md',caseIds:[CASE01_ID],operations,formalOutputs,printJobs,
    caseBindings:[{caseId:CASE01_ID,operationIds:operations.map(row=>row.id),assertionIds:[...CASE01_ASSERTIONS],requiresModel:true,requiresPrint:true,timeoutMs:142*60000}],
    limits:{operations:operations.length,...byKind,physicalMutationRequests:mutations,logicalModelActions:operations.filter(row=>['teaching','design','research'].includes(row.kind)).length,nativePdfFiles:printJobs.length,automaticUnknownRetries:0},physicalCaps:CASE01_LIMITS,
    explicitExclusions:{cases02to07:'NOT_IMPLEMENTED',tenInterviews:false,wavCaptureOrAsr:false,realClassroomSignoff:false,teacherSignoff:false}};
  return Object.freeze({...plan,manifestSha256:case01Digest(plan)});
}
/** Validate the exact reviewed subset again at the guard boundary, not just a caller's profile name. */
export function assertCase01Plan(plan){if(!plan||plan.profile!==CASE01_PROFILE||plan.manifestSha256!==createCase01Plan().manifestSha256||case01Digest(Object.fromEntries(Object.entries(plan).filter(([key])=>key!=='manifestSha256')))!==plan.manifestSha256)fail('CASE01_PLAN_CHANGED');return plan;}
