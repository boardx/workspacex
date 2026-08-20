"use client";
import * as React from "react";
import {
  ChevronDown, Copy, QrCode, Radio, Headphones, Send, Lock, EyeOff,
  CircleCheck, CircleDot, Circle, AlertTriangle, ExternalLink, FlaskConical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { PROJECT_ROLE_LABEL, type ProjectRole } from "@/lib/identity";
import {
  LC_MOCK_VIEWER_OPTIONS, LC_MOCK_ROLE_SCOPE_NOTE, LC_ROLE_CAN_SEE_STAGE,
  LC_MOCK_STAGE_BAR, LC_MOCK_CHECKIN, LC_MOCK_MODULE_TABS, LC_MOCK_MODULE_CARDS,
  LC_MOCK_GROUP_SIDEBAR, LC_MOCK_GROUP_TREE, LC_MOCK_KANBAN, LC_MOCK_STAGE_GRAPH,
  LC_NODE_STATE_TONE, LC_SCREEN_LABEL,
  type LcScreen, type LcState, type LcModuleKey, type LcModuleCard,
  type LcTreeNode, type LcGroupStatusTone,
} from "@/lib/mock/live-collab-orchestration";

/**
 * Phase 10「现场协作编排」UI 先行原型（ADR-003 签核第 ① 件材料）。
 *
 * ⚠ **纯前端 + mock，不接后端**。这里做的是**编排层的真实交互结构**（视角切换/分组签到/
 *   五模块侧栏/全场三视图），供人类点、看七态、逐条核对「实现者替 UC 做了什么决定」。
 *   数据全部来自 `@/lib/mock/live-collab-orchestration`（文件头有大字 MOCK 告示）。
 *
 * 预览手段（不是权限实现，真实权限在服务端 RLS）：
 *   ?screen= stage-default|group-graph|group-survey|group-research|group-interview|
 *            group-chat|stage-checkin|stage-graph|stage-kanban
 *   ?state=  default|loading|empty|invalid|dep-failed|denied|success
 *   ?as=     facilitator|groupLead|member|observer   （视角切换器）
 */

const STATUS_TONE_CLS: Record<LcGroupStatusTone, string> = {
  running: "text-success border-success/30 bg-success/5",
  missing: "text-warning border-warning/40 bg-warning/5",
  intervene: "text-destructive border-destructive/30 bg-destructive/5",
};

export function OrchestrationPreview({
  screen, state, role,
}: { screen: LcScreen; state: LcState; role: ProjectRole }) {
  const isStageScreen = screen.startsWith("stage-");
  const canSeeStage = LC_ROLE_CAN_SEE_STAGE[role];
  // 无权限：角色不能看全场却在看全场屏，或显式 ?state=denied
  const denied = state === "denied" || (isStageScreen && !canSeeStage);

  return (
    <div
      data-testid="lc-orchestration-preview"
      className="mx-auto flex min-h-screen max-w-6xl flex-col gap-3 bg-background p-4 text-foreground md:p-6"
    >
      <MockBanner />
      <ViewerSwitcher role={role} screen={screen} />
      <RoleScopeNote role={role} />
      <StageBar role={role} />

      <div className="mt-1 flex flex-col gap-2">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-16 font-semibold tracking-tight" data-testid="lc-screen-title">
            {LC_SCREEN_LABEL[screen]}
          </h2>
          <span className="text-11 text-muted-foreground">界面态：{state}</span>
        </div>

        {denied ? (
          <DeniedPanel role={role} isStageScreen={isStageScreen} />
        ) : state === "loading" ? (
          <LoadingSkeleton />
        ) : (
          <ScreenBody screen={screen} state={state} role={role} />
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── 壳：MOCK 告示 ─────────────────────────── */

function MockBanner() {
  return (
    <div
      data-testid="lc-mock-banner"
      className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/5 px-3.5 py-2.5"
    >
      <FlaskConical aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      <p className="text-11 leading-relaxed text-muted-foreground">
        <span className="font-semibold text-warning-foreground">UI 先行原型 · 纯 MOCK 数据 · 未接后端。</span>{" "}
        这是 Phase 10「现场协作编排」设计签核第 ① 件（UI）材料：可点、可切七态、可切视角。
        标 <Badge tone="outline" className="mx-0.5">待补契约</Badge> 的展示位在仓库里没有字段供数，
        标 <Badge tone="outline" className="mx-0.5">待签核</Badge> 的口径需人类裁定——都不是可编造的真数据。
      </p>
    </div>
  );
}

/* ─────────────────────────── 视角切换器 ─────────────────────────── */

function ViewerSwitcher({ role, screen }: { role: ProjectRole; screen: LcScreen }) {
  const [open, setOpen] = React.useState(false);
  const canSeeStage = LC_ROLE_CAN_SEE_STAGE[role];
  // 组长/组员只锁本组，不给全场选项；观察者按 [待签核] 默认给全场只读
  const options = LC_MOCK_VIEWER_OPTIONS.filter((o) => (o.kind === "stage" ? canSeeStage : true));
  const locked = role === "groupLead" || role === "member"; // 直接锁定本组，无需下拉
  // 分组视角锚定「第 2 组」——与 identity mock 里 groupLead/member 归属第 2 组一致，
  // 也与分组内容区（本组图谱/对话都属第 2 组）对齐，避免顶部标签与正文对不上。
  const currentLabel = screen.startsWith("stage-")
    ? "主持台 · 全场"
    : LC_MOCK_VIEWER_OPTIONS.find((o) => o.id === "g2")?.label ?? "分组";

  return (
    <div className="flex items-center gap-2" data-testid="lc-viewer-switcher">
      <span className="text-11 font-medium text-muted-foreground">视角</span>
      <Badge tone="ai" data-testid="lc-role-badge">{PROJECT_ROLE_LABEL[role]}</Badge>
      <div className="relative">
        <Button
          size="sm"
          variant="outline"
          data-testid="lc-viewer-trigger"
          disabled={locked}
          onClick={() => setOpen((v) => !v)}
          className="gap-1.5"
        >
          <span className="max-w-[16rem] truncate">{locked ? "本组（已锁定）" : currentLabel}</span>
          {!locked && <ChevronDown aria-hidden className="h-3.5 w-3.5" />}
        </Button>

        {open && !locked && (
          <div
            data-testid="lc-viewer-menu"
            className="absolute left-0 top-9 z-20 w-80 rounded-lg border border-border/50 bg-background/95 p-1.5 shadow-lg backdrop-blur-md"
          >
            {options.map((o) => (
              <div
                key={o.id}
                data-testid={`lc-viewer-option-${o.id}`}
                className="flex cursor-default items-center justify-between gap-2 rounded-md px-2.5 py-2 transition-colors duration-200 hover:bg-muted"
              >
                <div className="min-w-0">
                  <div className="truncate text-12 font-medium">{o.label}</div>
                  <div className="truncate text-10 text-muted-foreground">{o.sub}</div>
                </div>
                {o.status && (
                  <span
                    data-testid={`lc-viewer-status-${o.id}`}
                    className={cn(
                      "shrink-0 rounded-sm border px-1.5 py-0.5 text-10 font-medium",
                      STATUS_TONE_CLS[o.statusTone ?? "running"],
                    )}
                    title={o.statusSource === "TODO-no-source" ? "待签核：该状态全仓无来源，判据待裁定" : undefined}
                  >
                    {o.status}
                    {o.statusSource === "TODO-no-source" && "＊"}
                  </span>
                )}
              </div>
            ))}
            <p className="px-2.5 pb-1 pt-1.5 text-9 text-muted-foreground">
              ＊「需介入」全仓无来源（待签核）· 「缺 N 人」可由分组签到推导
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function RoleScopeNote({ role }: { role: ProjectRole }) {
  return (
    <p
      data-testid="lc-role-scope-note"
      className="rounded-md border border-border bg-panel px-3 py-2 text-11 leading-relaxed text-muted-foreground"
    >
      {LC_MOCK_ROLE_SCOPE_NOTE[role]}
    </p>
  );
}

/* ─────────────────────────── 环节状态条（复用 F963 黑条样式）─────────────────────────── */

function StageBar({ role }: { role: ProjectRole }) {
  const b = LC_MOCK_STAGE_BAR;
  const canControl = role === "facilitator";
  return (
    <Card data-testid="lc-stage-bar">
      <div className="flex items-center gap-3 rounded-t-lg bg-inverse px-4 py-3 text-inverse-foreground">
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-destructive" />
        <div className="min-w-0 flex-1">
          <div className="text-10 uppercase tracking-wide text-muted-foreground">
            环节 {b.ordinal}/{b.total}
          </div>
          <div className="truncate text-14 font-medium" data-testid="lc-stage-title">{b.title}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className="rounded-sm border border-inverse-foreground/20 px-1.5 py-0.5 text-11 tabular-nums text-inverse-foreground/80"
            data-testid="lc-stage-countdown"
            title="待签核：剩余倒计时无契约字段，需先跟 phase-01 议程束确认是否新增剩余时长"
          >
            {b.countdown} 剩余＊
          </span>
          {canControl && (
            <span
              className="rounded-sm border border-destructive/40 bg-destructive/15 px-1.5 py-0.5 text-11 text-destructive-foreground"
              data-testid="lc-stage-intervene"
              title="待签核：介入告警判据全仓无来源"
            >
              {b.intervene}＊
            </span>
          )}
        </div>
      </div>
      {canControl && (
        <div className="flex flex-wrap items-center gap-2.5 px-4 py-2.5">
          <span className="text-9 text-muted-foreground">＊倒计时与介入告警为待签核字段（无契约来源），真实页面补契约前不渲染编造值</span>
          <span className="flex-1" />
          <Button size="xs" variant="outline" data-testid="lc-stage-plus5">＋5 分钟</Button>
          <Button size="xs" variant="primary" data-testid="lc-stage-next">下一环节</Button>
        </div>
      )}
    </Card>
  );
}

/* ─────────────────────────── 七态：通用件 ─────────────────────────── */

function LoadingSkeleton() {
  return (
    <div data-testid="loading" className="flex animate-pulse flex-col gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-20 rounded-lg bg-muted" />
      ))}
    </div>
  );
}

function EmptyState({ what, cta }: { what: string; cta?: string }) {
  return (
    <div
      data-testid="empty"
      className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-12 text-center"
    >
      <p className="text-12 text-muted-foreground">{what}</p>
      {cta && <Button size="sm" variant="outline" data-testid="lc-empty-cta">{cta}</Button>}
    </div>
  );
}

function DepFailedBanner({ dep }: { dep: string }) {
  return (
    <div
      data-testid="dep-failed"
      className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/5 px-3.5 py-3"
    >
      <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      <div className="min-w-0">
        <p className="text-12 font-medium text-warning-foreground">依赖未就绪 · 该视图停在 UI 骨架</p>
        <p className="mt-1 text-11 leading-relaxed text-muted-foreground">{dep}</p>
      </div>
    </div>
  );
}

function DeniedPanel({ role, isStageScreen }: { role: ProjectRole; isStageScreen: boolean }) {
  return (
    <div
      data-testid="denied"
      className="flex items-start gap-2.5 rounded-lg border border-dashed border-border bg-panel px-3.5 py-4"
    >
      <Lock aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-12 font-medium">
          {PROJECT_ROLE_LABEL[role]} 无权访问{isStageScreen ? "「主持台 · 全场」" : "此内容"}
        </p>
        <p className="mt-1 text-11 leading-relaxed text-muted-foreground">
          真实权限由服务端按角色 + 分组成员关系判定（RLS），不是前端隐藏——改 URL 也拿不到数据。
          视角切换只是预览手段。{role === "observer" && "观察者可见范围本身为 [待签核]，此处按「全场只读聚合」默认呈现拒绝。"}
        </p>
      </div>
    </div>
  );
}

function SuccessToast({ text }: { text: string }) {
  return (
    <p data-testid="saved" className="rounded-md border border-success/30 bg-success/5 px-3 py-2 text-11 text-success transition-opacity duration-300">
      {text}
    </p>
  );
}

function PendingContractTag({ what }: { what: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-sm border border-dashed border-border px-1.5 py-0.5 text-9 text-muted-foreground">
      <EyeOff aria-hidden className="h-3 w-3" /> 待补契约 · {what}
    </span>
  );
}

/* ─────────────────────────── 屏路由 ─────────────────────────── */

function ScreenBody({ screen, state, role }: { screen: LcScreen; state: LcState; role: ProjectRole }) {
  switch (screen) {
    case "stage-default":
      return <StageDefault state={state} />;
    case "stage-checkin":
      return <StageCheckin state={state} />;
    case "stage-kanban":
      return <StageKanban state={state} />;
    case "stage-graph":
      return <StageGraph state={state} />;
    case "group-graph":
      return <GroupShell module="graph" state={state} role={role}><GroupGraph /></GroupShell>;
    case "group-chat":
      return <GroupShell module="chat" state={state} role={role}><ModuleCardList module="chat" state={state} /></GroupShell>;
    case "group-interview":
      return <GroupShell module="interview" state={state} role={role}><ModuleCardList module="interview" state={state} /></GroupShell>;
    case "group-research":
      return <GroupShell module="research" state={state} role={role}><ModuleCardList module="research" state={state} /></GroupShell>;
    case "group-survey":
      return <GroupShell module="survey" state={state} role={role}><ModuleCardList module="survey" state={state} /></GroupShell>;
    default:
      return null;
  }
}

/* ─────────────────────────── 主持台·全场默认（三视图入口）─────────────────────────── */

function StageDefault({ state }: { state: LcState }) {
  const subviews = [
    { key: "stage-kanban", label: "看板", meta: "4 组实时卡片" },
    { key: "stage-graph", label: "知识图谱 · 决策推演", meta: "决策树 · 待决岔口 · 推演" },
    { key: "stage-checkin", label: "分组与签到", meta: `${LC_MOCK_CHECKIN.arrivedTotal}/${LC_MOCK_CHECKIN.total} 已到` },
  ];
  return (
    <div className="flex flex-col gap-3">
      {state === "success" && <SuccessToast text="已切到「主持台 · 全场」" />}
      <p className="text-11 text-muted-foreground">
        主持台·全场有三个子视图。视角切换器展开态可见「主持台·全场(4组·看板/知识图谱/签到)」+ 4 个分组选项（各带状态后缀）。
      </p>
      <div className="grid gap-3 sm:grid-cols-3" data-testid="lc-stage-subviews">
        {subviews.map((s) => (
          <Card key={s.key} className="p-4 transition-colors duration-200 hover:bg-muted" data-testid={`lc-stage-subview-${s.key}`}>
            <div className="text-13 font-semibold">{s.label}</div>
            <div className="mt-1 text-11 text-muted-foreground">{s.meta}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────── 主持台·分组与签到 ─────────────────────────── */

function StageCheckin({ state }: { state: LcState }) {
  const c = LC_MOCK_CHECKIN;
  const [copied, setCopied] = React.useState<string | null>(null);

  if (state === "empty") {
    return <EmptyState what="还没有分组到场——发出加入链接后，参与者点开即进（不需要注册）。" cta="生成分组链接" />;
  }
  if (state === "dep-failed") {
    return <DepFailedBanner dep="免注册进场链接的生成/校验机制复用 phase-01 uc-1-2；该能力域仓储未就绪时，链接与二维码只能展示占位。" />;
  }

  return (
    <div className="flex flex-col gap-3" data-testid="lc-checkin">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-11 text-muted-foreground">
          {c.arrivedTotal} / {c.total} 已到 · 每组一条加入链接，打开即进，不需要注册
          <span className="ml-1.5"><PendingContractTag what="到场判定口径（待签核：点链接即到 vs 需心跳）" /></span>
        </p>
        <Button size="sm" variant="outline" data-testid="lc-checkin-view-join">
          <ExternalLink aria-hidden className="h-3.5 w-3.5" /> 看加入页
        </Button>
      </div>

      {state === "invalid" && (
        <p role="alert" data-testid="err-link" className="text-11 text-destructive">
          链接生成失败：该分组尚未指定组长，无法签发进场链接（校验在服务端强制，前端仅回显原因）。
        </p>
      )}
      {state === "success" && copied && <SuccessToast text={`已复制第 ${copied} 组加入链接`} />}

      <div className="grid gap-3 sm:grid-cols-2" data-testid="lc-checkin-grid">
        {c.groups.map((g) => {
          const missing = g.total - g.arrivedCount;
          return (
            <Card key={g.no} className="flex flex-col gap-3 p-4" data-testid={`lc-checkin-card-${g.no}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-13 font-semibold">第 {g.no} 组 · {g.name}</span>
                    {missing > 0 ? (
                      <Badge tone="warning" data-testid={`lc-checkin-missing-${g.no}`}>缺 {missing} 人</Badge>
                    ) : (
                      <Badge tone="neutral">已齐</Badge>
                    )}
                  </div>
                  <div className="mt-0.5 text-10 text-muted-foreground">{g.scene}</div>
                </div>
                <span className="shrink-0 text-13 font-semibold tabular-nums" data-testid={`lc-checkin-progress-${g.no}`}>
                  {g.arrivedCount}/{g.total} 已到
                </span>
              </div>

              <div className="flex items-center gap-1.5 rounded-md border border-border bg-panel px-2 py-1.5">
                <span className="min-w-0 flex-1 truncate text-10 text-muted-foreground" data-testid={`lc-checkin-url-${g.no}`}>{g.url}</span>
                <Button size="xs" variant="ghost" data-testid={`lc-checkin-copy-${g.no}`} onClick={() => setCopied(g.no)}>
                  <Copy aria-hidden className="h-3.5 w-3.5" /> 复制
                </Button>
                <Button size="xs" variant="ghost" data-testid={`lc-checkin-qr-${g.no}`}>
                  <QrCode aria-hidden className="h-3.5 w-3.5" /> 二维码
                </Button>
              </div>

              <ul className="flex flex-col gap-1">
                {g.members.map((m) => (
                  <li key={m.name} className="flex items-center gap-2" data-testid={`lc-checkin-member-${g.no}-${m.name}`}>
                    <Avatar initials={m.ab} size="sm" tone={m.arrived ? "human" : "muted"} />
                    <span className="text-11">{m.name}</span>
                    {m.tag === "组长" && <Badge tone="warning">组长</Badge>}
                    <span className="flex-1" />
                    {m.arrived ? (
                      <span className="text-10 text-success">已到</span>
                    ) : (
                      <span className="text-10 text-muted-foreground">未到</span>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
      <p className="text-9 text-muted-foreground">
        二维码生成（前端本地 vs 服务端出图）、「看加入页」是预览还是独立 URL —— 均为 [待签核]，此处给合理默认。
      </p>
    </div>
  );
}

/* ─────────────────────────── 主持台·看板 ─────────────────────────── */

function StageKanban({ state }: { state: LcState }) {
  const [broadcast, setBroadcast] = React.useState(false);

  if (state === "dep-failed") {
    return (
      <DepFailedBanner dep="看板消费 phase-02 F02 看板领域数据 + phase-01 canvas/recording 束的实时引述。phase-02 目前 not_started、canvas 束零仓储实现——此视图在那些束签核并落地前只能是 UI 骨架，不接真实卡片。" />
    );
  }
  if (state === "empty") {
    return <EmptyState what="当前环节还没有分组产生实时卡片。" />;
  }

  return (
    <div className="flex flex-col gap-3" data-testid="lc-kanban">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-11 text-muted-foreground">
          四组并行 · 每组一路录音，实时喂给本组的推演模板
          <span className="ml-1.5"><PendingContractTag what="进度% / 素材充足度 无契约字段" /></span>
        </p>
        <Button size="sm" variant="primary" data-testid="lc-kanban-broadcast" onClick={() => setBroadcast(true)}>
          <Radio aria-hidden className="h-3.5 w-3.5" /> 广播提示给所有组长
        </Button>
      </div>
      {(state === "success" || broadcast) && (
        <SuccessToast text="广播已发出 · 已推送到 4 位组长的主持台对话（这是危险动作：全组可见，已二次确认）" />
      )}

      <div className="grid gap-3 sm:grid-cols-2" data-testid="lc-kanban-grid">
        {LC_MOCK_KANBAN.map((g) => (
          <Card
            key={g.no}
            className={cn("flex flex-col gap-2.5 p-4", g.intervene && "border-destructive/40")}
            data-testid={`lc-kanban-card-${g.no}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-13 font-semibold">{g.no} · {g.scene}</span>
              {g.intervene ? (
                <Badge tone="danger" data-testid={`lc-kanban-intervene-${g.no}`}>需介入</Badge>
              ) : (
                <span className="text-10 tabular-nums text-muted-foreground">{g.time}</span>
              )}
            </div>

            <blockquote className="border-l-2 border-ai/30 bg-ai-tint/40 px-2.5 py-1.5 text-11 leading-relaxed text-ai-tint-foreground">
              「{g.quote}」<span className="text-10 text-muted-foreground"> —— {g.quoteBy}</span>
            </blockquote>

            <div className="flex items-center gap-2">
              <Progress value={g.progressPct} tone={g.intervene ? "destructive" : "primary"} className="flex-1" label={`${g.no} 进度`} />
              <span className="shrink-0 text-10 tabular-nums text-muted-foreground">{g.progressPct}%</span>
            </div>
            <div className="text-10 text-muted-foreground">{g.template} · {g.progressNote}</div>

            {g.intervene && g.interveneNote && (
              <p className="rounded-md bg-destructive/5 px-2 py-1.5 text-10 text-destructive">{g.interveneNote}</p>
            )}

            <div className="flex items-center gap-1.5">
              <Button size="xs" variant="outline" data-testid={`lc-kanban-listen-${g.no}`}>
                <Headphones aria-hidden className="h-3.5 w-3.5" /> 听这组
              </Button>
              {g.intervene && (
                <Button size="xs" variant="primary" data-testid={`lc-kanban-push-${g.no}`}>
                  <Send aria-hidden className="h-3.5 w-3.5" /> 推提示给组长
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────── 主持台·知识图谱决策推演 ─────────────────────────── */

function StageGraph({ state }: { state: LcState }) {
  if (state === "dep-failed") {
    return (
      <DepFailedBanner dep="知识图谱·决策推演消费 phase-02 F11/F15/F16/F17（决策树/关系/推演/下一步工作）。phase-02 目前 not_started 且无契约束签核——此视图在那些束签核前只能是 UI 骨架，不对接真实图谱。" />
    );
  }
  if (state === "empty") {
    return <EmptyState what="本场还没有形成决策节点——各组图谱汇入后这里才会长出决策树。" />;
  }

  const g = LC_MOCK_STAGE_GRAPH;
  return (
    <div className="flex flex-col gap-3" data-testid="lc-stage-graph">
      <p className="text-11 text-muted-foreground">哪些已经定了、哪个岔口还没决、下一步能开展什么工作</p>

      <TreeNodeList nodes={g.tree} testid="lc-stage-graph-tree" title="决策树 · 从主题到可执行的选择" />

      <div className="grid gap-3 md:grid-cols-2">
        <Card className="p-4" data-testid="lc-stage-graph-forks">
          <div className="mb-2 text-12 font-semibold">待决的岔口 · {g.forks.length}</div>
          <ul className="flex flex-col gap-2">
            {g.forks.map((f, i) => (
              <li key={i} className="rounded-md border border-warning/30 bg-warning/5 px-2.5 py-2">
                <div className="text-11 font-medium text-warning-foreground">{f.q}</div>
                <div className="mt-0.5 text-10 text-muted-foreground">{f.why}</div>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-4" data-testid="lc-stage-graph-prediction">
          <div className="mb-2 flex items-center gap-1.5 text-12 font-semibold">
            <Badge tone="ai">图谱推演</Badge> 如果现在拍板
          </div>
          <p className="text-11 leading-relaxed text-muted-foreground">{g.prediction}</p>
        </Card>
      </div>

      <Card className="p-4" data-testid="lc-stage-graph-nextwork">
        <div className="mb-1 text-12 font-semibold">下一步可开展的工作</div>
        <p className="mb-2.5 text-10 text-muted-foreground">每条都指向树上一个待决节点 · 点「开展」即派给对应模块或小组</p>
        <ul className="flex flex-col gap-2">
          {g.nextWork.map((m) => (
            <li key={m.name} className="flex items-center gap-2.5 rounded-md border border-border px-2.5 py-2" data-testid={`lc-nextwork-${m.node}`}>
              <Avatar initials={m.ab} size="sm" tone={m.who === "AI" ? "ai" : "human"} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-11 font-medium">{m.name}</span>
                  <Badge tone={m.imp === "高" ? "danger" : "neutral"}>{m.imp}</Badge>
                </div>
                <div className="truncate text-10 text-muted-foreground">{m.goal}</div>
                <div className="text-9 text-muted-foreground">{m.cost} · {m.who} · 验证 → {m.node}</div>
              </div>
              <Button size="xs" variant="primary" data-testid={`lc-nextwork-run-${m.node}`}>开展</Button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function TreeNodeList({ nodes, testid, title }: { nodes: LcTreeNode[]; testid: string; title: string }) {
  return (
    <Card className="p-4" data-testid={testid}>
      <div className="mb-2.5 text-12 font-semibold">{title}</div>
      <ul className="flex flex-col gap-1.5">
        {nodes.map((n) => (
          <li key={n.id} className="flex items-start gap-2.5 rounded-md border border-border px-2.5 py-2" data-testid={`${testid}-node-${n.id}`}>
            <Badge tone={LC_NODE_STATE_TONE[n.state]} className="mt-0.5 shrink-0">{n.state}</Badge>
            <div className="min-w-0">
              <div className="text-11 font-medium">{n.title}</div>
              <div className="text-10 text-muted-foreground">{n.sub}</div>
              <div className="text-9 text-muted-foreground">{n.meta}</div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ─────────────────────────── 分组视角外壳（五模块侧栏 + 中区 + 右侧本场状态）─────────────────────────── */

function GroupShell({
  module, state, role, children,
}: { module: LcModuleKey; state: LcState; role: ProjectRole; children: React.ReactNode }) {
  return (
    <div className="grid gap-3 lg:grid-cols-[8.5rem_1fr_15rem]" data-testid="lc-group-shell">
      <ModuleSidebar active={module} />
      <div className="min-w-0" data-testid="lc-group-main">{children}</div>
      <GroupStateSidebar />
    </div>
  );
}

function ModuleSidebar({ active }: { active: LcModuleKey }) {
  return (
    <nav className="flex flex-row gap-1.5 lg:flex-col" data-testid="lc-module-sidebar">
      {LC_MOCK_MODULE_TABS.map((t) => {
        const Icon = t.icon;
        const on = t.key === active;
        return (
          <div
            key={t.key}
            data-testid={`lc-module-tab-${t.key}`}
            data-active={on}
            className={cn(
              "flex items-center gap-2 rounded-md border px-2.5 py-2 transition-colors duration-200",
              on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-card-foreground hover:bg-muted",
            )}
          >
            <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-9 font-semibold", on ? "bg-primary-foreground/20" : "bg-muted")}>
              {t.ab}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 text-11 font-medium">
                <Icon aria-hidden className="h-3 w-3 shrink-0" />
                <span className="truncate">{t.label}</span>
              </div>
            </div>
            {t.count != null && (
              <span className={cn("shrink-0 text-10 tabular-nums", on ? "text-primary-foreground/80" : "text-muted-foreground")}>
                {t.count}
              </span>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function GroupStateSidebar() {
  const s = LC_MOCK_GROUP_SIDEBAR;
  const b = LC_MOCK_STAGE_BAR;
  const markIcon = { done: CircleCheck, doing: CircleDot, todo: Circle };
  return (
    <aside className="flex flex-col gap-3" data-testid="lc-group-state-sidebar">
      <Card className="p-3">
        <div className="text-11 font-semibold">本场状态</div>
        <div className="mt-1.5 flex items-center justify-between text-11">
          <span>环节 {b.ordinal} · 假设风暴</span>
          <span className="tabular-nums text-muted-foreground">{b.countdown}＊</span>
        </div>
        <div className="mt-0.5 text-10 text-muted-foreground">全场进度 {b.ordinal}/{b.total} · 下一环节 方案原型</div>
      </Card>

      <Card className="p-3">
        <div className="mb-1.5 flex items-center gap-1.5 text-11 font-semibold">
          本组进度 <PendingContractTag what="checklist 无来源" />
        </div>
        <ul className="flex flex-col gap-1">
          {s.checklist.map((c, i) => {
            const Icon = markIcon[c.mark];
            return (
              <li key={i} className="flex items-center gap-1.5 text-10">
                <Icon aria-hidden className={cn("h-3 w-3 shrink-0", c.mark === "done" ? "text-success" : c.mark === "doing" ? "text-warning" : "text-muted-foreground")} />
                <span className={cn("truncate", c.mark === "done" && "text-muted-foreground line-through")}>{c.label}</span>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card className="p-3">
        <div className="mb-1.5 flex items-center gap-1.5 text-11 font-semibold">
          需要知道 <PendingContractTag what="提示无来源" />
        </div>
        <ul className="flex flex-col gap-1.5">
          {s.needToKnow.map((n, i) => (
            <li key={i} className="text-10 leading-relaxed text-muted-foreground">· {n}</li>
          ))}
        </ul>
      </Card>

      <Card className="p-3">
        <div className="mb-1.5 flex items-center gap-1.5 text-11 font-semibold">
          已生成产出 <PendingContractTag what="产出列表无来源" />
        </div>
        <ul className="flex flex-col gap-1.5">
          {s.outputs.map((o) => (
            <li key={o.name} className="flex items-center gap-2">
              <Avatar initials={o.ab} size="sm" tone="muted" />
              <div className="min-w-0">
                <div className="truncate text-10 font-medium">{o.name}</div>
                <div className="truncate text-9 text-muted-foreground">{o.meta}</div>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </aside>
  );
}

/* ─────────────────────────── 分组·模块卡片列表（统一形态）─────────────────────────── */

const MODULE_NEW_LABEL: Record<Exclude<LcModuleKey, "graph">, string> = {
  chat: "新建对话",
  interview: "发起访谈",
  research: "新建深度研究",
  survey: "新建问卷",
};

function ModuleCardList({ module, state }: { module: Exclude<LcModuleKey, "graph">; state: LcState }) {
  const cards = LC_MOCK_MODULE_CARDS[module];
  const tab = LC_MOCK_MODULE_TABS.find((t) => t.key === module);

  if (state === "empty") {
    return <EmptyState what={`本组还没有${tab?.label}——新建第一个，路由会带上「项目/分组/环节」上下文。`} cta={MODULE_NEW_LABEL[module]} />;
  }
  if (state === "dep-failed") {
    return (
      <DepFailedBanner dep={`「${tab?.label}」的领域逻辑属 ${tab?.ownerPhase}。编排层只负责计数徽标与点开路由；该模块接口未就绪时，卡片列表停在占位。`} />
    );
  }

  return (
    <div className="flex flex-col gap-2.5" data-testid={`lc-module-list-${module}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-11 text-muted-foreground">
          第 2 组 · {tab?.label}（{tab?.count}）· 点开卡片路由到 {tab?.ownerPhase} 模块，带项目/分组/环节上下文
        </p>
        <Button size="sm" variant="outline" data-testid={`lc-module-new-${module}`}>＋ {MODULE_NEW_LABEL[module]}</Button>
      </div>

      {state === "invalid" && (
        <p role="alert" data-testid="err-new" className="text-11 text-destructive">
          新建失败：本环节未绑定该模块模板，无法在此环节创建（校验在服务端强制）。
        </p>
      )}
      {state === "success" && <SuccessToast text={`已新建并打开 ${tab?.label}（已带本环节上下文）`} />}

      {cards.map((c) => (
        <ModuleCard key={c.id} card={c} module={module} />
      ))}
    </div>
  );
}

function ModuleCard({ card, module }: { card: LcModuleCard; module: LcModuleKey }) {
  return (
    <Card className="flex flex-col gap-2 p-3.5 transition-colors duration-200 hover:bg-muted" data-testid={`lc-card-${card.id}`}>
      <div className="flex items-center gap-2">
        <Badge tone="outline">{card.vis}</Badge>
        {card.statusLabel && (
          <Badge tone={card.statusTone ?? "neutral"} data-testid={`lc-card-status-${card.id}`}>{card.statusLabel}</Badge>
        )}
        <span className="flex-1" />
        <span className="text-10 tabular-nums text-muted-foreground">{card.time}</span>
      </div>
      <p className="text-11 leading-relaxed">{card.summary}</p>
      <div className="flex items-center gap-2">
        <Avatar initials={card.who.slice(0, 2)} size="sm" tone={card.whoIsAi ? "ai" : "human"} />
        <span className="text-10 text-muted-foreground">{card.who}{card.whoIsAi && " · AI"}</span>
        <span className="flex-1" />
        {card.skills?.map((sk) => (
          <span key={sk} className="rounded-sm bg-muted px-1.5 py-0.5 text-9 text-muted-foreground">{sk}</span>
        ))}
        <Button size="xs" variant="outline" data-testid={`lc-card-open-${card.id}`}>打开模块</Button>
      </div>
    </Card>
  );
}

/* ─────────────────────────── 分组·本组图谱（graph 模块）─────────────────────────── */

function GroupGraph() {
  const g = LC_MOCK_GROUP_TREE;
  return (
    <div className="flex flex-col gap-3" data-testid="lc-group-graph">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-13 font-semibold">{g.head.no} · {g.head.scene} · 本组决策小树</div>
          <div className="text-10 text-muted-foreground">从场景出发，本组已经定了什么、还卡在哪 · 组长 {g.head.lead}</div>
        </div>
        <Button size="sm" variant="outline" data-testid="lc-group-graph-merge">汇入全场图谱</Button>
      </div>

      <DepFailedBanner dep="本组图谱消费 phase-02 知识图谱领域模型（节点/关系/决策树），phase-02 目前 not_started 且无契约束签核——决策小树在其契约签核前只能是 UI 骨架 + mock 结构，不接真实图谱数据。" />

      <TreeNodeList nodes={g.nodes} testid="lc-group-graph-tree" title="本组决策小树" />

      <div className="grid gap-3 md:grid-cols-2">
        <Card className="p-4" data-testid="lc-group-graph-facts">
          <div className="mb-2 text-12 font-semibold">本组已确认的事实</div>
          <ul className="flex flex-col gap-2">
            {g.facts.map((f, i) => (
              <li key={i} className="rounded-md border border-success/30 bg-success/5 px-2.5 py-2">
                <div className="text-11">{f.text}</div>
                <div className="mt-0.5 text-9 text-muted-foreground">{f.src}</div>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-4" data-testid="lc-group-graph-pending">
          <div className="mb-2 text-12 font-semibold">本组待决与下一步</div>
          <ul className="flex flex-col gap-2">
            {g.pending.map((p, i) => (
              <li key={i} className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/5 px-2.5 py-2">
                <span className="min-w-0 flex-1 text-11">{p.text}</span>
                <Button size="xs" variant="outline" className="shrink-0">{p.action}</Button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
