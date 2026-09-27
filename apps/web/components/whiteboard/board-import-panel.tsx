'use client';
import { WHITEBOARD_IMPORT_LIMITS } from '@repo/contracts/whiteboard-import';
import { useRef,useState } from 'react';
import { Button } from '@/components/ui/button';
import { executeWhiteboardImport,preflightWhiteboardImport,uploadWhiteboardImport,type WhiteboardImportReport } from '@/lib/live-whiteboard-import';

const uuid=()=>crypto.randomUUID();
const hex=(bytes:ArrayBuffer)=>[...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join('');
const base64=(value:ArrayBuffer)=>{const bytes=new Uint8Array(value);let body='';for(let index=0;index<bytes.length;index+=8192)body+=String.fromCharCode(...bytes.subarray(index,index+8192));return btoa(body);};

export function BoardImportPanel({boardId,expectedEpoch,onClose}:{boardId:string;expectedEpoch:number;onClose:()=>void}){
  const attempt=useRef<{file:File;source:string;epoch:number;upload:string;preflight:string;execute:string}|null>(null);
  const [source,setSource]=useState<'miro'|'mural'>('miro');
  const [file,setFile]=useState<File|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [report,setReport]=useState<WhiteboardImportReport|null>(null);
  const [status,setStatus]=useState('选择 Miro 或 Mural 导出文件');
  async function run(){if(!file)return;if(/\.rtb$/i.test(file.name)){setError('不支持 Miro RTB 备份，请使用完整 REST JSON 或文字 CSV。');return;}if(!attempt.current||attempt.current.file!==file||attempt.current.source!==source)attempt.current={file,source,epoch:expectedEpoch,upload:uuid(),preflight:uuid(),execute:uuid()};const ids=attempt.current;setBusy(true);setError('');try{
    setStatus('正在上传并校验文件…');const bytes=await file.arrayBuffer(),sha256=hex(await crypto.subtle.digest('SHA-256',bytes));
    const mime=file.name.toLowerCase().endsWith('.zip')?'application/zip':file.name.toLowerCase().endsWith('.csv')?'text/csv':'application/json';
    const uploaded=await uploadWhiteboardImport(boardId,{requestId:ids.upload,source,fileName:file.name,mimeType:mime,sizeBytes:bytes.byteLength,sha256,contentBase64:base64(bytes)});
    setStatus('正在预检对象与附件…');const checked=await preflightWhiteboardImport(boardId,uploaded.importId,ids.preflight);setReport(checked);
    if(!checked.executable){setStatus('预检完成，当前文件无法导入，请查看报告');return;}
    setStatus('正在写入白板…');const completed=await executeWhiteboardImport(boardId,uploaded.importId,ids.execute,ids.epoch);setReport(completed.report);setStatus(`导入完成 · ${completed.report.counts.accepted} 个对象`);
  }catch(cause){if(cause&&typeof cause==='object'&&'reasonCode' in cause&&cause.reasonCode==='STALE_HEAD')attempt.current=null;setError(cause instanceof Error?cause.message:'导入失败');setStatus('导入失败');}finally{setBusy(false);}}
  return <aside data-testid="board-import-panel" className="absolute right-4 top-4 z-50 w-[min(28rem,calc(100%-2rem))] space-y-3 rounded-container border border-border bg-card p-4 shadow-lg">
    <div className="flex items-center justify-between"><h2 className="text-16 font-semibold">导入 Miro / Mural</h2><Button variant="ghost" onClick={onClose}>关闭</Button></div>
    <label className="block text-12">来源<select data-testid="board-import-source" className="ml-2 rounded-control border p-2" value={source} onChange={event=>setSource(event.target.value as 'miro'|'mural')}><option value="miro">Miro</option><option value="mural">Mural</option></select></label>
    <p className="text-12 text-muted-foreground">支持完整 Miro REST JSON、Mural REST widgets JSON、文字 CSV 和附图 ZIP。CSV 仅恢复文字并重新排布；不支持 RTB 备份。单次最多 {WHITEBOARD_IMPORT_LIMITS.objects} 个对象，超限整批拒绝。</p>
    <input data-testid="board-import-file" aria-label="选择导出文件" type="file" accept=".json,.csv,.zip" onChange={event=>setFile(event.target.files?.[0]??null)}/>
    <Button data-testid="board-import-submit" disabled={busy||!file} onClick={()=>void run()}>{busy?'处理中…':'预检并导入'}</Button>
    <p role="status" data-testid="board-import-progress" className="text-12 text-muted-foreground">{status}</p>{error&&<p role="alert" className="text-12 text-destructive">{error}</p>}
    {report&&<div data-testid="board-import-report" className="space-y-2 border-t pt-3 text-12"><div className="flex items-center justify-between"><strong>导入报告</strong><Button data-testid="board-import-report-download" size="sm" variant="outline" onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),anchor=document.createElement('a');anchor.href=url;anchor.download=`whiteboard-import-${report.importId}.json`;anchor.click();URL.revokeObjectURL(url);}}>导出报告</Button></div><p>成功 {report.items.filter(item=>item.outcome==='success').length} · 降级 {report.items.filter(item=>item.outcome==='downgraded').length} · 跳过 {report.items.filter(item=>item.outcome==='skipped').length} · 失败 {report.items.filter(item=>item.outcome==='failed').length}</p><ul>{report.issues.filter(issue=>issue.code==='OBJECT_LIMIT').map((issue,index)=><li key={index}>{issue.detail}</li>)}</ul><ul className="max-h-40 overflow-auto">{report.items.map((item,index)=><li key={`${item.sourceId}-${index}`}>{item.sourceId} · {item.outcome}{item.reasonCode?` · ${item.reasonCode}`:''}{item.detail?` · ${item.detail}`:''}</li>)}</ul></div>}
  </aside>;
}
