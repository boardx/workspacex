import {expect,it,vi} from 'vitest';
import {fireEvent,render,screen} from '@testing-library/react';
import {requiredTriggerFields,WorkflowStartForm} from '@/components/workflow/workflow-start-form';
it('renders the schema title, rejects blank or oversized tasks, and submits the original rawInput',()=>{
 const fields=requiredTriggerFields({required:['rawInput'],properties:{rawInput:{type:'string',title:'产品问题或需求',minLength:1,maxLength:2000}}});
 const onSubmit=vi.fn();render(<WorkflowStartForm workflowKey="problem-to-prd" fields={fields} busy={false} onSubmit={onSubmit} onCancel={vi.fn()}/>);
 const input=screen.getByLabelText('产品问题或需求（必填）');
 for(const value of ['  ','x'.repeat(2001)]){fireEvent.change(input,{target:{value}});fireEvent.click(screen.getByTestId('workflow-run-form-submit'));expect(onSubmit).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toBeInTheDocument();}
 const rawInput='团队反馈白板首次导入流程太复杂，请定义问题与PRD';fireEvent.change(input,{target:{value:rawInput}});fireEvent.click(screen.getByTestId('workflow-run-form-submit'));expect(onSubmit).toHaveBeenCalledWith({rawInput});
});
it('accepts a single Unicode code point under a one character schema',()=>{
 const onSubmit=vi.fn();render(<WorkflowStartForm workflowKey="unicode" fields={requiredTriggerFields({required:['x'],properties:{x:{type:'string',minLength:1,maxLength:1}}})} busy={false} onSubmit={onSubmit} onCancel={vi.fn()}/>);
 fireEvent.change(screen.getByTestId('workflow-run-input-x'),{target:{value:'😀'}});fireEvent.click(screen.getByTestId('workflow-run-form-submit'));expect(onSubmit).toHaveBeenCalledWith({x:'😀'});
});
