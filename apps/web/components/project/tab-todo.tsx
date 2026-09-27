"use client";
import { Card } from "@/components/ui/card";
import { SectionTitle, ObserverNotice } from "./parts";
import { observerHidden, type ProjectRole } from "@/lib/project-workbench";

/**
 * 待办看板（原型 isWsTodo · 四列）。
 *
 * ⚠ 此前整页渲染 `lib/mock/project.ts` 的 8 张虚构卡片（拖动改状态也是假的）。现已删除 mock，
 *   如实空态：项目维度的待办读写接口尚未接通，本版不显示编造卡片、也不放不落库的新建按钮。
 * ⚠ 观察者：看板是内部协作视图，逐张卡片不在只读范围内。
 */
export function TabTodo({ view }: { view: ProjectRole; readOnly?: boolean }) {
  const isObserver = observerHidden(view);
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-3 p-6" data-testid="project-todo">
      <SectionTitle meta="会前任务、现场行动项、报告待补将汇到这里" className="mb-0">待办看板</SectionTitle>
      {isObserver && (
        <ObserverNotice
          testId="project-todo-observer-notice"
          what="待办看板是项目内部的协作视图，逐张卡片不在观察者只读范围内。"
        />
      )}
      <Card>
        <p className="p-4 text-11 leading-relaxed text-muted-foreground" data-testid="project-todo-empty">
          本项目还没有待办。项目维度的待办尚未接通。
        </p>
      </Card>
    </div>
  );
}
