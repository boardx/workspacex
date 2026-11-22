/** Native Survey and User Research are exercised through their real UI, never API-seeded answers. */
import { createHash } from 'node:crypto';
import { ProbeFailure } from './devapp-aidt-auth-readonly.mjs';
const fail=code=>{throw new ProbeFailure(code);};
export async function runV2SurveyResearch({ui,testTarget,runNativeOperation,createSurveyParticipant,readSurveyReceipt,capture,armSurvey,runV2UIAction,surveyPublication,printFormal}) {
  const {page,expect,btn,click,stage}=ui;await ui.navigate(testTarget,{role:testTarget.role,phase:'research-entry'});if(typeof armSurvey!=='function')fail('V2_SURVEY_EXPLICIT_GUARD_REQUIRED');armSurvey(testTarget.entityId);
  await ui.expand('根据原型准备调查问卷');
  const proposal=page.getByRole('region',{name:'AI 问卷生成',exact:true});
  const requirements=page.getByLabel('问卷需求',{exact:true});await expect(requirements).toBeEditable();
  const initial=await requirements.inputValue();
  if(!initial.includes(testTarget.versionId)||!initial.includes('固定原型'))fail('V2_SURVEY_FIXED_PROTOTYPE_CONTEXT_MISSING');
  await requirements.fill(initial+'\n软件QA合成测试：只需三个明确且可填写的问题：一个短文本、一个单选、一个体验障碍长文本；不要求真实身份信息。');
  await runNativeOperation({operationId:'s6-test-survey-markdown-proposal',kind:'research',stage:6,entityRole:'test-survey',entityId:testTarget.entityId,perform:()=>click(btn('生成问卷',proposal))});
  const dialog=page.getByRole('dialog',{name:'Markdown 预览与校对',exact:true});await expect(dialog).toBeVisible();
  const markdown=dialog.getByLabel('AI 提案 Markdown',{exact:true});await expect(markdown).toBeEditable();
  const generatedMarkdown=await markdown.inputValue();if(!generatedMarkdown.includes('#'))fail('V2_SURVEY_REAL_MARKDOWN_REQUIRED');
  const before=await stage(6);await ui.unchanged(6,before);const group=JSON.parse(before.content.draft.fields['testGroup:'+testTarget.entityId]);
  // A student explicitly reviews the genuine proposal into three open questions; no option-count/privacy shortcut.
  const reviewedQuestions=['请描述你首先看到的等候信息，以及准备怎样选择。','比较其他选择或返回时，哪里不清楚？请描述具体一步。','本次软件测试流程还有哪些未确定之处？'];
  const reviewedMarkdown=`# ${group.name}\n\n合成软件QA，非真人研究。固定原型 ${testTarget.versionId}；第5步 V${testTarget.stage5Revision}。\n`+reviewedQuestions.map((question,index)=>`\n## Q${index+1} [open, required]\n${question}\n`).join('');
  await markdown.fill(reviewedMarkdown);await ui.unchanged(6,before);
  const actualPreview=dialog.getByRole('region',{name:'AI 题目预览',exact:true});await expect(actualPreview.getByRole('heading',{level:2})).toBeVisible();for(const question of reviewedQuestions)await expect(actualPreview).toContainText(question);
  const proposalReview={actualModelDraftSha256:createHash('sha256').update(generatedMarkdown).digest('hex'),studentReviewedDraftSha256:createHash('sha256').update(reviewedMarkdown).digest('hex'),questionTypes:['open','open','open'],reviewedBeforeApply:true};
  if(typeof runV2UIAction!=='function')fail('V2_SURVEY_CLOSED_UI_ACTION_REQUIRED');
  await runV2UIAction({actionId:'s6-test-survey-apply-native-draft',steps:[
    {operationId:'s6-test-survey-native-create',kind:'survey',requestKind:'survey-create',stageId:6,entityRole:'test-survey',entityId:testTarget.entityId,method:'POST',path:'/api/surveys',expectedFields:{title:group.name},captureResource:{nameField:'title',expectedName:group.name}},
    {operationId:'s6-test-survey-native-save-source',kind:'survey',requestKind:'survey-source',stageId:6,entityRole:'test-survey',entityId:testTarget.entityId,resourceId:'{createdResource}',method:'PUT',path:'/api/surveys/{createdResource}/source'},
    {operationId:'s6-test-survey-native-link',kind:'survey',requestKind:'survey-link',stageId:6,entityRole:'test-survey',entityId:testTarget.entityId,resourceId:'{createdResource}',method:'POST',path:`/api/projects/${ui.scope.projectId}/resources`},
    {operationId:'s6-test-survey-source-binding',kind:'write',requestKind:'stage-save',stageId:6,entityRole:'test-survey',entityId:testTarget.entityId,method:'PUT',path:`/api/projects/${ui.scope.projectId}/aidt/stages/6`},
  ],perform:()=>click(btn('应用到问卷',dialog))});
  // Linking the actual draft and saving the test source remain distinct observed operations.
  await expect(page.getByRole('link',{name:'打开问卷发布',exact:true})).toBeVisible();
  const publishLink=page.getByRole('link',{name:'打开问卷发布',exact:true});const href=new URL(await publishLink.getAttribute('href'),ui.origin);
  if(href.origin!==ui.origin||!/^\/studio\/survey\/[^/]+\/publish$/.test(href.pathname))fail('V2_SURVEY_NATIVE_PUBLISH_ROUTE_REQUIRED');
  const [studio]=await Promise.all([page.waitForEvent('popup'),publishLink.click({modifiers:['Control']})]);
  try{
    await expect(studio).toHaveURL(href.href);
    await runNativeOperation({operationId:'s6-test-survey-native-publish',kind:'survey',stage:6,entityRole:'test-survey',entityId:testTarget.entityId,perform:()=>studio.getByRole('button',{name:'开始回收',exact:true}).click()});
    await expect(studio.getByRole('button',{name:'停止回收',exact:true})).toBeVisible();
    await click(btn('刷新答卷'));
    const responseLink=page.getByRole('link',{name:'打开填写链接',exact:true});await expect(responseLink).toBeVisible();
    const responseHref=await responseLink.getAttribute('href');
    if(typeof createSurveyParticipant!=='function')fail('V2_SURVEY_PARTICIPANT_SCOPE_GUARD_REQUIRED');
    if(typeof surveyPublication!=='function')fail('V2_ACTUAL_SURVEY_PUBLICATION_RECEIPT_REQUIRED');
    const publication=surveyPublication();if(!publication?.surveyId||!publication.version||!publication.questionsSha256)fail('V2_FROZEN_SURVEY_PUBLICATION_REQUIRED');
    const responses=[];
    // Eight is this bounded synthetic QA scenario, not a V2 interview-person requirement.
    for(let ordinal=1;ordinal<=8;ordinal++){
      const respondent=await createSurveyParticipant(responseHref);
      try{
        const form=respondent.page??respondent,answers=new Map();
        for(let index=0;index<4;index++){
          const fields=form.locator('fieldset[id^="answer-"]');await expect(fields.first()).toBeVisible();
          for(const field of await fields.all()){
            if(!await field.isVisible())continue;const id=(await field.getAttribute('id')).slice(7),text=field.getByRole('textbox'),radios=field.getByRole('radio'),select=field.getByRole('combobox');
            if(await text.count()===1){const value=`合成软件QA答卷${ordinal}：能理解等待信息，但返回比较入口还需要更明显。`;await text.fill(value);answers.set(id,value);}
            else if(await radios.count()){await radios.first().check();answers.set(id,await radios.first().inputValue());}
            else if(await select.count()===1){const value=await select.locator('option').nth(1).getAttribute('value');if(!value)fail('V2_SURVEY_VISIBLE_OPTION_REQUIRED');await select.selectOption(value);answers.set(id,value);}
            else fail('V2_SURVEY_UNPLANNED_PUBLIC_QUESTION_TYPE');
          }
          const submit=form.getByRole('button',{name:'提交答卷',exact:true});if(await submit.isVisible())break;
          const next=form.getByRole('button',{name:'下一页',exact:true});await expect(next).toBeVisible();await next.click();
        }
        if(answers.size<1||answers.size>24)fail('V2_SURVEY_UI_ANSWERS_BOUND');
        await runNativeOperation({operationId:`s6-test-survey-native-participant-submit-${String(ordinal).padStart(2,'0')}`,kind:'survey',stage:6,entityRole:'test-survey',entityId:testTarget.entityId,expectedFields:{answers:[...answers].map(([questionId,value])=>({questionId,value})),surveyPublication:publication},perform:()=>form.getByRole('button',{name:'提交答卷',exact:true}).click()});
        await expect(form.getByText('提交成功，感谢您的参与。',{exact:true})).toBeVisible();
        const actual=readSurveyReceipt();if(!actual?.responseId||responses.some(row=>row.responseId===actual.responseId))fail('V2_SURVEY_FRESH_ACTUAL_RESPONSE_REQUIRED');responses.push({ordinal,responseId:actual.responseId,actualUiSubmission:true});
      }finally{await respondent.close();}
    }
    // Use the real native report compiler, after a normal UI refresh observes the eight submitted rows.
    await studio.getByRole('button',{name:'更多操作',exact:true}).click();let nativeRead;[nativeRead]=await Promise.all([studio.waitForResponse(response=>response.request().method()==='GET'&&new URL(response.url()).pathname===`/api/surveys/${publication.surveyId}`,{timeout:30000}),studio.getByRole('button',{name:'刷新',exact:true}).click()]);
    if(nativeRead.status()!==200)fail('V2_SURVEY_FRESH_REPORT_BASIS_READ_REQUIRED');const reportBasis=await nativeRead.json();
    if(reportBasis.id!==publication.surveyId||!Number.isSafeInteger(reportBasis.version)||reportBasis.responses?.length!==8||responses.some(row=>!reportBasis.responses.some(actual=>actual.id===row.responseId&&actual.quality==='normal'&&actual.analysis!=='excluded'))||!Array.isArray(reportBasis.publication?.questions)||reportBasis.publication.questions.filter(question=>!['description','page_break'].includes(question.type)).length!==3||reportBasis.publication.questions.filter(question=>!['description','page_break'].includes(question.type)).some(question=>question.type!=='open'))fail('V2_SURVEY_EIGHT_ACTUAL_OPEN_RESPONSE_BASIS_REQUIRED');
    await studio.getByRole('button',{name:'更多操作',exact:true}).click();await studio.getByRole('button',{name:'分析报告（可选）',exact:true}).click();await expect(studio.getByRole('heading',{name:'分析报告',exact:true})).toBeVisible();
    let reportResponse;await ui.performAction({actionId:'s6-test-survey-compile-current-report',steps:[{operationId:'s6-test-survey-native-report',kind:'write',requestKind:'survey-report',stageId:6,entityRole:'test-survey',entityId:testTarget.entityId,resourceId:publication.surveyId,expectedFields:{expectedVersion:reportBasis.version},method:'POST',path:`/api/surveys/${publication.surveyId}/report`}],perform:async()=>{[reportResponse]=await Promise.all([studio.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname===`/api/surveys/${publication.surveyId}/report`,{timeout:30000}),studio.getByRole('button',{name:'生成报告',exact:true}).click()]);}});
    if(![200,201].includes(reportResponse?.status()))fail('V2_SURVEY_ACTUAL_REPORT_COMPILE_REQUIRED');const actualReport=await reportResponse.json();
    if(actualReport.id!==publication.surveyId||actualReport.version!==reportBasis.version+1||actualReport.reportBasisVersion!==actualReport.version-1||actualReport.reportBasisAnswerRevision!==actualReport.answerRevision||!actualReport.report?.sections?.length||!Number.isSafeInteger(actualReport.report.sampleSummary?.included)||actualReport.report.sampleSummary.included!==8||actualReport.report.issues?.length||actualReport.report.sections.some(section=>section.blocks.some(block=>block.issues?.length||block.rows?.some(row=>row.count<8)||block.answerTexts&&block.answerTexts.length<8)))fail('V2_SURVEY_GENERATED_REPORT_NOT_CURRENT_OR_SHAREABLE');
    await expect(studio.getByTestId('survey-report-share-privacy-warning')).toHaveCount(0);
    await click(btn('刷新答卷'));const receipt=readSurveyReceipt();
    if(!receipt?.id||!receipt.responseId)fail('V2_SURVEY_ACTUAL_RESPONSE_RECEIPT_REQUIRED');
    const selected=await ui.save(6,()=>page.getByRole('combobox',{name:'选择本测试的答卷证据',exact:true}).selectOption(receipt.responseId),{uiAction:{actionId:'s6-test-survey-select-actual-response',steps:[{operationId:'s6-test-survey-native-select-response',kind:'survey',requestKind:'stage-save',stageId:6,entityRole:'test-survey',entityId:testTarget.entityId,method:'PUT',path:`/api/projects/${ui.scope.projectId}/aidt/stages/6`}]}});
    await ui.refresh(6,{expectedRevision:selected.receipt.revision,navigation:{role:'test-survey',phase:'survey-source-refresh'}});await capture('v2-s6-survey-real-ui-response-bound',6);
    await printFormal({stage:6,name:'survey-native-questionnaire',entityId:testTarget.entityId,button:btn('打印调查问卷'),requiredTexts:[group.name],sourceRevision:selected.receipt.revision});
    await printFormal({stage:6,name:'survey-native-response-report',entityId:testTarget.entityId,button:btn('打印答卷与调查报告'),requiredTexts:[group.name],sourceRevision:selected.receipt.revision});
    return {...receipt,responses,publication,proposalReview,actualReport:{version:actualReport.version,reportBasisVersion:actualReport.reportBasisVersion,answerRevision:actualReport.answerRevision,included:actualReport.report.sampleSummary.included,compiledViaNormalUI:true},sourceRevision:selected.receipt.revision,publishedViaUI:true,submittedViaUI:true};
  }finally{await studio.close();}
}

export async function runV2VirtualResearch({ui,testTarget,runNativeOperation,capture,readResearchDocument,printFormal}) {
  const {page,expect,btn,click,stage}=ui;await ui.navigate(testTarget,{role:testTarget.role,phase:'research-entry'});
  const panel=page.getByRole('region',{name:'虚拟用户研究',exact:true});await expect(panel).toContainText('模拟');
  const base=`/api/projects/${ui.scope.projectId}/aidt/stages/6`,group=JSON.parse((await stage(6)).content.draft.fields['testGroup:'+testTarget.entityId]);
  await ui.performAction({actionId:'s6-test-virtual-normal-bootstrap',steps:[
    {operationId:'s6-test-virtual-native-create',kind:'write',requestKind:'research-create',stageId:6,entityRole:'test-virtual',entityId:testTarget.entityId,method:'POST',path:'/api/interviews/digital',captureResource:{idField:'interviewId',nameField:'name',expectedName:(group.name||'原型虚拟用户研究').slice(0,120)}},
    {operationId:'s6-test-virtual-native-initialize',kind:'write',requestKind:'research-initialize',stageId:6,entityRole:'test-virtual',entityId:testTarget.entityId,resourceId:'{createdResource}',method:'POST',path:'/api/interviews/digital/{createdResource}/markdown/initialize',parallelGroup:'virtual-bootstrap'},
    {operationId:'s6-test-virtual-native-save-intake',kind:'write',requestKind:'research-save',stageId:6,entityRole:'test-virtual',entityId:testTarget.entityId,resourceId:'{createdResource}',method:'POST',path:'/api/interviews/digital/{createdResource}/markdown/intake',parallelGroup:'virtual-bootstrap'},
    {operationId:'s6-test-virtual-native-source-binding',kind:'write',requestKind:'stage-save',stageId:6,entityRole:'test-virtual',entityId:testTarget.entityId,method:'PUT',path:base,parallelGroup:'virtual-bootstrap'},
  ],perform:()=>click(btn('创建虚拟研究草稿',panel))});
  const bootstrap=JSON.parse((await stage(6)).content.draft.fields['testGroup:'+testTarget.entityId]),researchId=bootstrap.source?.kind==='interview'&&bootstrap.source.id;if(!researchId)fail('V2_NATIVE_RESEARCH_SOURCE_NOT_SAVED');
  const researchPath='/api/interviews/digital/'+encodeURIComponent(researchId)+'/markdown';
  const writeStep=(suffix,path)=>({operationId:'s6-test-virtual-'+suffix,kind:'write',requestKind:path.endsWith('/confirm')?'research-confirm':'research-save',stageId:6,entityRole:'test-virtual',entityId:testTarget.entityId,resourceId:researchId,method:'POST',path:researchPath+path});
  const model=(operationId,perform,expectedFields)=>runNativeOperation({operationId,kind:'research',stage:6,entityRole:'test-virtual',entityId:testTarget.entityId,resourceId:researchId,...(expectedFields?{expectedFields}:{}),perform});
  const edit=panel.getByRole('link',{name:'编辑需求',exact:true});await expect(edit).toBeVisible();
  const destination=new URL(await edit.getAttribute('href'),ui.origin);
  if(destination.origin!==ui.origin||!destination.pathname.startsWith('/itv/'))fail('V2_NATIVE_RESEARCH_ROUTE_REQUIRED');
  const [research]=await Promise.all([page.waitForEvent('popup'),edit.click()]);
  try{
    const intake=research.getByRole('textbox',{name:'研究需求 Markdown',exact:true});await expect(intake).toBeVisible();
    const before=await intake.inputValue();if(!before.includes(testTarget.versionId)||!before.includes('模拟'))fail('V2_VIRTUAL_FIXED_CONTEXT_MISSING');
    await intake.fill(before+'\n\n软件QA：仅选择一个虚拟参与者进行一轮模拟，聚焦返回比较入口。所有结论必须标模拟并引用具体对话原段，不冒充真实用户。');
    await ui.performAction({actionId:'s6-test-virtual-intake-to-analysis',timeoutMs:360000,steps:[writeStep('native-edit-intake','/intake'),writeStep('native-confirm-intake','/intake/confirm')],perform:()=>model('s6-test-virtual-analysis',()=>research.getByRole('button',{name:'下一步：确认分析',exact:true}).click())});
    await expect(research.getByTestId('itv-workbench-step-analysis')).toHaveAttribute('aria-current','step');
    await ui.performAction({actionId:'s6-test-virtual-confirm-analysis',steps:[writeStep('native-confirm-analysis','/analysis/confirm')],perform:()=>research.getByRole('button',{name:'选择专家',exact:true}).click()});
    const experts=research.getByTestId('itv-workbench-step-experts');await expect(experts).toHaveAttribute('aria-current','step');
    // Normal UI determines the actual expert generation; no hidden state or synthetic response is injected.
    const removals=research.getByRole('button',{name:/^移除专家 /});const originalSelectionCount=await removals.count();if(originalSelectionCount>20)fail('V2_VIRTUAL_EXISTING_EXPERT_SELECTION_BOUND');for(let index=0;index<originalSelectionCount;index++)await removals.first().click();await expect(removals).toHaveCount(0);
    const profile=research.locator('[data-testid^="itv-persona-card-"]').first();
    await expect(profile).toBeVisible();await expect(profile).toContainText('模拟');
    await profile.getByRole('button').click();
    await expect(profile).toHaveAttribute('data-selected','true');const selectedExpert=(await profile.getAttribute('data-testid')).slice('itv-persona-card-'.length);if(!selectedExpert||await research.locator('[data-testid^="itv-persona-card-"][data-selected="true"]').count()!==1)fail('V2_VIRTUAL_EXACT_ONE_SIMULATED_EXPERT_REQUIRED');
    await ui.performAction({actionId:'s6-test-virtual-expert-to-outline',timeoutMs:360000,steps:[writeStep('native-save-experts','/experts'),writeStep('native-confirm-experts','/experts/confirm')],perform:()=>model('s6-test-virtual-outline',()=>research.getByRole('button',{name:'确认专家并生成问题',exact:true}).click())});
    const planned=await readResearchDocument(),expertsDoc=planned.documents.find(doc=>doc.step==='experts'),expertIds=[...new Set([...String(expertsDoc?.markdown??'').matchAll(/\]\(#expert-([A-Za-z0-9_-]+)\)/g)].map(match=>match[1]))];if(planned.interviewId!==researchId||expertIds.length!==1||expertIds[0]!==selectedExpert)fail('V2_VIRTUAL_EXPERT_COUNT_NOT_ONE_SAVED');
    const outline=research.getByTestId('itv-markdown-outline');await expect(outline).toBeVisible();
    const question=outline.getByRole('textbox').first();await expect(question).toBeEditable();
    const actualQuestion=await question.inputValue();await question.fill(actualQuestion+'（请以具体步骤说明）');
    await ui.performAction({actionId:'s6-test-virtual-save-edited-outline',steps:[writeStep('native-save-outline','/outline')],perform:()=>research.getByRole('button',{name:'保存问题草稿',exact:true}).click()});
    await ui.performAction({actionId:'s6-test-virtual-confirm-outline-and-one-batch',timeoutMs:360000,steps:[writeStep('native-confirm-outline','/outline/confirm')],perform:()=>model('s6-test-virtual-runs',()=>research.getByRole('button',{name:'确认问题并开始访谈',exact:true}).click(),{action:'start'})});
    const executed=await readResearchDocument();if(executed.interviewId!==researchId||executed.execution?.status!=='completed'||executed.execution.tasks?.length!==1||executed.execution.tasks[0].expertId!==selectedExpert||executed.execution.tasks[0].status!=='completed')fail('V2_VIRTUAL_SINGLE_START_DID_NOT_COMPLETE_NO_REPLAY');const runsDoc=executed.documents.find(doc=>doc.step==='runs');if(!runsDoc||!executed.states.some(state=>state.documentId===runsDoc.documentId&&state.status==='completed'))fail('V2_VIRTUAL_COMPLETED_RUNS_SOURCE_REQUIRED');
    await expect(research.getByTestId('itv-workbench-step-runs')).toHaveAttribute('aria-current','step');
    await model('s6-test-virtual-report',()=>research.getByRole('button',{name:'继续生成报告',exact:true}).click());
    await expect(research.getByTestId('itv-source-report')).toBeVisible();
    const native=await readResearchDocument();
    if(!native?.documents?.some(doc=>doc.step==='runs'&&doc.markdown?.trim())||!native.documents.some(doc=>doc.step==='report'&&doc.markdown?.trim()))fail('V2_NATIVE_SIMULATED_DOCUMENTS_REQUIRED');
  }finally{await research.close();}
  await click(btn('刷新研究成果',panel));const bound=await ui.save(6,()=>click(btn('绑定已保存的研究报告',panel)),{operationId:'s6-test-virtual-bind-report',entityRole:'test-virtual',entityId:testTarget.entityId});
  await ui.refresh(6,{expectedRevision:bound.receipt.revision,navigation:{role:'test-virtual',phase:'virtual-bound-refresh'}});
  await ui.expand('逐条核对并整理模拟段落',panel);
  const paragraphs=panel.locator('article[id^="aidt-virtual-"]');await expect(paragraphs.first()).toBeVisible();
  if(await paragraphs.count()<1)fail('V2_SIMULATED_SOURCE_PARAGRAPH_REQUIRED');
  await ui.save(6,()=>click(btn('功能反馈',paragraphs.first())),{operationId:'s6-test-virtual-classify-function',entityRole:'test-virtual',entityId:testTarget.entityId});
  await ui.save(6,()=>click(btn('用户需求',paragraphs.last())),{operationId:'s6-test-virtual-classify-need',entityRole:'test-virtual',entityId:testTarget.entityId});
  const backs=panel.getByRole('link',{name:'回到模拟对话原段',exact:true});await expect.poll(()=>backs.count()).toBeGreaterThan(0);
  const refs=[];
  for(const link of await backs.all()){
    const href=await link.getAttribute('href');if(!href?.startsWith('#aidt-virtual-'+testTarget.entityId+'-'))fail('V2_SIMULATED_SOURCE_ANCHOR_WRONG_ENTITY');
    await link.click();const id=href.slice(1);const original=page.locator('[id="'+id+'"]');await expect(original).toBeVisible();
    const quoted=await original.locator('blockquote').innerText();if(!quoted.trim())fail('V2_SIMULATED_SOURCE_PARAGRAPH_EMPTY');
    refs.push({anchor:id,quoteLength:quoted.length,actuallyClicked:true});
  }
  for(const [step,summary,label]of [['outline','查看模拟访谈大纲','预览与打印模拟大纲'],['runs','查看模拟访谈对话','预览与打印模拟对话'],['report','查看模拟研究报告','预览与打印模拟报告']]){
    await ui.expand(summary,panel);await printFormal({stage:6,name:'virtual-native-'+step,entityId:testTarget.entityId,button:btn(label,panel),requiredTexts:['模拟',testTarget.versionId],sourceRevision:(await stage(6)).revision});
  }
  await capture('v2-s6-virtual-functional-needs-original-paragraphs',6);
  const latest=await stage(6);return {revision:latest.revision,refs,simulated:true,realHumanValidation:false};
}
