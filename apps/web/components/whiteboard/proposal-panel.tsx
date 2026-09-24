'use client';
import { useCallback,useEffect,useRef,useState } from 'react';
import type { Proposal } from '@repo/contracts/whiteboard-proposal';
import type { WhiteboardCommand } from '@repo/contracts/whiteboard-document';
import type { Board } from '@/lib/live-whiteboard';
import { decideWhiteboardProposal,listWhiteboardProposals } from '@/lib/live-whiteboard-proposals';
import { Button } from '@/components/ui/button';
export interface ProposalPanelProps { boardId:string; role:Board['role']; online:boolean; pendingChanges?:boolean }
const statusLabel:Record<Proposal['status'],string>={pending:'待审阅',applied:'已应用',rejected:'已拒绝',conflicted:'版本冲突'};
function commandSummary(command:WhiteboardCommand):string{
  switch(command.type){
    case 'create':return `新增 ${command.object.kind}：${command.object.text||command.object.id}`;
    case 'delete':return `删除对象 ${command.id}`;
    case 'text':return `修改 ${command.id} 的文字：从第 ${command.index} 个字符删除 ${command.deleteCount} 个，插入「${command.insert}」`;
    case 'geometry':return `移动或调整 ${command.id}：位置 ${command.geometry.x}, ${command.geometry.y}，尺寸 ${command.geometry.width} × ${command.geometry.height}`;
    case 'style':return `调整 ${command.id} 的样式：${Object.keys(command.style).join('、')}`;
    case 'parent':return `将 ${command.id} 放入 ${command.parentId??'白板根层'}`;
  }
}
/** API suggestions only: this component never synthesizes a model result or auto-accepts. */
export function ProposalPanel({boardId,role,online,pendingChanges=false}:ProposalPanelProps){
  const [open,setOpen]=useState(false),[items,setItems]=useState<Proposal[]>([]),[loaded,setLoaded]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState<string|null>(null);
  const epoch=useRef(0),mutation=useRef(0),locked=useRef(false),requestIds=useRef(new Map<string,string>());
  const writable=online&&!pendingChanges&&role!=='viewer';
  useEffect(()=>{epoch.current++;setItems([]);setLoaded(false);setError('');setNotice('');requestIds.current.clear();},[boardId]);
  const refresh=useCallback(async()=>{
    if(!online||locked.current)return;
    const token=epoch.current,version=mutation.current;setLoading(true);
    try{const result=await listWhiteboardProposals(boardId);if(token===epoch.current&&version===mutation.current){setItems(result);setLoaded(true);setError('');}}
    catch(e){if(token===epoch.current)setError(e instanceof Error?e.message:'无法读取建议');}
    finally{if(token===epoch.current)setLoading(false);}
  },[boardId,online]);
  useEffect(()=>{if(!open||!online)return;void refresh();const interval=setInterval(()=>void refresh(),5000);return()=>{clearInterval(interval);};},[open,online,refresh]);
  useEffect(()=>()=>{epoch.current++;},[]);
  const decide=async(proposal:Proposal,action:'accept'|'reject')=>{
    if(locked.current||!writable||proposal.status!=='pending')return;
    const key=`${proposal.id}:${action}`;let requestId=requestIds.current.get(key);if(!requestId){requestId=crypto.randomUUID();requestIds.current.set(key,requestId);}
    locked.current=true;mutation.current++;const token=epoch.current;setBusy(proposal.id);setError('');setNotice('');
    try{const result=await decideWhiteboardProposal(boardId,proposal.id,action,requestId);if(token!==epoch.current)return;
      setItems(values=>values.map(item=>item.id===result.id?result:item));requestIds.current.delete(key);
      setNotice(result.status==='conflicted'?'白板已发生变化，此建议未应用。请基于最新白板重新提交建议。':result.status==='applied'?'建议已应用到白板。':'建议已拒绝，白板内容未改变。');
    }catch(e){if(token===epoch.current)setError(e instanceof Error?e.message:'决定提交失败，请手动重试');}
    finally{locked.current=false;if(token===epoch.current)setBusy(null);}
  };
  return <aside aria-label="AI 建议" className="w-80 max-w-full rounded-xl border bg-background p-3 text-foreground shadow-sm">
    <Button variant="outline" className="w-full" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>AI 建议 {open?'收起':'展开'}</Button>
    {open&&<div className="mt-3 max-h-[65vh] space-y-3 overflow-y-auto">
      <p className="text-sm text-muted-foreground">这里展示 API 提交的建议；尚未接入自动模型生成。接受前请检查整组修改。</p>
      {!online&&<p role="status">离线期间不能读取新建议或提交决定。</p>}{pendingChanges&&<p role="status">请等待本地修改同步后再处理建议。</p>}
      {loading&&<p role="status">正在读取建议…</p>}{error&&<p role="alert" className="text-destructive">{error}</p>}{notice&&<p role="status">{notice}</p>}
      <Button size="sm" variant="outline" disabled={!online||loading||busy!==null} onClick={()=>void refresh()}>刷新建议</Button>
      {loaded&&!items.length&&<p className="text-sm text-muted-foreground">当前没有建议。</p>}
      {items.map(item=><section key={item.id} className="space-y-2 rounded border p-2" aria-label={`建议：${item.title}`}>
        <p className="font-medium">{item.title} · {statusLabel[item.status]}</p>
        <p className="text-sm text-muted-foreground">提交者：{item.provenance.submittedBy}</p>
        {item.provenance.generator&&<p className="text-sm text-muted-foreground">生成器标签：{item.provenance.generator.label}（调用方声明，身份未验证）</p>}
        <p className="text-sm text-muted-foreground">基于版本 {item.baseEpoch}/{item.baseSeq}</p>
        <ol className="list-inside list-decimal space-y-1 text-sm">{item.commands.map((command,index)=><li key={index} className="whitespace-pre-wrap break-words">{commandSummary(command)}</li>)}</ol>
        {item.status==='conflicted'&&<p className="text-sm text-destructive">版本已变化，未覆盖现有内容；需要重新生成并审阅建议。</p>}
        {item.status==='pending'&&role!=='viewer'&&<div className="flex gap-2"><Button size="sm" disabled={!writable||busy!==null} onClick={()=>void decide(item,'accept')}>接受整组建议</Button><Button size="sm" variant="outline" disabled={!writable||busy!==null} onClick={()=>void decide(item,'reject')}>拒绝建议</Button></div>}
        {item.decidedBy&&<p className="text-sm text-muted-foreground">处理者：{item.decidedBy}</p>}
      </section>)}
    </div>}
  </aside>;
}
