import * as React from "react";
import { User, Users, Building2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { LAYER_COUNTS, STATE_MACHINE, DECAY, LATERAL_REUSE } from "@/lib/mock/brain";

const LAYERS = [
  { key: "mine", label: "我的大脑（私有）", count: LAYER_COUNTS.mine, icon: User },
  { key: "project", label: "项目层", count: LAYER_COUNTS.project, icon: Users },
  { key: "org", label: "组织大脑", count: LAYER_COUNTS.org, icon: Building2 },
] as const;

/** 大脑左栏 —— 三层入口 + 关键健康度计数（导航性内容）*/
export function BrainLeftRail() {
  return (
    <div className="flex flex-col gap-4 p-3" data-testid="brain-left-rail">
      <section className="flex flex-col gap-1">
        <h2 className="text-11 font-semibold uppercase tracking-wide text-muted-foreground">三层记忆</h2>
        {LAYERS.map((l) => (
          <div key={l.key} data-testid={`brain-nav-${l.key}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-12 transition-colors duration-200 hover:bg-muted">
            <l.icon aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{l.label}</span>
            <span className="tabular-nums text-10 text-muted-foreground">{l.count.toLocaleString()}</span>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-11 font-semibold uppercase tracking-wide text-muted-foreground">需要关注</h2>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between rounded-md border border-border-subtle bg-card px-2 py-1.5" data-testid="brain-nav-queue">
            <span className="text-11">晋升队列</span>
            <Badge tone="primary">{STATE_MACHINE.queuePending} 待审</Badge>
          </div>
          <div className="flex items-center justify-between rounded-md border border-border-subtle bg-card px-2 py-1.5" data-testid="brain-nav-decay">
            <span className="text-11">时效待复核</span>
            <Badge tone="warning">{DECAY.staleCount} 条</Badge>
          </div>
          <div className="flex items-center justify-between rounded-md border border-border-subtle bg-card px-2 py-1.5" data-testid="brain-nav-lateral">
            <span className="text-11">横向复用（未沉淀）</span>
            <Badge tone="outline">本月 {LATERAL_REUSE.monthCount}</Badge>
          </div>
        </div>
      </section>

      <p className="text-10 text-muted-foreground">
        私有层默认私有，组织管理员也看不到条目内容，只看到计数。
      </p>
    </div>
  );
}
