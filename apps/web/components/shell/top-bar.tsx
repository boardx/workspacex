"use client";
import * as React from "react";
import { Building2, FolderKanban, Lock, ShieldCheck } from "lucide-react";
import { FeedbackButton } from "@/components/feedback/feedback-button";
import { usePathname } from "next/navigation";
import {
  describeOrgLayer, describeProjectLayer, isLocalOrg, LOCAL_ORG_GUARANTEES,
  selfHostedOnly, SELF_HOSTED_SOURCE_LABEL,
  PROJECT_ROLES, PROJECT_ROLE_LABEL, type Identity, type ProjectRole,
} from "@/lib/identity";
import { resolveProjectContext } from "@/lib/project-context";
import { OrgMenu } from "./org-menu";
import { Button } from "@/components/ui/button";

/**
 * 顶部条 = 组织切换器（裁决 O-12）+ 两层角色说明条（UC-0.3 R8）
 *
 * O-12 要点：切换器顶部常驻、会话内切换不需重新登录；
 * **切换时必须清空全部项目级上下文**（当前项目/环节/Context Pack/鉴权缓存/未提交草稿）。
 *
 * ⚠ **项目层身份与视角切换器只在项目上下文内渲染**（2026-07-28 修正）。
 *   此前无条件渲染「本项目：引导师」，等于宣称项目角色是全局属性——与 UC-0.3 冲突：
 *   项目角色只对某个**目标项目**成立，R4 E1 明写「有组织角色但无项目角色」是正常状态。
 *   在后台/任务/大脑上显示项目角色，是把一个不存在的判定画到界面上。
 *   作用域判定见 `lib/project-context.ts`。
 *
 * ⚠ 视角切换器是**预览手段，不是权限实现**，且生产构建不可达（verify-prod-gates.sh 断言）。
 *
 * ⚠ `hideRoleSwitcher`（2026-07-30）：**角色切换的唯一来源 = 各域内容区自带的切换器**。
 *   当本页内容区自带一个（如项目工作台的四视角切换器、问卷的 view-switcher）时，
 *   顶栏这个预览切换器**让位不渲染**，避免「同一页两套角色切换系统」。
 *   顶栏此时仍显示项目上下文标签（项目名·角色），只是不再出第二个切换器。
 *
 * ⚠ 组织管理入口 / 退出按钮（2026-08-09 信息架构调整）：**都已从顶栏挪走**。
 *   组织管理入口并入左上角组织菜单（见 `icon-rail.tsx` / `org-menu.tsx`）；
 *   退出并入左下角个人菜单（见 `personal-menu.tsx` 的 logout 菜单项）。
 *   顶栏不再单独持有这两者——同一功能不许两个入口。
 *
 * ⚠ 组织切换器（2026-08-11 信息架构调整）：**也从顶栏挪走了**——并入左上角组织菜单
 *   （`org-menu.tsx`，人类直接要求）。顶栏保留的组织名是**纯展示文本**
 *   （`topbar-org-name`），没有按钮态、不可点——不留看起来能点但不能点的东西。
 *   例外：<md 时 IconRail 整根隐藏，组织菜单会失去唯一入口，所以顶栏在 `md:hidden`
 *   下渲染同一个 `OrgMenu`（testid 加 `-mobile` 后缀防撞）。两个实例永远不同时可见，
 *   不构成第二入口。
 */
export function TopBar({
  identity, previewRole, hideRoleSwitcher, organizations, onSwitchOrganization, switching,
}: {
  identity: Identity;
  previewRole: ProjectRole | null;
  hideRoleSwitcher?: boolean;
  organizations: ReadonlyArray<{ id: string; label: string }>;
  onSwitchOrganization: (orgId: string) => void;
  switching?: boolean;
}) {
  const pathname = usePathname();
  const project = resolveProjectContext(pathname);
  const isDev = process.env.NODE_ENV !== "production";
  const projectLayer = project ? describeProjectLayer(identity) : null;
  // UC-0.5 R8：切到本地组织时整个应用要有**可感知**的状态变化——
  // 隐私模式若不可见，等于不存在。
  const local = isLocalOrg(identity.org);
  // UC-0.5 V12：同样是「只用自托管」，**承诺**与**策略**必须在界面上可分辨
  const sh = selfHostedOnly(identity.org);
  // 顶栏是否出自己的预览切换器：在项目上下文里、开发态、且本页没有自带一套
  const showOwnSwitcher = isDev && !!project && !hideRoleSwitcher;
  const currentOrgLabel =
    organizations.find((o) => o.id === identity.org.id)?.label ?? identity.org.name;

  return (
    <header
      data-testid="shell-topbar"
      data-local-org={local ? "true" : undefined}
      className={[
        "flex h-11 shrink-0 items-center gap-3 border-b px-3 transition-colors duration-200",
        local ? "border-ai/30 bg-ai-tint" : "border-border bg-card",
      ].join(" ")}
    >
      {/* ── 组织层：全局常驻 ── */}
      <div className="flex shrink-0 items-center gap-1.5">
        {/* <md 时 IconRail 隐藏，组织菜单（切换 + 组织管理）在这里补一个入口；≥md 由 rail 承担 */}
        <div className="md:hidden">
          <OrgMenu
            identity={identity}
            organizations={organizations}
            onSelect={onSwitchOrganization}
            switching={switching}
            placement="below"
            testIdSuffix="-mobile"
          />
        </div>
        {/*
          FB-2 —— <md 时 IconRail 隐藏，反馈入口在这里补一个；≥md 由 rail 承担。
          同 OrgMenu 的处置：小屏不丢入口，但也不在两处同时出现。
        */}
        <div className="md:hidden">
          <FeedbackButton
            target={{ kind: "product" }}
            targetLabel={null}
            testid="topbar-feedback"
            className="h-6 w-6"
          />
        </div>
        {local
          ? <Lock aria-hidden className="h-3.5 w-3.5 text-ai-tint-foreground" data-testid="topbar-local-lock" />
          : <Building2 aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />}
        <span data-testid="topbar-org-name" className="max-w-[12rem] truncate text-12 font-medium text-card-foreground">
          {currentOrgLabel}
        </span>
      </div>

      <div className="h-4 w-px shrink-0 bg-border" aria-hidden />

      <p data-testid="role-bar-org" className="min-w-0 flex-1 truncate text-12 text-muted-foreground">
        {describeOrgLayer(identity)}
      </p>

      {/* ── 项目层：只在项目上下文里出现 ── */}
      {project && (
        <>
          <div className="h-4 w-px shrink-0 bg-border" aria-hidden />
          <div className="flex min-w-0 items-center gap-1.5" data-testid="topbar-project-context">
            <FolderKanban aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-12 font-medium">{project.name}</span>
            {projectLayer && (
              <span data-testid="role-bar-project" className="truncate text-12 text-muted-foreground">
                · {projectLayer}
              </span>
            )}
          </div>
        </>
      )}

      {/* ── 视角切换器：预览手段，只在项目里、且本页未自带时出现；生产不可达 ── */}
      {showOwnSwitcher && (
        <div
          data-testid="role-preview-switcher"
          className="ml-auto hidden shrink-0 items-center gap-1 rounded-md border border-border-subtle bg-panel p-1 lg:flex"
        >
          <span className="px-1 text-10 uppercase tracking-wide text-muted-foreground">本项目视角</span>
          {PROJECT_ROLES.map((r) => (
            <Button key={r} asChild size="xs" variant={r === previewRole ? "primary" : "ghost"} data-testid={`role-switch-${r}`}>
              <a href={`?as=${r}`}>{PROJECT_ROLE_LABEL[r]}</a>
            </Button>
          ))}
        </div>
      )}

      {/* 本地模式常驻说明条 —— 三条硬隔离直接写在顶栏，不藏进设置里 */}
      {local && (
        <p
          data-testid="topbar-local-banner"
          data-guarantee-source="promise"
          title={LOCAL_ORG_GUARANTEES.map((g) => g.statement).join("；")}
          className="ml-auto hidden shrink-0 text-10 font-medium text-ai-tint-foreground lg:block"
        >
          本地模式 · 只用本地模型 · 数据不出本机
          <span className="ml-1 text-muted-foreground">（{SELF_HOSTED_SOURCE_LABEL.promise}）</span>
        </p>
      )}

      {/* 正式组织配了 self-hosted-only：同样限自托管，但它是**策略**不是承诺 —— 措辞与图标都要不同 */}
      {!local && sh.on && (
        <p
          data-testid="topbar-selfhosted-policy"
          data-guarantee-source="policy"
          title="本组织的模型策略被管理员设为「只用自托管模型」。这是可配置策略，与个人本地组织的产品承诺不同。"
          className="ml-auto hidden shrink-0 items-center gap-1 text-10 font-medium text-accent-foreground lg:flex"
        >
          <ShieldCheck aria-hidden className="h-3 w-3" />
          本组织只用自托管模型
          <span className="text-muted-foreground">（{SELF_HOSTED_SOURCE_LABEL.policy}）</span>
        </p>
      )}

      {/* 不在项目里时给一句解释，而不是留白——「无项目角色」是正常状态，不是缺失 */}
      {!project && !local && !sh.on && (
        <p className="ml-auto hidden shrink-0 text-10 text-muted-foreground lg:block" data-testid="topbar-no-project-hint">
          不在项目上下文中 · 项目角色不适用
        </p>
      )}

    </header>
  );
}
