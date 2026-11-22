/** The system report is produced, adopted, saved and confirmed through the real report UI. */
import { createHash } from 'node:crypto';
import { ProbeFailure } from './devapp-aidt-auth-readonly.mjs';
import { V2_SYNTHETIC } from './devapp-aidt-v2-ui.mjs';
const fail=code=>{throw new ProbeFailure(code);};
const sha=value=>createHash('sha256').update(value).digest('hex');
export async function runV2GroupReport({ui,report,teachingFeedback,saveReport,reviewAndSave,saveDownload,printFormal,capture,prototype}) {
  const {page,expect,go,btn,click,stage}=ui;
  await go(6,{summary:'1'});
  const open=page.getByRole('link',{name:'打开小组研究报告',exact:true});await expect(open).toBeVisible();await ui.performAction({actionId:'s6-group-report-normal-open',steps:[{operationId:'s6-group-report-entity-thread-initial',kind:'write',requestKind:'entity-thread',stageId:6,entityRole:'group-report',entityId:'group-report',method:'PUT',path:`/api/projects/${ui.scope.projectId}/aidt/stages/6/entities/group-report/thread`,captureThread:true},{operationId:'s6-group-report-thread-mount',kind:'write',requestKind:'thread-mount',stageId:6,entityRole:'group-report',entityId:'group-report',method:'POST',path:'/api/threads/{createdThread}/skill-mounts'}],perform:()=>open.click()});
  await page.waitForURL(url=>url.searchParams.get('entity')==='group-report'&&url.searchParams.get('summaryThread')?.startsWith('thr'));
  const target=ui.route(6),outcome=new URL(target.href);outcome.searchParams.set('tool','report');await ui.navigate(target,{role:'group-report',phase:'outcome-initial',tool:'report'});
  const before=await stage(6),prompt=`${V2_SYNTHETIC}。请依据本组已保存确认的六阶段成果与确切来源版本，生成一份研究报告草稿。保留选题理由与猜测状态、人物发现与原件、意外发现或暂无、画像与HMW、两轮分类及选择、原型文字V2与实际原型版本、三条研究路径和认识变化/返回步骤。模拟研究必须标模拟，合成音频不是真人反馈，缺失真人测试写明缺失；不宣布方案已验证，不自动保存或确认。列每个实际证据及版本来源。`;
  if(!await teachingFeedback(6,prompt))fail('V2_REPORT_REAL_MODEL_REPLY_REQUIRED');
  const proof=report.teachingEvidence.findLast(row=>row.entityId==='group-report'&&row.prompt===prompt&&row.status==='passed');
  if(!proof?.assistantMessageId||!proof.sourceRevisions?.length)fail('V2_REPORT_REAL_SOURCE_RECEIPT_REQUIRED');
  await ui.unchanged(6,before);
  const actions=page.getByTestId('aidt-report-chat-actions');await click(btn('采用报告草稿',actions));
  // Adoption edits the report buffer only. A separate explicit save must receive the server revision.
  await ui.unchanged(6,before);await ui.save(6,()=>click(actions.getByTestId('aidt-report-save')),{operationId:'s6-group-report-save',entityRole:'group-report',entityId:'group-report'});
  const saved=await stage(6),savedReport=saved.content.summaryReport;
  if(!savedReport?.markdown?.includes(V2_SYNTHETIC)||savedReport.confirmedAtRevision)fail('V2_REPORT_DRAFT_SAVE_BOUNDARY_INVALID');
  await ui.save(6,()=>click(btn('确认小组报告',actions)),{confirmation:true,operationId:'s6-group-report-confirm',entityRole:'group-report',entityId:'group-report'});
  const confirmed=await stage(6),formal=confirmed.content.summaryReport;
  if(!formal?.confirmedAtRevision||formal.markdown!==savedReport.markdown)fail('V2_REPORT_CONFIRMATION_NOT_READ_BACK');
  await ui.refresh(6,{expectedRevision:confirmed.revision,navigation:{role:'group-report',phase:'saved-refresh'}});await expect(page.getByTestId('aidt-report-save-state')).toContainText('已确认');
  await ui.expand('已确认版本与导出');await click(page.getByRole('button',{name:`查看确认版 V${formal.confirmedAtRevision}`,exact:true}));
  const body=page.getByRole('article',{name:'已确认报告正文',exact:true});await expect(body).toContainText(V2_SYNTHETIC);
  for(const token of ['画像','HMW','原型','测试'])await expect(body).toContainText(token);
  const sources=page.getByRole('list',{name:'确认版本来源',exact:true});await expect(sources).toBeVisible();
  const sourceClicks=[];
  for(let n=1;n<=6;n++) {
    const source=proof.sourceRevisions.find(row=>row.stageId===n);if(!source)fail('V2_REPORT_SIX_STAGE_SOURCE_REQUIRED');
    await click(sources.getByRole('button',{name:`查看第 ${n} 步 V${source.revision}`,exact:true}));
    const detail=page.locator('[aria-label="来源版本详情"]');
    await expect(page.getByText(`第 ${n} 步 V${source.revision}`,{exact:false}).last()).toBeVisible();
    sourceClicks.push({stage:n,revision:source.revision,actualClick:true});
  }
  const [download]=await Promise.all([page.waitForEvent('download'),click(page.getByRole('button',{name:`下载 V${formal.confirmedAtRevision} Markdown`,exact:true}))]);
  await saveDownload(download);if(await download.failure())fail('V2_REPORT_DOWNLOAD_FAILED');
  const stream=await download.createReadStream();if(!stream)fail('V2_REPORT_DOWNLOAD_UNREADABLE');let size=0;const chunks=[];
  for await(const chunk of stream){size+=chunk.length;if(size>1000000)fail('V2_REPORT_DOWNLOAD_TOO_LARGE');chunks.push(chunk);}
  const bytes=Buffer.concat(chunks),text=bytes.toString('utf8');if(text!==formal.markdown)fail('V2_REPORT_DOWNLOAD_NOT_CONFIRMED_BODY');
  await capture('v2-report-confirmed-source-versions',6);
  const printing=await printFormal({stage:6,name:'confirmed-group-report',entityId:'group-report',button:page.getByRole('button',{name:`打印 V${formal.confirmedAtRevision} PDF`,exact:true}),requiredTexts:[V2_SYNTHETIC,'原型'],sourceRevision:formal.confirmedAtRevision});
  return {target:{...target,href:outcome.href},confirmedRevision:formal.confirmedAtRevision,markdownSha256:sha(text),bytes:size,sourceClicks,printing,proof,prototypeTextV2:prototype?.v2Revision??null};
}
