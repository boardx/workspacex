"use client";
import * as React from "react";
import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatePreviewSwitcher } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import type { ProjectRole } from "@/lib/identity";
import {
  SKILL_SCREENS, SKILL_SCREEN_LABEL, SKILL_VIEWS,
  type SkillScreen, type SkillView,
} from "@/lib/mock/skill";
import { SkillCatalogLive } from "./skill-catalog-live";
import { CapabilityCatalogScreen } from "@/components/admin/capability-catalog-screen";
import { SkillContentEditorSection } from "@/components/admin/skill-content-editor";
import { SkillLibrary } from "./skill-library";
import { SkillTryRun } from "./skill-tryrun";
import { SkillBinding } from "./skill-binding";
import { SkillTempMount } from "./skill-temp-mount";
import { SkillVersioning } from "./skill-versioning";
import { SkillPromotion } from "./skill-promotion";
import { SkillFeedback } from "./skill-feedback";

/**
 * skill 能力域编排 —— 复用已确认的骨架 AppShell（图标栏 / 中栏 / 右栏 / 环境态条）。
 *
 * ⚠ 2026-08-13 起**不再传 `left`**：人类直接裁决砍掉左栏导航列（见下方注释），
 *   `AppShell` 在 `left` 为空时自动收起，中栏顶到页面。生产默认屏 `library` 是
 *   卡片网格（`SkillCatalogLive`），不再被侧栏挤压宽度。
 * AI 四种在场方式在各屏体现：线程里的同事（temp）/ 画布上的协作者（binding 左栏投影）/
 * 后台的 worker（library 试跑、feedback 归因）/ 项目里的主持人（binding 三视角）。
 */
export function SkillApp({
  previewRole, uiState, screen, view, qs,
}: {
  previewRole: ProjectRole | null;
  uiState: UiState;
  screen: SkillScreen;
  view: SkillView;
  qs: { as?: string; org?: string };
}) {
  const href = (o: Partial<{ as: string; state: string; screen: string }>) => {
    const p = new URLSearchParams();
    const as = o.as ?? qs.as; if (as) p.set("as", as);
    if (qs.org) p.set("org", qs.org);
    const st = o.state ?? uiState; if (st && st !== "default") p.set("state", st);
    const sc = o.screen ?? screen; if (sc && sc !== "library") p.set("screen", sc);
    const s = p.toString();
    return s ? `?${s}` : "?";
  };

  return (
    <AppShell
      previewRole={previewRole}
      right={<RightRail screen={screen} />}
    >
      <div className="flex h-full min-h-0 flex-col">
        <PreviewControls href={href} screen={screen} uiState={uiState} qs={qs} />
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {/*
            #520：默认屏接真实后端（`SkillController`）。它「不吃」`uiState` / `view`——
            （这里用「」而不是 Markdown 加粗：多行 JSX 注释的续行 lint-design 认不出，
            见 `scripts/lint-design.sh` 里 strip_comments 的已知局限。）
            那两个是原型的预览手段，真实的加载/失败/空态由后端响应决定，真实权限在服务端。
            七屏原型仍可达，见下面的 `library-prototype`。
          */}
          {screen === "library" && <SkillCatalogLive />}
          {screen === "catalog" && (
            <CapabilityCatalogScreen
              kind="skill"
              renderEditExtra={(row) => (
                <SkillContentEditorSection id={`skill-catalog-row-${row.id}`} row={row} />
              )}
            />
          )}
          {screen === "library-prototype" && <SkillLibrary state={uiState} view={view} />}
          {screen === "tryrun" && <SkillTryRun state={uiState} view={view} />}
          {screen === "binding" && <SkillBinding state={uiState} view={view} />}
          {screen === "temp" && <SkillTempMount state={uiState} view={view} />}
          {screen === "versioning" && <SkillVersioning state={uiState} view={view} />}
          {screen === "promotion" && <SkillPromotion state={uiState} view={view} />}
          {screen === "feedback" && <SkillFeedback state={uiState} view={view} />}
        </div>
      </div>
    </AppShell>
  );
}

/* ── 左栏：2026-08-13 人类直接裁决，砍掉整列 ─────────────────────────
 *
 * 人类原话：「后台的 skill 目前有两个菜单，请只保留一个，并且保留真实数据的这个。
 * 不需要有中间的这个 column，直接显示 skills 的列表，用卡片的方式来展示」。
 *
 * 「两个菜单」＝旧 `LEFT_NAV_SCREENS`（`library` 真实数据 / `catalog` 原
 * `/admin/skill` 真合并落点，见 issue #700、2026-08-11 的合并记录）；
 * 「中间这个 column」＝整个左栏导航列（`AppShell` 的 `left` 插槽），不只是
 * `catalog` 那一项。`SkillApp` 不再传 `left` 给 `AppShell`——`AppShell` 在
 * `left` 为空时本就自动收起左栏（`shell-left-panel` 只在 `left &&` 时渲染），
 * 内容区因此顶到页面，不需要另起骨架改动。
 *
 * ⚠ 只摘导航列，不摘屏：`catalog` 组件本身、`resolveSkillScreen` 与
 *   `?screen=catalog` 直达仍然保留（参照 issue #700 先例：删导航项不删屏，
 *   七屏／九屏仍是 ADR-023 签核第 ① 件材料，见 lib/mock/skill.ts 顶部注释：
 *   「删掉等于把已签核的设计从仓库里抹掉」）。旧路由 `/admin/skill` 重定向到
 *   `/skill?screen=catalog` 不受影响，仍然可达。开发态 `PreviewControls`
 *   （`NODE_ENV !== production` 才渲染）不受影响，仍可切到全部九屏做预览/回归对照。
 *
 * ⚠ `catalog` 屏管的「名称/可见范围/归属团队编辑」这个编辑能力，本轮**没有**在
 *   `library` 卡片网格里补一个新落点——那是需要人类/coord-main 确认要不要保留、
 *   保留的话该长在哪（比如卡片详情的编辑弹层）的产品决策，不是这次改动能替人类
 *   悄悄决定的事。见本 issue/PR 正文的说明。
 */

/* ── 右栏：门禁 / 溯源上下文（AI 后台 worker 的在场证据）──────────────── */

function RightRail({ screen }: { screen: SkillScreen }) {
  const notes: Record<SkillScreen, { title: string; body: string }> = {
    library: { title: "只画后端给得出的东西", body: "本屏接真实 API（#520）：只有创建草稿、列表、详情三条路径有 HTTP 边界。没有发布、试跑、审核入口——它们的用例还没有边界，摆出来就是骗人的按钮。" },
    catalog: { title: "原 /admin/skill，2026-08-11 真合并进来", body: "名称/可见范围/归属团队编辑，走 identity 能力目录契约（GET/POST /capabilities）——与 library 是两套不同后端数据源，只是概念重叠，导航层面收敛为一个入口。" },
    "library-prototype": { title: "双重门禁", body: "安全扫描（自动）与方法论审核（人工）是两道独立门禁，两职能不合并、均由组织管理员指派、不得自审自批。" },
    tryrun: { title: "试跑不落库", body: "试跑用当前未发布的契约跑，不影响线上；自动校验（结构/证据/越权/写库）与回归用例都不需要沙箱（D-06 挡不住），是对契约输出的断言。" },
    binding: { title: "两级继承", body: "后台模板级默认值 → 项目实例级可覆盖、不回写；沉淀回组织只有一条显式路径 [另存为组织模板]。" },
    temp: { title: "作用域", body: "临时挂载只对当前这条对话生效，不改蓝本；组员默认不可自加（服务端拒）。" },
    versioning: { title: "不可变快照", body: "发新版旧版自动归档，已建实例锁定版本、不因发新版漂移；对存在任何引用的 skill 硬删永久拒绝。" },
    promotion: { title: "来自组织大脑", body: "方法晋升自动生成 skill 但不自动发布——落待审核。触发端 14-brain 在 phase-3，此处只做接收端。" },
    feedback: { title: "归因链", body: "消息 → agent → skill → skill 版本。缺版本的评价只计 agent 级、不计入任何 skill 满意度。" },
  };
  const n = notes[screen];
  return (
    <div className="flex flex-col gap-3 p-3" data-testid="skill-right-rail">
      <div className="flex flex-col gap-1.5 rounded-lg border border-border-subtle bg-panel p-3">
        <span className="text-10 uppercase tracking-wide text-muted-foreground">本屏关键约束</span>
        <p className="text-12 font-medium">{n.title}</p>
        <p className="text-11 leading-relaxed text-muted-foreground">{n.body}</p>
      </div>
      <div className="flex flex-col gap-1 rounded-lg border border-border-subtle bg-panel p-3">
        <Badge tone="outline" className="w-fit">已裁决</Badge>
        <p className="text-10 leading-relaxed text-muted-foreground">
          「议程环节」字段命名单源：agendaSegment / agendaSegmentId（Q-3 B① 裁定，F121 已改名对齐）。
        </p>
      </div>
    </div>
  );
}

/* ── 预览控制条（屏 / 视角 / 七态；仅开发，生产不渲染）──────────────── */

function PreviewControls({
  href, screen, uiState, qs,
}: {
  href: (o: Partial<{ as: string; state: string; screen: string }>) => string;
  screen: SkillScreen;
  uiState: UiState;
  qs: { as?: string; org?: string };
}) {
  if (process.env.NODE_ENV === "production") return null;
  const currentAs = qs.as ?? "maintainer";
  return (
    <div className="flex flex-col gap-1.5 border-b border-border-subtle bg-panel-alt px-3 py-2" data-testid="skill-preview-controls">
      <div className="flex flex-wrap items-center gap-1">
        <span className="px-1 text-10 uppercase tracking-wide text-muted-foreground">屏</span>
        {SKILL_SCREENS.map((s) => (
          <Button key={s} asChild size="xs" variant={s === screen ? "primary" : "ghost"} data-testid="skill-screen-switch">
            <a href={href({ screen: s })}>{SKILL_SCREEN_LABEL[s]}</a>
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="px-1 text-10 uppercase tracking-wide text-muted-foreground">视角</span>
        {SKILL_VIEWS.map((r) => (
          <Button key={r.id} asChild size="xs" variant={currentAs === r.id ? "primary" : "ghost"} data-testid="skill-role-switch">
            <a href={href({ as: r.id })} title={r.note}>{r.label}</a>
          </Button>
        ))}
        <Badge tone="outline" className="ml-1">预览手段 · 真实权限在服务端 RLS</Badge>
      </div>
      <StatePreviewSwitcher current={uiState} />
    </div>
  );
}
