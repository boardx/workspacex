'use client';
import {useEffect,useState} from 'react';
import type {WhiteboardAIProposal} from '@repo/contracts/whiteboard-operation';
import {boardOrganizeActors,organizeBoard,undoAIProposal} from '@/lib/whiteboard-operation-client';
import {Button} from '@/components/ui/button';
export function BoardOrganizeControls({boardId,selectedIds,readOnly,onProposal,undo,onUndone}:{boardId:string;selectedIds:string[];readOnly:boolean;onProposal:(proposal:WhiteboardAIProposal)=>void;undo:{proposal:WhiteboardAIProposal;revision:{epoch:number;seq:number}}|null;onUndone:()=>void}){
  const[actors,setActors]=useState<Array<{actorId:string;model:string;skill:string}>>([]),[actor,setActor]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  useEffect(()=>{let current=true;if(!readOnly)void boardOrganizeActors(boardId).then(values=>{if(current){setActors(values);setActor(values[0]?.actorId??'');}}).catch(()=>{if(current)setNotice('AI Agent 暂不可用，请检查授权和已发布模型配置。');});return()=>{current=false;};},[boardId,readOnly]);
  const run=async()=>{setBusy(true);setNotice('正在读取所选便利贴并生成主题…');try{onProposal(await organizeBoard(boardId,actor,selectedIds));setNotice('预览已生成，确认前不会修改白板。');}catch(error){setNotice(error instanceof Error&&error.message==='BOARD_OPERATION_CONFLICT'?'白板已变化，请重新选择并生成。':'未能生成主题；请检查模型配置或重试，白板未修改。');}finally{setBusy(false);}};
  const undoOnce=async()=>{if(!undo)return;setBusy(true);try{await undoAIProposal(undo.proposal,undo.revision);onUndone();setNotice('AI 整理已整体撤销。');}catch(error){setNotice(error instanceof Error&&error.message==='BOARD_OPERATION_CONFLICT'?'白板已被修改，不能覆盖这些修改；AI 撤销未执行。':'撤销尚未确认，请重试。');}finally{setBusy(false);}};
  if(readOnly)return null;
  return <aside data-testid="board-organize-controls" aria-label="AI 整理" className="fixed bottom-24 right-4 z-30 max-w-80 rounded-xl border border-border bg-card p-2 shadow-lg">
    <div className="flex items-center gap-2">{actors.length>1?<select aria-label="整理 Agent" value={actor} onChange={event=>setActor(event.target.value)}>{actors.map(value=><option key={value.actorId} value={value.actorId}>{value.actorId}</option>)}</select>:null}
      <Button data-testid="board-ai-organize" disabled={busy||!actor||selectedIds.length<2||selectedIds.length>60} onClick={()=>void run()}>{busy?'正在处理…':'AI 整理'}</Button>
      {undo?<Button data-testid="board-ai-undo" disabled={busy} onClick={()=>void undoOnce()}>撤销 AI 整理</Button>:null}</div>
    <p role="status" className="mt-1 text-12 text-muted-foreground">{notice||(!actors.length?'需要已授权且模型配置匹配的 Agent。':`已选 ${selectedIds.length} 个对象 · 支持 2–60 张未锁定便利贴`)}</p>
  </aside>;
}
