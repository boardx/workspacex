"use client";
import * as React from "react";
import { Plus, X, Play, Check, Zap, AlertTriangle, Info, Layers } from "lucide-react";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import type { ProjectRole } from "@/lib/identity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  SEGMENT_BINDINGS, A0_TEMPLATES, AGENDA_SEGMENT_NAMING_NOTE, type SegmentBinding,
} from "@/lib/mock/canvas";

const MAX_TEMPLATES = 2; // [Backlog] 同一议程环节最多绑两个模板

/**
 * UC-7.1 议程环节绑定模板与 skill + 现场实例化（F102）
 * [设计] 蓝本设计器 → 第 9/10/13 项配置面板（未探明，此为推断入口）。
 * 左列议程环节链（proto-08 五步）、右侧配置面板：绑定模板（≤2）+ 本环节可用 skill。
 * 危险/关键点显式：两模板上限校验（原型确认缺失）、现场实例化固化 key+版本。
 */
export function SegmentBinding({ state, previewRole }: { state: UiState; previewRole: ProjectRole | null }) {
  const [segments, setSegments] = React.useState<SegmentBinding[]>(SEGMENT_BINDINGS);
  const [activeId, setActiveId] = React.useState<string>(SEGMENT_BINDINGS.find((s) => s.current)?.id ?? SEGMENT_BINDINGS[0]!.id);
  const [picking, setPicking] = React.useState(false);
  const [limitWarn, setLimitWarn] = React.useState(false);
  const [instantiated, setInstantiated] = React.useState<string | null>(null);
  // 只有引导师可配置绑定；组长/组员/观察者只读预览
  const readOnly = previewRole !== "facilitator";

  const active = segments.find((s) => s.id === activeId)!;

  const addTemplate = (key: string, displayName: string, version: string) => {
    if (active.templates.length >= MAX_TEMPLATES) {
      setLimitWarn(true);
      return;
    }
    setSegments((prev) => prev.map((s) => (s.id === activeId ? { ...s, templates: [...s.templates, { key, displayName, version }] } : s)));
    setPicking(false);
  };
  const removeTemplate = (key: string) => {
    setSegments((prev) => prev.map((s) => (s.id === activeId ? { ...s, templates: s.templates.filter((t) => t.key !== key) } : s)));
    setLimitWarn(false);
  };

  return (
    <div className="flex h-full flex-col" data-testid="segbind-root">
      <header className="flex flex-col gap-1 border-b border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <Layers aria-hidden className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-14 font-semibold tracking-tight">蓝本设计器 · 议程环节绑定</h1>
          <Badge tone="outline">材料准备</Badge>
        </div>
        <p className="flex items-start gap-1 text-10 text-warning" data-testid="segbind-naming-note">
          <AlertTriangle aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
          {AGENDA_SEGMENT_NAMING_NOTE}
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <StateShell
          state={state}
          skeletonRows={5}
          emptyHint="这个蓝本还没有议程环节——先在议程编辑器里加环节，再回来绑定模板与 skill。"
          errors={{ limit: "同一议程环节最多绑两个模板（避免摊薄时间），请先移除一个再添加" }}
          depFailure={{ what: "模板注册表不可用，绑定选择器只列出缓存的已发布模板；新绑定暂不可保存", retry: () => location.reload() }}
          denial={{ layer: "project", reason: "只有引导师能在蓝本里配置环节绑定，你的角色只能查看现场实例化的画布" }}
          successMessage="已保存绑定并记录所绑模板的版本号；现场切到该环节时按此版本为每组实例化画布"
        >
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
            {/* 左：议程环节链 */}
            <aside className="flex flex-col gap-1.5" data-testid="segbind-list">
              <h2 className="text-10 font-semibold uppercase tracking-wide text-muted-foreground">议程环节链 · {segments.length} 环节</h2>
              {segments.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setActiveId(s.id)}
                  aria-pressed={s.id === activeId}
                  data-testid={`segbind-agenda-seg-${s.id}`}
                  className={cn(
                    "flex flex-col gap-1 rounded-md border px-2.5 py-2 text-left transition-colors duration-200 hover:bg-muted",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                    s.id === activeId ? "border-primary bg-accent" : "border-border-subtle bg-card",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-12 font-medium">{s.order} {s.title}</span>
                    {s.current && <Badge tone="primary">当前</Badge>}
                  </div>
                  <span className="text-10 text-muted-foreground">
                    {s.duration} · 模板 {s.templates.length || "未绑"} · skill {s.skills.length}
                  </span>
                </button>
              ))}
            </aside>

            {/* 右：配置面板 */}
            <section className="flex flex-col gap-4" data-testid="segbind-panel">
              <div className="flex items-center justify-between">
                <h2 className="text-13 font-semibold">{active.order} {active.title} · {active.duration}</h2>
                {active.current && (
                  <Button size="sm" variant="primary" disabled={active.templates.length === 0} onClick={() => setInstantiated(active.id)} data-testid="segbind-instantiate">
                    <Zap aria-hidden className="h-3.5 w-3.5" /> 现场实例化给各组
                  </Button>
                )}
              </div>

              {/* 绑定模板（≤2）*/}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-12 font-medium">绑定模板</h3>
                  <span className={cn("text-10", active.templates.length >= MAX_TEMPLATES ? "text-warning" : "text-muted-foreground")} data-testid="segbind-template-count">
                    {active.templates.length} / {MAX_TEMPLATES}
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {active.templates.map((t) => (
                    <div key={t.key} className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-2.5 py-1.5" data-testid={`segbind-bound-${t.key}`}>
                      <div className="flex items-center gap-2">
                        <span className="text-12">{t.displayName}</span>
                        <span className="font-mono text-10 text-muted-foreground">{t.key} {t.version}</span>
                      </div>
                      {!readOnly && (
                        <Button size="icon" variant="ghost" aria-label={`移除 ${t.displayName}`} onClick={() => removeTemplate(t.key)} data-testid={`segbind-remove-${t.key}`}>
                          <X aria-hidden className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                  {active.templates.length === 0 && (
                    <p className="rounded-md border border-dashed border-border py-3 text-center text-11 text-muted-foreground" data-testid="segbind-no-template">
                      本环节还没绑模板 —— 现场切到这里时各组会拿到空骨架，「落后」态会触发。
                    </p>
                  )}
                </div>

                {!readOnly && (
                  active.templates.length >= MAX_TEMPLATES ? (
                    <p className="flex items-center gap-1 text-10 text-warning" data-testid="segbind-limit-hint">
                      <Info aria-hidden className="h-3 w-3" /> 已达两模板上限（[Backlog] 避免摊薄时间）——原型确认缺失，此上限提示为本原型补画
                    </p>
                  ) : (
                    <Button size="sm" variant="outline" className="self-start" onClick={() => setPicking((v) => !v)} data-testid="segbind-add-template">
                      <Plus aria-hidden className="h-3.5 w-3.5" /> 添加模板
                    </Button>
                  )
                )}

                {picking && (
                  <div className="flex flex-col gap-1 rounded-md border border-border bg-panel p-2" data-testid="segbind-picker">
                    <p className="px-1 text-10 text-muted-foreground">只列出已发布且在你可见范围内的模板（草稿/已归档不可绑）</p>
                    <div className="grid max-h-48 grid-cols-1 gap-1 overflow-auto sm:grid-cols-2">
                      {A0_TEMPLATES.slice(0, 10).map((t) => (
                        <button key={t.key} type="button" onClick={() => addTemplate(t.key, t.displayName, t.version)} data-testid={`segbind-pick-${t.key}`}
                          className="flex items-center justify-between rounded-md border border-border-subtle bg-card px-2 py-1 text-left text-11 transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <span>{t.cnName}</span>
                          <span className="font-mono text-9 text-muted-foreground">{t.key} {t.version}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {limitWarn && (
                  <p role="alert" className="text-11 text-destructive" data-testid="segbind-limit-error">
                    绑定被拒：同一议程环节最多两个模板。请先移除一个。
                  </p>
                )}
              </div>

              {/* 本环节可用 skill */}
              <div className="flex flex-col gap-2">
                <h3 className="text-12 font-medium">本环节可用 skill</h3>
                <div className="flex flex-col gap-1.5">
                  {active.skills.length === 0 && (
                    <p className="text-11 text-muted-foreground">本环节未绑任何 skill。</p>
                  )}
                  {active.skills.map((sk) => (
                    <div key={sk.id} className="flex items-center justify-between gap-2 rounded-md border border-border-subtle bg-card px-2.5 py-1.5" data-testid={`segbind-skill-${sk.id}`}>
                      <span className="text-12">{sk.label}</span>
                      <Badge tone={sk.kind === "运行" ? "outline" : "primary"}>
                        {sk.kind === "运行" ? <Play aria-hidden className="h-2.5 w-2.5" /> : <Check aria-hidden className="h-2.5 w-2.5" />}
                        {sk.kind}
                      </Badge>
                    </div>
                  ))}
                </div>
                <p className="text-10 text-muted-foreground">
                  skill 绑在议程环节上（proto-08 环节链上直接印着「03 假设风暴 45m · 模板 hmw ＋ 语音转便签」）；组员不可自行加挂。
                </p>
              </div>

              {instantiated && (
                <div className="rounded-md border border-primary/30 bg-accent p-2.5" data-testid="segbind-instantiated">
                  <p className="text-11 text-accent-foreground">
                    已为 4 个分组各实例化一张画布 · 实例固化「{active.templates.map((t) => `${t.key} ${t.version}`).join(" ＋ ")}」·
                    组员打开就是这张画布，不用自己找。（乐观预览，不落库）
                  </p>
                </div>
              )}
            </section>
          </div>
        </StateShell>
      </div>
    </div>
  );
}
