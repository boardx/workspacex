"use client";
import { useI18n } from "@/lib/i18n/provider";
import { translate } from "@/lib/i18n/messages";
import Link from "next/link";
import { OrganizationPageHeader } from "@/components/org-admin/organization-content";
import { Building2, Download, FileBarChart, Settings } from "lucide-react";
import { AdminScreen } from "./admin-screen";
import { OverviewLive } from "./overview-live";
import { FirstValueFunnelPanel } from "./first-value-funnel-panel";
import { Button } from "@/components/ui/button";
import type { UiState } from "@/lib/ui-state";

/**
 * 「组织总览」屏
 *
 * ## 这一屏曾经为什么是混合态，以及为什么现在不是了
 *
 * 人类 2026-08-14 对 Q-12 的裁决：屏内容归属选 A（留给 phase-03 的 `17-gov`），
 * 但已经有真后端的格子先接上，不等 phase-03 开工；落地时要显式标注哪几格是真数据、
 * 哪几格还是演示——别让界面看起来「整屏已完成」。
 *
 * 2026-08-30：F162 的「限额规则触发记录」落地后，「异常待处理」那格也有了真实数据源
 * （`GET /organizations/:orgId/limit-events`，与「成员配额 → 限额策略」tab 同一个真实
 * 端点）——本屏因此**不再是混合态**，全部内容都来自真实后端，见 `overview-live.tsx`。
 *
 * ⚠ 「限额事件」≠「异常检测」：phase-03 F15（识别越权调用、判定用量模式反常）仍未落地，
 *   这里能给的只是「组织自己设的阈值被越过」的记录，不是系统主动判出来的异常。命名与
 *   范围上的这条界线见 `overview-live.tsx` 头注，不在这里重复。
 *
 * ## 导出 / 月度报告仍然禁用 —— 但这不是「演示数据」
 *
 * 这两个按钮此前只弹 Toast，什么都没发生；全仓查过三处（契约、全 phase 的
 * feature_list、phase-03 F15 的标题）都没有认领它们的东西：组织级审计导出端点不存在
 * （只有项目级的 `/projects/:projectId/audit/export` 与组织数据导出 `/auth/org-export`，
 * 两条都不是这个按钮要的）。
 *
 * ⚠ 禁用**不等于**裁定这两个功能不做。「要不要做、归谁」仍在 #1178 里等人裁；
 *   这一步只消掉「点了像成功了」这个误导，且不预设任何归属。
 *
 * 这两个按钮不显示任何数据，只是一个尚未实现、如实禁用的动作——不属于「演示数据」
 * 的范畴（演示数据标记是给「看起来是真的、其实是编的数字」用的），所以不挂那个标记，
 * 挂的是禁用原因本身。
 */
export const EXPORT_UNAVAILABLE_REASON =
  translate("zh-CN", "adminOverview.exportUnavailable");

export function OverviewScreen({ state }: { state: UiState }) {
  const { t } = useI18n();
  return (
    <AdminScreen
      contentHeader={<OrganizationPageHeader title={t("adminOverview.title")} description={t("orgOverviewRedesign.intro")} icon={Building2} actions={<Link href="/org-admin/profile" className="inline-flex items-center gap-2 rounded-control border border-border bg-card px-3 py-2 text-12 font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Settings aria-hidden className="h-4 w-4"/>{t("orgOverviewRedesign.settings")}</Link>}/>}
      state={state}
      moduleLabel={t("adminOverview.module")}
      title={t("adminOverview.title")}
      // 整屏已读真库，两条屏级提示（示例组织配置 / 尚未接入真实后端）都不适用了，
      // 同 F160 后 members-screen 摘掉屏级提示的处置（见 admin-screen.tsx 的 `liveBacked`）。
      liveBacked
      intro={t("adminOverview.intro")}
      emptyHint={t("adminOverview.empty")}
      errors={{ report: t("adminOverview.reportFailure") }}
      depFailure={t("adminOverview.dependencyFailure")}
      denialReason={t("adminOverview.denial")}
      successMessage={t("adminOverview.reportSuccess")}
    >
      <div className="flex flex-col gap-5">
        {/* 三块真指标 + 限额事件 + 活动流，全部真数据，见 overview-live.tsx */}
        <OverviewLive />

        {/* 第一个价值时刻漏斗（issue #4248，真数据），见 first-value-funnel-panel.tsx */}
        <FirstValueFunnelPanel />

        {/* 导出 / 月度报告：按钮如实禁用，原因见上方文件头注与 #1178。
            ⚠ 刻意没有把它们从界面上拿掉：拿掉等于替 #1178 做了「不做」的决定，
            这里只如实说「还没有」。 */}
        <section className="flex flex-col gap-2" data-testid="admin-overview-reports">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-14 font-semibold">{t("adminOverview.reports")}</h2>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled
                title={t("adminOverview.exportUnavailable")}
                data-testid="admin-activity-export"
              >
                <Download aria-hidden className="h-3.5 w-3.5" />
                {t("adminOverview.export")}
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled
                title={t("adminOverview.exportUnavailable")}
                data-testid="admin-activity-report"
              >
                <FileBarChart aria-hidden className="h-3.5 w-3.5" />
                {t("adminOverview.monthlyReport")}
              </Button>
            </div>
          </div>
          {/* 原因摆在旁边，不只藏在 title 里——只禁用不说为什么，和藏起来一样让人
              读作「产品做不到」。同 `local-org-screen` 云端模型整行禁用的处理。 */}
          <p className="text-11 text-muted-foreground" data-testid="admin-overview-reports-disabled-reason">
            {t("adminOverview.exportUnavailable")}
          </p>
        </section>
      </div>
    </AdminScreen>
  );
}
