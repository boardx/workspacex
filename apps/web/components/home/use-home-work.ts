"use client";
import * as React from "react";
import { listPersonalThreads } from "@/lib/live-chat";
import { listProjects } from "@/lib/live-projects";
import { getHomeProjectPreviews } from "@/lib/live-home-project-previews";
import { listGuidedResearchSessions } from "@/lib/live-guided-research-api";
import { listMyDigitalInterviews } from "@/lib/live-interviews";
import { surveyRequest } from "@/lib/survey/runtime-client";
import { getMyToday, type RenderedTaskCard } from "@/lib/live-tasks";
import type { GuidedResearchVisualStage } from "@/lib/guided-research-six-step";

/**
 * 首页「继续你的工作」与「当前任务」的数据。每一类各自独立请求、各自独立降级：
 * 一类拉不到就那一类不显示（`status: "error"`），不拖垮整页，也**不**编一份样例填充。
 */
export type Load<T> =
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | { readonly status: "ready"; readonly items: T };

type ThreadCards = Awaited<ReturnType<typeof listPersonalThreads>>["groups"][number]["cards"];
export type HomeThread = ThreadCards[number];

export interface HomeCollaborator {
  readonly userId: string;
  readonly displayName: string;
}
export interface HomeProject {
  readonly id: string;
  readonly name: string;
  readonly kind: "workshop" | "general";
  readonly tags: readonly string[];
  /** `null` = 我不是该项目成员（或没取到）；有值 ⟺ 我是成员。 */
  readonly collaborators: readonly HomeCollaborator[] | null;
}
export interface HomeResearch {
  readonly sessionId: string;
  readonly title: string;
  readonly status: string;
  readonly progress: number;
  /** 路由用的「可视阶段」（import/topic/plan/research/report），不是服务端的运行阶段。 */
  readonly stage: GuidedResearchVisualStage;
  readonly updatedAt: string;
}
export interface HomeInterview {
  readonly interviewId: string;
  readonly name: string;
  readonly status: string;
  readonly kind: "quick" | "batch";
  readonly expertCount: number;
  readonly completedExpertCount: number;
  readonly href: string;
  readonly updatedAt: string;
}
export interface HomeSurvey {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly collecting: boolean;
  readonly updatedAt: string;
}

const LIMIT = { threads: 4, projects: 4, research: 3, interviews: 3, surveys: 3 } as const;

function byUpdatedDesc<T extends { readonly updatedAt: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

/**
 * 服务端断点阶段（`GuidedResearchStage`，去掉 failed）→ 研究页路由的可视阶段。
 * 映射口径同 `lib/guided-research-six-step.ts` 的 `nodeToStage`（那里的输入是 runtime node 名，
 * 服务端阶段里「资料研究」叫 `researching`，两边不同名，所以这里单列一张闭集表）。
 */
const RESEARCH_STAGE_TO_VISUAL: Record<"brief" | "directions" | "outline" | "researching" | "report", GuidedResearchVisualStage> = {
  brief: "import", directions: "topic", outline: "plan", researching: "research", report: "report",
};
export function researchVisualStage(stage: keyof typeof RESEARCH_STAGE_TO_VISUAL): GuidedResearchVisualStage {
  return RESEARCH_STAGE_TO_VISUAL[stage];
}

/** 访谈行的落点，与 `/itv` 历史列表同一规则（quick → quick 页；有 sourceStep → 该步；否则 setup）。 */
export function interviewHref(row: { interviewId: string; kind: "quick" | "batch"; sourceStep?: string | undefined }): string {
  if (row.kind === "quick") return `/itv/quick/${encodeURIComponent(row.interviewId)}`;
  return `/itv/${encodeURIComponent(row.interviewId)}/${row.sourceStep ?? "setup"}`;
}

function useLoad<T>(fetcher: (() => Promise<T>) | null): Load<T> {
  const [state, setState] = React.useState<Load<T>>({ status: "loading" });
  const ref = React.useRef(fetcher);
  ref.current = fetcher;
  const enabled = fetcher !== null;
  React.useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState({ status: "loading" });
    ref.current!()
      .then((items) => { if (!cancelled) setState({ status: "ready", items }); })
      .catch(() => { if (!cancelled) setState({ status: "error" }); });
    return () => { cancelled = true; };
  }, [enabled]);
  return state;
}

export function useHomeWork(orgId: string | null, enabled: boolean) {
  const on = orgId !== null && enabled;

  const threads = useLoad<HomeThread[]>(on ? async () => {
    const out = await listPersonalThreads({ limit: LIMIT.threads });
    return out.groups.flatMap((g) => g.cards).slice(0, LIMIT.threads);
  } : null);

  const projects = useLoad<HomeProject[]>(on ? async () => {
    const all = await listProjects(orgId);
    const active = all.filter((p) => p.readOnlyReason !== "archived").slice(0, LIMIT.projects);
    // 协作者由服务端聚合：只有我有项目角色的项目才会出现在这里。取不到（失败）就当没有协作者信息，
    // 项目卡照常显示——不因此把整组项目标成错误，也不再逐个项目去撞必然的 403。
    const previews = await getHomeProjectPreviews().then((r) => new Map(r.items.map((i) => [i.projectId, i.members] as const))).catch(() => new Map<string, readonly HomeCollaborator[]>());
    return active.map((p): HomeProject => ({
      id: p.id, name: p.name, kind: p.kind, tags: p.tags, collaborators: previews.get(p.id) ?? null,
    }));
  } : null);

  const research = useLoad<HomeResearch[]>(on ? async () => {
    const out = await listGuidedResearchSessions();
    return byUpdatedDesc(out.items).slice(0, LIMIT.research).map((s) => ({
      sessionId: s.sessionId, title: s.title, status: s.status, progress: s.progress,
      stage: researchVisualStage(s.resumeStage), updatedAt: s.updatedAt,
    }));
  } : null);

  const interviews = useLoad<HomeInterview[]>(on ? async () => {
    const out = await listMyDigitalInterviews();
    return byUpdatedDesc(out.items).slice(0, LIMIT.interviews).map((r) => ({
      interviewId: r.interviewId, name: r.name, status: r.status, kind: r.kind,
      expertCount: r.expertCount, completedExpertCount: r.completedExpertCount,
      href: interviewHref(r), updatedAt: r.updatedAt,
    }));
  } : null);

  const surveys = useLoad<HomeSurvey[]>(on ? async () => {
    const rows = await surveyRequest<Array<{ id: string; title: string; status: string; updatedAt: string; publication?: { status?: string } | null }>>("/surveys");
    return byUpdatedDesc(rows).slice(0, LIMIT.surveys).map((s) => ({
      id: s.id, title: s.title, status: s.status, collecting: s.publication?.status === "collecting", updatedAt: s.updatedAt,
    }));
  } : null);

  return { threads, projects, research, interviews, surveys };
}

export interface HomeTasks {
  readonly anchorProjectName: string;
  readonly mine: readonly RenderedTaskCard[];
}

/**
 * 「当前任务」：`GET /tasks/today` 需要一个项目作锚点（后端还没做跨项目聚合，见
 * `lib/live-tasks.ts` 头注）。锚点取**我是成员的第一个项目**（`collaborators !== null` ⟺ 服务端
 * 确认我在其中有项目角色）——不像 `/tasks` 页那样取列表第一项：那可能是我只「管理」而非成员的
 * 项目，接口会必然 403。没有这样的项目 ⇒ 不发请求，显示真实空态，不编任务。
 */
export function useHomeTasks(projects: Load<HomeProject[]>, enabled: boolean): Load<HomeTasks | null> {
  const anchor = projects.status === "ready" ? (projects.items.find((p) => p.collaborators !== null) ?? null) : undefined;
  const fetcher = enabled && anchor !== undefined
    ? async (): Promise<HomeTasks | null> => {
        if (anchor === null) return null;
        const today = await getMyToday(anchor.id);
        const s = today.sections;
        const mine = [...s.awaiting_my_judgment, ...s.my_push_today, ...s.ai_running_for_me].slice(0, 5);
        return { anchorProjectName: anchor.name, mine };
      }
    : null;
  const state = useLoad<HomeTasks | null>(fetcher);
  if (enabled && projects.status === "error") return { status: "error" };
  return state;
}
