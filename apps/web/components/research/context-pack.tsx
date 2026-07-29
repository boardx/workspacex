"use client";
import * as React from "react";
import {
  BookOpenCheck, PackageX, ExternalLink, Coins, Filter, Info, Lock,
} from "lucide-react";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  CONTEXT_PACK, READ_ITEMS, OMISSIONS, OMISSION_REASON_LABEL, EVIDENCE_KIND_LABEL,
  canSeeOmissions, type OmissionReason, type ResearchView,
} from "@/lib/mock/research";

const REASON_TONE: Record<OmissionReason, "danger" | "warning" | "outline" | "neutral"> = {
  withdrawn: "danger",
  unauthorized: "danger",
  expired: "warning",
  "low-confidence": "warning",
  budget: "outline",
  deduped: "neutral",
  "out-of-scope": "neutral",
};

export function ContextPack({ state, view }: { state: UiState; view: ResearchView }) {
  const seeOmissions = canSeeOmissions(view);
  const [reasonFilter, setReasonFilter] = React.useState<OmissionReason | "all">("all");

  const reasons = Array.from(new Set(OMISSIONS.map((o) => o.reason)));
  const shownOmissions = reasonFilter === "all" ? OMISSIONS : OMISSIONS.filter((o) => o.reason === reasonFilter);
  const budgetPct = Math.round((CONTEXT_PACK.tokensUsed / CONTEXT_PACK.tokenBudget) * 100);

  const body = (
    <div className="flex flex-col gap-4" data-testid="research-context-pack">
      {/* ── 概览：读了多少 / 丢了多少 / 预算 ─────────────────────── */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" data-testid="research-pack-summary">
        <div className="flex flex-col gap-0.5 rounded-md border border-border-subtle bg-card p-2.5">
          <span className="inline-flex items-center gap-1 text-10 text-muted-foreground"><BookOpenCheck aria-hidden className="h-3 w-3" /> 读入</span>
          <span className="text-20 font-semibold tabular-nums" data-testid="research-read-count">{CONTEXT_PACK.readCount}</span>
          <span className="text-9 text-muted-foreground">条证据进入本次上下文</span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-md border border-warning/30 bg-warning/5 p-2.5">
          <span className="inline-flex items-center gap-1 text-10 text-muted-foreground"><PackageX aria-hidden className="h-3 w-3" /> 丢弃</span>
          <span className="text-20 font-semibold tabular-nums text-warning" data-testid="research-dropped-count">{CONTEXT_PACK.droppedCount}</span>
          <span className="text-9 text-muted-foreground">条被筛除 · 每条可查原因</span>
        </div>
        <div className="flex flex-col gap-1 rounded-md border border-border-subtle bg-card p-2.5">
          <span className="inline-flex items-center gap-1 text-10 text-muted-foreground"><Coins aria-hidden className="h-3 w-3" /> token 预算</span>
          <span className="text-13 font-semibold tabular-nums">{(CONTEXT_PACK.tokensUsed / 1000).toFixed(0)}k / {(CONTEXT_PACK.tokenBudget / 1000).toFixed(0)}k</span>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className={"h-full rounded-full transition-all duration-200 " + (budgetPct >= 75 ? "bg-warning" : "bg-primary")} style={{ width: `${budgetPct}%` }} />
          </div>
        </div>
      </div>
      <p className="inline-flex items-center gap-1.5 text-10 text-muted-foreground">
        <Info aria-hidden className="h-3 w-3" />
        模型 {CONTEXT_PACK.model} · 组包于 {CONTEXT_PACK.generatedAt}。这一屏回答的是「AI 这次到底读了什么、又丢了什么」。
      </p>

      {/* ── 读入清单 ─────────────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <h2 className="inline-flex items-center gap-1.5 text-14 font-semibold"><BookOpenCheck aria-hidden className="h-4 w-4 text-primary" /> 读了什么</h2>
        <ul className="flex flex-col gap-1.5" data-testid="research-read-list">
          {READ_ITEMS.map((it) => (
            <li
              key={it.id}
              id={`research-read-${it.id}`}
              data-testid={`research-read-${it.id}`}
              className="scroll-mt-4 flex flex-col gap-1 rounded-md border border-border-subtle bg-card p-2.5"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone="outline">{EVIDENCE_KIND_LABEL[it.kind]}</Badge>
                <span className="text-12 font-medium">{it.title}</span>
                <span className="ml-auto font-mono text-9 tabular-nums text-muted-foreground">{it.tokens.toLocaleString()} tok</span>
              </div>
              <p className="text-11 text-muted-foreground">「{it.excerpt}」</p>
              <div className="flex items-center gap-2">
                {it.anchorHref ? (
                  <a
                    href={it.anchorHref}
                    data-testid={`research-read-anchor-${it.id}`}
                    className="inline-flex items-center gap-1 text-10 text-primary transition-colors duration-200 hover:underline"
                  >
                    <ExternalLink aria-hidden className="h-3 w-3" /> {it.anchorLabel}
                  </a>
                ) : (
                  <span className="inline-flex items-center gap-1 text-10 text-muted-foreground">
                    <ExternalLink aria-hidden className="h-3 w-3" /> {it.anchorLabel}
                  </span>
                )}
                <span className="text-9 text-muted-foreground">置信 {it.confidence === "high" ? "高" : it.confidence === "medium" ? "中" : "低"}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <Separator />

      {/* ── 丢弃清单（可查、带原因、可定位）───────────────────── */}
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="inline-flex items-center gap-1.5 text-14 font-semibold"><PackageX aria-hidden className="h-4 w-4 text-warning" /> 丢了什么</h2>
          {seeOmissions && (
            <div className="flex flex-wrap items-center gap-1" data-testid="research-omission-filter">
              <Filter aria-hidden className="h-3 w-3 text-muted-foreground" />
              <Button size="xs" variant={reasonFilter === "all" ? "primary" : "ghost"} onClick={() => setReasonFilter("all")} data-testid="research-omission-filter-all">全部</Button>
              {reasons.map((r) => (
                <Button key={r} size="xs" variant={reasonFilter === r ? "primary" : "ghost"} onClick={() => setReasonFilter(r)} data-testid={`research-omission-filter-${r}`}>
                  {OMISSION_REASON_LABEL[r]}
                </Button>
              ))}
            </div>
          )}
        </div>

        {!seeOmissions ? (
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted p-3" data-testid="research-omission-denied">
            <Lock aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-11 text-muted-foreground">
              观察者只读已发布的脱敏结论，看不到原始丢弃明细（其中含撤回、越权、私有层等敏感原因）。
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5" data-testid="research-omission-list">
            {shownOmissions.map((o) => (
              <li key={o.id} data-testid={`research-omission-${o.id}`} className="flex flex-col gap-1 rounded-md border border-border-subtle bg-card p-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone="outline">{EVIDENCE_KIND_LABEL[o.kind]}</Badge>
                  <span className="text-12 font-medium">{o.title}</span>
                  <Badge tone={REASON_TONE[o.reason]} className="ml-auto">{OMISSION_REASON_LABEL[o.reason]}</Badge>
                </div>
                <p className="text-11 text-muted-foreground">{o.detail}</p>
                <span className="inline-flex items-center gap-1 text-9 text-muted-foreground">
                  <ExternalLink aria-hidden className="h-2.5 w-2.5" /> 原始来源：{o.sourceRef}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );

  return (
    <div className="flex flex-col gap-3 p-4">
      <header className="flex flex-col gap-0.5">
        <h1 className="text-18 font-semibold tracking-tight">{CONTEXT_PACK.name}</h1>
        <p className="text-11 text-muted-foreground">{CONTEXT_PACK.project}</p>
      </header>

      <StateShell
        state={state}
        skeletonRows={6}
        emptyHint="这次研究还没有组出上下文包——先绑定材料与研究问题，再组包"
        errors={{
          scope: "所选材料越出本项目范围，已拦截并保留你的选择，请缩小到项目内再组包。",
          concurrency: "上下文包正被另一名研究员重组，你看到的是旧版本，请刷新。",
        }}
        depFailure={{ what: "知识图谱 / 检索服务暂时不可用。已保留上一次成功组出的上下文包，可安全重试。" }}
        denial={{ layer: "project", reason: "你在本项目中的角色不能查看上下文包明细；已发布的脱敏结论可在报告中查看。" }}
        successMessage="上下文包已确认，读入与丢弃清单均可追溯"
      >
        {body}
      </StateShell>
    </div>
  );
}
