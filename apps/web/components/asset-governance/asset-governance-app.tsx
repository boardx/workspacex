"use client";
import * as React from "react";
import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatePreviewSwitcher } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import type { Identity } from "@/lib/identity";
import {
  AG_SCREENS, AG_SCREEN_LABEL, AG_SCREEN_UC, AG_VIEWS, AG_ASSET_NAV, AG_ORG_QUOTA,
  type AgScreen, type AgView,
} from "@/lib/mock/asset-governance";
import {
  AgDashboard, AgBlueprint, AgNewSkill, AgGates, AgGovernance,
  AgSkillEditor, AgAgentEditor, AgTryRun,
} from "./ag-screens";

/**
 * asset-governance 能力域编排（phase-01 第 11 束）—— 复用已确认的三栏骨架 AppShell。
 *
 * ⚠ 这是**后台管理台**，左栏不是项目的「五段语义导航」，而是**六种资产的 IA**
 *   （数据总览 / AI 能力六项 / 组织）。六种资产共用同一套治理机制（导入六道关、
 *   可见范围/负责人/复核周期、文件树编辑器、试跑台、复核到期降级）——本域画的是那套
 *   公共机制与各资产列表；各资产自身的领域界面在别的束（蓝本设计器 tpl-v2、skill 绑定
 *   skill-v2、agent 编排与 MCP 规则 agent-runtime-v2），本域不重画。
 *
 * AI 四种在场方式在本域的体现：后台的 worker（六道关沙箱试跑、试跑台执行轨迹）/
 * 线程里的同事（试跑台里的 Ava）/ 画布上的协作者与项目里的主持人在各资产自身界面体现。
 */
export function AssetGovernanceApp({
  identity, uiState, screen, view, qs,
}: {
  identity: Identity;
  uiState: UiState;
  screen: AgScreen;
  view: AgView;
  qs: { as?: string; org?: string };
}) {
  const href = (o: Partial<{ as: string; state: string; screen: string }>) => {
    const p = new URLSearchParams();
    const as = o.as ?? qs.as; if (as) p.set("as", as);
    if (qs.org) p.set("org", qs.org);
    const st = o.state ?? uiState; if (st && st !== "default") p.set("state", st);
    const sc = o.screen ?? screen; if (sc && sc !== "dashboard") p.set("screen", sc);
    const s = p.toString();
    return s ? `?${s}` : "?";
  };

  return (
    <AppShell
      identity={identity}
      previewRole={identity.projectRole}
      left={<LeftNav screen={screen} view={view} href={href} />}
      right={<RightRail screen={screen} />}
    >
      <div className="flex h-full min-h-0 flex-col">
        <PreviewControls href={href} screen={screen} uiState={uiState} qs={qs} />
        <div className="min-h-0 flex-1 overflow-y-auto p-4" data-testid="ag-main">
          {screen === "dashboard" && <AgDashboard state={uiState} view={view} />}
          {screen === "blueprint" && <AgBlueprint state={uiState} view={view} />}
          {screen === "newskill" && <AgNewSkill state={uiState} view={view} />}
          {screen === "gates" && <AgGates state={uiState} view={view} />}
          {screen === "governance" && <AgGovernance state={uiState} view={view} />}
          {screen === "skill-editor" && <AgSkillEditor state={uiState} view={view} />}
          {screen === "agent-editor" && <AgAgentEditor state={uiState} view={view} />}
          {screen === "tryrun" && <AgTryRun state={uiState} view={view} />}
        </div>
      </div>
    </AppShell>
  );
}

/* ── 左栏：后台六资产 IA（数据总览 / AI 能力 / 组织）──────────────────── */

function LeftNav({
  screen, view, href,
}: {
  screen: AgScreen;
  view: AgView;
  href: (o: Partial<{ screen: string }>) => string;
}) {
  // 资产 → 对应本域画的屏（列表/编辑器）；没画列表的资产指向数据总览锚点。
  const assetScreen: Record<string, AgScreen> = {
    skill: "skill-editor",
    agent: "agent-editor",
    blueprint: "blueprint",
  };
  return (
    <nav className="flex flex-col gap-4 p-3" data-testid="ag-left-nav">
      <div className="flex flex-col gap-0.5">
        <span className="px-1 text-9 uppercase tracking-wide text-muted-foreground">后台管理 · {AG_ORG_QUOTA.orgName}</span>
        <span className="px-1 font-mono text-9 text-muted-foreground">组织 ID {AG_ORG_QUOTA.orgId}</span>
      </div>

      <Button asChild size="sm" variant={screen === "dashboard" ? "primary" : "ghost"} className="justify-start" data-testid="ag-nav-dashboard">
        <a href={href({ screen: "dashboard" })}>数据总览</a>
      </Button>

      <div className="flex flex-col gap-1">
        <span className="px-1 text-9 uppercase tracking-wide text-muted-foreground">AI 能力</span>
        {AG_ASSET_NAV.map((a) => {
          const target = assetScreen[a.kind];
          const active = target === screen;
          return (
            <Button
              key={a.kind}
              asChild
              size="sm"
              variant={active ? "primary" : "ghost"}
              className="h-auto justify-between py-1.5"
              data-testid="ag-nav-asset"
            >
              <a href={target ? href({ screen: target }) : href({ screen: "dashboard" })}>
                <span className="text-12">{a.label}</span>
                <span className="font-mono text-9 text-muted-foreground">{a.count}</span>
              </a>
            </Button>
          );
        })}
      </div>

      <div className="flex flex-col gap-1">
        <span className="px-1 text-9 uppercase tracking-wide text-muted-foreground">组织</span>
        <Button asChild size="sm" variant="ghost" className="h-auto justify-between py-1.5" data-testid="ag-nav-members">
          <a href={href({ screen: "dashboard" })}>
            <span className="text-12">成员与配额</span>
            <span className="font-mono text-9 text-muted-foreground">48</span>
          </a>
        </Button>
        <Button asChild size="sm" variant="ghost" className="h-auto justify-between py-1.5" data-testid="ag-nav-feedback">
          <a href={href({ screen: "dashboard" })}>
            <span className="text-12">反馈与迭代</span>
            <span className="h-1.5 w-1.5 rounded-full bg-ai" aria-hidden />
          </a>
        </Button>
      </div>

      <p className="rounded-md border border-border-subtle bg-panel px-2 py-1.5 text-9 leading-relaxed text-muted-foreground">
        六种资产（Agent / Skill / 模型 / MCP / 画布模板 / 项目蓝本）共用一套治理机制。
        {view === "member" && "（当前预览视角为普通成员：后台一律不可见。）"}
      </p>
    </nav>
  );
}

/* ── 右栏：本屏的治理上下文 ──────────────────────────────────────────── */

function RightRail({ screen }: { screen: AgScreen }) {
  const notes: Record<AgScreen, { title: string; body: string }> = {
    dashboard: { title: "六资产一套机制", body: "Agent / Skill / 模型 / MCP / 画布模板 / 项目蓝本 共用导入六道关、可见范围、负责人与复核周期。人类问「为什么后台看不到项目蓝本」——它本该与其它五种并列。" },
    blueprint: { title: "列表在本域，设计器不在", body: "蓝本列表页归本域（后台宿主）；16 面板的蓝本设计器在 tpl-v2 束，不重画。草稿「试跑一场后才能发布」是发布门禁的投影。" },
    newskill: { title: "三条路径 · 一个门", body: "完全新建 / 导入 / 从市场挑一个改——后两条都要过落地检查六道关。市场两个面数据在原型里就不一致（见 README）。" },
    gates: { title: "六道关不可跳过", body: "任何一道阻断都不能跳过。查重分歧与依赖改写需要人判断——这正是 sign-off 要看的地方。open claw 源未在原型里出现，标待确认。" },
    governance: { title: "六种资产完全一样", body: "谁能用 / 谁负责 / 何时重检。到期转待复核仍可用但提示；30 天无人复核降级为仅负责人可见——与组织大脑知识条目规则一致。灰度发布更易回滚。" },
    "skill-editor": { title: "目录即发布结构", body: "文件树就是发布出去的结构。发布前需一次无阻断试跑。已建实例锁定旧版本、不因发新版漂移。" },
    "agent-editor": { title: "AGENT.md 同构", body: "与 Skill 编辑器同构：AGENT.md ＋ prompts/ ＋ tools/ ＋ evals/。model chip 标注所用模型。" },
    tryrun: { title: "试跑不落库", body: "用未保存提示词跑，不影响线上。执行轨迹含越权拦截；自动校验四条断言（先给反方 / 未编造 / 未越权 / 未自动写入项目层）。跑对可钉成回归用例。" },
  };
  const n = notes[screen];
  return (
    <div className="flex flex-col gap-3 p-3" data-testid="ag-right-rail">
      <div className="flex flex-col gap-1 rounded-lg border border-border-subtle bg-panel-alt p-3">
        <p className="text-12 font-medium text-background-foreground">{n.title}</p>
        <p className="text-11 leading-relaxed text-muted-foreground">{n.body}</p>
      </div>
      <div className="flex flex-col gap-1 rounded-lg border border-warning/30 bg-warning/5 p-3">
        <Badge tone="warning" className="w-fit">全新能力域</Badge>
        <p className="text-10 leading-relaxed text-muted-foreground">
          本域在现有 feature_list 与原型代码里 0 命中（六道关 / 查重 / 灰度 / 复核降级 / 文件树 / 试跑台）。
          契约缺口集中在 lib/mock/asset-governance.ts，待迁入 packages/contracts。
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
  screen: AgScreen;
  uiState: UiState;
  qs: { as?: string; org?: string };
}) {
  if (process.env.NODE_ENV === "production") return null;
  const currentAs = qs.as ?? "admin";
  return (
    <div className="flex flex-col gap-1.5 border-b border-border-subtle bg-panel-alt px-3 py-2" data-testid="ag-preview-controls">
      <div className="flex flex-wrap items-center gap-1">
        <span className="px-1 text-10 uppercase tracking-wide text-muted-foreground">屏</span>
        {AG_SCREENS.map((s) => (
          <Button key={s} asChild size="xs" variant={s === screen ? "primary" : "ghost"} data-testid="ag-screen-switch">
            <a href={href({ screen: s })} title={AG_SCREEN_UC[s]}>{AG_SCREEN_LABEL[s]}</a>
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="px-1 text-10 uppercase tracking-wide text-muted-foreground">视角</span>
        {AG_VIEWS.map((r) => (
          <Button key={r.id} asChild size="xs" variant={currentAs === r.id ? "primary" : "ghost"} data-testid="ag-role-switch">
            <a href={href({ as: r.id })} title={r.note}>{r.label}</a>
          </Button>
        ))}
        <Badge tone="outline" className="ml-1">预览手段 · 真实权限在服务端 RLS</Badge>
      </div>
      <StatePreviewSwitcher current={uiState} />
    </div>
  );
}
