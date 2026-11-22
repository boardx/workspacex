/** Real V2 UI orchestration. A checkpoint is diagnostic evidence; only the independent case ledger can pass acceptance. */
import { createHash } from 'node:crypto';
import { ProbeFailure } from './devapp-aidt-auth-readonly.mjs';
import { schematicPng } from './devapp-aidt-journey.mjs';
import { createV2UI } from './devapp-aidt-v2-ui.mjs';
import { runV2S1 } from './devapp-aidt-v2-s1.mjs';
import { runV2S2SyntheticAsr } from './devapp-aidt-v2-s2-asr.mjs';
import { runV2S2 } from './devapp-aidt-v2-s2.mjs';
import { runV2S3 } from './devapp-aidt-v2-s3.mjs';
import { runV2BrainstormMethods, completeV2IdeaSheets, readV2FrozenRound } from './devapp-aidt-v2-s4.mjs';
import { prepareV2TextPrototype, saveV2UnconfirmedV3, assertV2FrozenTextLink } from './devapp-aidt-v2-s5.mjs';
import { produceV2PrototypeVersions } from './devapp-aidt-v2-design.mjs';
import { runV2CandidateCancellation } from './devapp-aidt-v2-negative-candidates.mjs';
import { runV2CreateCancellationCase } from './devapp-aidt-v2-negative-dialogs.mjs';
import { runV2AccessibilityCase } from './devapp-aidt-v2-cases.mjs';
import { runV2CrudJourney, runV2CrudKind } from './devapp-aidt-v2-crud.mjs';
import { runV2GroupReport } from './devapp-aidt-v2-report.mjs';
const fail=code=>{throw new ProbeFailure(code);};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function runV2VoiceJourney(ports) {
  const {page,expect,scope,api,armStageSave,capture,checkpoint,report,ledger,runtimeScope,plan,registerFixture,teachingFeedback,observeNativeAction:baseObserveNativeAction,runNativeOperation,printFormal}=ports;
  if(!plan||plan.profile!=='v2-voice-20261122'||!ledger||typeof runtimeScope!=='function'||typeof armStageSave!=='function')fail('V2_PROFILE_PORTS_REQUIRED');
  const bound=runtimeScope();if(bound.projectId!==scope.projectId||bound.orgRole!=='consultant')fail('V2_OWNED_ORDINARY_SCOPE_REQUIRED');
  let ui;const cancelled=new Set();
  const cancelBefore=new Map([['s1-problem-main-problem-candidate',1],['s2-source-interview-finding-candidate',2],['s4-method-free-candidate',4],['s5-prototype-three-text-candidate',5],['s6-test-offline-plan-candidate',6]]);
  const observeNativeAction=async input=>{const stageId=cancelBefore.get(input.operationId);if(stageId&&!cancelled.has(stageId)){const target=ui.route(stageId),role=plan.operations.find(row=>row.id===input.operationId)?.entityRole;const receipt=await runV2CandidateCancellation({ui,stageId,ledger,runtimeScope,plan,capture,observeNativeAction:baseObserveNativeAction,managedRefresh:()=>ui.navigate(target,{role,phase:'candidate-cancel-refresh'})});cancelled.add(stageId);(report.v2CancelledCandidates??=[]).push(receipt);}return baseObserveNativeAction(input);};
  ui=createV2UI({page,expect,scope,read:api,armStageSave,capture,observeNativeAction,runV2UIAction:ports.runV2UIAction});
  report.v2Journey={profile:plan.profile,manifestSha256:plan.manifestSha256,source:bound.source,controlSource:bound.controlSource,tag:bound.tag,projectId:bound.projectId,
    startedAt:new Date().toISOString(),mainChain:{},diagnostics:[],coverageRule:'Each case remains NOT_RUN until its exact real actions/assertions/screenshots/readback are independently settled. A stage checkpoint does not pass its sibling cases.'};
  const state=report.v2Journey.mainChain;
  const phase=async(name,key,action)=>{let value;const ok=await checkpoint(name,async()=>{value=await action();state[key]={status:'EXECUTED',source:bound.source,controlSource:bound.controlSource,finishedAt:new Date().toISOString(),receiptSha256:digest(value)};});if(!ok){state[key]={status:'FAILED',lastCheckpoint:name};return null;}return value;};
  const s1=await phase('v2-s1-student-review-confirm','s1',()=>runV2S1({ui,report,teachingFeedback,reviewS1StudentResponse:ports.reviewS1StudentResponse,capture,printFormal}));
  if(!s1)return;
  await phase('v2-s1-keyboard-mobile','s1accessibility',()=>runV2AccessibilityCase({ui,stageId:1,ledger,runtimeScope,plan,capture}));
  const s2=await phase('v2-s2-sources-findings-consent','s2',()=>runV2S2({ui,s1,teachingFeedback,observeNativeAction,capture,printFormal,registerFixture,runSyntheticAsr:args=>runV2S2SyntheticAsr({...ports,...args,read:api,actorId:bound.actorId,capture,printFormal,registerFixture})}));
  if(!s2)return;
  await phase('v2-s2-keyboard-mobile','s2accessibility',()=>runV2AccessibilityCase({ui,stageId:2,ledger,runtimeScope,plan,capture}));
  const s3=await phase('v2-s3-actual-template-and-hmw','s3',()=>runV2S3({ui,s2,teachingFeedback,observeNativeAction,capture,printFormal,earlyCrud:args=>runV2CrudKind({...ports,...args,s1,s2,s3:{surprise:args.primary},context:ports.context,capture})}));
  if(!s3)return;
  await phase('v2-s3-keyboard-mobile','s3accessibility',()=>runV2AccessibilityCase({ui,stageId:3,ledger,runtimeScope,plan,capture}));
  const brainstorm=await phase('v2-s4-six-methods-real-context','s4methods',()=>runV2BrainstormMethods({ui,hmw:s3.hmw,teachingFeedback,capture,observeNativeAction,report}));
  if(!brainstorm)return;
  const uploadIdeaImage=async({target,ordinal})=>{
    await ui.expand('添加描述单配图');const png=schematicPng(String(scope.runId),ordinal),filename=`qa-${scope.runId}-idea-${ordinal}.png`;registerFixture({filename,bytes:png,mime:'image/png'});
    const host=page.getByTestId('aidt-research-material-control').filter({has:page.getByLabel('点子配图选择文件',{exact:true})});await expect(host).toHaveCount(1);
    await host.getByLabel('点子配图选择文件',{exact:true}).setInputFiles({name:filename,mimeType:'image/png',buffer:png});
    await ui.save(4,()=>ui.click(ui.btn('保存原始材料',host)));await expect(host).toContainText('原件已保存并回读');
    const saved=await ui.stage(4),ref=JSON.parse(saved.content.draft.fields['ideaFile:'+target.entityId]??'null');
    if(!ref||ref.projectId!==scope.projectId||ref.sha256!==createHash('sha256').update(png).digest('hex'))fail('V2_IDEA_REAL_IMAGE_READBACK_REQUIRED');
    return ref;
  };
  const sheetsA=await phase('v2-s4-round-a-formal-sheets','s4roundA',()=>completeV2IdeaSheets({ui,brainstorm:brainstorm.methods.find(row=>row.method==='free'),uploadIdeaImage,teachingFeedback,capture,printFormal,round:'a'}));
  if(!sheetsA)return;
  const sheetsB=await phase('v2-s4-round-b-formal-sheets','s4roundB',()=>completeV2IdeaSheets({ui,brainstorm:brainstorm.methods.find(row=>row.method==='reverse'),uploadIdeaImage,teachingFeedback,capture,printFormal,round:'b'}));
  if(!sheetsB)return;
  expect(readV2FrozenRound(await ui.stage(4),{projectId:scope.projectId,sessionId:sheetsA.sessionId})).toEqual(sheetsA.snapshot);
  // The product's exact per-session frozen handoff is required. Current/latest global state is not a substitute.
  if(typeof sheetsA.sessionId!=='string'||typeof sheetsB.sessionId!=='string'||sheetsA.sessionId===sheetsB.sessionId)fail('V2_TWO_INDEPENDENT_FROZEN_ROUNDS_REQUIRED');
  const selectedSource=sheetsB;
  const single=await phase('v2-s5-single-idea-text-v2','s5single',()=>prepareV2TextPrototype({ui,ideaSheets:sheetsA,selectedIds:[sheetsA.ideas[0].id],role:'prototype-single',teachingFeedback,observeNativeAction,armDesignCreate:ports.armDesignCreate,capture,printFormal}));
  if(!single)return;
  const singleOutput=await phase('v2-s5-single-native-image','s5singleOutput',()=>produceV2PrototypeVersions({ui,prototype:single,runNativeOperation,read:api,armDesignImage:ports.armDesignImage,prepareSourceImages:ports.prepareSourceImages,capture,printFormal,kinds:['image'],completeStage:false}));
  if(!singleOutput)return;
  const primary=await phase('v2-s5-three-idea-text-v2','s5three',()=>prepareV2TextPrototype({ui,ideaSheets:selectedSource,selectedIds:selectedSource.ideas.map(row=>row.id),role:'prototype-three',teachingFeedback,observeNativeAction,armDesignCreate:ports.armDesignCreate,capture,printFormal}));
  if(!primary)return;
  const produced=await phase('v2-s5-actual-image-html-webapp','s5outputs',()=>produceV2PrototypeVersions({ui,prototype:primary,runNativeOperation,read:api,armDesignImage:ports.armDesignImage,prepareSourceImages:ports.prepareSourceImages,capture,printFormal}));
  if(!produced)return;
  // The remaining native handlers are loaded only after the same exact saved prototype exists.
  const {runV2S6Paths}=await import('./devapp-aidt-v2-s6.mjs');
  const tests=await phase('v2-s6-three-real-research-paths','s6',()=>runV2S6Paths({...ports,read:api,readSurveyReceipt:ports.surveyReceipt,actorId:bound.actorId,ui,prototype:{entityId:primary.target.entityId,designId:primary.target.entityId,versionId:produced.selected.versionId,stage5Revision:produced.stage5Revision,text:primary}}));
  if(!tests)return;
  const systemReport=await phase('v2-system-report-frozen-sources','report',()=>runV2GroupReport({...ports,ui,prototype:primary}));
  if(!systemReport)return;
  const v3=await phase('v2-s5-v3-does-not-rewrite-v2','v3',()=>saveV2UnconfirmedV3({ui,prototype:primary,capture}));
  if(!v3)return;
  const links=await phase('v2-frozen-v2-history-backlinks','frozenHistory',async()=>{
    const receipts=[];
    for(const record of [{target:primary.target,name:'prototype'},...(tests.receipts??[]).map(row=>({target:row.target,name:row.path})),{target:systemReport.target,name:'report'}]){
      const role=record.name==='prototype'?primary.role:record.name==='report'?'group-report':'test-'+record.name;
      await ui.navigate(record.target,{role,phase:record.name==='prototype'?'history-from-prototype':'historical-reentry',tool:record.name==='report'?'report':'outcome'});
      if(record.name==='prototype'){
        await ui.click(ui.btn('文字设计版本历史',page.getByTestId('aidt-prototype-text-design')));
        for(let pageIndex=0;pageIndex<8;pageIndex++){if(await page.locator(`a[href*="textRevision=${primary.v2Revision}"]`).count())break;const more=ui.btn('更多保存修订');if(await more.count()!==1||!await more.isEnabled())break;await ui.click(more);await expect(page.getByText('正在读取保存修订…',{exact:true})).toHaveCount(0);}
      }else if(record.name==='report'){
        await ui.expand('已确认版本与导出');await ui.click(ui.btn(`查看确认版 V${systemReport.confirmedRevision}`));const source5=systemReport.proof.sourceRevisions.find(row=>row.stageId===5);if(!source5)fail('V2_REPORT_FROZEN_STAGE5_SOURCE_REQUIRED');
        await ui.click(ui.btn(`查看第 5 步 V${source5.revision}`,page.getByRole('list',{name:'确认版本来源',exact:true})));
        const source=page.locator('[aria-label="来源版本详情"]');const entity=source.locator(`a[href*="step=5"][href*="entity=${primary.target.entityId}"][href*="entityRevision=${source5.revision}"]`);await expect(entity).toHaveCount(1);await entity.click();await expect(page.getByTestId('aidt-entity-history')).toBeVisible();
      }else{
        const evidence=ui.btn('查看被测原型依据');if(await evidence.count()===1)await ui.click(evidence);
      }
      const matches=page.locator(`a[href*="textRevision=${primary.v2Revision}"]`).filter({hasText:/V|文字设计/});await expect.poll(()=>matches.count()).toBeGreaterThan(0);const count=await matches.count();if(count>16)fail('V2_FROZEN_HISTORY_LINK_COUNT_BOUND');for(const match of await matches.all()){const href=new URL(await match.getAttribute('href'),ui.origin);if(href.origin!==ui.origin||href.pathname!==ui.projectPath||href.searchParams.get('entity')!==primary.target.entityId||href.searchParams.get('textRevision')!==String(primary.v2Revision))fail('V2_FROZEN_HISTORY_LINK_COORDINATES_CHANGED');}
      receipts.push(await assertV2FrozenTextLink({ui,link:matches.first(),prototype:primary,capture,name:`v2-history-${record.name}-retains-v2`}));
    }
    return receipts;
  });
  if(!links)return;
  await phase('v2-all-create-cancellation-variants','createCancel',()=>runV2CreateCancellationCase({ui,ledger,runtimeScope,plan,capture}));
  await phase('v2-all-owned-entity-crud','crud',()=>runV2CrudJourney({ui,s1,s2,s3,brainstorm,sheetsA,sheetsB,primary,produced,tests,context:ports.context,capture}));
  report.v2Journey.finishedAt=new Date().toISOString();report.v2Journey.physicalPrints=report.formalPrintChecks??[];
  // No blanket case promotion. Negative/permission/race/keyboard/CRUD assertions have their own cases.
  report.v2Journey.caseExecution=ledger.summary().cases;
}
