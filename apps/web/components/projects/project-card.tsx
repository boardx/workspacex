"use client";
import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
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

/**
 * 卡片动作 —— 每个都必须有真实出口（2026-07-28 修）
 *
 * 「进入项目」此前是死按钮：没有 onClick、没有链接，点了没反应。
 * 根因是当时根本没有项目主页；现已补 `/projects/[id]`。
 * 「看现场大屏」对应的桌面大屏尚未建，故**显式禁用并写明原因**——
 * 静默无反应是缺陷，显式禁用是设计。
 */
function CardActions({ project }: { project: ProjectSummary }) {
  const id = project.id;
  const home = `/projects/${id}`;
  switch (project.status) {
    case "running":
      return (
        <>
          <Button asChild variant="primary" size="sm">
            <Link href={home} data-testid={`projects-card-${id}-enter`}>进入项目</Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled
            title="现场大屏尚未建（原型只抽取到移动端主持台，桌面大屏形态未确认）"
            data-testid={`projects-card-${id}-bigscreen`}
          >
            看现场大屏
          </Button>
          <ProjectMoreMenu projectId={id} />
        </>
      );
    case "preparing":
      return (
        <>
          <Button asChild variant="primary" size="sm">
            <Link href={home} data-testid={`projects-card-${id}-design`}>继续设计</Link>
          </Button>
          <InviteButton projectId={id} />
        </>
      );
    case "draft":
      return (
        <Button asChild variant="primary" size="sm">
          <Link href={home} data-testid={`projects-card-${id}-design`}>继续设计</Link>
        </Button>
      );
    case "delivered":
      return (
        <Button asChild variant="outline" size="sm">
          <Link href={`${home}/files`} data-testid={`projects-card-${id}-output`}>看产出</Link>
        </Button>
      );
  }
}

/**
 * 「发邀请」—— 原型的 R8 标它为「原型待补」（按钮在、点了没屏）。
 * 这里补出**最小可用的接线**：展开一次性链接 + 复制 + 撤销。
 * ⚠ 裁决 D-04：phase-1 只做「生成一次性链接（24h）+ 撤销」，
 *   二维码 / 按名单群发 / 三档有效期已明确降级到 phase-2，故此处不画。
 */
function InviteButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [revoked, setRevoked] = React.useState(false);
  const link = `https://workspacex.app/join?p=${projectId}&t=one-time`;

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid={`projects-card-${projectId}-invite`}
      >
        发邀请
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label="发邀请"
          data-testid={`projects-invite-panel-${projectId}`}
          className="absolute left-0 top-9 z-10 flex w-72 flex-col gap-2 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-md"
        >
          <p className="text-12 font-medium">一次性进场链接</p>
          <p className="break-all rounded-md bg-muted px-2 py-1.5 font-mono text-10">{link}</p>
          <p className="text-10 text-muted-foreground">
            24 小时有效 · 可随时撤销 · 落地后核对名单（裁决 D-01：名单实名，不建账号）
          </p>
          <div className="flex items-center gap-1.5">
            <Button
              size="xs"
              variant="primary"
              onClick={() => {
                void navigator.clipboard?.writeText(link);
                setCopied(true);
              }}
              disabled={revoked}
              data-testid={`projects-invite-copy-${projectId}`}
            >
              {copied ? "已复制" : "复制链接"}
            </Button>
            <Button
              size="xs"
              variant="destructive"
              onClick={() => setRevoked(true)}
              disabled={revoked}
              data-testid={`projects-invite-revoke-${projectId}`}
            >
              {revoked ? "已撤销" : "撤销"}
            </Button>
            <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setOpen(false)} data-testid={`projects-invite-close-${projectId}`}>
              关闭
            </Button>
          </div>
          <p className="text-10 text-muted-foreground">
            二维码 / 按名单群发 / 三档有效期已按 D-04 降级到 phase-2，本轮不做。
          </p>
        </div>
      )}
    </div>
  );
}
