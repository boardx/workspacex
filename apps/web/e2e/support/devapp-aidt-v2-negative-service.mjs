/** Service rejection is evidence only when an actual normal-UI request received the real server response. */
import { ProbeFailure } from './devapp-aidt-auth-readonly.mjs';
import { v2CaseHash } from './devapp-aidt-v2-cases.mjs';
const fail=code=>{throw new ProbeFailure(code);};
export function assertV2ServiceRejection({origin,projectId,stageId,method,url,status,expectedStatus}) {
  let target;try{target=new URL(url);}catch{fail('V2_REJECTION_RESPONSE_URL_INVALID');}
  if(![403,409].includes(expectedStatus)||status!==expectedStatus||method!=='PUT'||target.origin!==origin
    ||target.pathname!==`/api/projects/${projectId}/aidt/stages/${stageId}`||target.search)fail('V2_REJECTION_NOT_REAL_OWNED_STAGE_RESPONSE');
  return {stageId,method,status,path:target.pathname};
}
/** Caller must supply its already approved one-use action window and actual alternate actor/409 setup.
 * This helper neither changes permissions nor intercepts requests nor allocates a retry slot.
 * It returns a subcheck; it cannot alone pass AI-08 or CRUD-08 (actor, revocation, recovery still required).
 */
export async function inspectV2UiWriteRejection({ui,stageId,expectedStatus,perform,localEditor}) {
  if(typeof perform!=='function'||!localEditor||![403,409].includes(expectedStatus))fail('V2_REJECTION_NORMAL_UI_ACTION_REQUIRED');
  const before=await ui.stage(stageId),localBefore=await localEditor.inputValue(),url=new URL(ui.page.url());
  if(url.pathname!==ui.projectPath||url.searchParams.get('step')!==String(stageId)||!url.searchParams.get('entity'))fail('V2_REJECTION_OWNED_ENTITY_ROUTE_REQUIRED');
  let response;[response]=await Promise.all([
    ui.page.waitForResponse(value=>value.request().method()==='PUT'&&new URL(value.url()).origin===ui.origin
      &&new URL(value.url()).pathname===`/api/projects/${ui.scope.projectId}/aidt/stages/${stageId}`,{timeout:30000}),perform(),
  ]);
  const responseFact=assertV2ServiceRejection({origin:ui.origin,projectId:ui.scope.projectId,stageId,method:response.request().method(),url:response.url(),status:response.status(),expectedStatus});
  // A browser route abort, synthetic wait state or disabled button cannot yield this server response.
  if(response.fromServiceWorker?.())fail('V2_REJECTION_SERVICE_WORKER_SUBSTITUTE');
  await ui.expect(localEditor).toHaveValue(localBefore);await ui.unchanged(stageId,before);
  const alerts=ui.page.getByRole('alert');await ui.expect.poll(()=>alerts.count()).toBeGreaterThan(0);
  const hasVisibleError=await alerts.evaluateAll(nodes=>nodes.some(node=>node instanceof HTMLElement&&node.getBoundingClientRect().width>0&&!!node.textContent?.trim()));
  if(!hasVisibleError)fail('V2_REJECTION_NO_VISIBLE_RECOVERY_ERROR');
  return {status:'OBSERVED_SUBCHECK',response:responseFact,entityId:url.searchParams.get('entity'),revision:before?.revision??0,
    savedContentSha256:v2CaseHash(before?.content??null),localDraftSha256:v2CaseHash(localBefore),localDraftRetained:true,visibleError:true,
    provesServiceRejection:true,provesAlternateActor:false,provesRevocation:false,provesRecovery:false};
}
