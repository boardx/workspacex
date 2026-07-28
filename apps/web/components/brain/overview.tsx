import * as React from "react";
import { Quote, Clock, ArrowLeftRight, GitBranch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  LAYER_COUNTS,
  NODE_TYPES,
  PROMOTION_RULE,
  DECAY,
  LATERAL_REUSE,
  STATE_MACHINE,
} from "@/lib/mock/brain";

/** 立身之本的规则 —— 显著展示（整个三层记忆模型的地基）*/
function PromotionRuleBanner() {
  return (
    <blockquote
      data-testid="brain-promotion-rule"
      className="flex gap-3 rounded-lg border border-primary/30 bg-accent p-4"
    >
      <Quote aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-accent-foreground" />
      <p className="text-14 font-medium text-accent-foreground">{PROMOTION_RULE}</p>
    </blockquote>
  );
}

function LayerCard({ label, count, testid, note }: { label: string; count: number; testid: string; note?: string }) {
  return (
    <div data-testid={testid} className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4 shadow-sm">
      <span className="text-11 text-muted-foreground">{label}</span>
      <span className="text-24 font-semibold tabular-nums">{count.toLocaleString()}</span>
      {note && <span className="text-10 text-muted-foreground">{note}</span>}
    </div>
  );
}

export function BrainOverview() {
  return (
    <div className="flex flex-col gap-5">
      <PromotionRuleBanner />

      <section className="flex flex-col gap-2" data-testid="brain-layer-stock">
        <h2 className="text-14 font-semibold">三层存量</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <LayerCard testid="brain-layer-mine" label="我（私有层）" count={LAYER_COUNTS.mine} note="默认私有 · 管理员只见计数" />
          <LayerCard testid="brain-layer-project" label="项目层" count={LAYER_COUNTS.project} note="项目范围内可见" />
          <LayerCard testid="brain-layer-org" label="组织大脑" count={LAYER_COUNTS.org} note="全员可见 · 每条都有有效期" />
        </div>
        <div className="flex flex-wrap gap-2" data-testid="brain-node-types">
          {NODE_TYPES.map((n) => (
            <span key={n.key} className="inline-flex items-center gap-1 rounded-sm border border-border-subtle bg-card px-2 py-1 text-11">
              <span className="font-medium">{n.label}</span>
              <span className="tabular-nums text-muted-foreground">{n.count.toLocaleString()}</span>
              {n.sub && <Badge tone="outline">{n.sub}</Badge>}
            </span>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2" data-testid="brain-state-machine">
        <h2 className="text-14 font-semibold">知识五态机</h2>
        <div className="flex flex-wrap items-center gap-1.5">
          {STATE_MACHINE.states.map((s, i) => (
            <React.Fragment key={s.key}>
              <span data-testid={`brain-state-${s.key}`} className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-11">
                {s.label} <span className="tabular-nums text-muted-foreground">{s.count.toLocaleString()}</span>
              </span>
              {i < STATE_MACHINE.states.length - 1 && <span aria-hidden className="text-muted-foreground">→</span>}
            </React.Fragment>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-11 text-muted-foreground" data-testid="brain-state-exits">
          <span>出口：</span>
          {STATE_MACHINE.exits.map((e) => (
            <span key={e.key} className="inline-flex items-center gap-1">
              {e.label} <span className="tabular-nums">{e.count}</span>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="primary" data-testid="brain-promotion-queue">
            晋升队列 · {STATE_MACHINE.queuePending} 待审
          </Button>
          <Button size="sm" variant="outline" data-testid="brain-open-ledger">打开决策台账</Button>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4" data-testid="brain-decay">
          <div className="flex items-center gap-2">
            <Clock aria-hidden className="h-4 w-4 text-warning" />
            <h2 className="text-13 font-semibold">时效衰减</h2>
            <Badge tone="warning" data-testid="brain-decay-count">{DECAY.staleCount} 条待复核</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            {DECAY.rules.map((r) => (
              <span key={r.key} className="rounded-sm bg-muted px-2 py-0.5 text-11 text-muted-foreground">
                {r.label} · {r.ttl}
              </span>
            ))}
          </div>
          <p className="text-11 text-muted-foreground">{DECAY.note}</p>
        </section>

        <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4" data-testid="brain-lateral-reuse">
          <div className="flex items-center gap-2">
            <ArrowLeftRight aria-hidden className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-13 font-semibold">横向复用</h2>
            <Badge tone="outline" data-testid="brain-lateral-count">本月 {LATERAL_REUSE.monthCount} 次</Badge>
          </div>
          <p className="text-11 text-muted-foreground">{LATERAL_REUSE.note}</p>
          <ul className="flex flex-col gap-1">
            {LATERAL_REUSE.samples.map((s) => (
              <li key={s.id} className="flex items-center gap-1.5 text-11" data-testid={`brain-lateral-${s.id}`}>
                <GitBranch aria-hidden className="h-3 w-3 text-muted-foreground" />
                <span className="font-medium">{s.title}</span>
                <Badge tone="warning">未沉淀</Badge>
                <span className="text-muted-foreground">← {s.from}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
