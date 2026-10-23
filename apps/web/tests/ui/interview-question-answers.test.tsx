import * as React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, it, expect } from 'vitest';
import { InterviewQuestionAnswers } from '@/components/itv/interview-question-answers';
afterEach(cleanup);
it('keeps question titles visible and independently collapses their answers',()=>{
 render(<InterviewQuestionAnswers markdown={'## 专家\n\n### 1. 最近发生什么？\n\n第一条回答。[来源](#question-one)\n\n### 2. 如何处理？\n\n第二条回答。'} />);
 expect(screen.getByText('1. 最近发生什么？')).toBeVisible();
 expect(screen.queryByText(/第一条回答/)).not.toBeVisible();
 fireEvent.click(screen.getByText('1. 最近发生什么？'));
 expect(screen.getByRole('link',{name:'来源'})).toHaveAttribute('href','#question-one');
 expect(screen.getByText('第二条回答。')).not.toBeVisible();
});
it('handles numbered bold questions without folding expert context or fenced examples',()=>{
 render(<InterviewQuestionAnswers markdown={'## 专家名称\n\n说明文字。\n\n```md\n1. 这是代码吗？\n```\n\n1. **最近发生什么？**\n\n具体案例：原始回答。\n\n2. **如何处理？**\n\n第二个回答。'} />);
 expect(screen.getByText('说明文字。')).toBeVisible();
 expect(screen.queryByRole('button',{name:/这是代码吗/})).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'1. 最近发生什么？'})).toHaveAttribute('aria-expanded','false');
 fireEvent.click(screen.getByRole('button',{name:'1. 最近发生什么？'}));
 expect(screen.getByText('具体案例：原始回答。')).toBeVisible();
 expect(screen.getByRole('button',{name:'2. 如何处理？'})).toHaveAttribute('aria-expanded','false');
});
