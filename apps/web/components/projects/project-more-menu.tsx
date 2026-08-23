"use client";
import * as React from "react";
import { MoreHorizontal, AlertTriangle, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { cn } from "@/lib/utils";

/**
 * 项目卡的 `⋯` 菜单 —— 承载**增删改**里的「改」（编辑）与「退役」（归档）。
 * 硬规则 6：归档这类动作必须二次确认 + 影响范围说明，不做成孤零零的红按钮。
 *
 * ⚠ **没有「删除项目」是有意的**：Q-9 裁「不提供删除项目」，由归档（Q-5 方案 B）承接
 *   「这个项目不再用了」。人类 2026-07-30 提到的「增删改」里的「删」= 归档退役，不是硬删除。
 *   （硬删除会加进 `no-forbidden-routes.test.ts` 的禁止清单。）
 *
 * F09：改走 `components/ui/menu.tsx`（Radix DropdownMenu 别名）——`open` state + 手写
 * `role="menu"` 绝对定位面板已收口。菜单内嵌归档二次确认子态（`confirming`）用
 * `onSelect` preventDefault 承接：点「归档项目」不让 Radix 自动关闭菜单，改由本组件的
 * `confirming` state 决定何时切换/关闭内容，与 org-menu/personal-menu 那种「选中即关闭」
 * 的简单菜单不同。（本文件当前无业务路由引用，是遗留原型卡 `project-card.tsx` 的一部分，
 * 仍按同样标准迁移以保持仓库内菜单实现单一事实源。）
 */
export function ProjectMoreMenu({ projectId }: { projectId: string }) {
  const [open, setOpen] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);

  return (
    <Menu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setConfirming(false);
      }}
    >
      <MenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="更多操作"
          data-testid={`projects-card-${projectId}-more`}
        >
          <MoreHorizontal aria-hidden className="h-4 w-4" />
        </Button>
      </MenuTrigger>
      <MenuContent align="end" sideOffset={4} data-testid={`projects-more-menu-${projectId}`} className="w-64">
        {!confirming ? (
          <>
            <MenuItem
              data-testid={`projects-more-${projectId}-edit`}
              onSelect={() => window.alert("演示：编辑项目（改名 / 改蓝本 / 改时长，前端投影）")}
            >
              <Pencil aria-hidden className="h-3.5 w-3.5" />
              编辑项目
            </MenuItem>
            <DemoMenuItem testid={`projects-more-${projectId}-bigscreen`}>看现场大屏</DemoMenuItem>
            <DemoMenuItem testid={`projects-more-${projectId}-copy-invite`}>复制邀请链接</DemoMenuItem>
            <MenuSeparator />
            <MenuItem
              data-testid={`projects-more-${projectId}-archive`}
              onSelect={(event) => { event.preventDefault(); setConfirming(true); }}
              className={cn("text-destructive data-[highlighted]:text-destructive")}
            >
              <AlertTriangle aria-hidden className="h-3.5 w-3.5" />
              归档项目
            </MenuItem>
            <p className="px-2 py-1 text-9 text-muted-foreground">
              不提供「删除项目」（Q-9）：归档 = 退役且可只读回看，不销毁内容。
            </p>
          </>
        ) : (
          <div className="flex flex-col gap-2 p-2" data-testid={`projects-archive-confirm-${projectId}`}>
            <p className="text-12 font-medium">确认归档这个项目？</p>
            <div className="rounded-md border border-warning/30 bg-warning/5 p-2">
              <p className="text-11 font-medium text-warning-foreground">归档会影响：</p>
              <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4 text-11 text-muted-foreground">
                <li>项目从活动列表移出，成员不再收到现场提醒</li>
                <li>已交付报告与决策台账保留，可只读查看</li>
                <li>该项目产出的证据仍被其它项目引用，引用关系不变</li>
              </ul>
            </div>
            <div className="flex justify-end gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirming(false)}
                data-testid={`projects-archive-cancel-${projectId}`}
              >
                取消
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  window.alert("演示：项目已归档（前端投影，真实归档在服务端）");
                  setOpen(false);
                  setConfirming(false);
                }}
                data-testid={`projects-archive-submit-${projectId}`}
              >
                确认归档
              </Button>
            </div>
          </div>
        )}
      </MenuContent>
    </Menu>
  );
}

function DemoMenuItem({ children, testid }: { children: React.ReactNode; testid: string }) {
  return (
    <MenuItem data-testid={testid} onSelect={() => window.alert("演示动作（前端投影）")}>
      {children}
    </MenuItem>
  );
}
