import {expect,it} from 'vitest';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';
const {wrapTextByWidth,drawWrappedText}=createRequire(import.meta.url)('../../scripts/office-package-resources/pdf-text-layout.cjs');
it('measures unbroken English titles using the embedded font without dropping characters',async()=>{
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
 const title='LongUnbrokenResearchTitle'.repeat(12);const lines=wrapTextByWidth(title,font,24,495);
 expect(lines.length).toBeGreaterThan(1);expect(lines.join('')).toBe(title);
 for(const line of lines)expect(font.widthOfTextAtSize(line,24)).toBeLessThanOrEqual(495);
});
it('moves body below all title lines and paginates instead of clipping',async()=>{
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),page=pdf.addPage([595,842]);
 const title='Full long report title '.repeat(120);const result=drawWrappedText(page,title,{font,size:24,x:50,y:792,rightMargin:50});
 expect(result.lines.join('')).toBe(title);expect(pdf.getPageCount()).toBeGreaterThan(1);
 expect(result.y).toBeLessThan(792);expect(result.y).toBeGreaterThanOrEqual(0);
 const body=drawWrappedText(result.page,'Original report body',{font,size:12,x:50,y:result.y-16});
 expect(body.y).toBeLessThan(result.y);
});
it.skipIf(!process.env.WX_PDF_LAYOUT_CJK_FONT)('renders complete Chinese mixed and unbroken English titles with the actual sandbox CJK font',async()=>{
 const fontBytes=await readFile(process.env.WX_PDF_LAYOUT_CJK_FONT!);
 const titles=['系统韧性与体验优化：跨领域技术实践与健康管理综合分析报告'.repeat(4),'LongUnbrokenResearchTitle'.repeat(12),'跨领域技术 Research2026 SystemResilienceAndHealth '.repeat(8)];
 for(const [index,title] of titles.entries()){
  const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);const font=await pdf.embedFont(fontBytes);const page=pdf.addPage([595,842]);
  const result=drawWrappedText(page,title,{font,size:24,x:50,y:792,rightMargin:50});
  expect(result.lines.join('')).toBe(title);expect(result.lines.length).toBeGreaterThan(1);
  for(const line of result.lines)expect(font.widthOfTextAtSize(line,24)).toBeLessThanOrEqual(495);
  drawWrappedText(result.page,'报告正文保留，标题自动换行后继续排版。',{font,size:12,x:50,y:result.y-16,rightMargin:50});
  const bytes=await pdf.save();expect(bytes.byteLength).toBeGreaterThan(0);
  if(process.env.WX_PDF_LAYOUT_EVIDENCE){await mkdir(process.env.WX_PDF_LAYOUT_EVIDENCE,{recursive:true});await writeFile(`${process.env.WX_PDF_LAYOUT_EVIDENCE}/title-${index+1}.pdf`,bytes);}
 }
});
