/** Actual synthetic attachment ASR only. No C1 human-interview or recorder-session claim is made. */
import { createHash } from 'node:crypto';
import { ProbeFailure } from './devapp-aidt-auth-readonly.mjs';
import { pendingV2AsrArgs } from './devapp-aidt-v2-asr-review.mjs';
import { parseV2Record } from './devapp-aidt-v2-ui.mjs';
const fail=code=>{throw new ProbeFailure(code);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const id=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,256}$/.test(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const json=value=>{try{return JSON.parse(value);}catch{return null;}};
const rows=value=>Array.isArray(value?.messages)?value.messages:Array.isArray(value?.items)?value.items:Array.isArray(value)?value:null;
const blocked=code=>({status:'BLOCKED',code,syntheticFilePipeline:true,realC1Interview:'NOT_RUN',realHumanValidation:false});

/** Same ordinary UI upload control; there is deliberately no API PUT/hidden-state fallback. */
export async function attachV2SyntheticAudio({ui,testTarget,audioFixture,registerFixture,capture}) {
  const {page,expect,btn,click,stage,save}=ui;
  if(audioFixture&&typeof audioFixture.filename==='string')audioFixture={...audioFixture,filename:audioFixture.filename.replace(/\.(wav|mp3)$/i,'-s6.$1')};
  await ui.navigate(testTarget,{role:'test-offline',phase:'audio-entry'});await ui.expand('关联测试材料');
  const sources=page.getByTestId('aidt-test-group-sources');await expect(sources).toBeVisible();
  let record=parseV2Record(await stage(6),'testGroup:',testTarget.entityId);
  if(record.researchPath!=='offline'||record.designId!==testTarget.designId||record.versionId!==testTarget.versionId)fail('V2_ASR_OFFLINE_SOURCE_SCOPE_MISMATCH');
  if(record.audioConsentAt&&record.material?.mime?.startsWith('audio/'))return {status:'ready',audio:record.material,reusedSavedOriginal:true};
  if(!audioFixture||audioFixture.synthetic!==true||!Buffer.isBuffer(audioFixture.bytes)||audioFixture.bytes.length<44||audioFixture.bytes.length>262144
    ||!['audio/wav','audio/x-wav','audio/mpeg'].includes(audioFixture.mime)||!/^qa-[A-Za-z0-9_.-]{1,160}\.(?:wav|mp3)$/.test(audioFixture.filename??''))return blocked('V2_ASR_AUTHORIZED_SYNTHETIC_AUDIO_FIXTURE_REQUIRED');
  const consent=sources.getByRole('checkbox',{name:'已获得本次访谈录音和保存授权',exact:true});
  if(!await consent.count())return blocked('V2_ASR_NORMAL_AUDIO_CONSENT_ENTRY_UNAVAILABLE');
  await save(6,()=>consent.check(),{operationId:'s6-test-offline-audio-consent',entityRole:'test-offline',entityId:testTarget.entityId});
  // The product uses a generic div aria-label; getByLabel remains the ordinary accessible input.
  const input=sources.getByLabel('本组原始材料选择文件',{exact:true});await expect(input).toBeVisible();
  const accept=await input.getAttribute('accept');if(!accept||!/(?:audio\/|\.wav|\.mp3)/i.test(accept))return blocked('V2_ASR_NORMAL_AUDIO_FILE_TYPE_UNAVAILABLE');
  if(typeof registerFixture!=='function')fail('V2_ASR_REGISTERED_AUDIO_FIXTURE_REQUIRED');
  registerFixture({filename:audioFixture.filename,bytes:audioFixture.bytes,mime:audioFixture.mime});
  await input.setInputFiles({name:audioFixture.filename,mimeType:audioFixture.mime,buffer:audioFixture.bytes});
  const host=sources.getByTestId('aidt-research-material-control').filter({has:input});
  const saved=await save(6,()=>click(btn('保存原始材料',host)),{uiAction:{actionId:'s6-test-offline-original-audio-and-bind',steps:[{operationId:'s6-test-offline-audio-upload',kind:'write',requestKind:'upload',stageId:6,entityRole:'test-offline',entityId:testTarget.entityId,method:'POST',path:`/api/projects/${ui.scope.projectId}/artifacts/upload`},{operationId:'s6-test-offline-audio-bind',kind:'write',requestKind:'stage-save',stageId:6,entityRole:'test-offline',entityId:testTarget.entityId,method:'PUT',path:`/api/projects/${ui.scope.projectId}/aidt/stages/6`}]}});
  record=parseV2Record(saved.stage,'testGroup:',testTarget.entityId);
  if(!record.audioConsentAt||record.material?.projectId!==ui.scope.projectId||record.material.sha256!==hash(audioFixture.bytes)
    ||record.material.bytes!==audioFixture.bytes.length||record.material.name!==audioFixture.filename||!id(record.material.versionId))fail('V2_ASR_AUDIO_ORIGINAL_SAVE_READBACK_MISMATCH');
  await ui.refresh(6,{expectedRevision:saved.receipt.revision,navigation:{role:'test-offline',phase:'audio-saved-refresh'}});await ui.expand('关联测试材料');
  await expect(page.getByRole('region',{name:'合成音频校对与保存',exact:true})).toBeVisible();
  await capture('v2-s6-synthetic-audio-original-persisted',6);
  return {status:'ready',audio:record.material,revision:saved.receipt.revision,syntheticFilePipeline:true,realC1Interview:'NOT_RUN'};
}

/** Read-only binary evidence through the current authenticated browser; bounded and allowlisted. */
export async function actualV2AsrBytes(page,path,maxBytes){
  if(typeof path!=='string'||!/^\/api\/(?:chat\/threads\/[^/]+\/attachments\/[^/]+\/content|artifacts\/[^/]+\/versions\/[1-9]\d*\/content|ingestion-runs\/[^/]+\/content\?projectId=[^&]+)$/.test(path)||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>262144)fail('V2_ASR_BINARY_READ_SCOPE_REJECTED');
  const result=await page.evaluate(async({path,maxBytes})=>{const token=localStorage.getItem('wsx.sessionToken');if(!token)return {status:0};const response=await fetch(path,{method:'GET',headers:{Authorization:`Bearer ${token}`},credentials:'include',cache:'no-store',redirect:'error'});if(!response.ok||!response.body)return {status:response.status};const reader=response.body.getReader(),chunks=[];let n=0;for(;;){const{value,done}=await reader.read();if(done)break;n+=value.length;if(n>maxBytes){await reader.cancel();return {status:413};}chunks.push(...value);}return {status:response.status,bytes:chunks};},{path,maxBytes});
  if(result.status!==200||!Array.isArray(result.bytes))fail('V2_ASR_REAL_FILE_READ_FAILED');return Buffer.from(result.bytes);
}
export function assertV2PublishedAsrProof({pin,audioSource,entityId,run,human,artifactBytes,nativeAudioBytes,originalBytes}) {
  if(!pin||pin.kind!=='synthetic-file-asr')fail('V2_ASR_SYNTHETIC_BOUNDARY_INVALID');
  const audio=audioSource,transcript=pin.transcript,native=pin.nativeAudio;
  if(!audio||!transcript||!native||pin.audio?.artifactId!==audio.artifactId||pin.audio?.versionId!==audio.versionId||pin.audio?.sha256!==audio.sha256||pin.audio?.runId!==audio.runId||native.sha256!==audio.sha256
    ||hash(nativeAudioBytes)!==audio.sha256||hash(originalBytes)!==audio.sha256||nativeAudioBytes.length!==audio.bytes||originalBytes.length!==audio.bytes)fail('V2_ASR_AUDIO_BYTES_ORIGIN_MISMATCH');
  if(run?.runId!==transcript.producedByRunId||run?.threadId!==native.threadId||run?.inputMessageId!==native.messageId||run?.status!=='succeeded'||!id(run.resultMessageId)
    ||human?.id!==native.messageId||human.authorKind!=='human'||human.attachments?.length!==1||human.attachments[0]?.id!==native.attachmentId)fail('V2_ASR_REAL_RUN_OR_ATTACHMENT_MISMATCH');
  const requestId=/^合成音频转写请求：([a-f0-9-]{36})$/m.exec(human.text??'')?.[1];
  if(!requestId||!human.text.split('\n').includes(`当前测试实体：${entityId}`)||!human.text.includes(`SHA256=${audio.sha256}`)||transcript.name!==`aidt-asr-${requestId}.json`)fail('V2_ASR_REQUEST_NOT_EXACT_CURRENT_ENTITY');
  const calls=(run.steps??[]).filter(step=>step.kind==='tool_call'&&step.status==='succeeded'&&step.toolName==='wx_audio_transcribe'&&json(step.toolArgsSummary)?.attachmentId===native.attachmentId);
  if(calls.length!==1)fail('V2_ASR_ACTUAL_TOOL_CALL_REQUIRED');
  const call=calls[0],prefix='audio-transcription-receipt:v1 ';
  if(typeof call.toolResultSummary!=='string'||!call.toolResultSummary.startsWith(prefix)||call.toolResultSummary.length>500||hash(Buffer.from(call.toolResultSummary))!==call.outputDigest)fail('V2_ASR_TOOL_RECEIPT_DIGEST_MISMATCH');
  const proof=json(call.toolResultSummary.slice(prefix.length));
  if(proof?.status!=='succeeded'||proof.sourceHash!==audio.sha256||proof.sha256!==transcript.sha256||!/^\/workspace\/transcribed-[a-f0-9]{64}\.json$/.test(proof.workspacePath??'')||hash(artifactBytes)!==transcript.sha256)fail('V2_ASR_PUBLISHED_BYTES_NOT_TOOL_RESULT');
  const publications=(run.steps??[]).filter(step=>step.kind==='tool_call'&&step.status==='succeeded'&&step.toolName==='wx_artifact_publish');
  const published=publications.length===1&&publications.every(step=>{const args=pendingV2AsrArgs({toolName:'wx_artifact_publish',argsSummary:step.toolArgsSummary});return args.workspacePath===proof.workspacePath&&args.title===transcript.name;});
  if(!published)fail('V2_ASR_NATIVE_PUBLISH_REQUIRED');
  const payload=json(artifactBytes.toString('utf8'));
  const warnings=new Set(['source_chunk_boundaries_not_word_timestamps','speaker_identity_unavailable','confidence_not_calibrated','no_recognized_speech','some_chunks_without_recognized_speech']);
  if(payload?.sourceHash!==audio.sha256||Object.keys(payload??{}).sort().join(',')!=='segments,sourceHash,warnings'||!Array.isArray(payload.segments)||payload.segments.length<1||payload.segments.length>120||!payload.segments.some(s=>typeof s.text==='string'&&s.text.trim())||payload.segments.some(s=>!id(s.id)||!Number.isInteger(s.startMs)||!Number.isInteger(s.endMs)||s.startMs<0||s.endMs<=s.startMs||s.endMs>3600000||typeof s.text!=='string'||s.text.length>262144)||!Array.isArray(payload.warnings)||payload.warnings.some(w=>!warnings.has(w)))fail('V2_ASR_REAL_RECOGNIZED_SEGMENTS_REQUIRED');
  return {runId:run.runId,inputMessageId:human.id,assistantMessageId:run.resultMessageId,tool:'wx_audio_transcribe',publishTool:'wx_artifact_publish',originalSha256:audio.sha256,nativeAttachmentId:native.attachmentId,publishedArtifactId:transcript.artifactId,publishedVersion:transcript.version,publishedSha256:transcript.sha256,realC1Interview:'NOT_RUN',syntheticFilePipeline:true,realHumanValidation:false};
}

/** Expected full report text comes only from the independently read published bytes and saved pin. */
export function buildV2AsrFormalPrintEvidence({stageId,entityId,sourceRevision,pin,audioSource,artifactBytes}){
  if(![2,6].includes(stageId)||!id(entityId)||!Number.isSafeInteger(sourceRevision)||sourceRevision<1||!Buffer.isBuffer(artifactBytes)||!pin?.transcript||!pin.nativeAudio||!pin.audio||!audioSource||hash(artifactBytes)!==pin.transcript.sha256||pin.audio.artifactId!==audioSource.artifactId||pin.audio.versionId!==audioSource.versionId||pin.audio.runId!==audioSource.runId||pin.audio.sha256!==audioSource.sha256)fail('V2_ASR_FORMAL_PRINT_SAVED_SOURCE_MISMATCH');
  const payload=json(artifactBytes.toString('utf8'));if(payload?.sourceHash!==audioSource.sha256||!Array.isArray(payload.segments)||!payload.segments.length||payload.segments.some(segment=>typeof segment.text!=='string')||!payload.segments.some(segment=>segment.text.trim())||typeof pin.reviewedText!=='string'||!pin.reviewedText.trim())fail('V2_ASR_FORMAL_PRINT_FULL_TRANSCRIPT_REQUIRED');
  const requiredTexts=['合成 ASR 全文报告',`第 ${stageId} 步`, `小组保存版本 V${sourceRevision}`,'实际发布的原始转写全文','不是任何真人访谈',...payload.segments.map(segment=>segment.text).filter(text=>text.trim()),pin.reviewedText,audioSource.name,audioSource.artifactId,`版本 ${audioSource.versionId}`,audioSource.sha256,pin.nativeAudio.threadId,pin.nativeAudio.attachmentId,pin.nativeAudio.messageId,pin.transcript.name,pin.transcript.artifactId,`V${pin.transcript.version}`,pin.transcript.attachmentId,pin.transcript.sha256,pin.transcript.producedByRunId,pin.transcript.producedByStepId,'wx_audio_transcribe','wx_artifact_publish'];
  if(requiredTexts.some(text=>typeof text!=='string'||!text.trim()))fail('V2_ASR_FORMAL_PRINT_EXACT_PROVENANCE_REQUIRED');
  return {stage:stageId,name:stageId===2?'source-1-asr-report':'offline-asr-report',entityRole:stageId===2?'source-interview':'test-offline',entityId,sourceRevision,requiredTexts:[...new Set(requiredTexts)],actualTranscriptSha256:hash(artifactBytes),sourceSha256:audioSource.sha256,allActualSegmentsRequired:payload.segments.filter(segment=>segment.text.trim()).length};
}
export async function printV2AsrFormalReport({ui,printFormal,...evidence}){
  if(typeof printFormal!=='function')return blocked('V2_ASR_FORMAL_PRINT_PORT_REQUIRED');
  const expected=buildV2AsrFormalPrintEvidence(evidence),container=ui.page.locator('[data-aidt-asr-print-entity='+JSON.stringify(evidence.entityId)+']');await ui.expect(container).toHaveCount(1);await ui.expect(container).toBeVisible();const button=container.getByRole('button',{name:'预览合成 ASR 全文报告',exact:true});await ui.expect(button).toBeVisible();
  return printFormal({...expected,button});
}

export function assertV2AsrToolProof({pin,group,...evidence}) {
  if(group.evidenceOrigin!=='synthetic-file-asr'||group.researchPath!=='offline'||!group.audioConsentAt||group.said||group.did)fail('V2_ASR_SYNTHETIC_BOUNDARY_INVALID');
  return assertV2PublishedAsrProof({pin,audioSource:group.material,entityId:group.id,...evidence});
}

export async function collectV2ReviewedAsrDraft({ui,stageId,entityId,threadId,audioSource,initial,entityRole,uploadOperationId,asrOperationId,runNativeOperation,read,approveKnownTool,reviewTranscript,actorId,completeAsrOperation}) {
  const {page,expect,btn,click}=ui;actorId??=ui.scope.actorId;
  if(![2,6].includes(stageId)||!id(entityId)||!id(threadId)||!audioSource||audioSource.projectId!==ui.scope.projectId||!audioSource.mime?.startsWith('audio/'))fail('V2_ASR_OWNED_SOURCE_REQUIRED');
  if(!id(actorId))return blocked('V2_ASR_ORDINARY_ACTOR_BINDING_REQUIRED');
  if(typeof runNativeOperation!=='function'||typeof read!=='function'||typeof reviewTranscript!=='function'||typeof approveKnownTool!=='function')return blocked('V2_ASR_REAL_OBSERVER_AND_TRANSCRIPT_REVIEWER_REQUIRED');
  if(reviewTranscript.preflightReady===false||approveKnownTool?.preflightReady===false)return blocked('V2_ASR_DYNAMIC_REVIEW_CHANNEL_PENDING');
  await ui.expand('合成音频文件转写（软件验收）');const panel=page.getByRole('region',{name:'合成音频文件转写',exact:true});await expect(panel).toContainText('仅用于合成测试音频');
  const consent=panel.getByRole('checkbox',{name:/这是获准用于本次 QA 的合成音频/});await consent.check();
  await runNativeOperation({operationId:uploadOperationId,kind:'write',stage:stageId,entityRole,expectedFields:{audioFixture:{filename:audioSource.name,sizeBytes:audioSource.bytes,sha256:audioSource.sha256,mime:audioSource.mime}},perform:()=>click(btn('将同一音频附到 Chat 并准备转写',panel))});
  const composer=page.getByTestId('copilotkit-v2-input');await expect(composer).toBeVisible();
  const prompt=await composer.inputValue();if(!prompt.includes(`当前测试实体：${entityId}`)||!prompt.includes(`SHA256=${audioSource.sha256}`)||!/^合成音频转写请求：[a-f0-9-]{36}$/m.test(prompt))fail('V2_ASR_NORMAL_QUEUE_REQUEST_MISSING');
  await ui.unchanged(stageId,initial);const before=await read(`/api/chat/threads/${encodeURIComponent(threadId)}/messages?limit=100`);if(before.status!==200||!rows(before.data))fail('V2_ASR_CANONICAL_MESSAGES_REQUIRED');const known=new Set(rows(before.data).map(row=>row.id));
  const send=page.getByTestId('copilotkit-v2-send');await expect(send).toHaveAttribute('aria-label',/^(发送|Send)$/);
  await runNativeOperation({operationId:asrOperationId,kind:'asr',stage:stageId,entityRole,perform:()=>click(send)});
  const outputName='aidt-asr-'+/^合成音频转写请求：([a-f0-9-]{36})$/m.exec(prompt)[1]+'.json';
  let actualRun,human,terminal,audioVerified=false;const reviewed=new Set();
  await expect.poll(async()=>{
    try{
      const messages=await read(`/api/chat/threads/${encodeURIComponent(threadId)}/messages?limit=100`);if(messages.status!==200||!rows(messages.data))fail('V2_ASR_CANONICAL_MESSAGES_REQUIRED');
      const matches=rows(messages.data).filter(row=>!known.has(row.id)&&row.authorKind==='human'&&row.text===prompt);
      if(matches.length>1)fail('V2_ASR_DUPLICATE_REAL_SEND');if(!matches.length)return false;human=matches[0];
      if(human.authorId!==actorId||!id(human.agentRunId)||human.attachments?.length!==1||human.attachments[0]?.filename!==audioSource.name||human.attachments[0]?.bytes!==audioSource.bytes)fail('V2_ASR_REAL_HUMAN_BINDING_MISMATCH');
      if(!audioVerified){const bytes=await actualV2AsrBytes(page,`/api/chat/threads/${encodeURIComponent(threadId)}/attachments/${encodeURIComponent(human.attachments[0].id)}/content`,audioSource.bytes);if(hash(bytes)!==audioSource.sha256)fail('V2_ASR_PENDING_AUDIO_HASH_MISMATCH');audioVerified=true;}
      const response=await read(`/api/agent-runs/${encodeURIComponent(human.agentRunId)}`);if(response.status!==200)fail('V2_ASR_REAL_RUN_UNAVAILABLE');actualRun=response.data;
      if(actualRun.threadId!==threadId||actualRun.inputMessageId!==human.id)fail('V2_ASR_RUN_CHANGED');
      if(actualRun.status==='awaiting_tool_permission'){
        const pending=actualRun.pendingApproval,tool=pending?.toolName,permission=pending?.permissionRequestId;
        const args=pendingV2AsrArgs(pending);
        if(!['wx_audio_transcribe','wx_artifact_publish'].includes(tool)||!id(permission)||typeof approveKnownTool!=='function')fail('V2_ASR_UNKNOWN_OR_UNAPPROVED_TOOL_STOP');
        if(reviewed.has(permission))return false;
        if(tool==='wx_audio_transcribe'&&args?.attachmentId!==human.attachments?.[0]?.id)fail('V2_ASR_PENDING_ATTACHMENT_CHANGED');
        if(tool==='wx_artifact_publish'){
          const successful=(actualRun.steps??[]).filter(step=>step.kind==='tool_call'&&step.status==='succeeded'&&step.toolName==='wx_audio_transcribe'&&json(step.toolArgsSummary)?.attachmentId===human.attachments[0].id);
          const proof=successful.length===1&&typeof successful[0].toolResultSummary==='string'&&successful[0].toolResultSummary.startsWith('audio-transcription-receipt:v1 ')?json(successful[0].toolResultSummary.slice('audio-transcription-receipt:v1 '.length)):null;
          if(!proof||hash(Buffer.from(successful[0].toolResultSummary))!==successful[0].outputDigest||proof.status!=='succeeded'||proof.sourceHash!==audioSource.sha256||args?.mediaType!=='application/json'||args?.title!==outputName||args?.workspacePath!==proof.workspacePath||!/^\/workspace\/transcribed-[a-f0-9]{64}\.json$/.test(args?.workspacePath??''))fail('V2_ASR_PENDING_PUBLISH_NOT_TRANSCRIPT');
        }
        const review=await approveKnownTool({page,stageId,sourceRevision:initial.revision,audioSource,projectId:ui.scope.projectId,entityId,threadId:threadId,runId:actualRun.runId,inputMessageId:human.id,permissionRequestId:permission,toolName:tool,actualPending:pending});
        if(review?.status==='PENDING')fail('V2_ASR_DYNAMIC_REVIEW_PENDING');
        if(review?.decision!=='approved'||review?.permissionRequestId!==permission||review?.runId!==actualRun.runId||review?.viaNormalUI!==true)fail('V2_ASR_SCOPE_BOUND_UI_REVIEW_REQUIRED');reviewed.add(permission);return false;
      }
      if(['failed','cancelled','paused'].includes(actualRun.status))fail('V2_ASR_REAL_RUN_FAILED_NO_REPLAY');
      if(actualRun.status!=='succeeded')return false;
      if(!rows(messages.data).some(row=>row.id===actualRun.resultMessageId&&row.authorKind==='agent'&&row.agentRunId===actualRun.runId&&typeof row.text==='string'&&row.text.trim()))fail('V2_ASR_PERSISTED_ASSISTANT_REPLY_REQUIRED');return true;
    }catch(error){if(error instanceof ProbeFailure){terminal=error;return true;}throw error;}
  },{timeout:300000,intervals:[500,1000,2000]}).toBe(true);if(terminal){if(terminal.code==='V2_ASR_DYNAMIC_REVIEW_PENDING')return blocked('V2_ASR_DYNAMIC_REVIEW_PENDING');throw terminal;}
  if(typeof completeAsrOperation!=='function')fail('V2_ASR_FINAL_OPERATION_PROOF_PORT_REQUIRED');await completeAsrOperation({operationId:asrOperationId,runId:actualRun.runId});
  await click(btn('读取本次已发布转写',panel));const results=panel.getByRole('group',{name:'选择实际转写产物',exact:true});await expect(results.getByRole('radio').first()).toBeVisible();await expect(results.locator('input:checked')).toHaveCount(0);await results.getByRole('radio').first().check();
  await ui.expand('查看实际完整转写与来源',panel);const recognized=await panel.locator('pre').innerText();if(!recognized.trim())return blocked('V2_ASR_REAL_NO_RECOGNIZED_SPEECH');
  const reviewedText=await reviewTranscript({stageId,sourceRevision:initial.revision,projectId:ui.scope.projectId,entityId,threadId:threadId,runId:actualRun.runId,inputMessageId:human.id,assistantMessageId:actualRun.resultMessageId,audioSource:audioSource,recognizedText:recognized});
  if(reviewedText?.status==='PENDING')return blocked('V2_ASR_DYNAMIC_TRANSCRIPT_REVIEW_PENDING');
  if(reviewedText?.reviewMethod!=='synthetic-speech-groundtruth'||reviewedText?.reviewerKind!=='agent'||reviewedText?.manualListeningVerified!==false||reviewedText?.sourceSha256!==audioSource.sha256||typeof reviewedText?.text!=='string'||!reviewedText.text.trim()||reviewedText.text.length>1700)fail('V2_ASR_REAL_AUDIO_REVIEW_REQUIRED');
  await panel.getByLabel('校对后的摘录',{exact:true}).fill(reviewedText.text);await panel.getByRole('checkbox',{name:/已核对合成音频内容与这段转写摘录/}).check();await click(btn('采用校对摘录到本地草稿',panel));
  await ui.unchanged(stageId,initial);
  return {status:'reviewed-local',actualRun,human,reviewedText,toolReviews:[...reviewed],initial};
}

export async function runV2SyntheticAsr({ui,testTarget,runNativeOperation,read,approveKnownTool,reviewTranscript,capture,actorId,printFormal,completeAsrOperation}){
  const {page,expect,btn,click,stage,save}=ui;actorId??=ui.scope.actorId;
  await ui.navigate(testTarget,{role:'test-offline',phase:'asr-entry'});await ui.expand('关联测试材料');
  const initial=await stage(6),group=parseV2Record(initial,'testGroup:',testTarget.entityId);
  if(group.researchPath!=='offline'||!group.audioConsentAt||!group.material?.mime?.startsWith('audio/'))return blocked('V2_ASR_SAVED_AUTHORIZED_AUDIO_REQUIRED');
  const collected=await collectV2ReviewedAsrDraft({ui,stageId:6,entityId:group.id,threadId:testTarget.threadId,audioSource:group.material,initial,entityRole:'test-offline',uploadOperationId:'s6-test-offline-chat-audio-upload',asrOperationId:'s6-test-offline-file-asr',runNativeOperation,read,approveKnownTool,reviewTranscript,actorId,completeAsrOperation});
  if(collected.status!=='reviewed-local')return collected;
  const {actualRun,human,reviewedText,toolReviews}=collected;
  const local=page.getByRole('region',{name:'待保存的合成转写摘录',exact:true});await expect(local).toBeVisible();await ui.unchanged(6,initial);await local.getByLabel('校对摘录',{exact:true}).fill(reviewedText.text);await local.getByRole('checkbox',{name:/我已核对合成音频内容与本摘录/}).check();
  const saved=await save(6,()=>click(btn('保存合成转写摘录',local)),{operationId:'s6-test-offline-asr-transcript-save',entityRole:'test-offline',entityId:group.id}),savedGroup=parseV2Record(saved.stage,'testGroup:',group.id);const pin=json(saved.stage.content.draft.fields['testSyntheticAsr:'+group.id]??'null');
  if(!pin||pin.reviewedText!==reviewedText.text||pin.transcript?.producedByRunId!==actualRun.runId)fail('V2_ASR_PUBLISHED_EXCERPT_NOT_SAVED');
  const originalBytes=await actualV2AsrBytes(page,`/api/ingestion-runs/${encodeURIComponent(savedGroup.material.runId)}/content?projectId=${encodeURIComponent(ui.scope.projectId)}`,savedGroup.material.bytes);
  const nativeAudioBytes=await actualV2AsrBytes(page,`/api/chat/threads/${encodeURIComponent(pin.nativeAudio.threadId)}/attachments/${encodeURIComponent(pin.nativeAudio.attachmentId)}/content`,savedGroup.material.bytes);
  const artifactBytes=await actualV2AsrBytes(page,`/api/artifacts/${encodeURIComponent(pin.transcript.artifactId)}/versions/${pin.transcript.version}/content`,262144);
  const proof=assertV2AsrToolProof({pin,group:savedGroup,run:actualRun,human,artifactBytes,nativeAudioBytes,originalBytes});
  await ui.refresh(6,{expectedRevision:saved.receipt.revision,navigation:{role:'test-offline',phase:'asr-saved-refresh'}});await ui.expand('关联测试材料');await expect(page.getByRole('region',{name:'合成转写校对摘录与来源',exact:true})).toContainText('当前原件、实际工具回执与转写文件已核对。');await capture('v2-s6-synthetic-asr-published-reviewed-saved',6);
  const printStage=await stage(6);if(printStage.revision!==saved.receipt.revision||printStage.content.draft.fields['testSyntheticAsr:'+group.id]!==saved.stage.content.draft.fields['testSyntheticAsr:'+group.id])fail('V2_ASR_FORMAL_PRINT_SAVED_SOURCE_CHANGED');
  const printReceipt=await printV2AsrFormalReport({ui,printFormal,stageId:6,entityId:group.id,sourceRevision:printStage.revision,pin,audioSource:savedGroup.material,artifactBytes});
  return {status:'passed',...proof,printReceipt,revision:saved.receipt.revision,reviewedTextSha256:hash(Buffer.from(reviewedText.text)),reviewMethod:reviewedText.reviewMethod,reviewerKind:reviewedText.reviewerKind,manualListeningVerified:false,toolReviews,realC1Interview:'NOT_RUN'};
}
