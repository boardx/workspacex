'use client';
import * as React from 'react';
import type { DiagramModel } from '@repo/fabric-markdown/model';
import type { WhiteboardPlacementPreview } from '@repo/contracts/whiteboard-operation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import Link from 'next/link';
import { listChatBoardTargets } from '@/lib/chat-board-targets';
import { insertRenderedArtifact, readBoardPlacementPreview } from '@/lib/whiteboard-operation-client';
import { renderedDiagramLayout } from '@/lib/chat-board-diagram-layout';
import { insertionPlacement } from '@/lib/board-insertion-placement';
import { ChatBoardPlacementPreview } from './chat-board-placement-preview';
export { renderedDiagramLayout } from '@/lib/chat-board-diagram-layout';

type Attempt = Parameters<typeof insertRenderedArtifact>[0];
export function ChatDiagramBoardHandoff({ model, artifactId, sourceRevision, orgId, projectId, prepareSource }: { model: DiagramModel | null; artifactId?: string; sourceRevision?: string; orgId?: string; projectId?: string; prepareSource?:()=>Promise<{artifactId:string;sourceRevision:string}> }) {
  const scopeKey=JSON.stringify({orgId,projectId,artifactId,sourceRevision});
  const currentScope=React.useRef(scopeKey);currentScope.current=scopeKey;
  const generation=React.useRef(0);
  const [loadedScope,setLoadedScope]=React.useState('');
  const [inserted,setInserted]=React.useState<{id:string;scope:string;projectId?:string;artifactId:string;layoutHash:string}|null>(null);
  const [open,setOpen]=React.useState(false), [boards,setBoards]=React.useState<{id:string;name:string}[]>([]);
  const [boardId,setBoardId]=React.useState(''), [offset,setOffset]=React.useState({x:0,y:0});
  const [busy,setBusy]=React.useState(false), [loading,setLoading]=React.useState(false), [notice,setNotice]=React.useState('');
  const [preview,setPreview]=React.useState<WhiteboardPlacementPreview|null>(null), [reload,setReload]=React.useState(0);
  const attempt=React.useRef<{key:string;request:Attempt}|null>(null);
  const prepared=React.useRef<{scope:string;artifactId:string;sourceRevision:string}|null>(null);
  const layoutResult=React.useMemo(()=>{
    if(!model||!orgId||(!prepareSource&&(!artifactId||!sourceRevision)))return {layout:null,error:''};
    // Provisional identity is preview-only. A verified immutable source is required at submit.
    try{return {layout:renderedDiagramLayout(model,artifactId??'preview',orgId,sourceRevision??'preview'),error:''};}
    catch{return {layout:null,error:'此画布含尚未支持插入的对象，请先移除图片或特殊图形后重试。'};}
  },[model,artifactId,sourceRevision,orgId,prepareSource]);
  const incoming=React.useMemo(()=>layoutResult.layout?.objects.map(object=>({...object.geometry,height:object.geometry.height+(typeof object.style.lifelineHeight==='number'?object.style.lifelineHeight:0)}))??[],[layoutResult]);
  React.useEffect(()=>{generation.current++;setOpen(false);setPreview(null);setLoadedScope('');setBoards([]);setBoardId('');setNotice('');setInserted(null);attempt.current=null;},[scopeKey]);
  React.useEffect(()=>{
    if(!open||!boardId||loadedScope!==scopeKey)return;
    const controller=new AbortController();setPreview(null);setLoading(true);
    void readBoardPlacementPreview(boardId,controller.signal).then(value=>{
      if(controller.signal.aborted)return;
      setPreview(value);setOffset(insertionPlacement(value.objects.filter(object=>!object.appearance?.hidden).map(object=>object.geometry),incoming).recommended);
      setNotice(value.archived?'此白板已归档，请选择其他白板。':!['owner','editor'].includes(value.role)?'你只有此白板的查看权限，请选择可编辑的白板。':'');
    }).catch(()=>{if(!controller.signal.aborted)setNotice('无法读取白板布局，请重试。');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[open,boardId,incoming,reload,scopeKey,loadedScope]);
  const close=()=>{if(!busy){generation.current++;setOpen(false);}};
  const begin=async()=>{
    const active=++generation.current,scope=scopeKey;
    setNotice('');setInserted(null);setBoards([]);setPreview(null);setLoadedScope('');setBoardId('');setOpen(true);setLoading(true);
    try{
      const values=await listChatBoardTargets(projectId);
      if(active!==generation.current||scope!==currentScope.current)return;
      setBoards(values);setLoadedScope(scope);setBoardId(values[0]?.id??'');
    }catch{if(active===generation.current&&scope===currentScope.current)setNotice('无法读取白板列表，请重试。');}
    finally{if(active===generation.current&&scope===currentScope.current)setLoading(false);}
  };
  const editable=loadedScope===scopeKey&&preview?.boardId===boardId&&!preview.archived&&['owner','editor'].includes(preview.role);
  const submit=async()=>{
    let layout=layoutResult.layout;
    if(!layout||!preview||!editable||busy||loading)return;
    const scope=scopeKey;
    setBusy(true);
    try{
      if(prepareSource){
        if(!prepareSource||!model||!orgId)return;
        if(prepared.current?.scope!==scope)prepared.current={scope,...await prepareSource()};
        if(scope!==currentScope.current)return;
        layout=renderedDiagramLayout(model,prepared.current.artifactId,orgId,prepared.current.sourceRevision);
      }
      const key=JSON.stringify({scope,boardId,layoutHash:layout.layoutHash,offset});
      if(attempt.current?.key!==key)attempt.current={key,request:{layout,boardId,...preview.revision,requestId:crypto.randomUUID(),offset}};
      await insertRenderedArtifact(attempt.current.request);
      if(scope!==currentScope.current)return;
      attempt.current=null;setInserted({id:boardId,scope,projectId,artifactId:layout.artifactId,layoutHash:layout.layoutHash});setNotice('已插入目标白板');setOpen(false);
    }catch(error){
      if(scope!==currentScope.current)return;
      const message=error instanceof Error?error.message:'';
      if(message==='BOARD_OPERATION_CONFLICT'){attempt.current=null;setPreview(null);setNotice('白板已变化，请刷新位置预览后重新确认。');}
      else setNotice('插入失败，请重试；重试保留本次请求身份。');
    }finally{setBusy(false);}
  };
  return <>
    <Button type="button" size="sm" variant="outline" disabled={!model||!orgId||(!prepareSource&&(!artifactId||!sourceRevision))} onClick={()=>void begin()} data-testid="chat-diagram-insert-board">插入 Board</Button>
    <Dialog open={open} onOpenChange={value=>{if(!value)close();}}><DialogContent className="sm:max-w-2xl">
      <DialogTitle>插入到 Board</DialogTitle><DialogDescription>{projectId?'选择当前项目的白板，在概览中拖动红框确认插入位置。':'选择当前组织的白板，在概览中拖动红框确认插入位置。'}</DialogDescription>
      <Select aria-label="目标白板" data-testid="chat-board-target" disabled={busy||loading} value={boardId} onValueChange={value=>{if(value===boardId)return;setPreview(null);setBoardId(value);setNotice('');}} options={boards.map(board=>({value:board.id,label:board.name}))}/>
      {loading?<div data-testid="loading" className="h-64 animate-pulse rounded-lg bg-muted"/>:null}
      {!loading&&!boards.length&&!notice?<p data-testid="empty" className="text-sm text-muted-foreground">{projectId?'当前项目还没有白板，请先在项目中创建或关联 Board。':'当前组织还没有白板，请先创建 Board 后再插入。'}</p>:null}
      {layoutResult.error?<p role="alert">{layoutResult.error}</p>:null}
      {!loading&&preview&&layoutResult.layout?<ChatBoardPlacementPreview existing={preview.objects} incoming={incoming} incomingObjects={layoutResult.layout.objects} offset={offset} onChange={setOffset} disabled={busy||!editable}/>:null}
      {notice?<p role="status" data-testid="err-board-insertion" className="text-sm text-muted-foreground">{notice}</p>:null}
      <div className="flex justify-end gap-2">
        {notice&&!busy?<Button type="button" variant="outline" onClick={()=>{if(boardId)setReload(value=>value+1);else void begin();}}>刷新位置预览</Button>:null}
        <Button type="button" variant="outline" disabled={busy} onClick={close}>取消</Button>
        <Button data-testid="chat-board-handoff-confirm" disabled={busy||loading||!editable||!layoutResult.layout} onClick={()=>void submit()}>{busy?'插入中…':'确认插入'}</Button>
      </div>
    </DialogContent></Dialog>
    {!open&&notice?<span role="status">{notice}</span>:null}
    {inserted?.scope===scopeKey?<Link data-testid="chat-board-open-inserted" className="text-sm text-primary underline" href={`/studio/board/${encodeURIComponent(inserted.id)}?${new URLSearchParams({...(inserted.projectId?{projectId:inserted.projectId}:{}),focusArtifact:inserted.artifactId,focusLayout:inserted.layoutHash})}`}>打开 Board</Link>:null}
  </>;
}
