"use client";

import * as React from "react";
import { FileText, Check, X, Pencil, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { ClaimTriStateBadge } from "./claim-tri-state-badge";
import { ClaimEditMenu } from "./claim-edit-menu";
import { groupClaimsByKind } from "@/lib/mock/knowledge-graph";
import { claimTriState, type KgClaim } from "@repo/contracts/chat-knowledge-graph";

/**
 * 列表视图（uc-18-3 R3-1）：记下的按类型分组，三态徽标、来源、证据数。
 * - U-2：每条一键「对 / 不对」；「不对」就地展开「改写 / 忘掉这条」；批量「全部确认」在面板头部。
 * - 多选（`selectable` + selected）供「记到长期记忆」（uc-18-4，只有 canPromote 时开）。
 * - 完整编辑菜单（合并/拆分/改名等）仍在 `…` 菜单里，只对 canEdit 渲染。
 * - 点内容打开来源抽屉。
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
  const [openWrong, setOpenWrong] = React.useState<Record<string, boolean>>({});
  const fire = (a: string, id: string) => onAction?.(a, id);

  return (
    <div className="flex flex-col gap-4" data-testid="kg-list">
      {groups.map((g) => (
        <section key={g.kind} data-testid={`kg-group-${g.kind}`}>
          <h3 className="mb-1.5 flex items-center gap-1.5 text-11 font-medium text-muted-foreground">
            {g.label}
            <span className="rounded-control bg-muted px-1.5 py-0.5 text-10">{g.claims.length}</span>
          </h3>
          <ul className="flex flex-col gap-1.5">
            {g.claims.map((c) => {
              const tri = claimTriState(c.status);
              const confirmed = tri === "confirmed";
              const conflict = tri === "conflict";
              return (
                <li
                  key={c.id}
                  data-testid={`kg-claim-${c.id}`}
                  className="group flex flex-col gap-1.5 rounded-md border border-border-subtle bg-background p-2 transition-colors duration-base hover:bg-muted"
                >
                  <div className="flex items-start gap-2">
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
                      </span>
                    </button>
                    <ClaimEditMenu claim={c} canEdit={canEdit} onAction={onAction} />
                  </div>

                  {/* U-2：一键「对 / 不对」——不用打开面板就能纠错 */}
                  {canEdit && !selectable ? (
                    <div className="flex items-center gap-1.5 pl-0.5">
                      <Button
                        size="xs"
                        variant={confirmed ? "secondary" : "outline"}
                        disabled={confirmed || conflict}
                        data-testid={`kg-row-yes-${c.id}`}
                        onClick={() => fire("confirmClaim", c.id)}
                      >
                        <Check aria-hidden className="mr-1 h-3 w-3" />
                        {confirmed ? "你确认过" : "对"}
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        data-testid={`kg-row-no-${c.id}`}
                        aria-expanded={openWrong[c.id] ?? false}
                        onClick={() => setOpenWrong((s) => ({ ...s, [c.id]: !s[c.id] }))}
                      >
                        <X aria-hidden className="mr-1 h-3 w-3" />
                        不对
                      </Button>
                      {openWrong[c.id] ? (
                        <span className="flex items-center gap-1.5" data-testid={`kg-row-wrong-options-${c.id}`}>
                          <Button size="xs" variant="ghost" data-testid={`kg-row-revise-${c.id}`} onClick={() => fire("reviseClaim", c.id)}>
                            <Pencil aria-hidden className="mr-1 h-3 w-3" />
                            改写
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            className="text-destructive"
                            data-testid={`kg-row-forget-${c.id}`}
                            onClick={() => fire("revokeClaim", c.id)}
                          >
                            <Trash2 aria-hidden className="mr-1 h-3 w-3" />
                            忘掉这条
                          </Button>
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
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
        对话里提到的人、决定和事实会自动记在这里，你什么都不用做。现在还没有——先聊几句，或手动整理一次。
      </p>
      <Button size="sm" variant="outline" onClick={onReindex} data-testid="kg-empty-reindex">
        整理本会话
      </Button>
    </div>
  );
}
