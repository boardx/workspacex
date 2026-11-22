/** S5 saved V1 -> confirmed V2 -> real image/HTML/WebApp outputs. No output is fabricated by this runner. */
import { createHash } from 'node:crypto';
import { ProbeFailure } from './devapp-aidt-auth-readonly.mjs';
import { V2_SYNTHETIC } from './devapp-aidt-v2-ui.mjs';
const fail=code=>{throw new ProbeFailure(code);};
const hash=text=>createHash('sha256').update(text).digest('hex');
export function v2PrototypeFields(stage,id) {
  let record;try{record=JSON.parse(stage?.content?.draft?.fields?.['prototypeEntity:'+id]??'null');}catch{}
  if(!record||Object.values(record).some(value=>typeof value!=='string'))fail('V2_PROTOTYPE_RECORD_INVALID');
  const prefix='prototypeText:'+id+':';
  for(const[key,value]of Object.entries(stage.content.draft.fields))if(key.startsWith(prefix))record[key.slice(prefix.length)]=value;
  return record;
}
export function assertV2PrototypeLineage(fields,{projectId,stage4Revision,brainstormId,selectedIds}){
  let lineage;try{lineage=JSON.parse(fields.prototypeTextLineage);}catch{}if(lineage?.projectId!==projectId||lineage.stage4Revision!==stage4Revision||lineage.brainstormId!==brainstormId||lineage.ideas?.length!==selectedIds.length||JSON.stringify(lineage.ideas.map(idea=>idea.ideaId).sort())!==JSON.stringify([...selectedIds].sort()))fail('V2_PROTOTYPE_EXACT_LINEAGE_REQUIRED');
  const required={challenge:[1,1],interview:[2,2],finding:[2,2],persona:[3,1],hmw:[3,1],idea:[4,1],brainstorm:[4,1]};
  for(const idea of lineage.ideas){if(!Array.isArray(idea.references)||idea.references.length!==9||idea.missing?.length)fail('V2_PROTOTYPE_NINE_COMPLETE_SOURCE_REFERENCES_REQUIRED');for(const [role,[sourceStage,count]]of Object.entries(required)){const refs=idea.references.filter(reference=>reference.role===role);if(refs.length!==count||refs.some(reference=>reference.stageId!==sourceStage||!Number.isSafeInteger(reference.revision)||reference.revision<1||!reference.entityId))fail('V2_PROTOTYPE_SOURCE_ROLE_COUNT_MISMATCH');}const ids=role=>idea.references.filter(reference=>reference.role===role).map(reference=>reference.entityId).sort();if(JSON.stringify(ids('interview'))!==JSON.stringify(ids('finding'))||new Set(ids('interview')).size!==2||ids('idea')[0]!==idea.ideaId||ids('brainstorm')[0]!==brainstormId||idea.references.some(reference=>reference.stageId===4&&reference.revision!==stage4Revision))fail('V2_PROTOTYPE_SOURCE_ROLE_COORDINATES_MISMATCH');}
  return {sourceCountPerIdea:9,ideaIds:lineage.ideas.map(idea=>idea.ideaId),roleCounts:Object.fromEntries(Object.entries(required).map(([role,[,count]])=>[role,count]))};
}
function confirmation(fields){let value;try{value=JSON.parse(fields.prototypeTextConfirmation??'null');}catch{}return value;}
export async function prepareV2TextPrototype({ui,ideaSheets,selectedIds,role,teachingFeedback,observeNativeAction,armDesignCreate,capture,printFormal}) {
  if(![1,3].includes(selectedIds.length)||selectedIds.some(id=>!ideaSheets.ideas.some(row=>row.id===id)))fail('V2_PROTOTYPE_SELECTION_SCOPE_INVALID');
  const {page,expect,go,stage,btn,click,fill,save,refresh}=ui;
  await go(5);const sourceStage=await stage(4);let frozenRound;try{frozenRound=JSON.parse(sourceStage.content.draft.fields['ideaBrainstormRoundCompletion:'+ideaSheets.sessionId]??'null');}catch{}if(frozenRound?.status!=='confirmed'||frozenRound.sessionId!==ideaSheets.sessionId||frozenRound.projectId!==ui.scope.projectId)fail('V2_S5_CONFIRMED_SOURCE_ROUND_REQUIRED');
  const old=await stage(5),prior=new Set(Object.keys(old?.content?.draft?.fields??{}).filter(key=>key.startsWith('prototypeEntity:')));
  await click(page.getByRole('region',{name:'原型列表',exact:true}).getByTestId('aidt-new-entity-card'));
  const name=`QA ${role} ${ui.scope.runId}`;const dialog=page.getByRole('dialog',{name:'新建原型',exact:true});await fill('原型名称',name,dialog);
  const round=dialog.getByLabel('已确认 Ideation 列表',{exact:true});await expect(round).toHaveValue('');await round.selectOption(ideaSheets.sessionId);await expect(round).toHaveValue(ideaSheets.sessionId);
  const sources=dialog.getByRole('group',{name:'来源点子',exact:true});await expect(sources.locator('input[type="checkbox"]:checked')).toHaveCount(0);
  for(const id of selectedIds){const idea=ideaSheets.ideas.find(row=>row.id===id);await sources.getByRole('checkbox',{name:idea.title,exact:true}).check();}
  const base=`/api/projects/${ui.scope.projectId}/aidt/stages/5`;
  await save(5,()=>click(btn('创建原型',dialog)),{uiAction:{actionId:'s5-'+role+'-normal-create',steps:[
    {operationId:'s5-'+role+'-create-design',kind:'write',requestKind:'design-create',stageId:5,entityRole:role,method:'POST',path:'/api/pm-designs',expectedFields:{name},captureResource:{responsePath:'project',nameField:'name',expectedName:name,asEntity:true}},
    {operationId:'s5-'+role+'-link-design',kind:'write',requestKind:'design-link',stageId:5,entityRole:role,resourceId:'{createdResource}',method:'POST',path:`/api/projects/${ui.scope.projectId}/resources`},
    {operationId:'s5-'+role+'-save-source-pin',kind:'write',requestKind:'stage-save',stageId:5,entityRole:role,entityId:'{createdResource}',method:'PUT',path:base},
    {operationId:'s5-'+role+'-entity-thread-initial',kind:'write',requestKind:'entity-thread',stageId:5,entityRole:role,entityId:'{createdResource}',method:'PUT',path:base+'/entities/{createdResource}/thread',captureThread:true},
    {operationId:'s5-'+role+'-thread-mount',kind:'write',requestKind:'thread-mount',stageId:5,entityRole:role,entityId:'{createdResource}',method:'POST',path:'/api/threads/{createdThread}/skill-mounts'},
  ]}});
  await page.waitForURL(url=>url.searchParams.get('step')==='5'&&url.searchParams.get('entity'));
  const target=ui.route(5),created=await stage(5);
  if(prior.has('prototypeEntity:'+target.entityId))fail('V2_PROTOTYPE_CREATED_ENTITY_NOT_NEW');
  const fields=v2PrototypeFields(created,target.entityId);let selection;try{selection=JSON.parse(fields.prototypeIdeaSource);}catch{}
  if(selection?.revision!==sourceStage.revision||selection.brainstormId!==ideaSheets.sessionId||JSON.stringify([...selection.ideaIds].sort())!==JSON.stringify([...selectedIds].sort()))fail('V2_PROTOTYPE_SELECTED_IDEA_VERSION_MISMATCH');
  await ui.expand('查看每个点子的来源与缺口');
  const sourcePanel=page.getByTestId('aidt-prototype-text-design');
    for(const [ideaOrdinal,idea]of ideaSheets.ideas.filter(row=>selectedIds.includes(row.id)).entries()){
    const section=sourcePanel.locator('section').filter({has:page.getByRole('heading',{name:idea.title,exact:true})});
    await expect(section).toHaveCount(1);const sourceLinks=section.getByRole('link');
    const seen=new Set();
    const lineageLinks=await sourceLinks.all();if(lineageLinks.length!==9)fail('V2_IDEA_NINE_COMPLETE_LINEAGE_LINKS_REQUIRED');await expect(section.getByText(/^待补：/)).toHaveCount(0);const stageCounts={1:0,2:0,3:0,4:0},coordinates=[];for(const item of lineageLinks){const source=new URL(await item.getAttribute('href'),ui.origin),n=Number(source.searchParams.get('step'));if(!Object.hasOwn(stageCounts,n))fail('V2_IDEA_LINEAGE_STAGE_UNKNOWN');stageCounts[n]++;coordinates.push({stageId:n,entityId:source.searchParams.get('entity')});}if(stageCounts[1]!==1||stageCounts[2]!==4||stageCounts[3]!==2||stageCounts[4]!==2||new Set(coordinates.filter(row=>row.stageId===2).map(row=>row.entityId)).size!==2||new Set(coordinates.filter(row=>row.stageId===3).map(row=>row.entityId)).size!==2||new Set(coordinates.filter(row=>row.stageId===4).map(row=>row.entityId)).size!==1)fail('V2_IDEA_LINEAGE_STAGE_AND_ENTITY_COUNTS_MISMATCH');
    for(const [linkOrdinal,link]of lineageLinks.entries()){
      const href=new URL(await link.getAttribute('href'),ui.origin),sourceStage=Number(href.searchParams.get('step')),revision=Number(href.searchParams.get('sourceRevision')??href.searchParams.get('entityRevision')??href.searchParams.get('revision'));
      if(href.origin!==ui.origin||href.pathname!==ui.projectPath||!Number.isInteger(sourceStage)||sourceStage<1||sourceStage>4||!Number.isSafeInteger(revision)||revision<1)fail('V2_IDEA_LINEAGE_LINK_COORDINATES_MISSING');
      seen.add(sourceStage);
      await link.click();await expect.poll(()=>new URL(page.url()).searchParams.get('step')).toBe(String(sourceStage));
      await expect(page.getByTestId('aidt-project-workspace')).toBeVisible();await expect.poll(()=>new URL(page.url()).searchParams.get('entity')).toBe(href.searchParams.get('entity'));await expect.poll(()=>new URL(page.url()).searchParams.get('entityRevision')).toBe(String(revision));await expect(page.getByTestId('aidt-entity-history')).toBeVisible();await capture(`v2-s5-${role}-idea${ideaOrdinal+1}-s${sourceStage}-l${linkOrdinal+1}`,sourceStage);
      await ui.navigate(target,{role,phase:`lineage-${ideaOrdinal+1}-return-${linkOrdinal+1}`});await ui.expand('查看每个点子的来源与缺口');
    }
    if([1,2,3,4].some(n=>!seen.has(n)))fail('V2_EACH_IDEA_S1_S4_LINEAGE_NOT_COMPLETE');
  }
  const student=`${V2_SYNTHETIC}。学生选择${selectedIds.length}个已有点子。我们本轮最想知道：用户能否理解先比较等待时间再决定的顺序？先前看法是可理解，依据目前仅为本组合成讨论。形式为服务流程/简单界面；情境是午休赶课；任务是识别等候信息并作选择；需要展示具体等待时间和返回比较入口。静态图仅核理解，不证明实际投入时间。请整理可编辑制作说明，不确认、不生成图片网页。`;
  const beforeStudent=await stage(5);if(!await teachingFeedback(5,student))fail('V2_S5_STUDENT_INITIAL_FEEDBACK_REQUIRED');await ui.unchanged(5,beforeStudent);
  const question=btn('确认验证问题');await expect(question).toBeEnabled();await save(5,()=>click(question),{operationId:'s5-'+role+'-question-confirm',entityRole:role,entityId:target.entityId});
  const editor=page.getByTestId('aidt-prototype-text-design');const input=editor.getByLabel('可编辑文字设计',{exact:true});
  const v1=`# V1 合成文字设计\n\n学生初稿：只显示饮品名称和一个“下一步”。用户为午休选饮品的学生。本次要了解是否理解等候信息；当前表达尚缺等待时长，不能证明实际行为。`;
  await input.fill(v1);const savedV1=await save(5,()=>click(btn('保存文字设计',editor)),{operationId:'s5-'+role+'-text-draft',entityRole:role,entityId:target.entityId});await refresh(5,{expectedRevision:savedV1.receipt.revision,navigation:{role,phase:'v1-refresh'}});
  assertV2PrototypeLineage(v2PrototypeFields(savedV1.stage,target.entityId),{projectId:ui.scope.projectId,stage4Revision:sourceStage.revision,brainstormId:ideaSheets.sessionId,selectedIds});
  const beforeCandidate=await stage(5),host=page.getByRole('region',{name:'文字设计候选',exact:true});
  await observeNativeAction({stageId:5,operationId:`s5-${role}-text-candidate`,perform:()=>click(btn('帮我整理文字设计',host))});
  await ui.unchanged(5,beforeCandidate);await expect(host.getByRole('radio').first()).toBeVisible();await expect(host.locator('input[type="radio"]:checked')).toHaveCount(0);
  await host.getByRole('radio').first().check();const replace=host.getByRole('checkbox',{name:'我已对照已有内容，同意将选中的候选填入可编辑草稿',exact:true});if(await replace.count())await replace.check();
  await click(btn('采用为可编辑文字草稿',host));await ui.unchanged(5,beforeCandidate);
  const v2=`# V2 学生审阅后合成文字设计\n\n改进：明确显示“预计等待5分钟”，并给“查看其他选择”和“返回比较”两个不同操作，保留用户自主决定。用户为午休中的学生，分别考虑赶课/闲暇情境。\n\n验证问题：用户能否理解先比较等待时间再决定的顺序？\n先前看法：也许可以，依据仅合成材料，不能当真人证据。\n范围：理解与意向，不证明真实耗时或付费。\n来源：第4步V${sourceStage.revision}，本轮${selectedIds.length}个学生已选点子，保留每点子各自S1–S4引用。`;
  await input.fill(v2);await ui.unchanged(5,beforeCandidate);
  const savedV2=await save(5,()=>click(btn('保存文字设计',editor)),{operationId:'s5-'+role+'-text-revised',entityRole:role,entityId:target.entityId});await refresh(5,{expectedRevision:savedV2.receipt.revision,navigation:{role,phase:'v2-refresh'}});
  const confirmed=await save(5,()=>click(btn('确认已保存文字设计',editor)),{operationId:'s5-'+role+'-text-confirm',entityRole:role,entityId:target.entityId});
  const basisFields=v2PrototypeFields(confirmed.stage,target.entityId),basis=confirmation(basisFields);
  if(!basis||basis.stageRevision!==savedV2.receipt.revision||basisFields.prototypeTextConfirmedText!==v2||basisFields.prototypeTextDesign!==v2)fail('V2_FORMAL_TEXT_V2_CONFIRMATION_MISMATCH');
  await refresh(5,{expectedRevision:confirmed.receipt.revision,navigation:{role,phase:'confirmed-refresh'}});await capture(`v2-s5-${role}-confirmed-v2`,5);
  await printFormal({stage:5,name:role+'-confirmed-text',entityId:target.entityId,button:btn('预览／打印文字设计',editor),requiredTexts:[v2],sourceRevision:savedV2.receipt.revision});
  await printFormal({stage:5,name:role+'-verification-question',entityId:target.entityId,button:btn('打印验证问题卡'),requiredTexts:[basisFields.verificationQuestion],sourceRevision:confirmed.receipt.revision});
  return {role,name,target,selectedIds,sourceRoundId:ideaSheets.sessionId,stage4Revision:sourceStage.revision,v1,v2,v1Revision:savedV1.receipt.revision,v2Revision:savedV2.receipt.revision,confirmedRevision:confirmed.receipt.revision,basisSha256:hash(v2),basis,createdInThisRun:true};
}
export async function saveV2UnconfirmedV3({ui,prototype,capture}) {
  const {page,expect,btn,click,save,refresh}=ui;await ui.navigate(prototype.target,{role:prototype.role,phase:'unconfirmed-v3-entry'});
  const panel=page.getByTestId('aidt-prototype-text-design'),v3='# V3 未确认反向变体\n\n本次明确改为完全不展示等待时间，仅展示装饰图。此稿尚未审阅，不得用于之前已按V2制作的任何原型或测试。';
  await panel.getByLabel('可编辑文字设计',{exact:true}).fill(v3);
  const saved=await save(5,()=>click(btn('保存文字设计',panel)),{operationId:'s5-'+prototype.role+'-unconfirmed-v3-save',entityRole:prototype.role,entityId:prototype.target.entityId});await refresh(5,{expectedRevision:saved.receipt.revision,navigation:{role:prototype.role,phase:'v3-refresh'}});
  const fields=v2PrototypeFields(saved.stage,prototype.target.entityId);
  if(fields.prototypeTextDesign!==v3||confirmation(fields))fail('V2_UNCONFIRMED_V3_NOT_DISTINCT');
  const designLink=page.getByRole('link',{name:'打开 Design 工作台',exact:true});await expect(designLink).toHaveCount(0);
  await capture('v2-s5-unconfirmed-v3-blocks-new-production',5);
  return {revision:saved.receipt.revision,text:v3,sha256:hash(v3)};
}
export async function assertV2FrozenTextLink({ui,link,prototype,capture,name}) {
  const {page,expect}=ui;await expect(link).toBeVisible();const href=new URL(await link.getAttribute('href'),ui.origin);
  if(href.origin!==ui.origin||href.pathname!==ui.projectPath||href.searchParams.get('entity')!==prototype.target.entityId||href.searchParams.get('textRevision')!==String(prototype.v2Revision))fail('V2_TEXT_HISTORY_LINK_NOT_FROZEN_V2');
  const before=new URL(page.url()),origin=/^v2-history-(prototype|offline|survey|virtual|report)-retains-v2$/.exec(name)?.[1];if(!origin)fail('V2_TEXT_HISTORY_ORIGIN_NOT_PLANNED');const perform=()=>link.click();if(before.searchParams.get('step')!=='5'||before.searchParams.get('entity')!==prototype.target.entityId||before.searchParams.has('entityRevision'))await ui.performAction({actionId:'s5-'+prototype.role+'-history-from-'+origin,steps:[{operationId:'s5-'+prototype.role+'-entity-thread-history-from-'+origin,kind:'write',requestKind:'entity-thread',stageId:5,entityRole:prototype.role,entityId:prototype.target.entityId,method:'PUT',path:`/api/projects/${ui.scope.projectId}/aidt/stages/5/entities/${encodeURIComponent(prototype.target.entityId)}/thread`}],perform});else await perform();await expect.poll(()=>new URL(page.url()).searchParams.get('textRevision')).toBe(String(prototype.v2Revision));
  const content=page.getByTestId('aidt-prototype-text-design');await expect(content).toContainText(prototype.v2);await expect(content).not.toContainText('V3 未确认反向变体');
  await expect(content.getByLabel('可编辑文字设计',{exact:true})).toHaveCount(0);await capture(name,5);
  return {textRevision:prototype.v2Revision,textSha256:prototype.basisSha256,actualHistoricalClick:true};
}
