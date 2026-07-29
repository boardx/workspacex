"use client";
import * as React from "react";
import { ChevronRight, EyeOff, ScrollText, Check, ListTree } from "lucide-react";
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
  OMISSIONS_MORE,
  RETRIEVAL_LOG,
  RELEVANCE_THRESHOLD,
  type OmissionView,
  type OmissionReason,
} from "@/lib/mock/brain";
import { omissionLabel, isComplianceOmission } from "@/lib/omission-reason";

/**
 * 丢弃原因 → 徽标色（裁决 D-U4：原因分类是封闭枚举，此处只做展示映射）
 * **合规性丢弃**（已撤回 / 时效过期 / 无授权）用 danger/warning——它们不是「相关度不够」，
 * 而是「有东西被规则挡住了」，读者需要一眼分辨这两类。
 */
const OMISSION_TONE: Record<OmissionReason, "neutral" | "warning" | "danger"> = {
  withdrawn: "danger",
  expired: "warning",
  unauthorized: "danger",
  "low-confidence": "neutral",
  budget: "warning",
  deduped: "neutral",
  "out-of-scope": "neutral",
  // ADR-021。⚠ 刻意是 neutral 不是 danger：定位失败是**技术问题**不是合规丢弃，
  // 染成合规色会让读者以为「有东西被规则挡住了」，而那正是这套配色要区分的另一类。
  unlocatable: "neutral",
};

/** 丢弃清单单条 —— 可点开，带原因（这是 F11 的验收面，不是只显示命中项）*/
function OmissionRow({ item }: { item: OmissionView }) {
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
            {item.reasonLabel ?? omissionLabel(item.reasonType)}
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

/** Context Pack 出口区 —— 三个出口各接真实行为（日志面板 / 固定乐观 / 权限禁用）*/
function ContextExits() {
  const [openLog, setOpenLog] = React.useState(false);
  const [pinned, setPinned] = React.useState(false);

  return (
    <section className="flex flex-col gap-2" data-testid="brain-context-exits">
      <div className="flex flex-wrap items-center gap-2">
        {CONTEXT_PACK_EXITS.map((e, i) => {
          if (e.key === "log") {
            return (
              <Button
                key={e.key}
                size="sm"
                variant={openLog ? "primary" : "outline"}
                onClick={() => setOpenLog((v) => !v)}
                aria-expanded={openLog}
                data-testid={`brain-exit-${e.key}`}
              >
                <ListTree aria-hidden className="h-3.5 w-3.5" />
                {openLog ? "收起调用日志" : e.label}
              </Button>
            );
          }
          if (e.key === "reweight") {
            // methodOwnerOnly：当前预览身份非方法负责人 → 显式禁用（服务端另行校验），显式禁用是设计
            return (
              <Button
                key={e.key}
                size="sm"
                variant="ghost"
                disabled
                title="仅方法负责人可见；权重调整会影响全项目检索，服务端另行校验权限"
                data-testid={`brain-exit-${e.key}`}
              >
                {e.label}
              </Button>
            );
          }
          // pin：乐观固定到本项目
          return pinned ? (
            <span
              key={e.key}
              className="inline-flex items-center gap-1 rounded-md bg-success/10 px-2.5 py-1.5 text-11 text-success"
              data-testid={`brain-exit-${e.key}-done`}
            >
              <Check aria-hidden className="h-3.5 w-3.5" />
              已固定到本项目
            </span>
          ) : (
            <Button
              key={e.key}
              size="sm"
              variant={i === 0 ? "outline" : "ghost"}
              onClick={() => setPinned(true)}
              data-testid={`brain-exit-${e.key}`}
            >
              {e.label}
            </Button>
          );
        })}
      </div>

      {openLog && (
        <ol className="flex flex-col divide-y divide-border-subtle rounded-md border border-border-subtle bg-card" data-testid="brain-exit-log-panel">
          {RETRIEVAL_LOG.map((l) => (
            <li key={l.id} className="flex items-baseline gap-2 px-2.5 py-1.5" data-testid={`brain-log-${l.id}`}>
              <span className="shrink-0 font-mono text-10 text-muted-foreground">{l.ts}</span>
              <Badge tone="outline">{l.op}</Badge>
              <span className="min-w-0 text-11 text-muted-foreground">{l.detail}</span>
            </li>
          ))}
        </ol>
      )}

      <span className="text-10 text-muted-foreground">
        「看完整调用日志」在此内联展开；「固定这段上下文」乐观固定到本项目；「调整检索权重」仅方法负责人可见且服务端另行校验。
      </span>
    </section>
  );
}

/** 长列表默认显示几条。折叠是展示决定，**只对非合规丢弃生效**（I-4）。 */
const VISIBLE_OMISSIONS = 4;

export function ContextPackPanel() {
  const budgetPct = Math.round((CONTEXT_BUDGET.used / CONTEXT_BUDGET.cap) * 100);
  const [showMore, setShowMore] = React.useState(false);

  /**
   * 合规与非合规分栏 —— **判据取自单一事实源** `OMISSION_REASONS[r].compliance`，
   * 不在组件里另列一份「哪三种算合规」。另列的那份会在第八种原因（ADR-021）出现时
   * 悄悄失准，而失准的方向是把该始终可见的条目折叠掉。
   */
  const allOmissions = React.useMemo(() => [...OMISSIONS, ...OMISSIONS_MORE], []);
  const complianceOmissions = allOmissions.filter((o) => isComplianceOmission(o.reasonType));
  const otherOmissions = allOmissions.filter((o) => !isComplianceOmission(o.reasonType));
  const droppedCount = allOmissions.length;

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
                {/*
                  ⚠ 「排除」的痕迹不在上面那张证据表里——被排除的候选按定义不在 items[] 里，
                  它只能在下面的丢弃清单中找到（KNOWN_CONTRACT_GAPS.G1）。写出来，
                  是因为读者默认五种动作都能在同一处翻到，而那是做不到的。
                */}
                {f.tracedIn === "omissions" && (
                  <span className="text-10 text-muted-foreground" data-testid={`brain-filter-${f.key}-traced-in`}>
                    · 痕迹在下方「被丢弃」清单
                  </span>
                )}
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
          <h3 className="text-13 font-semibold">被丢弃 · 共 {droppedCount} 条</h3>
          <Badge tone="outline">可逐条点开审查</Badge>
        </div>

        {/*
          合规性丢弃（已撤回 / 时效过期 / 无授权）——永不折叠（I-4）。
          ⚠ 它们单独成栏而不是混在长列表里，正因为下面那个「展开/收起」是它们唯一可能
          消失的地方：契约的 listOmissions 没有分页参数（KNOWN_CONTRACT_GAPS.G3），
          所以「只显示前 N 条」这件事只发生在这里，I-4 也只能在这里失效。
        */}
        {complianceOmissions.length > 0 && (
          <div className="flex flex-col gap-1.5" data-testid="brain-omissions-compliance">
            <span className="text-10 text-muted-foreground">
              合规性丢弃 {complianceOmissions.length} 条 · 不因折叠或截断隐藏
            </span>
            <ul className="flex flex-col gap-1.5">
              {complianceOmissions.map((o) => (
                <OmissionRow key={o.id} item={o} />
              ))}
            </ul>
          </div>
        )}

        <ul className="flex flex-col gap-1.5" data-testid="brain-omissions-relevance">
          {(showMore ? otherOmissions : otherOmissions.slice(0, VISIBLE_OMISSIONS)).map((o) => (
            <OmissionRow key={o.id} item={o} />
          ))}
        </ul>
        {otherOmissions.length > VISIBLE_OMISSIONS && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowMore((v) => !v)}
            aria-expanded={showMore}
            data-testid="brain-omissions-more"
          >
            <ChevronRight aria-hidden className={cn("h-3.5 w-3.5 transition-transform duration-200", showMore && "rotate-90")} />
            {showMore
              ? "收起长尾低相关"
              : `还有 ${otherOmissions.length - VISIBLE_OMISSIONS} 条低相关 · 展开`}
          </Button>
        )}
        <p className="text-10 text-muted-foreground">
          不得静默丢弃：低于相关度阈值（本次 {RELEVANCE_THRESHOLD}）、超预算裁剪、权限取最严格结果排除、
          去重折叠、无法定位，逐条标注原因。
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

      <ContextExits />
    </div>
  );
}
