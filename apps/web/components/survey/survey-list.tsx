"use client";
import * as React from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  SURVEY_LIST, SURVEY_STATUS_LABEL, SURVEY_STATUS_ACTION, SURVEY_SCOPES, SURVEY_TAGS,
  surveyStatusCounts, missingRoster,
  type SurveyStatus, type SurveyScope, type SurveyTag,
} from "@/lib/mock/survey";

/**
 * 问卷 · 左栏：问卷列表（UC-12.1）。
 * 范围切换（本项目 ｜ 不属于任何项目）与标签筛选与研究 / 访谈 / 原型三个 Studio 共用同一套口径
 * （UC-12.1 R7.4）；状态快捷筛选四态计数须与列表实际分布一致（UC-12.2 R7.6）。
 * 点选切换当前问卷（本地高亮，不落库）。
 */
const STATUS_TONE: Record<SurveyStatus, "primary" | "warning" | "neutral" | "outline"> = {
  collecting: "warning", pending_send: "outline", draft: "neutral", closed: "primary",
};

export function SurveyList({ activeId = "sv-1" }: { activeId?: string }) {
  const [active, setActive] = React.useState(activeId);
  const [scope, setScope] = React.useState<SurveyScope>("project");
  const [tag, setTag] = React.useState<SurveyTag>("all");
  const [statusFilter, setStatusFilter] = React.useState<"all" | SurveyStatus>("all");
  const counts = surveyStatusCounts();
  const missing = missingRoster();

  const visible = SURVEY_LIST.filter((s) => {
    if (s.scope !== scope) return false;
    if (tag !== "all" && !s.tags.includes(tag)) return false;
    if (statusFilter !== "all" && s.status !== statusFilter) return false;
    return true;
  });

  return (
    <div className="flex flex-col gap-3 p-3" data-testid="survey-list">
      <div className="flex items-center justify-between">
        <h2 className="text-13 font-semibold">问卷 · {SURVEY_LIST.length}</h2>
        <div className="flex items-center gap-1">
          <Button size="xs" variant="outline" asChild data-testid="survey-new-from-template">
            <Link href="/chat">从模板新建</Link>
          </Button>
          <Button size="xs" variant="primary" asChild data-testid="survey-new">
            <Link href="/chat">＋ 新建问卷</Link>
          </Button>
        </div>
      </div>
      <p className="text-10 text-muted-foreground">
        打开任意一份进入问卷工作台——和全局「问卷 Studio」是同一套编辑与分析界面。
        每份问卷发布前必须映射到一个报告模板，没映射完的题不能发布。
      </p>

      {/* 范围切换：本项目 ｜ 不属于任何项目（UC-12.1 R7.4）*/}
      <div className="flex items-center gap-1" data-testid="survey-scope-switcher">
        {SURVEY_SCOPES.map((s) => (
          <Button
            key={s.id} size="xs" variant={s.id === scope ? "primary" : "ghost"}
            onClick={() => setScope(s.id)} data-testid={`survey-scope-${s.id}`}
          >
            {s.label}
          </Button>
        ))}
      </div>

      {/* 状态快捷筛选：全部 / 草稿 / 待发出 / 回收中 / 已截止（计数与四态分布一致）*/}
      <div className="flex flex-wrap items-center gap-1.5" data-testid="survey-status-filter">
        <button
          type="button" onClick={() => setStatusFilter("all")} data-testid="survey-status-filter-all"
          className={"rounded-full px-2.5 py-1 text-10 " + (statusFilter === "all" ? "bg-inverse text-inverse-foreground" : "border border-border-subtle text-muted-foreground")}
        >
          全部 {SURVEY_LIST.length}
        </button>
        {(Object.keys(SURVEY_STATUS_LABEL) as SurveyStatus[]).map((st) => (
          <button
            key={st} type="button" onClick={() => setStatusFilter(st)} data-testid={`survey-status-filter-${st}`}
            className={"rounded-full border px-2.5 py-1 text-10 " + (statusFilter === st ? "border-inverse bg-inverse text-inverse-foreground" : "border-border-subtle text-muted-foreground")}
          >
            {SURVEY_STATUS_LABEL[st]} {counts[st]}
          </button>
        ))}
      </div>

      {/* 标签筛选：与其它 Studio 共用同一套标签体系 */}
      <div className="flex flex-wrap items-center gap-1" data-testid="survey-tag-filter">
        {SURVEY_TAGS.map((t) => (
          <button
            key={t.id} type="button" onClick={() => setTag(t.id)} data-testid={`survey-tag-${t.id}`}
            className={"rounded-md border px-2 py-0.5 text-10 " + (t.id === tag ? "border-primary text-primary" : "border-border-subtle text-muted-foreground")}
          >
            {t.label}
          </button>
        ))}
      </div>

      <ul className="flex flex-col gap-1.5">
        {visible.map((s) => {
          const primaryLabel = s.status === "collecting"
            ? `催未交的 ${s.recovery ? s.recovery.total - s.recovery.submitted : missing.length} 人`
            : SURVEY_STATUS_ACTION[s.status];
          return (
            <li key={s.id} data-testid={`survey-item-${s.id}`}>
              <button
                type="button"
                onClick={() => setActive(s.id)}
                aria-pressed={s.id === active}
                data-testid={`survey-item-select-${s.id}`}
                className={
                  "flex w-full flex-col gap-1 rounded-md border p-2 text-left transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
                  (s.id === active ? "border-primary bg-accent" : "border-border-subtle bg-card")
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-12 font-medium">{s.title}</span>
                  <Badge tone={STATUS_TONE[s.status]}>{SURVEY_STATUS_LABEL[s.status]}</Badge>
                </div>
                <span className="text-10 text-muted-foreground">
                  {s.anonymity} · {s.questionCount} 题 · {s.meta}
                </span>
                {s.status === "pending_send" && s.triggerNote && (
                  <span className="text-10 text-muted-foreground">{s.triggerNote}</span>
                )}
                {s.recovery && (s.status === "collecting" || s.status === "closed") && (
                  <span className="font-mono text-10 text-muted-foreground">
                    {s.recovery.submitted}/{s.recovery.total}
                    {s.recovery.medianDuration ? ` · 中位 ${s.recovery.medianDuration}` : ""}
                    {s.recovery.insights ? ` · ${s.recovery.insights} 条洞察` : ""}
                    {s.recovery.dueDate ? ` · ${s.recovery.dueDate}截止` : ""}
                  </span>
                )}
                <span className="inline-flex w-fit items-center rounded-sm border border-border-subtle px-1.5 py-0.5 text-10 text-muted-foreground" data-testid={`survey-item-action-${s.id}`}>
                  {primaryLabel}
                </span>
                <span className="text-10 text-muted-foreground">{s.version}</span>
              </button>
            </li>
          );
        })}
        {visible.length === 0 && (
          <li className="rounded-md border border-dashed border-border-subtle p-3 text-11 text-muted-foreground" data-testid="survey-list-empty">
            本范围下没有匹配的问卷——切换范围/标签，或新建一份。
          </li>
        )}
      </ul>
    </div>
  );
}
