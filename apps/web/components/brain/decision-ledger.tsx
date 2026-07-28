"use client";
import * as React from "react";
import { AlertTriangle, PenLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  LEDGER_HEADER,
  AWAITING_SIGN,
  LEDGER_ROWS,
  type ReviewState,
} from "@/lib/mock/brain";

const REVIEW_TONE: Record<ReviewState, "neutral" | "primary" | "warning" | "danger"> = {
  "待验证": "warning",
  "已验证": "primary",
  "已验证·已晋升": "primary",
  "被推翻": "danger",
};

/** 等我签字卡片 —— 签字为不可逆高影响动作，二次确认并列出影响范围（UC-14.4 R8）*/
function AwaitingSignCard({ item }: { item: (typeof AWAITING_SIGN)[number] }) {
  const [confirming, setConfirming] = React.useState(false);

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

      {confirming ? (
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
            <Button size="sm" variant="destructive" data-testid={`brain-sign-confirm-yes-${item.id}`}>确认签字</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} data-testid={`brain-sign-confirm-cancel-${item.id}`}>取消</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" onClick={() => setConfirming(true)} data-testid={`brain-sign-${item.id}`}>签字并记入台账</Button>
          <Button size="sm" variant="outline" data-testid={`brain-request-evidence-${item.id}`}>要求补证据</Button>
          <Button size="sm" variant="ghost" data-testid={`brain-view-chain-${item.id}`}>看完整推演链</Button>
        </div>
      )}
    </article>
  );
}

export function DecisionLedger() {
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
          <table className="w-full border-collapse text-12" data-testid="brain-ledger-table">
            <thead>
              <tr className="border-b border-border bg-panel text-left text-11 text-muted-foreground">
                <th className="p-2 font-medium">决策</th>
                <th className="p-2 font-medium">项目</th>
                <th className="p-2 font-medium">拍板</th>
                <th className="p-2 font-medium">依据强度</th>
                <th className="p-2 font-medium">复盘</th>
                <th className="p-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {LEDGER_ROWS.map((r) => (
                <tr key={r.id} data-testid={`brain-ledger-row-${r.id}`} className="border-b border-border-subtle last:border-0">
                  <td className="p-2 font-medium">{r.decision}</td>
                  <td className="p-2 text-muted-foreground">{r.project}</td>
                  <td className="p-2 text-muted-foreground">{r.decidedBy}</td>
                  <td className="p-2">
                    <span className="inline-flex items-center gap-1 text-11">
                      <span className="text-primary">支持 {r.support}</span>
                      <span className="text-destructive">反对 {r.against}</span>
                    </span>
                  </td>
                  <td className="p-2">
                    <Badge tone={REVIEW_TONE[r.reviewState]}>
                      {r.reviewState}{r.reviewDate ? ` · ${r.reviewDate}` : ""}
                    </Badge>
                  </td>
                  <td className="p-2">
                    <Button size="xs" variant="ghost" data-testid={`brain-support-chain-${r.id}`}>支持链</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-10 text-muted-foreground">
          依据强度必须含反对条数；「支持链」「看完整推演链」目标屏属推演链编辑器范围（原型待补 · 按钮在、行为未接线）。
        </p>
      </section>
    </div>
  );
}
