"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Building2, RefreshCw } from "lucide-react";
import { useSession } from "@/components/session/session-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import {
  listCanvasTemplates,
  TEMPLATE_STATUS_LABEL,
  TEMPLATE_VISIBILITY_LABEL,
  type CanvasTemplate,
  type TemplateStatus,
} from "@/lib/live-canvas";

/**
 * 后台 → 画布模板（`AssetKind.canvas-template`，左栏第 5 项，F132）。
 *
 * #464 起数据来自 `GET /canvas/templates` 的真实响应，不再从 `lib/mock/canvas` 取。
 * 这一屏仍然**只做清单与去向**：治理动作（发布 / 可见范围 / 归档）在模板库那一屏，
 * 后台这一项与那一屏是否合并属 Q-11，未裁 —— 只链过去，不搬也不复制。
 *
 * ⚠ 原先的 `AdminScreen` 七态预览壳已撤下：加载 / 空 / 失败三态现在由真实请求决定，
 *   一个能用 `?state=` 切出来的失败态与真实失败并存，会让人分不清屏上这句报错是谁说的。
 */

const STATUS_TONE: Record<TemplateStatus, "primary" | "warning" | "neutral" | "outline"> = {
  published: "primary",
  trial: "outline",
  draft: "warning",
  archived: "neutral",
};

type LoadState =
  | { readonly sourceKey: string; readonly status: "loading" }
  | { readonly sourceKey: string; readonly status: "error"; readonly message: string }
  | { readonly sourceKey: string; readonly status: "ready"; readonly rows: readonly CanvasTemplate[] };

export function CanvasTemplateScreen() {
  const { session, identity } = useSession();
  if (!session) throw new Error("CanvasTemplateScreen requires an authenticated session");
  const orgId = session.currentOrgId;
  const sourceKey = orgId;
  const generation = React.useRef(0);
  const currentSourceKey = React.useRef(sourceKey);
  currentSourceKey.current = sourceKey;
  const [state, setState] = React.useState<LoadState>({ sourceKey, status: "loading" });

  const load = React.useCallback(async () => {
    if (currentSourceKey.current !== sourceKey) return;
    const request = ++generation.current;
    setState({ sourceKey, status: "loading" });
    try {
      const out = await listCanvasTemplates({ orgId });
      if (request !== generation.current || currentSourceKey.current !== sourceKey) return;
      setState({ sourceKey, status: "ready", rows: out.templates });
    } catch (error) {
      if (request !== generation.current || currentSourceKey.current !== sourceKey) return;
      // 读取失败**不得**画成空目录。
      setState({ sourceKey, status: "error", message: describeError(error) });
    }
  }, [orgId, sourceKey]);

  React.useEffect(() => {
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  const visibleState: LoadState = state.sourceKey === sourceKey ? state : { sourceKey, status: "loading" };
  const rows = visibleState.status === "ready" ? visibleState.rows : [];

  return (
    <div className="flex flex-col gap-5 p-6" data-testid="admin-canvasadmin-screen">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-inverse text-inverse-foreground">
            <Building2 aria-hidden className="h-4 w-4" />
          </span>
          <div className="flex flex-col">
            <span className="text-14 font-semibold">{identity?.org.name ?? orgId}</span>
            <span className="font-mono text-10 text-muted-foreground">组织 ID {orgId}</span>
          </div>
          <Badge tone="outline">画布模板</Badge>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void load()}
          disabled={visibleState.status === "loading"}
          data-testid="admin-canvasadmin-refresh"
        >
          <RefreshCw aria-hidden className="h-3.5 w-3.5" /> 刷新
        </Button>
      </header>

      <p className="text-13 text-muted-foreground">
        画布模板是六种 AI 能力资产之一，和 Agent / Skill 走同一套治理：谁能用、出问题谁负责、
        什么时候重新检查。这里是后台侧的清单与去向；分区结构与围栏语法在模板编辑器里改。
      </p>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3">
          <p className="text-12 text-muted-foreground">
            分区结构、围栏语法与版本历史在模板编辑器里改。后台这一项与那一屏是否合并，属 Q-11，待人类裁决。
          </p>
          <Link
            href="/canvas?screen=template-admin"
            data-testid="admin-canvasadmin-open-editor"
            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-12 transition-colors duration-200 hover:bg-muted"
          >
            打开模板库与编辑器
            <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
          </Link>
        </CardContent>
      </Card>

      {visibleState.status === "loading" && (
        <p className="text-12 text-muted-foreground" data-testid="admin-canvasadmin-loading">正在读取模板注册表…</p>
      )}

      {visibleState.status === "error" && (
        <div
          className="flex flex-col items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4"
          data-testid="admin-canvasadmin-error"
          role="alert"
        >
          <p className="text-13 font-medium text-destructive">读取模板注册表失败</p>
          <p className="font-mono text-11 text-destructive">{visibleState.message}</p>
          <Button size="xs" variant="outline" onClick={() => void load()} data-testid="admin-canvasadmin-retry">重试</Button>
        </div>
      )}

      {visibleState.status === "ready" && rows.length === 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-dashed border-border p-6" data-testid="admin-canvasadmin-empty">
          <p className="text-13 font-medium">本组织还没有画布模板</p>
          <p className="text-11 text-muted-foreground">
            这是服务端的真实结果。模板的创建入口尚未在已签契约里存在（见 issue #464），此处不显示任何示例模板。
          </p>
        </div>
      )}

      {visibleState.status === "ready" && rows.length > 0 && (
        <ul className="flex flex-col gap-1.5" data-testid="admin-canvasadmin-list">
          {rows.map((t) => (
            <li key={`${t.key}-${t.version}`}>
              <Card>
                <CardContent className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-3">
                  <span className="text-13 font-medium">{t.displayName}</span>
                  <Badge tone={STATUS_TONE[t.status]}>{TEMPLATE_STATUS_LABEL[t.status]}</Badge>
                  <Badge tone="outline">v{t.version}</Badge>
                  <Badge tone="neutral">{TEMPLATE_VISIBILITY_LABEL[t.visibility]}</Badge>
                  <span className="text-11 text-muted-foreground">
                    {t.underlyingType} · {t.sections.length} 分区
                  </span>
                  <span className="ml-auto text-11 text-muted-foreground">被 {t.usageCount} 场使用</span>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 后端真实信封原样回显：`reasonCode` + HTTP 状态。 */
function describeError(error: unknown): string {
  if (error instanceof ApiError) return `${error.reasonCode ?? "无 reasonCode"}（HTTP ${error.status}）`;
  if (error instanceof Error) return error.message;
  return "未知错误";
}
