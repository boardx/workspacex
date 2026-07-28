"use client";
import * as React from "react";
import { X, AlertTriangle, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * 后台共用叠层原语 —— 让「配置 / 看工具 / 查看调用链 / 注册…」这些按钮点开有真东西。
 *
 * ⚠ 已有原型只画按钮不接线（死控件）。这里把面板、危险动作二次确认、乐观反馈三件套
 *   收敛成可复用件，各屏只写内容，不各自重造一套叠层。
 * 定位用 `fixed inset-0`：后台屏本身不是 relative 全高容器（不同于文件浏览器）。
 * 遮罩用 --inverse 实底 + 透明度（透明度只做遮罩，合规）。
 */

export function AdminModal({
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" data-testid={`${testid}-backdrop`}>
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

export function AdminDrawer({
  title, subtitle, onClose, children, footer, testid,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  testid: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end" data-testid={`${testid}-backdrop`}>
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
        {footer && <div className="flex items-center justify-end gap-2 border-t border-border p-3">{footer}</div>}
      </aside>
    </div>
  );
}

/**
 * 危险动作二次确认（批准发布 / 放行评审 / 解除 legal hold / 撤销删除）。
 * 不是孤零零的红按钮：列出影响范围 + 可选强制填理由（写审计）。
 */
export function ConfirmDialog({
  title, testid, impact, confirmLabel, tone = "primary",
  requireReason = false, reasonPlaceholder, onCancel, onConfirm,
}: {
  title: string;
  testid: string;
  impact: React.ReactNode;
  confirmLabel: string;
  tone?: "primary" | "destructive";
  requireReason?: boolean;
  reasonPlaceholder?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [reason, setReason] = React.useState("");
  const canConfirm = !requireReason || reason.trim().length >= 4;
  return (
    <AdminModal
      testid={testid}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onCancel} data-testid={`${testid}-cancel`}>取消</Button>
          <Button
            size="sm"
            variant={tone}
            disabled={!canConfirm}
            onClick={onConfirm}
            data-testid={`${testid}-confirm`}
            title={canConfirm ? undefined : "填写理由后才可确认"}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-3">
          <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="min-w-0 text-12">{impact}</div>
        </div>
        {requireReason && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${testid}-reason`} className="text-12 font-medium">理由（必填，写入审计）</label>
            <textarea
              id={`${testid}-reason`}
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.currentTarget.value)}
              placeholder={reasonPlaceholder}
              data-testid={`${testid}-reason`}
              className="rounded-md border border-border bg-card px-2.5 py-1.5 text-12 text-card-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        )}
      </div>
    </AdminModal>
  );
}

/**
 * 乐观反馈行（导出 / 生成报告等）。role="status" 让人（与读屏器）看到「动作被接住了」。
 * ⚠ 这不是 StateShell 的 `saved`（那是七态之一）；这是默认态里动作的即时确认。
 */
export function Toast({
  message, testid, onDismiss,
}: {
  message: string | null;
  testid: string;
  onDismiss: () => void;
}) {
  React.useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDismiss, 5000);
    return () => clearTimeout(t);
  }, [message, onDismiss]);
  if (!message) return null;
  return (
    <div
      role="status"
      data-testid={testid}
      className="fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-2 rounded-lg border border-border bg-card p-3 shadow-lg"
    >
      <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-success" />
      <p className="text-12">{message}</p>
      <Button size="icon" variant="ghost" onClick={onDismiss} aria-label="关闭提示" data-testid={`${testid}-close`}>
        <X aria-hidden className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

/** 后台面板里的通用文本输入（成对 bg+fg、焦点环、禁用态 token）。app/ 层才强制用 components/ui，此处在 components/ 内。 */
export function Field({
  label, id, ...props
}: { label: string; id: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-11 font-medium text-muted-foreground">{label}</label>
      <input
        id={id}
        className="h-8 rounded-md border border-border bg-card px-2.5 text-12 text-card-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-disabled disabled:text-disabled-foreground"
        {...props}
      />
    </div>
  );
}

/** 键值只读行（看定义 / 看配置 / 调用链用）。 */
export function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 py-1">
      <span className="w-24 shrink-0 text-11 text-muted-foreground">{k}</span>
      <span className="min-w-0 flex-1 text-12">{v}</span>
    </div>
  );
}
