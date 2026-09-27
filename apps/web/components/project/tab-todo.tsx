"use client";
import * as React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SectionTitle, ObserverNotice } from "./parts";
import { observerHidden, type ProjectRole } from "@/lib/project-workbench";
import { ApiError, getStoredSessionToken } from "@/lib/api-client";
import { httpFailureText } from "@/lib/http-failure-text";
import { listTasks, type ListTasksOut, type RenderedTaskCard, type RiskLevel } from "@/lib/live-tasks";

/**
 * 待办看板（项目中枢 B2-S2）——读真实任务板：`listTasks(projectId, "project")`。
 *
 * 列的顺序与内容由服务端 `columns` 给（`{ status, cardIds }`），这里不重排、不编造；
 * 卡片只展示后端真实给的字段（负责人 / 执行者 / 到期 / 风险 / 在等谁），同 `tasks/today-board-live.tsx`。
 * 观察者：服务端对观察者回 403 `OBSERVER_CANNOT_VIEW_BOARD`；前端投影同一条规则——先挂说明条、不发请求
 *（真实权限在服务端，这里只是少一次注定 403 的往返）。
 * ⚠ 此前这一页是硬编码空态（更早是 mock 卡片）；现在没有 `projectId`（预览壳）时仍是如实空态。
 */
const STATUS_LABEL: Record<string, string> = {
  inbox: "收件箱", todo: "待办", in_progress: "进行中", review: "待复核", done: "已完成",
};
const RISK_TONE: Record<RiskLevel, "danger" | "warning" | "primary"> = { R3: "danger", R2: "warning", R1: "primary" };

export function TabTodo({ view, projectId }: { view: ProjectRole; readOnly?: boolean; projectId?: string }) {
  const isObserver = observerHidden(view);
  const [data, setData] = React.useState<ListTasksOut | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!projectId || isObserver || !getStoredSessionToken()) { setData(null); return; }
    let active = true;
    setLoading(true); setError(null);
    listTasks(projectId, "project")
      .then((out) => { if (active) setData(out); })
      .catch((e: unknown) => { if (active) setError(describeFailure(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId, isObserver]);

  const byId = new Map((data?.cards ?? []).map((c) => [c.id, c]));
  const columns = (data?.columns ?? []).map((col) => ({
    status: col.status,
    cards: col.cardIds.map((id) => byId.get(id)).filter((c): c is RenderedTaskCard => c !== undefined),
  }));
  const total = data?.cards.length ?? 0;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-3 p-6" data-testid="project-todo">
      <SectionTitle
        meta={data ? `${total} 张卡 · 逾期 ${data.footer.overdue} · 今天到期 ${data.footer.dueToday}` : "会前任务、现场行动项、报告待补都汇到这里"}
        className="mb-0"
      >
        待办看板
      </SectionTitle>
      {isObserver ? (
        <ObserverNotice
          testId="project-todo-observer-notice"
          what="待办看板是项目内部的协作视图，逐张卡片不在观察者只读范围内。"
        />
      ) : error !== null ? (
        <Card><p className="p-4 text-11 text-destructive" data-testid="project-todo-error">{error}</p></Card>
      ) : loading && data === null ? (
        <Card><p className="p-4 text-11 text-muted-foreground" data-testid="project-todo-loading">读取待办中…</p></Card>
      ) : data === null || total === 0 ? (
        <Card>
          <p className="p-4 text-11 leading-relaxed text-muted-foreground" data-testid="project-todo-empty">
            {data === null && projectId && !getStoredSessionToken() ? "请先登录。" : "本项目还没有待办。"}
          </p>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" data-testid="project-todo-board">
          {columns.map((col) => (
            <section key={col.status} className="flex min-w-0 flex-col gap-2" data-testid={`project-todo-column-${col.status}`}>
              <h4 className="flex items-center gap-1.5 px-1 text-10 font-medium uppercase tracking-wide text-muted-foreground">
                {STATUS_LABEL[col.status] ?? col.status}
                <span className="text-muted-foreground/70">{col.cards.length}</span>
              </h4>
              {col.cards.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-3 py-2 text-10 text-muted-foreground">空</p>
              ) : col.cards.map((card) => <TodoCard key={card.id} card={card} />)}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function TodoCard({ card }: { card: RenderedTaskCard }) {
  return (
    <article data-testid={`project-todo-card-${card.id}`} className="flex flex-col gap-1.5 rounded-md border border-border bg-card p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        {card.riskLevel && <Badge tone={RISK_TONE[card.riskLevel]}>{card.riskLevel}</Badge>}
        <h5 className="text-12 font-medium">{card.title}</h5>
        {card.dueAt && <span className="ml-auto text-10 text-muted-foreground">{new Date(card.dueAt).toLocaleDateString()}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-10 text-muted-foreground">
        <span>负责人 {card.ownerUserId ?? "未指派"}</span>
        {card.executor && (
          <Badge tone={card.executor.kind === "agent" ? "ai" : "neutral"}>
            {card.executor.kind === "agent" ? `${card.executor.id} 在跑` : `执行者 ${card.executor.id}`}
          </Badge>
        )}
        {card.waitingOn && <span>在等 {card.waitingOn}</span>}
        {card.syncStatus === "out_of_sync" && <Badge tone="warning">未同步</Badge>}
      </div>
    </article>
  );
}

function describeFailure(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.reasonCode) {
      case "OBSERVER_CANNOT_VIEW_BOARD": return "待办看板是项目内部的协作视图，观察者看不到逐张卡片。";
      case "NO_PROJECT_ROLE": return "你不在这个项目里，看不到项目内的待办。";
      case "AUTH_SERVICE_UNAVAILABLE": return "身份校验服务暂时不可用，请稍后重试。";
    }
    if (e.status === 401) return "登录已失效，请重新登录。";
    return httpFailureText(e.status);
  }
  return e instanceof Error ? e.message : "操作失败，请稍后重试。";
}
