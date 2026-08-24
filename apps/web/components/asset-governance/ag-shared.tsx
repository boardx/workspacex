"use client";
import * as React from "react";
import { Lock, AlertTriangle, FileText, FileCode, FileJson, Folder } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { assetFileBadgeFromPath } from "@repo/contracts/asset-governance";
import {
  AG_VIEWS, GATE_VERDICT_LABEL, type AgView, type GateVerdict, type FileNode,
} from "@/lib/mock/asset-governance";

/** 屏标题 —— 统一节奏（对齐已确认原型的间距与字号档位）。 */
export function ScreenHead({
  title, uc, children, actions,
}: {
  title: string;
  uc: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2" data-testid="ag-screen-head">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-20 font-semibold tracking-tight text-foreground">{title}</h1>
          <Badge tone="outline">{uc}</Badge>
        </div>
        {children && <p className="text-12 text-muted-foreground">{children}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * 后台投影门 —— 普通成员切到本屏时，渲染**可理解**的投影说明（不是空白）。
 *
 * ⚠ 与七态里的 `denied` 不同：那是「服务端拒绝了这次请求」的状态；
 *   这里是「切到普通成员预览视角时，后台本就不该出现」的投影。testid 用
 *   `ag-role-denied` 以免与保留名 `denied` 混淆。真实权限一律在服务端。
 */
export function BackstageGate({
  view, what, children,
}: {
  view: AgView;
  what: string;
  children: React.ReactNode;
}) {
  if (view !== "member") return <>{children}</>;
  const label = AG_VIEWS.find((v) => v.id === view)?.label ?? view;
  return (
    <div
      data-testid="ag-role-denied"
      role="note"
      className="flex flex-col items-center gap-3 rounded-lg border border-border bg-muted py-12 text-center"
    >
      <Lock aria-hidden className="h-6 w-6 text-muted-foreground" />
      <div className="flex flex-col gap-1">
        <p className="text-13 font-medium">当前视角「{label}」看不到{what}</p>
        <p className="mx-auto max-w-md text-11 leading-relaxed text-muted-foreground">
          后台资产治理是组织级职能。这是视角投影（预览手段），不是权限实现——真实权限在服务端
          NestJS Guard + PostgreSQL RLS；接口对越权者不返回该资源的存在性。普通成员只在项目里
          用到已发布的资产。
        </p>
      </div>
    </div>
  );
}

const VERDICT_TONE: Record<GateVerdict, { badge: string; dot: string }> = {
  pass: { badge: "text-success", dot: "bg-success" },
  hint: { badge: "text-warning", dot: "bg-warning" },
  block: { badge: "text-destructive", dot: "bg-destructive" },
  running: { badge: "text-ai", dot: "bg-ai" },
  locked: { badge: "text-muted-foreground", dot: "bg-muted-foreground" },
};

/** 三级结论徽标（通过 / 提示 / 阻断 / 进行中 / 待开放）。 */
export function VerdictBadge({ verdict }: { verdict: GateVerdict }) {
  const t = VERDICT_TONE[verdict];
  return (
    <span className={cn("inline-flex items-center gap-1 font-mono text-10", t.badge)} data-testid="ag-gate-verdict">
      <span className={cn("h-1.5 w-1.5 rounded-full", t.dot)} aria-hidden />
      {GATE_VERDICT_LABEL[verdict]}
    </span>
  );
}

/** 进度条（颜色随完成度；供蓝本列表与向导步骤复用）。 */
export function Meter({
  value, max, tone, testid,
}: {
  value: number;
  max: number;
  tone: "success" | "warning" | "danger" | "primary";
  testid?: string;
}) {
  const pct = Math.round((value / max) * 100);
  const fill = {
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-destructive",
    primary: "bg-primary",
  }[tone];
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" data-testid={testid}>
      <div className={cn("h-full rounded-full transition-all", fill)} style={{ width: `${pct}%` }} />
    </div>
  );
}

const FILE_ICON: Record<FileNode["kind"], React.ComponentType<{ className?: string }>> = {
  md: FileText,
  py: FileCode,
  json: FileJson,
  yaml: FileCode,
  canvas: FileText,
};

/**
 * 文件树 —— 目录/文件两级，选中项高亮。
 * 底部规则逐字：右键改名／删除 · 目录结构就是发布出去的结构。
 */
export function FileTree({
  files, selected, onSelect, testidPrefix,
}: {
  files: FileNode[];
  selected: string;
  onSelect: (path: string) => void;
  testidPrefix: string;
}) {
  // 把扁平 path 归到目录分组，仅用于展示层级
  const rows: {
    type: "dir" | "file";
    name: string;
    path?: string;
    size?: string;
    kind?: FileNode["kind"];
    /** 契约 `AssetFileBadge`——由扩展名派生（`assetFileBadgeFromPath`），未知扩展名 ⇒ MD，不报错 */
    badge?: string;
    depth: number;
  }[] = [];
  const seenDir = new Set<string>();
  for (const f of files) {
    const parts = f.path.split("/");
    const badge = assetFileBadgeFromPath(f.path);
    if (parts.length > 1) {
      const dir = parts[0]!;
      if (!seenDir.has(dir)) {
        seenDir.add(dir);
        rows.push({ type: "dir", name: `${dir}/`, depth: 0 });
      }
      rows.push({ type: "file", name: parts.slice(1).join("/"), path: f.path, size: f.size, kind: f.kind, badge, depth: 1 });
    } else {
      rows.push({ type: "file", name: f.path, path: f.path, size: f.size, kind: f.kind, badge, depth: 0 });
    }
  }
  return (
    <div className="flex flex-col gap-1" data-testid={`${testidPrefix}-tree`}>
      {rows.map((r, i) => {
        if (r.type === "dir") {
          return (
            <div
              key={`d-${i}`}
              data-testid={`${testidPrefix}-dir`}
              className="flex items-center gap-1.5 px-2 py-1 text-10 font-medium text-muted-foreground"
            >
              <Folder aria-hidden className="h-3 w-3" />
              {r.name}
            </div>
          );
        }
        const Icon = FILE_ICON[r.kind ?? "md"];
        const on = selected === r.path;
        return (
          <button
            key={r.path}
            type="button"
            onClick={() => onSelect(r.path!)}
            data-testid={`${testidPrefix}-file`}
            className={cn(
              "flex items-center justify-between gap-2 rounded-md border-l-2 px-2 py-1 text-left font-mono text-11 transition-colors",
              r.depth ? "ml-3 pl-2.5" : "",
              on
                ? "border-primary bg-accent text-accent-foreground"
                : "border-transparent text-muted-foreground hover:bg-muted",
            )}
          >
            <span className="flex items-center gap-1.5 truncate">
              <Icon aria-hidden className="h-3 w-3 shrink-0" />
              <span className="truncate">{r.name}</span>
              <span
                className="shrink-0 rounded border border-border-subtle px-1 font-mono text-9 text-muted-foreground"
                data-testid={`${testidPrefix}-file-badge`}
              >
                {r.badge}
              </span>
            </span>
            <span className="shrink-0 text-9 text-muted-foreground" data-testid={`${testidPrefix}-file-size`}>{r.size}</span>
          </button>
        );
      })}
      <p className="mt-1 border-t border-border-subtle px-2 pt-2 text-9 leading-relaxed text-muted-foreground">
        右键改名／删除 · 目录结构就是发布出去的结构
      </p>
    </div>
  );
}

/** 简易代码/Markdown 查看器（带行号）。 */
export function CodeView({ body, testid }: { body: string; testid?: string }) {
  const lines = body.split("\n");
  return (
    <div className="overflow-auto rounded-lg border border-border bg-card" data-testid={testid}>
      <pre className="flex flex-col py-2 font-mono text-11 leading-relaxed">
        {lines.map((ln, i) => (
          <div key={i} className="flex gap-3 px-3 transition-colors hover:bg-muted">
            <span className="w-6 shrink-0 select-none text-right text-9 text-muted-foreground">{i + 1}</span>
            <span className="whitespace-pre text-card-foreground">{ln || " "}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}

/**
 * 危险动作二次确认 —— 删除 / 发布 / 放弃导入 / 灰度发布 等。
 *
 * ⚠ R8：危险动作不做成孤零零的红按钮。点第一下展开**影响范围说明** + 二次确认，
 *   再点确认才生效。此处是原型，确认只切本地态。
 */
export function DangerConfirm({
  trigger, impact, confirmLabel, danger = true, testid, onConfirm, disabled = false,
}: {
  trigger: string;
  impact: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  testid: string;
  /**
   * #881：真正执行这个动作。
   *
   * ⚠ **不传 = 原型态**（点确认只在本地显示「已执行（原型态，仅本地）」）——
   * 这是本文件其余调用点今天的状态，保持不变。传了 = 真的打接口，
   * 成功/失败都如实显示，**失败时不显示「已执行」**。
   * 之所以做成可选而不是必填：一次把十几个原型按钮都接上，等于把一个 PR 变成十个。
   */
  onConfirm?: () => Promise<void>;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2" data-testid={testid}>
      <Button
        type="button"
        size="sm"
        variant={danger ? "destructive" : "primary"}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid={`${testid}-trigger`}
      >
        {trigger}
      </Button>
      {open && !done && (
        <div
          role="alertdialog"
          aria-label={`确认 ${trigger}`}
          className={cn(
            "flex flex-col gap-2 rounded-lg border p-3",
            danger ? "border-destructive/30 bg-destructive/5" : "border-warning/30 bg-warning/5",
          )}
          data-testid={`${testid}-impact`}
        >
          <div className="flex items-start gap-2">
            <AlertTriangle aria-hidden className={cn("mt-0.5 h-4 w-4 shrink-0", danger ? "text-destructive" : "text-warning")} />
            <div className="flex flex-col gap-1 text-11 leading-relaxed text-foreground">{impact}</div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={danger ? "destructive" : "primary"}
              disabled={busy || disabled}
              onClick={() => {
                if (onConfirm === undefined) { setDone(true); return; }
                setBusy(true);
                setFailure(null);
                void onConfirm()
                  // ⚠ 只有真的成功才置 done —— 失败仍显示「已执行」是本仓最忌讳的假成功。
                  .then(() => { setDone(true); })
                  .catch((e: unknown) => { setFailure(e instanceof Error ? e.message : String(e)); })
                  .finally(() => { setBusy(false); });
              }}
              data-testid={`${testid}-confirm`}
            >
              {busy ? "提交中…" : confirmLabel}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} data-testid={`${testid}-cancel`}>
              取消
            </Button>
          </div>
        </div>
      )}
      {failure !== null && (
        <p className="text-11 text-destructive" data-testid={`${testid}-error`}>{failure}</p>
      )}
      {done && (
        <p className="inline-flex items-center gap-1 text-11 text-success" data-testid={`${testid}-done`}>
          {/* 接了真实动作就不能再自称「原型态」——那句话本身会变成假话。 */}
          {onConfirm === undefined ? "已执行（原型态，仅本地）" : "已保存为新版本"}
        </p>
      )}
    </div>
  );
}

/** 卡片外框 —— 与原型卡片一致的圆角/描边/内距。 */
export function Panel({
  className, children, testid, ...rest
}: React.HTMLAttributes<HTMLDivElement> & { testid?: string }) {
  return (
    <div
      data-testid={testid}
      className={cn("rounded-lg border border-border bg-card p-3", className)}
      {...rest}
    >
      {children}
    </div>
  );
}
