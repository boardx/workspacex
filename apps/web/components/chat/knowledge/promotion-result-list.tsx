"use client";

import * as React from "react";
import { CheckCircle2, GitMerge, Copy, HelpCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PromotionChoice, PromotionResults } from "@/lib/knowledge-graph-api";
import { describePromotionReject } from "@/lib/knowledge-graph-failure";

/**
 * 「记到长期记忆」逐条结果（uc-18-4 R3-5 / R4-E4：部分成功，不整批回滚）。
 * 五种 outcome：promoted / merged_into_existing / coexisting / needs_choice（合并 | 两条都留）/ rejected（带原因）。
 * outcome 与拒绝码均来自契约 `KgPromotionItemResult`，本组件只做投影；拒绝原因的人话单源在
 * `knowledge-graph-failure.ts`，内部码不上屏。
 * `onChoice` 不传（签核预览的静态屏）时选择按钮照画但不可点；`busy` 期间禁用，防连点重复提交。
 */
export function PromotionResultList({
  data,
  claimLabel,
  onChoice,
  busy = false,
}: {
  data: PromotionResults;
  claimLabel: (claimId: string) => string;
  onChoice?: (claimId: string, choice: PromotionChoice["choice"]) => void;
  busy?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2" data-testid="kg-promotion-results">
      {data.results.map((r) => {
        const label = claimLabel(r.claimId);
        switch (r.outcome) {
          case "promoted":
            return (
              <ResultRow key={r.claimId} testid={`kg-promo-${r.claimId}`} tone="success" icon={<CheckCircle2 className="h-3.5 w-3.5" />} label={label} note="已记到你的长期记忆" />
            );
          case "merged_into_existing":
            return (
              <ResultRow key={r.claimId} testid={`kg-promo-${r.claimId}`} tone="muted" icon={<GitMerge className="h-3.5 w-3.5" />} label={label} note="已并入长期记忆里同样的一条" />
            );
          case "coexisting":
            return (
              <ResultRow key={r.claimId} testid={`kg-promo-${r.claimId}`} tone="muted" icon={<Copy className="h-3.5 w-3.5" />} label={label} note="和已有的一条并存（标了适用差异）" />
            );
          case "needs_choice":
            return (
              <div
                key={r.claimId}
                role="group"
                aria-label="长期记忆里已有同样的一条"
                data-testid={`kg-promo-${r.claimId}`}
                className="rounded-md border border-warning bg-warning-tint p-2"
              >
                <div className="mb-1.5 flex items-start gap-1.5">
                  <HelpCircle aria-hidden className="mt-0.5 h-3.5 w-3.5 text-warning-foreground" />
                  <p className="text-11 text-warning-tint-foreground">
                    长期记忆里已有同样的一条：「{label}」——合并还是两条都留？
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <Button size="xs" variant="secondary" disabled={busy} data-testid={`kg-choice-merge-${r.claimId}`} onClick={() => onChoice?.(r.claimId, "merge")}>
                    合并到已有的那条
                  </Button>
                  <Button size="xs" variant="outline" disabled={busy} data-testid={`kg-choice-coexist-${r.claimId}`} onClick={() => onChoice?.(r.claimId, "coexist")}>
                    两条都保留
                  </Button>
                </div>
              </div>
            );
          case "rejected":
            return (
              <div key={r.claimId} data-testid={`kg-promo-${r.claimId}`} className="rounded-md border border-border-subtle bg-background p-2">
                <div className="flex items-start gap-1.5">
                  <XCircle aria-hidden className="mt-0.5 h-3.5 w-3.5 text-destructive" />
                  <div className="flex flex-col">
                    <span className="text-11 text-background-foreground">{label}</span>
                    <span className="text-10 text-destructive" data-testid={`kg-promo-reject-reason-${r.claimId}`}>
                      {describePromotionReject(r.code)}
                    </span>
                  </div>
                </div>
              </div>
            );
          default: {
            const _exhaustive: never = r;
            return _exhaustive;
          }
        }
      })}
    </div>
  );
}

function ResultRow({
  testid,
  tone,
  icon,
  label,
  note,
}: {
  testid: string;
  tone: "success" | "muted";
  icon: React.ReactNode;
  label: string;
  note: string;
}) {
  return (
    <div data-testid={testid} className="flex items-start gap-1.5 rounded-md border border-border-subtle bg-background p-2">
      <span aria-hidden className={tone === "success" ? "mt-0.5 text-success" : "mt-0.5 text-muted-foreground"}>
        {icon}
      </span>
      <div className="flex flex-col">
        <span className="text-11 text-background-foreground">{label}</span>
        <span className="text-10 text-muted-foreground">{note}</span>
      </div>
    </div>
  );
}
