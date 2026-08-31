"use client";
import { Download, FileBarChart } from "lucide-react";
import { AdminScreen } from "./admin-screen";
import { OverviewLive } from "./overview-live";
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
  "组织级审计导出与月度报告尚未实现——没有对应的服务端接口，见 issue #1178。";

export function OverviewScreen({ state }: { state: UiState }) {
  return (
    <AdminScreen
      state={state}
      moduleLabel="总览"
      title="组织总览"
      // 整屏已读真库，两条屏级提示（示例组织配置 / 尚未接入真实后端）都不适用了，
      // 同 F160 后 members-screen 摘掉屏级提示的处置（见 admin-screen.tsx 的 `liveBacked`）。
      liveBacked
      intro="本月消耗、活跃度与限额规则触发情况。限额事件不是「事后可查」，是「事中拦截」——这里是处置入口。"
      emptyHint="本月还没有活动记录"
      errors={{ report: "生成月度报告失败：审计导出服务返回 500，请稍后重试" }}
      depFailure="用量与限额埋点依赖审计流水线（UC-17.1），当前不可用，指标与活动流无法刷新。"
      denialReason="本页仅组织管理员可见；你当前的组织角色是顾问。"
      successMessage="月度报告已生成，已发送到你的收件箱"
    >
      <div className="flex flex-col gap-5">
        {/* 三块真指标 + 限额事件 + 活动流，全部真数据，见 overview-live.tsx */}
        <OverviewLive />

        {/* 导出 / 月度报告：按钮如实禁用，原因见上方文件头注与 #1178。
            ⚠ 刻意没有把它们从界面上拿掉：拿掉等于替 #1178 做了「不做」的决定，
            这里只如实说「还没有」。 */}
        <section className="flex flex-col gap-2" data-testid="admin-overview-reports">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-14 font-semibold">导出与报告</h2>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled
                title={EXPORT_UNAVAILABLE_REASON}
                data-testid="admin-activity-export"
              >
                <Download aria-hidden className="h-3.5 w-3.5" />
                导出
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled
                title={EXPORT_UNAVAILABLE_REASON}
                data-testid="admin-activity-report"
              >
                <FileBarChart aria-hidden className="h-3.5 w-3.5" />
                生成月度报告
              </Button>
            </div>
          </div>
          {/* 原因摆在旁边，不只藏在 title 里——只禁用不说为什么，和藏起来一样让人
              读作「产品做不到」。同 `local-org-screen` 云端模型整行禁用的处理。 */}
          <p className="text-11 text-muted-foreground" data-testid="admin-overview-reports-disabled-reason">
            {EXPORT_UNAVAILABLE_REASON}
          </p>
        </section>
      </div>
    </AdminScreen>
  );
}
