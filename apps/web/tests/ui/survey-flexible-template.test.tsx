import React from 'react';
import { describe,it,expect,vi } from 'vitest';
import { render,screen,fireEvent } from '@testing-library/react';
import { FlexibleReportEditor } from '@/components/survey/report/template-editor';
import type { survey } from '@repo/contracts';
vi.mock('@/components/survey/report/report-document',()=>({SurveyReportDocument:()=> <div>报告预览</div>}));
function Harness({readonly=false}:{readonly?:boolean}) {
 const [template,setTemplate]=React.useState<survey.SurveyReportTemplate>({id:'template',title:'测试报告',sections:[{id:'s1',title:'第一章',blocks:[]}]});
 return <><FlexibleReportEditor template={template} onChange={setTemplate} questions={[]} responses={[]} readonly={readonly}/><output data-testid="value">{JSON.stringify(template)}</output></>;
}
describe('flexible report template',()=>{
 it('adds, copies and reorders independent chapters',()=>{
  render(<Harness/>);
  fireEvent.click(screen.getByRole('button',{name:'新增章节'}));
  fireEvent.change(screen.getByLabelText('章节标题'),{target:{value:'第二章'}});
  fireEvent.click(screen.getByRole('button',{name:'复制章节'}));
  const data=JSON.parse(screen.getByTestId('value').textContent!);
  expect(data.sections).toHaveLength(3);
  expect(new Set(data.sections.map((s:{id:string})=>s.id)).size).toBe(3);
  fireEvent.click(screen.getByRole('button',{name:'章节上移'}));
  expect(JSON.parse(screen.getByTestId('value').textContent!).sections[1].title).toBe('第二章 副本');
 });
 it('allows mixed content blocks and editable text',()=>{
  render(<Harness/>);
  fireEvent.click(screen.getByRole('button',{name:'添加文字说明'}));
  fireEvent.change(screen.getByLabelText('正文'),{target:{value:'实际分析说明'}});
  fireEvent.click(screen.getByRole('button',{name:'添加数据表'}));
  const blocks=JSON.parse(screen.getByTestId('value').textContent!).sections[0].blocks;
  expect(blocks.map((b:{type:string})=>b.type)).toEqual(['text','table']);
  expect(blocks[0].text).toBe('实际分析说明');
 });
 it('does not expose mutations in readonly mode',()=>{
  render(<Harness readonly/>);
  expect(screen.queryByRole('button',{name:'新增章节'})).toBeNull();
  expect(screen.getByLabelText('报告标题')).toHaveProperty('readOnly',true);
 });
});
