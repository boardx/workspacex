"use client";
import * as React from "react";
import { AlertTriangle, PenLine, Check, GitBranch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import {
  LEDGER_HEADER,
  AWAITING_SIGN,
  LEDGER_ROWS,
  reasoningChainFor,
  type ReasoningStep,
  type ReviewState,
} from "@/lib/mock/brain";

const REVIEW_TONE: Record<ReviewState, "neutral" | "primary" | "warning" | "danger"> = {
  "待验证": "warning",
  "已验证": "primary",
  "已验证·已晋升": "primary",
  "被推翻": "danger",
};

/** 推演链片段列表（支持/反对分列，反对强制可见）*/
function ChainList({ steps, testid }: { steps: ReasoningStep[]; testid: string }) {
  return (
    <ul className="flex flex-col gap-1.5" data-testid={testid}>
      {steps.map((s) => (
        <li key={s.id} className="flex items-start gap-2 rounded-md border border-border-subtle bg-card px-2 py-1.5">
          <Badge tone={s.side === "support" ? "primary" : "danger"}>{s.side === "support" ? "支持" : "反对"}</Badge>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-11 text-card-foreground">{s.claim}</span>
            <span className="text-10 text-muted-foreground">← {s.source}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** 等我签字卡片 —— 签字为不可逆高影响动作，二次确认并列出影响范围（UC-14.4 R8）*/
function AwaitingSignCard({ item }: { item: (typeof AWAITING_SIGN)[number] }) {
  const [confirming, setConfirming] = React.useState(false);
  const [showChain, setShowChain] = React.useState(false);
  const [outcome, setOutcome] = React.useState<null | "signed" | "requested">(null);

  return (
    <article
      data-testid={`brain-sign-card-${item.id}`}
      className="flex flex-col gap-2 rounded-md border border-border bg-card p-3 shadow-sm"
    >
      <div className="flex items-start gap-2">
        <PenLine aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="flex flex-col gap-0.5">
          <h3 className="text-13 font-medium">{item.decision}</h3>
          <span className="text-10 text-muted-foreground">{item.project} · {item.basis}</span>
        </div>
      </div>

      {outcome === "signed" ? (
        <p className="inline-flex items-center gap-1.5 rounded-md bg-success/10 px-2.5 py-1.5 text-11 text-success" data-testid={`brain-sign-done-${item.id}`}>
          <Check aria-hidden className="h-3.5 w-3.5 shrink-0" />
          已签字 · 已记入决策台账，成为可被引用的依据（不可逆）
        </p>
      ) : outcome === "requested" ? (
        <p className="inline-flex items-center gap-1.5 rounded-md bg-warning/10 px-2.5 py-1.5 text-11 text-warning" data-testid={`brain-request-evidence-done-${item.id}`}>
          <AlertTriangle aria-hidden className="h-3.5 w-3.5 shrink-0" />
          已要求补证据 · 已退回交付方，补齐后重新进入待签字
        </p>
      ) : confirming ? (
        <div
          data-testid={`brain-sign-confirm-${item.id}`}
          role="alertdialog"
          className="flex flex-col gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3"
        >
          <p className="inline-flex items-start gap-1.5 text-12 text-destructive">
            <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {item.confirmNote}
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="destructive" onClick={() => { setOutcome("signed"); setConfirming(false); }} data-testid={`brain-sign-confirm-yes-${item.id}`}>确认签字</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} data-testid={`brain-sign-confirm-cancel-${item.id}`}>取消</Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" onClick={() => setConfirming(true)} data-testid={`brain-sign-${item.id}`}>签字并记入台账</Button>
            <Button size="sm" variant="outline" onClick={() => setOutcome("requested")} data-testid={`brain-request-evidence-${item.id}`}>要求补证据</Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowChain((v) => !v)}
              aria-expanded={showChain}
              data-testid={`brain-view-chain-${item.id}`}
            >
              {showChain ? "收起推演链" : "看完整推演链"}
            </Button>
          </div>
          {showChain && (
            <ChainList steps={reasoningChainFor(item.id, 9, 2)} testid={`brain-chain-${item.id}`} />
          )}
        </>
      )}
    </article>
  );
}

export function DecisionLedger() {
  // 台账行「支持链」逐行展开
  const [expandedRow, setExpandedRow] = React.useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4" data-testid="brain-decision-ledger">
      <div className="flex flex-wrap items-center gap-3 text-12" data-testid="brain-ledger-header">
        <span className="text-14 font-semibold">{LEDGER_HEADER.total} 个决策</span>
        <Badge tone="warning">{LEDGER_HEADER.awaitingSign} 个等我签字</Badge>
        <Badge tone="neutral">{LEDGER_HEADER.pendingReview} 个待复盘</Badge>
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-12 font-semibold text-muted-foreground">等我签字</h3>
        <div className="flex flex-col gap-2">
          {AWAITING_SIGN.map((item) => (
            <AwaitingSignCard key={item.id} item={item} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-12 font-semibold text-muted-foreground">台账</h3>
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table className="w-full border-collapse text-12" data-testid="brain-ledger-table">
            <TableHeader>
              <TableRow className="border-b border-border bg-panel text-left text-11 text-muted-foreground">
                <TableHead className="p-2 font-medium">决策</TableHead>
                <TableHead className="p-2 font-medium">项目</TableHead>
                <TableHead className="p-2 font-medium">拍板</TableHead>
                <TableHead className="p-2 font-medium">依据强度</TableHead>
                <TableHead className="p-2 font-medium">复盘</TableHead>
                <TableHead className="p-2 font-medium" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {LEDGER_ROWS.map((r) => {
                const open = expandedRow === r.id;
                return (
                  <React.Fragment key={r.id}>
                    <TableRow data-testid={`brain-ledger-row-${r.id}`} className="border-b border-border-subtle last:border-0">
                      <TableCell className="p-2 font-medium">{r.decision}</TableCell>
                      <TableCell className="p-2 text-muted-foreground">{r.project}</TableCell>
                      <TableCell className="p-2 text-muted-foreground">{r.decidedBy}</TableCell>
                      <TableCell className="p-2">
                        <span className="inline-flex items-center gap-1 text-11">
                          <span className="text-primary">支持 {r.support}</span>
                          <span className="text-destructive">反对 {r.against}</span>
                        </span>
                      </TableCell>
                      <TableCell className="p-2">
                        <Badge tone={REVIEW_TONE[r.reviewState]}>
                          {r.reviewState}{r.reviewDate ? ` · ${r.reviewDate}` : ""}
                        </Badge>
                      </TableCell>
                      <TableCell className="p-2">
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => setExpandedRow((v) => (v === r.id ? null : r.id))}
                          aria-expanded={open}
                          data-testid={`brain-support-chain-${r.id}`}
                        >
                          <GitBranch aria-hidden className="h-3 w-3" />
                          {open ? "收起" : "支持链"}
                        </Button>
                      </TableCell>
                    </TableRow>
                    {open && (
                      <TableRow data-testid={`brain-support-chain-detail-${r.id}`}>
                        <TableCell colSpan={6} className="border-b border-border-subtle bg-muted p-2.5">
                          <ChainList steps={reasoningChainFor(r.id, r.support, r.against)} testid={`brain-chain-row-${r.id}`} />
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <p className="text-10 text-muted-foreground">
          依据强度必须含反对条数；「支持链」「看完整推演链」在此内联展开，支持与反对分列，反对强制可见。
        </p>
      </section>
    </div>
  );
}
