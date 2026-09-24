"use client";

import * as React from "react";
import { MoreHorizontal, Check, Pencil, Trash2, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { claimTriState, type KgClaim } from "@repo/contracts/chat-knowledge-graph";

/**
 * 单条记忆的所有者编辑菜单（uc-18-3 R3 / R4）—— 一键「对 / 不对」之外的完整动作。
 * - 所有者：确认 / 改写 / 忘掉 / 标矛盾 + 合并 / 拆分 / 改名（人和事）。
 * - 非所有者（`canEdit=false`）：**不渲染任何编辑入口**（uc-18-3 R5 / E2），返回 null。
 * - 忘掉是危险动作：二次确认 + 影响范围说明（硬规则 ⑦）。
 * - 对「有矛盾」的一条点「确认」被禁用并解释（uc-18-3 E3 → KG_CONTESTED_NEEDS_RESOLUTION）。
 *
 * ⚠ 纯前端 mock：动作只回调，不落后端。
 */
export function ClaimEditMenu({
  claim,
  canEdit,
  onAction,
}: {
  claim: KgClaim;
  canEdit: boolean;
  onAction?: (action: string, claimId: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  if (!canEdit) return null;

  const isConflict = claimTriState(claim.status) === "conflict";
  const isConfirmed = claimTriState(claim.status) === "confirmed";
  const fire = (a: string) => onAction?.(a, claim.id);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="xs"
            aria-label="更多"
            data-testid={`kg-claim-edit-trigger-${claim.id}`}
          >
            <MoreHorizontal aria-hidden className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44" data-testid={`kg-claim-edit-menu-${claim.id}`}>
          <DropdownMenuLabel>这一条</DropdownMenuLabel>
          <DropdownMenuItem
            disabled={isConflict || isConfirmed}
            data-testid={`kg-action-confirm-${claim.id}`}
            onSelect={() => fire("confirmClaim")}
          >
            <Check aria-hidden className="mr-2 h-3.5 w-3.5" />
            确认（对）
          </DropdownMenuItem>
          {isConflict ? (
            <p className="px-2 py-1 text-10 text-muted-foreground" data-testid={`kg-confirm-blocked-${claim.id}`}>
              有矛盾的记忆要先选保留哪条才能确认
            </p>
          ) : null}
          <DropdownMenuItem data-testid={`kg-action-revise-${claim.id}`} onSelect={() => fire("reviseClaim")}>
            <Pencil aria-hidden className="mr-2 h-3.5 w-3.5" />
            改写
          </DropdownMenuItem>
          <DropdownMenuItem data-testid={`kg-action-contest-${claim.id}`} onSelect={() => fire("markContested")}>
            <GitBranch aria-hidden className="mr-2 h-3.5 w-3.5" />
            标为有矛盾
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>相关的人和事</DropdownMenuLabel>
          <DropdownMenuItem data-testid={`kg-action-merge-${claim.id}`} onSelect={() => fire("mergeObjects")}>
            合并
          </DropdownMenuItem>
          <DropdownMenuItem data-testid={`kg-action-split-${claim.id}`} onSelect={() => fire("splitObject")}>
            拆分
          </DropdownMenuItem>
          <DropdownMenuItem data-testid={`kg-action-rename-${claim.id}`} onSelect={() => fire("renameObject")}>
            改名
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            data-testid={`kg-action-delete-${claim.id}`}
            onSelect={() => setConfirmDelete(true)}
          >
            <Trash2 aria-hidden className="mr-2 h-3.5 w-3.5" />
            忘掉这条
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent data-testid={`kg-delete-confirm-${claim.id}`}>
          <DialogHeader>
            <DialogTitle>忘掉这条记忆？</DialogTitle>
            <DialogDescription>
              忘掉不是彻底抹除：这条会退出关系图和之后的召回，反对它的证据仍留在记录里。
              你记到长期记忆里的副本会同时失效。此操作会在 5 分钟内影响之后的回答。
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-md bg-muted p-2 text-11 text-muted-foreground" data-testid={`kg-delete-impact-${claim.id}`}>
            「{claim.statement}」
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)} data-testid={`kg-delete-cancel-${claim.id}`}>
              取消
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                fire("revokeClaim");
                setConfirmDelete(false);
              }}
              data-testid={`kg-delete-confirm-btn-${claim.id}`}
            >
              忘掉这条
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
