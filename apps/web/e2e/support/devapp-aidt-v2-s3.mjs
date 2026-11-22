import { createHash } from 'node:crypto';
import { ProbeFailure } from './devapp-aidt-auth-readonly.mjs';
import { V2_SYNTHETIC } from './devapp-aidt-v2-ui.mjs';
import { useV2DefinitionCandidate } from './devapp-aidt-v2-definition.mjs';
const fail=code=>{throw new ProbeFailure(code);};
export async function runV2S3({ui,s2,teachingFeedback,observeNativeAction,capture,printFormal,earlyCrud}) {
  if(!s2?.records?.length||!s2.next)fail('V2_S3_CONFIRMED_S2_REQUIRED');
  const {page,expect,btn,click,fill,stage,save}=ui;
  await page.goto(new URL(s2.next,ui.origin).href,{waitUntil:'domcontentloaded'});
  await click(page.getByTestId('aidt-new-entity-card'));
  await click(btn('新建意外发现',page.getByRole('group',{name:'选择卡片类型',exact:true})));
  const dialog=page.getByRole('dialog',{name:'新建意外发现',exact:true});await fill('卡片名称','本轮例外核对',dialog);
  const source=dialog.getByRole('group',{name:'来源访谈',exact:true});await source.getByRole('checkbox').first().check();
  const role='surprise-main',entityId='primary-surprise',base=`/api/projects/${ui.scope.projectId}/aidt/stages/3`;
  await save(3,()=>click(btn('创建意外发现',dialog)),{uiAction:{actionId:'s3-surprise-main-normal-create',steps:[
    {operationId:'s3-surprise-main-create',kind:'write',requestKind:'stage-save',stageId:3,entityRole:role,entityId,method:'PUT',path:base},
    {operationId:'s3-surprise-main-entity-thread-initial',kind:'write',requestKind:'entity-thread',stageId:3,entityRole:role,entityId,method:'PUT',path:base+'/entities/'+entityId+'/thread',captureThread:true},
    {operationId:'s3-surprise-main-thread-mount',kind:'write',requestKind:'thread-mount',stageId:3,entityRole:role,entityId,method:'POST',path:'/api/threads/{createdThread}/skill-mounts'},
  ]}});
  await page.waitForURL(url=>url.searchParams.get('entity')&&url.searchParams.get('thread')?.startsWith('thr'));
  const surprise=ui.route(3);
  if(!await teachingFeedback(3,`${V2_SYNTHETIC}。学生重新核对了本组访谈/观察材料，目前暂无与原先想法不同的证据。请记录暂无意外发现，不编造惊喜或心理动机。`))fail('V2_S3_SURPRISE_REPLY_REQUIRED');
  // Native feedback populates only the local student-reviewed surprise draft; the following button is its real PUT.
  await save(3,()=>click(btn('确认当前产物')),{operationId:'s3-surprise-main-confirm',entityRole:role,entityId});await ui.outcome(surprise,{role,phase:'formal-outcome'});
  const output=page.getByTestId('aidt-definition-editor');await expect(output).toContainText('暂无');await capture('v2-s3-surprise-none-confirmed-before-revision',3);
  await printFormal({stage:3,name:'confirmed-surprise',entityId:surprise.entityId,button:btn('打印意外发现',output),requiredTexts:['暂无'],sourceRevision:(await stage(3)).revision});
  const revisedSurprise=await reviseV2PrimarySurprise({ui,s2,surprise,capture,printFormal});
  if(typeof earlyCrud!=='function')fail('V2_S3_EARLY_SURPRISE_CRUD_CALLBACK_REQUIRED');
  const surpriseCrud=await earlyCrud({kind:'surprise',ui,s2,primary:surprise,sourceRevision:revisedSurprise.sourceRevision});
  const sourceCodes=s2.records.map(row=>row.code);
  // The one-candidate branch is genuinely generated and cancelled; it is never placed in formal outputs.
  await useV2DefinitionCandidate({ui,kind:'persona',count:1,sourceCodes,observeNativeAction,capture,printFormal,cancelAfterPreview:true});
  const persona=await useV2DefinitionCandidate({ui,kind:'persona',count:2,sourceCodes,observeNativeAction,capture,printFormal});
  await useV2DefinitionCandidate({ui,kind:'hmw',count:1,sourceCodes,observeNativeAction,capture,printFormal,cancelAfterPreview:true});
  const hmw=await useV2DefinitionCandidate({ui,kind:'hmw',count:2,sourceCodes,observeNativeAction,capture,printFormal});
  await ui.go(3);await expect(page.getByTestId('aidt-stage-next')).toBeVisible();const next=await page.getByTestId('aidt-stage-next').getAttribute('href');
  await ui.completed(3);return {surprise,revisedSurprise,surpriseCrud,persona,hmw,next,revision:(await stage(3)).revision};
}

/** Derive only from the same saved, consented and confirmed S2 material, including actual reviewed ASR when it succeeded. */
export function deriveV2SurpriseRevision({sourceStage,records,projectId}) {
  if(sourceStage?.projectId!==projectId||sourceStage.stageId!==2||!Number.isSafeInteger(sourceStage.revision)||sourceStage.revision<1||!Array.isArray(records)||!records.length)fail('V2_S3_SURPRISE_CURRENT_SOURCE_REQUIRED');
  const source=records.find(row=>row.kind==='interview')??records[0],entityId=source?.target?.entityId;
  let interview;try{interview=JSON.parse(sourceStage.content.draft.fields['interviewRecord:'+entityId]??'null');}catch{}
  const card=sourceStage.content.draft.discoveryCards?.find(row=>row.id===entityId);
  if(!entityId||interview?.id!==entityId||interview.consent?.notes!==true||sourceStage.content.draft.fields['interviewConfirmed:'+entityId]!=='true'
    ||!card||card.participantCode!==source.code||!card.quote?.trim()||!card.sourceRef?.trim()||card.quote.trim()!==source.quote?.trim())fail('V2_S3_SURPRISE_SAVED_QUOTE_NOT_EXACT');
  if(source.syntheticAsr?.status==='passed'&&(card.quote.trim()!==source.syntheticAsr.reviewedText?.trim()||createHash('sha256').update(source.syntheticAsr.reviewedText).digest('hex')!==source.syntheticAsr.reviewedTextSha256))fail('V2_S3_SURPRISE_ACTUAL_ASR_QUOTE_NOT_EXACT');
  let transcript,material;try{transcript=JSON.parse(sourceStage.content.draft.fields['interviewTranscript:'+entityId]??'null');material=JSON.parse(sourceStage.content.draft.fields[transcript?.sourceKey]??'null');}catch{}
  const asr=source.syntheticAsr?.status==='passed'?source.syntheticAsr:null,expectedHash=asr?.sourceSha256??source.sourceSha256;
  if(!transcript?.checked||!transcript.locator?.trim()||!transcript.sourceKey?.startsWith('interviewMaterial:'+entityId+':')||!transcript.text?.includes(card.quote)||material?.projectId!==projectId||!material.artifactId||!material.versionId||!/^[a-f0-9]{64}$/.test(expectedHash??'')||material.sha256!==expectedHash
    ||asr&&transcript.sourceKey!==asr.materialKey||!asr&&material.name!==source.sourceFilename)fail('V2_S3_SURPRISE_SAVED_MATERIAL_HASH_NOT_EXACT');
  const terms=[...new Set([...['等待','队列','等候','排队'].filter(word=>card.quote.includes(word)),...(card.quote.match(/\b(?:wait(?:ing)?|queue)\b/gi)??[])])];if(!terms.length)fail('V2_S3_SURPRISE_WAITING_EVIDENCE_NOT_PRESENT');
  return {entityId,code:source.code,sourceRevision:sourceStage.revision,quote:card.quote,sourceRef:card.sourceRef,material:{artifactId:material.artifactId,versionId:material.versionId,sha256:material.sha256},
    priorBelief:'合成练习中，学生原先以为本轮材料只关心口味；这是学生此前的假设，并非已验证事实。',
    finding:`${V2_SYNTHETIC}。${source.code}的已保存摘录：“${card.quote}”。摘录中明确出现${terms.join('、')}，与原先只关注口味的想法不同。`,
    sourceDetails:`第2步共享 V${sourceStage.revision} · ${source.code} · ${entityId}\n${card.sourceRef}\n原件 ${material.artifactId} · 版本 ${material.versionId} · SHA256 ${material.sha256}\n逐字采用当前已保存并经学生校对的摘录；仅软件验收合成材料，非真实访谈。`,
    interpretation:`学生解释：这份合成材料也涉及${terms.join('、')}，需要重新审视原先假设。真实用户的行为、动机、普遍性及情境差异仍待真实研究；不把本练习当作研究验证。`,
    actualReviewedAsr:source.syntheticAsr?.status==='passed'};
}
export async function reviseV2PrimarySurprise({ui,s2,surprise,capture,printFormal}) {
  const {page,expect,btn,click,fill,stage,save}=ui,role='surprise-main',entityId='primary-surprise';
  const before=await stage(3);if(surprise?.entityId!==entityId||before?.content?.draft?.fields?.surpriseStatus!=='none'||before.content.draft.fields.surpriseConfirmed!=='true')fail('V2_S3_CONFIRMED_NONE_HISTORY_REQUIRED');
  const finding=deriveV2SurpriseRevision({sourceStage:await stage(2),records:s2.records,projectId:ui.scope.projectId});
  await ui.navigate(surprise,{role,phase:'found-edit',tool:'chat'});
  const review=page.getByRole('region',{name:'对话产物确认',exact:true});await expect(review).toBeVisible();
  await click(btn('修订记录',review));
  const editor=page.getByTestId('aidt-surprise-reflection');await expect(editor).toBeVisible();
  await editor.getByRole('radio',{name:'有意外发现',exact:true}).check();
  await fill('原先我们怎么想',finding.priorBelief,editor);await fill('实际看到或听到了什么',finding.finding,editor);
  const sources=editor.getByRole('group',{name:'关联人物发现卡或原始材料',exact:true});
  for(const box of await sources.getByRole('checkbox').all())if(await box.isChecked())await box.uncheck();
  const source=sources.getByRole('checkbox',{name:new RegExp('^'+finding.code+'(?:\\s|·)')});await expect(source).toHaveCount(1);await source.check();
  await fill('意外发现的原始材料与定位',finding.sourceDetails,editor);await fill('我们对意外发现的理解',finding.interpretation,editor);
  await ui.unchanged(3,before);await capture('v2-s3-surprise-found-edited-not-saved',3);
  const freshSource=deriveV2SurpriseRevision({sourceStage:await stage(2),records:s2.records,projectId:ui.scope.projectId});if(freshSource.sourceRevision!==finding.sourceRevision||freshSource.quote!==finding.quote||freshSource.sourceRef!==finding.sourceRef)fail('V2_S3_SURPRISE_SOURCE_CHANGED_BEFORE_CONFIRM');
  const confirmed=await save(3,()=>click(btn('确认当前产物',review)),{operationId:'s3-surprise-main-found-confirm',entityRole:role,entityId,assertSaved:value=>{
    const fields=value.content.draft.fields;let ids;try{ids=JSON.parse(fields.surpriseCardIds??'null');}catch{}
    if(fields.surpriseStatus!=='found'||fields.surpriseConfirmed!=='true'||fields.priorBelief!==finding.priorBelief||fields.surprisingFinding!==finding.finding
      ||fields.surpriseSourceDetails!==finding.sourceDetails||fields.surpriseInterpretation!==finding.interpretation||fields.surpriseSourceRevision!==String(finding.sourceRevision)
      ||!Array.isArray(ids)||ids.length!==1||ids[0]!==finding.entityId)fail('V2_S3_SURPRISE_FOUND_CONFIRM_NOT_EXACT');
  }});
  await ui.refresh(3,{expectedRevision:confirmed.receipt.revision,navigation:{role,phase:'found-refresh'}});
  await ui.outcome(surprise,{role,phase:'found-outcome'});const output=page.getByTestId('aidt-definition-editor');
  await expect(output).toContainText(finding.quote);await capture('v2-s3-surprise-found-confirmed-refreshed',3);
  const printing=await printFormal({stage:3,name:'confirmed-surprise-revised',entityId,button:btn('打印意外发现',output),requiredTexts:[finding.quote,finding.priorBelief],sourceRevision:confirmed.receipt.revision});
  return {...finding,noneRevision:before.revision,confirmedRevision:confirmed.receipt.revision,printing};
}
