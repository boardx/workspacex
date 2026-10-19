import { createHash } from 'node:crypto';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { expect, it } from 'vitest';
import { ReportGeneratedFileValidator, validateReportContent } from '../../src/infrastructure/report-files/file-validator';
const markdown = '# 中文报告\n\n用户需要可下载和编辑的真实报告文件。';
const reportHash = createHash('sha256').update(markdown).digest('hex');
const source = { kind: 'interview' as const, id: 'saved-report', title: '中文报告', reportVersion: 1, reportHash,
  bindingKey: 'revision/document/1', markdown, projectId: null, notices: ['本报告基于 AI 模拟访谈，不代表真实用户证据。', `文档版本 1 · 内容哈希`] };
it('rejects structurally real DOCX with read-error placeholders before publication', async () => {
  const bytes = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('读取失败 ENOENT /work/input/report.md'), ...source.notices.map(note => new Paragraph(note))] }] }));
  await expect(new ReportGeneratedFileValidator().validate('docx', bytes, source)).rejects.toMatchObject({ code: 'INVALID_FILE' });
});
it('requires complete canonical Word report body without appended system notices', async () => {
  const bytes = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph(source.title), new Paragraph('用户需要可下载和编辑的真实报告文件。')] }] }));
  await expect(new ReportGeneratedFileValidator().validate('docx', bytes, source)).resolves.toBeUndefined();
  expect(() => validateReportContent('docx', source.notices.join(' '), source)).toThrow();
});
it('rejects duplicated report prose and lost evidence limitations', () => {
  const text = `中文报告 用户需要可下载和编辑的真实报告文件。`;
  expect(() => validateReportContent('docx', text + ' 用户需要可下载和编辑的真实报告文件。', source)).toThrow();
  expect(() => validateReportContent('docx', source.title + ' ' + reportHash, source)).toThrow();
});

it.each(['pdf', 'docx'] as const)('requires authorized appendix quotations and provenance in %s', format => {
  const appendixMarkdown = '### 引用 quote-1\n\n来源版本 3 · SHA256 ' + 'd'.repeat(64) + '\n\n独有引用：真实采购负责人需提供可核验的原始预算授权记录。';
  const withEvidence = { ...source, appendixMarkdown };
  const body = `中文报告 用户需要可下载和编辑的真实报告文件。`;
  expect(() => validateReportContent(format, body, withEvidence)).toThrow();
  expect(() => validateReportContent(format, `${body} ${appendixMarkdown}`, withEvidence)).not.toThrow();
});
it('allows an authorized appendix to repeat a quotation also present in the canonical report', () => {
  const repeated = { ...source, appendixMarkdown: '### 引用 quote-2\n\n来源版本 1 · SHA256 ' + reportHash + '\n\n用户需要可下载和编辑的真实报告文件。' };
  const text = `中文报告 用户需要可下载和编辑的真实报告文件。 ${repeated.appendixMarkdown}`;
  expect(() => validateReportContent('docx', text, repeated)).not.toThrow();
});

it('checks wrapped PDF autolinks without duplicating their identical display target', () => {
  const url = 'https://example.com/procurement-proof';
  const paragraph = `来源链接（验收样本）：${url}`;
  const linked = { ...source, markdown: `${source.markdown}\n\n${paragraph}` };
  const prose = `中文报告 用户需要可下载和编辑的真实报告文件。`;
  // Anydoc recognizes the first visual line as an autolink; the continuation is plain text.
  const extracted = `${prose} 来源链接（验收样本）：[https://example.com/procurement-pr](https://example.com/procurement-pr) oof`;
  expect(() => validateReportContent('pdf', extracted, linked)).not.toThrow();
  expect(() => validateReportContent('pdf', extracted.replace(' oof', ''), linked)).toThrow();
});

it.each(['pdf', 'docx'] as const)('requires the full canonical H1 rather than a truncated metadata title in %s', format => {
  const fullTitle = '原始报告的完整研究主题与研究目的';
  const saved = { ...source, title: '原始报告', markdown: `# ${fullTitle}\n\n用户需要可下载和编辑的真实报告文件。` };
  const body = `用户需要可下载和编辑的真实报告文件。`;
  expect(() => validateReportContent(format, body, saved)).toThrow();
  expect(() => validateReportContent(format, `原始报告 ${body}`, saved)).toThrow();
  expect(() => validateReportContent(format, `${fullTitle} ${body}`, saved)).not.toThrow();
});

it.each(['pdf', 'docx'] as const)('requires saved source URLs in %s including actual hyperlink relationships', format => {
  const url = 'https://example.com/procurement-proof';
  const linked = { ...source, markdown: `${source.markdown}\n\n[来源链接](${url})` };
  const text = `中文报告 用户需要可下载和编辑的真实报告文件。 来源链接`;
  expect(() => validateReportContent(format, text, linked)).toThrow();
  expect(() => validateReportContent(format, `${text} ${url}`, linked)).not.toThrow();
  expect(() => validateReportContent(format, text, linked, [url])).not.toThrow();
});

it.each(['pdf','docx'] as const)('validates rendered HTML breaks in table cells without accepting lost content in %s',format=>{
 const markdown='# Saved report\n\n| Priority | Action |\n| --- | --- |\n| High | Verify the complete approved purchasing budget.<br>Record the responsible decision owner. |';
 const reportHash=createHash('sha256').update(markdown).digest('hex');
 const saved={...source,title:'Saved report',markdown,reportHash,notices:['Simulated evidence only.',`Document version 1 hash`]};
 const text=`Saved report High Verify the complete approved purchasing budget.\nRecord the responsible decision owner.`;
 expect(()=>validateReportContent(format,text,saved)).not.toThrow();
 expect(()=>validateReportContent(format,text.replace('Record the responsible decision owner.',''),saved)).toThrow();
 expect(()=>validateReportContent(format,text+' Verify the complete approved purchasing budget. Record the responsible decision owner.',saved)).toThrow();
});
it('keeps literal HTML break text in code as required visible data',()=>{
 const markdown='# Saved report\n\n```html\nLiteral code includes <br> characters, not a rendered line break.\n```';
 const reportHash=createHash('sha256').update(markdown).digest('hex');const saved={...source,title:'Saved report',markdown,reportHash,notices:[reportHash]};
 expect(()=>validateReportContent('pdf',`Saved report Literal code includes <br> characters, not a rendered line break.`,saved)).not.toThrow();
 expect(()=>validateReportContent('pdf',`Saved report Literal code includes characters, not a rendered line break.`,saved)).toThrow();
});
it.each(['<br>','<BR/>','<br />','<br\t>'])('projects only actual HTML break nodes: %s',br=>{
 const markdown=`# Saved report\n\nThe first complete visible sentence.${br}The second complete visible sentence.`;
 const reportHash=createHash('sha256').update(markdown).digest('hex');const saved={...source,title:'Saved report',markdown,reportHash,notices:[reportHash]};
 const rendered=`Saved report The first complete visible sentence.\nThe second complete visible sentence.`;
 expect(()=>validateReportContent('pdf',rendered,saved)).not.toThrow();
 expect(()=>validateReportContent('pdf',rendered.replace('The second complete visible sentence.',''),saved)).toThrow();
});
it('preserves literal break text inside inline code',()=>{
 const markdown='# Saved report\n\nThe inline code `<br>` is visible literal data.';
 const reportHash=createHash('sha256').update(markdown).digest('hex');const saved={...source,title:'Saved report',markdown,reportHash,notices:[reportHash]};
 expect(()=>validateReportContent('pdf',`Saved report The inline code <br> is visible literal data.`,saved)).not.toThrow();
 expect(()=>validateReportContent('pdf',`Saved report The inline code is visible literal data.`,saved)).toThrow();
});
it.each(['pdf','docx'] as const)('accepts real %s bytes with a correctly rendered table-cell break',async format=>{
 const markdown='# Saved report\n\n| Action |\n| --- |\n| Verify the complete approved budget.<br>Record the responsible decision owner. |';
 const reportHash=createHash('sha256').update(markdown).digest('hex');const saved={...source,title:'Saved report',markdown,reportHash,notices:['Simulated evidence only.',reportHash]};
 const lines=['Saved report','Action','Verify the complete approved budget.','Record the responsible decision owner.'];
 let bytes:Uint8Array;
 if(format==='docx')bytes=await Packer.toBuffer(new Document({sections:[{children:lines.map(line=>new Paragraph(line))}]}));
 else{const {PDFDocument,StandardFonts}=await import('pdf-lib');const pdf=await PDFDocument.create(),page=pdf.addPage(),font=await pdf.embedFont(StandardFonts.Helvetica);lines.forEach((line,index)=>page.drawText(line,{x:40,y:780-index*30,size:9,font}));bytes=await pdf.save();}
 await expect(new ReportGeneratedFileValidator().validate(format,bytes,saved)).resolves.toBeUndefined();
});

it('rejects an injected disclosure section but preserves it if it was part of the saved report',()=>{
 const body='中文报告 用户需要可下载和编辑的真实报告文件。';
 expect(()=>validateReportContent('pdf',body+' 文件生成披露 文档版本 1',source)).toThrow();
 expect(()=>validateReportContent('pdf',body,source)).not.toThrow();
 const saved={...source,markdown:source.markdown+'\n\n## 文件生成披露\n用户原文中的真实说明内容必须保留。'};
 expect(()=>validateReportContent('pdf',body+' 文件生成披露 用户原文中的真实说明内容必须保留。',saved)).not.toThrow();
});
it.each(['审核状态：未批准',source.notices[0],`内容哈希：${reportHash}`,'文档版本 1'])('rejects noncanonical disclosure metadata without a disclosure heading: %s',line=>{
 expect(()=>validateReportContent('pdf',`中文报告 用户需要可下载和编辑的真实报告文件。\n${line}`,source)).toThrow();
 const saved={...source,markdown:source.markdown+`\n\n${line}`};
 expect(()=>validateReportContent('pdf',`中文报告 用户需要可下载和编辑的真实报告文件。\n${line}`,saved)).not.toThrow();
});

it('rejects an extra DOCX review paragraph even when the status is split across runs',async()=>{
 const bytes=await Packer.toBuffer(new Document({sections:[{children:[new Paragraph('中文报告'),new Paragraph('用户需要可下载和编辑的真实报告文件。'),new Paragraph({children:[new TextRun('审核状'),new TextRun('态：已批准')]})]}]}));
 await expect(new ReportGeneratedFileValidator().validate('docx',bytes,source)).rejects.toMatchObject({code:'INVALID_FILE'});
 const saved={...source,markdown:source.markdown+'\n\n审核状态：已批准'};
 await expect(new ReportGeneratedFileValidator().validate('docx',bytes,saved)).resolves.toBeUndefined();
});
it('keeps ordinary split DOCX words together while preserving actual paragraph boundaries',async()=>{
 const markdown='# Research report\n\nBehavioral evidence remains unchanged in the original report.';
 const saved={...source,title:'Research report',markdown,reportHash:createHash('sha256').update(markdown).digest('hex')};
 const bytes=await Packer.toBuffer(new Document({sections:[{children:[new Paragraph('Research report'),new Paragraph({children:[new TextRun('Behav'),new TextRun('ioral evidence remains unchanged in the original report.')]})]}]}));
 await expect(new ReportGeneratedFileValidator().validate('docx',bytes,saved)).resolves.toBeUndefined();
});

 it('compares PDF footnotes as presentation without losing prose, URLs or literal code', () => {
  const url='https://example.com/verified-source';
  const body='The complete approved research conclusion remains supported by the original evidence.';
  const markdown=`# Saved research\n\n${body.replace(' remains','[^1] remains')}\n\nLiteral code \`[^1]\` must remain visible in this saved report.\n\n[^1]: [Verified source](${url})`;
  const saved={...source,title:'Saved research',markdown};
  const extracted=`# Saved research\n\n${body.replace(' remains','[^ 1] remains')}\n\nLiteral code \`[^1]\` must remain visible in this saved report.\n\n[^1]: [Verified source](${url})`;
  expect(()=>validateReportContent('pdf',extracted,saved)).not.toThrow();
  expect(()=>validateReportContent('pdf',extracted.replaceAll('`',''),saved)).not.toThrow();
  expect(()=>validateReportContent('pdf',extracted.replace('original evidence',''),saved)).toThrow();
  expect(()=>validateReportContent('pdf',extracted.replace(url,''),saved)).toThrow();
  expect(()=>validateReportContent('pdf',extracted.replace('code `[^1]`','code ``'),saved)).toThrow();
 });

it('validates real PDF bytes with a wrapped canonical footnote marker', async () => {
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const url = 'https://example.com/verified-source';
  const markdown = `# Saved research\n\nThe complete approved research[^1] conclusion remains supported by original evidence.\n\n[^1]: Verified source ${url}`;
  const saved = { ...source, title: 'Saved research', markdown };
  const pdf = await PDFDocument.create(), page = pdf.addPage(), font = await pdf.embedFont(StandardFonts.Helvetica);
  ['Saved research', 'The complete approved research[^ 1] conclusion remains supported by original evidence.', `[^1]: Verified source ${url}`]
    .forEach((line, index) => page.drawText(line, { x: 30, y: 780 - index * 35, size: 8, font }));
  await expect(new ReportGeneratedFileValidator().validate('pdf', await pdf.save(), saved)).resolves.toBeUndefined();
});

it('anchors optional markers to canonical reference positions even when code becomes plain text', () => {
  const markdown = '# Saved research\n\nEvidence[^1] remains complete; literal `[^1]` must remain visible.\n\n```txt\nLiteral fenced marker [^1] remains required.\n```\n\n[^1]: Verified source https://example.com/proof';
  const saved = { ...source, title: 'Saved research', markdown };
  const extracted = 'Saved research\n\nEvidence[^ \n1] remains complete; literal [^1] must remain visible.\n\nLiteral fenced marker [^1] remains required.\n\nVerified source https://example.com/proof';
  expect(() => validateReportContent('pdf', extracted, saved)).not.toThrow();
  for (const bad of [extracted.replace('literal [^1]', 'literal'), extracted.replace('marker [^1]', 'marker'),
    extracted.replace('Evidence[^ \n1]', 'Evidence[^8]'), extracted.replace('remains complete', 'complete remains'),
    extracted + '\nEvidence[^1] remains complete; literal [^1] must remain visible.']) {
    expect(() => validateReportContent('pdf', bad, saved)).toThrow();
  }
});
