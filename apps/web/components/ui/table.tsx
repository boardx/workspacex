import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Table —— 契约束 interaction-primitives（F09）复合组件之一。
 *
 * 盘点结论（2026-08-24）：19 处业务目录手写 `<table>`，逐一读过全部之后，形状高度一致
 * （thead/tr 一行表头 + tbody/tr 数据行 + 可选 colSpan 空态行/展开行），没有发现语义分裂到
 * 需要拆成两个原语的地步（唯一的「设置项 key-value」候选场景实际也是同一套 table 语义，
 * 只是列数少）——因此收口为一套原语，不强行拆分。
 *
 * 设计取舍：本文件只贴**默认** token（间距/字号/边框色），不强加 `text-align`——
 * Tailwind preflight 已把 `th`/`td` 的 `text-align` reset 为 `inherit`，业务目录里少数
 * 表格依赖这个继承值做非左对齐表头（如 knowledge-backflow.tsx 的热力矩阵），本原语的默认值
 * 与之前手写标签在视觉上完全等价，可安全整体替换标签名而不改变任何 class 组合。
 * `cn()` 用 tailwind-merge，调用方传入的 className 总能覆盖本文件的默认值。
 *
 * 未做「可排序表头」：盘点这 19 处全部是静态渲染或点击整行，没有一处点表头排序的真实用法，
 * 现在加排序变体是为了「看起来做了事」而不是回应真实需求（R4-A1）——需要时再加。
 */
export const Table = React.forwardRef<HTMLTableElement, React.TableHTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <table ref={ref} className={cn("w-full border-collapse text-12", className)} {...props} />
  ),
);
Table.displayName = "Table";

export const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => <thead ref={ref} className={className} {...props} />);
TableHeader.displayName = "TableHeader";

export const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <tbody ref={ref} className={className} {...props} />,
);
TableBody.displayName = "TableBody";

export const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement> & { variant?: "header" | "body" }
>(({ className, variant = "body", ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      variant === "header"
        ? "border-b border-border bg-panel text-left text-11 text-muted-foreground"
        : "border-b border-border-subtle transition-colors duration-base last:border-b-0",
      className,
    )}
    {...props}
  />
));
TableRow.displayName = "TableRow";

export const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th ref={ref} className={cn("px-3 py-2 text-left font-medium", className)} {...props} />
  ),
);
TableHead.displayName = "TableHead";

export const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => <td ref={ref} className={cn("px-3 py-2", className)} {...props} />,
);
TableCell.displayName = "TableCell";

export const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn("mt-2 text-11 text-muted-foreground", className)} {...props} />
));
TableCaption.displayName = "TableCaption";

/** 共享空态行——`colSpan` 需传总列数；一行居中文案，替代业务目录里各自写的 `<tr><td colSpan>`。 */
export function TableEmpty({
  colSpan,
  children,
  className,
  "data-testid": testId,
}: {
  colSpan: number;
  children: React.ReactNode;
  className?: string;
  "data-testid"?: string;
}) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className={cn("px-3 py-6 text-center text-11 text-muted-foreground", className)}
        data-testid={testId}
      >
        {children}
      </td>
    </tr>
  );
}
