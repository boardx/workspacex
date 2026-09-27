"use client";
import { Card } from "@/components/ui/card";
import { SectionTitle, ObserverNotice } from "./parts";
import { ROLE_STAGE_CONTROL, observerHidden, type ProjectRole } from "@/lib/project-workbench";
import { ProjectInvitePanel } from "./project-invite-panel";
import { ProjectMembersPanel } from "./project-members-panel";

/**
 * 设置（原型 isWsSetup）。
 *
 * ⚠ 此前整页渲染 `lib/mock/project.ts` 的虚构配置（参与者名单、AI 权限开关、留存 180 天、
 *   写回组织大脑开关……），开关不落库、所有项目一样。现已删除 mock。
 * ⚠ 项目中枢 R2：新增「邀请成员」面板（引导师视角）——项目是受邀才能进的容器，邀请从这里发。
 * ⚠ 项目中枢 R3：新增「项目成员」面板——名单所有非观察者可读；指派 / 改角色 / 移出只在引导师视角
 *   给控件（服务端 `authorizeManageMembers` 才是判定，组织 lead/admin 越过前端投影也能管）。
 *   其余配置块（AI 权限 / 知识图谱 / 留存）的读写接口尚待建模（后续轮次），仍如实空态。
 * ⚠ 观察者：配置区不在只读范围内。
 */
export function TabSettings({ view, readOnly = false, projectId }: { view: ProjectRole; readOnly?: boolean; projectId?: string }) {
  const isObserver = observerHidden(view);
  const canInvite = ROLE_STAGE_CONTROL[view] && !readOnly && !!projectId;
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-6" data-testid="project-settings">
      {isObserver && (
        <ObserverNotice
          testId="project-settings-observer-notice"
          what="设置是项目配置区（工作流 / 参与者 / AI 权限 / 知识图谱 / 留存），不在观察者只读范围内。"
        />
      )}
      {!isObserver && projectId && <ProjectMembersPanel projectId={projectId} canManage={canInvite} />}
      {canInvite && <ProjectInvitePanel projectId={projectId} />}
      <section>
        <SectionTitle meta="这场项目的配置枢纽">其他设置</SectionTitle>
        <Card>
          <p className="p-4 text-11 leading-relaxed text-muted-foreground" data-testid="project-settings-empty">
            AI 权限、知识图谱、产出与留存等配置尚未接通，暂无可显示或可修改的项。
          </p>
        </Card>
      </section>
    </div>
  );
}
