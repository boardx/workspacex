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
import { claimTriState, type KgClaim } from "@repo/contracts/chat-knowledge-graph";
import type { ClaimDialogKind } from "./claim-action-dialog";

/**
 * 单条记忆的所有者编辑菜单（uc-18-3 R3 / R4）—— 一键「对 / 不对」之外的完整动作。
 * - 所有者：确认 / 改写 / 忘掉 / 标矛盾 + 合并 / 拆分 / 改名（人和事）。
 * - 非所有者（`canEdit=false`）：**不渲染任何编辑入口**（uc-18-3 R5 / E2），返回 null。
 * - 对「有矛盾」的一条点「确认」被禁用并解释（uc-18-3 E3 → KG_CONTESTED_NEEDS_RESOLUTION）。
 * - 需要输入的动作只负责打开对应对话框（`ClaimActionDialog`，由列表持有），不在菜单里提交。
 * - 这一条没关联人和事时，合并 / 拆分 / 改名禁用。
 */
export function ClaimEditMenu({
  claim,
  canEdit,
  hasObjects,
  onConfirm,
  onOpenDialog,
}: {
  claim: KgClaim;
  canEdit: boolean;
  hasObjects: boolean;
  onConfirm?: () => void;
  onOpenDialog?: (kind: ClaimDialogKind) => void;
}) {
  if (!canEdit) return null;

  const isConflict = claimTriState(claim.status) === "conflict";
  const isConfirmed = claimTriState(claim.status) === "confirmed";
  const open = (k: ClaimDialogKind) => onOpenDialog?.(k);

  return (
    // modal={false}：菜单项打开的是对话框，非模态菜单关闭时不会和对话框抢 body 的 pointer-events 锁
    <DropdownMenu modal={false}>
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
          onSelect={() => onConfirm?.()}
        >
          <Check aria-hidden className="mr-2 h-3.5 w-3.5" />
          确认（对）
        </DropdownMenuItem>
        {isConflict ? (
          <p className="px-2 py-1 text-10 text-muted-foreground" data-testid={`kg-confirm-blocked-${claim.id}`}>
            有矛盾的记忆要先选保留哪条才能确认
          </p>
        ) : null}
        <DropdownMenuItem data-testid={`kg-action-revise-${claim.id}`} onSelect={() => open("revise")}>
          <Pencil aria-hidden className="mr-2 h-3.5 w-3.5" />
          改写
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={isConflict}
          data-testid={`kg-action-contest-${claim.id}`}
          onSelect={() => open("contest")}
        >
          <GitBranch aria-hidden className="mr-2 h-3.5 w-3.5" />
          标为有矛盾
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>相关的人和事</DropdownMenuLabel>
        <DropdownMenuItem disabled={!hasObjects} data-testid={`kg-action-merge-${claim.id}`} onSelect={() => open("merge")}>
          合并
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!hasObjects} data-testid={`kg-action-split-${claim.id}`} onSelect={() => open("split")}>
          拆分
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!hasObjects} data-testid={`kg-action-rename-${claim.id}`} onSelect={() => open("rename")}>
          改名
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          data-testid={`kg-action-delete-${claim.id}`}
          onSelect={() => open("revoke")}
        >
          <Trash2 aria-hidden className="mr-2 h-3.5 w-3.5" />
          忘掉这条
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
