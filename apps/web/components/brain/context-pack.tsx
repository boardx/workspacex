"use client";
import * as React from "react";
import { ChevronRight, EyeOff, ScrollText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  RETRIEVAL_SEGMENTS,
  FILTER_ACTIONS,
  CONTEXT_BUDGET,
  SYSTEM_PROMPT,
  CONTEXT_PACK_EXITS,
  OMISSIONS,
  OMISSIONS_REMAINING,
  type OmissionReason,
} from "@/lib/mock/brain";

const OMISSION_TONE: Record<OmissionReason, "neutral" | "warning" | "danger"> = {
  "below-threshold": "neutral",
  "budget-trimmed": "warning",
  permission: "danger",
};

/** 丢弃清单单条 —— 可点开，带原因（这是 F11 的验收面，不是只显示命中项）*/
function OmissionRow({ item }: { item: (typeof OMISSIONS)[number] }) {
  const [open, setOpen] = React.useState(false);
  return (
    <li data-testid={`brain-omission-${item.id}`} className="rounded-md border border-border-subtle bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid={`brain-omission-toggle-${item.id}`}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors duration-200 hover:bg-muted"
      >
        <ChevronRight aria-hidden className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-90")} />
        {item.masked ? (
          <span className="inline-flex items-center gap-1 text-12 text-muted-foreground">
            <EyeOff aria-hidden className="h-3 w-3" />
            {item.title}
          </span>
        ) : (
          <span className="text-12">{item.title}</span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {typeof item.relevance === "number" && (
            <span className="tabular-nums text-10 text-muted-foreground">{item.relevance.toFixed(2)}</span>
          )}
          <Badge tone={OMISSION_TONE[item.reasonType]} data-testid={`brain-omission-reason-badge-${item.id}`}>
            {item.reasonLabel}
          </Badge>
        </span>
      </button>
      {open && (
        <p data-testid={`brain-omission-reason-${item.id}`} className="border-t border-border-subtle px-2.5 py-2 text-11 text-muted-foreground">
          {item.reason}
        </p>
      )}
    </li>
  );
}

export function ContextPackPanel() {
  const budgetPct = Math.round((CONTEXT_BUDGET.used / CONTEXT_BUDGET.cap) * 100);

  return (
    <div className="flex flex-col gap-5" data-testid="brain-context-pack">
      <p className="text-12 text-muted-foreground">
        这一次 AI 回答的取材过程可被完整还原：读了什么、降权了什么、排除了什么、
        <strong className="text-background-foreground">丢弃了什么</strong>，全部能翻出来。
      </p>

      <section className="flex flex-col gap-2" data-testid="brain-retrieval-segments">
        <h3 className="text-13 font-semibold">这次回答检索到什么</h3>
        <div className="flex flex-col divide-y divide-border-subtle rounded-lg border border-border">
          {RETRIEVAL_SEGMENTS.map((s) => (
            <div key={s.key} className="flex items-center gap-2 p-2.5" data-testid={`brain-segment-${s.key}`}>
              <div className="flex min-w-0 flex-col">
                <span className="text-12 font-medium">{s.label}</span>
                <span className="text-10 text-muted-foreground">← {s.source}{s.sub ? ` · ${s.sub}` : ""}</span>
              </div>
              <span className="ml-auto tabular-nums text-11 text-muted-foreground">{s.tokens}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2" data-testid="brain-filter-actions">
        <h3 className="text-13 font-semibold">组织层这次是怎么被筛的</h3>
        <ul className="flex flex-col gap-1.5">
          {FILTER_ACTIONS.map((f) => (
            <li key={f.key} data-testid={`brain-filter-${f.key}`} className="flex flex-col gap-0.5 rounded-md border border-border-subtle bg-card p-2.5">
              <div className="flex items-center gap-2">
                <Badge tone="outline">{f.label}</Badge>
                <span className="text-11 font-medium text-muted-foreground">{f.count}</span>
              </div>
              <p className="text-11 text-muted-foreground">{f.reason}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-1.5" data-testid="brain-context-budget">
        <div className="flex items-center gap-2">
          <h3 className="text-13 font-semibold">上下文预算</h3>
          <span className="ml-auto tabular-nums text-11 text-muted-foreground">
            {CONTEXT_BUDGET.used}{CONTEXT_BUDGET.unit} / {CONTEXT_BUDGET.cap}{CONTEXT_BUDGET.unit}
          </span>
        </div>
        <Progress value={budgetPct} label="上下文预算占用" />
        <span className="text-10 text-muted-foreground">{CONTEXT_BUDGET.capNote}</span>
      </section>

      {/* 丢弃清单（omissions）—— 立身之本：被丢弃/裁剪/权限排除的都可查、带原因 */}
      <section className="flex flex-col gap-2" data-testid="brain-omissions">
        <div className="flex items-center gap-2">
          <h3 className="text-13 font-semibold">被丢弃 · {OMISSIONS.length + OMISSIONS_REMAINING} 条低相关</h3>
          <Badge tone="outline">可逐条点开审查</Badge>
        </div>
        <ul className="flex flex-col gap-1.5">
          {OMISSIONS.map((o) => (
            <OmissionRow key={o.id} item={o} />
          ))}
        </ul>
        <Button size="sm" variant="ghost" data-testid="brain-omissions-more">
          还有 {OMISSIONS_REMAINING} 条低相关 · 展开
        </Button>
        <p className="text-10 text-muted-foreground">
          不得静默丢弃：低于相关度阈值、超预算裁剪、权限取最严格结果排除，三类原因逐条标注。
        </p>
      </section>

      <section className="flex flex-col gap-2" data-testid="brain-system-prompt">
        <div className="flex items-center gap-2">
          <ScrollText aria-hidden className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-13 font-semibold">装配后的系统提示</h3>
          <Badge tone="ai">{SYSTEM_PROMPT.sections.length} 段注入{SYSTEM_PROMPT.redacted ? " · 已脱敏" : ""}</Badge>
        </div>
        <pre className="overflow-x-auto rounded-lg border border-border bg-muted p-3 font-mono text-11 text-background-foreground">
          {SYSTEM_PROMPT.sections.map((sec) => (
            <div key={sec.id} data-testid={`brain-prompt-section-${sec.id}`} className="mb-2 last:mb-0">
              <span className="font-semibold">{sec.title}</span>
              {"\n"}
              <span className="text-muted-foreground">{sec.body}</span>
            </div>
          ))}
        </pre>
        <p className="text-10 text-muted-foreground">硬约束段不可被裁剪、不可被 AI 改写；只读快照，不可篡改。</p>
      </section>

      <section className="flex flex-wrap items-center gap-2" data-testid="brain-context-exits">
        {CONTEXT_PACK_EXITS.map((e, i) => (
          <Button key={e.key} size="sm" variant={i === 0 ? "outline" : "ghost"} data-testid={`brain-exit-${e.key}`}>
            {e.label}
          </Button>
        ))}
        <span className="text-10 text-muted-foreground">
          三个出口按钮已渲染、目标屏待接线（原型待补）；「调整检索权重」仅方法负责人可见且服务端另行校验。
        </span>
      </section>
    </div>
  );
}
