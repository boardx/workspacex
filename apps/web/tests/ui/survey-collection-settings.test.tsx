import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { expect, it } from 'vitest';
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
