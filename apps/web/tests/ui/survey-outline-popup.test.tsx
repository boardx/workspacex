import * as React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SurveyQuestionEditor } from '@/components/survey/live/question-editor';
import { createSurveyQuestion } from '@repo/contracts/survey-question-types';
const initial = [ {...createSurveyQuestion('short','q1',1),title:'姓名'}, {...createSurveyQuestion('short','q2',2),title:'城市'} ];
it('keeps toolbox separate and opens a searchable outline from toolbar, selecting a question closes and focuses canvas', async()=>{
 render(<SurveyQuestionEditor studioLayout questions={initial} onChange={vi.fn()} />);
 const toolbox=screen.getByTestId('survey-designer-toolbox');
 expect(within(toolbox).queryByRole('searchbox',{name:'搜索题目'})).not.toBeInTheDocument();
 expect(screen.queryByRole('dialog',{name:'题目大纲'})).not.toBeInTheDocument();
 const trigger=screen.getByRole('button',{name:'题目大纲'});
 expect(toolbox.contains(trigger)).toBe(false);
 fireEvent.click(trigger);
 const popup=screen.getByRole('dialog',{name:'题目大纲'});
 fireEvent.change(within(popup).getByRole('searchbox',{name:'搜索题目'}),{target:{value:'城市'}});
 expect(within(popup).queryByRole('button',{name:'选择题目 1：姓名'})).not.toBeInTheDocument();
 fireEvent.click(within(popup).getByRole('button',{name:'选择题目 2：城市'}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
 await waitFor(()=>expect(document.activeElement).toHaveAttribute('data-survey-question-id','q2'));
});
it('keeps reordering inside the popup',()=>{
 const changed=vi.fn();function Editor(){const [q,setQ]=React.useState(initial);return <SurveyQuestionEditor studioLayout questions={q} onChange={next=>{changed(next);setQ(next)}}/>;}render(<Editor/>);
 fireEvent.click(screen.getByRole('button',{name:'题目大纲'}));
 fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'上移题目：城市'}));
 expect(changed.mock.lastCall?.[0].map((q:{id:string})=>q.id)).toEqual(['q2','q1']);
 expect(screen.getByRole('dialog')).toBeInTheDocument();
});
it('keeps the outline usable read-only while locked and disables its trigger during saving',()=>{
 const view=render(<SurveyQuestionEditor studioLayout locked questions={initial} onChange={vi.fn()} />);
 fireEvent.click(screen.getByRole('button',{name:'题目大纲'}));
 expect(within(screen.getByRole('dialog')).queryByRole('button',{name:'上移题目：城市'})).not.toBeInTheDocument();
 view.unmount();render(<SurveyQuestionEditor studioLayout disabled questions={initial} onChange={vi.fn()} />);
 expect(screen.getByRole('button',{name:'题目大纲'})).toBeDisabled();
});

it('Escape closes the popup, restores its trigger and keeps the search draft without changing questions', async()=>{
 const changed=vi.fn();render(<SurveyQuestionEditor studioLayout questions={initial} onChange={changed} />);
 const trigger=screen.getByRole('button',{name:'题目大纲'});trigger.focus();fireEvent.click(trigger);
 fireEvent.change(screen.getByRole('searchbox',{name:'搜索题目'}),{target:{value:'城市'}});
 fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
 await waitFor(()=>expect(trigger).toHaveFocus());
 fireEvent.click(trigger);
 expect(screen.getByRole('searchbox',{name:'搜索题目'})).toHaveValue('城市');
 expect(changed).not.toHaveBeenCalled();
});
