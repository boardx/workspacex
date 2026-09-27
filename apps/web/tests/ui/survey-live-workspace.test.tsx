import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SurveyRuntime } from '@repo/contracts/survey-runtime';
import { LiveSurveyWorkspace } from '@/components/survey/live/survey-workspace';
const request=vi.hoisted(()=>vi.fn());
const router=vi.hoisted(()=>({replace:vi.fn(),push:vi.fn()}));
vi.mock('@/lib/survey/runtime-client',async(importOriginal)=>({...(await importOriginal<typeof import('@/lib/survey/runtime-client')>()),surveyRequest:request}));
vi.mock('next/navigation',()=>({useRouter:()=>router}));
const runtime=(patch:Partial<SurveyRuntime>={}):SurveyRuntime=>({id:'saved-survey',title:'已保存问卷',version:4,status:'draft',anonymity:'anonymous',answerRevision:0,reportBasisAnswerRevision:null,updatedAt:'2026-09-20T10:00:00.000Z',questions:[{id:'q1',title:'真实问题',type:'single',chapterId:'general',order:1,required:true,options:['甲','乙']}],template:{id:'template',title:'模板报告',sections:[]},responses:[],publication:null,report:null,reportBasisVersion:null,reportGeneratedAt:null,...patch});
beforeEach(()=>{request.mockReset();router.replace.mockReset();router.push.mockReset();});
describe('live survey workspace persistence',()=>{
 it('does not manually save or publish valid Markdown before explicit application',async()=>{
  request.mockResolvedValueOnce(runtime());render(<LiveSurveyWorkspace surveyId="saved-survey"/>);
  const source=await screen.findByLabelText('问卷 Markdown');
  fireEvent.change(source,{target:{value:'# 待校对\n\n## q2 [open]\n未确认的问题\n'}});
  fireEvent.click(screen.getByRole('button',{name:'保存修改'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('请先校对并应用 Markdown');
  expect(request).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button',{name:'前往发布回收'}));
  fireEvent.click(screen.getByRole('button',{name:'检查发布条件'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('请先校对并应用 Markdown');
  expect(request).toHaveBeenCalledTimes(1);
 });
 it('keeps visual editing enabled while replacing a question title',async()=>{
  request.mockResolvedValueOnce(runtime());render(<LiveSurveyWorkspace surveyId="saved-survey"/>);
  const title=await screen.findByLabelText('问题内容');
  fireEvent.change(title,{target:{value:''}});
  expect(title).toBeEnabled();
  fireEvent.change(title,{target:{value:'新问题 '}});
  expect(title).toBeEnabled();
 });
 it('shows the prototype design preview beside question settings and a clear publish action',async()=>{
  request.mockResolvedValueOnce(runtime());render(<LiveSurveyWorkspace surveyId="saved-survey"/>);
  expect(await screen.findByRole('complementary',{name:'实时预览'})).toBeInTheDocument();
  expect(screen.getByRole('region',{name:'题目设置'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'前往发布回收'}));
  expect(screen.getByRole('button',{name:'检查发布条件'})).toBeInTheDocument();
 });
 it('accepts a successful published template save without a second GET',async()=>{
  const original=runtime({publication:{token:'token',status:'collecting',version:4,expiresAt:'2026-10-20T10:00:00.000Z',questions:runtime().questions}});
  request.mockResolvedValueOnce(original).mockResolvedValueOnce({...original,version:5,template:{...original.template,title:'更新报告'}});
  render(<LiveSurveyWorkspace surveyId="saved-survey" initialStep="template"/>);
  fireEvent.change(await screen.findByLabelText('报告标题'),{target:{value:'更新报告'}});
  fireEvent.click(screen.getByRole('button',{name:'保存修改'}));
  await screen.findByText('报告模板已保存');
  expect(request).toHaveBeenCalledTimes(2);
 });
 it('locks projected question edits until changed Markdown is applied',async()=>{
  request.mockResolvedValueOnce(runtime());
  render(<LiveSurveyWorkspace surveyId="saved-survey"/>);
  const source=await screen.findByLabelText('问卷 Markdown');
  fireEvent.change(source,{target:{value:'# 导入内容\n\n## q2 [open]\n新问题\n'}});
  expect(screen.getByRole('button',{name:'新增题目'})).toBeDisabled();
  expect(source).toHaveValue('# 导入内容\n\n## q2 [open]\n新问题\n');
 });
 it('preserves the local report template when keeping the local version after a conflict',async()=>{
  const {SurveyConflictError}=await import('@/lib/survey/runtime-client');
  const remote=runtime({version:5,template:{id:'remote',title:'远端报告模板',sections:[]}});
  request.mockResolvedValueOnce(runtime()).mockRejectedValueOnce(new SurveyConflictError(null)).mockResolvedValueOnce(remote).mockResolvedValueOnce({...remote,version:6});
  render(<LiveSurveyWorkspace surveyId="saved-survey"/>);
  await screen.findByLabelText('问卷 Markdown');
  fireEvent.change(screen.getByLabelText('问卷名称'),{target:{value:'本地设计'}});
  fireEvent.click(screen.getByRole('button',{name:'保存修改'}));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button',{name:'读取最新版本并保留我的修改'}));
  fireEvent.click(await screen.findByRole('button',{name:'确认保留本地版本'}));
  fireEvent.click(screen.getByRole('button',{name:'保存修改'}));
  await screen.findByText('修改已保存');
  expect(request).toHaveBeenLastCalledWith('/surveys/saved-survey/source',expect.objectContaining({body:expect.objectContaining({expectedVersion:5,documents:expect.objectContaining({reportTemplate:expect.stringContaining('模板报告')})})}),expect.anything());
 });
 it('inserts replacement tokens in survey names literally',async()=>{
  request.mockResolvedValueOnce(runtime());render(<LiveSurveyWorkspace surveyId="saved-survey"/>);
  fireEvent.change(await screen.findByLabelText('问卷名称'),{target:{value:'标题 $& 测试'}});
  expect((screen.getByLabelText('问卷 Markdown') as HTMLTextAreaElement).value).toContain('# 标题 $& 测试');
 });
 it('reuses the created draft when saving its source fails',async()=>{
  request.mockResolvedValueOnce(runtime({id:'created-draft',version:1,title:'未命名问卷'})).mockRejectedValueOnce(new Error('源文档暂时保存失败'));
  render(<LiveSurveyWorkspace surveyId="new"/>);
  fireEvent.click(await screen.findByRole('button',{name:'保存修改'}));
  await screen.findByRole('alert');
  expect(router.replace).toHaveBeenCalledWith('/studio/survey/created-draft?step=design');
  request.mockResolvedValueOnce(runtime({id:'created-draft',version:2,title:'未命名问卷'}));
  fireEvent.click(screen.getByRole('button',{name:'保存修改'}));
  await screen.findByText('修改已保存');
  expect(request.mock.calls.filter(([path,options])=>path==='/surveys' && options?.method==='POST')).toHaveLength(1);
 });
 it('loads the conflicting remote version without discarding local Markdown',async()=>{
  const {SurveyConflictError}=await import('@/lib/survey/runtime-client');
  request.mockResolvedValueOnce(runtime()).mockRejectedValueOnce(new SurveyConflictError(null)).mockResolvedValueOnce(runtime({version:5,title:'其他人的修改'}));
  render(<LiveSurveyWorkspace surveyId="saved-survey"/>);
  await screen.findByDisplayValue('已保存问卷');
  fireEvent.change(screen.getByLabelText('问卷名称'),{target:{value:'我的修改'}});
  fireEvent.click(screen.getByRole('button',{name:'保存修改'}));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button',{name:'读取最新版本并保留我的修改'}));
  expect((await screen.findByLabelText('远端 Markdown') as HTMLTextAreaElement).value).toContain('# 其他人的修改');
  expect((screen.getByLabelText('问卷 Markdown') as HTMLTextAreaElement).value).toContain('# 我的修改');
  expect(screen.getByRole('button',{name:'确认保留本地版本'})).toBeEnabled();
 });
 it('keeps only the three primary steps and rejects invalid Markdown without saving',async()=>{
  request.mockResolvedValueOnce(runtime());
  render(<LiveSurveyWorkspace surveyId="saved-survey"/>);
  await screen.findByDisplayValue('已保存问卷');
  const workflow=screen.getByRole('navigation',{name:'问卷工作流'});
  expect(workflow.querySelectorAll('button')).toHaveLength(3);
  expect(workflow).toHaveTextContent('1. 设计问卷');
  expect(workflow).toHaveTextContent('2. 发布回收');
  expect(workflow).toHaveTextContent('3. 查看答卷');
  fireEvent.change(screen.getByLabelText('问卷 Markdown'),{target:{value:'没有标题的无效文档'}});
  fireEvent.click(screen.getByRole('button',{name:'保存修改'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('第');
  expect(request).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('问卷 Markdown')).toHaveValue('没有标题的无效文档');
 });
 it('retains unsaved inputs when saving fails and never shows a success notice',async()=>{
  request.mockResolvedValueOnce(runtime()).mockRejectedValueOnce(new Error('版本冲突，请刷新后重试'));
  render(<LiveSurveyWorkspace surveyId="saved-survey"/>);
  await screen.findByDisplayValue('已保存问卷');
  fireEvent.change(screen.getByLabelText('问卷名称'),{target:{value:'尚未保存的新标题'}});
  fireEvent.click(screen.getByRole('button',{name:'保存修改'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('版本冲突');
  expect(screen.getByLabelText('问卷名称')).toHaveValue('尚未保存的新标题');
  expect(screen.getByText('有未保存修改')).toBeInTheDocument();
  expect(screen.queryByText('修改已保存')).not.toBeInTheDocument();
  expect(request).toHaveBeenLastCalledWith('/surveys/saved-survey/source',expect.objectContaining({method:'PUT',body:expect.objectContaining({expectedVersion:4,documents:expect.objectContaining({design:expect.stringContaining('# 尚未保存的新标题')})})}),expect.anything());
 });
 it('accepts only the returned saved runtime, including its canonical title and version',async()=>{
  request.mockResolvedValueOnce(runtime()).mockResolvedValueOnce(runtime({title:'服务端保存的标题',version:5}));
  render(<LiveSurveyWorkspace surveyId="saved-survey"/>);
  await screen.findByDisplayValue('已保存问卷');
  fireEvent.change(screen.getByLabelText('问卷名称'),{target:{value:'提交的标题'}});
  fireEvent.click(screen.getByRole('button',{name:'保存修改'}));
  await screen.findByText('修改已保存');
  expect(screen.getByLabelText('问卷名称')).toHaveValue('服务端保存的标题');
  expect(screen.getByRole('button',{name:'保存修改'})).toBeDisabled();
  fireEvent.change(screen.getByLabelText('问卷名称'),{target:{value:'再次修改'}});
  request.mockResolvedValueOnce(runtime({version:6,title:'再次修改'}));
  fireEvent.click(screen.getByRole('button',{name:'保存修改'}));
  await waitFor(()=>expect(request).toHaveBeenCalledWith('/surveys/saved-survey/source',expect.objectContaining({body:expect.objectContaining({expectedVersion:5})}),expect.anything()));
 });
 it('marks an older report stale while preserving it and clears the warning after generation returns',async()=>{
  const report={id:'report',title:'上次生成报告',sections:[{id:'s',title:'真实章节',blocks:[]}],issues:[]};
  request.mockResolvedValueOnce(runtime({report,reportBasisVersion:3,answerRevision:1,reportBasisAnswerRevision:0,reportGeneratedAt:'2026-09-19T10:00:00.000Z'})).mockResolvedValueOnce(runtime({version:5,answerRevision:1,reportBasisAnswerRevision:1,report:{...report,title:'新生成报告'},reportBasisVersion:4,reportGeneratedAt:'2026-09-20T10:00:00.000Z'}));
  render(<LiveSurveyWorkspace surveyId="saved-survey" initialStep="report"/>);
  await screen.findByRole('heading',{name:'上次生成报告'});
  expect(screen.getByText(/当前展示上次生成的报告/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'重新生成报告'}));
  await screen.findByRole('heading',{name:'新生成报告'});
  expect(screen.queryByText(/当前展示上次生成的报告/)).not.toBeInTheDocument();
  expect(request).toHaveBeenLastCalledWith('/surveys/saved-survey/report',{method:'POST',body:{expectedVersion:4}},expect.anything());
 });
 it('keeps exports disabled with a clear privacy reason until the report reaches the sharing threshold',async()=>{
  const report={id:'report',title:'受保护报告',issues:[],sampleSummary:{total:4,pendingReview:0,excluded:1,included:3},sections:[{id:'s',title:'章节',blocks:[]}]};
  request.mockResolvedValueOnce(runtime({report,reportBasisVersion:4,reportBasisAnswerRevision:0}));
  render(<LiveSurveyWorkspace surveyId="saved-survey" initialStep="report"/>);
  expect(await screen.findByTestId('survey-report-share-privacy-warning')).toHaveTextContent('纳入分析的样本不足 8 份');
  expect(screen.getByRole('button',{name:'导出 Word'})).toBeDisabled();
  expect(screen.getByRole('button',{name:'导出 PDF'})).toBeDisabled();
 });
 it('keeps the respondent collection link available while a small report is protected',async()=>{
  const report={id:'report',title:'受保护报告',issues:[],sampleSummary:{total:1,pendingReview:0,excluded:0,included:1},sections:[{id:'s',title:'章节',blocks:[]}]};
  request.mockResolvedValueOnce(runtime({status:'collecting',report,publication:{token:'collecting-link',status:'collecting',version:4,expiresAt:'2026-10-20T10:00:00.000Z',questions:[{id:'q1',title:'真实问题',type:'single',chapterId:'general',order:1,required:true,options:['甲','乙']}]}}));
  render(<LiveSurveyWorkspace surveyId="saved-survey" initialStep="publish"/>);
  expect(await screen.findByLabelText('答题链接')).toHaveValue('http://localhost:3000/surveys/collecting-link');
  expect(screen.getByRole('button',{name:'复制答题链接'})).toBeEnabled();
  expect(screen.getByRole('region',{name:'回收数据'})).toHaveTextContent('已收到答卷');
  expect(screen.getByRole('region',{name:'回收设置'})).toHaveTextContent('发布版本 v4');
  expect(screen.getByRole('region',{name:'最近回收动态'})).toHaveTextContent('暂无答卷');
 });
 it('does not replace a failed load with prototype questions',async()=>{
  request.mockRejectedValueOnce(new Error('问卷不存在或无访问权限'));
  render(<LiveSurveyWorkspace surveyId="private"/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('无访问权限');
  expect(screen.queryByTestId('survey-design-question-Q01')).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'新增题目'})).not.toBeInTheDocument();
 });
 it('sends an explicit reason when excluding a response from analysis',async()=>{
  const response={id:'answer-1',analysis:'included' as const,quality:'normal' as const,role:'未填写',companySize:'未填写',submittedAt:'2026-09-20T11:00:00.000Z',durationSeconds:20,answers:[{questionId:'q1',value:'甲'}]};
  request.mockResolvedValueOnce(runtime({status:'closed',responses:[response]})).mockResolvedValueOnce(runtime({status:'closed',version:5,responses:[{...response,analysis:'excluded',exclusionReason:'重复测试提交'}]}));
  render(<LiveSurveyWorkspace surveyId="saved-survey" initialStep="responses"/>);
  fireEvent.click(await screen.findByRole('button',{name:'查看完整答卷'}));
  fireEvent.change(screen.getByLabelText('排除分析原因'),{target:{value:'重复测试提交'}});
  fireEvent.click(screen.getByRole('button',{name:'排除分析'}));
  await waitFor(()=>expect(request).toHaveBeenLastCalledWith('/surveys/saved-survey/responses/answer-1',{
    method:'PATCH',body:{expectedVersion:4,analysis:'excluded',exclusionReason:'重复测试提交'},
  }));
  expect(await screen.findByText('排除原因：重复测试提交')).toBeInTheDocument();
 });
});
