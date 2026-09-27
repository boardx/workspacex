'use client';
import type { WhiteboardAIProposal } from '@repo/contracts/whiteboard-operation';
import { Button } from '@/components/ui/button';

export function BoardAIProposalPanel({proposal,busy=false,onConfirm,onCancel}:{proposal:WhiteboardAIProposal;busy?:boolean;onConfirm:()=>void;onCancel:()=>void}){
  const count=proposal.action.commands.length,label=proposal.action.type==='cluster'?'主题聚类':proposal.action.type==='arrange'?'智能排版':proposal.action.type==='connect'?'关系建议':proposal.action.type==='label'?'添加标签':'生成内容';
  return <aside data-testid="board-ai-proposal" aria-label="AI 修改预览" className="absolute right-4 top-16 z-30 w-80 rounded-container border border-border bg-card p-4 shadow-lg">
    <div className="mb-3 flex items-center justify-between"><h2 className="text-14 font-semibold">AI 修改预览</h2><span className="rounded-control bg-primary/10 px-2 py-1 text-11 text-primary">尚未写入</span></div>
    <p className="text-13">{label}将修改 {count} 项。确认后作为一次操作写入，可整体撤销。</p>
    <div className="mt-3 grid grid-cols-2 gap-2 text-11"><section data-testid="board-ai-before" className="rounded-control bg-muted p-2"><strong>修改前</strong><p>revision {proposal.baseRevision.epoch}:{proposal.baseRevision.seq}</p><p>{Object.keys(proposal.baseObjectDigests).length} 个对象已校验</p></section><section data-testid="board-ai-after" className="rounded-control bg-primary/10 p-2"><strong>确认后</strong><p>{count} 条结构化命令</p><p>{proposal.action.type}</p></section></div>
    <dl className="mt-3 grid grid-cols-[72px_1fr] gap-1 text-11 text-muted-foreground"><dt>模型</dt><dd>{proposal.provenance.model??'未记录'}</dd><dt>Skill</dt><dd>{proposal.provenance.skill??'未记录'}</dd><dt>输入对象</dt><dd>{proposal.provenance.inputObjectIds.length}</dd></dl>
    <div className="mt-4 flex justify-end gap-2"><Button data-testid="board-ai-cancel" variant="outline" disabled={busy} onClick={onCancel}>取消</Button><Button data-testid="board-ai-confirm" variant="primary" disabled={busy} onClick={onConfirm}>{busy?'正在应用…':'确认应用'}</Button></div>
  </aside>;
}
