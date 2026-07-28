import { Button } from "@/components/ui/button";
import { INTERVIEW_VIEWS, type InterviewView } from "@/lib/mock/interview";

/**
 * 访谈的角色视角切换器（UC-6.4 R5 多角色预览）。
 *
 * ⚠ 视角切换是**预览手段，不是权限实现**——真实权限在服务端（NestJS Guard + RLS）。
 *    切换只改本地展示，不改变服务端返回的数据（identity.ts 同一立场）。
 * 用 `?view=` 承载，anchor 同时保留当前 `?state=`，不丢七态预览上下文。
 */
export function InterviewViewSwitcher({
  current, state, domain = "itv",
}: { current: InterviewView; state: string; domain?: string }) {
  const active = INTERVIEW_VIEWS.find((v) => v.id === current) ?? INTERVIEW_VIEWS[0]!;
  return (
    <div
      data-testid={`${domain}-view-switcher`}
      className="flex flex-col gap-1 rounded-md border border-border-subtle bg-panel p-1.5"
    >
      <div className="flex flex-wrap items-center gap-1">
        <span className="px-1 text-10 uppercase tracking-wide text-muted-foreground">视角</span>
        {INTERVIEW_VIEWS.map((v) => (
          <Button
            key={v.id}
            asChild
            size="xs"
            variant={v.id === current ? "primary" : "ghost"}
            data-testid={`${domain}-view-${v.id}`}
          >
            <a href={`?view=${v.id}&state=${state}`}>{v.label}</a>
          </Button>
        ))}
      </div>
      <p className="px-1 text-10 text-muted-foreground">
        当前：<strong className="text-background-foreground">{active.label}</strong> · {active.note}
      </p>
    </div>
  );
}
