"use client";
import * as React from "react";
import {
  MessagesSquare, Upload, ArrowRight, Bot, User, RefreshCw, FileCode2,
  Columns3, GripVertical, Plus, ArrowUp, ArrowDown, X, History, RotateCcw,
  GitCompare, Sparkles, AlertTriangle, Lock,
} from "lucide-react";
import { StateShell } from "@/components/state/state-shell";
import { StaticSwitch } from "@/components/itv/static-switch";
import type { UiState } from "@/lib/ui-state";
import type { ProjectRole } from "@/lib/identity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  TEMPLATE_EDITOR_HEAD, DESIGN_DIALOG, DESIGN_DIALOG_UPLOAD_HINT, DESIGN_DIALOG_QUICK,
  CANVAS_MARKDOWN_SYNC, INFO_BAR_FIELDS, TEMPLATE_ZONES, TEMPLATE_LAYOUT_OPTIONS,
  TEMPLATE_LAYOUT_CURRENT, TEMPLATE_VERSIONS, TEMPLATE_VERSION_LOCK_NOTE, TEMPLATE_USAGE,
} from "@/lib/mock/canvas";

/**
 * UC-7.1 后台画布模板【编辑器】—— v2 重画（原型 isAdCvEdit 15800335，30KB 成品）。
 *
 * v1 整屏未画、README 误报「原型里根本不存在」。本屏按原型四大块复原：
 *   ① 设计对话（4 轮 + 上传 .md/.canvas/.mmd/大图）
 *   ② 画布 fabric.js ⇄ Markdown 双向同步
 *   ③ 结构检查器：信息栏字段 / 分区（导出为 ## 段落）/ 分区属性含【每区 AI 权限】
 *   ④ 版本历史 + 使用填充率 + 诊断
 *
 * ⚠ 视角切换是预览手段：观察者只读，无发布/回滚/编辑写操作。真实权限在服务端。
 * 危险动作：发布 v4（影响全部套用它的项目）/ 回滚到此版 —— 二次确认 + 影响范围。
 */
export function TemplateEditor({
  state, previewRole,
}: { state: UiState; previewRole: ProjectRole | null }) {
  const readOnly = previewRole === "observer" || previewRole === "member";
  const head = TEMPLATE_EDITOR_HEAD;
  const [selectedZone, setSelectedZone] = React.useState(TEMPLATE_ZONES[3]!.num); // 默认选中「影响因素」(填充率最低，诊断在此)
  const [confirm, setConfirm] = React.useState<null | { kind: "publish" | "rollback"; label: string; impact: string }>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const zone = TEMPLATE_ZONES.find((z) => z.num === selectedZone)!;

  return (
    <div className="flex h-full flex-col" data-testid="canvas-template-editor">
      {/* 头部：模板名 + 版本状态 + 危险动作（发布） */}
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <button
          type="button"
          onClick={() => setToast("演示：返回模板列表")}
          className="rounded text-11 text-muted-foreground transition-colors hover:text-background-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          data-testid="tpled-back"
        >
          ‹ 模板列表
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h1 className="truncate text-14 font-semibold">{head.name}</h1>
          <code className="rounded bg-muted px-1 text-10 text-muted-foreground">{head.key}</code>
          <Badge tone="primary" data-testid="tpled-published-ver">{head.publishedVersion} 已发布</Badge>
          {head.hasUnpublished && (
            <Badge tone="warning" data-testid="tpled-has-unpublished">有未发布改动 · {head.draftVersion} 草稿</Badge>
          )}
        </div>
        <span className="text-10 text-muted-foreground">可见范围 · {head.visibility}</span>
        <Button size="xs" variant="outline" disabled={readOnly} data-testid="tpled-tryrun">在项目里试跑</Button>
        <Button
          size="xs" variant="primary" disabled={readOnly} data-testid="tpled-publish"
          onClick={() => setConfirm({ kind: "publish", label: `发布 ${head.draftVersion}`, impact: "发布后：新套用此模板的项目立即用 v4；已建成的历史画布锁在各自版本、不受影响。发布不可逆（要撤只能再发一版）。" })}
        >
          发布 {head.draftVersion}
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <StateShell
          state={state}
          skeletonRows={6}
          emptyHint="这是一张新画布模板 —— 先在左边用几句话描述要展示的信息，助手会切出分区结构"
          errors={{
            "zone-prompt": "「影响因素」的引导提问为空——空提问现场没人知道该往这区填什么",
            "zone-max": "便签上限必须 ≥ 1",
          }}
          depFailure={{ what: "设计对话的 AI（Ava）暂不可用，可继续手工编辑分区结构与 Markdown" }}
          denial={{ layer: "organization", reason: "画布模板属组织后台，仅组织管理员 / 模板作者可编辑；你是观察者，只能预览结构" }}
          successMessage={`${head.draftVersion} 已发布 · 11 个项目将用新版`}
        >
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
            {/* 左列：① 设计对话 + ② 双向同步 */}
            <div className="flex min-w-0 flex-col gap-4">
              {/* ① 设计对话 */}
              <section className="rounded-lg border border-border bg-card" data-testid="tpled-design-dialog">
                <div className="flex items-center gap-1.5 border-b border-border-subtle px-3 py-2">
                  <MessagesSquare aria-hidden className="h-3.5 w-3.5 text-ai" />
                  <span className="text-12 font-medium">设计对话</span>
                  <span className="text-10 text-muted-foreground">回答几个问题，或直接把已有的画布文件丢进来</span>
                </div>
                <div className="flex flex-col gap-2.5 p-3">
                  {DESIGN_DIALOG.map((t, i) => (
                    <div key={i} className={cn("flex gap-2", t.from === "user" && "flex-row-reverse")} data-testid={`tpled-dialog-turn-${i}`}>
                      <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full", t.from === "ai" ? "bg-ai-tint text-ai" : "bg-muted text-muted-foreground")}>
                        {t.from === "ai" ? <Bot aria-hidden className="h-3 w-3" /> : <User aria-hidden className="h-3 w-3" />}
                      </span>
                      <div className={cn("flex max-w-[85%] flex-col gap-1.5 rounded-lg px-2.5 py-1.5 text-12", t.from === "ai" ? "bg-panel text-foreground" : "bg-primary text-primary-foreground")}>
                        <span>{t.text}</span>
                        {t.parsed && (
                          <span className="flex items-center gap-1 rounded bg-card/80 px-1.5 py-0.5 text-10 text-foreground" data-testid={`tpled-dialog-parsed-${i}`}>
                            <FileCode2 aria-hidden className="h-3 w-3" /> {t.parsed.file} · {t.parsed.result}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {DESIGN_DIALOG_QUICK.map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => setToast(`演示：${q}`)}
                        className="rounded-full border border-border px-2 py-0.5 text-10 text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                        data-testid={`tpled-dialog-quick-${q}`}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                  <label className="flex cursor-default items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 py-2 text-11 text-muted-foreground" data-testid="tpled-dialog-upload">
                    <Upload aria-hidden className="h-3.5 w-3.5" /> {DESIGN_DIALOG_UPLOAD_HINT}
                  </label>
                  <div className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5">
                    <span className="flex-1 text-11 text-muted-foreground">继续描述要展示的信息…</span>
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground"><ArrowUp aria-hidden className="h-3 w-3" /></span>
                  </div>
                </div>
              </section>

              {/* ② 画布 fabric.js ⇄ Markdown 双向同步 */}
              <section className="rounded-lg border border-border bg-card" data-testid="tpled-dual-sync">
                <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
                  <Badge tone="primary">画布 · fabric.js</Badge>
                  <span className="text-10 text-muted-foreground">Markdown</span>
                  <span className="ml-auto flex items-center gap-1 text-10 text-ai" data-testid="tpled-sync-status">
                    <RefreshCw aria-hidden className="h-3 w-3" /> ⇄ 双向同步 · {CANVAS_MARKDOWN_SYNC.lastSync}
                  </span>
                </div>
                <div className="p-3">
                  <pre className="max-h-44 overflow-auto rounded-md bg-panel p-2.5 text-10 leading-relaxed text-foreground" data-testid="tpled-mermaid">
                    <code>{CANVAS_MARKDOWN_SYNC.mermaid}</code>
                  </pre>
                  <Button size="xs" variant="outline" className="mt-2" disabled={readOnly} data-testid="tpled-rebuild">
                    <FileCode2 aria-hidden className="h-3 w-3" /> 从 Markdown 重建画布
                  </Button>
                  <p className="mt-2 text-10 text-muted-foreground">{CANVAS_MARKDOWN_SYNC.mermaidNote}</p>
                  <p className="mt-1.5 rounded-md bg-ai-tint/50 px-2 py-1.5 text-10 text-ai-tint-foreground" data-testid="tpled-dual-use-note">
                    {CANVAS_MARKDOWN_SYNC.dualUse}
                  </p>
                </div>
              </section>
            </div>

            {/* 右列：③ 结构检查器 + ④ 版本历史 + 填充率 */}
            <div className="flex min-w-0 flex-col gap-4">
              {/* ③ 结构检查器 */}
              <section className="rounded-lg border border-border bg-card" data-testid="tpled-inspector">
                <div className="border-b border-border-subtle px-3 py-2 text-12 font-medium">结构</div>
                <div className="flex flex-col gap-3 p-3">
                  {/* 信息栏字段 */}
                  <div data-testid="tpled-infobar">
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="text-11 font-medium">信息栏字段</span>
                      <Badge tone="neutral">{INFO_BAR_FIELDS.length}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {INFO_BAR_FIELDS.map((f) => (
                        <span key={f} className="rounded border border-border px-1.5 py-0.5 text-10 text-foreground">{f}</span>
                      ))}
                      <span className="rounded border border-dashed border-border px-1.5 py-0.5 text-10 text-muted-foreground">＋</span>
                    </div>
                  </div>

                  {/* 分区列表 */}
                  <div data-testid="tpled-zones">
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="text-11 font-medium">分区（导出为 ## 段落）</span>
                      <Badge tone="neutral">{TEMPLATE_ZONES.length}</Badge>
                      <span className="ml-auto flex items-center gap-1 text-10 text-muted-foreground">
                        <Columns3 aria-hidden className="h-3 w-3" /> 布局
                        {TEMPLATE_LAYOUT_OPTIONS.map((o) => (
                          <span key={o} className={cn("rounded px-1", o === TEMPLATE_LAYOUT_CURRENT ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>{o}</span>
                        ))}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1">
                      {TEMPLATE_ZONES.map((z) => (
                        <button
                          key={z.num} type="button"
                          onClick={() => setSelectedZone(z.num)}
                          data-testid={`tpled-zone-${z.num}`}
                          className={cn(
                            "flex items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors duration-fast",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                            z.num === selectedZone ? "border-primary bg-panel" : "border-border-subtle hover:bg-muted/60",
                          )}
                        >
                          <GripVertical aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="w-5 text-10 text-muted-foreground">{z.num}</span>
                          <span className="flex-1 text-11 text-foreground">{z.name}</span>
                          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: z.color }} aria-hidden />
                          {z.required && <Badge tone="warning">必填</Badge>}
                          <span className="w-10 text-right text-10 text-muted-foreground" data-testid={`tpled-zone-fill-${z.num}`}>
                            {z.fillRate === null ? "新区" : `${z.fillRate}%`}
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-10 text-muted-foreground">
                      <button type="button" disabled={readOnly} data-testid="tpled-zone-move-up" className="inline-flex items-center gap-0.5 rounded border border-border px-1.5 py-0.5 transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:bg-disabled disabled:text-disabled-foreground"><ArrowUp className="h-3 w-3" aria-hidden /></button>
                      <button type="button" disabled={readOnly} data-testid="tpled-zone-move-down" className="inline-flex items-center gap-0.5 rounded border border-border px-1.5 py-0.5 transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:bg-disabled disabled:text-disabled-foreground"><ArrowDown className="h-3 w-3" aria-hidden /></button>
                      <button type="button" disabled={readOnly} data-testid="tpled-zone-add" className="inline-flex items-center gap-0.5 rounded border border-border px-1.5 py-0.5 transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:bg-disabled disabled:text-disabled-foreground"><Plus className="h-3 w-3" aria-hidden /> 分区</button>
                    </div>
                  </div>

                  {/* 分区属性（选中区） */}
                  <div className="rounded-md border border-border-subtle bg-panel p-2.5" data-testid="tpled-zone-props">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="text-11 font-medium">分区属性</span>
                      <span className="text-10 text-muted-foreground">· {zone.name}</span>
                    </div>
                    <dl className="flex flex-col gap-1.5 text-11">
                      <Row label="段落标题" value={zone.name} />
                      <Row label="导出为" value={<code className="text-10 text-muted-foreground">{zone.heading}</code>} />
                      <Row label="引导提问（显示在框里）" value={<span data-testid="tpled-zone-prompt">{zone.prompt || "—（空）"}</span>} />
                      <Row label="便签上限" value={String(zone.stickyMax)} />
                      <Row label="便签颜色" value={<span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: zone.color }} /> {zone.color}</span>} />
                      <div className="flex items-center justify-between">
                        <dt className="text-muted-foreground">必填（空着不能提交产出）</dt>
                        <StaticSwitch on={zone.required} label="必填" testId={`tpled-zone-required-${zone.num}`} />
                      </div>
                    </dl>

                    {/* 每区 AI 权限（原型：AI 能不能动这一区） */}
                    <div className="mt-2.5 rounded-md border border-ai/25 bg-ai-tint/40 p-2" data-testid="tpled-zone-ai-perm">
                      <p className="mb-1.5 flex items-center gap-1 text-10 font-medium text-ai-tint-foreground">
                        <Bot aria-hidden className="h-3 w-3" /> AI 能不能动这一区
                      </p>
                      <div className="flex items-center justify-between text-11">
                        <span className="text-foreground">允许 AI 补便签</span>
                        <StaticSwitch on={zone.aiAddSticky} label="允许 AI 补便签" testId={`tpled-zone-ai-add-${zone.num}`} />
                      </div>
                      <div className="mt-1 flex items-center justify-between text-11">
                        <span className="text-foreground">允许 AI 改人写的便签</span>
                        <StaticSwitch on={zone.aiEditHuman} label="允许 AI 改人写的便签" testId={`tpled-zone-ai-edit-${zone.num}`} />
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* ④ 版本历史 */}
              <section className="rounded-lg border border-border bg-card" data-testid="tpled-versions">
                <div className="flex items-center gap-1.5 border-b border-border-subtle px-3 py-2">
                  <History aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-12 font-medium">版本历史</span>
                  <span className="text-10 text-muted-foreground">{TEMPLATE_VERSION_LOCK_NOTE.split("——")[0]}</span>
                </div>
                <div className="flex flex-col gap-1.5 p-3">
                  {TEMPLATE_VERSIONS.map((v) => (
                    <div key={v.version} className="flex items-start gap-2 rounded-md border border-border-subtle px-2.5 py-1.5" data-testid={`tpled-version-${v.version}`}>
                      <Badge tone={v.status === "当前发布版" ? "primary" : v.status === "未发布" ? "warning" : "neutral"}>{v.version}</Badge>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-11 text-foreground">{v.note}</span>
                        <span className="text-10 text-muted-foreground">
                          {v.by} · {v.when} · {v.status}{v.usage ? ` · ${v.usage}` : ""}
                        </span>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button size="xs" variant="ghost" onClick={() => setToast(`演示：对比 ${v.version} 与当前草稿`)} data-testid={`tpled-version-diff-${v.version}`}><GitCompare className="h-3 w-3" aria-hidden /> 对比</Button>
                        {v.canRollback && (
                          <Button
                            size="xs" variant="outline" disabled={readOnly} data-testid={`tpled-version-rollback-${v.version}`}
                            onClick={() => setConfirm({ kind: "rollback", label: `回滚到 ${v.version}`, impact: `回滚只生成新的未发布草稿覆盖当前 ${head.draftVersion}；已用出去的历史画布锁在各自版本、不受影响。回滚不改动 ${TEMPLATE_VERSIONS.find((x) => x.status === "当前发布版")?.version} 发布版。` })}
                          >
                            <RotateCcw className="h-3 w-3" aria-hidden /> 回滚到此版
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* 使用填充率 + 诊断 */}
              <section className="rounded-lg border border-border bg-card" data-testid="tpled-usage">
                <div className="border-b border-border-subtle px-3 py-2 text-12 font-medium">使用情况 · {TEMPLATE_USAGE.scope} 填充率</div>
                <div className="flex flex-col gap-2 p-3">
                  {TEMPLATE_ZONES.filter((z) => z.fillRate !== null).map((z) => (
                    <div key={z.num} data-testid={`tpled-fill-${z.num}`}>
                      <div className="mb-0.5 flex items-center justify-between text-10">
                        <span className="text-foreground">{z.name}</span>
                        <span className={cn("tabular-nums", (z.fillRate ?? 0) < 30 ? "text-destructive" : "text-muted-foreground")}>{z.fillRate}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className={cn("h-full rounded-full", (z.fillRate ?? 0) < 30 ? "bg-destructive" : "bg-primary")} style={{ width: `${z.fillRate}%` }} />
                      </div>
                    </div>
                  ))}
                  <div className="mt-1 flex items-start gap-1.5 rounded-md bg-ai-tint/50 px-2 py-1.5 text-10 text-ai-tint-foreground" data-testid="tpled-diagnosis">
                    <Sparkles aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>
                      <strong>「{TEMPLATE_USAGE.diagnosis.zone}」</strong>{TEMPLATE_USAGE.diagnosis.text}
                      {TEMPLATE_USAGE.diagnosis.suggestion}
                    </span>
                  </div>
                </div>
              </section>
            </div>
          </div>

          {readOnly && (
            <p className="mt-3 flex items-center gap-1.5 rounded-md border border-border-subtle bg-panel px-3 py-2 text-11 text-muted-foreground" data-testid="tpled-readonly-note">
              <Lock aria-hidden className="h-3.5 w-3.5" />
              {previewRole === "observer" ? "观察者" : "组员"}视角：仅预览模板结构，发布 / 回滚 / 编辑均不可用（写权限在组织后台）。
            </p>
          )}
        </StateShell>
      </div>

      {/* 危险动作二次确认（发布 / 回滚）*/}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="tpled-confirm">
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-4 shadow-lg">
            <div className="mb-2 flex items-center gap-1.5">
              <AlertTriangle aria-hidden className="h-4 w-4 text-warning" />
              <h2 className="text-13 font-semibold">{confirm.label}</h2>
            </div>
            <p className="mb-3 text-11 text-muted-foreground" data-testid="tpled-confirm-impact">{confirm.impact}</p>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setConfirm(null)} data-testid="tpled-confirm-cancel">取消</Button>
              <Button
                size="sm" variant={confirm.kind === "publish" ? "primary" : "destructive"}
                data-testid="tpled-confirm-ok"
                onClick={() => { setToast(`演示：${confirm.label}`); setConfirm(null); }}
              >
                确认{confirm.label}
              </Button>
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md bg-inverse px-3 py-1.5 text-11 text-inverse-foreground shadow-lg" data-testid="tpled-toast" onAnimationEnd={() => setToast(null)}>
          {toast}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right text-foreground">{value}</dd>
    </div>
  );
}
