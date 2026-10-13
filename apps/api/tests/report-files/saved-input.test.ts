import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { encodeSavedReportInput } from '../../src/infrastructure/report-files/chat-report-file-runtime';
it('the actual uploaded UTF-8 bytes contain real Markdown line breaks and unchanged canonical prose', () => {
  const markdown = '# 报告\n\n## 发现\n真实正文。\n\n来源：https://example.com/evidence';
  const bytes = encodeSavedReportInput({ kind: 'interview', id: 'report-1', title: '报告', reportVersion: 2, reportHash: createHash('sha256').update(markdown).digest('hex'), bindingKey: 'revision/document/2', projectId: null,
    markdown, notices: ['模拟样本，不是实地访谈', '尚未批准'], appendixMarkdown: '已授权引用。' });
  const text = Buffer.from(bytes).toString('utf8');
  expect(text).toContain('# 文件生成披露\n\n报告版本：2\n内容哈希：');
  expect(text).toContain('模拟样本，不是实地访谈\n\n尚未批准');
  expect(text).toContain(`# 报告正文\n\n${markdown}\n\n# 已授权来源附录\n\n已授权引用。`);
  expect(text).not.toContain('\\n');
  expect(text.split(markdown)).toHaveLength(2);
});
