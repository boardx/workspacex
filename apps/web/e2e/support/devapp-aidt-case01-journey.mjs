/** #6976 case01 only: real UI actions, finite shared guard, no fixture-completed stages. */
import { createHash } from 'node:crypto';
import { ProbeFailure } from './devapp-aidt-auth-readonly.mjs';
import { CASE01_ID, CASE01_PROFILE, assertCase01Plan, case01Digest } from './devapp-aidt-case01-plan.mjs';
import { createV2UI, V2_SYNTHETIC, parseV2Record } from './devapp-aidt-v2-ui.mjs';
import { runV2S1 } from './devapp-aidt-v2-s1.mjs';
import { runV2S2 } from './devapp-aidt-v2-s2.mjs';
import { useV2DefinitionCandidate } from './devapp-aidt-v2-definition.mjs';
import { runV2BrainstormMethods, completeV2IdeaSheets, readV2FrozenRound } from './devapp-aidt-v2-s4.mjs';
import { prepareV2TextPrototype } from './devapp-aidt-v2-s5.mjs';
import { produceV2PrototypeVersions } from './devapp-aidt-v2-design.mjs';
import { createV2TestGroup, seedV2StudentTestTask, applyV2TestCandidate, confirmV2TestLearning } from './devapp-aidt-v2-s6.mjs';
import { runV2SurveyResearch } from './devapp-aidt-v2-research.mjs';
import { runV2GroupReport } from './devapp-aidt-v2-report.mjs';
import { schematicPng } from './devapp-aidt-journey.mjs';
import { openAidtProblemNativeOutcome, matchesAidtProblemNativeContext } from './devapp-aidt-problem-navigation.mjs';
const fail=code=>{throw new ProbeFailure(code);};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function studentInterfaceImage(page,runId){
  // Detached canvas is QA-authored material. It never rewrites the product or a model response.
  const data=await page.evaluate(async()=>{
    await document.fonts.ready;
    const canvas=document.createElement('canvas');canvas.width=420;canvas.height=260;
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('CANVAS_UNAVAILABLE');
    ctx.fillStyle='#ffffff';ctx.fillRect(0,0,420,260);ctx.fillStyle='#000000';ctx.font='bold 18px sans-serif';
    ctx.fillText('等待信息比较',20,32);
    ctx.strokeStyle='#000000';ctx.lineWidth=1;ctx.strokeRect(20,52,380,66);
    ctx.font='bold 20px sans-serif';ctx.fillText('预计等待 5 分钟',40,94);
    ctx.strokeRect(20,143,183,48);ctx.strokeRect(217,143,183,48);
    ctx.font='16px sans-serif';ctx.fillText('查看其他选择',55,174);ctx.fillText('返回比较',269,174);
    ctx.font='14px sans-serif';ctx.fillText('学生自制合成界面 · 非 AI 图片',20,231);
    // A monochrome student wireframe needs no antialiased color palette. Keep
    // the legible glyph outlines while removing excess raster entropy; the
    // original PNG upload limit remains unchanged.
    const pixels=ctx.getImageData(0,0,420,260);
    for(let i=0;i<pixels.data.length;i+=4){
      const value=pixels.data[i]<180?0:255;
      pixels.data[i]=value;pixels.data[i+1]=value;pixels.data[i+2]=value;pixels.data[i+3]=255;
    }
    ctx.putImageData(pixels,0,0);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const bytes=Buffer.from(data,'base64');if(bytes.length<512||bytes.length>16384)fail('CASE01_SEMANTIC_IMAGE_SIZE_BOUND');
  return {caseId:CASE01_ID,filename:`qa-${runId}-prototype.png`,bytes};
}

async function case01Definition({ui,s2,teachingFeedback,observeNativeAction,capture,printFormal}){
  const {page,expect,btn,click,fill,save,stage}=ui,role='surprise-main',entityId='primary-surprise';
  await ui.go(3);await click(page.getByTestId('aidt-new-entity-card'));
  await click(btn('新建意外发现',page.getByRole('group',{name:'选择卡片类型',exact:true})));
  const dialog=page.getByRole('dialog',{name:'新建意外发现',exact:true});await fill('卡片名称','本轮例外核对',dialog);
  await dialog.getByRole('group',{name:'来源访谈',exact:true}).getByRole('checkbox').first().check();
  const base=`/api/projects/${ui.scope.projectId}/aidt/stages/3`;
  await save(3,()=>click(btn('创建意外发现',dialog)),{uiAction:{actionId:'case01-surprise-create',steps:[
    {operationId:'s3-surprise-main-create',kind:'write',requestKind:'stage-save',stageId:3,entityRole:role,entityId,method:'PUT',path:base},
    {operationId:'s3-surprise-main-entity-thread-initial',kind:'write',requestKind:'entity-thread',stageId:3,entityRole:role,entityId,method:'PUT',path:base+'/entities/'+entityId+'/thread',captureThread:true},
    {operationId:'s3-surprise-main-thread-mount',kind:'write',requestKind:'thread-mount',stageId:3,entityRole:role,entityId,method:'POST',path:'/api/threads/{createdThread}/skill-mounts'}]}});
  await page.waitForURL(url=>url.searchParams.get('entity')===entityId&&url.searchParams.get('thread')?.startsWith('thr'));
  const surprise=ui.route(3);
  if(!await teachingFeedback(3,`${V2_SYNTHETIC}。学生重新核对了本组两份授权材料，目前暂无与原先想法不同的证据。请记录暂无意外发现，不编造惊喜或心理动机。`))fail('CASE01_SURPRISE_REPLY_REQUIRED');
  const confirmed=await save(3,()=>click(btn('确认当前产物')),{operationId:'s3-surprise-main-confirm',entityRole:role,entityId});
  await ui.outcome(surprise,{role,phase:'formal-outcome'});await expect(page.getByTestId('aidt-definition-editor')).toContainText('暂无');
  await printFormal({stage:3,name:'confirmed-surprise',entityId,button:btn('打印意外发现'),requiredTexts:['暂无'],sourceRevision:confirmed.receipt.revision});
  const sourceCodes=s2.records.map(row=>row.code),persona=await useV2DefinitionCandidate({ui,kind:'persona',count:2,sourceCodes,observeNativeAction,capture,printFormal});
  const hmw=await useV2DefinitionCandidate({ui,kind:'hmw',count:2,sourceCodes,observeNativeAction,capture,printFormal});
  await ui.completed(3);return {surprise,persona,hmw,revision:(await stage(3)).revision};
}
async function returnFour({ui,target,brainstorm,sheets,capture}){
  const {page,expect,btn,click,fill,save,stage}=ui;
  await ui.navigate(target,{role:target.role,phase:'historical-reentry',tool:'outcome'});
  const panel=page.getByTestId('aidt-test-group-iteration');await expect(panel).toBeVisible();await ui.expand('本轮反思与迭代',panel);
  const before=await stage(6),group=parseV2Record(before,'testGroup:',target.entityId);
  await panel.getByLabel('测试后的认识',{exact:true}).selectOption('insufficient');
  await fill('测试后怎么看','合成问卷只能检查表达，尚不能证明真实用户理解；我们选择再比较点子。',panel);
  await fill('材料依据',`本轮软件QA合成问卷 ${group.source?.id}，已保存答卷 ${group.surveyResponseId}。`,panel);
  await fill('仍不确定的地方','真实使用者在赶课情境下的行为与动机未验证。',panel);
  await panel.getByLabel('从哪一步重新入手',{exact:true}).selectOption('4');
  const reason='先回创意发散，比较等待信息表达的不同方向；不把合成答卷当作真实结论。';
  await fill('选择理由',reason,panel);await fill('下一步行动','回到原头脑风暴场次，重新核对并保存分类理由，保留旧原型和问卷版本。',panel);
  await ui.unchanged(6,before);
  const saved=await save(6,()=>click(btn('确认并保存本轮反思与迭代',panel)),{confirmation:true,operationId:'s6-test-survey-return-four',entityRole:target.role,entityId:target.entityId});
  const fields=saved.stage.content.draft.fields,prefix='testRound:'+target.entityId+':';
  if(fields[prefix+'returnStep']!=='4'||fields[prefix+'reflectionConfirmed']!=='true'||fields[prefix+'returnReason']!==reason||case01Digest(parseV2Record(saved.stage,'testGroup:',target.entityId))!==case01Digest(group))fail('CASE01_RETURN_FOUR_NOT_SAVED');
  const link=panel.getByRole('link',{name:'带着本轮反思，回到第4步 · 创意发散',exact:true});await expect(link).toBeVisible();
  const href=new URL(await link.getAttribute('href'),ui.origin);
  if(href.origin!==ui.origin||href.pathname!==ui.projectPath||href.searchParams.get('step')!=='4'||href.searchParams.get('returnEntity')!==target.entityId||href.searchParams.get('returnRevision')!==String(saved.receipt.revision))fail('CASE01_RETURN_FOUR_LINK_NOT_EXACT');
  await click(link);await expect(page.getByTestId('aidt-return-context')).toContainText(reason);await capture('case01-return-four-real-context',4);
  const directory=page.getByRole('region',{name:'头脑风暴',exact:true}),resume=directory.locator(`a[href*="entity=${brainstorm.target.entityId}"]`);
  await expect(resume).toHaveCount(1);const resumed=new URL(await resume.getAttribute('href'),ui.origin);
  if(resumed.origin!==ui.origin||resumed.pathname!==ui.projectPath||resumed.searchParams.get('returnEntity')!==target.entityId||resumed.searchParams.get('returnRevision')!==String(saved.receipt.revision))fail('CASE01_RETURN_FOUR_CONTEXT_LOST');
  await ui.performAction({actionId:'case01-return-four-resume',steps:[{operationId:'s4-method-free-entity-thread-return-four',kind:'write',requestKind:'entity-thread',stageId:4,entityRole:'method-free',entityId:brainstorm.target.entityId,method:'PUT',path:`/api/projects/${ui.scope.projectId}/aidt/stages/4/entities/${brainstorm.target.entityId}/thread`}],perform:()=>click(resume)});
  await expect.poll(()=>new URL(page.url()).searchParams.get('entity')).toBe(brainstorm.target.entityId);
  await expect(page.getByTestId('aidt-return-context')).toContainText(reason);
  const beforeFour=await stage(4),classification=page.getByRole('region',{name:'学生点子分类',exact:true});
  const updated='根据本轮合成问卷回看：先比较信息表达与使用情境，再决定验证；真实效果仍待研究。';
  await classification.getByRole('textbox',{name:sheets.ideas[0].title+' · 分类理由',exact:true}).fill(updated);
  const revised=await save(4,()=>click(btn('确认本组分类',classification)),{operationId:'s4-method-free-return-four-save',entityRole:'method-free',entityId:brainstorm.target.entityId});
  if(revised.receipt.revision<=beforeFour.revision||!JSON.stringify(revised.stage.content).includes(updated))fail('CASE01_RETURN_FOUR_CONTINUATION_NOT_PERSISTED');
  const review=page.getByRole('region',{name:'完成描述单与分类',exact:true});
  for(const idea of sheets.ideas)await review.getByRole('checkbox',{name:'已审阅描述单：'+idea.title,exact:true}).check();
  const complete=await save(4,()=>click(btn('确认完成本阶段',review)),{confirmation:true,operationId:'s4-method-free-return-four-complete',entityRole:'method-free',entityId:brainstorm.target.entityId});
  readV2FrozenRound(complete.stage,{projectId:ui.scope.projectId,sessionId:brainstorm.target.entityId});
  await ui.refresh(4,{expectedRevision:complete.receipt.revision,navigation:{role:'method-free',phase:'return-four-refresh'}});
  if(!JSON.stringify((await stage(4)).content).includes(updated))fail('CASE01_RETURN_FOUR_REFRESH_LOST');
  const unchanged=await stage(6);if(case01Digest(parseV2Record(unchanged,'testGroup:',target.entityId))!==case01Digest(group))fail('CASE01_RETURN_FOUR_REWROTE_TESTED_SOURCE');
  await capture('case01-return-four-continued-saved-refreshed',4);return {testEntity:target.entityId,reflectionRevision:saved.receipt.revision,continuedRevision:complete.receipt.revision,reason,updated,testedVersionId:group.versionId,oldTestPreserved:true};
}
export async function runCase01Journey(ports){
  assertCase01Plan(ports.plan);
  if(ports.plan.profile!==CASE01_PROFILE||!ports.report?.project?.ownerVerified||ports.report.project.setup!=='normal-homepage-UI'||ports.report.project.id!==ports.scope.projectId||typeof ports.reviewS1StudentResponse!=='function'||typeof ports.reviewS2StudentResponse!=='function'||typeof ports.saveCaseStage!=='function')fail('CASE01_FRESH_PROJECT_OR_REVIEW_REQUIRED');
  const {page,expect,scope,api,report,capture,checkpoint,printFormal,teachingFeedback}=ports;
  const bound=ports.runtimeScope();if(bound.projectId!==scope.projectId||bound.orgRole!=='consultant')fail('CASE01_ORDINARY_PROJECT_REQUIRED');
  for(let n=1;n<=6;n++){const current=await api(`/api/projects/${scope.projectId}/aidt/stages/${n}`);if(current.status!==200||current.data?.stage)fail('CASE01_FRESH_STAGES_REQUIRED');}
  const ui=createV2UI({...ports,read:api});
  const ordinaryOutcome=ui.outcome;
  ui.outcome=async(target,navigation)=>{
    if(target.stageId!==1)return ordinaryOutcome(target,navigation);
    const perform=()=>openAidtProblemNativeOutcome({page,route:target,scope:{origin:ui.origin,projectId:scope.projectId},waitForRoute:(predicate,options)=>expect.poll(predicate,options).toBe(true),assertReady:()=>expect(page.getByTestId('aidt-stage-output')).toBeVisible()});
    if(matchesAidtProblemNativeContext(page.url(),target)&&navigation.phase!=='draft-reentry')return perform();
    return ui.performAction({actionId:'case01-native-s1-'+navigation.phase,steps:[
      {operationId:'s1-problem-main-entity-thread-'+navigation.phase,kind:'write',requestKind:'entity-thread',stageId:1,entityRole:'problem-main',entityId:target.entityId,method:'PUT',path:`/api/projects/${scope.projectId}/aidt/stages/1/entities/${target.entityId}/thread`},
      {operationId:'s1-problem-main-reconcile-'+navigation.phase,kind:'write',requestKind:'reconcile-entity',stageId:1,entityRole:'problem-main',entityId:target.entityId,method:'POST',path:`/api/projects/${scope.projectId}/aidt/stages/1/entities/${target.entityId}/reconcile`}],perform:async()=>{if(navigation.phase==='draft-reentry')await page.reload({waitUntil:'domcontentloaded'});return perform();}});
  };
  report.case01={caseId:CASE01_ID,status:'RUNNING',manifestSha256:ports.plan.manifestSha256,projectId:scope.projectId,source:bound.source,controlSource:bound.controlSource,tag:bound.tag,stages:[],screenshots:[],tenInterviewCardsExecuted:false,wavOrAsrExecuted:false,realHumanValidation:false,cases02to07:'NOT_IMPLEMENTED'};
  const state=report.case01;ports.ledger.beginCase(CASE01_ID,bound);
  async function phase(stage,name,perform){let result;const ok=await checkpoint(name,async()=>{result=await perform();const saved=await ui.stage(stage);if(!saved)fail('CASE01_STAGE_CHECKPOINT_NOT_SAVED');const screenshot=await capture('case01-s'+stage+'-saved-version',stage);const file=await ports.saveCaseStage({stage,saved,screenshot});state.stages.push({stage,status:'EXECUTED',revision:saved.revision,contentSha256:case01Digest(saved.content),file,screenshot});});if(!ok){state.status='FAILED';state.lastCheckpoint=name;return null;}return result;}
  const s1=await phase(1,'case01-s1-student-confirm',()=>runV2S1({ui,report,teachingFeedback,reviewS1StudentResponse:ports.reviewS1StudentResponse,capture,printFormal}));if(!s1)return;
  const s2=await phase(2,'case01-s2-authorized-sources',()=>runV2S2({ui,s1,teachingFeedback,observeNativeAction:ports.observeNativeAction,capture,printFormal,registerFixture:ports.registerFixture,case01Review:{caseId:CASE01_ID,review:ports.reviewS2StudentResponse,report}}));if(!s2)return;
  const s3=await phase(3,'case01-s3-persona-hmw',()=>case01Definition({...ports,ui,s2}));if(!s3)return;
  let brainstorm;const brainstormOK=await checkpoint('case01-s4-native-brainstorm',async()=>{brainstorm=await runV2BrainstormMethods({...ports,ui,hmw:s3.hmw,methods:['free']});});if(!brainstormOK){state.status='FAILED';return;}
  const uploadIdeaImage=async({target,ordinal})=>{await ui.expand('添加描述单配图');const png=schematicPng(String(scope.runId),ordinal),filename=`qa-${scope.runId}-idea-${ordinal}.png`;ports.registerFixture({filename,bytes:png,mime:'image/png'});const host=page.getByTestId('aidt-research-material-control').filter({has:page.getByLabel('点子配图选择文件',{exact:true})});await expect(host).toHaveCount(1);await host.getByLabel('点子配图选择文件',{exact:true}).setInputFiles({name:filename,mimeType:'image/png',buffer:png});await ui.save(4,()=>ui.click(ui.btn('保存原始材料',host)));const source=JSON.parse((await ui.stage(4)).content.draft.fields['ideaFile:'+target.entityId]??'null');if(source?.projectId!==scope.projectId||source.sha256!==sha(png))fail('CASE01_IDEA_IMAGE_READBACK_REQUIRED');return source;};
  const sheets=await phase(4,'case01-s4-confirmed-ideas',()=>completeV2IdeaSheets({...ports,ui,brainstorm:brainstorm.primary,uploadIdeaImage,round:'a'}));if(!sheets)return;
  const prototype=await phase(5,'case01-s5-text-image-version',async()=>{const text=await prepareV2TextPrototype({...ports,ui,ideaSheets:sheets,selectedIds:[sheets.ideas[0].id],role:'prototype-single'});if(!['预计等待5分钟','查看其他选择','返回比较'].every(label=>text.v2.includes(label)))fail('CASE01_IMAGE_TEXT_BASIS_NOT_SUPPORTED');const studentImage=await studentInterfaceImage(page,scope.runId);const produced=await produceV2PrototypeVersions({...ports,ui,prototype:text,read:api,kinds:['html','image'],studentImage,printFormal:request=>request.name==='prototype-single-html'?Promise.resolve({status:'NOT_REQUESTED_IN_CASE01',notAcceptanceEvidence:true}):printFormal(request.name==='prototype-single-image'?{...request,imageHashes:[sha(studentImage.bytes)],expectedImageCount:1}:request)});if(produced.selected.kind!=='image'||produced.versions.filter(row=>row.source==='model').length!==1)fail('CASE01_EXACT_IMAGE_AND_SINGLE_DESIGN_REQUIRED');return {text,produced,imageEvidence:{source:'student-authored-synthetic-interface',sha256:sha(studentImage.bytes),labels:['等待信息比较','预计等待 5 分钟','查看其他选择','返回比较'],aiImageGenerationVerified:false,htmlGenerationVerified:true}};});if(!prototype)return;
  state.prototypeEvidence=prototype.imageEvidence;
  const survey=await phase(6,'case01-s6-survey-reflection',async()=>{const pin={entityId:prototype.text.target.entityId,designId:prototype.text.target.entityId,versionId:prototype.produced.selected.versionId,stage5Revision:prototype.produced.stage5Revision};const target=await createV2TestGroup({...ports,ui,prototype:pin,path:'survey'});await seedV2StudentTestTask({...ports,ui,testTarget:target});await applyV2TestCandidate({...ports,ui,testTarget:target,phase:'plan'});const research=await runV2SurveyResearch({...ports,ui,testTarget:target,readSurveyReceipt:ports.surveyReceipt});await applyV2TestCandidate({...ports,ui,testTarget:target,phase:'result'});const confirmed=await confirmV2TestLearning({...ports,ui,testTarget:target,returnStep:'4'});await ui.completed(6);return {target,research,confirmed};});if(!survey)return;
  let returned;const returnOK=await checkpoint('case01-return-four-save',async()=>{returned=await returnFour({ui,target:survey.target,brainstorm:brainstorm.primary,sheets,capture});state.returnFour=returned;});if(!returnOK){state.status='FAILED';return;}
  let final;const reportOK=await checkpoint('case01-native-report-pdf',async()=>{final=await runV2GroupReport({...ports,ui,prototype:prototype.text,caseId:CASE01_ID});state.systemReport={confirmedRevision:final.confirmedRevision,markdownSha256:final.markdownSha256,sourceClicks:final.sourceClicks,printing:final.printing};});if(!reportOK){state.status='FAILED';return;}
  if(report.formalPrintChecks?.some(row=>row.status!=='PENDING_INDEPENDENT_REVIEW'))fail('CASE01_NATIVE_PRINT_INCOMPLETE');
  if(state.stages.length!==6||report.stageFileEvidence?.filter(row=>row.uiReopenVerified&&row.contentVerified).length!==6||final.printing.status!=='PENDING_INDEPENDENT_REVIEW')fail('CASE01_SIX_FILES_OR_NATIVE_PRINT_INCOMPLETE');
  state.status='EXECUTED_PENDING_INDEPENDENT_REVIEW';state.completedAt=new Date().toISOString();state.fullAcceptancePassed=false;
  // Root independently opens/render-checks all retained PDFs and evidence. A driver never signs its own result.
}
