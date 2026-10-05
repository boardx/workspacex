'use client';
import {useEffect,useState} from 'react';
import type {Doc} from 'yjs';
import {readObjects} from '@repo/whiteboard-core';
import type {WhiteboardAIProposal} from '@repo/contracts/whiteboard-operation';
import {boardOrganizeActors,organizeBoard,undoAIProposal,type BoardAIUndoTarget} from '@/lib/whiteboard-operation-client';
import {Sparkles,SlidersHorizontal} from 'lucide-react';
import {BoardToolPopover} from './board-tool-popover';
import {Button} from '@/components/ui/button';
export function BoardOrganizeControls({boardId,selectedIds,doc,readOnly,onProposal,undo,onUndone}:{boardId:string;selectedIds:string[];doc?:Doc;readOnly:boolean;onProposal:(proposal:WhiteboardAIProposal)=>void;undo:BoardAIUndoTarget|null;onUndone:()=>void}){
  const[actors,setActors]=useState<Array<{actorId:string;model:string;skill:string}>>([]),[actor,setActor]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[detailsOpen,setDetailsOpen]=useState(false);
  const [,setRevision]=useState(0);
  useEffect(()=>{if(!doc)return;const changed=()=>setRevision(value=>value+1);doc.on('update',changed);return()=>{doc.off('update',changed);};},[doc]);
  const validSelection=!doc||selectedIds.every(id=>readObjects(doc).some(object=>object.id===id&&object.kind==='sticky'&&!object.locked));
  useEffect(()=>{let current=true;if(!readOnly)void boardOrganizeActors(boardId).then(values=>{if(current){setActors(values);setActor(values[0]?.actorId??'');}}).catch(()=>{if(current)setNotice('AI Agent 暂不可用，请检查授权和已发布模型配置。');});return()=>{current=false;};},[boardId,readOnly]);
  const run=async()=>{if(!validSelection||busy||!actor||selectedIds.length<2||selectedIds.length>60)return;setBusy(true);setNotice('正在读取所选便利贴并生成主题…');try{onProposal(await organizeBoard(boardId,actor,selectedIds));setNotice('预览已生成，确认前不会修改白板。');}catch(error){setDetailsOpen(true);setNotice(error instanceof Error&&error.message==='BOARD_OPERATION_CONFLICT'?'白板已变化，请重新选择并生成。':'未能生成主题；请检查模型配置或重试，白板未修改。');}finally{setBusy(false);}};
  const undoOnce=async()=>{if(!undo)return;setBusy(true);try{await undoAIProposal(undo,undo.expectedRevision);onUndone();setNotice('AI 整理已整体撤销。');}catch(error){setNotice(error instanceof Error&&error.message==='BOARD_OPERATION_CONFLICT'?'白板已被修改，不能覆盖这些修改；AI 撤销未执行。':'撤销尚未确认，请重试。');}finally{setBusy(false);}};
  if(readOnly)return null;
  return <aside data-testid="board-organize-controls" aria-label="AI 整理" className="flex shrink-0 items-center border-l border-border pl-1">
    <button type="button" data-testid="board-ai-organize" aria-label="按主题整理所选便利贴（AI）" title={notice || (!validSelection ? 'AI 整理支持未锁定便利贴；请移除绘图或其他对象' : !actor ? '没有可用的整理助手，请打开整理选项检查授权与模型' : selectedIds.length < 2 || selectedIds.length > 60 ? '选择 2–60 张未锁定便利贴，按内容主题生成可确认的整理预览' : '按内容主题生成便利贴分组预览，确认后应用')} disabled={busy||!actor||!validSelection||selectedIds.length<2||selectedIds.length>60} onClick={()=>void run()} className="flex min-h-12 min-w-14 flex-col items-center justify-center rounded-xl px-2 text-11 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:text-disabled-foreground"><Sparkles className="h-5 w-5"/><span className="sr-only">{busy?'处理中…':'AI 整理'}</span></button>
    <BoardToolPopover label="AI 整理" open={detailsOpen} onOpenChange={setDetailsOpen} trigger={<button type="button" aria-label="AI 整理选项和状态" className="min-h-12 min-w-11 rounded-xl transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"><SlidersHorizontal className="mx-auto h-5 w-5"/></button>}><p className="text-13 text-muted-foreground">{notice||`已选 ${selectedIds.length} 个对象。支持 2–60 张未锁定便利贴。`}</p>
    {actors.length>1?<select className="min-h-11 rounded-lg border border-border bg-background px-3" aria-label="整理 Agent" value={actor} onChange={event=>setActor(event.target.value)}>{actors.map((value,index)=><option key={value.actorId} value={value.actorId}>整理助手 {index+1}</option>)}</select>:null}
    {!actors.length?<p>暂时没有可用的整理助手。</p>:null}
    {undo?<Button data-testid="board-ai-undo" className="min-h-11" disabled={busy} onClick={()=>void undoOnce()}>撤销 AI 整理</Button>:null}
    </BoardToolPopover><p role="status" className="sr-only">{notice}</p>
  </aside>;
}
