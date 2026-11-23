/** Six real method entities, two normal native Chat turns per method, then explicit candidate adoption. */
import { ProbeFailure } from './devapp-aidt-auth-readonly.mjs';
import { V2_METHODS, V2_SYNTHETIC, savedV2Entities, parseV2Record } from './devapp-aidt-v2-ui.mjs';
const fail=code=>{throw new ProbeFailure(code);};
export async function runV2BrainstormMethods({ui,hmw,teachingFeedback,capture,observeNativeAction,report,methods=V2_METHODS}) {
  const {page,expect,btn,click,fill,go,stage,save,refresh}=ui;
  if(!hmw?.entityId||!hmw?.confirmedRevision||!hmw?.selectedRevision||!hmw?.text?.trim())fail('V2_S4_CONFIRMED_HMW_REQUIRED');
  if(!Array.isArray(methods)||!methods.length||methods[0]!=='free'||new Set(methods).size!==methods.length||methods.some(method=>!V2_METHODS.includes(method)))fail('V2_S4_METHOD_SCENARIO_INVALID');
  const results=[];
  for(const method of methods) {
    await go(4);const directory=page.getByRole('region',{name:'头脑风暴',exact:true});
    const before=await stage(4),prior=new Set(savedV2Entities(before,'ideaBrainstorm:').map(row=>row.id));
    await click(directory.getByTestId('aidt-new-entity-card'));
    const dialog=page.getByRole('dialog',{name:'新建头脑风暴',exact:true});await expect(dialog).toBeVisible();
    await fill('场次名称',`QA ${method} ${ui.scope.runId}`,dialog);
    const methodSelect=dialog.getByLabel('发散方法',{exact:true});await expect(methodSelect).toHaveValue('');await methodSelect.selectOption(method);
    await dialog.getByLabel('HMW',{exact:true}).selectOption(hmw.entityId);
    await fill('希望探索的点子数','5',dialog);
    await expect(dialog.getByTestId('aidt-brainstorm-method-guide')).not.toBeEmpty();
    const role='method-'+method,base=`/api/projects/${ui.scope.projectId}/aidt/stages/4`,expectedName=await dialog.getByLabel('场次名称',{exact:true}).inputValue();
    const created=await save(4,()=>click(btn('开始头脑风暴',dialog)),{uiAction:{actionId:`s4-${role}-normal-create`,steps:[
      {operationId:`s4-${role}-create`,kind:'write',requestKind:'stage-save',stageId:4,entityRole:role,method:'PUT',path:base,captureEntity:{prefix:'ideaBrainstorm:',nameField:'title',expectedName,priorIds:[...prior]}},
      {operationId:`s4-${role}-entity-thread-initial`,kind:'write',requestKind:'entity-thread',stageId:4,entityRole:role,entityId:'{createdEntity}',method:'PUT',path:base+'/entities/{createdEntity}/thread',captureThread:true},
      {operationId:`s4-${role}-thread-mount`,kind:'write',requestKind:'thread-mount',stageId:4,entityRole:role,entityId:'{createdEntity}',method:'POST',path:'/api/threads/{createdThread}/skill-mounts'},
    ]}});
    const added=savedV2Entities(created.stage,'ideaBrainstorm:').filter(row=>!prior.has(row.id));
    if(added.length!==1||added[0].method!==method||added[0].count!==5||added[0].source?.id!==hmw.entityId||added[0].source.revision!==hmw.selectedRevision||added[0].source.text!==hmw.text)fail('V2_S4_METHOD_SOURCE_NOT_SAVED');
    await page.waitForURL(url=>url.searchParams.get('step')==='4'&&url.searchParams.get('entity')===added[0].id&&url.searchParams.get('thread')?.startsWith('thr'));
    const target=ui.route(4);await refresh(4,{expectedRevision:created.receipt.revision,navigation:{role,phase:'created-refresh'}});
    const feedback=async(prompt,round)=>{let accepted;await ui.performAction({actionId:`s4-${role}-student-round-${round}-projection`,timeoutMs:240000,steps:[{operationId:`s4-${role}-projection-${round}`,kind:'write',requestKind:'stage-save',stageId:4,entityRole:role,entityId:target.entityId,method:'PUT',path:base}],perform:async()=>{accepted=await teachingFeedback(4,prompt);}});return accepted;};
    const firstCount=method==='free'?2:3;
    const firstIdeas=method==='free'?'提前展示预计等待时间、提供少量试饮比较口味':'提前展示预计等待时间、提供少量试饮比较口味、纸质标注口味差异';
    const first=`${V2_SYNTHETIC}。本场次使用${method}。学生第一轮明确提出${firstCount}个不同点子：${firstIdeas}。请只整理这些点子为${firstCount}个候选，不增补、不凑足五个计划名额，按当前方法问一个拓展问题，别分类/投票/替我们确认。`;
    if(!await feedback(first,1))fail('V2_S4_FIRST_REAL_REPLY_REQUIRED');
    const firstReply=report.teachingEvidence.findLast(row=>row.stageId===4&&row.threadId===target.threadId&&row.prompt===first&&row.status==='passed');
    if(!firstReply?.assistantText)fail('V2_S4_ACTUAL_FIRST_FEEDBACK_REQUIRED');
    const firstSaved=await stage(4),firstSession=parseV2Record(firstSaved,'ideaBrainstorm:',target.entityId);
    if(firstSession.candidates.length!==firstCount)fail('V2_S4_FIRST_STUDENT_COUNT_NOT_SAVED');
    const second=`${V2_SYNTHETIC}。本次实际反馈摘录：${firstReply.assistantText.slice(0,900)}。学生据此把时间情境不同保留为待验证假设，并在原来${firstCount}个点子外明确新增两个不同方案：1赶课时可带走的分时预约取饮卡；2同伴当面讲解选择经历的口头协助服务。请只整理这两个新增点子，不重复已有标题或内容；不要新增其他候选，按本场次${method}方法说明差异，不宣布最佳方案、不分类或替学生确认。`;
    if(!await feedback(second,2))fail('V2_S4_SECOND_REAL_REPLY_REQUIRED');
    const saved=await stage(4),session=parseV2Record(saved,'ideaBrainstorm:',target.entityId);
    if(session.candidates.length!==firstCount+2)fail('V2_S4_TWO_ROUND_STUDENT_COUNT_NOT_SAVED');
    if(session.method!==method||session.source.id!==hmw.entityId||session.source.revision!==added[0].source.revision)fail('V2_S4_FROZEN_HMW_CHANGED');
    await capture(`v2-s4-${method}-two-real-rounds`,4);
    results.push({method,target,session,sourceRevision:saved.revision,createdInThisRun:true});
  }
  // This independent candidate action is intentionally not counted as a sixth-method teaching turn.
  const primary=results[0];await ui.navigate(primary.target,{role:'method-free',phase:'candidate-reentry'});
  const host=page.getByRole('region',{name:'按本轮方法拓展点子',exact:true});
  const candidate=await ui.selectCandidate({stageId:4,host,actionLabel:'AI 提供点子候选',adoptLabel:'采用到草稿',editRegion:'所选点子的可编辑草稿',editLabel:'两三句核心说明',
    editText:'合成方案：先展示等待时间与少量试饮流程，让用户比较再自行决定。它帮助观察赶课情境下是否能理解选择步骤。',
    editExtra:local=>fill('点子名称','学生审阅后的情境选择卡',local),saveLabel:'保存所选点子',operationId:'s4-method-free-candidate',saveOperationId:'s4-method-free-candidate-explicit-save',saveRole:'method-free',refreshPhase:'candidate-refresh'});
  const finalSession=parseV2Record(candidate.stage,'ideaBrainstorm:',primary.target.entityId);if(finalSession.count!==5||finalSession.candidates.length!==5)fail('V2_S4_FIVE_REAL_CANDIDATES_REQUIRED');
  await go();await expect(page.getByTestId('aidt-stage-save-4')).not.toHaveAttribute('data-completed','true');
  return {methods:results,primary,candidate,ordinarySelectionDoesNotComplete:true};
}

export async function completeV2IdeaSheets({ui,brainstorm,uploadIdeaImage,teachingFeedback,capture,printFormal,round='a'}) {
  const {page,expect,btn,click,stage,save,refresh}=ui;
  let saved=await stage(4),session=parseV2Record(saved,'ideaBrainstorm:',brainstorm.target.entityId);
  const ideas=saved.content.draft.ideas.filter(row=>session.candidates.includes(row.id));
  if(ideas.length<3||new Set(ideas.map(row=>row.title.trim())).size<3)fail('V2_S4_THREE_DISTINCT_REAL_IDEAS_REQUIRED');
  const chosen=ideas.slice(0,3),outputs=[];
  for(const [i,idea]of chosen.entries()) {
    await ui.go(4);const directory=page.getByRole('region',{name:'点子列表',exact:true});
    const link=directory.getByRole('link',{name:new RegExp(idea.title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))}).first();
    const role=(round==='a'?'idea-':'idea-b-')+['one','two','three'][i],base=`/api/projects/${ui.scope.projectId}/aidt/stages/4`;
    await ui.performAction({actionId:`s4-${role}-open-native-chat`,steps:[
      {operationId:`s4-${role}-entity-thread-initial`,kind:'write',requestKind:'entity-thread',stageId:4,entityRole:role,entityId:idea.id,method:'PUT',path:base+'/entities/'+encodeURIComponent(idea.id)+'/thread',captureThread:true},
      {operationId:`s4-${role}-thread-mount`,kind:'write',requestKind:'thread-mount',stageId:4,entityRole:role,entityId:idea.id,method:'POST',path:'/api/threads/{createdThread}/skill-mounts'},
    ],perform:()=>click(link)});
    await page.waitForURL(url=>url.searchParams.get('entity')===idea.id&&url.searchParams.get('thread')?.startsWith('thr'));
    const target=ui.route(4);
    // Use actual source bytes through the product upload control; no data-URL stage patch.
    await ui.performAction({actionId:`s4-${role}-upload-and-bind-original-image`,steps:[
      {operationId:`s4-${role}-upload-image`,kind:'write',requestKind:'upload',stageId:4,entityRole:role,entityId:idea.id,method:'POST',path:`/api/projects/${ui.scope.projectId}/artifacts/upload`},
      {operationId:`s4-${role}-bind-image`,kind:'write',requestKind:'stage-save',stageId:4,entityRole:role,entityId:idea.id,method:'PUT',path:base},
    ],perform:()=>uploadIdeaImage({target,ordinal:(round==='a'?0:3)+i+1})});
    if(!await teachingFeedback(4,`${V2_SYNTHETIC}。请保留点子“${idea.title}”，按学生已有说明形成两三句核心描述，分别说明做什么和如何帮助理解本轮HMW。等待学生确认，不替我们选。`))fail('V2_S4_IDEA_DESCRIPTION_REAL_REPLY_REQUIRED');
    const confirm=btn('确认点子产物');await expect(confirm).toBeVisible();
    const confirmed=await save(4,()=>click(confirm),{operationId:`s4-${role}-description-confirm`,entityRole:role,entityId:idea.id});await refresh(4,{expectedRevision:confirmed.receipt.revision,navigation:{role,phase:'confirmed-refresh'}});await ui.outcome(target,{role,phase:'formal-outcome'});
    const output=page.getByTestId('aidt-idea-output');await expect(output).toContainText('已确认');let image;try{image=JSON.parse(confirmed.stage.content.draft.fields['ideaFile:'+idea.id]??'null');}catch{}if(!image||image.projectId!==ui.scope.projectId||!/^[a-f0-9]{64}$/.test(image.sha256))fail('V2_S4_FORMAL_IMAGE_REFERENCE_REQUIRED');
    outputs.push(await printFormal({stage:4,name:`${round==='a'?'':'round-b-'}idea-description-${i+1}`,entityId:idea.id,imageHashes:[image.sha256],expectedImageCount:1,button:btn('导出描述单 PDF',output),requiredTexts:[idea.title],sourceRevision:confirmed.receipt.revision}));
    await capture(`v2-s4-${round}-idea-${i+1}-formal`,4);
  }
  const role='method-'+brainstorm.method;await ui.navigate(brainstorm.target,{role,phase:'completion-reentry'});
  const choice=page.getByRole('region',{name:'筛选点子',exact:true});await expect(choice).toBeVisible();
  // First, an ordinary shortlist can be saved without pretending that it completes S4.
  await ui.expand('筛选点子 · 已选',choice);
  const shortlist=choice.locator('details').filter({has:page.locator('summary').filter({hasText:'筛选点子 · 已选'})});
  const selectable=shortlist.getByRole('checkbox');
  for(const box of await selectable.all())if(await box.isChecked())await box.uncheck();
  for(const idea of chosen.slice(0,2))await shortlist.getByRole('checkbox',{name:new RegExp('^'+idea.title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))}).check();
  const shortlisted=await save(4,()=>click(btn('确认入选点子',choice)),{operationId:`s4-${role}-shortlist`,entityRole:role,entityId:brainstorm.target.entityId});
  const selectedSession=parseV2Record(shortlisted.stage,'ideaBrainstorm:',brainstorm.target.entityId);if(selectedSession.candidates.length!==5)fail('V2_S4_SHORTLIST_FIVE_INPUTS_REQUIRED');
  const review=choice.getByRole('region',{name:'完成描述单与分类',exact:true});await expect(review).toBeVisible();
  const classifications=page.getByRole('region',{name:'学生点子分类',exact:true});await expect(classifications).toBeVisible();
  for(const idea of chosen) {
    const item=classifications.getByTestId('aidt-classification-idea').filter({has:page.getByRole('heading',{name:idea.title,exact:true})});
    await item.getByRole('checkbox',{name:idea.title+' · 最有趣的',exact:true}).check();
    await item.getByRole('textbox',{name:idea.title+' · 分类理由',exact:true}).fill('学生判断：便于在具体午休情境下比较，分类是本组选择而非AI评分。');
  }
  await save(4,()=>click(btn('确认本组分类',classifications)),{operationId:`s4-${role}-classification-confirm`,entityRole:role,entityId:brainstorm.target.entityId});
  for(const idea of chosen)await review.getByRole('checkbox',{name:'已审阅描述单：'+idea.title,exact:true}).check();
  const completed=await save(4,()=>click(btn('确认完成本阶段',review)),{confirmation:true,operationId:`s4-${role}-stage-complete`,entityRole:role,entityId:brainstorm.target.entityId});
  const frozen=readV2FrozenRound(completed.stage,{projectId:ui.scope.projectId,sessionId:brainstorm.target.entityId});
  if(frozen.selectedIds.length!==2||frozen.sheets.length!==3||frozen.selectedIds.some(id=>!chosen.slice(0,2).some(row=>row.id===id)))fail('V2_S4_SELECTION_TWO_VS_THREE_SHEETS_NOT_SEPARATE');
  await refresh(4,{expectedRevision:completed.receipt.revision,navigation:{role,phase:'completion-refresh'}});
  await printFormal({stage:4,name:round==='a'?'confirmed-classification-and-selection':'round-b-classification-and-selection',entityId:brainstorm.target.entityId,button:btn('打印分类与选择'),requiredTexts:chosen.map(row=>row.title),sourceRevision:completed.receipt.revision});
  await ui.completed(4);
  return {round,sessionId:brainstorm.target.entityId,snapshot:frozen,ideas:chosen.map(row=>({id:row.id,title:row.title})),revision:completed.receipt.revision,outputs};
}

/** Explicit formal snapshot only; a shortlist or a current global handoff does not qualify. */
export function readV2FrozenRound(stage,{projectId,sessionId}) {
  let value;try{value=JSON.parse(stage?.content?.draft?.fields?.['ideaBrainstormRoundCompletion:'+sessionId]??'null');}catch{}
  if(value?.schemaVersion!==1||value.status!=='confirmed'||value.sessionId!==sessionId||value.projectId!==projectId||!Array.isArray(value.selectedIds)||!Array.isArray(value.sheets)||value.sheets.length<3||new Set(value.sheets.map(row=>row.id)).size!==value.sheets.length||!value.classification?.confirmed||!value.source?.id||!Number.isSafeInteger(value.source.revision))fail('V2_S4_FORMAL_ROUND_SNAPSHOT_REQUIRED');
  for(const sheet of value.sheets){let image;try{image=JSON.parse(sheet.imageMaterial);}catch{}if(!sheet.title?.trim()||!sheet.description?.trim()||image?.projectId!==projectId||!image.versionId||!image.sha256)fail('V2_S4_FORMAL_ROUND_SHEET_SOURCE_MISSING');}
  if(value.selectedIds.some(id=>!value.sheets.some(row=>row.id===id)))fail('V2_S4_FORMAL_ROUND_SELECTION_NOT_REVIEWED');return value;
}
