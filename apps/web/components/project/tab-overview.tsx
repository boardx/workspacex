"use client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SectionTitle, StatChip, MetaSep, ObserverNotice } from "./parts";
import {
  OVERVIEW_STATUS, CURRENT_SEGMENT, OVERVIEW_TODOS, ACTIVITY_FEED, PROJECT_HEADER,
  ROLE_CAN_WRITE, PROJECT_ROLE_LABEL, observerHidden, type ProjectRole,
} from "@/lib/mock/project";

/**
 * 概览（净新）—— 原型 isWsOver 的转译。
 * 项目在研究的问题 + 现场状态条 + 当前环节（三角色分工卡）+ 待办预览 + 最新动态。
 * ⚠ 用「就绪检查 3/3」而非「准备度 %」：后者口径 uc-2-2 已登记 [待确认]，不在本域编分母。
 * ⚠ 观察者显著更少：当前环节分工、待办、动态属**内部协作视图**，整块消失（不是变灰）。
 */
export function TabOverview({ view, readOnly = false }: { view: ProjectRole; readOnly?: boolean }) {
  const canWrite = ROLE_CAN_WRITE[view] && !readOnly;
  const isObserver = observerHidden(view);
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-6" data-testid="project-overview">
      {/* 项目在研究的问题 */}
      <header className="flex flex-col gap-2">
        <h2 className="max-w-2xl text-18 font-semibold leading-snug" data-testid="project-overview-question">
          {PROJECT_HEADER.question}
        </h2>
        <div className="flex flex-wrap items-center gap-3 text-11 text-muted-foreground">
          <span>{PROJECT_HEADER.org}集团</span>
          <span>引导师 {PROJECT_HEADER.facilitatorName}</span>
          <span>{PROJECT_HEADER.reportDate}</span>
        </div>
      </header>

      {/* 现场状态条（聚合，四视角都能看） */}
      <div
        data-testid="project-overview-statusbar"
        className="flex flex-wrap items-center gap-2.5 rounded-lg border border-border bg-panel px-3.5 py-2.5"
      >
        <StatChip tone="neutral" testId="project-overview-phase">
          <span className="rounded-sm bg-inverse px-1.5 py-0.5 text-inverse-foreground">{OVERVIEW_STATUS.phase}</span>
        </StatChip>
        <span className="text-11">{OVERVIEW_STATUS.segment}</span>
        <MetaSep />
        <span className="text-11 text-success">{OVERVIEW_STATUS.readyCheck}</span>
        <MetaSep />
        <span className="text-11 text-muted-foreground">{OVERVIEW_STATUS.attendance}</span>
        <span className="flex-1" />
        <span className="text-10 text-muted-foreground">{OVERVIEW_STATUS.timing}</span>
      </div>

      {isObserver ? (
        <ObserverNotice
          testId="project-overview-observer-notice"
          what="当前环节的三角色分工、内部待办与协作动态属于内部协作视图，不在观察者只读范围内。你能看到的是上方的项目问题与现场进度聚合。"
        />
      ) : (
        <>
          {/* 当前环节：三角色分工卡（现场同一环节，三种视角各看到什么、各该做什么） */}
          <Card data-testid="project-overview-current-segment">
            <div className="flex items-center gap-3 rounded-t-lg bg-inverse px-4 py-3 text-inverse-foreground">
              <span aria-hidden className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-destructive" />
              <div className="min-w-0 flex-1 truncate text-14 font-medium">{CURRENT_SEGMENT.title}</div>
              <div className="shrink-0 font-mono text-18 tabular-nums">{CURRENT_SEGMENT.countdown}</div>
            </div>
            <div className="grid grid-cols-1 divide-y divide-border border-t border-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              {CURRENT_SEGMENT.roles.map((r) => (
                <div key={r.role} className="flex flex-col gap-2 p-3.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-10 font-medium uppercase tracking-wide text-muted-foreground">
                      {r.self ? PROJECT_ROLE_LABEL[r.role] : r.count}
                    </span>
                    {r.self && <span className="rounded-sm bg-muted px-1 text-9 font-mono">你</span>}
                  </div>
                  <p className="text-11 leading-relaxed text-card-foreground">
                    {r.note}
                    {"warn" in r && r.warn && <span className="text-destructive"> {r.warn}</span>}
                  </p>
                  {canWrite && (
                    <Button size="xs" variant="outline" className="self-start" data-testid={`project-overview-role-cta-${r.role}`}>
                      {r.action}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-[1.25fr_1fr]">
            {/* 待办预览 */}
            <section>
              <SectionTitle meta="3 项 · 1 项阻塞">待办</SectionTitle>
              <Card>
                <ul className="divide-y divide-border" data-testid="project-overview-todos">
                  {OVERVIEW_TODOS.map((t) => (
                    <li key={t.id} className="flex items-center gap-3 px-3.5 py-3">
                      <span aria-hidden className="h-3.5 w-3.5 shrink-0 rounded border-[1.5px] border-border" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-12">{t.title}</div>
                        <div className="truncate text-10 text-muted-foreground">{t.sub}</div>
                      </div>
                      <span className={
                        t.tone === "danger" ? "shrink-0 font-mono text-10 text-destructive"
                          : t.tone === "warning" ? "shrink-0 font-mono text-10 text-warning"
                            : "shrink-0 font-mono text-10 text-muted-foreground"
                      }>{t.tag}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>

            {/* 最新动态（人与 AI 混合） */}
            <section>
              <SectionTitle>最新动态</SectionTitle>
              <ul className="flex flex-col" data-testid="project-overview-activity">
                {ACTIVITY_FEED.map((a) => (
                  <li key={a.id} className="flex items-center gap-2.5 border-b border-border py-2.5 last:border-0">
                    <span aria-hidden className={cnAvatar(a.kind)}>{a.who.slice(0, 2)}</span>
                    <span className="min-w-0 flex-1 truncate text-11">{a.text}</span>
                    <span className="shrink-0 font-mono text-10 text-muted-foreground">{a.time}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function cnAvatar(kind: "ai" | "person") {
  return [
    "grid h-5 w-5 shrink-0 place-items-center text-9 font-semibold",
    kind === "ai"
      ? "rounded-md bg-ai-tint text-ai-tint-foreground"
      : "rounded-full bg-muted text-muted-foreground",
  ].join(" ");
}
