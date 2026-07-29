import Link from "next/link";
import {
  MessagesSquare, LayoutTemplate, FileText, Mic, ClipboardList, ListTodo, Presentation,
} from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { StateShell } from "@/components/state/state-shell";
import { resolvePreviewState } from "@/lib/ui-state";
import { mockIdentity, resolvePreviewRole, PROJECT_ROLE_LABEL } from "@/lib/identity";
import { MOCK_PROJECTS } from "@/lib/mock/projects";
import { resolveProjectContext } from "@/lib/project-context";

/**
 * 项目主页（2026-07-28 补）
 *
 * 补的是一个**真缺口**：项目列表上的「进入项目」点了没反应，根因是根本没有落地页——
 * 此前只有 `/projects/[id]/canvas` 与 `/projects/[id]/files` 两个子路由，没有项目本身。
 * 「看起来能跑不算完成」（AGENTS.md 完成定义），死按钮就是这条的反例。
 *
 * 本页是项目内各工作面的**枢纽**：它不重复实现任何子屏，只把它们按「一场项目怎么跑」
 * 的顺序排好，并显式标出哪些子屏尚未建（不藏起来，也不做成能点却没反应的按钮）。
 */

/** 项目内的工作面。`href: null` = 尚未建的屏，渲染成显式禁用而不是死按钮。 */
const SURFACES: Array<{
  key: string;
  label: string;
  desc: string;
  icon: typeof MessagesSquare;
  href: string | null;
  /** 未建时说明原因，让人知道是缺口不是 bug */
  pending?: string;
}> = [
  { key: "chat", label: "对话", desc: "人与 AI 团队在同一条线程上推进；批准卡在这里等你拍板", icon: MessagesSquare, href: "/chat" },
  { key: "canvas", label: "推演画布", desc: "各组画布、结构性冲突裁决、AI 落笔与回退", icon: LayoutTemplate, href: "canvas" },
  { key: "files", label: "项目文件", desc: "上传原件与系统产出物同处一棵树；删除有级联影响面", icon: FileText, href: "files" },
  { key: "interview", label: "访谈现场", desc: "实时转录、说话人指派、引述打点", icon: Mic, href: "/studio/interview" },
  { key: "survey", label: "问卷与投票", desc: "设计、回收、交叉切分、现场 60 秒投票", icon: ClipboardList, href: "/studio/survey" },
  { key: "tasks", label: "任务", desc: "人和 AI 共用同一种任务对象，责任人始终是人", icon: ListTodo, href: "/tasks" },
  {
    key: "stage", label: "现场大屏", desc: "投屏用的主持视图：环节倒计时、各组进度、广播",
    icon: Presentation, href: null, pending: "尚未建（原型档案第十节「主持台」为移动端形态，桌面大屏未抽取）",
  },
];

export default function ProjectHomePage({
  params, searchParams,
}: {
  params: { projectId: string };
  searchParams: { state?: string; as?: string; org?: string };
}) {
  const state = resolvePreviewState(searchParams.state);
  const previewRole = resolvePreviewRole(searchParams.as);
  const identity = mockIdentity(searchParams.org ?? "org-yuanyang", previewRole);
  const ctx = resolveProjectContext(`/projects/${params.projectId}`);
  const project = MOCK_PROJECTS.find((p) => p.id === params.projectId) ?? MOCK_PROJECTS[0];

  return (
    <AppShell identity={identity} previewRole={previewRole}>
      <div className="mx-auto flex max-w-3xl flex-col gap-5 p-6">
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-20 font-semibold tracking-tight" data-testid="project-home-title">
              {project?.name ?? ctx?.name ?? params.projectId}
            </h1>
            {previewRole && (
              <Badge tone="primary" data-testid="project-home-role">
                你在本项目：{PROJECT_ROLE_LABEL[previewRole]}
              </Badge>
            )}
          </div>
          <p className="text-12 text-muted-foreground">
            一个项目就是一场协作。下面是这场项目的各个工作面——议程、画布、录音、材料、
            产出与决策都挂在它下面。
          </p>
        </header>

        <StateShell
          state={state}
          emptyHint="这个项目还没有任何工作面被启用"
          errors={{ project: "项目配置不完整：蓝本未绑定，无法进入现场" }}
          depFailure={{ what: "项目服务暂时不可用，已排队重试 2 次" }}
          denial={{ layer: "project", reason: "你在本项目中没有对应的角色" }}
          successMessage="已进入项目"
        >
          <div className="flex flex-col gap-4">
            {project?.readiness != null && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-13">准备度</CardTitle>
                  <CardDescription>
                    {[project.confirmed, project.groups, project.blueprint].filter(Boolean).join(" · ")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex items-center gap-3">
                  <Progress
                    value={project.readiness}
                    label="项目准备度"
                    tone={project.readiness >= 60 ? "primary" : project.readiness >= 30 ? "warning" : "destructive"}
                    className="flex-1"
                  />
                  <span className="shrink-0 font-mono text-12">{project.readiness}%</span>
                </CardContent>
              </Card>
            )}

            <section className="flex flex-col gap-2" data-testid="project-home-surfaces">
              <h2 className="text-13 font-semibold">工作面</h2>
              <ul className="flex flex-col gap-1.5">
                {SURFACES.map((s) => {
                  const href = s.href
                    ? s.href.startsWith("/") ? s.href : `/projects/${params.projectId}/${s.href}`
                    : null;
                  const body = (
                    <>
                      <s.icon aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="w-20 shrink-0 text-13 font-medium">{s.label}</span>
                      <span className="min-w-0 flex-1 truncate text-11 text-muted-foreground">
                        {s.pending ?? s.desc}
                      </span>
                      {s.pending && <Badge tone="outline">未建</Badge>}
                    </>
                  );
                  return (
                    <li key={s.key}>
                      {href ? (
                        <Link
                          href={href}
                          data-testid={`project-home-surface-${s.key}`}
                          className="flex items-center gap-3 rounded-md border border-border-subtle bg-panel px-3 py-2 transition-all duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {body}
                        </Link>
                      ) : (
                        // 尚未建的屏：显式禁用 + 写明原因。
                        // 静默无反应是缺陷；显式禁用是设计。
                        <div
                          data-testid={`project-home-surface-${s.key}`}
                          aria-disabled="true"
                          title={s.pending}
                          className="flex cursor-not-allowed items-center gap-3 rounded-md border border-dashed border-border bg-disabled px-3 py-2 text-disabled-foreground"
                        >
                          {body}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
        </StateShell>
      </div>
    </AppShell>
  );
}
