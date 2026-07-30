"use client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SectionTitle, StatChip, ObserverNotice } from "./parts";
import {
  KANBAN_COLUMNS, KANBAN_CARDS, ROLE_CAN_WRITE, observerHidden, type ProjectRole,
} from "@/lib/mock/project";

/**
 * 待办看板（净新，原型 isWsTodo · 四列）—— 卡片来源自动同步：
 * 会前任务 / 现场行动项 / 报告缺料 / 决策后续。状态改了回写原处（此原型不真回写）。
 * ⚠ 观察者显著更少：整个看板是内部协作视图，**卡片明细整块消失**，只留每列计数聚合。
 * ⚠ 组员/组长可见看板但只读（不可拖）；新建/加卡仅 canWrite。
 */
export function TabTodo({ view, readOnly = false }: { view: ProjectRole; readOnly?: boolean }) {
  const canWrite = ROLE_CAN_WRITE[view] && !readOnly;
  const isObserver = observerHidden(view);

  if (isObserver) {
    return (
      <div className="flex h-full flex-col gap-3 p-6" data-testid="project-todo">
        <SectionTitle meta="内部协作视图" className="mb-0">待办看板</SectionTitle>
        <ObserverNotice
          testId="project-todo-observer-notice"
          what="待办看板是项目内部的协作视图，逐张卡片不在观察者只读范围内。你能看到的是下方每列的数量聚合。"
        />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="project-todo-observer-counts">
          {KANBAN_COLUMNS.map((col) => (
            <Card key={col.key} data-testid={`project-todo-count-${col.key}`}>
              <div className="flex flex-col items-center gap-1 p-4">
                <span className="font-mono text-18 tabular-nums">{KANBAN_CARDS.filter((c) => c.col === col.key).length}</span>
                <span className="text-10 text-muted-foreground">{col.label}</span>
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 p-6" data-testid="project-todo">
      <div className="flex flex-wrap items-center gap-2.5">
        <SectionTitle meta="会前任务、现场行动项、报告待补都汇到这里 · 拖动改状态" className="mb-0">待办看板</SectionTitle>
        <span className="flex-1" />
        <StatChip tone="danger" testId="project-todo-overdue">逾期 1 · 今天到期 2</StatChip>
        {canWrite && <Button size="sm" variant="primary" data-testid="project-todo-new">＋ 新建待办</Button>}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-4" data-testid="project-todo-board">
        {KANBAN_COLUMNS.map((col) => {
          const cards = KANBAN_CARDS.filter((c) => c.col === col.key);
          return (
            <div key={col.key} className="flex min-h-0 flex-col rounded-lg border border-border bg-panel" data-testid={`project-todo-col-${col.key}`}>
              <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
                <span className="text-12 font-medium">{col.label}</span>
                <span className="font-mono text-10 text-muted-foreground">{cards.length}</span>
              </div>
              <div className="flex flex-col gap-2 overflow-y-auto p-2.5">
                {cards.map((c) => (
                  <Card key={c.id} draggable={canWrite} data-testid={`project-todo-card-${c.id}`} className="cursor-default">
                    <div className="flex flex-col gap-1.5 p-2.5">
                      <div className="text-11 leading-snug">{c.title}</div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatChip>{c.source}</StatChip>
                        {c.blocked && <StatChip tone="danger">阻塞</StatChip>}
                        {c.overdue && <StatChip tone="warning">逾期</StatChip>}
                      </div>
                      <div className="flex items-center gap-2 text-10 text-muted-foreground">
                        <span className="flex-1">责任人 {c.owner}</span>
                        {c.due && <span className="font-mono">{c.due}</span>}
                      </div>
                    </div>
                  </Card>
                ))}
                {canWrite && (
                  <Button size="sm" variant="ghost" className="justify-start transition-colors" data-testid={`project-todo-add-${col.key}`}>＋ 加一张</Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-10 text-muted-foreground">卡片来源自动同步：会前任务、现场行动项、报告缺料、决策的后续动作。状态改了会回写到原处。</p>
    </div>
  );
}
