import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PublicSurveyForm } from '@/components/survey/live/public-survey-form';
const request=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/survey/runtime-client',()=>({surveyRequest:request}));
const published={id:'survey',title:'匿名调研',version:1,expiresAt:'2026-12-01T00:00:00.000Z',questions:[{id:'multi',title:'选择工具',type:'multi',chapterId:'general',order:1,required:true,options:['工具甲','工具乙']}]};
beforeEach(()=>request.mockReset());
describe('public survey submission',()=>{
 it('requires at least one answer for a required multi-choice question before submitting',async()=>{
  request.mockResolvedValue(published);
  render(<PublicSurveyForm token="public-token"/>);
  await screen.findByRole('checkbox',{name:'工具甲'});
  fireEvent.submit(screen.getByRole('button',{name:'提交答卷'}).closest('form')!);
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent(/必答|至少|请选择/));
  expect(request).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/提交成功/)).not.toBeInTheDocument();
 });
 it('keeps answers after a rejected submission and shows success only after the retry response',async()=>{
  request.mockResolvedValueOnce(published).mockRejectedValueOnce(new Error('暂时无法提交，请重试'));
  render(<PublicSurveyForm token="public-token"/>);
  fireEvent.click(await screen.findByRole('checkbox',{name:'工具甲'}));
  fireEvent.click(screen.getByRole('button',{name:'提交答卷'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法提交');
  expect(screen.getByRole('checkbox',{name:'工具甲'})).toBeChecked();
  expect(screen.queryByText(/提交成功/)).not.toBeInTheDocument();
  let resolve!:(value:unknown)=>void;request.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
  fireEvent.click(screen.getByRole('button',{name:'提交答卷'}));
  expect(screen.getByRole('button',{name:'正在提交…'})).toBeDisabled();
  expect(screen.queryByText(/提交成功/)).not.toBeInTheDocument();
  resolve({accepted:true});
  expect(await screen.findByRole('status')).toHaveTextContent('提交成功');
  const first=request.mock.calls[1]!,retry=request.mock.calls[2]!;
  expect(first[0]).toBe('/public/surveys/public-token/responses');
  expect(first[1]).toMatchObject({method:'POST',sessionToken:null,body:{answers:[{questionId:'multi',value:['工具甲']}]}});
  expect(retry[1].body.submissionId).toBe(first[1].body.submissionId);
 });
});
