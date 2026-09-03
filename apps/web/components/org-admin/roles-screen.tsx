"use client";
import * as React from "react";
import { Eye, ShieldCheck, Ban, ArrowRight, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { UiState } from "@/lib/ui-state";
import type { ProjectRole } from "@/lib/identity";
import { PROJECT_ROLE_LABEL, PROJECT_ROLES, ORG_ROLE_LABEL } from "@/lib/identity";
import { OrgAdminFrame } from "./org-admin-frame";
import {
  ROLE_VIEWS, roleViewOf, OVERVIEW_ROLE_LINES, ROLE_BAR,
} from "@/lib/mock/org-admin";

/**
 * UC-1.4 载体一 · 项目工作台四视角切换器（**本束风险最高的屏**）
 *
 * ⚠ 一致性复核 X-1 已裁定：「谁能看见什么」的六条路径（检索 / Context Pack / embedding /
 *   图遍历 / 文件浏览器 / 缓存）**必须共用同一个判定函数，判定归 identity 束**
 *   （契约 `identity.authorize` / `authorizeBatch`）。
 *   ⇒ 这里的四视角是那**唯一判定的界面投影**，不是第二套可见性规则。
 *   凡界面上可能被读成「这里另有一套规则」的地方，都在 README §2 标为待裁决。
 *
 * 逐字照录 R5/R8：四视角各自的状态标 + 权限说明原文 + 独有按钮；
 * **观察者按钮集为空**（AC3，可验收断言，不是「还没设计」）。
 * 顶部角色说明条同时显示两层身份（UC-0.3 R8）。切换视角**不改数据，只改可见范围**。
 */
export function RolesScreen({
  state, previewRole, href,
}: {
  state: UiState;
  previewRole: ProjectRole;
  href: (o: Partial<{ as: string }>) => string;
}) {
  const view = roleViewOf(previewRole);
  // 预览态：切到非本人视角时的显式标识（R7：不得因此获得超出真实角色的读权，也不得写入）
  const previewing = previewRole !== "groupLead"; // 本人真实角色设为组长（对齐 ROLE_BAR）

  return (
    <OrgAdminFrame
      state={state}
      uc="UC-1.4 R8 载体一"
      title="四视角判定"
      intro="同一个界面，按角色裁剪可见内容与可执行动作。切换视角不改数据，只改可见范围。"
      emptyHint="当前项目还没有任何内容可裁剪；先进入某场项目再看四视角投影。"
      errors={{ role: "角色数据不一致：该项目角色指向一名已停用的组织成员，按拒绝处理并告警（E4）。" }}
      depFailure="鉴权服务不可用。按 R7 一律拒绝，不降级放行——此时任何内容都不渲染。"
      denial={{ layer: "project", reason: "你有组织角色但在本项目无项目角色（NO_PROJECT_ROLE，正常状态）：项目内资源一律不可见，管理员亦然。" }}
      successMessage="临时读权已授予并写审计；授予、每次使用、失效三个时刻都可在项目审计里检索。"
      skeletonRows={4}
    >
      <div className="flex flex-col gap-4">
        {/* ① 角色说明条：两层身份（UC-0.3 R8） */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-panel px-3 py-2" data-testid="roles-role-bar">
          <ShieldCheck aria-hidden className="h-4 w-4 text-muted-foreground" />
          <span className="text-12" data-testid="roles-role-bar-text">
            <strong>{ORG_ROLE_LABEL[ROLE_BAR.orgRole]}</strong>
            <span className="mx-1 text-muted-foreground">｜ 本项目：</span>
            <strong>{PROJECT_ROLE_LABEL[ROLE_BAR.projectRole]} · {ROLE_BAR.group}</strong>
          </span>
          <span className="text-10 text-muted-foreground">（组织角色决定能不能用资源；项目角色决定看什么、做什么。任一不通过即拒绝。）</span>
        </div>

        {/* X-1 单判定提示 —— 防止「界面暗示第二套规则」 */}
        <div className="flex items-start gap-2 rounded-md border border-ai/20 bg-ai-tint px-3 py-2" data-testid="roles-single-source-note">
          <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-ai-tint-foreground" />
          <p className="text-11 text-ai-tint-foreground">
            四视角是服务端<strong>单一判定</strong>（<code className="text-10">identity.authorize</code>）的界面投影，不是第二套可见性规则。
            检索 / Context Pack / 相似度 / 图遍历 / 文件浏览器 / 缓存六条路径共用同一函数（X-1）。
            视角切换是预览手段，切到低权视角不获得任何超出真实角色的读权，也不得以被预览角色身份写入。
          </p>
        </div>

        {/* ② 四视角切换器 */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5" data-testid="roles-view-switcher">
            <Eye aria-hidden className="h-4 w-4 text-muted-foreground" />
            <span className="text-11 text-muted-foreground">视角切换：</span>
            {PROJECT_ROLES.map((r) => (
              <Button key={r} asChild size="sm" variant={r === previewRole ? "primary" : "outline"} data-testid={`roles-view-${r}`}>
                <a href={href({ as: r })}>{PROJECT_ROLE_LABEL[r]}</a>
              </Button>
            ))}
            {previewing && (
              <Badge tone="warning" data-testid="roles-preview-badge">预览态 · 不可写入 · 留痕</Badge>
            )}
          </div>

          {/* 当前视角：状态标 + 权限说明原文 + 独有按钮 */}
          <div className="flex flex-col gap-3 rounded-lg border border-border p-4" data-testid="roles-current-view">
            <div className="flex items-center gap-2">
              <span className="text-16 font-semibold">{PROJECT_ROLE_LABEL[view.role]}</span>
              <Badge tone={view.role === "observer" ? "outline" : "primary"} data-testid="roles-status-tag">{view.statusTag}</Badge>
            </div>
            <p className="text-13 leading-relaxed" data-testid="roles-statement">{view.statement}</p>

            <div className="flex flex-col gap-1.5">
              <span className="text-11 text-muted-foreground">该视角可执行动作（按钮集）：</span>
              {view.buttons.length > 0 ? (
                <div className="flex flex-wrap gap-1.5" data-testid="roles-buttons">
                  {view.buttons.map((b) => (
                    <Button key={b} size="xs" variant="secondary" data-testid="roles-button-item">{b}</Button>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1.5 text-11 text-muted-foreground" data-testid="roles-buttons-empty">
                  <Ban aria-hidden className="h-3.5 w-3.5" />
                  按钮集为空 —— 观察者只读，任何操作按钮都关掉了（AC3 可验收断言：观察者集合 = 空集）
                </div>
              )}
            </div>
          </div>

          {/* 四视角按钮集差集小结（AC3 断言的界面表达） */}
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" data-testid="roles-button-matrix">
            {ROLE_VIEWS.map((v) => (
              <div key={v.role} className="flex flex-col gap-1 rounded-md border border-border p-2">
                <span className="text-11 font-medium">{PROJECT_ROLE_LABEL[v.role]}</span>
                <span className="text-10 text-muted-foreground">
                  {v.buttons.length > 0 ? v.buttons.join(" · ") : "（空集）"}
                </span>
              </div>
            ))}
          </div>
          <p className="text-10 text-muted-foreground">
            差集断言：引导师 ⊇ 组长 ⊃ 组员 ⊃ 观察者；组长恰多 <code className="text-9">提交本组产出</code>；组员有且仅有 <code className="text-9">举手</code>；观察者为空集。
          </p>
        </div>

        {/* ③ 概览三行角色态（原型，按角色投影） */}
        <section className="flex flex-col gap-2" data-testid="roles-overview-lines">
          <h2 className="text-14 font-semibold">概览 · 按角色投影的三行</h2>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {OVERVIEW_ROLE_LINES.map((l) => (
              <li key={l.who} className="flex items-center gap-2 px-3 py-2">
                <span className="w-24 shrink-0 text-12 font-medium">{l.who}</span>
                <span className="min-w-0 flex-1 truncate text-12 text-muted-foreground">{l.line}</span>
                <Button asChild size="xs" variant="ghost" data-testid="roles-overview-action">
                  <a href={href({ as: l.role })}>{l.action} <ArrowRight aria-hidden className="h-3 w-3" /></a>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </OrgAdminFrame>
  );
}
