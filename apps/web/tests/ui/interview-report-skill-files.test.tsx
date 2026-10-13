import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InterviewReportStep } from '@/components/itv/interview-report-step';
import { REPORT_FILE_FORMATS } from '@repo/contracts/report-files';
const api = vi.hoisted(() => ({generateReportFile:vi.fn(),getReportFileJob:vi.fn(),downloadReportFile:vi.fn()}));
vi.mock('@/lib/report-files-api',()=>api);
const document = {documentId:'canonical-doc',step:'report' as const,version:7,contentHash:'b'.repeat(64),evidenceMode:'simulated' as const,references:[],markdown:'# 当前中文报告\n\n已保存的正文与引用边界。'};
const props={interviewId:'actual-interview',revisionId:'revision-one',document,reportStatus:'draft' as const};
beforeEach(()=>{
 api.generateReportFile.mockImplementation(async(source,format)=>({id:'job-'+format,source,format,status:'succeeded',createdAt:'2026-10-13T00:00:00Z',skill:{stableName:REPORT_FILE_FORMATS[format as keyof typeof REPORT_FILE_FORMATS].skillStableName,versionId:'published-pin',digest:'a'.repeat(64)},file:{filename:'report'+REPORT_FILE_FORMATS[format as keyof typeof REPORT_FILE_FORMATS].extension,mediaType:REPORT_FILE_FORMATS[format as keyof typeof REPORT_FILE_FORMATS].mediaType,sizeBytes:200,sha256:'c'.repeat(64)}}));
});
afterEach(()=>{cleanup();vi.clearAllMocks();});
describe('interview report product Skill actions integration',()=>{
 it.each([['PDF','pdf'],['Word','docx'],['PPT','pptx']])('requests %s with persisted canonical identity, never browser export',async(label,format)=>{
  render(<InterviewReportStep {...props}/>);fireEvent.click(screen.getByRole('button',{name:`生成 ${label}`}));
  expect(await screen.findByRole('button',{name:`下载 ${label}`})).toBeEnabled();
  expect(api.generateReportFile).toHaveBeenCalledWith({kind:'interview',id:'actual-interview',reportVersion:7,reportHash:'b'.repeat(64)},format,expect.any(String),expect.any(AbortSignal));
  fireEvent.click(screen.getByRole('button',{name:`下载 ${label}`}));
  expect(api.downloadReportFile).toHaveBeenCalled();expect(screen.getByTestId('itv-source-report-markdown')).toHaveTextContent('已保存的正文');
 });
 it.each(['generating','failed',undefined] as const)('does not offer generation for state %s',status=>{
  render(<InterviewReportStep {...props} reportStatus={status}/>);for(const label of ['PDF','Word','PPT'])expect(screen.getByRole('button',{name:`生成 ${label}`})).toBeDisabled();
 });
 it('clears a completed file on revision ABA even when document version and hash match',async()=>{
  const r=render(<InterviewReportStep {...props}/>);fireEvent.click(screen.getByRole('button',{name:'生成 Word'}));await screen.findByRole('button',{name:'下载 Word'});
  r.rerender(<InterviewReportStep {...props} revisionId="revision-two"/>);
  expect(screen.queryByRole('button',{name:'下载 Word'})).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'生成 Word'}));await screen.findByRole('button',{name:'下载 Word'});expect(api.generateReportFile).toHaveBeenCalledTimes(2);
 });
 it('shows generation failure without discarding canonical body',async()=>{
  api.generateReportFile.mockRejectedValueOnce(new Error('generation unavailable'));render(<InterviewReportStep {...props}/>);fireEvent.click(screen.getByRole('button',{name:'生成 PDF'}));expect(await screen.findByRole('alert')).toBeVisible();expect(screen.getByTestId('itv-source-report-markdown')).toHaveTextContent('已保存的正文');expect(screen.getByRole('button',{name:'重新生成 PDF'})).toBeEnabled();
 });
});
