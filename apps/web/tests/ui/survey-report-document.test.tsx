import { describe, it, expect, vi, beforeEach } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { render, screen } from '@testing-library/react';
import type { survey } from '@repo/contracts';
import { SurveyReportDocument } from '@/components/survey/report/report-document';
import { printSurveyReport, buildSurveyReportWord } from '@/components/survey/report/report-export';
const block = (type: survey.CompiledSurveyBlock['type']): survey.CompiledSurveyBlock => ({id:type,title:type,caption:`${type} 图注`,type,questionIds:[],statistic:'mean',samplePolicy:'valid',sampleSize:7,minGroupSize:5,rows:[{label:'实际数据',value:3,count:7,target:5,gap:-2}],issues:[]});
const report: survey.CompiledSurveyReport = {id:'report',title:'调研结论',issues:[],sampleSummary:{total:9,pendingReview:2,excluded:1,included:8},sections:[{id:'first',title:'首章',analysis:[{title:'章节发现',evidence:'仅反映该受访者反馈',action:'核对具体经历',blockIds:['bar']}],blocks:[{...block('text'),text:'<script>不能执行</script>'},block('bar'),block('radar'),block('line'),block('gap'),block('page-break')]},{id:'last',title:'末章',blocks:[{...block('table'),rows:[],issues:['样本不足']},{...block('table'),id:'answers',title:'开放回答',statistic:'responses',rows:[],answerTexts:[{label:'实际建议',value:'请改善检索体验\n保留资料来源'}]}]}]};
describe('survey report document',()=>{
 beforeEach(()=>{ vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }); });
 it('renders captions exactly once on every content type and retains them in print',async()=>{
  const types: survey.CompiledSurveyBlock['type'][]=['text','metric','table','bar','radar','line','gap','image','page-break'];
  const all={...report,sections:[{id:'captions',title:'图注',blocks:types.map(type=>({...block(type),...(type==='image'?{imageUrl:'https://example.com/report.png'}:{})}))}]};
  const {container}=render(<SurveyReportDocument report={all}/>);
  for(const type of types.filter(type=>type!=='page-break')) expect(screen.getAllByText(`${type} 图注`)).toHaveLength(1);
  expect(screen.queryByText('page-break 图注')).not.toBeInTheDocument();
  // Image bytes are verified separately; here verify that print keeps the rendered caption text.
  const root=container.querySelector('article')!.cloneNode(true) as HTMLElement;
  root.querySelector('img')!.remove();
  const printing=printSurveyReport(root),frame=document.querySelector('iframe')!;
  frame.contentWindow!.print=vi.fn();frame.contentWindow!.focus=vi.fn();
  for(const type of types.filter(type=>type!=='page-break')) expect(frame.contentDocument!.body.textContent).toContain(`${type} 图注`);
  await printing;frame.contentWindow!.dispatchEvent(new Event('afterprint'));
 });
 it('prints all chapters even when the hidden iframe never receives an animation frame',async()=>{
  const root=document.createElement('article');root.innerHTML='<h1>报告</h1><section>首章</section><div data-page-break></div><section>末章</section><button data-report-ui>编辑</button>';
  const promise=printSurveyReport(root);
  const frame=document.querySelector('iframe')!;
  const printed=vi.fn();frame.contentWindow!.print=printed;frame.contentWindow!.focus=vi.fn();
  frame.contentWindow!.requestAnimationFrame=vi.fn();
  expect(frame.contentDocument!.body.textContent).toContain('末章');
  expect(frame.contentDocument!.querySelector('button')).toBeNull();
  expect(frame.contentDocument!.querySelector('[data-page-break]')).toBeTruthy();
  await Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Print stalled on a hidden iframe animation frame')),1000))]);expect(printed).toHaveBeenCalledOnce();
  frame.contentWindow!.dispatchEvent(new Event('afterprint'));expect(document.querySelector('iframe')).toBeNull();
 });
 it('renders every chapter, real chart geometry, gap cells and escaped prose',()=>{
  const {container}=render(<SurveyReportDocument report={report}/>);
  expect(screen.getByRole('heading',{name:'末章'})).toBeTruthy();
  expect(screen.getByText(/请改善检索体验/)).toBeTruthy();
  expect(container.querySelector('script')).toBeNull();
  expect(screen.getByText('<script>不能执行</script>')).toBeTruthy();
  expect(container.querySelectorAll('svg')).toHaveLength(3);
  expect(container.querySelectorAll('[data-chart="bar"] path').length).toBeGreaterThan(0);
  expect(container.querySelector('[data-report-block="bar"] table')).toBeNull();
  expect(container.querySelector('[data-report-block="gap"] table')).not.toBeNull();
  expect(screen.getByText('-2')).toBeTruthy();
  expect(screen.getByText('样本不足')).toBeTruthy();
  expect(screen.getByText('仅反映该受访者反馈')).toBeTruthy();
  expect(container.querySelector('[data-page-break]')).toBeTruthy();
 });
 it('makes the report and block sample bases explicit',()=>{
  render(<SurveyReportDocument report={report}/>);
  expect(screen.getByTestId('survey-report-sample-summary')).toHaveTextContent('总答卷 9 · 待复核 2 · 已排除 1 · 纳入分析 8');
  expect(screen.getByTestId('survey-report-block-sample-bar')).toHaveTextContent('仅正常质量答卷 · 实际样本量 7');
 });
 it('exports a genuine Word archive with every chapter',async()=>{
  const blob=await buildSurveyReportWord({...report,sections:report.sections.map(s=>({...s,blocks:s.blocks.filter(b=>!['bar','radar','line'].includes(b.type))}))});
  expect(blob.size).toBeGreaterThan(1000);
  expect(blob.type).toContain('wordprocessingml');
  const bytes = Buffer.from(await new Promise<ArrayBuffer>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result as ArrayBuffer);reader.onerror=()=>reject(reader.error);reader.readAsArrayBuffer(blob);}));
  let xml='';
  for(let offset=0;offset<bytes.length-46;offset++) {
    if(bytes.readUInt32LE(offset)!==0x02014b50) continue;
    const nameLength=bytes.readUInt16LE(offset+28),name=bytes.subarray(offset+46,offset+46+nameLength).toString();
    if(name!=='word/document.xml') continue;
    const local=bytes.readUInt32LE(offset+42),start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);
    const compressed=bytes.subarray(start,start+bytes.readUInt32LE(offset+20));
    xml=(bytes.readUInt16LE(offset+10)===8 ? inflateRawSync(compressed) : compressed).toString();break;
  }
  for(const type of ['text','gap','table']) expect(xml).toContain(`${type} 图注`);
  expect(xml).not.toContain('page-break 图注');
  expect(xml).toContain('仅反映该受访者反馈');expect(xml).toContain('核对具体经历');
  expect(xml).toContain('请改善检索体验');expect(xml).toContain('保留资料来源');expect(xml).toContain('首章');expect(xml).toContain('末章');expect(xml).toContain('样本不足');
  expect(xml).toContain('总答卷 9 · 待复核 2 · 已排除 1 · 纳入分析 8');expect(xml).toContain('仅正常质量答卷 · 实际样本量 7');
  expect(xml).toContain('&lt;script&gt;不能执行&lt;/script&gt;');expect(xml).toContain('w:type="page"');
 });
 it('does not claim image export success when an image cannot be loaded',async()=>{
  vi.stubGlobal('Image',class { onerror: (()=>void)|null=null; set src(_:string){queueMicrotask(()=>this.onerror?.());} });
  await expect(buildSurveyReportWord({...report,sections:[{id:'s',title:'s',blocks:[{...block('image'),imageUrl:'https://example.com/missing.png'}]}]})).rejects.toThrow('图片');
  vi.unstubAllGlobals();
 });
 it('rejects broken images before printing',async()=>{
  vi.stubGlobal('Image',class { onerror: (()=>void)|null=null; set src(_:string){queueMicrotask(()=>this.onerror?.());} });
  const root=document.createElement('article');root.innerHTML='<h1>报告</h1><section>首章</section><section>末章</section><img src="https://example.com/missing.png">';
  await expect(printSurveyReport(root)).rejects.toThrow('图片');
  expect(document.querySelector('iframe')).toBeNull();
  vi.unstubAllGlobals();
 });
});
