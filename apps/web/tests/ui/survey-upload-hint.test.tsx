import {it,expect,vi} from 'vitest';
import {render,screen} from '@testing-library/react';
import {QuestionMaterial} from '@/components/survey/live/question-material';
it('shows configured file extensions before selection',()=>{
 render(<QuestionMaterial questionId="q" value={[]} onChange={vi.fn()} accept=".png,.jpg"/>);
 expect(screen.getByText(/\.png,\.jpg/)).toBeVisible();
});
