import { describe, expect, it } from 'vitest';
import { parseSurveyPublicationMarkdown } from '../src/survey-source';

describe('canonical publication collection settings', () => {
  it('preserves backward-compatible defaults', () => {
    expect(parseSurveyPublicationMarkdown('# 发布设置\n')).toMatchObject({ok:true, settings:{responseLimitScope:'none', successMessageMarkdown:'提交成功，感谢您的参与。'}});
  });
  it('compiles bounded server-enforced browser policy and success Markdown', () => {
    expect(parseSurveyPublicationMarkdown('# 发布设置\n\n```survey-publication\n{"responseLimitScope":"browser","successMessageMarkdown":"# 感谢参与\\n反馈已收到。"}\n```\n')).toMatchObject({ok:true,settings:{responseLimitScope:'browser',successMessageMarkdown:'# 感谢参与\n反馈已收到。'}});
  });
  it.each([
    '{"responseLimitScope":"account"}',
    '{"responseLimitScope":"browser","unknown":true}',
    '{"successMessageMarkdown":""}',
    JSON.stringify({successMessageMarkdown:'a'.repeat(10001)}),
  ])('rejects unsupported or unbounded settings: %s', body => {
    expect(parseSurveyPublicationMarkdown(`# 发布设置\n\n\`\`\`survey-publication\n${body}\n\`\`\`\n`)).toMatchObject({ok:false});
  });
});
