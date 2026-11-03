"use client";
import * as React from "react";
import { useI18n } from "@/lib/i18n/provider";
import { board } from "@repo/contracts";
import Link from "next/link";
import { useSession } from "@/components/session/session-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar } from "@/components/ui/avatar";
import { ApiError } from "@/lib/api-client";
import { describeFailure } from "@/lib/design-failure";
import { listProjects } from "@/lib/live-projects";
import {
  changeTaskStatus, createTask, getMyToday, listTasks,
  type GetMyTodayOut, type RenderedTaskCard, type RiskLevel,
} from "@/lib/live-tasks";

/**
 * F02/F06 —— `/tasks` 的真实数据路径。
 *
 * 与 `today-board.tsx`（纯 mock 演示，`?state=` 七态预览用）并存，不是替换它——
 * 那个组件是设计签核用的视觉原型（F06 notes: "UI 已建成于 apps/web /tasks"），这个
 * 组件是生产 /tasks 的真实后端路径；mock 原型仅在 /preview/tasks。
 *
 * ## 范围收窄（如实记录）
 *
 * - 「我的今天」的跨项目聚合本次收窄成"取第一个可读工作坊作为角色判定锚点"
 *   （见 `findBoardAnchor`：跳过普通项目和无看板权限的 403）——不是真正的多项目求并集，那是 F04 的范围。
 * - 卡片信息密度远低于 mock 原型（没有 agent 步骤/进度、没有完成标准 X/Y、
 *   没有"等待时长"）——那些字段依赖 F03/F05/F07/F08 尚未建的能力，展示编造的数字
 *   比不展示更糟。这里只展示后端真实能给的字段。
 */

const RISK_TONE: Record<RiskLevel, "danger" | "warning" | "primary"> = { R3: "danger", R2: "warning", R1: "primary" };

const SECTION_META: { key: keyof GetMyTodayOut["sections"]; hint?: "tasks.hint.awaiting_my_judgment" | "tasks.hint.ai_running_for_me" }[] = [
  { key: "awaiting_my_judgment", hint: "tasks.hint.awaiting_my_judgment" },
  { key: "my_push_today" },
  { key: "ai_running_for_me", hint: "tasks.hint.ai_running_for_me" },
  { key: "waiting_on_others" },
];

function LiveCard({ card, onAdvance, onBlock }: {
  card: RenderedTaskCard;
  onAdvance: (id: string) => void;
  onBlock: (id: string) => void;
}) {
  const { locale, t } = useI18n();
  return (
    <article
      data-testid={`tasks-live-card-${card.id}`}
      className="flex flex-col gap-1.5 rounded-md border border-border bg-card p-3 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        {card.riskLevel && (
          <Badge tone={RISK_TONE[card.riskLevel]} data-testid="tasks-risk-badge">{card.riskLevel}</Badge>
        )}
        <h3 className="text-13 font-medium">{card.title}</h3>
        {card.dueAt && <span className="ml-auto text-10 text-muted-foreground">{new Date(card.dueAt).toLocaleDateString(locale)}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-10 text-muted-foreground">
        <span className="inline-flex items-center gap-1" data-testid="tasks-owner-line">
          {card.ownerUserId && <Avatar initials={t("tasks.me")} tone="human" size="xs" />}
          {t("tasks.owner", { owner: t(card.ownerUserId ? "tasks.me" : "tasks.unassigned") })}
        </span>
        {card.executor && (
          <Badge tone={card.executor.kind === "agent" ? "ai" : "neutral"} data-testid="tasks-executor-badge">
            {t(card.executor.kind === "agent" ? "tasks.agentRunning" : "tasks.executor", { id: card.executor.id })}
          </Badge>
        )}
        {card.waitingOn && (
          <span data-testid="tasks-waiting-on">{t("tasks.waiting", { person: card.waitingOn })}</span>
        )}
        {card.syncStatus === "out_of_sync" && <Badge tone="warning">{t("tasks.outOfSync")}</Badge>}
      </div>

      <div className="mt-0.5 flex items-center gap-2">
        <Button size="sm" variant="primary" onClick={() => onAdvance(card.id)} data-testid={`tasks-live-advance-${card.id}`}>{t(`tasks.action.${card.status}`)}</Button>
        <Button size="sm" variant="ghost" disabled={card.status === "todo" || card.status === "inbox"} title={card.status === "todo" || card.status === "inbox" ? t("tasks.backUnavailable") : undefined} onClick={() => onBlock(card.id)} data-testid={`tasks-live-block-${card.id}`}>{t("tasks.back")}</Button>
      </div>
    </article>
  );
}

function NewTaskForm({ projectId, ownerUserId, onCreated }: {
  projectId: string | null;
  ownerUserId: string;
  onCreated: () => void;
}) {
  const { locale, t } = useI18n();
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [dueAt, setDueAt] = React.useState("");
  const [riskLevel, setRiskLevel] = React.useState<string>("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<{ cause: unknown } | null>(null);

  const submit = async () => {
    if (title.trim() === "") return;
    setSubmitting(true);
    setError(null);
    try {
      await createTask({
        projectId,
        title: title.trim(),
        ownerUserId,
        dueAt: dueAt === "" ? null : new Date(dueAt).toISOString(),
        riskLevel: riskLevel === "" ? null : riskLevel,
      });
      setTitle("");
      setDueAt("");
      setRiskLevel("");
      setOpen(false);
      onCreated();
    } catch (e) {
      setError({ cause: e });
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <Button size="sm" variant="primary" onClick={() => setOpen(true)} data-testid="tasks-new-task-live">
        {t("tasks.new")}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border-subtle bg-card p-3" data-testid="tasks-new-task-form">
      <Label className="block" htmlFor="new-task-title">{t("tasks.title")}</Label>
      <Input
        id="new-task-title"
        autoFocus
        placeholder={t("tasks.titlePlaceholder")}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        data-testid="tasks-new-task-title"
      />
      <div className="flex flex-wrap gap-2">
        <div className="space-y-1">
        <Label className="block" htmlFor="new-task-due">{t("tasks.due")}</Label>
        <Input
          id="new-task-due"
          type="date"
          className="rounded-md border border-border-subtle px-2 py-1 text-12"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
          data-testid="tasks-new-task-due"
        />
        </div>
        <div className="space-y-1">
        <Label className="block" htmlFor="new-task-risk">{t("tasks.risk")}</Label>
        <select
          id="new-task-risk"
          className="rounded-md border border-border-subtle px-2 py-1 text-12"
          value={riskLevel}
          onChange={(e) => setRiskLevel(e.target.value)}
          data-testid="tasks-new-task-risk"
        >
          <option value="">{t("tasks.risk")}</option>
          <option value="R1">R1</option>
          <option value="R2">R2</option>
          <option value="R3">R3</option>
        </select>
        </div>
      </div>
      {error && <p role="alert" className="text-11 text-destructive" data-testid="tasks-new-task-error">{describeFailure(error.cause, locale)}</p>}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="primary" disabled={submitting || title.trim() === ""} onClick={submit} data-testid="tasks-new-task-submit">
          {t(submitting ? "tasks.creating" : "tasks.create")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} data-testid="tasks-new-task-cancel">{t("tasks.cancel")}</Button>
      </div>
    </div>
  );
}

/**
 * 选「我的今天」的角色判定锚点项目。
 *
 * ⚠ 此前直接取 `listProjects()[0]`。但 `listProjects` 的入列理由有两种——「持有项目角色」
 * 与「组织 lead/admin 管理」（`application/project/list-projects.ts`），而且会列出
 * `general` 容器；`GET /tasks/today` 的角色判定只读工作坊的 `project_memberships`
 * （`board.controller.ts` `resolveProjectRole`，看板是工作坊机制，见
 * `application/identity/project-layer.ts` 头注）。于是 lead 的第一个项目只要是他
 * 「管理」而非「加入」的、或是一个 `general` 容器，就稳定拿到 403 `NO_PROJECT_ROLE`，
 * 屏上出现一行裸「HTTP 403」。
 *
 * 现在：只在工作坊项目里找，按列表顺序逐个试，403（无看板角色 / 观察者）跳过，
 * 取第一个真正能读的；其它失败照常抛出。
 */
async function findBoardAnchor(
  projects: readonly { id: string; kind: string }[],
): Promise<{ projectId: string; today: GetMyTodayOut } | null> {
  for (const p of projects) {
    if (p.kind !== "workshop") continue;
    try {
      return { projectId: p.id, today: await getMyToday(p.id) };
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) continue;
      throw e;
    }
  }
  return null;
}

export function TodayBoardLive() {
  const { locale, t } = useI18n();
  const { status, session } = useSession();
  const [projectId, setProjectId] = React.useState<string | null>(null);
  const [data, setData] = React.useState<GetMyTodayOut | null>(null);
  const [otherTasks, setOtherTasks] = React.useState<RenderedTaskCard[]>([]);
  const [otherTasksError, setOtherTasksError] = React.useState<{ cause: unknown } | null>(null);
  const [loading, setLoading] = React.useState(false);
  /** 「这个组织还没有项目」与「有项目但没有任务」是两回事，界面上要分开说。 */
  const [noProject, setNoProject] = React.useState(false);
  const [error, setError] = React.useState<{ kind: "load" | "advance" | "back"; cause: unknown } | null>(null);
  /** 组织里有项目、但没有一个是你持有看板角色的（见 `findBoardAnchor`）。 */
  const [hasProjects, setHasProjects] = React.useState(false);

  const refresh = React.useCallback(async () => {
    if (status !== "authenticated" || !session) return;
    setLoading(true);
    setError(null);
    try {
      let pid = projectId;
      let out: GetMyTodayOut | null = null;
      if (pid === null) {
        const projects = await listProjects(session.currentOrgId);
        setHasProjects(projects.length > 0);
        const found = await findBoardAnchor(projects);
        pid = found?.projectId ?? null;
        out = found?.today ?? null;
        setProjectId(pid);
      }
      if (pid === null) {
        // 这个组织一个项目都没有。**这不是错误，但也不能什么都不说**——
        // 改之前这里 `setData(null); return;`，于是界面上只剩标题和一个按钮，
        // 既不是加载中也不是报错，就是一片空白，看起来像加载失败了。
        // 而本地版的新用户**必然**是零项目（装完就没有项目），所以这一屏
        // 是每个新用户都会撞上的第一印象。
        setData(null);
        setNoProject(true);
        return;
      }
      setNoProject(false);
      setOtherTasks([]);
      const today = out ?? (await getMyToday(pid));
      setData(today);
      setOtherTasksError(null);
      try {
        const tasks = await listTasks(pid);
        const todayIds = new Set(Object.values(today.sections).flat().map((card) => card.id));
        setOtherTasks(tasks.cards.filter((card) => card.ownerUserId === session.userId && card.status !== "done" && !todayIds.has(card.id)));
      } catch (e) {
        setOtherTasksError({ cause: e });
      }
    } catch (e) {
      setError({ kind: "load", cause: e });
    } finally {
      setLoading(false);
    }
  }, [status, session, projectId]);

  React.useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, session?.currentOrgId]);

  const advance = async (id: string, card: RenderedTaskCard) => {
    const next = board.TASK_STATUSES[board.TASK_STATUSES.indexOf(card.status) + 1];
    if (!next) return;
    try {
      await changeTaskStatus(id, next);
      await refresh();
    } catch (e) {
      setError({ kind: "advance", cause: e });
    }
  };

  const block = async (id: string, card: RenderedTaskCard) => {
    if (card.status === "todo" || card.status === "inbox") return; // O-27: 没有更早的一格可回退
    const prevRank: Record<string, string> = { in_progress: "todo", review: "in_progress", done: "review" };
    const target = prevRank[card.status];
    if (!target) return;
    try {
      await changeTaskStatus(id, target as never, "退回上一步");
      await refresh();
    } catch (e) {
      setError({ kind: "back", cause: e });
    }
  };

  if (status === "loading") {
    return <div className="p-5 text-12 text-muted-foreground" data-testid="tasks-live-loading">{t("tasks.loading")}</div>;
  }
  if (status !== "authenticated" || !session) {
    return (
      <div className="p-5 text-12 text-muted-foreground" data-testid="tasks-live-signed-out">
        {t("tasks.signedOut")}
      </div>
    );
  }

  const cardsById = new Map<string, RenderedTaskCard>();
  for (const card of otherTasks) cardsById.set(card.id, card);
  if (data) for (const s of SECTION_META) for (const c of data.sections[s.key]) cardsById.set(c.id, c);

  return (
    <div className="flex flex-col gap-5 p-5" data-testid="tasks-live-board">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-20 font-semibold tracking-tight">{t("tasks.heading")}</h1>
          <p className="text-12 text-muted-foreground">{t("tasks.subtitle")}</p>
        </div>
        {projectId && <NewTaskForm projectId={projectId} ownerUserId={session.userId} onCreated={refresh} />}
      </header>

      {error && <p role="alert" className="text-12 text-destructive" data-testid="tasks-live-error">{error.kind === "load" ? describeFailure(error.cause, locale) : t(error.kind === "advance" ? "tasks.advanceFailure" : "tasks.backFailure", { error: describeFailure(error.cause, locale) })}</p>}
      {noProject && !loading && (
        <div
          data-testid="tasks-live-no-project"
          className="rounded-lg border border-dashed border-border px-6 py-10 text-center"
        >
          <p className="text-13 text-card-foreground" data-testid="tasks-live-no-project-title">
            {t(hasProjects ? "tasks.noBoard" : "tasks.noProject")}
          </p>
          <p className="mt-1 text-12 leading-relaxed text-muted-foreground">
            {t("tasks.noBoardDescription")}
            <br />
            {t("tasks.chatAlternative")}
          </p>
          <div className="mt-3 flex items-center justify-center gap-2">
            <Button size="sm" variant="primary" asChild data-testid="tasks-live-no-project-projects">
              <Link href="/projects">{t("tasks.viewProjects")}</Link>
            </Button>
            <Button size="sm" variant="outline" asChild data-testid="tasks-live-no-project-chat">
              <Link href="/chat">{t("tasks.goChat")}</Link>
            </Button>
          </div>
        </div>
      )}
      {loading && !data && <p className="text-12 text-muted-foreground" data-testid="tasks-live-loading-data">{t("tasks.loading")}</p>}

      {data && (
        <div className="flex flex-col gap-6">
          {SECTION_META.map((s) => {
            const cards = data.sections[s.key];
            return (
              <section key={s.key} className="flex flex-col gap-2" data-testid={`tasks-live-section-${s.key}`}>
                <div className="flex items-baseline gap-2">
                  <h2 className="text-14 font-semibold">{t(`tasks.section.${s.key}`)}</h2>
                  <span className="text-12 text-muted-foreground" data-testid={`tasks-live-section-count-${s.key}`}>{cards.length}</span>
                  {s.hint && <span className="text-11 text-muted-foreground">{t("tasks.hintWrapper", { hint: t(s.hint) })}</span>}
                </div>
                {cards.length === 0 ? (
                  <p className="text-11 text-muted-foreground" data-testid={`tasks-live-section-empty-${s.key}`}>{t("tasks.emptySection")}</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {cards.map((c) => (
                      <LiveCard
                        key={c.id}
                        card={c}
                        onAdvance={(id) => void advance(id, cardsById.get(id)!)}
                        onBlock={(id) => void block(id, cardsById.get(id)!)}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}

          <section className="flex flex-col gap-2" data-testid="tasks-live-other-tasks">
            <h2 className="text-14 font-semibold">{t("tasks.otherHeading")}</h2>
            <p className="text-11 text-muted-foreground">{t("tasks.otherDescription")}</p>
            {loading ? <p role="status" className="text-11 text-muted-foreground">{t("tasks.otherLoading")}</p> : otherTasksError ? <div role="alert"><p className="text-12 text-destructive">{t("tasks.otherFailure", { error: describeFailure(otherTasksError.cause, locale) })}</p><Button size="sm" variant="outline" onClick={() => void refresh()}>{t("tasks.otherRetry")}</Button></div> : otherTasks.length === 0 ? <p className="text-11 text-muted-foreground">{t("tasks.otherEmpty")}</p> : otherTasks.map((card) => <LiveCard key={card.id} card={card} onAdvance={(id) => void advance(id, cardsById.get(id)!)} onBlock={(id) => void block(id, cardsById.get(id)!)} />)}
          </section>

          <footer
            data-testid="tasks-today-summary"
            className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-panel p-3"
          >
            {data.summary.sampleSufficient ? (
              <p className="text-12" data-testid="tasks-summary-value">
                {t("tasks.summary.completed", { count: data.summary.aiCompletedCount })}{t("tasks.summary.converted", { hours: data.summary.personHours, version: data.summary.coefficientTableVersion })}
              </p>
            ) : (
              <p className="text-12" data-testid="tasks-summary-low-sample-demo">
                {t("tasks.summary.completed", { count: data.summary.aiCompletedCount })} · <span className="text-warning">{t("tasks.summary.lowSample")}</span>
              </p>
            )}
            <p className="text-10 text-muted-foreground" data-testid="tasks-summary-coefficient-note">
              {t("tasks.summary.note")}
            </p>
            <p className="text-11 font-medium text-background-foreground">{t("tasks.summary.responsibility")}</p>
          </footer>
        </div>
      )}
    </div>
  );
}
