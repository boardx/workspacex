"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * 居中弹层（上传 / 删除确认）—— F01 迁移：内部改用 `components/ui/dialog.tsx`
 * （即 Radix Dialog），调用方 props 不变（title/subtitle/onClose/children/footer/testid/width）。
 * 拿到的是统一的 Esc 关闭 / 点遮罩关闭 / Tab 焦点陷阱 / 深色模式，不用每个调用方各自补。
 */
export function Modal({
  title, subtitle, onClose, children, footer, testid, width = "md",
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  testid: string;
  width?: "md" | "lg";
}) {
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        data-testid={testid}
        closeTestId={`${testid}-close`}
        className={cn(
          "flex max-h-[85vh] flex-col gap-0 p-0",
          width === "lg" ? "max-w-2xl" : "max-w-lg",
        )}
      >
        <DialogHeader className="gap-0.5 border-b border-border p-4 pb-3">
          <DialogTitle>{title}</DialogTitle>
          {subtitle && <DialogDescription>{subtitle}</DialogDescription>}
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <DialogFooter className="mt-0 border-t border-border p-3">{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}

/**
 * 右侧抽屉（摄取进度 / 版本列表 / 复核）。不打断主界面，收进右下常驻（UC-22.2 R8）。
 * 同样改用 Radix Dialog——只是把内容定位从「居中卡片」覆写成「贴右满高面板」，
 * Esc / 焦点陷阱等行为与 Modal 完全一致（这正是 F01 要收敛的：全站弹层观感统一）。
 */
export function Drawer({
  title, subtitle, onClose, children, testid,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  testid: string;
}) {
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        data-testid={testid}
        closeTestId={`${testid}-close`}
        className={cn(
          "inset-y-0 left-auto right-0 top-auto h-full max-h-full w-full max-w-md",
          "translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-y-0 border-r-0 p-0",
        )}
      >
        <DialogHeader className="gap-0.5 border-b border-border p-4 pb-3">
          <DialogTitle className="text-14">{title}</DialogTitle>
          {subtitle && <DialogDescription className="text-11">{subtitle}</DialogDescription>}
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
