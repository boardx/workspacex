"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Building2, RefreshCw } from "lucide-react";
import { useSession } from "@/components/session/session-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { currentOrganizationLabel } from "@/lib/org-display";
import {
  listCanvasTemplates,
  TEMPLATE_STATUS_LABEL,
  TEMPLATE_VISIBILITY_LABEL,
  type CanvasTemplate,
  type TemplateStatus,
} from "@/lib/live-canvas";

/**
 * ⚠ 已退役（2026-08-15，人类直接裁决真合并，D-43，推翻 D-42 ⑤）——后台「画布模板」
 * 与「画布模板库与编辑器」（`template-admin.tsx`）已真合并成一个屏：`ADMIN_NAV` 的
 * `canvasadmin` 项 href 直接指向 `/canvas?screen=template-admin`，`/admin/canvasadmin`
 * 这条路由现在是重定向桩（见 `apps/web/app/admin/[module]/page.tsx` 的 `REDIRECTS`）。
 * Q-11 已解除阻塞——不再是「只链过去，不搬也不复制」的过渡态，见
 * `phases/requirements/DECISIONS-FINAL.md` D-43。
 *
 * 本组件不再被任何路由引用，保留文件是为了留痕（同类先例：
 * `components/admin/blueprint-screen.tsx` 在项目模板收敛后同样保留不删）。
 *
 * ## 历史背景（原注释，保留留痕）
 *
 * 后台 → 画布模板（`AssetKind.canvas-template`，左栏第 5 项，F132）。
 *
 * #464 起数据来自 `GET /canvas/templates` 的真实响应，不再从 `lib/mock/canvas` 取。
 * 这一屏曾经**只做清单与去向**：治理动作（发布 / 可见范围 / 归档）在模板库那一屏，
 * 后台这一项与那一屏是否合并属 Q-11——这个问题现在已经由 D-43 解除。
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
            {/* #596：身份未就绪时显示加载态，**不拿 orgId 冒充组织名** —— 下一行本来就单独列了组织 ID。 */}
            <span className="text-14 font-semibold">{currentOrganizationLabel(identity?.org.name)}</span>
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
            分区结构、围栏语法与版本历史在模板编辑器里改。后台这一项与那一屏已真合并（D-43），本屏已退役。
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
            这是服务端的真实结果，此处不显示任何示例模板。新建入口在模板库那一屏（下方链接），
            后台这一项只做清单与去向 —— 不在两处各放一个创建按钮。
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
