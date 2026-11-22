import { ProbeFailure } from './devapp-aidt-auth-readonly.mjs';
import { schematicPng } from './devapp-aidt-journey.mjs';
import { v2PrototypeFields } from './devapp-aidt-v2-s5.mjs';
const fail=code=>{throw new ProbeFailure(code);};
/** The same frozen S4 bytes are visibly imported by the product's own reference-image control. */
export async function importV2FrozenIdeaImages({ui,prototype,read,prepareSourceImages,capture}){
  if(typeof prepareSourceImages!=='function')fail('V2_DESIGN_SOURCE_PRE_READ_PORT_REQUIRED');
  const {page,expect,stage,btn,click}=ui,id=prototype.target.entityId,role=prototype.role;
  const entry=page.getByRole('link',{name:'打开 Design 工作台',exact:true});await expect(entry).toBeVisible();const entryUrl=new URL(await entry.getAttribute('href'),ui.origin);if(entryUrl.origin!==ui.origin||entryUrl.pathname!==ui.projectPath||entryUrl.searchParams.get('entity')!==id||entryUrl.searchParams.get('resource')!==id||entryUrl.searchParams.get('tool')!=='design')fail('V2_DESIGN_NORMAL_RESOURCE_LINK_REQUIRED');await ui.navigate({...prototype.target,href:entryUrl.href},{role,phase:'design-enter',tool:'design'});
  const panel=page.getByRole('region',{name:'冻结点子图片来源',exact:true});await expect(panel).toBeVisible();
  const images=await prepareSourceImages({designId:id,stage4Revision:prototype.stage4Revision,brainstormId:prototype.sourceRoundId,ideaIds:prototype.selectedIds});
  if(!Array.isArray(images)||images.length!==prototype.selectedIds.length||![1,3].includes(images.length)||new Set(images.map(image=>image.sha256)).size!==images.length)fail('V2_DESIGN_DISTINCT_EXACT_SOURCE_IMAGES_REQUIRED');
  const details=panel.locator('details');await expect(details).toHaveCount(images.length);for(const item of await details.all()){await item.locator('summary').click();await expect(item.getByRole('img')).toBeVisible();await expect.poll(()=>item.getByRole('img').evaluate(img=>img.complete&&img.naturalWidth>0),{timeout:30000}).toBe(true);}
  const steps=[];for(const [index,image]of images.entries())steps.push({operationId:`s5-${role}-source-image-upload-${index+1}`,kind:'write',requestKind:'design-ref-image',stageId:5,entityRole:role,entityId:id,resourceId:id,expectedFields:{sourceImage:image},method:'POST',path:`/api/pm-designs/${id}/ref-images`},{operationId:`s5-${role}-source-image-save-${index+1}`,kind:'write',requestKind:'stage-save',stageId:5,entityRole:role,entityId:id,method:'PUT',path:`/api/projects/${ui.scope.projectId}/aidt/stages/5`});
  await ui.performAction({actionId:`s5-${role}-import-frozen-source-images`,timeoutMs:120000,steps,perform:()=>click(btn('载入冻结点子图片',panel))});await expect(panel).toContainText(`已载入并保存 ${images.length} 张冻结来源图`);
  const saved=await stage(5),fields=v2PrototypeFields(saved,id);let pin;try{pin=JSON.parse(fields.prototypeSourceImages);}catch{}if(pin?.projectId!==ui.scope.projectId||pin.designId!==id||pin.textStageRevision!==prototype.v2Revision||pin.textSha256!==prototype.basisSha256||pin.images?.length!==images.length)fail('V2_DESIGN_SAVED_SOURCE_IMAGE_BINDING_REQUIRED');
  const listed=await read('/api/pm-designs');if(listed.status!==200||!Array.isArray(listed.data?.items))fail('V2_DESIGN_NATIVE_SOURCE_IMAGE_READ_REQUIRED');const native=listed.data.items.find(item=>item.id===id);
  for(const image of images){const savedImage=pin.images.find(item=>item.sha256===image.sha256);if(!savedImage||['sourceRunId','artifactId','versionId','sha256','stage4Revision','brainstormId'].some(key=>savedImage[key]!==image[key]))fail('V2_DESIGN_SOURCE_IMAGE_PROVENANCE_CHANGED');const actual=native?.refImages?.find(item=>item.id===savedImage.nativeImageId);if(!actual||actual.name!==image.nativeName||actual.size!==image.bytes||actual.mime!==image.mime)fail('V2_DESIGN_SOURCE_IMAGE_NOT_IN_ACTUAL_NATIVE_REFERENCES');}
  await capture(`v2-s5-${role}-actual-source-images-imported`,5);await ui.navigate(prototype.target,{role,phase:'version-select-return'});
  return {revision:saved.revision,sourceCount:images.length,nativeImageIds:pin.images.map(image=>image.nativeImageId),sourceSha256s:images.map(image=>image.sha256),actualUploadAndSavedBinding:true};
}
export async function produceV2PrototypeVersions({ui,prototype,runNativeOperation,read,armDesignImage,capture,printFormal,prepareSourceImages,kinds=['image','html','webapp'],completeStage=true}) {
  const {page,expect,btn,click,stage,save,refresh}=ui,id=prototype.target.entityId,versions=[];
  const list=async()=>{const got=await read(`/api/pm-designs/${encodeURIComponent(id)}/versions`);if(got.status!==200||!Array.isArray(got.data?.items))fail('V2_NATIVE_VERSION_LIST_REQUIRED');return got.data.items;};
  if(!Array.isArray(kinds)||!kinds.length||new Set(kinds).size!==kinds.length||kinds.some(kind=>!['image','html','webapp'].includes(kind)))fail('V2_PROTOTYPE_KIND_INVALID');
  const sourceImages=await importV2FrozenIdeaImages({ui,prototype,read,prepareSourceImages,capture});
  for(const kind of kinds) {
    if(ui.route(5).entityId!==id||ui.route(5).threadId!==prototype.target.threadId)fail('V2_PROTOTYPE_CURRENT_OWNED_ENTITY_REQUIRED');const beforeVersions=new Set((await list()).map(row=>row.id));
    if(kind==='image') {
      await ui.expand('用图片制作静态原型');
      const input=page.getByLabel('上传原型图片',{exact:true});await expect(input).toBeVisible();
      const png=schematicPng(String(ui.scope.runId),73),filename=`qa-${ui.scope.runId}-prototype.png`;
      // This is a student-supplied synthetic drawing path; it is never called AI image-generation proof.
      await armDesignImage({id,fileName:filename,bytes:png});await input.setInputFiles({name:filename,mimeType:'image/png',buffer:png});
      await save(5,()=>click(btn('保存上传图片方案')),{uiAction:{actionId:`s5-${prototype.role}-normal-image-output`,steps:[{operationId:`s5-${prototype.role}-image-generate`,kind:'write',requestKind:'design-image',stageId:5,entityRole:prototype.role,entityId:id,resourceId:id,method:'POST',path:`/api/pm-designs/${id}/prototype/patch`},{operationId:`s5-${prototype.role}-image-bind`,kind:'write',requestKind:'stage-save',stageId:5,entityRole:prototype.role,entityId:id,method:'PUT',path:`/api/projects/${ui.scope.projectId}/aidt/stages/5`}]}});
    } else {
      const link=page.getByRole('link',{name:'打开 Design 工作台',exact:true});await expect(link).toBeVisible();const linkUrl=new URL(await link.getAttribute('href'),ui.origin);if(linkUrl.origin!==ui.origin||linkUrl.pathname!==ui.projectPath||linkUrl.searchParams.get('entity')!==id||linkUrl.searchParams.get('resource')!==id||linkUrl.searchParams.get('tool')!=='design')fail('V2_DESIGN_NORMAL_RESOURCE_LINK_REQUIRED');await ui.navigate({...prototype.target,href:linkUrl.href},{role:prototype.role,phase:'design-'+kind+'-entry',tool:'design'});
      const input=page.getByTestId('design-detail-input');await expect(input).toBeEditable();
      const user=kind==='html'
        ?'请依据已确认文字V2制作一个真实HTML页面：标题“等待信息比较”，显示“预计等待5分钟”和“查看其他选择”“返回比较”。保留明确文字，生成真正HTML页而非截图。此为合成软件QA，不作真人效果结论。'
        :'请在同一已确认文字V2依据上制作实际可操作WebApp原型：初始显示“等待信息比较”和“预计等待5分钟”；点击“查看其他选择”后实际显示“可选方案”；“返回比较”能返回初始画面。用真实可运行HTML交互表达，不能只在notes声称可点击。合成软件QA，不涉及真实支付或外发。';
      await input.fill(`QA ${ui.scope.runId} 合成软件QA。${user}`);
      await runNativeOperation({operationId:`s5-${prototype.role}-${kind}-generate`,kind:'design',stage:5,entityRole:prototype.role,entityId:id,resourceId:id,perform:()=>click(page.getByTestId('design-detail-send'))});
      await expect(page.getByTestId('design-detail-generating')).toHaveCount(0,{timeout:900000});
      await expect(page.getByTestId('design-detail-chat-error')).toHaveCount(0);
      const canvas=page.getByTestId('design-detail-canvas');await expect(canvas).toBeVisible();
      const frame=canvas.frameLocator('iframe').first();await expect(frame.getByText('等待信息比较',{exact:true})).toBeVisible();
      if(kind==='webapp'){await frame.getByRole('button',{name:'查看其他选择',exact:true}).click();await expect(frame.getByText('可选方案',{exact:true})).toBeVisible();await frame.getByRole('button',{name:'返回比较',exact:true}).click();await expect(frame.getByText('预计等待5分钟',{exact:true})).toBeVisible();}
      await ui.navigate(prototype.target,{role:prototype.role,phase:'design-'+kind+'-return'});
    }
    const all=await list(),newVersions=all.filter(row=>!beforeVersions.has(row.id));
    if(newVersions.length!==1||!newVersions[0].id)fail('V2_EXACT_ONE_PERSISTED_PROTOTYPE_VERSION_REQUIRED');
    const version=newVersions[0];
    if(kind!=='image'&&version.source!=='model')fail('V2_MODEL_PROTOTYPE_VERSION_SOURCE_REQUIRED');
    if(kind!=='image'){await click(btn('选择真实原型版本'));
    const picker=page.getByTestId('aidt-prototype-version-picker');
    const own=picker.getByRole('button',{name:prototype.name??new RegExp(id),exact:!!prototype.name});
    if(await own.count())await click(own);
    const versionButton=picker.getByRole('button').filter({hasText:'版本 ID：'+version.id});await expect(versionButton).toHaveCount(1);
    await save(5,()=>click(versionButton),{operationId:`s5-${prototype.role}-${kind}-version-select`,entityRole:prototype.role,entityId:id});
    const binding=page.getByTestId('aidt-prototype-text-binding');await click(btn('查看所选原型的确切版本',binding));
    await expect(binding).toContainText(version.id);
    await save(5,()=>click(btn('将此原型用于该确认设计稿',binding)),{operationId:`s5-${prototype.role}-${kind}-basis-bind`,entityRole:prototype.role,entityId:id});}
    const binding=page.getByTestId('aidt-prototype-text-binding');
    const selected=await stage(5),fields=v2PrototypeFields(selected,id);let reference,relationships;
    try{reference=JSON.parse(fields.prototypeReference);relationships=JSON.parse(fields.prototypeTextOutputBindings??'[]');}catch{fail('V2_PROTOTYPE_SAVED_BINDING_INVALID');}
    const relationship=relationships.find(row=>row.versionId===version.id);
    if(reference.designId!==id||reference.versionId!==version.id||relationship?.textStageRevision!==prototype.v2Revision||relationship.textSha256!==prototype.basisSha256)fail('V2_NATIVE_PROTOTYPE_NOT_BOUND_TO_CONFIRMED_V2');
    await refresh(5,{expectedRevision:selected.revision,navigation:{role:prototype.role,phase:kind+'-formal'}});await capture(`v2-s5-${prototype.role}-${kind}-exact-version-v2-basis`,5);
    await printFormal({stage:5,name:`${prototype.role}-${kind}`,entityId:id,button:btn('预览／打印此原型的全部实际页',page.getByTestId('aidt-prototype-text-binding')),requiredTexts:kind==='image'?[]:['等待信息比较'],sourceRevision:selected.revision});
    versions.push({kind,versionId:version.id,designId:id,seq:version.seq,textRevision:prototype.v2Revision,textSha256:relationship.textSha256,source:kind==='image'?'student-supplied-synthetic-file':version.source,actualInteractionChecked:kind==='webapp'});
  }
  const confirmed=await save(5,()=>click(btn('确认本原型')),{confirmation:true,operationId:`s5-${prototype.role}-prototype-confirm`,entityRole:prototype.role,entityId:id});await refresh(5,{expectedRevision:confirmed.receipt.revision,navigation:{role:prototype.role,phase:'prototype-confirmed-refresh'}});
  if(completeStage)await ui.completed(5);return {prototype,sourceImages,versions,selected:versions.at(-1),stage5Revision:confirmed.receipt.revision};
}

/** A real later native version, derived from this saved synthetic-feedback round; the tested object is immutable. */
export async function produceV2OfflineIterationVersion({ui,testTarget,prototype,entryLink,runNativeOperation,read,prepareSourceImages,capture}){
  const {page,expect,btn,click,stage,save}=ui,id=prototype.target.entityId,role=prototype.role;
  if(testTarget.path!=='offline'||testTarget.designId!==id||!entryLink||typeof prepareSourceImages!=='function')fail('V2_ITERATION_OWNED_OFFLINE_RETURN_REQUIRED');
  const source=await stage(6),group=JSON.parse(source.content.draft.fields['testGroup:'+testTarget.entityId]??'null'),pin=JSON.parse(source.content.draft.fields['testSyntheticAsr:'+testTarget.entityId]??'null');
  if(group?.versionId!==testTarget.versionId||group.stage5Revision!==testTarget.stage5Revision||group.prototypeEntity!==testTarget.prototypeEntity||!group.confirmedFromMessageId||group.evidenceOrigin!=='synthetic-file-asr'||!pin?.reviewedText?.trim())fail('V2_ITERATION_EXACT_SAVED_FEEDBACK_REQUIRED');
  const stable=JSON.stringify({group,questionSnapshot:source.content.draft.fields.questionSnapshot,asr:pin}),entry=new URL(await entryLink.getAttribute('href'),ui.origin);
  if(entry.origin!==ui.origin||entry.pathname!==ui.projectPath||entry.searchParams.get('step')!=='5'||entry.searchParams.get('entity')!==id||entry.searchParams.get('returnEntity')!==testTarget.entityId||!/^[1-9]\d*$/.test(entry.searchParams.get('returnRevision')??''))fail('V2_ITERATION_RETURN_NOT_BOUND_TO_SAME_TEST');
  await ui.performAction({actionId:'s5-'+role+'-iteration-from-offline',steps:[{operationId:'s5-'+role+'-entity-thread-iteration-from-offline',kind:'write',requestKind:'entity-thread',stageId:5,entityRole:role,entityId:id,method:'PUT',path:`/api/projects/${ui.scope.projectId}/aidt/stages/5/entities/${id}/thread`}],perform:()=>click(entryLink)});
  const designLink=page.getByRole('link',{name:'打开 Design 工作台',exact:true});await expect(designLink).toBeVisible();const designHref=new URL(await designLink.getAttribute('href'),ui.origin);
  if(designHref.origin!==ui.origin||designHref.pathname!==ui.projectPath||designHref.searchParams.get('entity')!==id||designHref.searchParams.get('resource')!==id||designHref.searchParams.get('returnEntity')!==testTarget.entityId||designHref.searchParams.get('returnRevision')!==entry.searchParams.get('returnRevision'))fail('V2_ITERATION_DESIGN_RETURN_CONTEXT_LOST');
  await ui.navigate({...prototype.target,href:designHref.href},{role,phase:'iteration-design-entry',tool:'design'});
  const images=await prepareSourceImages({designId:id,stage4Revision:prototype.stage4Revision,brainstormId:prototype.sourceRoundId,ideaIds:prototype.selectedIds});if(images.length!==3)fail('V2_ITERATION_ORIGINAL_SOURCE_IMAGES_MISSING');
  const list=async()=>{const response=await read(`/api/pm-designs/${id}/versions`);if(response.status!==200||!Array.isArray(response.data?.items))fail('V2_ITERATION_NATIVE_VERSION_READ_REQUIRED');return response.data.items;};const before=new Set((await list()).map(version=>version.id));
  const input=page.getByTestId('design-detail-input');await expect(input).toBeEditable();
  await input.fill(`QA ${ui.scope.runId} 合成软件验收迭代，非真人测试。依据本次已保存合成ASR摘录：${pin.reviewedText.slice(0,600)}。学生反思：${group.reflection.slice(0,350)}。请基于当前确认的文字V2及原三张来源图制作真正新的可操作HTML版本，不改原测试版本。显式显示标题“迭代版·待真实测试”，保留“预计等待5分钟”，将“查看其他选择”和“返回比较”做成可实际操作且易区分的按钮；查看后显示“可选方案”，返回后仍见等待信息。只改表达与操作流程，不声称真人满意、问题解决或已通过测试。`);
  await runNativeOperation({operationId:'s6-test-offline-iterate-prototype',kind:'design',stage:6,entityRole:'test-offline',entityId:testTarget.entityId,resourceId:id,perform:()=>click(page.getByTestId('design-detail-send'))});
  await expect(page.getByTestId('design-detail-generating')).toHaveCount(0,{timeout:900000});await expect(page.getByTestId('design-detail-chat-error')).toHaveCount(0);const canvas=page.getByTestId('design-detail-canvas');await expect(canvas).toBeVisible();const frame=canvas.frameLocator('iframe').first();await expect(frame.getByText('迭代版·待真实测试',{exact:true})).toBeVisible();await frame.getByRole('button',{name:'查看其他选择',exact:true}).click();await expect(frame.getByText('可选方案',{exact:true})).toBeVisible();await frame.getByRole('button',{name:'返回比较',exact:true}).click();await expect(frame.getByText('预计等待5分钟',{exact:true})).toBeVisible();
  const added=(await list()).filter(version=>!before.has(version.id));if(added.length!==1||added[0].source!=='model'||added[0].id===testTarget.versionId)fail('V2_ITERATION_REAL_NEW_VERSION_REQUIRED');const version=added[0];
  await ui.navigate(prototype.target,{role,phase:'iteration-design-return'});await click(btn('选择真实原型版本'));const picker=page.getByTestId('aidt-prototype-version-picker'),own=picker.getByRole('button',{name:prototype.name,exact:true});if(await own.count())await click(own);const versionButton=picker.getByRole('button').filter({hasText:'版本 ID：'+version.id});await expect(versionButton).toHaveCount(1);await save(5,()=>click(versionButton),{operationId:'s5-'+role+'-iteration-version-select',entityRole:role,entityId:id});
  const binding=page.getByTestId('aidt-prototype-text-binding');await click(btn('查看所选原型的确切版本',binding));await expect(binding).toContainText(version.id);await save(5,()=>click(btn('将此原型用于该确认设计稿',binding)),{operationId:'s5-'+role+'-iteration-basis-bind',entityRole:role,entityId:id});const confirmed=await save(5,()=>click(btn('确认本原型')),{confirmation:true,operationId:'s5-'+role+'-iteration-prototype-confirm',entityRole:role,entityId:id});await ui.refresh(5,{expectedRevision:confirmed.receipt.revision,navigation:{role,phase:'iteration-confirmed-refresh'}});
  const after=await stage(6),afterGroup=JSON.parse(after.content.draft.fields['testGroup:'+testTarget.entityId]??'null'),afterPin=JSON.parse(after.content.draft.fields['testSyntheticAsr:'+testTarget.entityId]??'null');if(stable!==JSON.stringify({group:afterGroup,questionSnapshot:after.content.draft.fields.questionSnapshot,asr:afterPin}))fail('V2_ITERATION_REWROTE_TESTED_VERSION_OR_QUESTION');
  const fields=v2PrototypeFields(confirmed.stage,id),reference=JSON.parse(fields.prototypeReference??'null'),links=JSON.parse(fields.prototypeTextOutputBindings??'[]');if(reference?.versionId!==version.id||!links.some(link=>link.versionId===version.id&&link.textStageRevision===prototype.v2Revision&&link.textSha256===prototype.basisSha256))fail('V2_ITERATION_NEW_VERSION_NOT_BOUND_TO_CONFIRMED_TEXT');
  await capture('v2-s5-new-iteration-keeps-old-tested-version',5);return {designId:id,versionId:version.id,seq:version.seq,stage5Revision:confirmed.receipt.revision,source:'model',testedVersionId:testTarget.versionId,testedStage5Revision:testTarget.stage5Revision,textStageRevision:prototype.v2Revision,stillPendingRealTest:true,actualInteractionChecked:true,sourceFeedbackSha256:pin.transcript.sha256};
}
