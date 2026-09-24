"use client";

import * as React from "react";
import { FileText } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { ClaimTriStateBadge } from "./claim-tri-state-badge";
import { ClaimEditMenu } from "./claim-edit-menu";
import { groupClaimsByKind } from "@/lib/mock/knowledge-graph";
import type { KgClaim } from "@repo/contracts/knowledge-graph";

/**
 * 列表视图（uc-18-3 R3-1 列表）：结论按 kind 分组，三态徽标、来源消息、证据数。
 * - 多选（`selectable` + selected）供「存入个人空间」（uc-18-4，只有 canPromote 时开）。
 * - 编辑菜单只在 canEdit 时渲染（非所有者只读）。
 * - 点结论打开来源抽屉。
 */
export function KnowledgeList({
  claims,
  canEdit,
  selectable,
  selected,
  onToggleSelect,
  onOpenSource,
  onAction,
}: {
  claims: KgClaim[];
  canEdit: boolean;
  selectable: boolean;
  selected: Record<string, boolean>;
  onToggleSelect?: (claimId: string, next: boolean) => void;
  onOpenSource?: (claim: KgClaim) => void;
  onAction?: (action: string, claimId: string) => void;
}) {
  const groups = groupClaimsByKind(claims);
  return (
    <div className="flex flex-col gap-4" data-testid="kg-list">
      {groups.map((g) => (
        <section key={g.kind} data-testid={`kg-group-${g.kind}`}>
          <h3 className="mb-1.5 flex items-center gap-1.5 text-11 font-medium text-muted-foreground">
            {g.label}
            <span className="rounded-control bg-muted px-1.5 py-0.5 text-10">{g.claims.length}</span>
          </h3>
          <ul className="flex flex-col gap-1.5">
            {g.claims.map((c) => (
              <li
                key={c.id}
                data-testid={`kg-claim-${c.id}`}
                className="group flex items-start gap-2 rounded-md border border-border-subtle bg-background p-2 transition-colors duration-base hover:bg-muted"
              >
                {selectable ? (
                  <Checkbox
                    className="mt-0.5"
                    checked={selected[c.id] ?? false}
                    onChange={(e) => onToggleSelect?.(c.id, e.target.checked)}
                    aria-label={`选择 ${c.statement}`}
                    data-testid={`kg-claim-select-${c.id}`}
                  />
                ) : null}
                <button
                  type="button"
                  className="flex flex-1 flex-col items-start gap-1 text-left"
                  data-testid={`kg-claim-open-${c.id}`}
                  onClick={() => onOpenSource?.(c)}
                >
                  <span className="text-12 leading-relaxed text-background-foreground">{c.statement}</span>
                  <span className="flex items-center gap-1.5">
                    <ClaimTriStateBadge status={c.status} />
                    <span className="flex items-center gap-1 text-10 text-muted-foreground">
                      <FileText aria-hidden className="h-3 w-3" />
                      证据 {c.supportingCount}
                      {c.contradictingCount > 0 ? ` · 反对 ${c.contradictingCount}` : ""}
                    </span>
                    {c.createdBy === "human" ? (
                      <span className="text-10 text-muted-foreground">· 人工</span>
                    ) : null}
                  </span>
                </button>
                <ClaimEditMenu claim={c} canEdit={canEdit} onAction={onAction} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** 空态（uc-18-3 A1）——有引导文案 + 可行动入口（「整理本会话」）。 */
export function KnowledgeEmpty({ onReindex }: { onReindex?: () => void }) {
  return (
    <div
      data-testid="empty"
      className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border py-12 text-center"
    >
      <p className="max-w-xs text-12 text-muted-foreground">
        对话中提到的人、决定和事实会自动出现在这里。现在还没有——发几条消息，或手动整理一次。
      </p>
      <Button size="sm" variant="outline" onClick={onReindex} data-testid="kg-empty-reindex">
        整理本会话
      </Button>
    </div>
  );
}
