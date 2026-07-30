import { Button } from "@/components/ui/button";
import { ITV_VIEWS, type ItvView } from "@/lib/mock/itv";

/**
 * 访谈的角色视角切换器 —— 访谈自有三档（研究员 / 受访者 / 观察者）。
 *
 * ⚠ 访谈**没有**引导师/组长（人类 2026-07-30 裁决）——那是工作坊的角色。
 *   v1 把工作坊/项目的五档角色套到访谈上，是它的错误之一（见 V1-WAS-WRONG.md）。
 * ⚠ 视角切换是**预览手段，不是权限实现**——真实权限在服务端。原型访谈屏本身没有
 *   视角切换器；这个切换器是本原型为逐角色核对异常态而加，是与旧原型的有意差别。
 * 用 `?view=` 承载，anchor 同时保留 `?screen=` `?state=` `?scope=`，不丢预览上下文。
 */
export function ItvViewSwitcher({
  current,
  state,
  screen,
  scope,
}: {
  current: ItvView;
  state: string;
  screen: string;
  scope: string;
}) {
  const active = ITV_VIEWS.find((v) => v.id === current) ?? ITV_VIEWS[0]!;
  return (
    <div
      data-testid="itv-view-switcher"
      className="flex flex-col gap-1 rounded-md border border-border-subtle bg-panel p-1.5"
    >
      <div className="flex flex-wrap items-center gap-1">
        <span className="px-1 text-10 uppercase tracking-wide text-muted-foreground">视角</span>
        {ITV_VIEWS.map((v) => (
          <Button
            key={v.id}
            asChild
            size="xs"
            variant={v.id === current ? "primary" : "ghost"}
            data-testid={`itv-view-${v.id}`}
          >
            <a href={`?screen=${screen}&scope=${scope}&view=${v.id}&state=${state}`}>{v.label}</a>
          </Button>
        ))}
      </div>
      <p className="px-1 text-10 text-muted-foreground">
        当前：<strong className="text-background-foreground">{active.label}</strong> · {active.note}
      </p>
    </div>
  );
}
