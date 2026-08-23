"use client";
import * as React from "react";
import {
  Send, Wrench, Plus, X, CheckCircle2, AlertTriangle, Lock, Sparkles, MessageSquarePlus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StaticSwitch } from "@/components/itv/static-switch";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import { cn } from "@/lib/utils";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import {
  PRESETS, DISPATCH_TARGET_LABEL, PRESET_HEADER, PRESET_EDITOR, PRESET_CONSUMER,
  PRESET_ANSWERED, dispatchScopeViolation, type Preset,
} from "@/lib/mock/chat";

/**
 * UC-8.4 预设对话与技能 —— v2 重画（原型有完整一屏，v1 误报「预设 0 命中」）。
 *
 * 原型落点：工作坊详情 → 对话子页（引导师视角）。四列表格 + 规则条 + 新建预设弹层。
 * ⚠ v1 把三条权限规则摆成「待裁决」，原型全部答死——本屏改渲染为「原型已答 + 出处」。
 * 视角：引导师视角看下发端；组员 / 观察者视角看「点开即用」消费端（只读投影）。
 */
export function PresetDispatch({
  state, readOnly = false, consumerView = false,
}: { state: UiState; readOnly?: boolean; consumerView?: boolean }) {
  const [editorOpen, setEditorOpen] = React.useState(false);

  return (
    <div className="flex h-full flex-col" data-testid="chat-preset">
      <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Send aria-hidden className="h-4 w-4 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="truncate text-14 font-semibold">{PRESET_HEADER.title}</h1>
          <p className="truncate text-11 text-muted-foreground">{PRESET_HEADER.sub}</p>
        </div>
        {!consumerView && (
          <Button size="sm" variant="primary" disabled={readOnly} data-testid="chat-preset-new" onClick={() => setEditorOpen(true)}>
            <Plus aria-hidden className="h-3.5 w-3.5" /> 新建预设
          </Button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <StateShell
          state={state}
          skeletonRows={4}
          emptyHint="还没有预设。写好开场提示与内置 skill，选下发对象后下发给各组。"
          onCreate={() => setEditorOpen(true)}
          errors={{
            "preset-name": "预设名称不能为空",
            "preset-scope": "「证据检索」仅『能源组』可见，下发给全部组员会越界——先缩小下发范围或换技能",
          }}
          depFailure={{ what: "内置技能服务（skill runtime）暂不可用，预设可保存为草稿但暂不能下发" }}
          denial={{ layer: "project", reason: "只有引导师能在工作坊里新建 / 下发预设；组长与组员在自己视角「点开即用」。你不是本工作坊的引导师" }}
          successMessage="预设已保存并下发 · 出现在对应角色视角的「点开即用」区"
        >
          {consumerView ? <ConsumerPanel /> : <DispatcherPanel readOnly={readOnly} onNew={() => setEditorOpen(true)} />}
        </StateShell>
      </div>

      {editorOpen && !readOnly && <PresetEditorOverlay onClose={() => setEditorOpen(false)} />}
    </div>
  );
}

/* ───────────────────────── 下发端（引导师视角）───────────────────────── */
function DispatcherPanel({ readOnly, onNew }: { readOnly: boolean; onNew: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      {/* 三条「原型已答」——替代 v1 的三张「待裁决」卡 */}
      <section className="rounded-lg border border-border bg-panel p-3" data-testid="chat-preset-answered">
        <p className="mb-2 flex items-center gap-1.5 text-11 font-medium text-foreground">
          <CheckCircle2 aria-hidden className="h-3.5 w-3.5 text-primary" />
          权限模型：原型已答（v1 曾把这三条摆成「待裁决」，实为已有答案）
        </p>
        <div className="grid gap-2 md:grid-cols-3">
          {PRESET_ANSWERED.map((a) => (
            <div key={a.id} className="rounded-md border border-border-subtle bg-card p-2.5" data-testid={`chat-preset-answered-${a.id}`}>
              <p className="text-11 font-medium text-foreground">{a.q}</p>
              <p className="mt-1 text-11 text-foreground">{a.answer}</p>
              <p className="mt-1.5 text-10 text-muted-foreground">出处：{a.evidence}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 预设表 · 四列（原型表头） */}
      <section data-testid="chat-preset-table">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-12 font-semibold">{PRESET_HEADER.sectionTitle}</h2>
          <Badge tone="neutral">{PRESETS.length}</Badge>
        </div>
        <div className="overflow-hidden rounded-lg border border-border">
          <Table className="w-full text-11">
            <TableHeader>
              <TableRow className="border-b border-border-subtle bg-panel text-left text-muted-foreground">
                {PRESET_HEADER.columns.map((c) => (
                  <TableHead key={c} className="px-3 py-2 font-medium">{c}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {PRESETS.map((p) => (
                <PresetRow key={p.id} preset={p} />
              ))}
            </TableBody>
          </Table>
        </div>
        {/* 规则条 —— 同时是「能不能拒」的原型答案 */}
        <p className="mt-2 flex items-start gap-1.5 rounded-md bg-ai-tint/40 px-2.5 py-2 text-11 text-ai-tint-foreground" data-testid="chat-preset-rule">
          <Sparkles aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {PRESET_HEADER.rule}
        </p>
        <div className="mt-2">
          <Button size="sm" variant="outline" disabled={readOnly} data-testid="chat-preset-new-inline" onClick={onNew}>
            <Plus aria-hidden className="h-3.5 w-3.5" /> 新建预设
          </Button>
        </div>
      </section>
    </div>
  );
}

function PresetRow({ preset }: { preset: Preset }) {
  const groupSkill = preset.skills.find((s) => s.scope === "group");
  return (
    <TableRow className="border-b border-border-subtle align-top last:border-0" data-testid={`chat-preset-row-${preset.id}`}>
      <TableCell className="px-3 py-2.5">
        <div className="font-medium text-foreground">{preset.name}</div>
        <div className="mt-0.5 text-10 text-muted-foreground">{preset.note}</div>
      </TableCell>
      <TableCell className="px-3 py-2.5">
        <div className="flex flex-wrap gap-1">
          {preset.skills.map((s) => (
            <span
              key={s.name}
              className="inline-flex items-center gap-0.5 rounded border border-border px-1.5 py-0.5 text-10 text-foreground"
              data-testid={`chat-preset-skill-${preset.id}-${s.name}`}
              title={s.scope === "group" ? `仅『${s.scopeGroup}』可见` : "全组织可用"}
            >
              <Wrench aria-hidden className="h-2.5 w-2.5 text-muted-foreground" />
              {s.name}
              {s.scope === "group" && <Lock aria-hidden className="h-2.5 w-2.5 text-warning" />}
            </span>
          ))}
        </div>
        {groupSkill && (
          <div className="mt-1 flex items-center gap-1 text-10 text-warning" data-testid={`chat-preset-scope-warn-${preset.id}`}>
            <AlertTriangle aria-hidden className="h-3 w-3" />
            「{groupSkill.name}」仅『{groupSkill.scopeGroup}』可见 · 下发对象含此范围外的组即拒
          </div>
        )}
      </TableCell>
      <TableCell className="px-3 py-2.5">
        <Badge tone="outline" data-testid={`chat-preset-to-${preset.id}`}>{DISPATCH_TARGET_LABEL[preset.to]}</Badge>
      </TableCell>
      <TableCell className="px-3 py-2.5 tabular-nums text-muted-foreground" data-testid={`chat-preset-used-${preset.id}`}>
        {preset.used} 次
      </TableCell>
    </TableRow>
  );
}

/* ───────────────────────── 消费端（组员 / 观察者视角）───────────────────────── */
function ConsumerPanel() {
  return (
    <div className="flex flex-col gap-3" data-testid="chat-preset-consumer">
      <div className="flex items-center gap-2">
        <MessageSquarePlus aria-hidden className="h-4 w-4 text-primary" />
        <h2 className="text-12 font-semibold">{PRESET_CONSUMER.roleLabel}</h2>
      </div>
      <p className="text-11 text-muted-foreground">{PRESET_CONSUMER.note}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {PRESETS.map((p) => (
          <div key={p.id} className="flex items-center gap-2 rounded-md border border-border bg-card p-2.5" data-testid={`chat-preset-consumer-item-${p.id}`}>
            <Badge tone="primary">引导师预设</Badge>
            <div className="min-w-0 flex-1">
              <div className="text-11 font-medium text-foreground">{p.name}</div>
              <div className="text-10 text-muted-foreground">{p.note}</div>
            </div>
            <Button size="xs" variant="outline" onClick={() => window.alert(`演示：点开「${p.name}」，开始你和 agent 的私有对话`)} data-testid={`chat-preset-open-${p.id}`}>点开即用</Button>
          </div>
        ))}
      </div>
      <p className="flex items-center gap-1.5 rounded-md border border-border-subtle bg-panel px-2.5 py-2 text-10 text-muted-foreground" data-testid="chat-preset-consumer-note">
        <Lock aria-hidden className="h-3 w-3" />
        这些是引导师下发的入口。用不用你自己定；点开后是你和 agent 的私有对话，产出默认留在你这里，除非你主动贴到小组画布。
      </p>
    </div>
  );
}

/* ───────────────────────── 新建预设弹层（原型 isMNewChat）───────────────────────── */
function PresetEditorOverlay({ onClose }: { onClose: () => void }) {
  const e = PRESET_EDITOR;
  const [start, setStart] = React.useState(e.startFrom[0]!.name);
  const [targets, setTargets] = React.useState<Record<string, boolean>>(
    Object.fromEntries(e.dispatchTargets.map((t) => [t.id, t.on])),
  );
  // 演示越界：勾了「只给第 4 组」而预设含仅『能源组』可见的组范围技能 → 报越界。
  const groupOnlyChecked = targets["group-4"];
  const demoPreset = PRESETS.find((p) => p.skills.some((s) => s.scope === "group"))!;
  const violation = dispatchScopeViolation(demoPreset, groupOnlyChecked ? "第 4 组" : "能源组");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="chat-preset-editor">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-card shadow-lg">
        <div className="flex items-start justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="text-13 font-semibold" data-testid="chat-preset-editor-title">{e.title}</h2>
            <p className="mt-0.5 text-10 text-muted-foreground">{e.context}</p>
          </div>
          <button type="button" onClick={onClose} data-testid="chat-preset-editor-close" className="text-muted-foreground transition-colors hover:text-background-foreground">
            <X aria-hidden className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {/* 可见性说明（newChatVis） */}
          <p className="mb-3 flex items-start gap-1.5 rounded-md bg-panel px-2.5 py-2 text-10 text-muted-foreground" data-testid="chat-preset-editor-vis">
            <Badge tone="neutral">V</Badge>
            {e.visNote}
          </p>

          {/* 从预设开始 */}
          <Field label="从预设开始">
            <div className="grid grid-cols-2 gap-1.5">
              {e.startFrom.map((s) => (
                <button
                  key={s.name} type="button"
                  onClick={() => setStart(s.name)}
                  data-testid={`chat-preset-editor-start-${s.name}`}
                  className={cn(
                    "flex items-start gap-2 rounded-md border px-2 py-1.5 text-left",
                    s.name === start ? "border-primary bg-panel" : "border-border-subtle hover:bg-muted/60",
                  )}
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-9 font-semibold text-muted-foreground">{s.ab}</span>
                  <span className="min-w-0">
                    <span className="block text-11 font-medium text-foreground">{s.name}</span>
                    <span className="block text-9 text-muted-foreground">{s.note}</span>
                  </span>
                </button>
              ))}
            </div>
          </Field>

          <Field label="对话名称">
            <input
              data-testid="chat-preset-editor-name"
              defaultValue={start}
              className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-11 text-foreground outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-ring"
            />
          </Field>

          {/* 预设技能 · 引导师已配好，可增减（问题②答案） */}
          <Field label={e.skillsNote}>
            <div className="flex flex-wrap gap-1.5" data-testid="chat-preset-editor-skills">
              {e.presetSkills.map((s) => (
                <span key={s} className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-10 text-foreground">
                  {s} <X aria-hidden className="h-2.5 w-2.5 text-muted-foreground" />
                </span>
              ))}
              <button type="button" onClick={() => window.alert("演示：添加技能")} className="inline-flex items-center gap-0.5 rounded border border-dashed border-border px-1.5 py-0.5 text-10 text-muted-foreground" data-testid="chat-preset-editor-add-skill">
                <Plus aria-hidden className="h-2.5 w-2.5" /> 添加技能
              </button>
            </div>
          </Field>

          {/* 带入的现场上下文 */}
          <Field label="带入的现场上下文">
            <div className="flex flex-col gap-1" data-testid="chat-preset-editor-context">
              {e.contextSources.map((c) => (
                <label key={c.label} className="flex items-center justify-between rounded-md border border-border-subtle px-2 py-1 text-11">
                  <span className={cn(c.locked && "text-muted-foreground")}>
                    {c.label} {c.locked && <Lock aria-hidden className="inline h-2.5 w-2.5" />}
                  </span>
                  <StaticSwitch on={c.on} label={c.label} testId={`chat-preset-ctx-${c.label}`} />
                </label>
              ))}
            </div>
          </Field>

          {/* 下发对象 */}
          <Field label="下发对象">
            <div className="flex flex-col gap-1" data-testid="chat-preset-editor-targets">
              {e.dispatchTargets.map((t) => (
                <label key={t.id} className="flex items-center gap-2 rounded-md border border-border-subtle px-2 py-1 text-11">
                  <input
                    type="checkbox" checked={!!targets[t.id]}
                    onChange={(ev) => setTargets((s) => ({ ...s, [t.id]: ev.target.checked }))}
                    data-testid={`chat-preset-target-${t.id}`}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  <span>{t.label}</span>
                </label>
              ))}
            </div>
            {violation.blocked && (
              <p className="mt-1.5 flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-10 text-warning" data-testid="err-preset-scope">
                <AlertTriangle aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
                越界：「{violation.offenders.map((o) => o.name).join("、")}」仅『能源组』可见，下发给第 4 组即超出范围——下发会被拒。先缩小范围或换技能。
              </p>
            )}
          </Field>

          <Field label="开场提示">
            <Textarea data-testid="chat-preset-editor-opening" rows={3} defaultValue="先读本组画布，指出还缺哪几类信息，每条给一个候选便签，标出可能的来源。" />
          </Field>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
          <span className="text-10 text-muted-foreground">{e.foot}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={onClose} data-testid="chat-preset-editor-cancel">取消</Button>
            <Button size="sm" variant="primary" disabled={violation.blocked} data-testid="chat-preset-editor-save">{e.cta}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1 text-10 font-medium text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
