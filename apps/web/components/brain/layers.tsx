import * as React from "react";
import { Lock, Globe } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PRIVATE_LAYER, ORG_LAYER } from "@/lib/mock/brain";

/** 私有层 —— 默认私有 · 组织管理员也看不到（UC-0.3 R7 硬约束：个人层对管理员封闭）*/
export function PrivateLayer() {
  return (
    <div className="flex flex-col gap-4" data-testid="brain-private-layer">
      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted p-3" data-testid="brain-private-closed-notice">
        <Lock aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="flex flex-col gap-0.5">
          <p className="text-12 font-medium">{PRIVATE_LAYER.note}</p>
          <p className="text-11 text-muted-foreground">{PRIVATE_LAYER.formNote}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {PRIVATE_LAYER.kinds.map((k) => (
          <div key={k.key} data-testid={`brain-private-${k.key}`} className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3">
            <div className="flex items-center justify-between">
              <span className="text-12 font-medium">{k.label}</span>
              <Badge tone="neutral">{k.count}</Badge>
            </div>
            <p className="text-10 text-muted-foreground">{k.example}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 组织层 —— 全员可见 · 每条都有有效期 */
export function OrgLayer() {
  return (
    <div className="flex flex-col gap-4" data-testid="brain-org-layer">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-accent p-3" data-testid="brain-org-notice">
        <Globe aria-hidden className="h-4 w-4 text-accent-foreground" />
        <p className="text-12 font-medium text-accent-foreground">{ORG_LAYER.note}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {ORG_LAYER.kinds.map((k) => (
          <div key={k.key} data-testid={`brain-org-${k.key}`} className="flex items-center justify-between rounded-lg border border-border bg-card p-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-12 font-medium">{k.label}</span>
              <span className="text-10 text-muted-foreground">有效期：{k.ttl}</span>
            </div>
            <Badge tone="primary">{k.count}</Badge>
          </div>
        ))}
      </div>

      {/* 反例与教训 —— 另计，不在 604 生效条目内，仅以教训形态被召回（原型 isBrOrg「五类资产」第 5 类） */}
      <div
        key={ORG_LAYER.counterexamples.key}
        data-testid={`brain-org-${ORG_LAYER.counterexamples.key}`}
        className="flex items-center justify-between rounded-lg border border-border-subtle bg-panel p-3"
      >
        <div className="flex flex-col gap-0.5">
          <span className="text-12 font-medium">{ORG_LAYER.counterexamples.label}</span>
          <span className="text-10 text-muted-foreground">{ORG_LAYER.counterexamples.note}</span>
        </div>
        <Badge tone="outline">{ORG_LAYER.counterexamples.count} · 另计</Badge>
      </div>
    </div>
  );
}
