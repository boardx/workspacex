/** Actual S3 candidate/confirmation UI. No API seeding, synthetic assistant messages or direct mutation. */
import { ProbeFailure } from './devapp-aidt-auth-readonly.mjs';
import { savedV2Entities, parseV2Record } from './devapp-aidt-v2-ui.mjs';
const fail = code => { throw new ProbeFailure(code); };

export async function useV2DefinitionCandidate({ ui, kind, count, sourceCodes, observeNativeAction, capture, printFormal, operatorEdit, cancelAfterPreview=false }) {
  if (!['persona','hmw'].includes(kind) || !Number.isInteger(count) || count < 1 || count > 3 || sourceCodes.length !== 2) fail('V2_DEFINITION_SCENARIO_INVALID');
  const { page, expect, btn, click, fill, stage, go, save, unchanged, refresh } = ui;
  await go(3);
  const before = await stage(3), prefix = kind === 'persona' ? 'definitionPersona:' : 'definitionHmw:';
  const previous = new Set(savedV2Entities(before, prefix).map(item => item.id));
  const entryName = kind === 'persona' ? 'AI 综合用户画像' : 'AI 构思 HMW';
  const link = page.getByRole('link', { name: entryName, exact: true });
  await expect(link).toBeVisible();
  // The first directory candidate opens one normal S3 Chat; later persona/HMW visits recover that mounted thread.
  if(kind==='persona'&&cancelAfterPreview)await ui.performAction({actionId:'s3-persona-directory-initial-native-chat',steps:[
    {operationId:'s3-persona-directory-thread-create',kind:'write',requestKind:'thread-create',stageId:3,entityRole:'persona-main',method:'POST',path:'/api/chat/threads/mutate',expectedFields:{title:'[AIDT 3] 综合与定义'},captureThread:true},
    {operationId:'s3-persona-directory-thread-mount',kind:'write',requestKind:'thread-mount',stageId:3,entityRole:'persona-main',method:'POST',path:'/api/threads/{createdThread}/skill-mounts'},
  ],perform:()=>link.click()});else await link.click();
  await page.waitForURL(url => url.searchParams.get('step') === '3' && url.searchParams.get('candidate') === kind && !url.searchParams.has('entity'));
  const dialog = page.getByRole('dialog', { name: kind === 'persona' ? '从证据形成画像' : '找到值得继续探索的问题', exact: true });
  await expect(dialog).toBeVisible();
  const sourceLegend = kind === 'persona' ? '使用哪些访谈发现？' : '来源访谈';
  const sources = dialog.getByRole('group', { name: sourceLegend, exact: true });
  for (const code of sourceCodes) await sources.getByRole('checkbox', { name: new RegExp('^' + code + '(?:\\s|·)') }).check();
  if (kind === 'hmw') {
    const profiles = dialog.getByRole('group', { name: '来源画像', exact: true });
    const choices = profiles.getByRole('checkbox'); await expect.poll(() => choices.count()).toBeGreaterThan(0); await choices.first().check();
  }
  await fill('候选数量', String(count), dialog);
  const native = await observeNativeAction({ stageId: 3, operationId: `s3-${kind}-main-${count===1?'single-candidate-preview-cancel':'multiple-candidates-select'}`, perform: () => click(btn(kind === 'persona' ? '生成画像候选' : '生成 HMW 候选', dialog)) });
  if (!native?.runId || !native.assistantMessageId) fail('V2_DEFINITION_DURABLE_REPLY_REQUIRED');
  await unchanged(3, before);
  const radios = dialog.getByRole('radio'); await expect.poll(() => radios.count(), { timeout: 30000 }).toBeGreaterThan(0);
  const available = await radios.count();
  if (available > count || available > 3) fail('V2_DEFINITION_CANDIDATE_COUNT_UNREQUESTED');
  await expect(dialog.locator('input[type="radio"]:checked')).toHaveCount(0);
  const add = btn(kind === 'persona' ? '将此画像加入产物' : '将此问题加入产物', dialog);
  await expect(add).toBeDisabled();
  for (let index = 0; index < available; index++) {
    await radios.nth(index).check();
    if (kind === 'persona') {
      const canvas = dialog.locator('canvas'); await expect.poll(() => canvas.count()).toBeGreaterThan(0);
      const geometry = await canvas.first().evaluate(node => ({ width: node.width, height: node.height }));
      if (geometry.width < 1 || geometry.height < 1) fail('V2_PERSONA_ACTUAL_CANVAS_REQUIRED');
    } else await expect(dialog.getByLabel('我们如何……', { exact: true })).toBeEditable();
    await unchanged(3, before);
  }
  await radios.first().check();
  if(cancelAfterPreview){await capture(`v2-s3-${kind}-${count}-candidate-preview-cancel`,3,'candidate-dialog');await click(btn('关闭',dialog));await unchanged(3,before);await refresh(3,{expectedRevision:before.revision});return {kind,native,available,cancelled:true,revision:before.revision};}
  if (kind === 'persona') {
    await ui.expand('核对画像摘要', dialog);
    const name = dialog.getByLabel('画像名称', { exact: true }); await expect(name).toBeEditable();
    await name.fill((await name.inputValue()).slice(0,150) + ' · 学生审阅修订');
    if (operatorEdit) await operatorEdit({ dialog, kind, native });
  } else {
    const text = dialog.getByLabel('我们如何……', { exact: true });
    const current = await text.inputValue();
    if (!current.trim()) fail('V2_HMW_CANDIDATE_EMPTY');
    await text.fill(current.slice(0,180));
    await fill('为什么选择这个问题', '合成验收：学生核对授权访谈/观察与本组讨论，保留具体情境和多种解决路径；仍需进一步真实验证。', dialog);
  }
  await unchanged(3, before);
  await capture(`v2-s3-${kind}-${count}-selected-edited-not-saved`, 3, 'candidate-dialog');
  const role=kind+'-main',base=`/api/projects/${ui.scope.projectId}/aidt/stages/3`;
  const expectedValue=await dialog.getByLabel(kind==='persona'?'画像名称':'我们如何……',{exact:true}).inputValue();
  const added = await save(3, () => click(add),{uiAction:{actionId:`s3-${kind}-explicit-import-and-open`,steps:[
    {operationId:`s3-${role}-explicit-import`,kind:'write',requestKind:'stage-save',stageId:3,entityRole:role,method:'PUT',path:base,captureEntity:{prefix,nameField:kind==='persona'?'name':'text',expectedName:expectedValue.trim(),priorIds:[...previous]}},
    {operationId:`s3-${role}-entity-thread-initial`,kind:'write',requestKind:'entity-thread',stageId:3,entityRole:role,entityId:'{createdEntity}',method:'PUT',path:base+'/entities/{createdEntity}/thread',captureThread:true},
    {operationId:`s3-${role}-thread-mount`,kind:'write',requestKind:'thread-mount',stageId:3,entityRole:role,entityId:'{createdEntity}',method:'POST',path:'/api/threads/{createdThread}/skill-mounts'},
  ]}});
  const records = savedV2Entities(added.stage, prefix).filter(item => !previous.has(item.id));
  if (records.length !== 1 || records[0].confirmed === true) fail('V2_DEFINITION_IMPORT_MUST_BE_ONE_UNCONFIRMED');
  const entityId = records[0].id;
  await page.waitForURL(url => url.searchParams.get('entity') === entityId && url.searchParams.get('step') === '3' && url.searchParams.get('thread')?.startsWith('thr'));
  const target = ui.route(3);
  await refresh(3, { expectedRevision: added.receipt.revision,navigation:{role,phase:'import-refresh'}, assertSaved: value => {
    const read = parseV2Record(value,prefix,entityId); if (read.confirmed === true) fail('V2_DEFINITION_IMPORTED_AS_CONFIRMED');
  } });
  const confirm = page.getByRole('region', { name: '确认当前产物', exact: true });
  // Normal native Chat includes the real confirmation button, regardless of the right outcome panel.
  const confirmButton = btn('确认当前产物', await confirm.count() ? confirm : page);
  const confirmed = await save(3, () => click(confirmButton), {operationId:`s3-${role}-confirm`,entityRole:role,entityId, assertSaved: value => {
    if (!parseV2Record(value,prefix,entityId).confirmed) fail('V2_DEFINITION_CONFIRMATION_NOT_SAVED');
  } });
  await refresh(3, { expectedRevision: confirmed.receipt.revision,navigation:{role,phase:'confirmed-refresh'} });
  let selectedRevision=confirmed.receipt.revision;
  if (kind === 'hmw') {
    const picked = await save(3, () => click(btn('选为本轮 HMW')),{operationId:'s3-hmw-main-select-for-round',entityRole:role,entityId});
    selectedRevision=picked.receipt.revision;await refresh(3, { expectedRevision: picked.receipt.revision,navigation:{role,phase:'selected-refresh'} });
  }
  await ui.outcome(target,{role,phase:'formal-outcome'});
  const output = page.getByTestId('aidt-definition-editor'); await expect(output).toBeVisible();
  await capture(`v2-s3-${kind}-${count}-formal`,3);
  const printing = await printFormal({ stage: 3, name: kind === 'persona' ? 'confirmed-persona' : 'confirmed-hmw', entityId,
    button: btn(kind === 'persona' ? '打印画像' : '打印问题', output), requiredTexts: kind === 'persona' ? [] : [records[0].text], sourceRevision: (await stage(3)).revision });
  return { kind, target, entityId, native, available, importedRevision: added.receipt.revision, confirmedRevision: confirmed.receipt.revision,selectedRevision,text:kind==='hmw'?records[0].text:undefined, printing };
}

export async function cancelV2DefinitionCandidate({ ui, kind, sourceCodes, observeNativeAction, capture,directoryThreadId }) {
  const { page, expect, stage, go, unchanged, click, btn } = ui;
  // The no-generation cancellation must recover a previously observed directory Chat, never silently create another.
  if(!/^thr[A-Za-z0-9_.:-]+$/.test(directoryThreadId??'')||directoryThreadId.startsWith('thr_aidt_'))fail('V2_DEFINITION_EXISTING_DIRECTORY_THREAD_REQUIRED');
  await go(3,{thread:directoryThreadId}); const before = await stage(3);
  await page.getByRole('link',{ name: kind === 'persona' ? 'AI 综合用户画像' : 'AI 构思 HMW', exact: true }).click();
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  // Closing before generation must neither write nor spend a model request.
  await click(btn('关闭', dialog)); await unchanged(3,before);
  await ui.refresh(3,{expectedRevision:before.revision}); await capture(`v2-s3-${kind}-cancel-without-generation`,3);
  return { cancelledBeforeGeneration:true, revision:before.revision, sourceCodes, observerUnused:typeof observeNativeAction==='function' };
}
