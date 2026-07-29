import { FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/**
 * 「示例组织配置」说明条（裁决 D-U12）——常驻后台每个模块页头。
 *
 * ⚠ 标记不是免责声明，是在**陈述这些数据的真实性质**：能力清单（agent / skill / 模型 /
 *   MCP / 画布模板 / 项目蓝本）本来就是「某个组织自行配置的东西」，不是产品内置常量
 *   （UC-0.5 的核心立场）——所以它们天然就该是示例。当前显示的型号、定价与条目是演示数据。
 *
 * 顺带交代「本组织配置」读感：这些配置只对当前组织生效，成员跟随。
 * ⚠ 只在页头放一条；明显编造的数值（如定价）旁另有小标（见 model-screen 的「示例」角标），
 *   不给每一行都加标记（那会淹没信息，见 D-U12 执行说明）。
 */
export function SampleConfigNotice() {
  return (
    <div
      data-testid="admin-sample-config-notice"
      className="flex items-start gap-2.5 rounded-md border border-border-subtle bg-panel p-3"
    >
      <FlaskConical aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-12 font-medium">示例组织配置</span>
          <Badge tone="outline">本组织配置 · 成员跟随</Badge>
        </div>
        <p className="text-11 text-muted-foreground">
          能力清单（agent / skill / 模型 / MCP / 画布模板 / 项目蓝本）由每个组织自行配置，
          <strong className="font-medium text-background-foreground">不是产品内置</strong>——见 UC-0.5。
          这些配置只对<strong className="font-medium text-background-foreground">当前组织</strong>生效、成员跟随；
          当前显示的型号、定价与条目为<strong className="font-medium text-background-foreground">演示数据</strong>。
        </p>
      </div>
    </div>
  );
}
