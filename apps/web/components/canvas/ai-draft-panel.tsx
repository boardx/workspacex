"use client";
import * as React from "react";
import { Sparkles, Undo2, Play, AlertCircle, Volume2, Eraser, ClipboardList } from "lucide-react";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import type { ProjectRole } from "@/lib/identity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";
import {
  DRAFT_SECTIONS, AVA_ROUND_CHANGES, computeWhitespaceWarnings, computeCompletion,
  type DraftSection, type DraftSticky,
} from "@/lib/mock/canvas";

/**
 * UC-7.2 AI 起草留白规则（F106 · D-11 两条结构化规则取代「六成」· D-10 落笔可回滚）
 *
 * 界面要表达「这里 AI 故意没写完、等你补」而不是「AI 出错了」——**本束最要紧的设计问题**。
 * 我的方案（UC 未写明表达形态，属原型确认缺失）：
 *  ① 每个分区显示「已填 x / 容量 n · 留 (n-x) 格」进度，留白格用**虚线空位卡**明确画出「等你补」；
 *  ② 填满 / 缺引述时贴**非阻断提示条** + [清一格] 一键留白（不用 modal，不拦写入）；
 *  ③ 无引述草稿标「无来源·待补」灰样式，不计入完成度分子；
 *  ④ AVA 落笔带角标、可点时间码回听、可轮次级原子回滚。
 */
export function AiDraftPanel({ state, previewRole }: { state: UiState; previewRole: ProjectRole | null }) {
  const [sections, setSections] = React.useState<DraftSection[]>(DRAFT_SECTIONS);
  const [directWrite, setDirectWrite] = React.useState(true);
  const [rollbackConfirm, setRollbackConfirm] = React.useState(false);
  const [rolledBack, setRolledBack] = React.useState(false);
  const [playing, setPlaying] = React.useState<string | null>(null);
  const readOnly = previewRole === "observer";

  const warnings = computeWhitespaceWarnings(sections);
  const completion = computeCompletion(sections);

  const clearOneCell = (sectionId: string) => {
    setSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, stickies: s.stickies.slice(0, -1) } : s)));
  };
  const rollback = () => {
    setSections([]); // 轮次级原子撤回到落笔前（此屏 mock：本轮全部 AVA 落笔，撤回即清空）
    setRolledBack(true);
    setRollbackConfirm(false);
  };

  return (
    <div className="flex h-full flex-col" data-testid="aidraft-root">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <h1 className="text-14 font-semibold tracking-tight">第 2 组 · 假设风暴 (hmw)</h1>
            <Badge tone="ai"><Sparkles aria-hidden className="h-2.5 w-2.5" /> Ava 起草中</Badge>
          </div>
          <p className="text-11 text-muted-foreground">按本组录音与材料往格子填草稿——空格子保持空白，不替人填。</p>
        </div>
        <div className="flex items-center gap-2 rounded-md border border-border bg-panel px-2.5 py-1" data-testid="aidraft-completion">
          <span className="text-10 text-muted-foreground">完成度</span>
          <span className="font-mono text-13 tabular-nums">{completion.done}/{completion.defined}</span>
          <span className="text-10 text-muted-foreground">已完成项 / 已定义项（分母＝模板分区数，无来源不计入）</span>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <StateShell
          state={state}
          skeletonRows={4}
          emptyHint="本组还没有转录与材料——AI 不会生成任何便签（留白是产品语义，不是性能取舍）。等录音开始。"
          errors={{ quote: "这条草稿的引述三件套不完整（缺时间码），已挡在「无来源·待补」，不得以「已填」形态呈现" }}
          depFailure={{ what: "转录服务/模型不可用，画布已有内容不变；AI 起草暂停，可稍后重试", retry: () => location.reload() }}
          denial={{ layer: "project", reason: "观察者只读，看不到本组原始录音与草稿的引述原文" }}
          successMessage="AVA 本轮落笔已保存为新版本（mermaid 源码 .md），原版本未覆盖；可一键回滚"
        >
          <div className="flex flex-col gap-4">
            {rolledBack ? (
              <div className="rounded-lg border border-border bg-muted p-4 text-center" data-testid="aidraft-rolled-back">
                <p className="text-12 text-muted-foreground">已回滚本轮 AVA 落笔——画布回到落笔前状态（逐字节一致）。这是原子撤回，不留半撤销。</p>
                <Button size="sm" variant="outline" className="mt-2" onClick={() => { setSections(DRAFT_SECTIONS); setRolledBack(false); }} data-testid="aidraft-redraft">
                  <Play aria-hidden className="h-3.5 w-3.5" /> 重新起草
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3" data-testid="aidraft-sections">
                {sections.map((sec) => {
                  const w = warnings.filter((x) => x.sectionId === sec.id);
                  const emptySlots = Math.max(0, sec.capacity - sec.stickies.length);
                  return (
                    <div key={sec.id} className="flex flex-col gap-2 rounded-lg border border-border bg-panel-alt p-2.5" data-testid={`aidraft-section-${sec.id}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-12 font-medium">## {sec.label}{sec.required && <span className="ml-1 text-9 text-muted-foreground">必填</span>}</span>
                        <span className="text-10 text-muted-foreground tabular-nums">已填 {sec.stickies.filter((k) => k.quote).length}/{sec.capacity} · 留 {emptySlots} 格</span>
                      </div>

                      {/* 非阻断留白提示条（贴在分区上）*/}
                      {w.map((warn) => (
                        <div key={warn.kind} className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/5 px-2 py-1.5" role="status" data-testid={`aidraft-warn-${sec.id}-${warn.kind === "已填满" ? "full" : "noquote"}`}>
                          <AlertCircle aria-hidden className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
                          <div className="flex flex-col gap-1">
                            <span className="text-10 text-muted-foreground">{warn.message}</span>
                            {warn.kind === "已填满" && !readOnly && (
                              <Button size="xs" variant="outline" className="self-start" onClick={() => clearOneCell(sec.id)} data-testid={`aidraft-clear-${sec.id}`}>
                                <Eraser aria-hidden className="h-3 w-3" /> 清一格
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}

                      {/* 便签 */}
                      {sec.stickies.map((st) => (
                        <DraftStickyCard key={st.id} sticky={st} playing={playing === st.id} onPlay={() => setPlaying((p) => (p === st.id ? null : st.id))} readOnly={readOnly} />
                      ))}

                      {/* 留白空位（明确画出「等你补」，不是留一片空白）*/}
                      {Array.from({ length: emptySlots }).map((_, i) => (
                        <div key={i} data-testid={`aidraft-empty-slot-${sec.id}-${i}`} className="flex items-center justify-center rounded-md border border-dashed border-border py-2 text-10 text-muted-foreground">
                          留给现场 · AI 故意没填
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}

            {/* AI 在这张画布上：角标 + 回滚 + 写权限模式（D-10）*/}
            {!rolledBack && (
              <section className="flex flex-col gap-2 rounded-lg border border-ai/20 bg-ai-tint p-3" data-testid="aidraft-ai-region">
                <p className="text-11 text-ai-tint-foreground">
                  <Badge tone="ai" className="mr-1">AVA</Badge>
                  Ava 本轮补了 {AVA_ROUND_CHANGES.filter((c) => c.kind === "sticky").length} 张便签、改了 {AVA_ROUND_CHANGES.filter((c) => c.kind === "edge").length} 条连线标签，都带 AVA 角标。
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {!readOnly && (!rollbackConfirm ? (
                    <Button size="xs" variant="ghost" onClick={() => setRollbackConfirm(true)} data-testid="aidraft-rollback">
                      <Undo2 aria-hidden className="h-3 w-3" /> 一键回滚本轮
                    </Button>
                  ) : (
                    <span className="flex items-center gap-1" data-testid="aidraft-rollback-confirm">
                      <span className="text-10 text-muted-foreground">原子撤回本轮全部 AVA 落笔？</span>
                      <Button size="xs" variant="destructive" onClick={rollback} data-testid="aidraft-rollback-submit">确认</Button>
                      <Button size="xs" variant="ghost" onClick={() => setRollbackConfirm(false)}>取消</Button>
                    </span>
                  ))}
                  <div className="ml-auto flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1">
                    <label htmlFor="aidraft-mode" className="text-10 font-medium">AI 直接落笔</label>
                    <Toggle id="aidraft-mode" checked={directWrite} onCheckedChange={setDirectWrite} label="AI 直接落笔" data-testid="aidraft-mode-toggle" />
                    <span className="text-9 text-muted-foreground">{directWrite ? "默认" : "提交建议待接受"}</span>
                  </div>
                </div>
              </section>
            )}
          </div>
        </StateShell>
      </div>
    </div>
  );
}

/** 单条草稿便签：有引述 = 可回听；无引述 = 「无来源·待补」灰样式 */
function DraftStickyCard({ sticky, playing, onPlay, readOnly }: { sticky: DraftSticky; playing: boolean; onPlay: () => void; readOnly: boolean }) {
  const noSource = sticky.quote === null;
  return (
    <div
      data-testid={`aidraft-sticky-${sticky.id}`}
      className={cn(
        "flex flex-col gap-1 rounded-md border p-2",
        noSource ? "border-dashed border-border bg-muted" : "border-warning/30 bg-warning/10",
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <span className={cn("text-11 leading-snug", noSource && "text-muted-foreground")}>{sticky.text}</span>
        {sticky.byAva && <Badge tone="ai" data-testid={`aidraft-sticky-${sticky.id}-ava`}><Sparkles aria-hidden className="h-2.5 w-2.5" />AVA</Badge>}
      </div>
      {noSource ? (
        <Badge tone="neutral" data-testid={`aidraft-sticky-${sticky.id}-nosource`}>无来源 · 待补（不计入完成度）</Badge>
      ) : (
        <div className="flex flex-col gap-0.5">
          <button type="button" onClick={onPlay} disabled={readOnly} data-testid={`aidraft-quote-${sticky.id}`}
            className="flex items-center gap-1 self-start rounded-sm px-1 py-0.5 text-9 text-muted-foreground transition-colors duration-200 hover:bg-card disabled:bg-transparent disabled:text-disabled-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Volume2 aria-hidden className="h-3 w-3" />
            <span className="font-mono">{sticky.quote!.segmentId} · {sticky.quote!.timecode}</span>
            {playing ? "播放中…" : "点听原话"}
          </button>
          {playing && (
            <p className="rounded-sm border border-border-subtle bg-card px-1.5 py-1 text-9 italic text-muted-foreground" data-testid={`aidraft-quote-text-${sticky.id}`}>
              「{sticky.quote!.text}」
            </p>
          )}
        </div>
      )}
    </div>
  );
}
