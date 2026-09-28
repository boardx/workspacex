'use client';
import type { WhiteboardAIProposal } from '@repo/contracts/whiteboard-operation';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export function BoardAIProposalPanel({proposal,busy=false,onConfirm,onCancel}:{proposal:WhiteboardAIProposal;busy?:boolean;onConfirm:()=>void;onCancel:()=>void}){
  const count=proposal.action.commands.length,label=proposal.action.type==='cluster'?'主题聚类':proposal.action.type==='arrange'?'智能排版':proposal.action.type==='connect'?'关系建议':proposal.action.type==='label'?'添加标签':'生成内容';
  const panels=proposal.action.commands.flatMap(command=>command.type==='create'&&command.object.kind==='frame'?[command.object]:[]);
  const geometry=proposal.action.commands.flatMap(command=>command.type==='geometry'?[{id:command.id,...command.geometry}]:[]);
  const x=Math.min(...panels.map(panel=>panel.geometry.x),...geometry.map(item=>item.x)),y=Math.min(...panels.map(panel=>panel.geometry.y),...geometry.map(item=>item.y));
  const width=Math.max(1,...panels.map(panel=>panel.geometry.x+panel.geometry.width-x)),height=Math.max(1,...panels.map(panel=>panel.geometry.y+panel.geometry.height-y));
  return <Dialog open onOpenChange={open=>{if(!open&&!busy)onCancel();}}><DialogContent hideClose data-testid="board-ai-proposal" className="w-[calc(100vw-2rem)] max-w-lg overflow-y-auto" onEscapeKeyDown={event=>{if(busy)event.preventDefault();}} onPointerDownOutside={event=>event.preventDefault()}>
    <div><DialogTitle>按主题整理便利贴</DialogTitle><DialogDescription className="mt-2">先看看新的分组。确认后可以一次撤销。</DialogDescription></div>
    <div className="grid grid-cols-2 gap-3 text-14"><section data-testid="board-ai-before" className="rounded-xl bg-muted p-3"><strong>{proposal.provenance.inputObjectIds.length} 张便利贴</strong><p className="mt-1 text-12 text-muted-foreground">保留原有内容</p></section><section data-testid="board-ai-after" className="rounded-xl bg-primary/10 p-3"><strong>{panels.length ? `${panels.length} 个主题` : label}</strong><p className="mt-1 text-12 text-muted-foreground">预览中 · 尚未修改白板</p></section></div>
    {panels.length?<section aria-label="主题与排版预览" className="mt-3"><svg role="img" aria-label="确认后的主题区域排版" viewBox={`${x} ${y} ${width} ${height}`} className="h-40 w-full rounded-lg border border-border">
      {panels.map(panel=><rect key={panel.id} x={panel.geometry.x} y={panel.geometry.y} width={panel.geometry.width} height={panel.geometry.height} fill="#F4F4F5" stroke="#71717A" strokeWidth={2}/>)}
      {geometry.map(item=><rect key={item.id} x={item.x} y={item.y} width={item.width} height={item.height} fill="#F8D76E" stroke="#A16207"/>)}
    </svg><ul className="mt-2 space-y-1 text-12">{panels.map(panel=><li key={panel.id}>{panel.text} · {proposal.action.commands.filter(command=>command.type==='parent'&&command.parentId===panel.id).length} 张便利贴</li>)}</ul></section>:null}
    <details className="text-12 text-muted-foreground"><summary className="min-h-11 cursor-pointer py-3">技术详情</summary><p>revision {proposal.baseRevision.epoch}:{proposal.baseRevision.seq} · {count} 条结构化命令</p><dl className="mt-3 grid grid-cols-[72px_1fr] gap-1 text-11 text-muted-foreground"><dt>模型</dt><dd>{proposal.provenance.model??'未记录'}</dd><dt>Skill</dt><dd>{proposal.provenance.skill??'未记录'}</dd><dt>输入对象</dt><dd>{proposal.provenance.inputObjectIds.length}</dd></dl></details>
    <div className="mt-4 flex justify-end gap-2"><Button data-testid="board-ai-cancel" variant="outline" className="min-h-11" disabled={busy} onClick={onCancel}>取消</Button><Button data-testid="board-ai-confirm" variant="primary" className="min-h-11" disabled={busy} onClick={onConfirm}>{busy?'正在应用…':'确认应用'}</Button></div>
  </DialogContent></Dialog>;
}
