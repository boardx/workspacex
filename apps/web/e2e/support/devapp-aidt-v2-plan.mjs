/** Named actions for the reviewed two-source V2 scenario. Numbers are derived, never budget overrides. */
import { buildV2ExecutionPlan, V2_CASE_IDS } from './devapp-aidt-v2-profile.mjs';
const stageCases=stage=>V2_CASE_IDS.filter(id=>id.startsWith(`AI-S${stage}-`));
const crud=V2_CASE_IDS.filter(id=>id.startsWith('CRUD-'));
const printing=V2_CASE_IDS.filter(id=>id.startsWith('PRINT-'));
export const V2_ENTITY_ROLES=Object.freeze({
  1:['problem-main'],2:['source-interview','source-observation'],3:['surprise-main','persona-main','hmw-main'],
  4:['method-free','method-reverse','method-scamper','method-analogy','method-role','method-brainwriting','idea-one','idea-two','idea-three','idea-b-one','idea-b-two','idea-b-three'],
  5:['prototype-single','prototype-three'],6:['test-offline','test-survey','test-virtual','group-report'],
});
const output=(name,stage,entityRole,caseIds=printing,defaultPaper='A4')=>({name,stage,entityRole,caseIds,defaultPaper});
/** A composite is accepted only when that real product preview contains ALL its named formal parts. */
export const V2_FORMAL_OUTPUTS=Object.freeze([
  output('confirmed-problem-reflection',1,'problem-main'),
  output('source-1-guide',2,'source-interview'),output('source-1-discovery-card',2,'source-interview'),output('source-1-asr-report',2,'source-interview'),
  output('source-2-guide',2,'source-observation'),output('source-2-discovery-card',2,'source-observation'),
  output('confirmed-surprise',3,'surprise-main'),output('confirmed-surprise-revised',3,'surprise-main'),
  output('confirmed-persona',3,'persona-main',[...printing,'AI-S3-16'],'A1'),
  output('confirmed-hmw',3,'hmw-main',[...printing,'AI-S3-16']),
  output('confirmed-classification-and-selection',4,'method-free'),
  output('idea-description-1',4,'idea-one'),output('idea-description-2',4,'idea-two'),output('idea-description-3',4,'idea-three'),
  output('round-b-classification-and-selection',4,'method-reverse'),
  output('round-b-idea-description-1',4,'idea-b-one'),output('round-b-idea-description-2',4,'idea-b-two'),output('round-b-idea-description-3',4,'idea-b-three'),
  ...['prototype-single','prototype-three'].flatMap(role=>[output(role+'-confirmed-text',5,role),output(role+'-verification-question',5,role)]),
  output('prototype-single-image',5,'prototype-single'),
  ...['image','html','webapp'].map(kind=>output('prototype-three-'+kind,5,'prototype-three')),
  // Actual saved test-record preview includes the plan, bound evidence, learning and next action.
  output('offline-test-learning-record',6,'test-offline'),output('offline-asr-report',6,'test-offline'),
  output('survey-test-learning-record',6,'test-survey'),output('survey-native-questionnaire',6,'test-survey'),output('survey-native-response-report',6,'test-survey'),
  output('virtual-test-learning-record',6,'test-virtual'),output('virtual-native-outline',6,'test-virtual'),output('virtual-native-runs',6,'test-virtual'),output('virtual-native-report',6,'test-virtual'),
  output('iteration-prototype',6,'test-offline'),output('confirmed-group-report',6,'group-report'),
]);
export function createV2VoicePlan() {
  const ops=[];
  function add(stage,entityRole,kind,id,caseIds) {
    const anchor=`AI-S${stage}-07`;
    const modelCases=[];
    if(stage===1&&id.endsWith('problem-candidate'))modelCases.push('AI-S1-04');
    if(stage===1&&id.endsWith('student-dynamic-response'))modelCases.push('AI-S1-11');
    if(stage===2&&id.endsWith('finding-candidate'))modelCases.push('AI-S2-04');
    if(stage===3&&['teaching'].includes(kind)&&/candidate/.test(id))modelCases.push('AI-S3-04');
    if(stage===3&&id==='s3-persona-main-multiple-candidates-select')modelCases.push('AI-S3-10');
    if(stage===3&&id==='s3-hmw-main-multiple-candidates-select')modelCases.push('AI-S3-13');
    if(stage===4&&id.endsWith('method-free-candidate'))modelCases.push('AI-S4-04');
    if(stage===4&&/^s4-method-.*-student-round-[12]$/.test(id))modelCases.push('AI-S4-15');
    if(stage===5&&id.endsWith('text-candidate'))modelCases.push('AI-S5-04');
    if(stage===5&&kind==='design')modelCases.push('AI-S5-16');
    if(stage===6&&/-(plan|result)-candidate$/.test(id))modelCases.push('AI-S6-04');
    if(stage===6&&kind==='asr')modelCases.push('AI-S6-14');
    if(stage===6&&entityRole==='test-virtual'&&kind==='research')modelCases.push('AI-S6-16');
    ops.push({id,kind,stage,entityRole,caseIds:caseIds??[...new Set([anchor,...modelCases])]});
  }
  function writes(stage,role,names){for(const name of names)add(stage,role,'write',`s${stage}-${role}-${name}`);}
  function teaching(stage,role,names){for(const name of names)add(stage,role,'teaching',`s${stage}-${role}-${name}`);}
  // Read/UI assertion slots are case-specific; passing one case cannot automatically pass siblings.
  for(const id of V2_CASE_IDS){const stage=Number(/^AI-S([1-6])-/.exec(id)?.[1]??6);const role=V2_ENTITY_ROLES[stage][0];add(stage,role,'ui','ui-'+id.toLowerCase(),[id]);add(stage,role,'read','read-'+id.toLowerCase(),[id]);}
  writes(1,'problem-main',['initial-reconcile','create','candidate-save','confirm']);
  for(const phase of ['initial-outcome','draft-reentry','candidate-refresh','before-confirm-refresh','formal-outcome'])add(1,'problem-main','write',`s1-problem-main-reconcile-${phase}`);
  teaching(1,'problem-main',['student-initial','student-dynamic-response','problem-candidate']);
  for(const role of V2_ENTITY_ROLES[2]){
    writes(2,role,['create','guide-projection-1','guide-projection-2','guide-confirm','notes-consent','upload-original','bind-original','transcript-select','transcript-locator','transcript-edit','transcript-check','finding-context','finding-interpretation','finding-projection','candidate-explicit-save','finding-confirm']);
    teaching(2,role,['guide-initial','guide-revised','finding-feedback','finding-candidate']);
  }
  writes(2,'source-interview',['finding-quote','photo-consent','photo-upload','photo-bind','photo-revoke','photo-regrant','photo-reuse','photo-reconfirm']);
  writes(2,'source-interview',['audio-consent','audio-upload','audio-bind','asr-transcript-save','asr-transcript-check','chat-audio-upload']);add(2,'source-interview','asr','s2-source-interview-file-asr');
  for(const tool of ['audio','publish'])add(2,'source-interview','write',`s2-source-interview-asr-${tool}-permission-once`,['AI-S2-07']);
  writes(3,'surprise-main',['create','confirm','found-confirm']);teaching(3,'surprise-main',['student-none']);
  for(const kind of ['persona','hmw']){const role=kind+'-main';writes(3,role,['explicit-import','confirm']);teaching(3,role,['single-candidate-preview-cancel','multiple-candidates-select']);}
  writes(3,'hmw-main',['select-for-round']);
  for(const method of ['free','reverse','scamper','analogy','role','brainwriting']){const role='method-'+method;writes(4,role,['create','projection-1','projection-2']);teaching(4,role,['student-round-1','student-round-2']);}
  writes(4,'method-free',['candidate-explicit-save']);
  for(const role of ['method-free','method-reverse'])writes(4,role,['shortlist','classification-confirm','stage-complete']);teaching(4,'method-free',['candidate']);
  for(const role of ['idea-one','idea-two','idea-three','idea-b-one','idea-b-two','idea-b-three']){writes(4,role,['upload-image','bind-image','description-confirm']);teaching(4,role,['description-feedback']);}
  for(const role of V2_ENTITY_ROLES[5]){
    writes(5,role,['create-design','link-design','save-source-pin','question-confirm','text-draft','text-revised','text-confirm','image-bind','prototype-confirm']);
    teaching(5,role,['student-initial','text-candidate']);
  }
  writes(5,'prototype-three',['html-version-select','html-basis-bind','webapp-version-select','webapp-basis-bind','unconfirmed-v3-save','iteration-version-select','iteration-basis-bind','iteration-prototype-confirm']);
  writes(5,'prototype-single',['source-image-upload-1','source-image-save-1']);
  writes(5,'prototype-three',['source-image-upload-1','source-image-save-1','source-image-upload-2','source-image-save-2','source-image-upload-3','source-image-save-3']);
  add(5,'prototype-single','write','s5-prototype-single-image-generate');
  for(const kind of ['image','html','webapp'])add(5,'prototype-three',kind==='image'?'write':'design',`s5-prototype-three-${kind}-generate`);
  for(const role of ['test-offline','test-survey','test-virtual']){
    writes(6,role,['create','student-task','candidate-plan-save','candidate-result-save','confirm-learning']);
    teaching(6,role,['student-task-initial','plan-candidate','result-candidate','student-result-review']);
  }
  writes(6,'test-offline',['audio-consent','audio-upload','audio-bind','chat-audio-upload','asr-transcript-save','return-step-five','iteration-version-bind']);add(6,'test-offline','asr','s6-test-offline-file-asr');
  for(const tool of ['audio','publish'])add(6,'test-offline','write',`s6-test-offline-asr-${tool}-permission-once`,['AI-S6-07','AI-S6-14']);
  add(6,'test-offline','design','s6-test-offline-iterate-prototype');
  add(6,'test-survey','research','s6-test-survey-markdown-proposal');
  for(const name of ['create','save-source','link','publish','select-response'])add(6,'test-survey','survey','s6-test-survey-native-'+name);
  for(let index=1;index<=8;index++)add(6,'test-survey','survey',`s6-test-survey-native-participant-submit-${String(index).padStart(2,'0')}`,['AI-S6-07','AI-S6-15']);
  add(6,'test-survey','write','s6-test-survey-source-binding');add(6,'test-survey','write','s6-test-survey-native-report');
  for(const name of ['native-create','native-initialize','native-save-intake','native-source-binding','native-edit-intake','native-confirm-intake','native-save-experts','native-confirm-experts','native-confirm-outline','native-confirm-analysis','native-save-outline','bind-report','classify-function','classify-need'])writes(6,'test-virtual',[name]);
  for(const name of ['analysis','outline','runs','report'])add(6,'test-virtual','research','s6-test-virtual-'+name);
  teaching(6,'group-report',['final-report']);writes(6,'group-report',['save','confirm']);
  // Approved one-use cancellation runs are distinct from each later positive request.
  for(const [stage,role,id] of [[1,'problem-main','s1-problem-main-candidate-cancel'],[2,'source-interview','s2-source-interview-candidate-cancel'],[4,'method-free','s4-method-free-candidate-cancel'],[5,'prototype-three','s5-prototype-three-candidate-cancel'],[6,'test-offline','s6-test-offline-plan-candidate-cancel']])add(stage,role,'teaching',id,[`AI-S${stage}-05`]);
  // Every supported creatable kind has one dedicated disposable entity, not the main source artifact.
  for(const [stage,kind]of [[1,'problem'],[2,'interview'],[2,'observation'],[3,'surprise'],[3,'persona'],[3,'hmw'],[4,'brainstorm'],[4,'idea'],[5,'prototype'],[6,'test']]) {
    const role='crud-'+kind;
    for(const name of ['create','edit-name','tags-add','tags-remove','archive'])add(stage,role,'write',`crud-${kind}-${name}`,name==='create'?['CRUD-01','CRUD-03','CRUD-10']:name==='archive'?['CRUD-07','CRUD-10']:['CRUD-05','CRUD-10']);
  }
  add(5,'crud-prototype','write','crud-prototype-create-design',['CRUD-01','CRUD-03','CRUD-10']);add(5,'crud-prototype','write','crud-prototype-link-design',['CRUD-01','CRUD-03','CRUD-10']);add(1,'crud-problem','write','crud-problem-initial-reconcile',['CRUD-01','CRUD-03','CRUD-10']);
  const s2Common=['initial','created-refresh','guide-outcome','materials','finding-chat','candidate-refresh','confirmed-refresh','finding-outcome'];
  const s5Common=['initial','v1-refresh','v2-refresh','confirmed-refresh','design-enter','version-select-return','image-formal','prototype-confirmed-refresh'];
  const s6Common=['initial','created-refresh','task-refresh','candidate-plan-entry','plan-refresh','candidate-result-entry','evidence-refresh','learning-entry','reflection-refresh','formal-outcome','historical-reentry'];
  const entityNavigation = [
    [1,'problem-main',['initial','initial-outcome','draft-reentry','candidate-refresh','before-confirm-refresh','formal-outcome']],
    [2,'source-interview',[...s2Common,'revocation-current','revoked-outcome','revocation-refresh','regrant-current','reconfirmed-refresh','regrant-outcome','asr-entry','asr-saved-refresh','asr-calibrated-refresh']],
    [2,'source-observation',s2Common],
    [3,'surprise-main',['initial','formal-outcome','found-edit','found-refresh','found-outcome']],
    [3,'persona-main',['initial','import-refresh','confirmed-refresh','formal-outcome']],
    [3,'hmw-main',['initial','import-refresh','confirmed-refresh','selected-refresh','formal-outcome']],
    ...V2_ENTITY_ROLES[4].map(role=>[4,role,role.startsWith('method-')?['initial','created-refresh',...(role==='method-free'?['candidate-reentry','candidate-refresh']:[]),...(['method-free','method-reverse'].includes(role)?['completion-reentry','completion-refresh']:[])]:['initial','confirmed-refresh','formal-outcome']]),
    [5,'prototype-single',[...s5Common,...Array.from({length:9},(_,j)=>`lineage-1-return-${j+1}`)]],
    [5,'prototype-three',[...s5Common,'design-html-entry','design-html-return','design-webapp-entry','design-webapp-return','html-formal','webapp-formal','unconfirmed-v3-entry','v3-refresh','iteration-from-offline','iteration-design-entry','iteration-design-return','iteration-confirmed-refresh',...Array.from({length:3},(_,i)=>Array.from({length:9},(_,j)=>`lineage-${i+1}-return-${j+1}`)).flat(),...['prototype','offline','survey','virtual','report'].map(origin=>'history-from-'+origin)]],
    [6,'test-offline',[...s6Common,'audio-entry','audio-saved-refresh','asr-entry','asr-saved-refresh','iteration-entry','iteration-reflection-refresh','iteration-binding-entry','iteration-saved-refresh']],
    [6,'test-survey',[...s6Common,'research-entry','survey-source-refresh']],
    [6,'test-virtual',[...s6Common,'research-entry','virtual-bound-refresh']],
    [6,'group-report',['initial','outcome-initial','saved-refresh','historical-reentry']],
  ];
  for(const [stage,role,names]of entityNavigation){
    add(stage,role,'write',`s${stage}-${role}-thread-mount`);
    for(const name of names)add(stage,role,'write',`s${stage}-${role}-entity-thread-${name}`);
  }
  add(3,'persona-main','write','s3-persona-directory-thread-create');add(3,'persona-main','write','s3-persona-directory-thread-mount');
  for(const [stage,kind]of [[1,'problem'],[2,'interview'],[2,'observation'],[3,'surprise'],[3,'persona'],[3,'hmw'],[4,'brainstorm'],[4,'idea'],[5,'prototype'],[6,'test']]){
    add(stage,'crud-'+kind,'write',`crud-${kind}-entity-thread-initial`,['CRUD-03','CRUD-10']);add(stage,'crud-'+kind,'write',`crud-${kind}-thread-mount`,['CRUD-03','CRUD-10']);
  }
  for(const [role,phases]of [['source-interview',[...s2Common.filter(name=>!['initial','created-refresh'].includes(name)),'revocation-current','revoked-outcome','revocation-refresh','regrant-current','reconfirmed-refresh','regrant-outcome','asr-entry','asr-saved-refresh','asr-calibrated-refresh']],['source-observation',s2Common.filter(name=>!['initial','created-refresh'].includes(name))]])for(const phase of phases)add(2,role,'write',`s2-${role}-reconcile-${phase}`);
  for(const [stage,role]of [[1,'problem-main'],[2,'source-interview'],[4,'method-free'],[5,'prototype-three'],[6,'test-offline']]){add(stage,role,'write',`s${stage}-${role}-entity-thread-candidate-cancel-refresh`);if(stage<=2)add(stage,role,'write',`s${stage}-${role}-reconcile-candidate-cancel-refresh`);}
  const cases=V2_CASE_IDS.map(caseId=>{
    const stage=Number(/^AI-S([1-6])-/.exec(caseId)?.[1]??6);
    const specific=ops.filter(op=>op.caseIds.includes(caseId));
    let assertionIds=['normal-ui-action','source-scope','explicit-save-boundary','saved-readback','refresh-persisted','real-screenshots'];
    if(/^AI-S[12456]-05$/.test(caseId))assertionIds=['candidate-not-preselected','explicit-selection','editable-local-draft','cancel-preserves-saved-content','refresh-preserves-saved-content','native-response-bound','real-screenshots'];
    if(/^AI-S[1-6]-09$/.test(caseId))assertionIds=['mobile-no-overflow','visible-keyboard-focus','keyboard-enter-ime-escape','preview-select-cancel-save-keyboard','focus-return','refresh-preserves-saved-content','real-screenshots'];
    if(caseId==='CRUD-02')assertionIds=['all-supported-create-kinds','cancel-button','escape-cancel','supported-close-control','directory-leave-cancel','no-persisted-creation','refresh-preserves-saved-content','real-screenshots'];
    if(caseId.startsWith('PRINT-')||caseId==='AI-S3-16')assertionIds.push('all-formal-outputs-three-papers','system-dialog','actual-pdf-all-pages');
    return {caseId,operationIds:specific.map(op=>op.id),assertionIds,requiresPrint:caseId.startsWith('PRINT-')||caseId==='AI-S3-16',timeoutMs:caseId.startsWith('PRINT-')?600000:caseId.startsWith('AI-')?900000:480000};
  });
  return buildV2ExecutionPlan({operations:ops,formalOutputs:V2_FORMAL_OUTPUTS,caseBindings:cases});
}
