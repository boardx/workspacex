import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { encodeSavedReportInput } from '../../src/infrastructure/report-files/chat-report-file-runtime';
it('the actual uploaded UTF-8 bytes contain real Markdown line breaks and unchanged canonical prose', () => {
  const markdown = '# 报告\n\n## 发现\n真实正文。\n\n来源：https://example.com/evidence';
  const reportHash = createHash('sha256').update(markdown).digest('hex');
  const metadata = `文档版本 2 · 内容哈希 ${reportHash}`;
  const bytes = encodeSavedReportInput({ kind: 'interview', id: 'report-1', title: '报告', reportVersion: 2, reportHash, bindingKey: 'revision/document/2', projectId: null,
    markdown, notices: [metadata, '模拟样本，不是实地访谈', '尚未批准'], appendixMarkdown: '已授权引用。' });
  const text = Buffer.from(bytes).toString('utf8');
  expect(text.startsWith(markdown)).toBe(true);
  expect(text).not.toContain('文件生成披露');
  expect(text).not.toContain(reportHash);
  expect(text).not.toContain('尚未批准');
  expect(text).toContain('## 已授权来源附录\n\n已授权引用。');
  expect(text.match(/^# /gm)).toHaveLength(1);
  expect(text).not.toContain('\\n');
  expect(text.split(markdown)).toHaveLength(2);
});

it('does not remove limitations or simulated-evidence wording that belongs to canonical prose',()=>{
 const markdown='# 报告\n\n本报告基于模拟材料，不能代表真实用户证据。\n\n## 适用范围\n需要进一步验证。';
 const text=Buffer.from(encodeSavedReportInput({kind:'interview',id:'r',title:'报告',reportVersion:1,reportHash:'a'.repeat(64),bindingKey:'r/d/1',projectId:null,markdown,notices:['额外说明']})).toString('utf8');
 expect(text).toBe(markdown);
});
