/** S2's actual interview/observation synthetic-audio portal; no hidden stage writes or fake transcript. */
import { createHash } from 'node:crypto';
import { ProbeFailure } from './devapp-aidt-auth-readonly.mjs';
import { parseV2Record } from './devapp-aidt-v2-ui.mjs';
import { collectV2ReviewedAsrDraft,actualV2AsrBytes,assertV2PublishedAsrProof,printV2AsrFormalReport } from './devapp-aidt-v2-asr.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw new ProbeFailure(code);};
const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
const blocked=code=>({status:'BLOCKED',code,syntheticFilePipeline:true,realC1Interview:'NOT_RUN',realHumanValidation:false});
export function readV2InterviewAudio(stage,entityId,projectId,sha256){
  const record=parseV2Record(stage,'interviewRecord:',entityId),fields=stage.content.draft.fields;
  if(fields['interviewArchived:'+entityId]==='true'||!record.consent?.notes||!record.consent.audio)fail('V2_S2_ASR_SAVED_NOTES_AUDIO_AUTHORIZATION_REQUIRED');
  const matches=Object.entries(fields).filter(([key])=>key.startsWith('interviewMaterial:'+entityId+':')).flatMap(([key,value])=>{const reference=parse(value);return reference?.projectId===projectId&&reference.mime?.startsWith('audio/')&&(!sha256||reference.sha256===sha256)?[{key,reference}]:[];});
  if(matches.length!==1)fail('V2_S2_ASR_EXACT_ONE_OWNED_AUDIO_REQUIRED');
  return {record,materialKey:matches[0].key,audioSource:matches[0].reference};
}
export function assertV2S2SavedAsr({stage,entityId,projectId,materialKey,audioSource,expectedText,runId}){
  const current=readV2InterviewAudio(stage,entityId,projectId,audioSource.sha256),fields=stage.content.draft.fields,pin=parse(fields['interviewSyntheticAsr:'+entityId]),transcript=parse(fields['interviewTranscript:'+entityId]);
  if(current.materialKey!==materialKey||current.audioSource.artifactId!==audioSource.artifactId||current.audioSource.versionId!==audioSource.versionId||current.audioSource.runId!==audioSource.runId||!pin||pin.kind!=='synthetic-file-asr'||pin.audio?.sha256!==audioSource.sha256||pin.audio.artifactId!==audioSource.artifactId||pin.audio.versionId!==audioSource.versionId||pin.audio.runId!==audioSource.runId||pin.reviewedText!==expectedText||pin.transcript?.producedByRunId!==runId||!transcript||transcript.sourceKey!==materialKey||transcript.text!==expectedText||transcript.checked!==false||transcript.locator!==`合成软件测试 ASR V${pin.transcript.version}`)fail('V2_S2_ASR_EXPLICIT_SAVE_AND_UNCHECKED_TRANSCRIPT_REQUIRED');
  return {pin,transcript,record:current.record};
}
export async function runV2S2SyntheticAsr({ui,record,audioFixture,registerFixture,runNativeOperation,read,approveKnownTool,reviewTranscript,actorId,capture,calibrate=true,printFormal,completeAsrOperation}){
  const {page,expect,btn,click,stage,save}=ui,target=record?.target;const role='source-interview';const mutate=(suffix,action)=>save(2,action,{operationId:`s2-${role}-${suffix}`,entityRole:role,entityId:target?.entityId});
  if(audioFixture&&typeof audioFixture.filename==='string')audioFixture={...audioFixture,filename:audioFixture.filename.replace(/\.(wav|mp3)$/i,'-s2.$1')};
  if(!target?.entityId||!target.threadId||typeof capture!=='function')fail('V2_S2_ASR_EXISTING_SOURCE_ENTITY_REQUIRED');
  if(typeof reviewTranscript!=='function'||reviewTranscript.preflightReady===false)return blocked('V2_S2_ASR_DYNAMIC_REVIEW_CHANNEL_PENDING');
  if(!audioFixture||audioFixture.synthetic!==true||!Buffer.isBuffer(audioFixture.bytes)||audioFixture.bytes.length<44||audioFixture.bytes.length>262144||!['audio/wav','audio/x-wav','audio/mpeg'].includes(audioFixture.mime)||!audioFixture.filename?.startsWith('qa-'+ui.scope.runId+'-'))return blocked('V2_S2_ASR_AUTHORIZED_SYNTHETIC_AUDIO_REQUIRED');
  const route=new URL(target.href);if(route.origin!==ui.origin||route.pathname!==ui.projectPath||route.searchParams.get('step')!=='2'||route.searchParams.get('entity')!==target.entityId)fail('V2_S2_ASR_ENTITY_ROUTE_CHANGED');route.searchParams.set('tool','sources');await ui.navigate(target,{role,phase:'asr-entry',tool:'sources'});
  let saved=await stage(2),interview=parseV2Record(saved,'interviewRecord:',target.entityId);const label=interview.kind==='observation'?'观察':'访谈';await ui.expand(label+'材料与授权');
  const hadConfirmedFinding=saved.content.draft.fields['interviewConfirmed:'+target.entityId]==='true';
  if(!interview.consent?.notes||!interview.consent.audio){
    await page.getByLabel('已获授权共享文字记录',{exact:true}).check();await page.getByLabel('已获授权共享原始录音',{exact:true}).check();saved=(await mutate('audio-consent',()=>click(btn('更新授权记录')))).stage;
  }
  const digest=hash(audioFixture.bytes);let matching=Object.entries(saved.content.draft.fields).filter(([key,value])=>key.startsWith('interviewMaterial:'+target.entityId+':')&&parse(value)?.sha256===digest&&parse(value)?.mime?.startsWith('audio/'));
  if(!matching.length){
    const input=page.getByLabel(`${interview.code}研究原件选择文件`,{exact:true});if(!/(?:audio\/|\.wav|\.mp3)/i.test(await input.getAttribute('accept')??''))return blocked('V2_S2_ASR_NORMAL_AUDIO_INPUT_UNAVAILABLE');
    if(typeof registerFixture!=='function')fail('V2_S2_ASR_FIXTURE_REGISTRATION_REQUIRED');registerFixture({filename:audioFixture.filename,bytes:audioFixture.bytes,mime:audioFixture.mime});
    await input.setInputFiles({name:audioFixture.filename,mimeType:audioFixture.mime,buffer:audioFixture.bytes});const host=page.getByTestId('aidt-research-material-control').filter({has:input});saved=(await save(2,()=>click(btn('保存原始材料',host)),{uiAction:{actionId:'s2-source-interview-audio-original-and-bind',steps:[{operationId:'s2-source-interview-audio-upload',kind:'write',requestKind:'upload',stageId:2,entityRole:role,entityId:target.entityId,method:'POST',path:`/api/projects/${ui.scope.projectId}/artifacts/upload`},{operationId:'s2-source-interview-audio-bind',kind:'write',requestKind:'stage-save',stageId:2,entityRole:role,entityId:target.entityId,method:'PUT',path:`/api/projects/${ui.scope.projectId}/aidt/stages/2`}]}})).stage;await expect(host).toContainText('原件已保存并回读');
  }
  const audio=readV2InterviewAudio(saved,target.entityId,ui.scope.projectId,digest);
  if(audio.audioSource.bytes!==audioFixture.bytes.length||audio.audioSource.name!==audioFixture.filename)fail('V2_S2_ASR_ORIGINAL_BYTES_NOT_READ_BACK');
  const slot=page.locator('[data-aidt-asr-project='+JSON.stringify(ui.scope.projectId)+'][data-aidt-asr-entity='+JSON.stringify(target.entityId)+'][data-aidt-asr-material='+JSON.stringify(audio.materialKey)+']');await expect(slot).toHaveCount(1);await expect(slot.getByRole('region',{name:label+'合成音频转写',exact:true})).toBeVisible();
  const initial=await stage(2),collected=await collectV2ReviewedAsrDraft({ui,stageId:2,entityId:target.entityId,threadId:target.threadId,audioSource:audio.audioSource,initial,entityRole:'source-interview',uploadOperationId:'s2-source-interview-chat-audio-upload',asrOperationId:'s2-source-interview-file-asr',runNativeOperation,read,approveKnownTool,reviewTranscript,actorId,completeAsrOperation});
  if(collected.status!=='reviewed-local')return collected;
  const {actualRun,human,reviewedText}=collected,local=slot.getByRole('region',{name:`待保存的${label}合成转写`,exact:true});await expect(local).toBeVisible();await ui.unchanged(2,initial);
  await local.getByLabel('校对后的合成摘录',{exact:true}).fill(reviewedText.text);await ui.unchanged(2,initial);
  await local.getByRole('checkbox',{name:new RegExp(`已对照原件或合成基准内容核对，同意将这段文字保存为本${label}`)}).check();
  const committed=await mutate('asr-transcript-save',()=>click(btn(`保存${label}合成转写摘录`,local)));
  const state=assertV2S2SavedAsr({stage:committed.stage,entityId:target.entityId,projectId:ui.scope.projectId,materialKey:audio.materialKey,audioSource:audio.audioSource,expectedText:reviewedText.text,runId:actualRun.runId});
  const originalBytes=await actualV2AsrBytes(page,`/api/ingestion-runs/${encodeURIComponent(audio.audioSource.runId)}/content?projectId=${encodeURIComponent(ui.scope.projectId)}`,audio.audioSource.bytes);
  const nativeAudioBytes=await actualV2AsrBytes(page,`/api/chat/threads/${encodeURIComponent(state.pin.nativeAudio.threadId)}/attachments/${encodeURIComponent(state.pin.nativeAudio.attachmentId)}/content`,audio.audioSource.bytes);
  const artifactBytes=await actualV2AsrBytes(page,`/api/artifacts/${encodeURIComponent(state.pin.transcript.artifactId)}/versions/${state.pin.transcript.version}/content`,262144);
  const proof=assertV2PublishedAsrProof({pin:state.pin,audioSource:audio.audioSource,entityId:target.entityId,run:actualRun,human,artifactBytes,nativeAudioBytes,originalBytes});
  await ui.refresh(2,{expectedRevision:committed.receipt.revision,navigation:{role,phase:'asr-saved-refresh'}});await ui.expand(label+'材料与授权');
  await expect(page.getByLabel('已对照原始材料校对',{exact:true})).not.toBeChecked();await expect(page.getByLabel('校对后的摘录',{exact:true})).toHaveValue(reviewedText.text);await capture('v2-s2-synthetic-asr-saved-unchecked',2);
  let calibratedRevision=null;
  if(calibrate){
    const checkbox=page.getByLabel('已对照原始材料校对',{exact:true});const calibrated=await mutate('asr-transcript-check',()=>checkbox.check());const transcript=parse(calibrated.stage.content.draft.fields['interviewTranscript:'+target.entityId]);if(!transcript?.checked||transcript.sourceKey!==audio.materialKey||transcript.text!==reviewedText.text)fail('V2_S2_ASR_INDEPENDENT_TRANSCRIPT_CHECK_NOT_SAVED');calibratedRevision=calibrated.receipt.revision;await ui.refresh(2,{expectedRevision:calibratedRevision,navigation:{role,phase:'asr-calibrated-refresh'}});await ui.expand(label+'材料与授权');await expect(checkbox).toBeChecked();await capture('v2-s2-synthetic-asr-independent-calibration',2);
  }
  const printStage=await stage(2),printRevision=calibratedRevision??committed.receipt.revision;if(printStage.revision!==printRevision||printStage.content.draft.fields['interviewSyntheticAsr:'+target.entityId]!==committed.stage.content.draft.fields['interviewSyntheticAsr:'+target.entityId])fail('V2_S2_ASR_FORMAL_PRINT_SAVED_SOURCE_CHANGED');
  const printReceipt=await printV2AsrFormalReport({ui,printFormal,stageId:2,entityId:target.entityId,sourceRevision:printRevision,pin:state.pin,audioSource:audio.audioSource,artifactBytes});
  return {status:'passed',...proof,printReceipt,entityId:target.entityId,sourceRevision:committed.receipt.revision,calibratedRevision,materialKey:audio.materialKey,sourceSha256:digest,reviewedText:reviewedText.text,reviewedTextSha256:hash(Buffer.from(reviewedText.text)),reviewMethod:reviewedText.reviewMethod,manualListeningVerified:false,savedInitiallyCheckedFalse:true,independentCalibration:calibrate,requiresFindingReconfirmation:hadConfirmedFinding,realC1Interview:'NOT_RUN',realHumanValidation:false};
}
