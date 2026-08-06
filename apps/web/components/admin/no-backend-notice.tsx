import { TriangleAlert } from "lucide-react";

/**
 * 「未接入真实后端」警示条 —— 与 `SampleConfigNotice`（裁决 D-U12）刻意分开，见 #621。
 *
 * ⚠ 两条提示语义完全不同，不能互相替代：
 *   · `SampleConfigNotice`：后端真实存在，展示内容是**组织自行配置**的示例
 *     （适用于 agent / skill / 画布模板这类真的有 controller 接线的模块）。
 *   · `NoBackendNotice`（本组件）：**整个功能没有后端**——没有 controller，
 *     前端从未调用过 `apiRequest` / `lib/live-*`，数据硬编码在 `lib/mock/*` 里，
 *     页面上任何按钮点了都不会真的发生任何事。
 *   用同一条提示覆盖这两种情况，会让「未实现」看起来像「设计决定」——这正是
 *   #621 里人类看到 MCP 后台页问「这些是不是 mockup」的困惑根源。
 *
 * 视觉上必须比 `SampleConfigNotice` 更显眼（警示色块 + 三角感叹号，不是
 * `FlaskConical` 那种轻量图标），文案必须明说「静态演示数据」「操作不会真的生效」。
 *
 * 机械门控见 `apps/web/scripts/lint-no-backend-badge.mjs`：任何页面数据完全来自
 * `lib/mock/*` 且从未调用 `apiRequest`/`lib/live-*` 的，必须渲染本组件。
 */
export function NoBackendNotice() {
  return (
    <div
      data-testid="admin-no-backend-notice"
      role="alert"
      className="flex items-start gap-2.5 rounded-md border border-destructive/40 bg-destructive/10 p-3"
    >
      <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-12 font-semibold text-destructive">尚未接入真实后端</span>
        </div>
        <p className="text-11 text-destructive/90">
          此功能<strong className="font-semibold">尚未接入真实后端</strong>——没有对应的服务端接口，
          以下内容为<strong className="font-semibold">静态演示数据</strong>，
          <strong className="font-semibold">任何操作都不会真的生效</strong>。
        </p>
      </div>
    </div>
  );
}
