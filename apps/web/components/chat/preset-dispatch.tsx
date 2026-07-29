"use client";
import * as React from "react";
import { Send, Bot, Wrench, Users, HelpCircle, AlertTriangle, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import {
  PRESETS,
  DISPATCH_TARGET_LABEL,
  PRESET_OPEN_QUESTIONS,
  dispatchScopeViolation,
  type Preset,
  type DispatchTargetKind,
} from "@/lib/mock/chat";

/**
 * UC-8.4 预设对话下发 —— **整屏都是补画原型**（原型 0 命中，口径重标 2026-07-28）。
 *
 * ⚠⚠ 这是本束**权限模型未定**的一屏：谁能给谁下发、被下发者能不能改/拒——UC 未写死。
 *    界面把这三个问题做成**显式「待裁决」卡**，不替 UC 表态（见顶部横幅 + 右侧待裁决区）。
 *    使用计数按「真实实例数」而非「下发人数」呈现（AC1 / V1）。
 */
export function PresetDispatch({ state, readOnly = false }: { state: UiState; readOnly?: boolean }) {
  return (
    <div className="flex h-full flex-col" data-testid="chat-preset">
      <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Send aria-hidden className="h-4 w-4 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="truncate text-14 font-semibold">预设对话与技能</h1>
          <p className="truncate text-11 text-muted-foreground">
            引导师预先写好开场提示与内置 skill，下发给各组，打开即用
          </p>
        </div>
        <Badge tone="warning" data-testid="chat-preset-proto-tag" title="原型 0 命中，本屏为补画原型">
          补画原型 · 待裁决
        </Badge>
      </header>

      {/* 权限未定横幅 —— 高风险，放在最顶，人类一眼看到 */}
      <div className="shrink-0 border-b border-warning/30 bg-warning/10 px-4 py-2" data-testid="chat-preset-power-banner">
        <p className="flex items-start gap-1.5 text-11 text-warning">
          <ShieldAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <strong>这屏是权限模型问题，不只是界面问题。</strong>
            谁能给谁下发、被下发者能不能改 / 能不能拒——UC-8.4 未写死。下方按现有线索先渲染，
            <strong>三处「?」为待裁决，请勿当已确认设计</strong>。
          </span>
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <StateShell
          state={state}
          skeletonRows={4}
          emptyHint="还没有预设。写好开场提示与内置 skill，选下发对象后下发给各组。"
          onCreate={() => window.alert("演示：新建预设")}
          errors={{ name: "预设名不能为空", target: "请选择下发对象（全场 / 指定组 / 指定角色）" }}
          depFailure={{ what: "skill / agent 目录服务暂时不可用，无法校验可见性范围，暂不能下发。" }}
          denial={{ layer: "project", reason: "只有引导师可以编写与下发预设（此判定本身待裁决）" }}
          successMessage="已下发给全场 8 组 · 各人开始后生成各自私有对话"
        >
          {!readOnly && <PresetBody />}
        </StateShell>
      </div>
    </div>
  );
}

function PresetBody() {
  const [selected, setSelected] = React.useState<Preset>(PRESETS[0]!);
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="flex flex-col gap-4">
        <PresetList selected={selected} onSelect={setSelected} />
        <PresetEditor preset={selected} />
      </div>
      <OpenQuestions />
    </div>
  );
}

function PresetList({ selected, onSelect }: { selected: Preset; onSelect: (p: Preset) => void }) {
  return (
    <section className="flex flex-col gap-2" data-testid="chat-preset-list">
      <h2 className="text-12 font-semibold">预设（{PRESETS.length}）</h2>
      <ul className="flex flex-col gap-2">
        {PRESETS.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onSelect(p)}
              aria-pressed={p.id === selected.id}
              data-testid={`chat-preset-item-${p.id}`}
              className={[
                "flex w-full items-center gap-2 rounded-md border p-3 text-left transition-all duration-200",
                p.id === selected.id ? "border-primary bg-muted" : "border-border bg-card hover:bg-muted",
              ].join(" ")}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-13 font-medium">{p.name}</span>
                <span className="truncate text-10 text-muted-foreground">
                  下发对象：{DISPATCH_TARGET_LABEL[p.target.kind]} · {p.target.detail}
                </span>
              </div>
              {p.status === "draft" ? (
                <Badge tone="neutral">草稿</Badge>
              ) : (
                <span className="flex flex-col items-end gap-0.5">
                  {/* 使用计数 = 真实实例数（AC1）—— 与下发人数分开显示，不让人误读 */}
                  <Badge tone="primary" data-testid={`chat-preset-usage-${p.id}`}>
                    用过 {p.instanceCount} 次
                  </Badge>
                  <span className="text-10 text-muted-foreground" data-testid={`chat-preset-dispatched-${p.id}`}>
                    下发给 {p.dispatchedTo} 人
                  </span>
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <p className="text-10 text-muted-foreground">
        ⚠ 待裁决：使用计数按<strong>实例数</strong>（真实开始的对话）算，不是下发人数——下发 8 组、只有 6 个实例，就是 6。
      </p>
    </section>
  );
}

function PresetEditor({ preset }: { preset: Preset }) {
  const [targetKind, setTargetKind] = React.useState<DispatchTargetKind>(preset.target.kind);
  // 演示：把下发对象组设为「第 5 组」，触发「仅能源组」资源的越界拒绝（V1c）
  const targetGroup = targetKind === "groups" ? "第 5 组" : null;
  const violation = dispatchScopeViolation(preset, targetGroup);

  React.useEffect(() => setTargetKind(preset.target.kind), [preset.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card data-testid="chat-preset-editor">
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="preset-prompt">开场提示</Label>
          <Textarea
            id="preset-prompt"
            defaultValue={preset.openingPrompt}
            data-testid="chat-preset-prompt"
            className="min-h-16 text-12"
          />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <ResourceList icon={<Bot aria-hidden className="h-3.5 w-3.5" />} title="内置 agent" refs={preset.agents} />
          <ResourceList icon={<Wrench aria-hidden className="h-3.5 w-3.5" />} title="内置 skill" refs={preset.skills} />
        </div>

        {/* 下发对象选择器（R3 步骤 1）*/}
        <div className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1.5 text-11 font-medium">
            <Users aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
            下发对象
          </span>
          <div className="flex flex-wrap gap-1.5" data-testid="chat-preset-target">
            {(Object.keys(DISPATCH_TARGET_LABEL) as DispatchTargetKind[]).map((k) => (
              <Button
                key={k}
                size="xs"
                variant={k === targetKind ? "primary" : "outline"}
                onClick={() => setTargetKind(k)}
                data-testid={`chat-preset-target-${k}`}
              >
                {DISPATCH_TARGET_LABEL[k]}
              </Button>
            ))}
          </div>
        </div>

        {/* 可见性范围校验（R3 步骤 1 / V1c）—— 越范围下发即拒绝，不是下发后失败 */}
        {violation.blocked ? (
          <div
            role="alert"
            data-testid="chat-preset-scope-violation"
            className="flex flex-col gap-1 rounded-md border border-destructive/30 bg-destructive/5 p-2.5"
          >
            <p className="flex items-center gap-1.5 text-11 font-medium text-destructive">
              <AlertTriangle aria-hidden className="h-3.5 w-3.5" />
              下发被拒 · 组织层可见性限制
            </p>
            <p className="text-10 text-muted-foreground">
              这些资源仅对「
              {violation.offenders.map((o) => o.scopeGroup).join("、")}
              」可见，超出下发对象（{targetGroup}）范围：
              {violation.offenders.map((o) => o.name).join("、")}。越范围的资源在下发时即拒绝。
            </p>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <p className="text-10 text-muted-foreground">
              预设可见 ≠ 实例可见：各人开始后生成<strong>各自私有</strong>的对话（可见性判定归 UC-8.5）。
            </p>
            <Button size="sm" variant="primary" data-testid="chat-preset-dispatch-btn">
              <Send aria-hidden className="h-3.5 w-3.5" />
              下发
            </Button>
          </div>
        )}

        <p className="rounded-md bg-muted px-2 py-1.5 text-10 text-muted-foreground" data-testid="chat-preset-no-preapprove">
          ⚠ 预设<strong>不得预先批准任何高影响动作</strong>：实例继承 UC-8.2 全部规则（AI 主动发言必带来源、高影响动作走批准卡）。
        </p>
      </CardContent>
    </Card>
  );
}

function ResourceList({
  icon, title, refs,
}: { icon: React.ReactNode; title: string; refs: Preset["agents"] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-11 font-medium text-muted-foreground">{icon}{title}</span>
      {refs.length === 0 ? (
        <span className="text-10 text-muted-foreground">（无）</span>
      ) : (
        <ul className="flex flex-col gap-1">
          {refs.map((r) => (
            <li key={r.id} className="flex items-center gap-1.5 text-11">
              <span className="min-w-0 flex-1 truncate">{r.name}</span>
              <Badge tone={r.scope === "org" ? "neutral" : "ai"}>
                {r.scope === "org" ? "全组织可用" : `仅${r.scopeGroup}`}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 三个未定权限问题，显式渲染为待裁决卡（不替 UC 表态）*/
function OpenQuestions() {
  return (
    <aside className="flex flex-col gap-2" data-testid="chat-preset-open-questions">
      <h2 className="flex items-center gap-1.5 text-12 font-semibold">
        <HelpCircle aria-hidden className="h-3.5 w-3.5 text-warning" />
        待裁决（UC 未写死）
      </h2>
      {PRESET_OPEN_QUESTIONS.map((q) => (
        <Card key={q.id} className="border-warning/30" data-testid={`chat-preset-question-${q.id}`}>
          <CardContent className="flex flex-col gap-1 p-3">
            <p className="text-11 font-medium text-warning">{q.q}</p>
            <p className="text-10 text-muted-foreground">{q.detail}</p>
          </CardContent>
        </Card>
      ))}
    </aside>
  );
}
