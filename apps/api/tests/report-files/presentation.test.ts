import { expect, it } from 'vitest';
import { reportDownloadFilename,REPORT_EXPORT_RENDER_POLICY } from '../../src/application/report-files/presentation';
import { reportRenderHash } from '../../src/application/report-files/service';
import { createHash } from 'node:crypto';
it('uses a safe canonical title for both formats without corrupting Unicode',()=>{
 expect(reportDownloadFilename('系统韧性与体验优化','pdf')).toBe('系统韧性与体验优化.pdf');
 expect(reportDownloadFilename('系统韧性与体验优化','docx')).toBe('系统韧性与体验优化.docx');
 for(const title of ['../报告/第一版\r\n危险\\路径','\u202e恶意|标题:*?','CON','...','']){
  const name=reportDownloadFilename(title,'pdf');expect(name).not.toMatch(/[\r\n/\\:*?"<>|\u202e]/u);expect(name).not.toMatch(/^\./u);expect(name.endsWith('.pdf')).toBe(true);
 }
 expect(Buffer.byteLength(reportDownloadFilename('长标题'.repeat(100),'pdf'))).toBeLessThanOrEqual(184);
});
it('invalidates a persisted file from the previous render rules',()=>{
 const snapshot={kind:'interview' as const,id:'saved',title:'报告',markdown:'# 报告',reportVersion:1,reportHash:'a'.repeat(64),bindingKey:'r/d/1',notices:[],projectId:null};
 const legacy=createHash('sha256').update(JSON.stringify([snapshot.title,snapshot.markdown,'',snapshot.notices,null])).digest('hex');
 expect(REPORT_EXPORT_RENDER_POLICY).toBeTruthy();expect(reportRenderHash(snapshot)).not.toBe(legacy);
});
it('freezes the human report filename in publication while keeping the workspace path stable',async()=>{
 const {reportFilePublication}=await import('../../src/application/report-files/publication');
 const record={requestId:'request',downloadFilename:'系统韧性与体验优化.pdf',job:{format:'pdf'}};
 expect(reportFilePublication(record as never)).toMatchObject({title:'系统韧性与体验优化.pdf',workspacePath:'/workspace/report.pdf'});
});
it('serves the real UTF-8 report filename in Content-Disposition',async()=>{
 await import('reflect-metadata');
 const {ReportFilesController}=await import('../../src/interface/controllers/report-files.controller');
 const {toOrgId}=await import('../../src/domain/org-id');
 const headers=new Map<string,string>();const file={filename:'系统韧性与体验优化.pdf',mediaType:'application/pdf',sizeBytes:3,sha256:'a'.repeat(64)};
 const controller=new ReportFilesController({download:async()=>({bytes:Buffer.from('pdf'),file})} as never);
 await controller.download({orgId:toOrgId('org-test'),userId:'actor'},'00000000-0000-4000-8000-000000000001',{setHeader:(name:string,value:string)=>headers.set(name,value),send:()=>undefined} as never);
 expect(headers.get('Content-Disposition')).toContain(`filename*=UTF-8''${encodeURIComponent(file.filename)}`);
});
