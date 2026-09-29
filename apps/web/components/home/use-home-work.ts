"use client";
import * as React from "react";
import { listPersonalThreads } from "@/lib/live-chat";
import { listProjects } from "@/lib/live-projects";
import { listProjectMembers } from "@/lib/live-project-members";
import { listNonWorkshopMembers } from "@/lib/live-project-collaborators";
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
  /** `null` = 协作者列表没取到（无权限/失败）；`[]` = 确实只有自己或没人。 */
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
    return Promise.all(active.map(async (p): Promise<HomeProject> => {
      let collaborators: HomeCollaborator[] | null = null;
      try {
        // 工作坊项目走成员表；一般项目（研究/洞察）成员表返回 null，改读协作者表。
        const m = await listProjectMembers(p.id);
        if (m.members !== null) {
          collaborators = m.members.map((x) => ({ userId: x.userId, displayName: x.displayName }));
        } else {
          const c = await listNonWorkshopMembers(p.id);
          collaborators = c.members.map((x) => ({ userId: x.userId, displayName: x.displayName }));
        }
      } catch {
        collaborators = null;
      }
      return { id: p.id, name: p.name, kind: p.kind, tags: p.tags, collaborators };
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
 * `lib/live-tasks.ts` 头注），与 `/tasks` 页同一处置——取第一个未归档项目。
 * 没有项目 / 取不到 ⇒ 由调用方显示真实空态或省略，不编任务。
 */
export function useHomeTasks(projects: Load<HomeProject[]>, enabled: boolean): Load<HomeTasks | null> {
  const anchor = projects.status === "ready" ? (projects.items[0] ?? null) : undefined;
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
