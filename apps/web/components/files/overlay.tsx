"use client";
import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** 居中弹层（上传 / 删除确认）。遮罩用 --inverse 实底 + 透明度（透明度只做遮罩，合规）。*/
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
    <div className="absolute inset-0 z-30 flex items-center justify-center p-4" data-testid={`${testid}-backdrop`}>
      <div className="absolute inset-0 bg-inverse/40" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-label={title}
        data-testid={testid}
        className={cn(
          "relative flex max-h-full flex-col overflow-hidden rounded-lg border border-border bg-card shadow-lg",
          width === "lg" ? "w-full max-w-2xl" : "w-full max-w-lg",
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border p-4 pb-3">
          <div className="min-w-0">
            <h2 className="text-16 font-semibold">{title}</h2>
            {subtitle && <p className="mt-0.5 text-12 text-muted-foreground">{subtitle}</p>}
          </div>
          <Button size="icon" variant="ghost" onClick={onClose} aria-label="关闭" data-testid={`${testid}-close`}>
            <X aria-hidden className="h-4 w-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-border p-3">{footer}</div>}
      </div>
    </div>
  );
}

/** 右侧抽屉（摄取进度 / 版本列表 / 复核）。不打断主界面，收进右下常驻（UC-22.2 R8）。*/
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
    <div className="absolute inset-0 z-30 flex justify-end" data-testid={`${testid}-backdrop`}>
      <div className="absolute inset-0 bg-inverse/30" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-label={title}
        data-testid={testid}
        className="relative flex h-full w-full max-w-md flex-col border-l border-border bg-card shadow-lg"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border p-4 pb-3">
          <div className="min-w-0">
            <h2 className="text-14 font-semibold">{title}</h2>
            {subtitle && <p className="mt-0.5 text-11 text-muted-foreground">{subtitle}</p>}
          </div>
          <Button size="icon" variant="ghost" onClick={onClose} aria-label="关闭" data-testid={`${testid}-close`}>
            <X aria-hidden className="h-4 w-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </aside>
    </div>
  );
}
