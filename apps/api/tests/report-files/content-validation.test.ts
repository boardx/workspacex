import { createHash } from 'node:crypto';
import { Document, Packer, Paragraph } from 'docx';
import { expect, it } from 'vitest';
import { ReportGeneratedFileValidator, validateReportContent } from '../../src/infrastructure/report-files/file-validator';
const markdown = '# 中文报告\n\n用户需要可下载和编辑的真实报告文件。';
const reportHash = createHash('sha256').update(markdown).digest('hex');
const source = { kind: 'interview' as const, id: 'saved-report', title: '中文报告', reportVersion: 1, reportHash,
  bindingKey: 'revision/document/1', markdown, projectId: null, notices: ['本报告基于 AI 模拟访谈，不代表真实用户证据。', `文档版本 1 · 内容哈希 ${reportHash}`] };
it('rejects structurally real DOCX with read-error placeholders before publication', async () => {
  const bytes = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('读取失败 ENOENT /work/input/report.md'), ...source.notices.map(note => new Paragraph(note))] }] }));
  await expect(new ReportGeneratedFileValidator().validate('docx', bytes, source)).rejects.toMatchObject({ code: 'INVALID_FILE' });
});
it('requires complete Word report body, fixed notices and canonical hash', async () => {
  const bytes = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph(source.title), new Paragraph('用户需要可下载和编辑的真实报告文件。'), ...source.notices.map(note => new Paragraph(note))] }] }));
  await expect(new ReportGeneratedFileValidator().validate('docx', bytes, source)).resolves.toBeUndefined();
  expect(() => validateReportContent('docx', source.notices.join(' '), source)).toThrow();
});
it('rejects duplicated report prose and lost evidence limitations', () => {
  const text = `中文报告 用户需要可下载和编辑的真实报告文件。 ${source.notices.join(' ')}`;
  expect(() => validateReportContent('docx', text + ' 用户需要可下载和编辑的真实报告文件。', source)).toThrow();
  expect(() => validateReportContent('pptx', source.title + ' ' + reportHash, source)).toThrow();
});
