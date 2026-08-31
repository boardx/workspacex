"use client";
import * as React from "react";
import { useSession } from "@/components/session/session-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { ApiError } from "@/lib/api-client";
import { listProjects } from "@/lib/live-projects";
import {
  changeTaskStatus, createTask, getMyToday,
  type GetMyTodayOut, type RenderedTaskCard, type RiskLevel,
} from "@/lib/live-tasks";

/**
 * F02/F06 —— `/tasks` 的真实数据路径。
 *
 * 与 `today-board.tsx`（纯 mock 演示，`?state=` 七态预览用）并存，不是替换它——
 * 那个组件是设计签核用的视觉原型（F06 notes: "UI 已建成于 apps/web /tasks"），这个
 * 组件是接了真实后端之后的功能路径。`page.tsx` 按是否已登录选择渲染哪一个。
 *
 * ## 范围收窄（如实记录）
 *
 * - 「我的今天」的跨项目聚合本次收窄成"取第一个可见项目作为角色判定锚点"
 *   （见 `live-tasks.ts` 头注）——不是真正的多项目求并集，那是 F04 的范围。
 * - 卡片信息密度远低于 mock 原型（没有 agent 步骤/进度、没有完成标准 X/Y、
 *   没有"等待时长"）——那些字段依赖 F03/F05/F07/F08 尚未建的能力，展示编造的数字
 *   比不展示更糟。这里只展示后端真实能给的字段。
 */

const RISK_TONE: Record<RiskLevel, "danger" | "warning" | "primary"> = { R3: "danger", R2: "warning", R1: "primary" };

const SECTION_META: { key: keyof GetMyTodayOut["sections"]; title: string; hint?: string }[] = [
  { key: "awaiting_my_judgment", title: "等我判断", hint: "AI 停在这里，不会绕过你继续" },
  { key: "my_push_today", title: "今天该我推进" },
  { key: "ai_running_for_me", title: "AI 正在替我跑", hint: "只给一行摘要" },
  { key: "waiting_on_others", title: "下一步轮到别人" },
];

function LiveCard({ card, onAdvance, onBlock }: {
  card: RenderedTaskCard;
  onAdvance: (id: string) => void;
  onBlock: (id: string) => void;
}) {
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
        {card.dueAt && <span className="ml-auto text-10 text-muted-foreground">{new Date(card.dueAt).toLocaleDateString()}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-10 text-muted-foreground">
        <span className="inline-flex items-center gap-1" data-testid="tasks-owner-line">
          {card.ownerUserId && <Avatar initials={card.ownerUserId.slice(0, 1).toUpperCase()} tone="human" size="xs" />}
          负责人 {card.ownerUserId ?? "未指派"}
        </span>
        {card.executor && (
          <Badge tone={card.executor.kind === "agent" ? "ai" : "neutral"} data-testid="tasks-executor-badge">
            {card.executor.kind === "agent" ? `${card.executor.id} 在跑` : `执行者 ${card.executor.id}`}
          </Badge>
        )}
        {card.waitingOn && (
          <span data-testid="tasks-waiting-on">在等 {card.waitingOn}</span>
        )}
        {card.syncStatus === "out_of_sync" && <Badge tone="warning">未同步</Badge>}
      </div>

      <div className="mt-0.5 flex items-center gap-2">
        <Button size="sm" variant="primary" onClick={() => onAdvance(card.id)} data-testid={`tasks-live-advance-${card.id}`}>推进</Button>
        <Button size="sm" variant="ghost" onClick={() => onBlock(card.id)} data-testid={`tasks-live-block-${card.id}`}>标记阻塞</Button>
      </div>
    </article>
  );
}

function NewTaskForm({ projectId, ownerUserId, onCreated }: {
  projectId: string | null;
  ownerUserId: string;
  onCreated: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [dueAt, setDueAt] = React.useState("");
  const [riskLevel, setRiskLevel] = React.useState<string>("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

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
      setError(e instanceof ApiError ? e.reasonCode ?? `HTTP ${e.status}` : e instanceof Error ? e.message : "未知错误");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <Button size="sm" variant="primary" onClick={() => setOpen(true)} data-testid="tasks-new-task-live">
        ＋ 新建任务
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border-subtle bg-card p-3" data-testid="tasks-new-task-form">
      <input
        className="rounded-md border border-border-subtle px-2 py-1 text-12"
        placeholder="标题"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        data-testid="tasks-new-task-title"
      />
      <div className="flex flex-wrap gap-2">
        <input
          type="date"
          className="rounded-md border border-border-subtle px-2 py-1 text-12"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
          data-testid="tasks-new-task-due"
        />
        <select
          className="rounded-md border border-border-subtle px-2 py-1 text-12"
          value={riskLevel}
          onChange={(e) => setRiskLevel(e.target.value)}
          data-testid="tasks-new-task-risk"
        >
          <option value="">风险等级（可选）</option>
          <option value="R1">R1</option>
          <option value="R2">R2</option>
          <option value="R3">R3</option>
        </select>
      </div>
      {error && <p className="text-11 text-destructive" data-testid="tasks-new-task-error">{error}</p>}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="primary" disabled={submitting || title.trim() === ""} onClick={submit} data-testid="tasks-new-task-submit">
          {submitting ? "创建中…" : "创建"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} data-testid="tasks-new-task-cancel">取消</Button>
      </div>
    </div>
  );
}

export function TodayBoardLive() {
  const { status, session } = useSession();
  const [projectId, setProjectId] = React.useState<string | null>(null);
  const [data, setData] = React.useState<GetMyTodayOut | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    if (status !== "authenticated" || !session) return;
    setLoading(true);
    setError(null);
    try {
      let pid = projectId;
      if (pid === null) {
        const projects = await listProjects(session.currentOrgId);
        pid = projects[0]?.id ?? null;
        setProjectId(pid);
      }
      if (pid === null) {
        setData(null);
        return;
      }
      const out = await getMyToday(pid);
      setData(out);
    } catch (e) {
      setError(e instanceof ApiError ? e.reasonCode ?? `HTTP ${e.status}` : e instanceof Error ? e.message : "未知错误");
    } finally {
      setLoading(false);
    }
  }, [status, session, projectId]);

  React.useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, session?.currentOrgId]);

  const advance = async (id: string, card: RenderedTaskCard) => {
    const next = card.status === "todo" ? "in_progress" : card.status === "in_progress" ? "review" : card.status === "review" ? "done" : "done";
    try {
      await changeTaskStatus(id, next);
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.reasonCode ?? `HTTP ${e.status}` : "推进失败");
    }
  };

  const block = async (id: string, card: RenderedTaskCard) => {
    if (card.status === "todo" || card.status === "inbox") return; // O-27: 没有更早的一格可回退
    const prevRank: Record<string, string> = { in_progress: "todo", review: "in_progress", done: "review" };
    const target = prevRank[card.status];
    if (!target) return;
    try {
      await changeTaskStatus(id, target as never, "标记阻塞（前端演示按钮）");
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.reasonCode ?? `HTTP ${e.status}` : "标记阻塞失败");
    }
  };

  if (status === "loading") {
    return <div className="p-5 text-12 text-muted-foreground" data-testid="tasks-live-loading">加载中…</div>;
  }
  if (status !== "authenticated" || !session) {
    return (
      <div className="p-5 text-12 text-muted-foreground" data-testid="tasks-live-signed-out">
        请先登录以查看真实的「我的今天」。
      </div>
    );
  }

  const cardsById = new Map<string, RenderedTaskCard>();
  if (data) for (const s of SECTION_META) for (const c of data.sections[s.key]) cardsById.set(c.id, c);

  return (
    <div className="flex flex-col gap-5 p-5" data-testid="tasks-live-board">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-20 font-semibold tracking-tight">我的今天</h1>
          <p className="text-12 text-muted-foreground">最重要的是什么 · 下一步轮到谁 · 什么在等我判断。</p>
        </div>
        <NewTaskForm projectId={projectId} ownerUserId={session.userId} onCreated={refresh} />
      </header>

      {error && <p className="text-12 text-destructive" data-testid="tasks-live-error">{error}</p>}
      {loading && !data && <p className="text-12 text-muted-foreground" data-testid="tasks-live-loading-data">加载中…</p>}

      {data && (
        <div className="flex flex-col gap-6">
          {SECTION_META.map((s) => {
            const cards = data.sections[s.key];
            return (
              <section key={s.key} className="flex flex-col gap-2" data-testid={`tasks-live-section-${s.key}`}>
                <div className="flex items-baseline gap-2">
                  <h2 className="text-14 font-semibold">{s.title}</h2>
                  <span className="text-12 text-muted-foreground" data-testid={`tasks-live-section-count-${s.key}`}>{cards.length}</span>
                  {s.hint && <span className="text-11 text-muted-foreground">（{s.hint}）</span>}
                </div>
                {cards.length === 0 ? (
                  <p className="text-11 text-muted-foreground" data-testid={`tasks-live-section-empty-${s.key}`}>没有等你的事</p>
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

          <footer
            data-testid="tasks-today-summary"
            className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-panel p-3"
          >
            {data.summary.sampleSufficient ? (
              <p className="text-12" data-testid="tasks-summary-value">
                今日 AI 完成 {data.summary.aiCompletedCount} 项、折算 {data.summary.personHours} 人时
                （按 {data.summary.coefficientTableVersion} 估算）。
              </p>
            ) : (
              <p className="text-12" data-testid="tasks-summary-low-sample-demo">
                今日 AI 完成 {data.summary.aiCompletedCount} 项 · <span className="text-warning">样本不足，暂不折算人时</span>
              </p>
            )}
            <p className="text-10 text-muted-foreground" data-testid="tasks-summary-coefficient-note">
              折算系数、口径表版本与最小样本量阈值由组织可配口径表提供；样本不足或口径表未配置时不显示折算值，不编造数字。
            </p>
            <p className="text-11 font-medium text-background-foreground">责任人始终是人——AI 只拿到行动权，不承担验收。</p>
          </footer>
        </div>
      )}
    </div>
  );
}
