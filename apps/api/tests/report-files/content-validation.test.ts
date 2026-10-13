import { createHash } from 'node:crypto';
import { Document, Packer, Paragraph } from 'docx';
import PptxGenJS from 'pptxgenjs';
import { expect, it } from 'vitest';
import { ReportGeneratedFileValidator, validateReportContent, validatePptxBounds } from '../../src/infrastructure/report-files/file-validator';
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

it.each(['pdf', 'docx'] as const)('requires authorized appendix quotations and provenance in %s', format => {
  const appendixMarkdown = '### 引用 quote-1\n\n来源版本 3 · SHA256 ' + 'd'.repeat(64) + '\n\n独有引用：真实采购负责人需提供可核验的原始预算授权记录。';
  const withEvidence = { ...source, appendixMarkdown };
  const body = `中文报告 用户需要可下载和编辑的真实报告文件。 ${source.notices.join(' ')}`;
  expect(() => validateReportContent(format, body, withEvidence)).toThrow();
  expect(() => validateReportContent(format, `${body} ${appendixMarkdown}`, withEvidence)).not.toThrow();
});
it('allows an authorized appendix to repeat a quotation also present in the canonical report', () => {
  const repeated = { ...source, appendixMarkdown: '### 引用 quote-2\n\n来源版本 1 · SHA256 ' + reportHash + '\n\n用户需要可下载和编辑的真实报告文件。' };
  const text = `中文报告 用户需要可下载和编辑的真实报告文件。 ${source.notices.join(' ')} ${repeated.appendixMarkdown}`;
  expect(() => validateReportContent('docx', text, repeated)).not.toThrow();
});

it('checks wrapped PDF autolinks without duplicating their identical display target', () => {
  const url = 'https://example.com/procurement-proof';
  const paragraph = `来源链接（验收样本）：${url}`;
  const linked = { ...source, markdown: `${source.markdown}\n\n${paragraph}` };
  const prose = `中文报告 用户需要可下载和编辑的真实报告文件。 ${source.notices.join(' ')}`;
  // Anydoc recognizes the first visual line as an autolink; the continuation is plain text.
  const extracted = `${prose} 来源链接（验收样本）：[https://example.com/procurement-pr](https://example.com/procurement-pr) oof`;
  expect(() => validateReportContent('pdf', extracted, linked)).not.toThrow();
  expect(() => validateReportContent('pdf', extracted.replace(' oof', ''), linked)).toThrow();
});

it.each(['pdf', 'docx'] as const)('requires the full canonical H1 rather than a truncated metadata title in %s', format => {
  const fullTitle = '原始报告的完整研究主题与研究目的';
  const saved = { ...source, title: '原始报告', markdown: `# ${fullTitle}\n\n用户需要可下载和编辑的真实报告文件。` };
  const body = `用户需要可下载和编辑的真实报告文件。 ${source.notices.join(' ')}`;
  expect(() => validateReportContent(format, body, saved)).toThrow();
  expect(() => validateReportContent(format, `原始报告 ${body}`, saved)).toThrow();
  expect(() => validateReportContent(format, `${fullTitle} ${body}`, saved)).not.toThrow();
});

it('rejects real PPTX zero-height text boxes that render over the title', async () => {
  for (const height of [0, 4]) {
    const deck = new PptxGenJS(); deck.layout = 'LAYOUT_WIDE';
    const slide = deck.addSlide();
    slide.addText('中文报告标题', { x: 0.5, y: 0.5, w: 10, h: 0.5 });
    slide.addText('真实报告正文内容。', { x: 0.5, y: 1.4, w: 10, h: height });
    const bytes = await deck.write({ outputType: 'nodebuffer' });
    if (!Buffer.isBuffer(bytes)) throw new Error('expected actual PPTX bytes');
    if (height === 0) expect(() => validatePptxBounds(bytes)).toThrow();
    else expect(() => validatePptxBounds(bytes)).not.toThrow();
  }
});

it('requires saved source URLs in PPT summaries including actual hyperlink relationships', () => {
  const url = 'https://example.com/procurement-proof';
  const linked = { ...source, markdown: `${source.markdown}\n\n来源链接：${url}` };
  const summary = `中文报告 用户需要可下载和编辑的真实报告文件。 ${source.notices.join(' ')}`;
  expect(() => validateReportContent('pptx', summary, linked)).toThrow();
  expect(() => validateReportContent('pptx', `${summary} ${url}`, linked)).not.toThrow();
  expect(() => validateReportContent('pptx', summary, linked, [url])).not.toThrow();
});
