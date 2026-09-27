import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { expect, it, vi } from 'vitest';
import { parseSurveyPublicationMarkdown, serializeSurveyPublicationMarkdown } from '@repo/contracts/survey-source';
import { SurveyCollectionSettingsEditor } from '../../components/survey/live/collection-settings';

it('preserves spaces and line breaks during sequential Markdown typing', async () => {
  function Editor() {
    const [markdown, setMarkdown] = React.useState('# 发布设置\n');
    return <SurveyCollectionSettingsEditor markdown={markdown} locked={false} onChange={setMarkdown}/>;
  }
  render(<Editor/>);
  const input = screen.getByRole('textbox', { name: '成功页 Markdown' }) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: '' } });
  for (const character of '# 感谢参与\n\n下一段 ') fireEvent.change(input, { target: { value: input.value + character } });
  expect(input).toHaveValue('# 感谢参与\n\n下一段 ');
});

it('emits the shared canonical publication document for settings edits', () => {
  const onChange = vi.fn();
  render(<SurveyCollectionSettingsEditor markdown={'# 发布设置\n'} locked={false} onChange={onChange}/>);
  fireEvent.click(screen.getByRole('checkbox', { name: '同一浏览器限答一次' }));
  expect(onChange).toHaveBeenLastCalledWith(serializeSurveyPublicationMarkdown({
    responseLimitScope: 'browser', successMessageMarkdown: '提交成功，感谢您的参与。',
  }));
});

it('marks an empty local success message invalid without crashing or retaining a publishable source', () => {
  const onChange = vi.fn();
  render(<SurveyCollectionSettingsEditor markdown={'# 发布设置\n'} locked={false} onChange={onChange}/>);
  fireEvent.change(screen.getByRole('textbox', { name: '成功页 Markdown' }), { target: { value: '   ' } });
  expect(screen.getByRole('textbox', { name: '成功页 Markdown' })).toHaveValue('   ');
  expect(parseSurveyPublicationMarkdown(onChange.mock.calls.at(-1)![0]).ok).toBe(false);
});
