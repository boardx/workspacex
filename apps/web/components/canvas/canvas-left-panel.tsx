import { Play, Check, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  MOCK_GROUP_CANVASES, MOCK_PROJECT_CANVASES, MOCK_BOUND_SKILLS,
  type GroupCanvasStatus, type CanvasSyncStatus,
} from "@/lib/mock/projects";

const GROUP_TONE: Record<GroupCanvasStatus, "primary" | "neutral" | "warning" | "outline"> = {
  "进行中": "primary",
  "只读": "neutral",
  "落后": "warning",
  "你在这组": "outline",
};
const SYNC_TONE: Record<CanvasSyncStatus, "neutral" | "warning" | "primary"> = {
  "已同步": "neutral",
  "待同步": "warning",
  "画布领先": "primary",
};

/**
 * 画布左栏三区（原型四节）——纯展示，服务端可渲染。
 * ① 本环节各组画布（4 行状态各不同）② 本项目画布（3 · 1 待同步）③ 本环节绑定的 skill。
 */
export function CanvasLeftPanel() {
  return (
    <div className="flex flex-col gap-4 p-3" data-testid="canvas-left-panel">
      <div className="flex flex-col gap-1">
        <h2 className="text-13 font-semibold">画布来自议程</h2>
        <p className="text-11 text-muted-foreground">
          环节里绑定了模板与 skill，组员打开就是这张画布，不用自己找。
        </p>
      </div>

      {/* ① 各组画布 */}
      <section className="flex flex-col gap-1.5">
        <SectionLabel>本环节 · 各组画布 · 4 组</SectionLabel>
        {MOCK_GROUP_CANVASES.map((g) => {
          const mine = g.status === "你在这组";
          return (
            <div
              key={g.id}
              data-testid={`canvas-group-${g.id}`}
              className={cn(
                "flex flex-col gap-1 rounded-md border px-2.5 py-2 transition-colors duration-200 hover:bg-muted",
                mine ? "border-primary bg-accent" : "border-border-subtle bg-card",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-12 font-medium">{g.title}</span>
                <Badge tone={GROUP_TONE[g.status]}>{g.status}</Badge>
              </div>
              <span className="text-10 text-muted-foreground">模板: {g.template} · {g.stickies} 便签</span>
            </div>
          );
        })}
      </section>

      {/* ② 本项目画布 */}
      <section className="flex flex-col gap-1.5">
        <SectionLabel>本项目画布 · 3 · 1 待同步</SectionLabel>
        {MOCK_PROJECT_CANVASES.map((c) => (
          <div
            key={c.id}
            data-testid={`canvas-project-canvas-${c.id}`}
            className="flex flex-col gap-1 rounded-md border border-border-subtle bg-card px-2.5 py-2 transition-colors duration-200 hover:bg-muted"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-12 font-medium">{c.title}</span>
              <Badge tone={SYNC_TONE[c.sync]}>{c.sync}</Badge>
            </div>
            <span className="text-10 text-muted-foreground">{c.summary}</span>
          </div>
        ))}
      </section>

      {/* ③ 绑定的 skill */}
      <section className="flex flex-col gap-1.5">
        <SectionLabel>本环节绑定的 skill</SectionLabel>
        {MOCK_BOUND_SKILLS.map((s) => (
          <div
            key={s.id}
            data-testid={`canvas-skill-${s.id}`}
            className="flex items-center justify-between gap-2 rounded-md border border-border-subtle bg-card px-2.5 py-1.5"
          >
            <span className="truncate text-12">{s.label}</span>
            {s.action === "运行" ? (
              <Button variant="outline" size="xs" data-testid={`canvas-skill-${s.id}-run`}>
                <Play aria-hidden className="h-3 w-3" /> 运行
              </Button>
            ) : (
              <Button variant="secondary" size="xs" data-testid={`canvas-skill-${s.id}-on`}>
                <Check aria-hidden className="h-3 w-3" /> 已开
              </Button>
            )}
          </div>
        ))}
        <p className="mt-1 flex items-center gap-1 text-10 text-muted-foreground">
          模板由后台配置
          <span className="inline-flex items-center gap-0.5 text-primary">
            去后台 <ExternalLink aria-hidden className="h-2.5 w-2.5" />
          </span>
        </p>
      </section>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="text-10 font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>;
}
