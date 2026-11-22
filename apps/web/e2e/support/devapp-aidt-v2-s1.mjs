/** S1 retains the existing dynamic review protocol; a fixed second prompt is never a student's response. */
import { ProbeFailure } from './devapp-aidt-auth-readonly.mjs';
import { aidtS1Question, requireAcceptedS1Feedback, assertSavedAidtS1NativeDraft, runAidtS1NativeRevision, assertSavedAidtS1Revision, assertAidtS1Handoff } from './devapp-aidt-journey.mjs';
import { V2_SYNTHETIC } from './devapp-aidt-v2-ui.mjs';
const fail=code=>{throw new ProbeFailure(code);};
export async function runV2S1({ui,report,teachingFeedback,reviewS1StudentResponse,capture,printFormal}) {
  const {page,expect,btn,click,fill,go,stage,save,refresh,notCompleted}=ui;
  if(typeof reviewS1StudentResponse!=='function')fail('S1_I3_STUDENT_RESPONSE_REVIEW_REQUIRED');
  await go(1);const directoryBefore=await stage(1);
  await click(page.getByTestId('aidt-new-entity-card'));let dialog=page.getByRole('dialog',{name:'新建问题',exact:true});
  await expect(dialog).toBeVisible();await fill('问题名称','取消不得创建',dialog);await click(btn('取消',dialog));await ui.unchanged(1,directoryBefore);
  await click(page.getByTestId('aidt-new-entity-card'));dialog=page.getByRole('dialog',{name:'新建问题',exact:true});
  const name='QA合成命题 '+ui.scope.runId;await fill('问题名称',name,dialog);
  const base=`/api/projects/${ui.scope.projectId}/aidt/stages/1`;
  await save(1,()=>click(btn('创建问题',dialog)),{uiAction:{actionId:'s1-normal-create-problem',steps:[
    {operationId:'s1-problem-main-create',kind:'write',requestKind:'stage-save',stageId:1,entityRole:'problem-main',method:'PUT',path:base,captureEntity:{prefix:'problemEntity:',nameField:'title',expectedName:name,priorIds:Object.keys(directoryBefore?.content?.draft?.fields??{}).filter(key=>key.startsWith('problemEntity:')).map(key=>key.slice('problemEntity:'.length))}},
    {operationId:'s1-problem-main-entity-thread-initial',kind:'write',requestKind:'entity-thread',stageId:1,entityRole:'problem-main',entityId:'{createdEntity}',method:'PUT',path:base+'/entities/{createdEntity}/thread',captureThread:true},
    {operationId:'s1-problem-main-thread-mount',kind:'write',requestKind:'thread-mount',stageId:1,entityRole:'problem-main',entityId:'{createdEntity}',method:'POST',path:'/api/threads/{createdThread}/skill-mounts'},
    {operationId:'s1-problem-main-initial-reconcile',kind:'write',requestKind:'reconcile-entity',stageId:1,entityRole:'problem-main',entityId:'{createdEntity}',method:'POST',path:base+'/entities/{createdEntity}/reconcile'},
  ]}});
  await page.waitForURL(url=>url.searchParams.get('step')==='1'&&url.searchParams.get('entity')&&url.searchParams.get('thread')?.startsWith('thr'));
  const target=ui.route(1),initialRevision=(await stage(1)).revision;
  const initial=`${V2_SYNTHETIC}。我们希望了解校园午休时赶课与闲暇两种情境，怎样影响学生购买新饮品时的犹豫。我们自己觉得值得研究，因为想了解这种犹豫是否占用有限午休；目前问题来源仅为猜测，并没有真实观察/访谈，不确定原因和普遍性。暂定用户是在食堂选饮品的同学，场景是午休购买。请先帮助我们澄清一个模糊处并追问，不替我们做决定，不保存确认。`;
  await requireAcceptedS1Feedback(()=>teachingFeedback(1,initial));
  const q=aidtS1Question(report.teachingEvidence,{...ui.scope,entityId:target.entityId,threadId:target.threadId,prompt:initial,revision:initialRevision,checkpoint:'teaching-chat-stage-1'});
  await expect.poll(async()=>{const saved=await stage(1);let fields;try{fields=JSON.parse(saved.content.draft.fields['problemDraft:'+target.entityId]);}catch{}return fields?.draftTurnId===q.assistantMessageId&&!!fields.initial?.trim();},{timeout:30000}).toBe(true);
  const original=assertSavedAidtS1NativeDraft(await stage(1),q);
  await notCompleted(1);await ui.outcome(target,{role:'problem-main',phase:'initial-outcome'});await expect(page.getByTestId('aidt-stage-output')).toContainText(original.fields.initial);
  let second;
  const revised=await runAidtS1NativeRevision({question:q,original,reviewStudentResponse:reviewS1StudentResponse,
    sendStudentResponse:prompt=>teachingFeedback(1,prompt),
    readReply:async prompt=>{second=aidtS1Question(report.teachingEvidence,{...ui.scope,entityId:target.entityId,threadId:target.threadId,prompt,revision:original.revision,checkpoint:'teaching-chat-stage-1-revision'});return second;},
    readSaved:async()=>{await expect.poll(async()=>{const saved=await stage(1);let fields;try{fields=JSON.parse(saved.content.draft.fields['problemDraft:'+target.entityId]);}catch{}return saved.revision>original.revision&&fields?.draftTurnId===second?.assistantMessageId;},{timeout:30000}).toBe(true);return stage(1);},
    reload:()=>ui.outcome(target,{role:'problem-main',phase:'draft-reentry'}),assertUi:async value=>{await expect(page.getByTestId('aidt-stage-output')).toContainText(value.fields.initial);await expect(page.getByTestId('aidt-stage-output')).toContainText(value.fields.rewrittenTheme);}});
  // Review is still required and tied to the actual first question/run; no canned review object is supplied.
  const candidate=await ui.selectCandidate({stageId:1,host:page.getByRole('region',{name:'聚焦本轮研究命题',exact:true}),actionLabel:'AI 提供命题候选',adoptLabel:'采用到草稿',editRegion:'命题候选的可编辑草稿',editLabel:'学生重写命题',editText:revised.draft.fields.rewrittenTheme,
    editExtra:local=>fill('本轮选择的研究方向','午休情境与饮品选择的犹豫',local),saveLabel:'保存本步草稿',operationId:'s1-problem-main-problem-candidate',saveOperationId:'s1-problem-main-candidate-save',saveRole:'problem-main',refreshPhase:'candidate-refresh'});
  const beforeConfirm=await stage(1);await refresh(1,{expectedRevision:beforeConfirm.revision,navigation:{role:'problem-main',phase:'before-confirm-refresh'}});
  const review=page.getByRole('region',{name:'对话中的成果确认',exact:true});
  await expect(review).toBeVisible();
  const confirmation=await save(1,()=>click(btn('确认本轮成果并保存',review)),{confirmation:true,operationId:'s1-problem-main-confirm',entityRole:'problem-main',entityId:target.entityId});
  await expect(review).toContainText('本轮成果已确认并保存');
  const expectedBefore=JSON.parse(beforeConfirm.content.draft.fields['problemDraft:'+target.entityId]);
  const confirmedRevision=assertSavedAidtS1Revision(confirmation.stage,{projectId:ui.scope.projectId,entityId:target.entityId,revision:beforeConfirm.revision,fields:expectedBefore},{confirmed:true});
  const record=JSON.parse(confirmation.stage.content.draft.fields['problemDraft:'+target.entityId]);
  const confirmed={entityId:target.entityId,revision:confirmedRevision,rewrittenTheme:record.rewrittenTheme};
  const next=assertAidtS1Handoff(await review.getByRole('link',{name:'继续第2步',exact:true}).getAttribute('href'),{origin:ui.origin,projectId:ui.scope.projectId},confirmed);
  await ui.completed(1);await ui.outcome(target,{role:'problem-main',phase:'formal-outcome'});await capture('v2-s1-confirmed-problem-reflection',1);
  await printFormal({stage:1,name:'confirmed-problem-reflection',entityId:target.entityId,button:btn('打印',page.getByTestId('aidt-stage-output')),requiredTexts:[record.initial,record.rewrittenTheme],sourceRevision:confirmedRevision});
  return {target,name,initialQuestion:q,reviewed:revised.review,candidate,confirmed,next,createdInThisRun:true,projectId:ui.scope.projectId};
}
