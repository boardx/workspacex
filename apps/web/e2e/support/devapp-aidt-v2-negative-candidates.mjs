/** Real candidate cancellation paths. Each dedicated cancelled run is distinct from the later positive run. */
import { ProbeFailure } from './devapp-aidt-auth-readonly.mjs';
import { beginV2Case, v2CaseHash } from './devapp-aidt-v2-cases.mjs';
const fail=code=>{throw new ProbeFailure(code);};
export const V2_CANDIDATE_CANCEL_PATHS=Object.freeze({
  1:{operationId:'s1-problem-main-candidate-cancel',host:'聚焦本轮研究命题',action:'AI 提供命题候选',adopt:'采用到草稿',editRegion:'命题候选的可编辑草稿',field:'学生重写命题',cancel:'保留已保存内容，放弃此草稿'},
  2:{operationId:'s2-source-interview-candidate-cancel',host:'AI 归纳发现',action:'AI 归纳发现',adopt:'填入草稿',editRegion:'独立 AI 表达草稿',field:'AI 辅助的一句发现',cancel:'保留原卡片，放弃此草稿'},
  4:{operationId:'s4-method-free-candidate-cancel',host:'按本轮方法拓展点子',action:'AI 提供点子候选',adopt:'采用到草稿',editRegion:'所选点子的可编辑草稿',field:'两三句核心说明',cancel:'放弃此草稿'},
  5:{operationId:'s5-prototype-three-candidate-cancel',host:'文字设计候选',action:'帮我整理文字设计',adopt:'采用为可编辑文字草稿',editRegion:'文字设计',field:'可编辑文字设计',cancel:null},
  6:{operationId:'s6-test-offline-plan-candidate-cancel',host:'研究前，完善测试问题',action:'请 AI 提供问题草稿',adopt:'采用到草稿',editRegion:'编辑 AI 测试草稿',field:'测试问题与任务',cancel:'取消，保留原内容'},
});
export function assertV2CancelRun(proof,{stageId,target}) {
  if(!proof?.runId||!proof?.assistantMessageId||proof.threadId!==target.threadId||!proof.sourceRevisions||!Object.keys(proof.sourceRevisions).length)fail('V2_CANCEL_REAL_BOUND_REPLY_REQUIRED');
  if(target.stageId!==stageId)fail('V2_CANCEL_ENTITY_STAGE_CHANGED');return true;
}
export async function runV2CandidateCancellation({ui,stageId,ledger,runtimeScope,plan,capture,observeNativeAction,managedRefresh,modelReceipt}) {
  const config=V2_CANDIDATE_CANCEL_PATHS[stageId];if(!config||typeof observeNativeAction!=='function')fail('V2_CANCEL_PATH_NOT_SUPPORTED');
  const ctx=await beginV2Case({caseId:`AI-S${stageId}-05`,stageId,ui,ledger,runtimeScope,plan,capture});
  try{
    const target=ui.route(stageId),host=ui.page.getByRole('region',{name:config.host,exact:true});await ui.expect(host).toBeVisible();
    if(!ctx.before.revision)fail('V2_CANCEL_EXISTING_STUDENT_DRAFT_REQUIRED');
    const proof=await ctx.action(()=>observeNativeAction({stageId,operationId:config.operationId,perform:()=>ui.click(ui.btn(config.action,host))}));
    assertV2CancelRun(proof,{stageId,target});ctx.record('native-response-bound',true,{runId:proof.runId,threadId:proof.threadId,messageId:proof.assistantMessageId,sourceRevisions:proof.sourceRevisions});
    const radios=host.getByRole('radio');await ui.expect.poll(()=>radios.count(),{timeout:30000}).toBeGreaterThan(0);
    const count=await radios.count();for(let i=0;i<count;i++)await ui.expect(radios.nth(i)).not.toBeChecked();
    await ui.expect(ui.btn(config.adopt,host)).toBeDisabled();ctx.record('candidate-not-preselected',true,{count,checked:0,adoptDisabled:true});
    await ctx.action(()=>radios.first().check());await ui.expect(radios.first()).toBeChecked();
    const replacement=host.getByRole('checkbox');const replacementCount=await replacement.count();if(replacementCount>1)fail('V2_CANCEL_REPLACEMENT_CONTROL_AMBIGUOUS');
    if(replacementCount){await ui.expect(ui.btn(config.adopt,host)).toBeDisabled();await ctx.action(()=>replacement.check());}
    await ui.unchanged(stageId,ctx.before);await ctx.action(()=>ui.click(ui.btn(config.adopt,host)));
    ctx.record('explicit-selection',true,{selectedIndex:0,replacementAcknowledged:replacementCount===1});
    const editor=ui.page.getByRole('region',{name:config.editRegion,exact:true});await ui.expect(editor).toBeVisible();
    const field=editor.getByLabel(config.field,{exact:true});await ui.expect(field).toBeEditable();
    const originalLocal=await field.inputValue(),edited='合成验收：此处为学生取消前的局部修改，不得写入正式成果。';
    await ctx.action(()=>field.fill(edited));await ui.expect(field).toHaveValue(edited);await ui.unchanged(stageId,ctx.before);
    ctx.record('editable-local-draft',originalLocal!==edited,{field:config.field,beforeHash:v2CaseHash(originalLocal),editedHash:v2CaseHash(edited),sharedRevision:ctx.before.revision});
    if(config.cancel){await ctx.action(()=>ui.click(ui.btn(config.cancel,editor)));await ui.expect(editor).not.toBeVisible();}
    else{await ctx.action(()=>ui.go(stageId));await ui.expect(editor).not.toBeVisible();}
    await ui.unchanged(stageId,ctx.before);
    ctx.record('cancel-preserves-saved-content',true,{stageId,entityId:target.entityId,threadId:target.threadId,revision:ctx.before.revision,contentSha256:v2CaseHash(ctx.before.content),siblingsCompared:true});
    const refresh=managedRefresh??(async()=>{await ui.go(stageId);await ui.page.reload({waitUntil:'domcontentloaded'});await ui.expect(ui.page.getByTestId('aidt-project-workspace')).toBeVisible();});
    const providerReceipt=typeof modelReceipt==='function'?await modelReceipt(proof):modelReceipt;
    const result=await ctx.finish({refresh,realModelReceipt:providerReceipt});return {...result,nativeProof:proof,cancelledOperationId:config.operationId};
  }catch(error){return ctx.failed(error);}
}
