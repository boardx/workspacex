"use client";
import * as React from "react";
import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatePreviewSwitcher } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import type { Identity } from "@/lib/identity";
import {
  SKILL_SCREENS, SKILL_SCREEN_LABEL, SKILL_SCREEN_UC, SKILL_VIEWS,
  type SkillScreen, type SkillView,
} from "@/lib/mock/skill";
import { SkillLibrary } from "./skill-library";
import { SkillBinding } from "./skill-binding";
import { SkillTempMount } from "./skill-temp-mount";
import { SkillVersioning } from "./skill-versioning";
import { SkillPromotion } from "./skill-promotion";
import { SkillFeedback } from "./skill-feedback";

/**
 * skill 能力域编排 —— 复用已确认的三栏骨架 AppShell（图标栏 / 左栏 / 中栏 / 右栏 / 环境态条）。
 *
 * 左栏走「五段语义导航」心智：本域六屏 + 视角说明。
 * AI 四种在场方式在各屏体现：线程里的同事（temp）/ 画布上的协作者（binding 左栏投影）/
 * 后台的 worker（library 试跑、feedback 归因）/ 项目里的主持人（binding 三视角）。
 */
export function SkillApp({
  identity, uiState, screen, view, qs,
}: {
  identity: Identity;
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
      identity={identity}
      previewRole={identity.projectRole}
      left={<LeftNav screen={screen} href={href} />}
      right={<RightRail screen={screen} />}
    >
      <div className="flex h-full min-h-0 flex-col">
        <PreviewControls href={href} screen={screen} uiState={uiState} qs={qs} />
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {screen === "library" && <SkillLibrary state={uiState} view={view} />}
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

/* ── 左栏：本域六屏语义导航 ────────────────────────────────────────── */

function LeftNav({
  screen, href,
}: {
  screen: SkillScreen;
  href: (o: Partial<{ screen: string }>) => string;
}) {
  return (
    <nav className="flex flex-col gap-4 p-3" data-testid="skill-left-nav">
      <div className="flex flex-col gap-1.5">
        <span className="px-1 text-10 uppercase tracking-wide text-muted-foreground">Skill 能力包</span>
        {SKILL_SCREENS.map((s) => (
          <Button
            key={s}
            asChild
            size="sm"
            variant={s === screen ? "primary" : "ghost"}
            className="h-auto flex-col items-start gap-0.5 py-1.5"
            data-testid={`skill-nav-${s}`}
          >
            <a href={href({ screen: s })}>
              <span className="text-12">{SKILL_SCREEN_LABEL[s]}</span>
              <span className="text-9 text-muted-foreground">{SKILL_SCREEN_UC[s]}</span>
            </a>
          </Button>
        ))}
      </div>
      <p className="rounded-md border border-border-subtle bg-panel px-2 py-1.5 text-9 text-muted-foreground">
        phase-1 的 skill 是<strong className="text-foreground">声明式契约</strong>（提示词模板＋io schema＋数据范围声明），不是可执行代码包——
        不做沙箱、不跑任意代码（D-06）。
      </p>
    </nav>
  );
}

/* ── 右栏：门禁 / 溯源上下文（AI 后台 worker 的在场证据）──────────────── */

function RightRail({ screen }: { screen: SkillScreen }) {
  const notes: Record<SkillScreen, { title: string; body: string }> = {
    library: { title: "双重门禁", body: "安全扫描（自动）与方法论审核（人工）是两道独立门禁，两职能不合并、均由组织管理员指派、不得自审自批。" },
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
      <div className="flex flex-col gap-1 rounded-lg border border-warning/30 bg-warning/5 p-3">
        <Badge tone="warning" className="w-fit">待裁决</Badge>
        <p className="text-10 leading-relaxed text-muted-foreground">
          「议程环节」字段命名未定（stepId / stage.* / agenda_stage / agenda_segment 四名并存）。
          本原型统一显示「议程环节」并中性承载，见 00-project/OPEN-QUESTIONS.md Q-3。
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
