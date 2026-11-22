/** Shared normal-UI actions for the explicitly selected V2 voice profile. Never writes through an API. */
import { createHash } from 'node:crypto';
import { ProbeFailure } from './devapp-aidt-auth-readonly.mjs';

const fail = code => { throw new ProbeFailure(code); };
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
    : `{${Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',')}}`;
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
export const V2_SYNTHETIC = '合成验收数据，非真实访谈';
export const V2_METHODS = Object.freeze(['free', 'reverse', 'scamper', 'analogy', 'role', 'brainwriting']);
export function assertV2Stage(stage, projectId, stageId) {
  if (!stage || stage.projectId !== projectId || stage.stageId !== stageId || !Number.isSafeInteger(stage.revision)
    || stage.revision < 1 || !stage.content?.draft?.fields) fail('V2_SAVED_STAGE_SCOPE_INVALID');
  return stage;
}
export function assertV2Unchanged(before, after) {
  if (canonical(before) !== canonical(after)) fail('V2_CANDIDATE_OR_CANCEL_SAVED_WITHOUT_INTENT');
  return true;
}
export function assertV2SavedChange(before, after, { projectId, stageId }) {
  assertV2Stage(after, projectId, stageId);
  if (after.revision <= (before?.revision ?? 0) || digest(after.content) === digest(before?.content)) fail('V2_UI_SAVE_NOT_READ_BACK');
  return { projectId, stageId, beforeRevision: before?.revision ?? 0, revision: after.revision, contentSha256: digest(after.content) };
}
export function parseV2Record(stage, prefix, entityId) {
  let value; try { value = JSON.parse(stage?.content?.draft?.fields?.[prefix + entityId] ?? 'null'); } catch {}
  if (!value || value.id !== entityId) fail('V2_ENTITY_RECORD_SCOPE_INVALID');
  return value;
}
export function savedV2Entities(stage, prefix) {
  return Object.entries(stage?.content?.draft?.fields ?? {}).flatMap(([key, raw]) => {
    if (!key.startsWith(prefix)) return [];
    let record; try { record = JSON.parse(raw); } catch { fail('V2_ENTITY_RECORD_INVALID'); }
    if (!record || record.id !== key.slice(prefix.length)) fail('V2_ENTITY_RECORD_INVALID');
    return [record];
  });
}
export function createV2UI({ page, expect, scope, read, armStageSave, capture, observeNativeAction, runV2UIAction }) {
  const origin = new URL(page.url()).origin, projectPath = '/aidt/' + encodeURIComponent(scope.projectId);
  const btn = (name, host = page) => host.getByRole('button', { name, exact: true });
  const click = async locator => { await expect(locator).toBeVisible(); await expect(locator).toBeEnabled(); await locator.click(); };
  const fill = async (label, text, host = page) => { const field = host.getByLabel(label, { exact: true }); await expect(field).toBeEditable(); await field.fill(text); };
  const stage = async stageId => {
    const got = await read(`/api/projects/${encodeURIComponent(scope.projectId)}/aidt/stages/${stageId}`);
    if (got?.status !== 200) fail('V2_STAGE_READ_FAILED');
    return got.data?.stage ? assertV2Stage(got.data.stage, scope.projectId, stageId) : null;
  };
  const go = async (stageId, query = {}) => {
    if (stageId !== undefined && (!Number.isInteger(stageId) || stageId < 1 || stageId > 6)) fail('V2_NAVIGATION_STAGE_INVALID');
    if (Object.keys(query).some(key => !['entity','entityRevision','thread','summary','summaryThread','tool','candidate','sourceId','history'].includes(key))) fail('V2_NAVIGATION_QUERY_INVALID');
    const search = new URLSearchParams(stageId ? { step: String(stageId), ...query } : query);
    await page.goto(origin + projectPath + (search.size ? '?' + search : ''), { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('aidt-project-workspace')).toBeVisible();
    await expect.poll(() => new URL(page.url()).pathname).toBe(projectPath);
    if (stageId) await expect.poll(() => new URL(page.url()).searchParams.get('step')).toBe(String(stageId));
  };
  const route = stageId => {
    const url = new URL(page.url());
    if (url.origin !== origin || url.pathname !== projectPath || url.searchParams.get('step') !== String(stageId)
      || !url.searchParams.get('entity')) fail('V2_NORMAL_ENTITY_ROUTE_REQUIRED');
    const summary=stageId===6&&url.searchParams.get('entity')==='group-report'&&url.searchParams.get('summary')==='1';const threadId=url.searchParams.get(summary?'summaryThread':'thread');if(!threadId?.startsWith('thr'))fail('V2_NORMAL_ENTITY_ROUTE_REQUIRED');
    return { stageId, entityId: url.searchParams.get('entity'), threadId, href: url.href,...(summary?{purpose:'summary'}:{}) };
  };
  const navigateAction = async (target,{role,phase},perform) => {
    if(typeof runV2UIAction!=='function'||!role||!phase)fail('V2_OWNED_NAVIGATION_ACTION_REQUIRED');
    const base=`/api/projects/${scope.projectId}/aidt/stages/${target.stageId}/entities/${encodeURIComponent(target.entityId)}`;
    const steps=[{operationId:`s${target.stageId}-${role}-entity-thread-${phase}`,kind:'write',requestKind:'entity-thread',stageId:target.stageId,entityRole:role,entityId:target.entityId,method:'PUT',path:base+'/thread'}];
    if(target.stageId===1||target.stageId===2&&phase!=='created-refresh')steps.push({operationId:`s${target.stageId}-${role}-reconcile-${phase}`,kind:'write',requestKind:'reconcile-entity',stageId:target.stageId,entityRole:role,entityId:target.entityId,method:'POST',path:base+'/reconcile'});
    return runV2UIAction({actionId:`s${target.stageId}-${role}-navigate-${phase}`,steps,perform});
  };
  const navigate=async(target,{role,phase,tool}={})=>{const url=new URL(target.href);if(url.origin!==origin||url.pathname!==projectPath||url.searchParams.get('entity')!==target.entityId)fail('V2_NAVIGATION_OWNED_TARGET_REQUIRED');if(tool)url.searchParams.set('tool',tool);await navigateAction(target,{role,phase},()=>page.goto(url.href,{waitUntil:'domcontentloaded'}));await expect(page.getByTestId('aidt-project-workspace')).toBeVisible();};
  const outcome = async (target,navigation) => {
    if (!target || target.stageId < 1 || target.stageId > 6) fail('V2_ENTITY_TARGET_REQUIRED');
    const url = new URL(target.href);
    if (url.origin !== origin || url.pathname !== projectPath || url.searchParams.get('entity') !== target.entityId
      || url.searchParams.get(target.purpose==='summary'?'summaryThread':'thread') !== target.threadId) fail('V2_ENTITY_TARGET_CHANGED');
    url.searchParams.set('tool', 'outcome');
    if(navigation)await navigateAction(target,navigation,()=>page.goto(url.href,{waitUntil:'domcontentloaded'}));else await page.goto(url.href, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('aidt-project-workspace')).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.get('entity')).toBe(target.entityId);
    await expect.poll(() => new URL(page.url()).searchParams.get(target.purpose==='summary'?'summaryThread':'thread')).toBe(target.threadId);
  };
  const save = async (stageId, action, { confirmation = false, assertSaved, uiAction, operationId, entityRole, entityId } = {}) => {
    const before = await stage(stageId);
    armStageSave(stageId, confirmation);
    let response;
    try {
      const perform=async()=>{[response] = await Promise.all([
        page.waitForResponse(value => value.request().method() === 'PUT' && new URL(value.url()).origin === origin
          && new URL(value.url()).pathname === `/api/projects/${scope.projectId}/aidt/stages/${stageId}`, { timeout: 30000 }),
        action(),
      ]);};
      if(operationId&&!uiAction)uiAction={actionId:operationId,steps:[{operationId,kind:'write',requestKind:'stage-save',stageId,entityRole,entityId,expectedFields:{confirmation},method:'PUT',path:`/api/projects/${scope.projectId}/aidt/stages/${stageId}`} ]};
      if(uiAction){if(typeof runV2UIAction!=='function')fail('V2_UI_ACTION_BRIDGE_REQUIRED');await runV2UIAction({...uiAction,perform});}else await perform();
    } catch { fail('V2_UI_SAVE_OUTCOME_UNKNOWN_STOP'); }
    if (response.status() !== 200) fail('V2_UI_SAVE_REJECTED_NO_REPLAY');
    const after = await stage(stageId), receipt = assertV2SavedChange(before, after, { projectId: scope.projectId, stageId });
    if (assertSaved) await assertSaved(after);
    return { stage: after, receipt };
  };
  const unchanged = async (stageId, before) => assertV2Unchanged(before, await stage(stageId));
  const refresh = async (stageId, { expectedRevision, assertSaved, navigation } = {}) => {
    if(navigation)await navigateAction(route(stageId),navigation,()=>page.reload({waitUntil:'domcontentloaded'}));else await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('aidt-project-workspace')).toBeVisible();
    const saved = await stage(stageId);
    if (expectedRevision !== undefined && saved?.revision !== expectedRevision) fail('V2_REFRESH_VERSION_CHANGED');
    if (assertSaved) await assertSaved(saved);
    return { stage: saved, projectId: scope.projectId, revision: saved?.revision ?? 0, contentSha256: digest(saved?.content) };
  };
  const completed = async stageId => {
    await go();
    const card = page.getByTestId(`aidt-stage-save-${stageId}`);
    await expect(card).toHaveAttribute('data-completed', 'true');
    await capture(`v2-s${stageId}-overview-completed`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(card).toHaveAttribute('data-completed', 'true');
    await capture(`v2-s${stageId}-overview-completed-refreshed`);
    return stage(stageId);
  };
  const notCompleted = async stageId => { await go(); await expect(page.getByTestId(`aidt-stage-save-${stageId}`)).not.toHaveAttribute('data-completed','true'); };
  const expand = async (name, host = page) => {
    const summary = host.locator('summary').filter({ hasText: name }); await expect(summary).toHaveCount(1);
    if (await summary.locator('..').getAttribute('open') === null) await summary.click();
  };
  const selectCandidate = async ({ stageId, host, actionLabel, adoptLabel, editRegion, editLabel, editText, saveLabel, operationId, editExtra, saveOperationId, saveRole, refreshPhase }) => {
    if (typeof observeNativeAction !== 'function') fail('V2_NATIVE_ACTION_OBSERVER_REQUIRED');
    const before = await stage(stageId);
    const proof = await observeNativeAction({ stageId, operationId, perform: () => click(btn(actionLabel, host)) });
    if (!proof?.runId || !proof?.assistantMessageId || !proof?.sourceRevisions) fail('V2_CANDIDATE_REAL_REPLY_REQUIRED');
    await unchanged(stageId, before);
    const choices = host.getByRole('radio'); await expect.poll(() => choices.count(), { timeout: 30000 }).toBeGreaterThan(0);
    await expect(host.locator('input[type="radio"]:checked')).toHaveCount(0);
    await expect(btn(adoptLabel, host)).toBeDisabled();
    await choices.first().check();
    const replace = host.getByRole('checkbox', { name: '我已对照已有内容，同意将选中的候选填入可编辑草稿', exact: true });
    if (await replace.count()) await replace.check();
    await click(btn(adoptLabel, host));
    const local = page.getByRole('region', { name: editRegion, exact: true }); await expect(local).toBeVisible();
    await fill(editLabel, editText, local);
    if (editExtra) await editExtra(local);
    await unchanged(stageId, before);
    await capture(`v2-s${stageId}-${operationId}-local-not-saved`, stageId);
    const choiceCount = await choices.count();
    const saved = await save(stageId, () => click(btn(saveLabel, local)),saveOperationId?{operationId:saveOperationId,entityRole:saveRole,entityId:route(stageId).entityId}:{});
    await refresh(stageId, { expectedRevision: saved.receipt.revision,...(refreshPhase?{navigation:{role:saveRole,phase:refreshPhase}}:{}) });
    return { ...saved, proof, choicesObserved: choiceCount, explicitlySelected: true, localDidNotSave: true };
  };
  return { page, expect, scope, origin, projectPath, btn, click, fill, stage, go, route, outcome, navigate, save, unchanged, refresh, completed, notCompleted, expand, selectCandidate, performAction:runV2UIAction };
}
