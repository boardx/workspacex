/** Normal-UI S6 entities, candidate drafts and explicit learning confirmation. No API writes or fabricated model output. */
import { ProbeFailure } from './devapp-aidt-auth-readonly.mjs';
import { V2_SYNTHETIC, savedV2Entities, parseV2Record } from './devapp-aidt-v2-ui.mjs';
import { runV2SurveyResearch, runV2VirtualResearch } from './devapp-aidt-v2-research.mjs';
import { produceV2OfflineIterationVersion } from './devapp-aidt-v2-design.mjs';
import { attachV2SyntheticAudio, runV2SyntheticAsr } from './devapp-aidt-v2-asr.mjs';
const fail=code=>{throw new ProbeFailure(code);};
const paths=Object.freeze(['offline','survey','virtual']);
function checkBinding(record,target){
  if(record.id!==target.entityId||record.archived||record.researchPath!==target.path||record.designId!==target.designId||record.versionId!==target.versionId||record.stage5Revision!==target.stage5Revision||record.prototypeEntity!==target.prototypeEntity)fail('V2_S6_FORMAL_PROTOTYPE_BINDING_CHANGED');
  return record;
}
function nativeProof(report,target,prompt){
  const matches=(report?.teachingEvidence??[]).filter(row=>row.status==='passed'&&row.stageId===6&&row.entityId===target.entityId&&row.prompt===prompt);
  if(matches.length!==1||!matches[0].runId||!matches[0].assistantMessageId)fail('V2_S6_EXACT_REAL_FEEDBACK_RECEIPT_REQUIRED');
  return matches[0];
}
export async function createV2TestGroup({ui,prototype,path,capture,onEntityCreated}){
  if(!paths.includes(path)||!prototype?.entityId||!prototype.designId||!prototype.versionId||!Number.isSafeInteger(prototype.stage5Revision)||prototype.stage5Revision<1)fail('V2_S6_CONFIRMED_FORMAL_PROTOTYPE_REQUIRED');
  const {page,expect,btn,click,fill,stage,save}=ui;await ui.go(6);
  const before=new Set(savedV2Entities(await stage(6),'testGroup:').map(row=>row.id));
  await click(page.getByRole('region',{name:'本组测试',exact:true}).getByTestId('aidt-new-entity-card'));
  const dialog=page.getByRole('dialog',{name:'新建测试卡片',exact:true});await expect(dialog).toBeVisible();
  const select=dialog.getByLabel('所用原型',{exact:true});if(await select.count())await select.selectOption(prototype.entityId);
  const confirm=dialog.getByRole('checkbox',{name:'确认使用所选原型的已保存版本开展本轮研究',exact:true});await expect(confirm).not.toBeChecked();
  const create=btn('创建测试卡片',dialog);await expect(create).toBeDisabled();
  await click(btn('预览所选原型版本',dialog));
  const preview=dialog.getByRole('region',{name:'被测原型预览',exact:true});await expect(preview).toBeVisible();await expect(preview).toContainText(prototype.versionId);
  await expect(dialog).toContainText(`第 5 步 V${prototype.stage5Revision}`);
  await expect(preview.getByRole('navigation',{name:'原型页面',exact:true}).getByRole('button').first()).toBeVisible();
  await capture(`v2-s6-${path}-actual-frozen-prototype-preview`,6);
  await confirm.check();await dialog.getByLabel('研究路径',{exact:true}).selectOption(path);
  const name=`QA ${path} ${ui.scope.runId}`;await fill('测试名称',name,dialog);
  const role='test-'+path,base=`/api/projects/${ui.scope.projectId}/aidt/stages/6`;
  const saved=await save(6,()=>click(create),{uiAction:{actionId:'s6-'+role+'-normal-create',steps:[{operationId:'s6-'+role+'-create',kind:'write',requestKind:'stage-save',stageId:6,entityRole:role,method:'PUT',path:base,captureEntity:{prefix:'testGroup:',nameField:'name',expectedName:name,priorIds:[...before]}},{operationId:'s6-'+role+'-entity-thread-initial',kind:'write',requestKind:'entity-thread',stageId:6,entityRole:role,entityId:'{createdEntity}',method:'PUT',path:base+'/entities/{createdEntity}/thread',captureThread:true},{operationId:'s6-'+role+'-thread-mount',kind:'write',requestKind:'thread-mount',stageId:6,entityRole:role,entityId:'{createdEntity}',method:'POST',path:'/api/threads/{createdThread}/skill-mounts'}]}});
  const added=savedV2Entities(saved.stage,'testGroup:').filter(record=>!before.has(record.id));
  if(added.length!==1||added[0].name!==name)fail('V2_S6_NEW_TEST_ENTITY_NOT_PERSISTED');
  const record=added[0],target={entityId:record.id,path,prototypeEntity:prototype.entityId,designId:prototype.designId,versionId:prototype.versionId,stage5Revision:prototype.stage5Revision,role:'test-'+path};checkBinding(record,target);
  await page.waitForURL(url=>url.searchParams.get('step')==='6'&&url.searchParams.get('entity')===record.id&&url.searchParams.get('thread')?.startsWith('thr'));
  Object.assign(target,ui.route(6));if(onEntityCreated)await onEntityCreated(target);
  await ui.refresh(6,{expectedRevision:saved.receipt.revision,navigation:{role:target.role,phase:'created-refresh'},assertSaved:stage=>checkBinding(parseV2Record(stage,'testGroup:',record.id),target)});
  await capture(`v2-s6-${path}-created-refreshed`,6);
  return target;
}
export async function seedV2StudentTestTask({ui,testTarget,teachingFeedback,report,capture}){
  const {page,expect,stage}=ui;if(ui.route(6).entityId!==testTarget.entityId||ui.route(6).threadId!==testTarget.threadId)fail('V2_S6_STUDENT_TASK_CURRENT_ENTITY_REQUIRED');checkBinding(parseV2Record(await stage(6),'testGroup:',testTarget.entityId),testTarget);
  const prompt=`${V2_SYNTHETIC}。当前测试实体 ${testTarget.entityId}，研究路径 ${testTarget.path}，实际被测原型固定版本 ${testTarget.versionId}，第5步保存V${testTarget.stage5Revision}。学生先拟问题：请从原型指出你最先看到的等待信息，说明准备做哪一步、哪里让你犹豫；不要问“是不是很好”。尚未采集任何真人反馈，请只帮我整理本轮测试任务，不替我确认，不填现场行为或已验证结论。`;
  let accepted=false;await ui.performAction({actionId:'s6-'+testTarget.role+'-student-plan-projection',timeoutMs:240000,steps:[{operationId:'s6-'+testTarget.role+'-student-task',kind:'write',requestKind:'stage-save',stageId:6,entityRole:testTarget.role,entityId:testTarget.entityId,method:'PUT',path:`/api/projects/${ui.scope.projectId}/aidt/stages/6`}],perform:async()=>{accepted=await teachingFeedback(6,prompt,undefined,false,false,true);}});if(!accepted)fail('V2_S6_STUDENT_TASK_REAL_FEEDBACK_REQUIRED');
  const proof=nativeProof(report,testTarget,prompt);
  await expect.poll(async()=>parseV2Record(await stage(6),'testGroup:',testTarget.entityId).planFromMessageId,{timeout:30000}).toBe(proof.assistantMessageId);
  const saved=checkBinding(parseV2Record(await stage(6),'testGroup:',testTarget.entityId),testTarget);
  if(!saved.task.trim()||saved.confirmedFromMessageId)fail('V2_S6_STUDENT_TASK_NOT_SAVED_AS_UNCONFIRMED_PLAN');
  await ui.refresh(6,{navigation:{role:testTarget.role,phase:'task-refresh'}});await capture(`v2-s6-${testTarget.path}-student-task-real-plan`,6);
  return {runId:proof.runId,assistantMessageId:proof.assistantMessageId,task:saved.task,revision:(await stage(6)).revision};
}
export async function applyV2TestCandidate({ui,testTarget,phase,observeNativeAction,capture}){
  if(!['plan','result'].includes(phase))fail('V2_S6_CANDIDATE_PHASE_INVALID');
  if(typeof observeNativeAction!=='function')fail('V2_S6_REAL_CANDIDATE_OBSERVER_REQUIRED');
  const {page,expect,stage}=ui;await ui.navigate(testTarget,{role:testTarget.role,phase:'candidate-'+phase+'-entry'});
  const record=checkBinding(parseV2Record(await stage(6),'testGroup:',testTarget.entityId),testTarget);
  if(!record.task.trim())fail('V2_S6_STUDENT_INITIAL_TEST_TASK_REQUIRED');
  await ui.expand('需要 AI 帮助整理？');
  const host=page.getByRole('region',{name:phase==='plan'?'研究前，完善测试问题':'研究后，整理学习与反思',exact:true});
  const task='学生审阅后的合成测试任务：请指出等待信息，再说明比较选项时的理解与犹豫；本轮不判断真实付费或耗时。';
  const reflection='本次只有合成或模拟软件测试材料，不能得出真人验证结果；仍需要真实对象在具体时间情境中的体验。';
  const saved=await ui.selectCandidate({stageId:6,host,actionLabel:phase==='plan'?'请 AI 提供问题草稿':'请 AI 整理反思草稿',adoptLabel:'采用到草稿',
    editRegion:'编辑 AI 测试草稿',editLabel:'测试问题与任务',editText:task,saveLabel:'保存为测试草稿',operationId:`s6-test-${testTarget.path}-${phase}-candidate`,saveOperationId:`s6-test-${testTarget.path}-candidate-${phase}-save`,saveRole:testTarget.role,refreshPhase:phase==='plan'?'plan-refresh':'evidence-refresh',
    editExtra:phase==='result'?async local=>{await local.getByLabel('学生反思',{exact:true}).fill(reflection);await local.getByLabel('学生解释',{exact:true}).fill('学生解释：当前只检查软件流程，真实人群差异与使用效果仍未知。');}:undefined});
  const actual=checkBinding(parseV2Record(saved.stage,'testGroup:',testTarget.entityId),testTarget);
  if(actual.task!==task||phase==='result'&&actual.reflection!==reflection||actual.confirmedFromMessageId)fail('V2_S6_CANDIDATE_NOT_EXPLICIT_UNCONFIRMED_SAVE');
  if(testTarget.path==='virtual'&&(actual.said||actual.did))fail('V2_S6_SIMULATED_RESULT_WRITTEN_AS_REAL_BEHAVIOR');
  await capture(`v2-s6-${testTarget.path}-${phase}-candidate-explicit-save`,6);
  return saved;
}
export async function confirmV2TestLearning({ui,testTarget,teachingFeedback,report,capture,printFormal,returnStep='2',understandingChange='insufficient'}){
  if(!['1','2','3','4','5','undecided'].includes(returnStep)||!['changed','unchanged','insufficient'].includes(understandingChange))fail('V2_S6_STUDENT_REFLECTION_CHOICE_INVALID');
  const {page,expect,btn,click,stage,save}=ui;await ui.navigate(testTarget,{role:testTarget.role,phase:'learning-entry'});
  const record=checkBinding(parseV2Record(await stage(6),'testGroup:',testTarget.entityId),testTarget);
  if((testTarget.path==='virtual'||record.evidenceOrigin)&&understandingChange!=='insufficient')fail('V2_S6_SIMULATION_CANNOT_VERIFY_REAL_USERS');
  const evidence=record.evidenceOrigin==='synthetic-file-asr'?`已保存的合成ASR来源 ${record.sourceLocation}，只能作为合成软件材料。`:testTarget.path==='virtual'?'已绑定的原生虚拟研究大纲、模拟对话、报告与原段回链，均为模拟。':testTarget.path==='survey'?`已发布问卷 ${record.source?.id??'缺失'} 的实际提交答卷 ${record.surveyResponseId??'缺失'}，填答者是软件QA合成人员，不是真实课堂对象。`:`本组已保存的授权材料 ${record.sourceLocation||'尚未明确'}；真实测试尚未证实。`;
  if(testTarget.path==='survey'&&(!record.source?.id||!record.surveyResponseId))fail('V2_S6_ACTUAL_SURVEY_RESPONSE_REQUIRED');
  if(testTarget.path==='virtual'&&!((await stage(6)).content.draft.fields['testVirtualResearch:'+record.id]))fail('V2_S6_ACTUAL_SIMULATED_RESEARCH_PIN_REQUIRED');
  const prompt=`${V2_SYNTHETIC}。这是学生本轮认识变化与取舍，针对测试实体 ${record.id}，固定原型 ${record.versionId}、第5步V${record.stage5Revision}，不要换成当前head。证据：${evidence}\n学生反思：${record.reflection||'当前证据仍不足，不等同问题已解决。'}\n学生决定认识状态为 ${understandingChange}：现有材料不能证明真实用户是否理解等待信息，仍需真实体验。仅保留真实已保存的材料引用；不编原话或现场行动，模拟的said/did必须为空。优先返回 ${returnStep==='undecided'?'暂未决定，需要教师支持':`第${returnStep}步`}；原因是需要厘清研究对象和使用情境，再决定下一轮验证。下一步先核对授权，围绕原问题补充实际材料；不是自动美化原型。请整理本轮测试成果和对应认识变化/返回行动草稿，等待我审阅确认，不自动保存或确认。`;
  if(!await teachingFeedback(6,prompt))fail('V2_S6_STUDENT_RESULT_REAL_REPLY_REQUIRED');
  const proof=nativeProof(report,testTarget,prompt);
  const actions=page.getByTestId('aidt-test-chat-confirmation');await expect(actions).toBeVisible();
  const confirm=btn('确认并保存测试成果',actions);await expect(confirm).toBeEnabled();
  const saved=await save(6,()=>click(confirm),{confirmation:true,operationId:'s6-'+testTarget.role+'-confirm-learning',entityRole:testTarget.role,entityId:testTarget.entityId});
  const fields=saved.stage.content.draft.fields,confirmed=checkBinding(parseV2Record(saved.stage,'testGroup:',record.id),testTarget);
  if(confirmed.confirmedFromMessageId!==proof.assistantMessageId||!confirmed.task.trim()||!confirmed.reflection.trim()||fields.reflectionConfirmed!=='true'||fields.understandingChangeStatus!==understandingChange||fields.returnStep!==returnStep||!fields.returnReason?.trim()||returnStep!=='undecided'&&!fields.nextAction?.trim())fail('V2_S6_CONFIRMED_REAL_ROUND_SAVE_MISMATCH');
  if((testTarget.path==='virtual'||record.evidenceOrigin)&&(confirmed.said||confirmed.did||!confirmed.evidenceGap?.trim()))fail('V2_S6_SYNTHETIC_BOUNDARY_LOST_AT_CONFIRMATION');
  await ui.refresh(6,{expectedRevision:saved.receipt.revision,navigation:{role:testTarget.role,phase:'reflection-refresh'},assertSaved:stage=>checkBinding(parseV2Record(stage,'testGroup:',record.id),testTarget)});
  await ui.outcome(testTarget,{role:testTarget.role,phase:'formal-outcome'});const output=page.getByTestId('aidt-test-group-detail');await expect(output).toContainText('已确认');await expect(output).toContainText(confirmed.reflection);
  await capture(`v2-s6-${testTarget.path}-learning-confirmed-refreshed`,6);
  const printReceipt=await printFormal({stage:6,name:`${testTarget.path}-test-learning-record`,entityId:record.id,button:output.getByRole('button',{name:'预览与打印测试记录',exact:true}),requiredTexts:[record.name,confirmed.task,confirmed.reflection],sourceRevision:saved.receipt.revision});
  return {target:testTarget,revision:saved.receipt.revision,runId:proof.runId,confirmedFromMessageId:proof.assistantMessageId,returnStep,understandingChange,printReceipt,realHumanValidation:false};
}
const canonicalRound=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonicalRound).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalRound(value[key])).join(',')+'}';
export function readV2SavedEntityRound(stage,target,{newVersion}={}){
  const fields=stage.content.draft.fields,prefix='testRound:'+target.entityId+':',round=Object.fromEntries(Object.entries(fields).filter(([key])=>key.startsWith(prefix)).map(([key,value])=>[key.slice(prefix.length),value])),group=checkBinding(parseV2Record(stage,'testGroup:',target.entityId),target);let signature,snapshot,reference,relation;try{signature=JSON.parse(round.testSourceSignature??'null');snapshot=JSON.parse(round.questionSnapshot??'null');reference=JSON.parse(round.iterationPrototypeReference??'null');relation=JSON.parse(round.iterationPrototypeRelation??'null');}catch{fail('V2_ITERATION_SAVED_ENTITY_ROUND_INVALID');}
  if(canonicalRound(signature)!==canonicalRound(group)||snapshot?.prototypeDesignId!==target.designId||snapshot.prototypeVersionId!==target.versionId||snapshot.sourceStageRevision!==target.stage5Revision||round.reflectionConfirmed!=='true'||round.returnStep!=='5'||round.understandingChangeStatus!=='insufficient'||!round.returnReason?.trim()||!round.nextAction?.trim()||fields.reflectionSourceEntity!==target.entityId)fail('V2_ITERATION_ENTITY_ROUND_NOT_SAVED_WITH_OLD_TESTED_SOURCE');
  if(newVersion&&(reference?.designId!==newVersion.designId||reference.versionId!==newVersion.versionId||reference.versionId===target.versionId||relation?.questionSnapshot!==round.questionSnapshot||relation.producedDesignId!==newVersion.designId||relation.producedVersionId!==newVersion.versionId||Number(round.iterationSourceStageRevision)!==newVersion.stage5Revision||!round.iterationFeedbackReference?.trim()||!round.iterationChangeReason?.trim()))fail('V2_ITERATION_NEW_VERSION_RELATION_NOT_SAVED');
  return {group,snapshot,round,reference,relation};
}
export async function runV2OfflineIteration({ui,offline,prototype,read,runNativeOperation,prepareSourceImages,capture,printFormal}){
  const target=offline.target,{page,expect,btn,click,stage,save}=ui;if(offline.status!=='passed'||target.path!=='offline'||offline.confirmed.returnStep!=='5')fail('V2_ITERATION_CONFIRMED_OFFLINE_RETURN_FIVE_REQUIRED');
  await ui.navigate(target,{role:target.role,phase:'iteration-entry',tool:'outcome'});const initial=await stage(6),group=checkBinding(parseV2Record(initial,'testGroup:',target.entityId),target),pin=JSON.parse(initial.content.draft.fields['testSyntheticAsr:'+target.entityId]??'null');if(!pin?.reviewedText||group.evidenceOrigin!=='synthetic-file-asr')fail('V2_ITERATION_ACTUAL_SYNTHETIC_FEEDBACK_REQUIRED');
  const panel=page.getByTestId('aidt-test-group-iteration');await expect(panel).toBeVisible();await ui.expand('本轮反思与迭代',panel);
  await panel.getByLabel('测试后的认识',{exact:true}).selectOption('insufficient');await panel.getByLabel('测试后怎么看',{exact:true}).fill(group.afterTestBelief?.trim()||'当前只有合成软件测试材料，不能证明真人体验；下一版仅改进表达与交互后再做真实测试。');
  const evidence=`合成ASR软件材料：${pin.transcript.artifactId} / V${pin.transcript.version} / SHA256 ${pin.transcript.sha256}；原件 ${pin.audio.artifactId}；不是任何真人反馈。`;
  await panel.getByLabel('材料依据',{exact:true}).fill(evidence);await panel.getByLabel('仍不确定的地方',{exact:true}).fill(group.evidenceGap?.trim()||'真实对象是否理解等待信息，以及是否在真实情境愿意继续比较，均尚未验证。');await panel.getByLabel('从哪一步重新入手',{exact:true}).selectOption('5');await panel.getByLabel('选择理由',{exact:true}).fill('本轮先回原型制作，根据已保存的合成软件材料改进等待信息和返回比较的表达；不把它当成真人研究已经证实。');await panel.getByLabel('下一步行动',{exact:true}).fill('保留被测旧版与原问题，生成一个实际新版本，明确关联本次材料与改动理由，并标记待真实测试。');await ui.unchanged(6,initial);
  const reflected=await save(6,()=>click(btn('确认并保存本轮反思与迭代',panel)),{confirmation:true,operationId:'s6-test-offline-return-step-five',entityRole:target.role,entityId:target.entityId});readV2SavedEntityRound(reflected.stage,target);await ui.refresh(6,{expectedRevision:reflected.receipt.revision,navigation:{role:target.role,phase:'iteration-reflection-refresh'}});
  const entryLink=panel.getByRole('link',{name:'带着本轮反思，回到第5步 · 原型制作',exact:true});await expect(entryLink).toBeVisible();const produced=await produceV2OfflineIterationVersion({ui,testTarget:target,prototype:prototype.text,entryLink,runNativeOperation,read,prepareSourceImages,capture});
  await ui.navigate(target,{role:target.role,phase:'iteration-binding-entry',tool:'outcome'});await ui.expand('本轮反思与迭代',panel);await ui.expand('已有新版？关联迭代产出',panel);const beforeBinding=await stage(6),iteration=panel.getByTestId('aidt-iteration-prototype');await expect(iteration).toBeVisible();await click(btn('选择迭代产出原型版本',iteration));const picker=iteration.getByTestId('aidt-prototype-version-picker'),design=picker.getByRole('button',{name:prototype.text.name,exact:true});await expect(design).toBeVisible();await click(design);const version=picker.getByRole('button').filter({hasText:'版本 ID：'+produced.versionId});await expect(version).toHaveCount(1);await click(version);await expect(picker.getByTestId('aidt-prototype-recorded-reference')).toContainText(produced.versionId);
  await iteration.getByLabel('本次修改依据的反馈或未解问题引用',{exact:true}).fill(evidence);await iteration.getByLabel('相对旧版改了什么，为什么？',{exact:true}).fill('依据该合成材料，明确等待信息、比较与返回操作，并新增“迭代版·待真实测试”标记；保留旧被测版本，不宣称实际用户已经认可。');await click(btn('确认关联本次产出、旧版与反馈',iteration));await ui.unchanged(6,beforeBinding);
  const bound=await save(6,()=>click(btn('确认并保存本轮反思与迭代',panel)),{confirmation:true,operationId:'s6-test-offline-iteration-version-bind',entityRole:target.role,entityId:target.entityId});const linked=readV2SavedEntityRound(bound.stage,target,{newVersion:produced});await ui.refresh(6,{expectedRevision:bound.receipt.revision,navigation:{role:target.role,phase:'iteration-saved-refresh'}});readV2SavedEntityRound(await stage(6),target,{newVersion:produced});await capture('v2-s6-iteration-new-version-keeps-tested-old-version',6);
  const printReceipt=await printFormal({stage:6,name:'iteration-prototype',entityId:target.entityId,button:panel.getByRole('button',{name:'预览与打印迭代原型',exact:true}),requiredTexts:['迭代版·待真实测试'],sourceRevision:bound.receipt.revision});return {produced,sourceRoundRevision:reflected.receipt.revision,iterationRoundRevision:bound.receipt.revision,testedOldVersionId:linked.snapshot.prototypeVersionId,exactNamespace:'testRound:'+target.entityId+':',stillPendingRealTest:true,printReceipt};
}

/** Independent paths remain separate. A known missing ASR dependency is not repaired with fake speech. */
export async function runV2S6Paths(options){
  const {ui,prototype,capture,teachingFeedback,observeNativeAction,report,printFormal,runNativeOperation}=options;
  const receipts=[];
  for(const path of paths){
    const target=await createV2TestGroup({ui,prototype,path,capture,onEntityCreated:options.onEntityCreated});
    const initial=await seedV2StudentTestTask({ui,testTarget:target,teachingFeedback,report,capture});
    const plan=await applyV2TestCandidate({ui,testTarget:target,phase:'plan',observeNativeAction,capture});
    let research;
    if(path==='offline'){
      const audio=await attachV2SyntheticAudio({ui,testTarget:target,audioFixture:options.audioFixture,registerFixture:options.registerFixture,capture});
      if(audio.status==='BLOCKED'){receipts.push({path,target,initial,planRevision:plan.receipt.revision,status:'BLOCKED',code:audio.code,realC1Interview:'NOT_RUN'});continue;}
      research=await runV2SyntheticAsr({ui,testTarget:target,runNativeOperation,read:options.read,approveKnownTool:options.approveKnownTool,reviewTranscript:options.reviewTranscript,capture,actorId:options.actorId,printFormal,completeAsrOperation:options.completeAsrOperation});
      if(research.status==='BLOCKED'){receipts.push({path,target,initial,planRevision:plan.receipt.revision,status:'BLOCKED',code:research.code,realC1Interview:'NOT_RUN'});continue;}
    }else if(path==='survey')research=await runV2SurveyResearch({ui,testTarget:target,runNativeOperation,createSurveyParticipant:options.createSurveyParticipant,readSurveyReceipt:options.readSurveyReceipt,capture,armSurvey:options.armSurvey,runV2UIAction:options.runV2UIAction,surveyPublication:options.surveyPublication,printFormal});
    else research=await runV2VirtualResearch({ui,testTarget:target,runNativeOperation,capture,readResearchDocument:options.readResearchDocument,printFormal});
    const result=await applyV2TestCandidate({ui,testTarget:target,phase:'result',observeNativeAction,capture});
    const confirmed=await confirmV2TestLearning({ui,testTarget:target,teachingFeedback,report,capture,printFormal,returnStep:options.returnSteps?.[path]??(path==='offline'?'5':'2')});
    receipts.push({path,target,status:'passed',initial,planRevision:plan.receipt.revision,research,resultRevision:result.receipt.revision,confirmed});
  }
  let iteration=null;if(receipts.every(item=>item.status==='passed')){iteration=await runV2OfflineIteration({ui,offline:receipts.find(row=>row.path==='offline'),prototype,read:options.read,runNativeOperation,prepareSourceImages:options.prepareSourceImages,capture,printFormal});await ui.completed(6);}
  return {receipts,iteration,allThreePathsConfirmed:receipts.length===3&&receipts.every(item=>item.status==='passed'),realC1Interview:'NOT_RUN',realHumanValidation:false};
}
