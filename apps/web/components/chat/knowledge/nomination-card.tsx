"use client";

import * as React from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { PromotionNominations } from "@/lib/mock/knowledge-graph";

/**
 * AI 提名「值得记住」卡片（uc-18-4 A1 / UC-KG-6）。
 * ⚠ AI **只提名，不执行**（R4 硬边界）：勾选后由人点「存入个人空间」才走晋升。
 */
export function NominationCard({
  data,
  claimLabel,
  onPromote,
}: {
  data: PromotionNominations;
  claimLabel: (claimId: string) => string;
  onPromote?: (claimIds: string[]) => void;
}) {
  const [checked, setChecked] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(data.nominations.map((n) => [n.claimId, true])),
  );
  const selected = data.nominations.filter((n) => checked[n.claimId]).map((n) => n.claimId);

  return (
    <div className="rounded-lg border border-ai-tint bg-ai-tint/40 p-3" data-testid="kg-nomination-card">
      <div className="mb-2 flex items-center gap-1.5">
        <Sparkles aria-hidden className="h-4 w-4 text-ai-tint-foreground" />
        <span className="text-12 font-medium text-ai-tint-foreground">这些值得记住</span>
        <span className="text-10 text-muted-foreground">由 AI 提名 · 需你确认后才存入</span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {data.nominations.map((n) => (
          <li key={n.claimId} className="flex items-start gap-2" data-testid={`kg-nomination-${n.claimId}`}>
            <Checkbox
              checked={checked[n.claimId] ?? false}
              onChange={(e) => setChecked((s) => ({ ...s, [n.claimId]: e.target.checked }))}
              aria-label={`选择 ${claimLabel(n.claimId)}`}
              data-testid={`kg-nomination-check-${n.claimId}`}
              className="mt-0.5"
            />
            <div className="flex flex-col">
              <span className="text-11 text-background-foreground">{claimLabel(n.claimId)}</span>
              <span className="text-10 text-muted-foreground">{n.rationale}</span>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex justify-end">
        <Button
          size="xs"
          disabled={selected.length === 0}
          data-testid="kg-nomination-promote"
          onClick={() => onPromote?.(selected)}
        >
          存入个人空间（{selected.length}）
        </Button>
      </div>
    </div>
  );
}
