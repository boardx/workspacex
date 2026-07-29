"use client";
import * as React from "react";
import { FileOutput, Link2, Camera, FileText, AlertTriangle, ArrowUpRight, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import { VisibilityBadge } from "./visibility-badge";
import {
  BIND_MODES,
  DECISION_ACTIONS,
  LANDING_ACTIONS,
  LANDING_ARTIFACTS,
  canEnterDecision,
  type BindMode,
  type BindModeSpec,
  type LandingArtifact,
} from "@/lib/mock/chat";

/**
 * UC-8.3 对话产出落地 —— 对话侧的落地入口 + 三模式绑定 + 未挂来源标灰 + 产物列表徽标。
 *
 * ⚠ 机制底座在 `00-core/uc-0-1`（D-38）：三模式语义、快照不可变、引用资格门控**不在此另建**，
 *   本屏只做对话侧接线。凡看似「对话自带一套产出机制」处，README 标待裁决。
 *
 * 观察者（readOnly）不渲染落地动作（UC-8.5）——真实权限由服务端不下发实现。
 */
export function LandingPanel({ state, readOnly = false }: { state: UiState; readOnly?: boolean }) {
  return (
    <div className="flex h-full flex-col" data-testid="chat-landing">
      <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <FileOutput aria-hidden className="h-4 w-4 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="truncate text-14 font-semibold">对话产出落地</h1>
          <p className="truncate text-11 text-muted-foreground">
            欧洲储能进入策略 · 假设梳理 —— 把结论封装成 Artifact 并选绑定模式
          </p>
        </div>
        {readOnly && <span className="text-11 text-muted-foreground">观察者只读</span>}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <StateShell
          state={state}
          skeletonRows={4}
          emptyHint="这个线程还没有可落地的结论。产出会随对话生成，或在产物卡上点「加入报告 / 派给验证」。"
          errors={{ mode: "请先选择绑定模式后再落地", source: "该结论未挂来源，只能落草稿，不能定版" }}
          depFailure={{ what: "报告服务与知识图谱写回暂时不可用；已生成的绑定关系不变，稍后可重试。" }}
          denial={{ layer: "project", reason: "你在本项目是观察者，落地动作不下发" }}
          successMessage="已定版 artifact@v3 · 已加入报告正式版"
        >
          {!readOnly && <LandingBody />}
        </StateShell>
      </div>
    </div>
  );
}

function LandingBody() {
  const [selected, setSelected] = React.useState<LandingArtifact>(LANDING_ARTIFACTS[0]!);
  const [mode, setMode] = React.useState<BindMode>(selected.mode);

  const pick = (a: LandingArtifact) => {
    setSelected(a);
    setMode(a.mode);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 一、对话侧落地动作集（R3 步骤 1，按场景分组） */}
      <section className="flex flex-col gap-2" data-testid="chat-landing-actions">
        <h2 className="text-12 font-semibold">选一条结论落地</h2>
        <div className="grid gap-2 md:grid-cols-2">
          <ActionGroup title="现场" actions={LANDING_ACTIONS.live} />
          <ActionGroup title="研究" actions={LANDING_ACTIONS.research} />
        </div>
      </section>

      {/* 二、产物列表（右栏「产物」标签同源）—— 三态徽标 + 未挂来源标灰 */}
      <section className="flex flex-col gap-2" data-testid="chat-landing-artifacts">
        <h2 className="text-12 font-semibold">本线程产物（{LANDING_ARTIFACTS.length}）</h2>
        <ul className="flex flex-col gap-2">
          {LANDING_ARTIFACTS.map((a) => (
            <ArtifactRow key={a.id} art={a} selected={a.id === selected.id} onSelect={() => pick(a)} />
          ))}
        </ul>
      </section>

      {/* 三、三模式绑定选择器 —— 并列展示各自后果（R3 步骤 3） */}
      <ModeSelector art={selected} mode={mode} onMode={setMode} />
    </div>
  );
}

function ActionGroup({ title, actions }: { title: string; actions: { id: string; label: string; danger: boolean }[] }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-3">
        <p className="text-11 font-medium text-muted-foreground">{title}</p>
        <div className="flex flex-wrap gap-1.5">
          {actions.map((act) => (
            <Button
              key={act.id}
              size="xs"
              variant={act.danger ? "destructive" : "outline"}
              data-testid={`chat-landing-action-${act.id}`}
            >
              {act.label}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ArtifactRow({ art, selected, onSelect }: { art: LandingArtifact; selected: boolean; onSelect: () => void }) {
  const spec = BIND_MODES.find((m) => m.mode === art.mode)!;
  const grey = !art.hasSource;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        data-testid={`chat-landing-artifact-${art.id}`}
        aria-pressed={selected}
        className={[
          "flex w-full flex-col gap-1.5 rounded-md border p-3 text-left transition-all duration-200",
          selected ? "border-primary bg-muted" : "border-border bg-card hover:bg-muted",
        ].join(" ")}
      >
        <div className="flex items-center gap-2">
          <span
            className={["text-13 font-medium", grey ? "text-disabled-foreground" : "text-card-foreground"].join(" ")}
          >
            {art.artType} · {art.name}
          </span>
          <Badge tone="ai">AI</Badge>
          <span className="ml-auto flex items-center gap-1.5">
            <ModeBadge spec={spec} version={art.version} />
            <VisibilityBadge scope={art.visibility} />
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-10 text-muted-foreground">
          {/* 出处回链（AC1）*/}
          <span data-testid={`chat-landing-provenance-${art.id}`}>
            出处：对话 {art.conversationId}
            {art.messageId ? ` · 消息 ${art.messageId} · ${art.citationCount} 条引用` : " · 无消息锚点"}
          </span>
          {grey && (
            <span
              className="inline-flex items-center gap-1 rounded-sm bg-warning/10 px-1.5 py-0.5 text-warning"
              data-testid={`chat-landing-nosource-${art.id}`}
              title="未挂来源，不能进报告 —— 服务端可判定状态，不是纯视觉（AC3）"
            >
              <AlertTriangle aria-hidden className="h-3 w-3" />
              未挂来源 · 标灰
            </span>
          )}
        </div>
      </button>
    </li>
  );
}

function ModeBadge({ spec, version }: { spec: BindModeSpec; version?: string }) {
  const text = spec.mode === "snapshot" && version ? `已定版 ${version}` : spec.badge;
  return (
    <Badge tone={spec.badgeTone} data-testid={`chat-mode-badge-${spec.mode}`}>
      {spec.mode === "snapshot" ? <Camera aria-hidden className="h-3 w-3" /> : spec.mode === "live" ? <Link2 aria-hidden className="h-3 w-3" /> : <FileText aria-hidden className="h-3 w-3" />}
      {text}
    </Badge>
  );
}

function ModeSelector({ art, mode, onMode }: { art: LandingArtifact; mode: BindMode; onMode: (m: BindMode) => void }) {
  const gate = canEnterDecision({ ...art, mode });
  return (
    <section className="flex flex-col gap-2" data-testid="chat-mode-selector">
      <h2 className="text-12 font-semibold">
        绑定模式 —— {art.artType} · {art.name}
      </h2>
      <p className="text-10 text-muted-foreground">
        三种模式并列展示各自后果（不是三个光秃单选钮）。机制在 <code className="text-10">00-core/uc-0-1</code>，本屏只接线。
      </p>
      <div className="grid gap-2 md:grid-cols-3">
        {BIND_MODES.map((spec) => {
          const active = spec.mode === mode;
          const disabled = spec.mode === "snapshot" && !art.hasSource;
          return (
            <button
              key={spec.mode}
              type="button"
              disabled={disabled}
              onClick={() => onMode(spec.mode)}
              aria-pressed={active}
              data-testid={`chat-mode-option-${spec.mode}`}
              className={[
                "flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-all duration-200",
                "disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-foreground",
                active ? "border-primary bg-muted shadow-sm" : "border-border bg-card hover:bg-muted",
              ].join(" ")}
            >
              <div className="flex items-center gap-1.5">
                <ModeBadge spec={spec} version={art.version} />
                {spec.eligibleForDecision && <Badge tone="primary">可进决策</Badge>}
              </div>
              <p className="text-11 font-medium text-card-foreground">{spec.semantic}</p>
              <p className="text-10 text-muted-foreground">{spec.canDo}</p>
              {disabled && (
                <p className="text-10 text-warning">该结论未挂来源，不能定版</p>
              )}
            </button>
          );
        })}
      </div>

      {/* 引用资格门控（R3 步骤 4 / V1）—— 服务端强制 */}
      <Card>
        <CardContent className="flex flex-col gap-2 p-3">
          <p className="flex items-center gap-1.5 text-11 font-medium">
            <Info aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
            正式产出与决策
          </p>
          <div className="flex flex-wrap gap-1.5">
            {DECISION_ACTIONS.map((act) => (
              <Button
                key={act}
                size="xs"
                variant={gate.ok ? "primary" : "outline"}
                disabled={!gate.ok}
                data-testid={`chat-decision-action-${act}`}
              >
                {act}
                {gate.ok && <ArrowUpRight aria-hidden className="h-3 w-3" />}
              </Button>
            ))}
          </div>
          {!gate.ok ? (
            <p role="alert" data-testid="chat-gate-blocked" className="text-11 text-destructive">
              被服务端阻断：{gate.reason}
              {mode !== "snapshot" && art.hasSource && (
                <Button size="xs" variant="ghost" className="ml-1" onClick={() => onMode("snapshot")} data-testid="chat-gate-pin-now">
                  一键定版
                </Button>
              )}
            </p>
          ) : (
            <p data-testid="chat-gate-ok" className="text-11 text-success">
              已是固定快照，可进正式产出与决策。
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
