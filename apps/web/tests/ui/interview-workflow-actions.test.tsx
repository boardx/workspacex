import * as React from 'react';
import { cleanup,render,screen,fireEvent,waitFor } from '@testing-library/react';
import { afterEach,it,expect,vi } from 'vitest';
import { InterviewRunsStep } from '@/components/itv/interview-runs-step';
import { InterviewIntakeStep } from '@/components/itv/interview-intake-step';
import { InterviewExpertsStep } from '@/components/itv/interview-experts-step';
import { InterviewOutlineStep } from '@/components/itv/interview-outline-step';
import { InterviewRevisionAction } from '@/components/itv/interview-step-header';
import { WorkflowActionButton } from '@/components/research-studio/research-workflow-actions';
vi.mock('@/lib/interview-expert-library-api',()=>({loadCustomInterviewExperts:async()=>({items:[]})}));
afterEach(cleanup);
const document={documentId:'experts',step:'experts' as const,version:1,contentHash:'a'.repeat(64),evidenceMode:'simulated' as const,references:[],markdown:'# 专家\n\n## [模拟专家](#expert-virtual-actions)\n\n模拟角色。'};
it('keeps one revision and confirmation footer and blocks duplicate confirmation while truly working',async()=>{
 let complete!:()=>void;const onConfirm=vi.fn(()=>new Promise<void>(resolve=>{complete=resolve;}));
 render(<InterviewRevisionAction.Provider value={<WorkflowActionButton>创建新修订并修改</WorkflowActionButton>}><InterviewIntakeStep markdown="# 需求" onChange={vi.fn()} onConfirm={onConfirm} pending={false}/></InterviewRevisionAction.Provider>);
 const footer=screen.getByTestId('itv-step-actions');expect(footer).toHaveAttribute('data-workflow-action-bar','footer');expect(footer.querySelectorAll('[data-workflow-action-bar]')).toHaveLength(0);
 expect(screen.getAllByRole('button',{name:'创建新修订并修改'})).toHaveLength(1);
 fireEvent.click(screen.getByRole('button',{name:'下一步：确认分析'}));const busy=await screen.findByRole('button',{name:'正在处理…'});expect(busy).toBeDisabled();expect(busy).toHaveAttribute('aria-busy','true');expect(busy.querySelectorAll('.animate-spin')).toHaveLength(1);fireEvent.click(busy);expect(onConfirm).toHaveBeenCalledTimes(1);complete();await waitFor(()=>expect(screen.getByRole('button',{name:'下一步：确认分析'})).toBeEnabled());
});
it('does not confuse read-only expert controls with active loading',async()=>{
 render(<InterviewExpertsStep document={document} directory={[]} pending loading={false} onChange={vi.fn()} onConfirm={vi.fn()}/>);
 const confirm=screen.getByRole('button',{name:'确认专家并生成问题'});expect(confirm).toBeDisabled();expect(confirm).not.toHaveAttribute('aria-busy','true');expect(confirm.querySelector('.animate-spin')).toBeNull();
 expect(screen.getByTestId('itv-step-header').querySelector('button')).toBeNull();expect(confirm.closest('[data-workflow-action-bar]')).toBe(screen.getByTestId('itv-step-actions'));
 await screen.findByText('暂无匹配的自建专家画像。');
});
it('uses the same footer for question actions without moving local delete controls',()=>{
 render(<InterviewOutlineStep document={{...document,step:'outline',markdown:'# 问题\n\n## [模拟专家](#expert-virtual-actions)\n\n1. 谁负责预算？'}} pending={false} onChange={vi.fn()} onSave={vi.fn()} onConfirm={vi.fn()} onGenerate={vi.fn()}/>);
 const footer=screen.getByTestId('itv-step-actions');expect(footer).toHaveAttribute('data-workflow-action-bar','footer');expect(footer.lastElementChild).toHaveTextContent('确认问题并开始访谈');expect(screen.getByRole('button',{name:'删除问题 1'}).closest('[data-workflow-action-bar]')).toBeNull();
});

it('keeps report generation idle while a simulation command is pending',()=>{
 const {rerender}=render(<InterviewRunsStep runs={[]} pending onGenerateReport={vi.fn()}/>);
 const button=screen.getByRole('button',{name:/^生成报告$/});expect(button).toBeDisabled();expect(button).not.toHaveAttribute('aria-busy','true');expect(button.querySelector('.animate-spin')).toBeNull();
 rerender(<InterviewRunsStep runs={[]} pending generatingReport onGenerateReport={vi.fn()}/>);
 expect(screen.getByRole('button',{name:'正在生成报告…'})).toHaveAttribute('aria-busy','true');
});

it('focuses only the newly added question and selects its placeholder for immediate typing', async()=>{
 function Harness(){const [markdown,setMarkdown]=React.useState('# 问题\n\n## [模拟专家](#expert-virtual-actions)\n\n1. 谁负责预算？\n');return <InterviewOutlineStep document={{...document,step:'outline',markdown}} pending={false} onChange={setMarkdown} onSave={vi.fn()} onConfirm={vi.fn()} onGenerate={vi.fn()}/>;}
 render(<Harness/>);
 const first=screen.getByRole('textbox',{name:'编辑问题 1'}) as HTMLInputElement;first.focus();fireEvent.change(first,{target:{value:'谁负责最终预算？'}});expect(first).toHaveFocus();
 const add=screen.getByRole('button',{name:'添加问题'});add.focus();fireEvent.click(add);
 const created=screen.getByRole('textbox',{name:'编辑问题 2'}) as HTMLInputElement;
 await waitFor(()=>expect(created).toHaveFocus());
 expect(created.value.slice(created.selectionStart??0,created.selectionEnd??0)).toBe('新问题？');
 expect(first).toHaveValue('谁负责最终预算？');
});

it('allows wrapped long-question editing while keeping each question one canonical line',()=>{
 const onChange=vi.fn();
 render(<InterviewOutlineStep document={{...document,step:'outline',markdown:'# 问题\n\n## [模拟专家](#expert-virtual-actions)\n\n1. 谁负责预算审批与跨部门协作？'}} pending={false} onChange={onChange} onSave={vi.fn()} onConfirm={vi.fn()} onGenerate={vi.fn()}/>);
 const question=screen.getByRole('textbox',{name:'编辑问题 1'});
 expect(question.tagName).toBe('TEXTAREA');
 fireEvent.change(question,{target:{value:'谁负责\n预算？'}});
 expect(onChange).toHaveBeenCalledWith('# 问题\n\n## [模拟专家](#expert-virtual-actions)\n\n1. 谁负责预算？');
});
