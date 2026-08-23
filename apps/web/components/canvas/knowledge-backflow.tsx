"use client";
import * as React from "react";
import {
  CheckCircle2, AlertTriangle, CircleDashed, ArrowRightLeft, ClipboardCheck, Link2, Link2Off, Presentation, HelpCircle, TreeDeciduous,
} from "lucide-react";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import type { ProjectRole } from "@/lib/identity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import {
  FACT_NODES, CONFLICT_PAIR, METHOD_STAGES, PIPELINE_SCENARIOS, PIPELINE_GRID,
  GROUP_TREE, BATCH_CONFIRM_ITEMS, TEMPLATE_TO_STAGE_NOTE,
  type GraphNode, type NodeStatus, type MethodCellStatus,
} from "@/lib/mock/canvas";

const NODE_TONE: Record<NodeStatus, "primary" | "danger" | "outline"> = {
  已确认: "primary",
  冲突: "danger",
  待确认: "outline",
};
const NODE_ICON: Record<NodeStatus, typeof CheckCircle2> = {
  已确认: CheckCircle2,
  冲突: AlertTriangle,
  待确认: CircleDashed,
};
const CELL_STYLE: Record<MethodCellStatus, string> = {
  已完成: "bg-primary text-primary-foreground",
  正在讨论: "bg-warning/20 text-background-foreground",
  冲突停滞: "bg-destructive/20 text-destructive",
  建议下一步: "bg-accent text-accent-foreground",
  未开始: "bg-muted text-muted-foreground",
};

/**
 * UC-7.4 画布回流知识图谱（F107）
 * [原型] 两端已探明（画布 + 事实关系屏），但**中间的「汇入/回流」入口属原型确认缺失**，本屏补画。
 * 三区：① 事实关系图谱（节点三态 + 来源链 + 回流动作）② 推演流水线（9 方法环节 × 场景）
 *       ③ 本组小树（[未探明]，原创设计）+ [批量确认]（[原型待补]）。
 * 硬约束显式：只有组长确认才写回大脑；来源链断即拒绝写回；互斥结论不自动择一。
 */
export function KnowledgeBackflow({ state, previewRole }: { state: UiState; previewRole: ProjectRole | null }) {
  const [confirmedIds, setConfirmedIds] = React.useState<Set<string>>(new Set());
  const [batchOpen, setBatchOpen] = React.useState(false);
  const [batchChecked, setBatchChecked] = React.useState<Set<string>>(new Set(BATCH_CONFIRM_ITEMS.map((n) => n.id)));
  const [wroteBack, setWroteBack] = React.useState(false);
  // 组员只见本组小树、观察者只见脱敏聚合、引导师可批量确认+写回
  const isFacilitator = previewRole === "facilitator";
  const isLead = previewRole === "groupLead" || isFacilitator;

  const doneGrid = PIPELINE_GRID.flat().filter((c) => c === "已完成").length;
  const totalGrid = PIPELINE_SCENARIOS.length * METHOD_STAGES.length;

  const toggleBatch = (id: string) => {
    setBatchChecked((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  return (
    <div className="flex h-full flex-col" data-testid="backflow-root">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-14 font-semibold tracking-tight">现场协作 · 知识图谱 · 事实关系</h1>
          <p className="text-11 text-muted-foreground">每 15 秒刷新 · 只有组长确认过的节点才会写回组织大脑</p>
        </div>
        {isFacilitator && (
          <Button size="sm" variant="primary" onClick={() => setBatchOpen(true)} data-testid="backflow-batch-confirm">
            <ClipboardCheck aria-hidden className="h-3.5 w-3.5" /> 批量确认并写回大脑
          </Button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <StateShell
          state={state}
          skeletonRows={5}
          emptyHint="还没有组长确认过的节点——图谱为空（不生成伪节点）。先在画布上确认节点，再汇入全场。"
          errors={{ chain: "这个节点的来源链断了（缺来源转录片段），已挡下——链断即拒绝写回组织大脑" }}
          depFailure={{ what: "图谱 / 组织大脑服务不可用，画布内容与确认状态不变；写回暂停，可重试", retry: () => location.reload() }}
          denial={{ layer: "project", reason: "组员只见本组小树；观察者只见已发布且脱敏的聚合，看不到各组原始来源" }}
          successMessage="已写回组织大脑，携带来源画布、版本、操作者、时间与可见范围（append-only，见 F08 provenance_events）"
        >
          <div className="flex flex-col gap-4 xl:grid xl:grid-cols-[1fr_300px]">
            <div className="flex flex-col gap-4">
              {/* ① 事实关系图谱 */}
              <section className="flex flex-col gap-2" data-testid="backflow-fact-graph">
                <h2 className="text-13 font-semibold">事实关系 · {FACT_NODES.length} 节点</h2>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {FACT_NODES.map((n) => (
                    <FactNodeCard key={n.id} node={n} confirmed={confirmedIds.has(n.id)} canConfirm={isLead} onConfirm={() => setConfirmedIds((p) => new Set(p).add(n.id))} />
                  ))}
                </div>

                {/* 互斥结论：支持与反驳边并存，不自动择一 */}
                <div className="flex flex-col gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 p-2.5" data-testid="backflow-conflict">
                  <p className="flex items-center gap-1.5 text-11 font-semibold text-destructive">
                    <AlertTriangle aria-hidden className="h-3.5 w-3.5" /> 冲突待判定 · 2
                  </p>
                  <p className="text-10 text-muted-foreground">
                    「EMC 可跨园区复制」与「EMC 合同标准化足以降门槛」互斥——支持与反驳边并存，系统不自动择一，等现场判定。
                  </p>
                  <div className="flex items-center gap-1.5">
                    {CONFLICT_PAIR.exits.map((e) => (
                      <Button key={e} size="xs" variant="outline" data-testid={`backflow-conflict-exit-${e === "上台讨论" ? "discuss" : "uncertain"}`}>
                        {e === "上台讨论" ? <Presentation aria-hidden className="h-3 w-3" /> : <HelpCircle aria-hidden className="h-3 w-3" />}
                        {e}
                      </Button>
                    ))}
                  </div>
                </div>
              </section>

              {/* ② 推演流水线 9 方法环节 × 场景 */}
              <section className="flex flex-col gap-2" data-testid="backflow-pipeline">
                <div className="flex items-center justify-between">
                  <h2 className="text-13 font-semibold">推演流水线</h2>
                  <span className="text-11 text-muted-foreground tabular-nums" data-testid="backflow-progress">进度 {doneGrid} / {totalGrid} 格 · {PIPELINE_SCENARIOS.length} 场景 × {METHOD_STAGES.length} 环节</span>
                </div>
                <div className="overflow-x-auto" data-allow-x-scroll="9 环节 × 场景网格需横向查看">
                  <Table className="w-full border-collapse text-9">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="sticky left-0 bg-card px-1.5 py-1 text-left font-medium text-muted-foreground">场景 ＼ 方法环节</TableHead>
                        {METHOD_STAGES.map((m) => (<TableHead key={m} className="px-1 py-1 font-medium text-muted-foreground whitespace-nowrap">{m}</TableHead>))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {PIPELINE_SCENARIOS.map((sc, ri) => (
                        <TableRow key={sc}>
                          <TableCell className="sticky left-0 bg-card px-1.5 py-1 font-medium whitespace-nowrap">{sc}</TableCell>
                          {PIPELINE_GRID[ri]!.map((cell, ci) => (
                            <TableCell key={ci} className="p-0.5" data-testid={`backflow-cell-${ri}-${ci}`}>
                              <div className={cn("rounded-sm px-1 py-1 text-center", CELL_STYLE[cell])} title={cell}>
                                {cell === "已完成" ? "✓" : cell === "冲突停滞" ? "!" : cell === "正在讨论" ? "…" : cell === "建议下一步" ? "→" : ""}
                              </div>
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <p className="flex items-start gap-1 text-9 text-warning" data-testid="backflow-mapping-note">
                  <AlertTriangle aria-hidden className="mt-0.5 h-3 w-3 shrink-0" /> {TEMPLATE_TO_STAGE_NOTE}
                </p>
              </section>
            </div>

            {/* ③ 本组小树 */}
            <aside className="flex flex-col gap-2" data-testid="backflow-group-tree">
              <h2 className="flex items-center gap-1.5 text-13 font-semibold">
                <TreeDeciduous aria-hidden className="h-4 w-4 text-muted-foreground" /> 本组小树
              </h2>
              <p className="text-10 text-muted-foreground">[未探明] 组级图谱屏——档案只探明全场，本屏为原创设计，sign-off 重点。</p>
              {GROUP_TREE.map((t) => {
                const Icon = NODE_ICON[t.status];
                return (
                  <div key={t.id} className="flex items-center justify-between gap-2 rounded-md border border-border-subtle bg-card px-2.5 py-1.5" data-testid={`backflow-tree-${t.id}`}>
                    <div className="flex items-center gap-1.5">
                      <Icon aria-hidden className={cn("h-3.5 w-3.5", t.status === "已确认" ? "text-primary" : t.status === "冲突" ? "text-destructive" : "text-muted-foreground")} />
                      <span className="text-11">{t.label}</span>
                    </div>
                    <span className="text-9 text-muted-foreground">{t.children} 子</span>
                  </div>
                );
              })}
              <p className="rounded-md border border-border-subtle bg-muted px-2 py-1.5 text-9 text-muted-foreground">
                节点进本组小树后标 已确认 / 冲突 / 待确认，引导师 [批量确认] 后才汇入全场并写回组织大脑。
              </p>
            </aside>
          </div>
        </StateShell>
      </div>

      {batchOpen && (
        <BatchConfirmDialog
          checked={batchChecked}
          onToggle={toggleBatch}
          onClose={() => setBatchOpen(false)}
          onConfirm={() => { setWroteBack(true); setBatchOpen(false); }}
        />
      )}
      {wroteBack && (
        <p className="border-t border-border bg-accent px-4 py-1.5 text-11 text-accent-foreground" data-testid="backflow-wroteback">
          已写回 {batchChecked.size} 个节点到组织大脑 · 每个都带来源链（来源组 → 便签 → 引述 → 转录片段），append-only 记一条 provenance 事件。
        </p>
      )}
    </div>
  );
}

/** 单个事实节点：三态徽标 + 来源链（可反查）+ 组长确认门控 */
function FactNodeCard({ node, confirmed, canConfirm, onConfirm }: { node: GraphNode; confirmed: boolean; canConfirm: boolean; onConfirm: () => void }) {
  const Icon = NODE_ICON[node.status];
  const broken = node.source.broken;
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border bg-card p-2.5" data-testid={`backflow-node-${node.id}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-11 font-medium leading-snug">{node.label}</span>
        <Badge tone={NODE_TONE[node.status]}><Icon aria-hidden className="h-2.5 w-2.5" />{node.status}</Badge>
      </div>
      {/* 来源链（来源组 + 来源模块 + 证据量 + 时间码）*/}
      <div className={cn("flex items-center gap-1 rounded-sm px-1.5 py-1 text-9", broken ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")} data-testid={`backflow-source-${node.id}`}>
        {broken ? <Link2Off aria-hidden className="h-3 w-3" /> : <Link2 aria-hidden className="h-3 w-3" />}
        {broken ? "来源链断（无证据）· 不得写回" : `${node.source.group} · ${node.source.module} ${node.source.evidenceCount} 来源 · ${node.source.timecode} · ${node.source.segmentId}`}
      </div>
      {node.leadConfirmed ? (
        <span className="flex items-center gap-1 text-9 text-primary"><CheckCircle2 aria-hidden className="h-3 w-3" /> 组长已确认 · 可写回</span>
      ) : canConfirm && !broken ? (
        confirmed ? (
          <span className="flex items-center gap-1 text-9 text-primary" data-testid={`backflow-confirmed-${node.id}`}><CheckCircle2 aria-hidden className="h-3 w-3" /> 已确认（乐观预览）</span>
        ) : (
          <Button size="xs" variant="outline" className="self-start" onClick={onConfirm} data-testid={`backflow-confirm-${node.id}`}>
            <ArrowRightLeft aria-hidden className="h-3 w-3" /> 确认并进小树
          </Button>
        )
      ) : (
        <span className="text-9 text-muted-foreground">{broken ? "链断，不可确认" : "待组长确认（未确认不进大脑）"}</span>
      )}
    </div>
  );
}

/** [批量确认] 勾选清单（原型待补：点击后勾选清单未渲染，本屏补画）*/
function BatchConfirmDialog({ checked, onToggle, onClose, onConfirm }: { checked: Set<string>; onToggle: (id: string) => void; onClose: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="batch-title" data-testid="backflow-batch-dialog">
      <div className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-border bg-card p-5 shadow-lg">
        <div className="flex items-start gap-2">
          <ClipboardCheck aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="flex flex-col gap-1">
            <h2 id="batch-title" className="text-14 font-semibold">批量确认并写回组织大脑</h2>
            <p className="text-11 text-muted-foreground">只有组长确认过、来源链完整的节点在此列出。写回是高影响动作，逐条可勾选。</p>
          </div>
        </div>
        <ul className="flex max-h-64 flex-col gap-1.5 overflow-auto">
          {BATCH_CONFIRM_ITEMS.map((n) => (
            <li key={n.id}>
              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border-subtle bg-panel px-2.5 py-2 transition-colors duration-200 hover:bg-muted" data-testid={`backflow-batch-item-${n.id}`}>
                <input type="checkbox" checked={checked.has(n.id)} onChange={() => onToggle(n.id)} className="mt-0.5 h-3.5 w-3.5 accent-primary" aria-label={n.label} />
                <div className="flex flex-col gap-0.5">
                  <span className="text-11 font-medium">{n.label}</span>
                  <span className="text-9 text-muted-foreground">{n.source.group} · {n.source.evidenceCount} 来源 · {n.status}</span>
                </div>
              </label>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between gap-2">
          <span className="text-10 text-muted-foreground">已选 {checked.size} / {BATCH_CONFIRM_ITEMS.length}</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={onClose} data-testid="backflow-batch-cancel">取消</Button>
            <Button size="sm" variant="primary" disabled={checked.size === 0} onClick={onConfirm} data-testid="backflow-batch-submit">确认写回 {checked.size} 个</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
