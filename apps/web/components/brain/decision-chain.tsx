"use client";
import * as React from "react";
import { GitBranch, Layers as LayersIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import {
  CHAINS,
  CHAIN_NODE_TYPE_LABEL,
  TEMPLATES_MINE,
  TEMPLATES_ORG,
  TEMPLATE_RULES,
  type Chain,
  type ChainNode,
  type ChainNodeType,
} from "@/lib/mock/brain";

const NODE_TONE: Record<ChainNodeType, "neutral" | "primary" | "ai" | "warning" | "danger" | "outline"> = {
  evidence: "ai",
  "counter-evidence": "danger",
  method: "primary",
  judgment: "outline",
  branch: "neutral",
  suggestion: "warning",
  experiment: "neutral",
  decision: "neutral",
};

/** 单个链节点卡片 —— 已选节点带高亮环 + 「AI 不可写入」硬约束提示 */
function ChainNodeCard({ node }: { node: ChainNode }) {
  return (
    <li
      data-testid={`brain-chain-node-${node.id}`}
      className={`flex flex-col gap-1 rounded-md border p-2.5 ${
        node.selected ? "border-primary bg-accent shadow-sm" : "border-border-subtle bg-card"
      }`}
    >
      <div className="flex items-center gap-2">
        <Badge tone={NODE_TONE[node.type]}>{CHAIN_NODE_TYPE_LABEL[node.type]}</Badge>
        {node.confidence && <span className="text-10 tabular-nums text-muted-foreground">置信度 {node.confidence}</span>}
        {node.selected && <Badge tone="primary">已选节点</Badge>}
      </div>
      <span className="text-12 text-card-foreground">{node.title}</span>
      {node.inEdges && <span className="text-10 text-muted-foreground">入边：{node.inEdges}{node.author ? ` · 作者：${node.author}` : ""}</span>}
      {node.aiWriteBlocked && <span className="text-10 font-medium text-destructive">AI 不可写入此节点</span>}
    </li>
  );
}

/** 已选节点详情面板（原型右侧栏）：类型/置信度/入边/作者/改动记录/与模板的关系 */
function SelectedNodeDetail({ chain }: { chain: Chain }) {
  const fallback = chain.nodes[chain.nodes.length - 1];
  const selected = chain.nodes.find((n) => n.selected) ?? fallback;
  if (!selected) return null;
  return (
    <div className="flex w-full flex-col gap-3 rounded-lg border border-border bg-panel p-3 lg:w-72 lg:shrink-0" data-testid="brain-chain-selected-detail">
      <div className="flex flex-col gap-1">
        <span className="text-10 font-medium uppercase tracking-wide text-primary">已选节点 · {CHAIN_NODE_TYPE_LABEL[selected.type]}</span>
        <span className="text-13 font-medium">{selected.title}</span>
      </div>
      <dl className="flex flex-col gap-1.5 text-11">
        {selected.confidence && (
          <div className="flex justify-between"><dt className="text-muted-foreground">置信度</dt><dd>{selected.confidence}</dd></div>
        )}
        {selected.inEdges && (
          <div className="flex justify-between"><dt className="text-muted-foreground">入边</dt><dd>{selected.inEdges}</dd></div>
        )}
        {selected.author && (
          <div className="flex justify-between"><dt className="text-muted-foreground">作者</dt><dd>{selected.author}</dd></div>
        )}
      </dl>

      {chain.changeLog.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-11 font-medium">改动记录</span>
          {chain.changeLog.map((c) => (
            <div key={c.id} className="rounded-md border border-border-subtle bg-card p-2 text-10" data-testid={`brain-chain-changelog-${c.id}`}>
              <p className="text-11 text-card-foreground">{c.text}</p>
              <p className="mt-1 text-muted-foreground">{c.ts} · {c.actor}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-2.5" data-testid="brain-chain-template-relation">
        <span className="text-11 font-medium">与模板的关系</span>
        <p className="text-10 text-muted-foreground">
          本链实例化自 <span className="font-medium text-card-foreground">「{chain.templateRelation.templateTitle}」</span>（{chain.templateRelation.templateOwner}）。
          {chain.templateRelation.deviations.length > 0
            ? `当前偏离 ${chain.templateRelation.deviations.length} 处：${chain.templateRelation.deviations.join("、")}。`
            : "当前无偏离。"}
        </p>
        {chain.templateRelation.deviations.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <Button size="xs" variant="outline" data-testid="brain-chain-writeback-template">把偏离写回模板</Button>
            <Button size="xs" variant="ghost" data-testid="brain-chain-keep-local">只在本项目保留</Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** 链视图 —— 链选择器 + 节点列表 + 已选节点详情（原型 isChGraph，简化为结构化列表，不复刻可拖拽画布） */
const FIRST_CHAIN = CHAINS[0];

function ChainGraphView() {
  const [chainId, setChainId] = React.useState(FIRST_CHAIN?.id ?? "");
  const chain = CHAINS.find((c) => c.id === chainId) ?? FIRST_CHAIN;
  if (!chain) return null;

  return (
    <div className="flex flex-col gap-3" data-testid="brain-chain-graph-view">
      <div className="flex flex-wrap items-center gap-2" data-testid="brain-chain-selector">
        {CHAINS.map((c) => (
          <Button
            key={c.id}
            size="sm"
            variant={c.id === chainId ? "primary" : "outline"}
            onClick={() => setChainId(c.id)}
            data-testid={`brain-chain-select-${c.id}`}
          >
            {c.title}
          </Button>
        ))}
        <Button size="sm" variant="ghost" data-testid="brain-chain-new">＋ 新建链</Button>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <ul className="flex min-w-0 flex-1 flex-col gap-2" data-testid={`brain-chain-nodes-${chain.id}`}>
          {chain.nodes.map((n) => (
            <ChainNodeCard key={n.id} node={n} />
          ))}
        </ul>
        <SelectedNodeDetail chain={chain} />
      </div>
    </div>
  );
}

function SkeletonStrip({ steps }: { steps: string[] }) {
  return (
    <div className="flex items-center gap-1" aria-hidden>
      {steps.map((s, i) => (
        <React.Fragment key={`${s}-${i}`}>
          <span className="rounded-sm bg-muted px-1.5 py-0.5 text-10 text-muted-foreground">{s}</span>
          {i < steps.length - 1 && <span className="text-10 text-muted-foreground">→</span>}
        </React.Fragment>
      ))}
    </div>
  );
}

/** 模板视图 —— 我的模板（私有） + 组织模板（表格） + 两条设计规则（原型 isChTpl） */
function ChainTemplateView() {
  return (
    <div className="flex flex-col gap-6" data-testid="brain-chain-template-view">
      <p className="max-w-2xl text-11 leading-relaxed text-muted-foreground">
        推演模板是「链的骨架」：节点顺序、必须有哪几类证据、哪一步必须由人签字。先在自己这一层攒模板，套顺手了再提名到组织层，让别的项目也能用同一套推演方式。
      </p>

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <h3 className="text-13 font-semibold">我的模板 · {TEMPLATES_MINE.length}</h3>
          <span className="text-11 text-muted-foreground">私有，改了不影响别人</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TEMPLATES_MINE.map((t) => (
            <div key={t.id} data-testid={`brain-template-mine-${t.id}`} className="flex flex-col gap-2.5 rounded-lg border border-border bg-card p-3">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-12 font-medium">{t.title}</span>
                {t.status && <Badge tone={t.status === "在用" ? "primary" : "warning"}>{t.status}</Badge>}
              </div>
              <SkeletonStrip steps={t.skeleton} />
              <p className="text-10 leading-relaxed text-muted-foreground">{t.requirement}</p>
              <div className="flex items-center gap-2 text-10 text-muted-foreground">
                <span>已套用 {t.appliedCount} 个项目</span>
                {t.deviationNote && <span>{t.deviationNote}</span>}
              </div>
              <div className="flex gap-1.5">
                <Button size="xs" variant="outline" data-testid={`brain-template-edit-${t.id}`}>编辑骨架</Button>
                <Button size="xs" variant={t.status === "在用" ? "outline" : "primary"} data-testid={`brain-template-action-${t.id}`}>
                  {t.status === "在用" ? "套用到项目" : "提名到组织"}
                </Button>
              </div>
            </div>
          ))}
          <div className="flex flex-col justify-center gap-1.5 rounded-lg border border-dashed border-border p-3" data-testid="brain-template-new">
            <span className="text-12 font-medium">＋ 新建模板</span>
            <p className="text-10 leading-relaxed text-muted-foreground">从零搭骨架，或把当前这条链另存为模板（推荐——模板最好是从真实推演里长出来的）。</p>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <h3 className="text-13 font-semibold">组织模板 · {TEMPLATES_ORG.length}</h3>
          <span className="text-11 text-muted-foreground">已晋升，全员可套用；改动要走晋升队列</span>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table className="w-full border-collapse text-12" data-testid="brain-template-org-table">
            <TableHeader>
              <TableRow className="border-b border-border bg-panel text-left text-11 text-muted-foreground">
                <TableHead className="p-2 font-medium">模板</TableHead>
                <TableHead className="p-2 font-medium">硬性要求</TableHead>
                <TableHead className="p-2 font-medium">作者</TableHead>
                <TableHead className="p-2 font-medium">套用</TableHead>
                <TableHead className="p-2 font-medium" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {TEMPLATES_ORG.map((t) => (
                <TableRow key={t.id} data-testid={`brain-template-org-${t.id}`} className={`border-b border-border-subtle last:border-0 ${t.archived ? "opacity-65" : ""}`}>
                  <TableCell className="p-2 font-medium">{t.title}</TableCell>
                  <TableCell className="p-2 text-muted-foreground">{t.requirement}</TableCell>
                  <TableCell className="p-2 text-muted-foreground">{t.author}</TableCell>
                  <TableCell className="p-2 tabular-nums">{t.appliedCount}</TableCell>
                  <TableCell className="p-2">
                    {t.archived ? (
                      <Badge tone="neutral">已归档</Badge>
                    ) : (
                      <div className="flex gap-1.5">
                        <Button size="xs" variant="outline" data-testid={`brain-template-apply-${t.id}`}>套用</Button>
                        <Button size="xs" variant="ghost" data-testid={`brain-template-copy-${t.id}`}>复制为我的</Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-border p-3" data-testid="brain-template-rule-scope">
          <h4 className="mb-1.5 text-12 font-semibold">{TEMPLATE_RULES.scope.title}</h4>
          <p className="text-11 leading-relaxed text-muted-foreground">{TEMPLATE_RULES.scope.body}</p>
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3" data-testid="brain-template-rule-deviation">
          <h4 className="mb-1.5 text-12 font-semibold">{TEMPLATE_RULES.deviation.title}</h4>
          <p className="text-11 leading-relaxed text-destructive/80">{TEMPLATE_RULES.deviation.body}</p>
        </div>
      </div>
    </div>
  );
}

/** 推演链与模板 —— 原型 isBrChain 分支（链 / 模板 双子视图），字节 16,311,110 起 */
export function DecisionChainPanel() {
  const [subview, setSubview] = React.useState<"chain" | "template">("chain");

  return (
    <div className="flex flex-col gap-4" data-testid="brain-decision-chain">
      <div className="flex items-center gap-1.5" data-testid="brain-chain-subview-switch">
        <Button size="sm" variant={subview === "chain" ? "primary" : "outline"} onClick={() => setSubview("chain")} data-testid="brain-chain-subview-chain">
          <GitBranch aria-hidden className="h-3.5 w-3.5" />链
        </Button>
        <Button size="sm" variant={subview === "template" ? "primary" : "outline"} onClick={() => setSubview("template")} data-testid="brain-chain-subview-template">
          <LayersIcon aria-hidden className="h-3.5 w-3.5" />模板
        </Button>
      </div>

      {subview === "chain" ? <ChainGraphView /> : <ChainTemplateView />}
    </div>
  );
}
