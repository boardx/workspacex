"use client";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { AdminScreen } from "./admin-screen";
import { NoBackendNotice } from "./no-backend-notice";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AG_BLUEPRINTS, AG_PRODUCT_VALUES, blueprintProgressTone } from "@/lib/mock/asset-governance";
import type { UiState } from "@/lib/ui-state";

/**
 * ⚠ 已退役（2026-08-11，人类直接裁决真合并）——后台「项目蓝本」已改名「项目模板」，
 * `ADMIN_NAV` 的 `blueprint` 项 href 直接指向 `/tpl`（蓝本设计器本体），`/admin/blueprint`
 * 这条路由现在是重定向桩（见 `apps/web/app/admin/[module]/page.tsx` 的 `REDIRECTS`）。
 * Q-11/X-J 已解除阻塞——不再是「只链过去，不搬也不复制」的过渡态。
 *
 * 本组件不再被任何路由引用，保留文件是为了留痕（同类先例：
 * `components/studio/prototype-screen` 在 `/canvas` 收敛后同样保留不删）。
 *
 * ## 历史背景（原注释，保留留痕）
 *
 * 「为什么在管理后台看不到项目蓝本」——因为左栏根本没画它，`/admin/blueprint` 是 404，
 * 而蓝本设计器住在另一条路由 `/tpl`。F132 补的是**左栏项集合**；这一屏曾是它的落点。
 */
const TONE: Record<"success" | "warning" | "danger", "primary" | "warning" | "danger"> = {
  success: "primary",
  warning: "warning",
  danger: "danger",
};

export function BlueprintScreen({ state }: { state: UiState }) {
  const total = AG_PRODUCT_VALUES.blueprintTotalSegments.value;
  return (
    <AdminScreen
      state={state}
      moduleLabel="项目蓝本"
      title="项目蓝本"
      noticeOverride={<NoBackendNotice />}
      intro="项目蓝本是六种 AI 能力资产之一，和 Agent / Skill 走同一套治理：谁能用、出问题谁负责、什么时候重新检查。这里是后台侧的清单与去向；环节骨架与三角色任务在蓝本设计器里改。"
      emptyHint="本组织还没有项目蓝本"
      depFailure="蓝本库读取失败，无法列出项目蓝本。"
      denialReason="项目蓝本的后台管理仅组织管理员与能力维护者可见。"
      successMessage="项目蓝本清单已刷新"
    >
      <div className="flex flex-col gap-4" data-testid="admin-blueprint-screen">
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3">
            <p className="text-12 text-muted-foreground">
              环节骨架、三角色任务与默认配置在蓝本设计器里改（`templates` 束已签核并建成）。
              后台这一项与 /tpl 是否合并，属 Q-11 / X-J，待人类裁决。
            </p>
            <Link
              href="/tpl"
              data-testid="admin-blueprint-open-designer"
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-12 transition-colors duration-200 hover:bg-muted"
            >
              打开蓝本设计器
              <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
            </Link>
          </CardContent>
        </Card>

        <ul className="flex flex-col gap-1.5" data-testid="admin-blueprint-list">
          {AG_BLUEPRINTS.map((b) => (
            <li key={b.id}>
              <Card>
                <CardContent className="flex flex-col gap-1 p-3">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-13 font-medium">{b.title}</span>
                    <Badge tone={b.status === "published" ? "primary" : "warning"}>
                      {b.status === "published" ? "已发布" : "草稿"}
                    </Badge>
                    <Badge tone="outline">{b.version}</Badge>
                    <Badge tone={TONE[blueprintProgressTone(b.configured)]}>
                      已配置 {b.configured}/{total}
                    </Badge>
                    <span className="ml-auto text-11 text-muted-foreground">
                      {b.used} · {b.satisfaction}
                    </span>
                  </div>
                  <p className="text-11 text-muted-foreground">
                    {b.desc} · {b.meta}
                    {b.blockNote ? ` · ${b.blockNote}` : ""}
                  </p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </div>
    </AdminScreen>
  );
}
