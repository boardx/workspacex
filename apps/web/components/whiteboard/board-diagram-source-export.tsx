'use client';
import '@repo/fabric-markdown/templates';
import { useState } from 'react';
import type { WhiteboardObject } from '@repo/contracts/whiteboard-document';
import { modelToMermaid } from '@repo/fabric-markdown/mermaid-serializer';
import { diagramModelFromBoardObjects } from '@/lib/board-diagram-source';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

export function BoardDiagramSourceExport({objects}:{objects:WhiteboardObject[]}) {
  const [open,setOpen]=useState(false), [selected,setSelected]=useState('');
  const ids=[...new Set(objects.flatMap(object=>{const content=object.extensionData?.content as Record<string,unknown>|undefined;return content?.type==='artifact' && typeof content.artifactId==='string' ? [content.artifactId] : [];}))];
  if (!ids.length) return null;
  const id=ids.includes(selected)?selected:ids[0]!;
  let source='',error='';
  if(open) try { const model=diagramModelFromBoardObjects(objects,id);source=`\`\`\`${model.kind==='template'?'persona':'mermaid'}\n${modelToMermaid(model)}\n\`\`\``; }
  catch { error='图形关系已不完整，暂不能导出；请恢复缺失节点后重试。'; }
  return <><Button data-testid="board-diagram-source-export" onClick={()=>setOpen(true)}>图形源码</Button><Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogTitle>导出当前图形源码</DialogTitle><DialogDescription>从白板当前对象生成可编辑的 Mermaid / Persona 源码。</DialogDescription><select aria-label="源图形" value={id} onChange={event=>setSelected(event.target.value)}>{ids.map(value=><option key={value} value={value}>{value}</option>)}</select>{error?<p role="alert">{error}</p>:<Textarea data-testid="board-diagram-source" readOnly value={source} rows={14}/>}<Button disabled={Boolean(error)} onClick={()=>{const url=URL.createObjectURL(new Blob([source],{type:'text/markdown'}));const link=document.createElement('a');link.href=url;link.download=`diagram-${id}.md`;link.click();setTimeout(()=>URL.revokeObjectURL(url),0);}}>下载源码</Button></DialogContent></Dialog></>;
}
