import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ProjectMoreMenu } from "./project-more-menu";
import { PROJECT_STATUS_LABEL, type ProjectSummary, type ProjectStatus } from "@/lib/mock/projects";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<ProjectStatus, "primary" | "warning" | "outline" | "neutral"> = {
  running: "primary",
  preparing: "warning",
  draft: "outline",
  delivered: "neutral",
};

const READINESS_TONE = (pct: number): "primary" | "warning" | "destructive" =>
  pct >= 60 ? "primary" : pct >= 30 ? "warning" : "destructive";

/**
 * 项目卡 —— 四种状态**字段完整度差异很大**（原型第三节表），这正是要看的：
 * 正在进行有环节/在场/组数/蓝本；筹备中/草稿有准备度；已交付有决策与晋升计数。
 * 不同状态渲染不同 metadata 与不同动作组，不用一套模板套所有卡。
 */
export function ProjectCard({ project }: { project: ProjectSummary }) {
  return (
    <Card data-testid={`projects-card-${project.id}`} className="transition-all duration-200 hover:shadow-md">
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              {project.status === "running" && (
                <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
              )}
              <h3 className="truncate text-14 font-semibold tracking-tight">{project.name}</h3>
            </div>
            <p className="text-11 text-muted-foreground">
              {project.owner} · {project.schedule}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {project.priority && <Badge tone="warning">高优先级</Badge>}
            <Badge tone={STATUS_TONE[project.status]} data-testid={`projects-card-${project.id}-status`}>
              {PROJECT_STATUS_LABEL[project.status]}
            </Badge>
          </div>
        </div>

        <ProjectMeta project={project} />

        <div className="flex flex-wrap items-center gap-1.5">
          <CardActions project={project} />
        </div>
      </CardContent>
    </Card>
  );
}

function ProjectMeta({ project }: { project: ProjectSummary }) {
  // 准备度是筹备中/草稿的核心字段（R8 必显），单独用 Progress 呈现
  if (project.readiness != null) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-11 text-muted-foreground">准备度</span>
          <span className="text-11 font-medium tabular-nums">{project.readiness}%</span>
        </div>
        <Progress value={project.readiness} tone={READINESS_TONE(project.readiness)} label="项目准备度" />
        <MetaChips
          items={[project.confirmed, project.inviteState, project.groups, project.blueprint]}
        />
      </div>
    );
  }
  // 正在进行 / 已交付：字段各不同
  return (
    <MetaChips
      items={[
        project.stageProgress,
        project.attendance,
        project.groups,
        project.blueprint,
        project.delivery,
        project.decisions,
        project.promoted,
      ]}
    />
  );
}

function MetaChips({ items }: { items: (string | undefined)[] }) {
  const chips = items.filter(Boolean) as string[];
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-12 text-muted-foreground">
      {chips.map((c, i) => (
        <span key={c} className="flex items-center gap-2">
          {i > 0 && <span aria-hidden className="text-border">·</span>}
          <span className={cn(c.startsWith("蓝本") && "font-medium text-card-foreground")}>{c}</span>
        </span>
      ))}
    </div>
  );
}

function CardActions({ project }: { project: ProjectSummary }) {
  const id = project.id;
  switch (project.status) {
    case "running":
      return (
        <>
          <Button variant="primary" size="sm" data-testid={`projects-card-${id}-enter`}>进入项目</Button>
          <Button variant="outline" size="sm" data-testid={`projects-card-${id}-bigscreen`}>看现场大屏</Button>
          <ProjectMoreMenu projectId={id} />
        </>
      );
    case "preparing":
      return (
        <>
          <Button variant="primary" size="sm" data-testid={`projects-card-${id}-design`}>继续设计</Button>
          <Button variant="outline" size="sm" data-testid={`projects-card-${id}-invite`}>发邀请</Button>
        </>
      );
    case "draft":
      return (
        <Button variant="primary" size="sm" data-testid={`projects-card-${id}-design`}>继续设计</Button>
      );
    case "delivered":
      return (
        <Button variant="outline" size="sm" data-testid={`projects-card-${id}-output`}>看产出</Button>
      );
  }
}
