"use client";

import * as React from "react";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { PromotionNominations } from "@/lib/knowledge-graph-api";

/**
 * AI 提名「值得记住」卡片（uc-18-4 A1 / UC-KG-6）。
 * ⚠ AI **只提名，不执行**（R4 硬边界）：渲染本卡片不发任何写请求；只有人点「记下」（单条）或
 * 勾选后点「记到我的长期记忆（N）」（批量）才走晋升。
 * - `onDismiss` 传了才画「×」：面板里可以收起，签核预览的静态屏不需要。
 * - `busy` 期间所有提交按钮禁用，防连点重复提交。
 */
export function NominationCard({
  data,
  claimLabel,
  onPromote,
  onDismiss,
  busy = false,
}: {
  data: PromotionNominations;
  claimLabel: (claimId: string) => string;
  onPromote?: (claimIds: string[]) => void;
  onDismiss?: () => void;
  busy?: boolean;
}) {
  const [checked, setChecked] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(data.nominations.map((n) => [n.claimId, true])),
  );
  const selected = data.nominations.filter((n) => checked[n.claimId] ?? true).map((n) => n.claimId);

  return (
    <div className="rounded-lg border border-ai-tint bg-ai-tint/40 p-3" data-testid="kg-nomination-card">
      <div className="mb-2 flex items-center gap-1.5">
        <Sparkles aria-hidden className="h-4 w-4 text-ai-tint-foreground" />
        <span className="text-12 font-medium text-ai-tint-foreground">这些值得记住</span>
        <span className="text-10 text-muted-foreground">由 AI 提名 · 你点了才会记</span>
        {onDismiss ? (
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto"
            aria-label="收起 AI 的提名"
            data-testid="kg-nomination-dismiss"
            onClick={onDismiss}
          >
            <X aria-hidden className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
      <ul className="flex flex-col gap-1.5">
        {data.nominations.map((n) => (
          <li key={n.claimId} className="flex items-start gap-2" data-testid={`kg-nomination-${n.claimId}`}>
            <Checkbox
              checked={checked[n.claimId] ?? true}
              onChange={(e) => setChecked((s) => ({ ...s, [n.claimId]: e.target.checked }))}
              aria-label={`选择 ${claimLabel(n.claimId)}`}
              data-testid={`kg-nomination-check-${n.claimId}`}
              className="mt-0.5"
            />
            <div className="flex flex-1 flex-col">
              <span className="text-11 text-background-foreground">{claimLabel(n.claimId)}</span>
              <span className="text-10 text-muted-foreground">{n.rationale}</span>
            </div>
            {onPromote ? (
              <Button
                size="xs"
                variant="outline"
                disabled={busy}
                data-testid={`kg-nomination-promote-one-${n.claimId}`}
                onClick={() => onPromote([n.claimId])}
              >
                记下
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center justify-end gap-2">
        <span className="text-10 text-muted-foreground">记下后即视为你确认过</span>
        <Button
          size="xs"
          disabled={selected.length === 0 || busy}
          data-testid="kg-nomination-promote"
          onClick={() => onPromote?.(selected)}
        >
          记到我的长期记忆（{selected.length}）
        </Button>
      </div>
    </div>
  );
}
