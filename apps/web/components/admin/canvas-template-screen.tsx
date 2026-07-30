"use client";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { AdminScreen } from "./admin-screen";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { A0_TEMPLATES, ORG_TEMPLATES, type CanvasTemplateRow } from "@/lib/mock/canvas";
import type { UiState } from "@/lib/ui-state";

/**
 * 后台 → 画布模板（`AssetKind.canvas-template`，左栏第 5 项，F132）。
 *
 * ## 这一屏为什么这么薄（是取舍，不是半成品）
 *
 * F132 的交付面是**左栏项集合 ＝ AssetKind 六值**。但只补一个 `<Link>` 而不给它落点，
 * 等于把「点进去 404」这个投诉从缺项换成死链——所以这里给一个**真能进、真有数据**的落点。
 * 屏里的治理动作（发布 / 可见范围 / 复核周期 / 计数派生）分别属 **F133 / F134+**，
 * 本屏**不抢**：它只做清单与去向。
 *
 * ⚠ **模板库的完整编辑器已经存在**（`canvas` 束已签核，路由 `/canvas?screen=template-admin`）。
 * 后台这一项与那一屏最终是同一个还是两个入口，属 **Q-11（左栏 IA 三方合并）** 与
 * **X-J**，未裁 —— 本屏因此**只链过去，不搬也不复制**那一屏。
 *
 * 数据取已建成 mock（`lib/mock/canvas.ts`），不另立第二份清单。
 */
const ROWS: CanvasTemplateRow[] = [...ORG_TEMPLATES, ...A0_TEMPLATES];

const STATUS_TONE: Record<CanvasTemplateRow["status"], "primary" | "warning" | "neutral"> = {
  已发布: "primary",
  试跑: "warning",
  草稿: "warning",
  已归档: "neutral",
};

export function CanvasTemplateScreen({ state }: { state: UiState }) {
  return (
    <AdminScreen
      state={state}
      moduleLabel="画布模板"
      title="画布模板"
      intro="画布模板是六种 AI 能力资产之一，和 Agent / Skill 走同一套治理：谁能用、出问题谁负责、什么时候重新检查。这里是后台侧的清单与去向；分区结构与围栏语法在模板编辑器里改。"
      emptyHint="本组织还没有画布模板"
      depFailure="模板注册表读取失败，无法列出画布模板。"
      denialReason="画布模板的后台管理仅组织管理员与能力维护者可见。"
      successMessage="画布模板清单已刷新"
    >
      <div className="flex flex-col gap-4" data-testid="admin-canvasadmin-screen">
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3">
            <p className="text-12 text-muted-foreground">
              分区结构、围栏语法与版本历史在模板编辑器里改（`canvas` 束已建成屏）。
              后台这一项与那一屏是否合并，属 Q-11，待人类裁决。
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

        <ul className="flex flex-col gap-1.5" data-testid="admin-canvasadmin-list">
          {ROWS.map((t) => (
            <li key={`${t.key}-${t.version}`}>
              <Card>
                <CardContent className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-3">
                  <span className="text-13 font-medium">{t.cnName}</span>
                  <Badge tone={STATUS_TONE[t.status]}>{t.status}</Badge>
                  <Badge tone="outline">{t.version}</Badge>
                  <Badge tone="neutral">{t.visibility}</Badge>
                  <span className="text-11 text-muted-foreground">{t.structure}</span>
                  <span className="ml-auto text-11 text-muted-foreground">被 {t.usedBy} 场使用</span>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </div>
    </AdminScreen>
  );
}
