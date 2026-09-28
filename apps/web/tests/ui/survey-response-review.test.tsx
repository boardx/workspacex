import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { LiveResponseList } from '@/components/survey/live/response-list';
const question={id:'q1',order:1,chapterId:'general',title:'真实问题',type:'open' as const,required:false,options:[]};
const answer={id:'included-answer',submittedAt:'2026-09-21T00:00:00Z',durationSeconds:20,quality:'normal' as const,analysis:'included' as const,role:'未填写',companySize:'未填写',answers:[{questionId:'q1',value:'真实回答'}]};
it('separates excluded analysis from normal quality and shows adjacent real details',()=>{
 render(<LiveResponseList responses={[answer,{...answer,id:'excluded-answer',analysis:'excluded',exclusionReason:'测试提交'}]} questions={[question]} busy={false} onReview={vi.fn()} onAnalysis={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'已排除分析 1'}));
 const list=screen.getByRole('region',{name:'答卷列表'});
 expect(within(list).getAllByRole('button',{name:'查看完整答卷'})).toHaveLength(1);
 expect(list).toHaveTextContent('excluded-ans');
 fireEvent.click(within(list).getByRole('button',{name:'查看完整答卷'}));
 expect(screen.getByRole('region',{name:'答卷详情'})).toHaveTextContent('真实回答');
 expect(screen.getByRole('region',{name:'答卷详情'})).toHaveTextContent('测试提交');
 expect(screen.getByTestId('survey-response-review-layout')).toHaveClass('xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]');
});
it('switches between real quality groups and adjacent response details',()=>{
 render(<LiveResponseList responses={[answer,{...answer,id:'review-answer',quality:'review',analysis:'included'}]} questions={[question]} busy={false} onReview={vi.fn()}/>);
 expect(screen.getByRole('button',{name:'全部 2'})).toHaveAttribute('aria-pressed','true');
 fireEvent.click(screen.getAllByRole('button',{name:'查看完整答卷'})[0]!);
 expect(screen.getByRole('region',{name:'答卷详情'})).toHaveTextContent('included-answer');
 fireEvent.click(screen.getByRole('button',{name:'下一条答卷'}));
 expect(screen.getByRole('region',{name:'答卷详情'})).toHaveTextContent('review-answer');
 fireEvent.click(screen.getByRole('button',{name:'待复核 1'}));
 expect(screen.getByRole('button',{name:'待复核 1'})).toHaveAttribute('aria-pressed','true');
 expect(screen.getByRole('button',{name:'上一条答卷'})).toBeDisabled();
});
it('exports visible answers as Markdown without synthetic metadata',()=>{
 const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
 const create=vi.fn(()=> 'blob:export');
 Object.defineProperty(URL,'createObjectURL',{configurable:true,value:create});
 Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()});
 render(<LiveResponseList responses={[answer]} questions={[question]} busy={false} onReview={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'导出 Markdown'}));
 expect(create).toHaveBeenCalledWith(expect.any(Blob));expect(click).toHaveBeenCalled();click.mockRestore();
});
it('searches real answer text and keeps the selected detail aligned with the filtered list',()=>{
 const second={...answer,id:'second-answer',answers:[{questionId:'q1',value:'独特建议'}]};
 render(<LiveResponseList responses={[answer,second]} questions={[question]} busy={false} onReview={vi.fn()}/>);
 fireEvent.change(screen.getByRole('textbox',{name:'搜索答卷'}),{target:{value:'独特建议'}});
 const list=screen.getByRole('region',{name:'答卷列表'});
 expect(within(list).getAllByRole('button',{name:'查看完整答卷'})).toHaveLength(1);
 fireEvent.click(within(list).getByRole('button',{name:'查看完整答卷'}));
 expect(screen.getByRole('region',{name:'答卷详情'})).toHaveTextContent('独特建议');
});
it('selects visible response rows for Markdown export',()=>{
 const second={...answer,id:'second-answer'};
 render(<LiveResponseList responses={[answer,second]} questions={[question]} busy={false} onReview={vi.fn()}/>);
 fireEvent.click(screen.getByRole('checkbox',{name:'选择答卷 included-answer'}));
 expect(screen.getByText('已选择 1 项')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'导出所选 Markdown'})).toBeEnabled();
});
