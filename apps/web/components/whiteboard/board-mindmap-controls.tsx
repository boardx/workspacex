'use client';
import { useState } from 'react';
import { mermaidToModel } from '@repo/fabric-markdown';
import { readMindmapMetadata, readMindmapTree, type WhiteboardObject } from '@repo/whiteboard-core';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { BoardToolPopover } from './board-tool-popover';
import { boardMindmapSource } from './board-mindmap-source';
import type { MindmapAction } from './board-mindmap-planner';

export function BoardMindmapControls({objects,selectedId,position,disabled,busy,onAction}:{objects:readonly WhiteboardObject[];selectedId:string|null;position:{x:number;y:number};disabled:boolean;busy:boolean;onAction:(action:MindmapAction)=>Promise<boolean>}){
  const [sourceOpen,setSourceOpen]=useState(false),[importOpen,setImportOpen]=useState(false),[source,setSource]=useState('mindmap\n  中心主题\n    分支一\n    分支二'),[error,setError]=useState(''),[parsing,setParsing]=useState(false);
  const selected=objects.find(object=>object.id===selectedId),meta=selected&&readMindmapMetadata(selected);
  const node=meta?.role==='node'?selected:undefined;
  const tree=node&&meta?readMindmapTree(objects,meta.treeId):null;
  const blocked=disabled||busy||parsing;
  const add=(action:'add-child'|'add-sibling')=>{if(node)void onAction({action,nodeId:node.id,id:crypto.randomUUID(),edgeId:crypto.randomUUID(),text:'新主题'});};
  return <div data-testid="board-mindmap-controls" className="absolute left-3 top-16 z-30 flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-sm">
    <BoardToolPopover label="思维导图" placement="below" trigger={<Button variant="ghost" data-testid="board-mindmap-menu">思维导图</Button>}>
      <div className="grid gap-1">
        <Button data-testid="board-mindmap-create-root" disabled={blocked} onClick={()=>void onAction({action:'create-root',id:crypto.randomUUID(),text:'中心主题',position})}>新建思维导图</Button>
        <Button data-testid="board-mindmap-import" disabled={blocked} onClick={()=>{setError('');setImportOpen(true);}}>导入 Mermaid 思维导图</Button>
        {node&&tree?<>
          <Button data-testid="board-mindmap-child" disabled={blocked} onClick={()=>add('add-child')}>新增子主题 Tab</Button>
          <Button data-testid="board-mindmap-sibling" disabled={blocked||node.id===tree.root.id} onClick={()=>add('add-sibling')}>新增同级 Enter</Button>
          <Button data-testid="board-mindmap-collapse" disabled={blocked} onClick={()=>void onAction({action:'set-collapsed',nodeId:node.id,collapsed:meta?.role==='node'?!meta.collapsed:false})}>{meta?.role==='node'&&meta.collapsed?'展开分支':'折叠分支'}</Button>
          <Button data-testid="board-mindmap-layout" disabled={blocked} onClick={()=>void onAction({action:'layout',treeId:tree.root.id})}>整理思维导图</Button>
          {node.id!==tree.root.id?<BoardToolPopover label="移动分支到" placement="right"><div className="grid max-h-60 gap-1 overflow-auto">{[...tree.nodes.values()].filter(candidate=>candidate.id!==node.id).map(candidate=><Button key={candidate.id} data-testid={`board-mindmap-reparent-${candidate.id}`} disabled={blocked} onClick={()=>void onAction({action:'reparent',nodeId:node.id,newParentId:candidate.id})}>{candidate.text||'未命名主题'}</Button>)}</div></BoardToolPopover>:null}
          <Button data-testid="board-mindmap-export" onClick={()=>setSourceOpen(true)}>导出 Mermaid</Button>
          <Button data-testid="board-mindmap-delete" disabled={blocked} onClick={()=>void onAction({action:'delete-subtree',nodeId:node.id})}>删除此分支</Button>
        </>:null}
      </div>
    </BoardToolPopover>
    {node?<Button data-testid="board-mindmap-quick-child" disabled={blocked} onClick={()=>add('add-child')}>＋子主题</Button>:null}
    {busy?<span role="status">保存中</span>:null}
    <Dialog open={sourceOpen} onOpenChange={setSourceOpen}><DialogContent><DialogTitle>思维导图 Mermaid 源码</DialogTitle><DialogDescription>包含完整树和折叠的分支，坐标保留在白板中。</DialogDescription><Textarea data-testid="board-mindmap-source" readOnly value={tree?boardMindmapSource(objects,tree.root.id):''} rows={14}/></DialogContent></Dialog>
    <Dialog open={importOpen} onOpenChange={setImportOpen}><DialogContent><DialogTitle>导入 Mermaid 思维导图</DialogTitle><DialogDescription>使用当前便利贴和曲线连接线；最多导入 60 个主题，一次操作可完整撤销。</DialogDescription><Textarea data-testid="board-mindmap-import-source" value={source} onChange={event=>setSource(event.target.value)} rows={12}/>{error?<p role="alert">{error}</p>:null}<Button data-testid="board-mindmap-import-apply" disabled={blocked} onClick={()=>{setParsing(true);setError('');void mermaidToModel(source).then(async model=>{if(model.kind!=='mindmap')throw new Error('请提供 mindmap 源码');const ids=Object.fromEntries(model.nodes.map(node=>[node.id,crypto.randomUUID()])),edgeIds=Object.fromEntries(model.edges.map(edge=>[edge.id,crypto.randomUUID()]));if(await onAction({action:'import-mermaid',model,ids,edgeIds,position}))setImportOpen(false);}).catch(error=>setError(error instanceof Error?error.message:'无法解析思维导图')).finally(()=>setParsing(false));}}>导入</Button></DialogContent></Dialog>
  </div>;
}
