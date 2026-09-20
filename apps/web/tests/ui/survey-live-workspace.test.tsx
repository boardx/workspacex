import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SurveyRuntime } from '@repo/contracts/survey-runtime';
import { LiveSurveyWorkspace } from '@/components/survey/live/survey-workspace';
const request=vi.hoisted(()=>vi.fn());
const router=vi.hoisted(()=>({replace:vi.fn(),push:vi.fn()}));
vi.mock('@/lib/survey/runtime-client',()=>({surveyRequest:request}));
vi.mock('next/navigation',()=>({useRouter:()=>router}));
const runtime=(patch:Partial<SurveyRuntime>={}):SurveyRuntime=>({id:'saved-survey',title:'已保存问卷',version:4,updatedAt:'2026-09-20T10:00:00.000Z',questions:[{id:'q1',title:'真实问题',type:'single',chapterId:'general',order:1,required:true,options:['甲','乙']}],template:{id:'template',title:'模板报告',sections:[]},responses:[],publication:null,report:null,reportBasisVersion:null,reportGeneratedAt:null,...patch});
beforeEach(()=>{request.mockReset();router.replace.mockReset();router.push.mockReset();});
describe('live survey workspace persistence',()=>{
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
  expect(request).toHaveBeenLastCalledWith('/surveys/saved-survey',expect.objectContaining({method:'PUT',body:expect.objectContaining({title:'尚未保存的新标题',expectedVersion:4})}));
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
  await waitFor(()=>expect(request).toHaveBeenLastCalledWith('/surveys/saved-survey',expect.objectContaining({body:expect.objectContaining({expectedVersion:5})})));
 });
 it('marks an older report stale while preserving it and clears the warning after generation returns',async()=>{
  const report={id:'report',title:'上次生成报告',sections:[{id:'s',title:'真实章节',blocks:[]}],issues:[]};
  request.mockResolvedValueOnce(runtime({report,reportBasisVersion:2,reportGeneratedAt:'2026-09-19T10:00:00.000Z'})).mockResolvedValueOnce(runtime({version:5,report:{...report,title:'新生成报告'},reportBasisVersion:4,reportGeneratedAt:'2026-09-20T10:00:00.000Z'}));
  render(<LiveSurveyWorkspace surveyId="saved-survey" initialStep="report"/>);
  await screen.findByRole('heading',{name:'上次生成报告'});
  expect(screen.getByText(/当前展示上次生成的报告/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'重新生成报告'}));
  await screen.findByRole('heading',{name:'新生成报告'});
  expect(screen.queryByText(/当前展示上次生成的报告/)).not.toBeInTheDocument();
  expect(request).toHaveBeenLastCalledWith('/surveys/saved-survey/report',{method:'POST',body:{expectedVersion:4}});
 });
 it('does not replace a failed load with prototype questions',async()=>{
  request.mockRejectedValueOnce(new Error('问卷不存在或无访问权限'));
  render(<LiveSurveyWorkspace surveyId="private"/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('无访问权限');
  expect(screen.queryByTestId('survey-design-question-Q01')).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'新增题目'})).not.toBeInTheDocument();
 });
});
