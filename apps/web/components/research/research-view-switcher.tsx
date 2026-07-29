import { Button } from "@/components/ui/button";
import { RESEARCH_VIEWS, type ResearchView } from "@/lib/mock/research";

/** 研究角色视角切换（UC-0.2 / 6.5 R5）。预览手段，非权限实现；保留当前 ?state=。 */
export function ResearchViewSwitcher({ current, state }: { current: ResearchView; state: string }) {
  const active = RESEARCH_VIEWS.find((v) => v.id === current) ?? RESEARCH_VIEWS[0]!;
  return (
    <div data-testid="research-view-switcher" className="flex flex-col gap-1 rounded-md border border-border-subtle bg-panel p-1.5">
      <div className="flex flex-wrap items-center gap-1">
        <span className="px-1 text-10 uppercase tracking-wide text-muted-foreground">视角</span>
        {RESEARCH_VIEWS.map((v) => (
          <Button key={v.id} asChild size="xs" variant={v.id === current ? "primary" : "ghost"} data-testid={`research-view-${v.id}`}>
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
