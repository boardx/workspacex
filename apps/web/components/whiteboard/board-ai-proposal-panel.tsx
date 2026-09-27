'use client';
import type { WhiteboardAIProposal } from '@repo/contracts/whiteboard-operation';
import { Button } from '@/components/ui/button';

export function BoardAIProposalPanel({proposal,busy=false,onConfirm,onCancel}:{proposal:WhiteboardAIProposal;busy?:boolean;onConfirm:()=>void;onCancel:()=>void}){
  const count=proposal.action.commands.length,label=proposal.action.type==='cluster'?'主题聚类':proposal.action.type==='arrange'?'智能排版':proposal.action.type==='connect'?'关系建议':proposal.action.type==='label'?'添加标签':'生成内容';
  const panels=proposal.action.commands.flatMap(command=>command.type==='create'&&command.object.kind==='frame'?[command.object]:[]);
  const geometry=proposal.action.commands.flatMap(command=>command.type==='geometry'?[{id:command.id,...command.geometry}]:[]);
  const x=Math.min(0,...panels.map(panel=>panel.geometry.x)),y=Math.min(0,...panels.map(panel=>panel.geometry.y));
  const width=Math.max(1,...panels.map(panel=>panel.geometry.x+panel.geometry.width-x)),height=Math.max(1,...panels.map(panel=>panel.geometry.y+panel.geometry.height-y));
  return <aside data-testid="board-ai-proposal" aria-label="AI 修改预览" className="absolute right-4 top-16 z-40 max-h-[calc(100vh-6rem)] w-80 overflow-auto rounded-container border border-border bg-card p-4 shadow-lg">
    <div className="mb-3 flex items-center justify-between"><h2 className="text-14 font-semibold">AI 修改预览</h2><span className="rounded-control bg-primary/10 px-2 py-1 text-11 text-primary">尚未写入</span></div>
    <p className="text-13">{label}将修改 {count} 项。确认后作为一次操作写入，可整体撤销。</p>
    <div className="mt-3 grid grid-cols-2 gap-2 text-11"><section data-testid="board-ai-before" className="rounded-control bg-muted p-2"><strong>修改前</strong><p>revision {proposal.baseRevision.epoch}:{proposal.baseRevision.seq}</p><p>{Object.keys(proposal.baseObjectDigests).length} 个对象已校验</p></section><section data-testid="board-ai-after" className="rounded-control bg-primary/10 p-2"><strong>确认后</strong><p>{count} 条结构化命令</p><p>{proposal.action.type}</p></section></div>
    {panels.length?<section aria-label="主题与排版预览" className="mt-3"><svg role="img" aria-label="确认后的主题区域排版" viewBox={`${x} ${y} ${width} ${height}`} className="h-40 w-full rounded-lg border border-border">
      {panels.map(panel=><rect key={panel.id} x={panel.geometry.x} y={panel.geometry.y} width={panel.geometry.width} height={panel.geometry.height} fill="#F4F4F5" stroke="#71717A" strokeWidth={2}/>)}
      {geometry.map(item=><rect key={item.id} x={item.x} y={item.y} width={item.width} height={item.height} fill="#F8D76E" stroke="#A16207"/>)}
    </svg><ul className="mt-2 space-y-1 text-12">{panels.map(panel=><li key={panel.id}>{panel.text} · {proposal.action.commands.filter(command=>command.type==='parent'&&command.parentId===panel.id).length} 张便利贴</li>)}</ul></section>:null}
    <dl className="mt-3 grid grid-cols-[72px_1fr] gap-1 text-11 text-muted-foreground"><dt>模型</dt><dd>{proposal.provenance.model??'未记录'}</dd><dt>Skill</dt><dd>{proposal.provenance.skill??'未记录'}</dd><dt>输入对象</dt><dd>{proposal.provenance.inputObjectIds.length}</dd></dl>
    <div className="mt-4 flex justify-end gap-2"><Button data-testid="board-ai-cancel" variant="outline" disabled={busy} onClick={onCancel}>取消</Button><Button data-testid="board-ai-confirm" variant="primary" disabled={busy} onClick={onConfirm}>{busy?'正在应用…':'确认应用'}</Button></div>
  </aside>;
}
