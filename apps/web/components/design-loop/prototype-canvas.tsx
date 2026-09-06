"use client";
/**
 * UC-17.8 B5.3 —— 原型画布：把契约 `designPrototype.PrototypeNode` 组件树渲染成手机屏。
 *
 * 只读渲染，没有编辑态——「整页重生成」这一轮的画布由左栏对话驱动，用户改画布的唯一入口
 * 是再说一句话。增量修改（节点级）是下一轮，届时在这里挂选中态。
 *
 * 颜色/圆角/字号全走 `.dark` token（`app/globals.css`），不写字面量——`lint-design.sh` U5/U11 门控。
 * 渲染表按 `PrototypeNodeType` 穷举：契约加了新原语这里编译不过，不会静默渲染成空。
 */
import * as React from "react";
import { Check, Circle, ImageIcon, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PrototypeNode } from "@/lib/live-design-workbench";

const GAP: Record<"none" | "sm" | "md" | "lg", string> = { none: "gap-0", sm: "gap-1", md: "gap-2", lg: "gap-4" };
const PAD: Record<"none" | "sm" | "md" | "lg", string> = { none: "p-0", sm: "p-1", md: "p-2", lg: "p-4" };
const SPACE: Record<"none" | "sm" | "md" | "lg", string> = { none: "h-0", sm: "h-1", md: "h-3", lg: "h-6" };
const ALIGN: Record<"start" | "center" | "end" | "between", string> = {
  start: "items-start justify-start", center: "items-center justify-center", end: "items-end justify-end", between: "items-center justify-between",
};
const TEXT_VARIANT: Record<"title" | "subtitle" | "body" | "caption" | "label", string> = {
  title: "text-16 font-semibold", subtitle: "text-13 font-medium", body: "text-12", caption: "text-10", label: "text-10 font-medium uppercase tracking-wide",
};
const BUTTON_VARIANT: Record<"primary" | "secondary" | "ghost" | "danger", string> = {
  primary: "bg-primary text-primary-foreground",
  secondary: "bg-panel text-panel-foreground border border-border",
  ghost: "text-muted-foreground",
  danger: "bg-destructive text-destructive-foreground",
};
const BADGE_TONE: Record<"neutral" | "info" | "success" | "warning" | "danger", string> = {
  neutral: "bg-panel text-panel-foreground",
  info: "bg-primary/20 text-primary",
  success: "bg-success/20 text-success",
  warning: "bg-warning/20 text-warning",
  danger: "bg-destructive/20 text-destructive",
};
const RATIO: Record<"square" | "video" | "wide" | "portrait", string> = { square: "aspect-square", video: "aspect-video", wide: "aspect-[3/1]", portrait: "aspect-[3/4]" };

function Node({ node }: { node: PrototypeNode }): React.ReactElement {
  switch (node.type) {
    case "stack": {
      const p = node.props ?? {};
      return (
        <div
          className={cn(
            "flex min-h-0", p.direction === "row" ? "flex-row" : "flex-col",
            GAP[p.gap ?? "sm"], PAD[p.padding ?? "none"],
            // 未指定 align：纵向拉伸子项占满宽度（手机屏里的行天然通栏），横向居中对齐。
            p.align !== undefined ? ALIGN[p.align] : p.direction === "row" ? "items-center" : "items-stretch",
            p.fill === true && "flex-1 overflow-y-auto",
            // 横向排布里输入框吃掉剩余宽度（消息输入区那种「输入框 + 按钮」），按钮等保持内容宽。
            p.direction === "row" && "[&>*]:min-w-0 [&>[data-proto=input]]:flex-1",
          )}
          data-proto="stack"
        >
          {node.children.map((c, i) => <Node key={i} node={c} />)}
        </div>
      );
    }
    case "card":
      return (
        <div className="flex flex-col gap-1.5 rounded-card border border-border bg-panel p-2" data-proto="card">
          {node.props?.title !== undefined && <p className="text-12 font-medium">{node.props.title}</p>}
          {node.children.map((c, i) => <Node key={i} node={c} />)}
        </div>
      );
    case "navbar":
      return (
        <div className="flex h-9 items-center justify-between border-b border-border px-1 text-12" data-proto="navbar">
          <span className="w-10 truncate text-muted-foreground">{node.props.left ?? ""}</span>
          <span className="truncate font-semibold">{node.props.title}</span>
          <span className="w-10 truncate text-right text-primary">{node.props.right ?? ""}</span>
        </div>
      );
    case "text": {
      const p = node.props;
      return (
        <p
          className={cn("whitespace-pre-wrap break-words", TEXT_VARIANT[p.variant ?? "body"], p.muted === true && "text-muted-foreground",
            p.align === "center" && "text-center", p.align === "end" && "text-right")}
          data-proto="text"
        >
          {p.content}
        </p>
      );
    }
    case "button": {
      const p = node.props;
      return (
        <span
          className={cn("inline-flex h-8 shrink-0 items-center justify-center rounded-control px-3 text-12 font-medium", BUTTON_VARIANT[p.variant ?? "primary"], p.full === true && "w-full")}
          data-proto="button"
        >
          {p.label}
        </span>
      );
    }
    case "input": {
      const p = node.props;
      return (
        <div className="flex w-full flex-col gap-1" data-proto="input">
          {p.label !== undefined && <span className="text-10 text-muted-foreground">{p.label}</span>}
          <div className={cn("w-full rounded-control border border-input bg-background px-2 text-12", p.multiline === true ? "min-h-14 py-1.5" : "flex h-8 items-center")}>
            {p.value !== undefined && p.value !== "" ? <span className="truncate">{p.value}</span> : <span className="truncate text-muted-foreground">{p.placeholder ?? ""}</span>}
          </div>
        </div>
      );
    }
    case "image":
      return (
        <div className={cn("flex w-full items-center justify-center rounded-control bg-panel text-muted-foreground", RATIO[node.props.ratio ?? "video"])} data-proto="image" aria-label={node.props.alt}>
          <ImageIcon aria-hidden className="h-4 w-4" />
          <span className="sr-only">{node.props.alt}</span>
        </div>
      );
    case "list": {
      const lead = node.props.leading ?? "dot";
      return (
        <ul className="flex w-full flex-col divide-y divide-border" data-proto="list">
          {node.props.items.map((item, i) => (
            <li key={i} className="flex items-center gap-2 py-1.5 text-12">
              {lead === "dot" && <Circle aria-hidden className="h-1.5 w-1.5 shrink-0 fill-current text-muted-foreground" />}
              {lead === "check" && <Check aria-hidden className="h-3 w-3 shrink-0 text-success" />}
              {lead === "avatar" && <span aria-hidden className="h-5 w-5 shrink-0 rounded-full bg-panel" />}
              <span className="truncate">{item}</span>
            </li>
          ))}
        </ul>
      );
    }
    case "divider":
      return <hr className="w-full border-border" data-proto="divider" />;
    case "spacer":
      return <div aria-hidden className={cn("w-full shrink-0", SPACE[node.props?.size ?? "md"])} data-proto="spacer" />;
    case "tabs": {
      const active = node.props.active ?? 0;
      return (
        <div className="flex w-full gap-1 border-b border-border text-11" data-proto="tabs">
          {node.props.items.map((t, i) => (
            <span key={i} className={cn("px-2 pb-1", i === active ? "border-b-2 border-primary font-medium" : "text-muted-foreground")}>{t}</span>
          ))}
        </div>
      );
    }
    case "badge":
      return <span className={cn("inline-flex shrink-0 rounded-full px-1.5 py-0.5 text-10", BADGE_TONE[node.props.tone ?? "neutral"])} data-proto="badge">{node.props.label}</span>;
    case "avatar":
      return (
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-panel text-10 font-medium" data-proto="avatar" title={node.props.name}>
          {node.props.name.slice(0, 1)}
        </span>
      );
  }
}

/** 居中手机屏：有树渲染树；没有（还没生成）显示占位块，与 B4.5 之前的外观一致。 */
export function PrototypeCanvas({ label, root }: { label: string; root: PrototypeNode | null }) {
  return (
    <div className="flex h-[560px] w-[300px] flex-col rounded-container border border-border bg-card shadow-lg" data-testid="design-detail-phone">
      <div className="flex items-center justify-center gap-1 border-b border-border py-1.5 text-10 text-muted-foreground">
        <Smartphone aria-hidden className="h-3 w-3" /> {label}
      </div>
      {root === null ? (
        <div className="flex flex-1 flex-col gap-2 p-3" data-testid="design-detail-phone-placeholder">
          <div className="h-8 rounded-control bg-panel" aria-hidden />
          <div className="h-20 rounded-control bg-panel" aria-hidden />
          <div className="h-3 w-3/4 rounded-control bg-panel" aria-hidden />
          <div className="h-3 w-1/2 rounded-control bg-panel" aria-hidden />
          <p className="mt-auto text-center text-11 text-muted-foreground">还没有原型。在左边描述你要的界面，我会直接画出来。</p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2 text-card-foreground [&>*]:min-h-0 [&>[data-proto=stack]]:flex-1" data-testid="design-detail-phone-tree">
          <Node node={root} />
        </div>
      )}
    </div>
  );
}
