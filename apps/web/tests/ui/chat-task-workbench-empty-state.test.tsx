import * as React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {TaskWorkbenchEmptyState} from '@/components/chat/chat-task-workbench-empty-state';
afterEach(cleanup);
it('offers four real templates and fills the selected goal once without sending',()=>{
 const choose=vi.fn();render(<TaskWorkbenchEmptyState onUseTemplate={choose} materialsCount={0} skillsCount={0}/>);
 expect(screen.getAllByRole('button')).toHaveLength(4);expect(choose).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'调研市场并产出带来源的报告'}));
 expect(choose).toHaveBeenCalledTimes(1);expect(choose).toHaveBeenCalledWith('帮我调研一下当前市场情况，产出一份带引用来源的调研报告。');
});
it('shows actual context values, project scope and the supplied briefing',()=>{
 const {rerender}=render(<TaskWorkbenchEmptyState onUseTemplate={()=>{}} materialsCount={3} skillsCount={2} briefing={<aside>接着上次的研究</aside>} inProject/>);
 expect(screen.getByTestId('chat-task-workbench-context-chip-materials').textContent).toBe('材料 3');
 expect(screen.getByTestId('chat-task-workbench-context-chip-materials').getAttribute('data-source')).toBe('live');
 expect(screen.getByTestId('chat-task-workbench-context-chip-skills').textContent).toBe('技能 2');
 expect(screen.getByTestId('chat-task-workbench-context-chip-project').textContent).toBe('项目：本项目对话');
 expect(screen.getByText('接着上次的研究')).toBeTruthy();
 rerender(<TaskWorkbenchEmptyState onUseTemplate={()=>{}} materialsCount={0} skillsCount={0}/>);
 expect(screen.getByTestId('chat-task-workbench-context-chip-project').textContent).toBe('项目：个人对话');
 expect(screen.getByTestId('chat-task-workbench-context-chip-materials').textContent).toBe('材料 0');
 expect(screen.queryByText('接着上次的研究')).toBeNull();
});
