/** Two source records are a bounded scenario choice, never a V2 minimum respondent count. */
import { createHash } from 'node:crypto';
import { agentInterviewRevisionInput, assertAgentInterviewGuideRevision } from './devapp-aidt-agent-interview-review.mjs';
import { ProbeFailure } from './devapp-aidt-auth-readonly.mjs';
import { schematicPng, assertAidtS2Topic } from './devapp-aidt-journey.mjs';
import { V2_SYNTHETIC, savedV2Entities, parseV2Record } from './devapp-aidt-v2-ui.mjs';
const fail=code=>{throw new ProbeFailure(code);};
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function runV2S2({ui,s1,teachingFeedback,observeNativeAction,capture,printFormal,registerFixture,runSyntheticAsr,case01Review}) {
  if(case01Review && (case01Review.caseId!=='AIDT-E2E-01'||typeof case01Review.review!=='function'||!Array.isArray(case01Review.report?.teachingEvidence)))fail('CASE01_S2_REVIEW_REQUIRED');
  if(!s1?.confirmed?.revision||!s1.next)fail('V2_S2_FORMAL_S1_HANDOFF_REQUIRED');
  const {page,expect,btn,click,fill,stage,save,refresh}=ui;
  const directory=new URL(s1.next,ui.origin);directory.searchParams.delete('entity');directory.searchParams.delete('tool');
  if(directory.origin!==ui.origin||directory.pathname!==ui.projectPath||directory.searchParams.get('step')!=='2')fail('V2_S2_HANDOFF_ROUTE_INVALID');
  const records=[];
  for(const [index,kind]of ['interview','observation'].entries()) {
    const role='source-'+kind,base=`/api/projects/${ui.scope.projectId}/aidt/stages/2`;
    await page.goto(directory.href,{waitUntil:'domcontentloaded'});
    const prior=new Set(savedV2Entities(await stage(2),'interviewRecord:').map(row=>row.id));
    await click(page.getByTestId('aidt-new-entity-card'));
    const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
    // Both business kinds must be exposed by the actual new S2 UI; do not rename an interview into an observation.
    await dialog.getByRole('radio',{name:kind==='interview'?'访谈':'观察',exact:true}).check();
    const displayName=`QA ${kind==='interview'?'合成受访者':'合成观察情境'} ${ui.scope.runId}`;
    await fill(kind==='interview'?'受访者姓名或化名':'观察对象或情境名称',displayName,dialog);
    const created=await save(2,()=>click(btn(kind==='interview'?'创建访谈':'创建观察',dialog)),{uiAction:{actionId:'s2-'+role+'-normal-create',steps:[
      {operationId:'s2-'+role+'-create',kind:'write',requestKind:'stage-save',stageId:2,entityRole:role,method:'PUT',path:base,captureEntity:{prefix:'interviewRecord:',nameField:'displayName',expectedName:displayName,priorIds:[...prior]}},
      {operationId:'s2-'+role+'-entity-thread-initial',kind:'write',requestKind:'entity-thread',stageId:2,entityRole:role,entityId:'{createdEntity}',method:'PUT',path:base+'/entities/{createdEntity}/thread',captureThread:true},
      {operationId:'s2-'+role+'-thread-mount',kind:'write',requestKind:'thread-mount',stageId:2,entityRole:role,entityId:'{createdEntity}',method:'POST',path:'/api/threads/{createdThread}/skill-mounts'},
    ]}});
    const added=savedV2Entities(created.stage,'interviewRecord:').filter(row=>!prior.has(row.id));
    if(added.length!==1||added[0].displayName!==displayName)fail('V2_S2_SOURCE_CREATE_NOT_READ_BACK');
    const record=added[0];assertAidtS2Topic(record,s1.confirmed);
    const mutate=(suffix,action)=>save(2,action,{operationId:`s2-${role}-${suffix}`,entityRole:role,entityId:record.id});
    const upload=(uploadSuffix,bindSuffix,action)=>save(2,action,{uiAction:{actionId:`s2-${role}-${uploadSuffix}-and-bind`,steps:[{operationId:`s2-${role}-${uploadSuffix}`,kind:'write',requestKind:'upload',stageId:2,entityRole:role,entityId:record.id,method:'POST',path:`/api/projects/${ui.scope.projectId}/artifacts/upload`},{operationId:`s2-${role}-${bindSuffix}`,kind:'write',requestKind:'stage-save',stageId:2,entityRole:role,entityId:record.id,method:'PUT',path:base}]}});
    if(kind==='observation'&&record.kind!=='observation')fail('V2_S2_OBSERVATION_BUSINESS_KIND_REQUIRED');
    await page.waitForURL(url=>url.searchParams.get('entity')===record.id&&url.searchParams.get('thread')?.startsWith('thr'));
    const target=ui.route(2);await refresh(2,{expectedRevision:created.receipt.revision,navigation:{role,phase:'created-refresh'}});
    const feedback=async(prompt,suffix,finding=false)=>{let accepted;await ui.performAction({actionId:'s2-'+role+'-'+suffix+'-native-feedback',timeoutMs:240000,steps:[{operationId:'s2-'+role+'-'+suffix,kind:'write',requestKind:'reconcile-entity',stageId:2,entityRole:role,entityId:record.id,method:'POST',path:base+'/entities/'+encodeURIComponent(record.id)+'/reconcile'}],perform:async()=>{accepted=await teachingFeedback(2,prompt,record.code,finding);}});return accepted;};
    const first=`${V2_SYNTHETIC}。${record.code} ${kind==='observation'?'观察计划':'学生访谈提纲'}初稿：想了解午休中怎样判断是否等待饮品。先问/看最近一次选择发生在哪里，最先注意什么，后来怎样决定；所有研究材料是合成练习，不是真人记录。请指出一个可具体化处并等待学生修订，不替我确认。`;
    if(!await feedback(first,'guide-projection-1'))fail('V2_S2_REAL_GUIDE_FEEDBACK_REQUIRED');
    const actions=page.getByTestId('aidt-interview-chat-actions');
    const last=await stage(2);const sourceRecord=parseV2Record(last,'interviewRecord:',record.id);
    if(!sourceRecord.original?.trim())fail('V2_S2_STUDENT_INITIAL_NOT_SAVED');
    let revised=`${V2_SYNTHETIC}。学生将提纲修订为：请回忆最近一次午休选择饮品的具体经过；你先注意到什么，何时决定继续等待或离开？观察则只记录可见行动和情境，不添加受访者心理或原话。请保留我的原稿并提供可审阅的问题/观察关注点。`;
    if(case01Review&&kind==='interview')revised=await agentInterviewRevisionInput({code:record.code,target,initial:first,confirmedProblem:s1.confirmed,projectId:ui.scope.projectId,proofs:case01Review.report.teachingEvidence,review:case01Review.review,required:true,synthetic:text=>`${V2_SYNTHETIC}。${text}`});
    if(!await feedback(revised,'guide-projection-2'))fail('V2_S2_REAL_GUIDE_REVISION_REQUIRED');
    if(case01Review&&kind==='interview')assertAgentInterviewGuideRevision({record:parseV2Record(await stage(2),'interviewRecord:',record.id),proofs:case01Review.report.teachingEvidence,projectId:ui.scope.projectId,code:record.code,target,prompt:revised,required:true});
    const rows=actions.getByTestId('aidt-interview-chat-question');await expect(rows.first()).toBeVisible();
    for(const row of await rows.all())await row.getByRole('checkbox').uncheck();
    const row=rows.first();await row.getByRole('checkbox').check();await click(btn('编辑这道问题',row));
    await fill('修改问题',kind==='interview'?'请描述最近一次午休选择饮品的经过，最先注意什么，如何决定？':'观察并记录午休饮品选择时先看队列还是菜单，以及继续等候或离开的可见行动。',row);
    const guide=await save(2,()=>click(btn('确认这份问题清单',actions)),{operationId:'s2-'+role+'-guide-confirm',entityRole:role,entityId:record.id});
    const adopted=parseV2Record(guide.stage,'interviewRecord:',record.id);if(!adopted.guideConfirmed||!adopted.adopted.trim())fail('V2_S2_GUIDE_NOT_CONFIRMED');
    await ui.outcome(target,{role,phase:'guide-outcome'});
    await printFormal({stage:2,name:`source-${index+1}-guide`,entityId:record.id,button:page.getByTestId('aidt-interview-guide-print'),requiredTexts:[record.code,adopted.adopted],sourceRevision:guide.receipt.revision});
    // The project's sources tool is not the interview's consent surface.
    // Open the existing native Chat materials tab; compact=false has no summary.
    await ui.navigate(target,{role,phase:'materials',tool:'chat'});
    await expect(page.getByTestId('copilotkit-v2-input')).toBeVisible();
    const materialsTab=page.getByTestId('chat-task-workbench-inspector-tab-materials');
    await click(materialsTab);await expect(materialsTab).toHaveAttribute('aria-selected','true');
    const authorization=page.getByRole('region',{name:kind==='interview'?'授权和访谈材料':'授权和观察材料',exact:true});
    await expect(authorization).toBeVisible();
    await expect(authorization.getByRole('heading',{name:'授权和材料',exact:true})).toBeVisible();
    await authorization.getByLabel('已获授权共享文字记录',{exact:true}).check();
    await mutate('notes-consent',()=>click(btn('更新授权记录',authorization)));
    let quote=kind==='interview'?`${V2_SYNTHETIC}：我先看队列，再决定是否等待。`:`${V2_SYNTHETIC}：观察到先看队列再离开窗口的动作；原因未知，不推断心理。`;
    const bytes=Buffer.from(`${V2_SYNTHETIC}\n第1段 ${quote}\n第2段 本轮材料只用于软件验收，非真人研究事实。\n`);
    const filename=`qa-${ui.scope.runId}-source-${index+1}.txt`;
    registerFixture({filename,bytes,mime:'text/plain'});
    const control=authorization.getByTestId('aidt-research-material-control').filter({has:page.getByLabel(`${record.code}研究原件选择文件`,{exact:true})});
    await control.getByLabel(`${record.code}研究原件选择文件`,{exact:true}).setInputFiles({name:filename,mimeType:'text/plain',buffer:bytes});
    await upload('upload-original','bind-original',()=>click(btn('保存原始材料',control)));await expect(control).toContainText('原件已保存并回读');
    if(kind==='interview')await click(page.getByTestId('chat-task-workbench-inspector-tab-recording'));
    await mutate('transcript-select',()=>page.getByLabel(kind==='interview'?'转写原件':'观察记录原件',{exact:true}).selectOption({index:1}));
    await mutate('transcript-locator',()=>fill('定位（如 01:42 或第 3 段）','第1段'));
    await mutate('transcript-edit',()=>fill(kind==='interview'?'校对后的摘录':'校对后的观察记录摘录',quote));await mutate('transcript-check',()=>page.getByLabel('已对照原始材料校对',{exact:true}).check());
    let syntheticAsr=null;if(index===0&&typeof runSyntheticAsr==='function'){syntheticAsr=await runSyntheticAsr({ui,record:{target}});if(syntheticAsr.status==='passed'){if(typeof syntheticAsr.reviewedText!=='string'||!syntheticAsr.reviewedText.trim())fail('V2_S2_ACTUAL_ASR_QUOTE_REQUIRED');quote=syntheticAsr.reviewedText;}}
    await ui.navigate(target,{role,phase:'finding-chat'});
    const findingPrompt=`${V2_SYNTHETIC}。学生先写发现：${syntheticAsr?.status==='passed'?'合成试饮材料提及杯量与等候时间，非真人发现':record.code+'先看队列再决定'}。具体情况：这是软件验收的合成材料，不推广到真实用户。当前已校对摘录为「${quote}」。学生解释：仅保留材料表达，真实动机和行为仍待验证。${kind==='observation'?'这是观察材料，不要补造受访者原话。':''}请检查材料边界并给定性反馈。`;
    if(!await feedback(findingPrompt,'finding-projection',true))fail('V2_S2_FINDING_REAL_REPLY_REQUIRED');
    const candidateHost=page.getByTestId('aidt-interview-discovery-candidates');const before=await stage(2);
    await observeNativeAction({stageId:2,operationId:`s2-source-${kind}-finding-candidate`,perform:()=>click(btn('AI 归纳发现',candidateHost))});
    const choices=candidateHost.getByRole('radio');await expect.poll(()=>choices.count(),{timeout:30000}).toBeGreaterThan(0);
    await expect(candidateHost.locator('input[type="radio"]:checked')).toHaveCount(0);await expect(btn('填入草稿',candidateHost)).toBeDisabled();
    await choices.first().check();const replacement=candidateHost.getByRole('checkbox',{name:'用所选表达替换当前“一句发现”，其余内容保留',exact:true});if(await replacement.count())await replacement.check();
    await click(btn('填入草稿',candidateHost));const local=page.getByRole('region',{name:'独立 AI 表达草稿',exact:true});
    await fill('AI 辅助的一句发现',syntheticAsr?.status==='passed'?'合成试饮材料提及杯量与等候时间，尚待真人验证':`${record.code}先关注队列，原因仍需研究`,local);await ui.unchanged(2,before);
    const selected=await save(2,()=>click(btn('保存发现草稿',local)),{operationId:'s2-'+role+'-candidate-explicit-save',entityRole:role,entityId:record.id});await refresh(2,{expectedRevision:selected.receipt.revision,navigation:{role,phase:'candidate-refresh'}});
    const editor=page.getByTestId('aidt-interview-finding-editor');await expect(editor).toBeVisible();
    const geometry=await editor.evaluate(node=>({scroll:node.scrollWidth,width:node.clientWidth}));if(geometry.scroll>geometry.width)fail('V2_S2_FINDING_EDITOR_OVERFLOW');
    await mutate('finding-context',()=>fill('具体情况',`${V2_SYNTHETIC}。仅记录本软件测试材料中的表达或观察，不推断真人心理。`,editor));
    await ui.expand(kind==='observation'?'观察依据与来源':'原话与来源',editor);
    if(kind==='interview')await mutate('finding-quote',()=>fill(syntheticAsr?.status==='passed'?'可定位的合成转写摘录':'可定位的受访者原话',quote,editor));
    await mutate('finding-interpretation',()=>fill('学生的解释','合成软件QA解释：只能说明材料有这些表达，真实用户原因与普遍性未验证。',editor));
    const sourceFields=(await stage(2)).content.draft.fields;
    let photoHash;
    if(index===0){
      await mutate('photo-consent',()=>editor.getByRole('checkbox',{name:'已获受访者授权共享照片',exact:true}).check());
      const png=schematicPng(String(ui.scope.runId),31),photoName=`qa-${ui.scope.runId}-source-1-photo.png`;registerFixture({filename:photoName,bytes:png,mime:'image/png'});
      await editor.getByLabel(`${record.code}发现卡照片选择文件`,{exact:true}).setInputFiles({name:photoName,mimeType:'image/png',buffer:png});await upload('photo-upload','photo-bind',()=>click(btn('保存照片',editor)));await expect(editor).toContainText('原件已保存并回读');
      const photo=JSON.parse((await stage(2)).content.draft.fields['discoveryPhoto:'+record.id]??'{}');if(photo.sha256!==hash(png)||!photo.versionId)fail('V2_S2_PHOTO_SOURCE_READBACK_REQUIRED');photoHash=photo.sha256;
    }
    const confirmed=await save(2,()=>click(btn(kind==='observation'?'确认观察发现卡':'确认人物发现卡',editor)),{operationId:'s2-'+role+'-finding-confirm',entityRole:role,entityId:record.id});await refresh(2,{expectedRevision:confirmed.receipt.revision,navigation:{role,phase:'confirmed-refresh'}});await ui.outcome(target,{role,phase:'finding-outcome'});
    const finding=page.getByTestId('aidt-interview-finding');await expect(finding).toContainText(record.code);
    if(index===1){await expect(finding).toContainText('暂无授权照片');await expect(finding.getByRole('img')).toHaveCount(0);}else await expect(finding.getByRole('img')).toHaveCount(1);
    await printFormal({stage:2,name:`source-${index+1}-discovery-card`,entityId:record.id,imageHashes:photoHash?[photoHash]:[],expectedImageCount:index===0?1:0,button:finding.getByRole('button',{name:/打印|PDF/}),requiredTexts:[record.code],sourceRevision:confirmed.receipt.revision});
    await capture(`v2-s2-source-${index+1}-confirmed-refreshed`,2);
    const revocation=index===0&&!case01Review?await verifyV2PhotoRevocation({ui,target,photoName:`qa-${ui.scope.runId}-source-1-photo.png`,capture}):null;
    records.push({kind,code:record.code,target,quote,sourceFilename:filename,sourceSha256:hash(bytes),sourceFieldsBeforePhoto:sourceFields,syntheticAsr,revocation,revision:(await stage(2)).revision});
  }
  if(new Set(records.map(row=>row.target.threadId)).size!==2)fail('V2_S2_INDEPENDENT_THREADS_REQUIRED');
  await page.goto(directory.href,{waitUntil:'domcontentloaded'});await expect(page.getByTestId('aidt-stage-next')).toBeVisible();const next=await page.getByTestId('aidt-stage-next').getAttribute('href');
  await ui.completed(2);return {records,next,revision:(await stage(2)).revision,sourceCount:2,v2MinimumNotAsserted:true};
}

/** Same original/version/hash survives consent revocation; historical access uses current consent. */
export async function verifyV2PhotoRevocation({ui,target,photoName,capture}) {
  const {page,expect,stage,save,refresh,btn,click}=ui;
  const role='source-interview';const mutate=(suffix,action)=>save(2,action,{operationId:`s2-${role}-${suffix}`,entityRole:role,entityId:target.entityId});
  const frozen=await stage(2),id=target.entityId,fields=frozen.content.draft.fields;
  const photoKey='discoveryPhoto:'+id,transcriptKey='interviewTranscript:'+id;
  const photo=JSON.parse(fields[photoKey]??'null');if(!photo?.artifactId||!photo.versionId||photo.projectId!==ui.scope.projectId)fail('V2_PHOTO_REVOCATION_BASELINE_REQUIRED');
  const stable=draft=>({card:draft.discoveryCards?.filter(row=>row.id===id).map(({headline,headlineKind,context,quote})=>({headline,headlineKind,context,quote})),transcript:draft.fields[transcriptKey],interpretation:draft.fields['interviewInterpretation:'+id],materials:Object.fromEntries(Object.entries(draft.fields).filter(([key])=>key.startsWith('interviewMaterial:'+id+':')))});
  const baseline=stable(frozen.content.draft),preserved=current=>expect(stable(current.content.draft)).toEqual(baseline);
  await ui.navigate(target,{role,phase:'revocation-current'});const editor=page.getByTestId('aidt-interview-finding-editor');await expect(editor).toBeVisible();
  const revoked=await mutate('photo-revoke',()=>editor.getByRole('checkbox',{name:'已获受访者授权共享照片',exact:true}).uncheck());preserved(revoked.stage);
  await refresh(2,{expectedRevision:revoked.receipt.revision,navigation:{role,phase:'revocation-refresh'}});await ui.outcome(target,{role,phase:'revoked-outcome'});
  const finding=page.getByTestId('aidt-interview-finding');await expect(finding.getByRole('img')).toHaveCount(0);await expect(finding).toContainText('暂无授权照片');
  const history=new URL(target.href);history.searchParams.set('entityRevision',String(frozen.revision));history.searchParams.set('sourceId',photo.artifactId);
  await page.goto(history.href,{waitUntil:'domcontentloaded'});const current=await stage(2);preserved(current);
  if(JSON.parse(current.content.draft.fields['interviewRecord:'+id]).consent.photos!==false)fail('V2_CURRENT_CONSENT_NOT_REVOKED');
  const historical=page.getByTestId('aidt-entity-history');await expect(historical.getByRole('alert')).toHaveText('此访谈版本无法查看该原件。');await expect(historical.getByTestId('aidt-interview-finding').getByRole('img')).toHaveCount(0);
  for(const card of baseline.card??[])for(const text of [card.quote,card.context].filter(Boolean))await expect(historical).toContainText(text);
  await capture('v2-s2-revoked-historical-photo-hidden',2);
  await ui.navigate(target,{role,phase:'regrant-current'});await expect(editor).toBeVisible();await mutate('photo-regrant',()=>editor.getByRole('checkbox',{name:'已获受访者授权共享照片',exact:true}).check());
  const picker=editor.getByTestId('aidt-photo-upload');await ui.expand('使用此访谈已有照片',picker);const existing=btn(photoName,picker);await expect(existing).toHaveCount(1);
  const rebound=await mutate('photo-reuse',()=>click(existing));preserved(rebound.stage);
  const reference=JSON.parse(rebound.stage.content.draft.fields[photoKey]??'null');for(const key of ['projectId','artifactId','versionId','sha256','bytes','mime','name'])if(reference?.[key]!==photo[key])fail('V2_PHOTO_REGRANT_REPLACED_ORIGINAL');
  const confirmed=await mutate('photo-reconfirm',()=>click(btn('确认人物发现卡',editor)));await refresh(2,{expectedRevision:confirmed.receipt.revision,navigation:{role,phase:'reconfirmed-refresh'}});preserved(confirmed.stage);await ui.outcome(target,{role,phase:'regrant-outcome'});await expect(finding.getByRole('img')).toHaveCount(1);await capture('v2-s2-regranted-same-original-confirmed',2);
  return {revokedRevision:revoked.receipt.revision,restoredRevision:confirmed.receipt.revision,artifactId:photo.artifactId,versionId:photo.versionId,sha256:photo.sha256,currentAndHistoricalHidden:true,stableTextAndMaterials:true};
}
