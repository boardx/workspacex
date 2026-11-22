/** Case evidence is earned by named observations, never by stage-level success. */
import { createHash } from 'node:crypto';
import { ProbeFailure } from './devapp-aidt-auth-readonly.mjs';
const fail=code=>{throw new ProbeFailure(code);};
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
export const v2CaseHash=value=>createHash('sha256').update(canonical(value)).digest('hex');
export function v2CaseReadback(stage,scope) {
  // A successful GET with stage:null is a real absent state, not a fabricated saved draft.
  if(stage===null)return {projectId:scope.projectId,revision:0,content:null};
  if(!stage||stage.projectId!==scope.projectId||!Number.isSafeInteger(stage.revision)||stage.revision<1)fail('V2_CASE_READBACK_SCOPE_INVALID');
  return stage;
}
export function assertV2CaseReceipt({binding,assertions,before,after,refreshed,scope,screenshots,actualUiActions=1,realModelReceipt}) {
  if(!binding||!Array.isArray(assertions)||binding.assertionIds.some(id=>!assertions.some(row=>row.id===id&&row.passed===true&&/^[a-f0-9]{64}$/.test(row.evidenceSha256??''))))fail('V2_REAL_CASE_ASSERTIONS_INCOMPLETE');
  after=v2CaseReadback(after,scope);refreshed=v2CaseReadback(refreshed,scope);
  if(after.revision!==refreshed.revision||v2CaseHash(after.content)!==v2CaseHash(refreshed.content))fail('V2_CASE_REFRESH_NOT_EXACT');
  if(!Number.isInteger(actualUiActions)||actualUiActions<1||actualUiActions>(binding.caseId==='CRUD-02'?256:128))fail('V2_CASE_ACTION_COUNT_INVALID');
  if(!Array.isArray(screenshots)||['before','result','refreshed'].some(kind=>!screenshots.some(row=>row.kind===kind&&row.filename.includes(binding.caseId)&&row.bytes>=512&&/^[a-f0-9]{64}$/.test(row.sha256??''))))fail('V2_REAL_CASE_SCREENSHOTS_MISSING');
  return {scope,actualUiActions,assertionResults:assertions,serverReadback:{projectId:scope.projectId,entityRole:binding.entityRole,revision:after.revision,contentSha256:v2CaseHash(after.content)},refreshedReadback:{projectId:scope.projectId,entityRole:binding.entityRole,revision:refreshed.revision,contentSha256:v2CaseHash(refreshed.content)},screenshots,...(realModelReceipt?{realModelReceipt}:{})};
}
/** begin precedes all case actions; only UI/read slots are settled here, never physical writes/models. */
export async function beginV2Case({caseId,stageId,ui,ledger,runtimeScope,plan,capture,now=()=>Date.now()}) {
  const scope=runtimeScope(),binding=plan.caseBindings.find(row=>row.caseId===caseId);
  if(!binding)fail('V2_CASE_NOT_IN_PLAN');
  ledger.beginCase(caseId,scope);
  const deadlineAt=ledger.summary().cases.find(row=>row.caseId===caseId)?.deadlineAt;
  const uiId='ui-'+caseId.toLowerCase(),readId='read-'+caseId.toLowerCase();
  const role=plan.operations.find(row=>row.id===readId)?.entityRole;
  if(!role)fail('V2_CASE_READ_SLOT_MISSING');
  for(const id of [uiId,readId]){ledger.claimOperation(id,scope);ledger.markOperationSent(id,scope);}
  const before=v2CaseReadback(await ui.stage(stageId),scope),screenshots=[],observations=new Map();let actions=0,closed=false;
  const shot=async kind=>{const receipt=await capture(`V2N-${caseId}-${kind}`,stageId);if(!receipt)fail('V2_REAL_SCREENSHOT_RECEIPT_REQUIRED');screenshots.push({...receipt,kind});};
  const record=(id,passed,observed)=>{
    if(!binding.assertionIds.includes(id)||typeof passed!=='boolean'||observed===undefined)fail('V2_CASE_OBSERVATION_INVALID');
    if(!passed)fail('V2_CASE_ASSERTION_'+id.toUpperCase().replaceAll('-','_'));
    observations.set(id,{id,passed,evidenceSha256:v2CaseHash({id,observed})});
  };
  const action=async perform=>{if(now()>deadlineAt)fail('V2_CASE_TIMEOUT');if(typeof perform!=='function'||++actions>(caseId==='CRUD-02'?256:128))fail('V2_CASE_ACTION_BOUND');return perform();};
  const finish=async ({refresh,realModelReceipt,partialCode}={})=>{
    if(closed)fail('V2_CASE_ALREADY_CLOSED');
    const after=v2CaseReadback(await ui.stage(stageId),scope);await shot('result');
    if(typeof refresh!=='function')fail('V2_CASE_MANAGED_REFRESH_REQUIRED');
    await action(refresh);const refreshed=v2CaseReadback(await ui.stage(stageId),scope);await shot('refreshed');
    record(binding.assertionIds.includes('refresh-preserves-saved-content')?'refresh-preserves-saved-content':'refresh-persisted',after.revision===refreshed.revision&&v2CaseHash(after.content)===v2CaseHash(refreshed.content),{after,refreshed});
    record('real-screenshots',screenshots.length===3,screenshots);
    const digest=v2CaseHash({caseId,observations:[...observations.values()],after,refreshed,screenshots});
    for(const id of [uiId,readId])ledger.settleOperation(id,{scope,outcome:'succeeded',receipt:{verified:true,sha256:digest,httpStatus:200}});
    const missing=binding.assertionIds.filter(id=>!observations.has(id));
    if(partialCode||missing.length||binding.requiresModel&&!realModelReceipt){ledger.markCaseBlocked(caseId,partialCode??(missing.length?'V2_CASE_ASSERTIONS_NOT_EXECUTED':'V2_CASE_PROVIDER_RECEIPT_REQUIRED'));closed=true;return {caseId,status:'BLOCKED',code:partialCode??(missing.length?'V2_CASE_ASSERTIONS_NOT_EXECUTED':'V2_CASE_PROVIDER_RECEIPT_REQUIRED'),missingAssertions:missing,observations:[...observations.values()],before,after,refreshed,screenshots};}
    const evidence=assertV2CaseReceipt({binding:{...binding,entityRole:role},assertions:[...observations.values()],before,after,refreshed,scope,screenshots,actualUiActions:actions,realModelReceipt});
    ledger.markCasePassed(caseId,evidence);closed=true;return {caseId,status:'PASSED',evidence};
  };
  const failed=error=>{if(!closed){ledger.markCaseFailed(caseId,{scope,code:error.code??'V2_CASE_EXECUTOR_FAILED',evidenceSha256:v2CaseHash({caseId,code:error.code??'unexpected',screenshots})});closed=true;}throw error;};
  await shot('before');return {caseId,scope,binding,before,shot,record,action,finish,failed};
}
/** Actual narrow-screen/Tab subchecks. Full 09 remains blocked until Enter/IME/Esc and dialog lifecycle are actually exercised. */
export async function runV2AccessibilityCase({ui,stageId,ledger,runtimeScope,plan,capture,managedRefresh,completeKeyboardChecks}) {
  const ctx=await beginV2Case({caseId:`AI-S${stageId}-09`,stageId,ui,ledger,runtimeScope,plan,capture}),viewport=ui.page.viewportSize();
  try{
    await ctx.action(()=>ui.page.setViewportSize({width:375,height:812}));
    const workspace=ui.page.getByTestId('aidt-project-workspace');await ui.expect(workspace).toBeVisible();
    const geometry=await workspace.evaluate(node=>({scroll:node.scrollWidth,width:node.clientWidth}));
    ctx.record('mobile-no-overflow',geometry.width>0&&geometry.scroll<=geometry.width+1,geometry);
    await ctx.action(()=>ui.page.keyboard.press('Tab'));
    const focused=await ui.page.evaluate(()=>{const node=document.activeElement;return node instanceof HTMLElement&&node!==document.body&&getComputedStyle(node).visibility!=='hidden'&&node.getBoundingClientRect().width>0;});
    ctx.record('visible-keyboard-focus',focused,{focused});await ui.unchanged(stageId,ctx.before.revision?ctx.before:null);
    if(completeKeyboardChecks){const facts=await completeKeyboardChecks(ctx);for(const id of ['keyboard-enter-ime-escape','preview-select-cancel-save-keyboard','focus-return'])ctx.record(id,facts?.[id]?.passed===true,facts?.[id]?.observed);}
    // Directory refresh is read-only; entity refresh requires the caller's exact, one-use navigation window.
    const refresh=managedRefresh??(async()=>{await ui.go(stageId);await ui.page.reload({waitUntil:'domcontentloaded'});await ui.expect(workspace).toBeVisible();});
    return await ctx.finish({refresh,partialCode:completeKeyboardChecks?undefined:'V2_KEYBOARD_LIFECYCLE_NOT_EXECUTED'});
  }catch(error){return ctx.failed(error);}finally{if(viewport)await ui.page.setViewportSize(viewport);}
}
