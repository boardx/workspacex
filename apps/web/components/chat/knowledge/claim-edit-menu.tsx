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
import { claimTriState, type KgClaim } from "@repo/contracts/knowledge-graph";

/**
 * 结论所有者编辑菜单（uc-18-3 R3 / R4）。
 * - 所有者：确认 / 改写 / 删除 / 标冲突（结论）+ 合并 / 拆分 / 改名（实体）。
 * - 非所有者（`canEdit=false`）：**不渲染任何编辑入口**（硬规则 · uc-18-3 R5 / E2），返回 null。
 * - 删除是危险动作：二次确认 + 影响范围说明（硬规则 ⑦）。
 * - 对 contested 结论点「确认」被禁用并解释（uc-18-3 E3 → KG_CONTESTED_NEEDS_RESOLUTION）。
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
            aria-label="编辑这条结论"
            data-testid={`kg-claim-edit-trigger-${claim.id}`}
          >
            <MoreHorizontal aria-hidden className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44" data-testid={`kg-claim-edit-menu-${claim.id}`}>
          <DropdownMenuLabel>结论</DropdownMenuLabel>
          <DropdownMenuItem
            disabled={isConflict || isConfirmed}
            data-testid={`kg-action-confirm-${claim.id}`}
            onSelect={() => fire("confirmClaim")}
          >
            <Check aria-hidden className="mr-2 h-3.5 w-3.5" />
            确认
          </DropdownMenuItem>
          {isConflict ? (
            <p className="px-2 py-1 text-10 text-muted-foreground" data-testid={`kg-confirm-blocked-${claim.id}`}>
              冲突结论需先选择保留哪条才能确认
            </p>
          ) : null}
          <DropdownMenuItem data-testid={`kg-action-revise-${claim.id}`} onSelect={() => fire("reviseClaim")}>
            <Pencil aria-hidden className="mr-2 h-3.5 w-3.5" />
            改写
          </DropdownMenuItem>
          <DropdownMenuItem data-testid={`kg-action-contest-${claim.id}`} onSelect={() => fire("markContested")}>
            <GitBranch aria-hidden className="mr-2 h-3.5 w-3.5" />
            标冲突
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>实体</DropdownMenuLabel>
          <DropdownMenuItem data-testid={`kg-action-merge-${claim.id}`} onSelect={() => fire("mergeObjects")}>
            合并实体
          </DropdownMenuItem>
          <DropdownMenuItem data-testid={`kg-action-split-${claim.id}`} onSelect={() => fire("splitObject")}>
            拆分实体
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
            删除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent data-testid={`kg-delete-confirm-${claim.id}`}>
          <DialogHeader>
            <DialogTitle>删除这条结论？</DialogTitle>
            <DialogDescription>
              删除不是物理删除：这条结论会转为「已撤销」并退出图与召回，反对证据仍保留在审计里。
              晋升到个人空间的副本会随之失效。此操作会在 5 分钟内影响之后的召回。
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
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
