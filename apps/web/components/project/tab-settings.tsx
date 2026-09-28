"use client";
import { ObserverNotice } from "./parts";
import { ROLE_STAGE_CONTROL, observerHidden, type ProjectRole } from "@/lib/project-workbench";
import { ProjectInvitePanel } from "./project-invite-panel";
import { ProjectMembersPanel } from "./project-members-panel";
import { ProjectCollaboratorsPanel } from "./project-collaborators-panel";
import type { ProjectListItem } from "@/lib/live-projects";
import { ProjectAiSettingsPanel } from "./project-ai-settings-panel";

/**
 * 设置（原型 isWsSetup）。
 *
 * ⚠ 此前整页渲染 `lib/mock/project.ts` 的虚构配置（参与者名单、AI 权限开关、留存 180 天、
 *   写回组织大脑开关……），开关不落库、所有项目一样。现已删除 mock。
 * ⚠ 项目中枢 R2：新增「邀请成员」面板（引导师视角）——项目是受邀才能进的容器，邀请从这里发。
 * ⚠ 项目中枢 R3：新增「项目成员」面板——名单所有非观察者可读；指派 / 改角色 / 移出只在引导师视角
 *   给控件（服务端 `authorizeManageMembers` 才是判定，组织 lead/admin 越过前端投影也能管）。
 * ⚠ 项目中枢 B2-S5（#4429）：新增「AI 权限」面板——哪些来源允许进入项目大脑，落库 `project_ai_settings`；
 *   引导师视角可改（服务端 `authorizeManageMembers` 才是判定），其余视角只读徽标。
 *   其余配置块（知识图谱 / 留存）的读写接口尚待建模（后续轮次）；此前那张「其他设置」空态卡已撤。
 * ⚠ 项目中枢 B3-T5（#4499）：`projectKind` 不是 `workshop`（研究项目 / 用户洞察）时，「项目成员」与
 *   「邀请成员」两块换成「协作者」面板——两档负责人 / 协作者走 `/collaborators` 三条契约；工作坊的
 *   四角色 + 邀请链接对这两类容器在数据库层就写不进去（F128 复合外键）。`projectKind` 未知（还没读到）
 *   时按工作坊渲染，同页头「先到的那份」的处置。
 * ⚠ 观察者：配置区不在只读范围内。
 */
export function TabSettings({ view, readOnly = false, projectId, projectKind = null }: {
  view: ProjectRole; readOnly?: boolean; projectId?: string; projectKind?: ProjectListItem["kind"] | null;
}) {
  const isObserver = observerHidden(view);
  const nonWorkshop = projectKind !== null && projectKind !== "workshop";
  const canInvite = ROLE_STAGE_CONTROL[view] && !readOnly && !!projectId && !nonWorkshop;
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-6" data-testid="project-settings">
      {isObserver && (
        <ObserverNotice
          testId="project-settings-observer-notice"
          what="设置是项目配置区（工作流 / 参与者 / AI 权限 / 知识图谱 / 留存），不在观察者只读范围内。"
        />
      )}
      {!isObserver && projectId && nonWorkshop && <ProjectCollaboratorsPanel projectId={projectId} />}
      {!isObserver && projectId && !nonWorkshop && <ProjectMembersPanel projectId={projectId} canManage={canInvite} />}
      {canInvite && <ProjectInvitePanel projectId={projectId} />}
      {!isObserver && projectId && <ProjectAiSettingsPanel projectId={projectId} canEdit={canInvite} />}
    </div>
  );
}
