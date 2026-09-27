"use client";
import { Card } from "@/components/ui/card";
import { SectionTitle, ObserverNotice } from "./parts";
import { observerHidden, type ProjectRole } from "@/lib/project-workbench";

/**
 * 设置（原型 isWsSetup）。
 *
 * ⚠ 此前整页渲染 `lib/mock/project.ts` 的虚构配置（参与者名单、AI 权限开关、留存 180 天、
 *   写回组织大脑开关……），开关不落库、所有项目一样。现已删除 mock，如实空态：
 *   项目设置在契约里还没有读写接口；成员管理见概览 / 筹备里已接真的部分。
 * ⚠ 观察者：配置区不在只读范围内。
 */
export function TabSettings({ view }: { view: ProjectRole; readOnly?: boolean }) {
  const isObserver = observerHidden(view);
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-6" data-testid="project-settings">
      {isObserver && (
        <ObserverNotice
          testId="project-settings-observer-notice"
          what="设置是项目配置区（工作流 / 参与者 / AI 权限 / 知识图谱 / 留存），不在观察者只读范围内。"
        />
      )}
      <section>
        <SectionTitle meta="这场项目的配置枢纽">设置</SectionTitle>
        <Card>
          <p className="p-4 text-11 leading-relaxed text-muted-foreground" data-testid="project-settings-empty">
            项目设置（参与者与邀请、AI 权限、知识图谱、产出与留存）尚未接通，暂无可显示或可修改的配置。
          </p>
        </Card>
      </section>
    </div>
  );
}
