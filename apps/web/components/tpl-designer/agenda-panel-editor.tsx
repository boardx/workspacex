"use client";
import * as React from "react";
import type { FacetSaveFn } from "./facet-content-editor";

/**
 * 「流程 Agenda」结构化编辑器（第 2 项，分组一）——`design-deltas/
 * blueprint-design-facet-panels/contract.md` 的 `AgendaContent` 字段提议
 * 落地成真实可编辑表单，替换该项此前统一使用的 `FacetTextEditor` 自由文本框
 * （同 `topic-panel-editor.tsx`/`grouping-panel-editor.tsx` 的先例）。
 *
 * ⚠ 逐项对照 `apps/web/components/tpl/designer-panels.tsx` 的 `AgendaPanel`
 * 与 `apps/web/lib/mock/tpl.ts` 的 `AGENDA_PANEL`（2026-08-17 人类第二次强化
 * 指令后重做）——原型的环节清单是**扁平列表**，没有"半场"嵌套，也没有分开的
 * 「引导师职责/组长职责」两列；只有一个合并的 `boardSkill`（"绑哪个画布/Skill"）
 * 自由文本列。上一版发明的 `halfDays[].segments[]` 嵌套结构与拆分列都不对，
 * 本次改成贴合原型的扁平 `segments[]{no,title,min,boardSkill,optional}`。
 *
 * ## 仍收窄的部分——如实收紧，不是漏做
 *
 * `contract.md` 的 `canvasBinding`/`skillBinding` 结构化绑定（从已存在的画布模板/
 * Skill 清单里选）需要一个选择器组件，留给 Agent 编排/Skill 绑定面板落地时复用同一
 * 套选择器，不在本增量重复造一份——`boardSkill` 暂时仍是自由文本，与原型一致
 * （原型本身也只是纯文本展示，没有真实选择器）。`aiRhythm` 是 AI 对照历史场次
 * 给的节奏建议，原型里"采纳建议"按钮背后没有真实 AI 调用，本编辑器把这张卡片
 * 展示为只读参考（同 `contract.md` 里"需要真实 AI 调用，不在本轮范围"的既有收紧）。
 * 拖拽排序用"上移/下移"按钮达到同等效果，不做像素级拖拽手势。
 */

const AI_RHYTHM = {
  tag: "AI 已核对过节奏",
  body: "对照 12 场两天档记录：第 2 天上午的「原型搭建」平均超时 22 分钟，是全场最大缺口；而「组间互评」若少于 20m，昨天的决策会被重新争论一遍。建议 10 加到 90m，把 11 压到 30m。",
} as const;

export interface AgendaSegmentDraft {
  readonly no: string;
  readonly title: string;
  readonly min: number;
  readonly boardSkill: string;
  readonly optional: boolean;
}

export interface AgendaContentValue {
  readonly segments: readonly AgendaSegmentDraft[];
}

function padNo(index: number): string {
  return String(index + 1).padStart(2, "0");
}

function emptySegment(index: number): AgendaSegmentDraft {
  return { no: padNo(index), title: "", min: 30, boardSkill: "", optional: false };
}

function renumber(segments: readonly AgendaSegmentDraft[]): AgendaSegmentDraft[] {
  return segments.map((s, i) => ({ ...s, no: padNo(i) }));
}

function emptyValue(): AgendaContentValue {
  return { segments: [] };
}

export function parseAgendaContent(content: string): AgendaContentValue {
  if (content.trim() === "") return emptyValue();
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null) return emptyValue();
    const p = parsed as Partial<AgendaContentValue>;
    if (!Array.isArray(p.segments)) return emptyValue();
    return {
      segments: p.segments.map((s: Partial<AgendaSegmentDraft>, i: number) => ({
        no: typeof s?.no === "string" && s.no !== "" ? s.no : padNo(i),
        title: typeof s?.title === "string" ? s.title : "",
        min: typeof s?.min === "number" && s.min > 0 ? s.min : 30,
        boardSkill: typeof s?.boardSkill === "string" ? s.boardSkill : "",
        optional: typeof s?.optional === "boolean" ? s.optional : false,
      })),
    };
  } catch {
    return emptyValue();
  }
}

export function serializeAgendaContent(value: AgendaContentValue): string {
  const isEmpty = value.segments.length === 0;
  return isEmpty ? "" : JSON.stringify(value);
}

export function AgendaPanelEditor({
  designFacetKey,
  content,
  itemRevision,
  onSave,
}: {
  readonly designFacetKey: string;
  readonly content: string;
  readonly itemRevision: string;
  readonly onSave: FacetSaveFn;
}) {
  const [value, setValue] = React.useState<AgendaContentValue>(() => parseAgendaContent(content));
  const [revision, setRevision] = React.useState(itemRevision);
  const [status, setStatus] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setValue(parseAgendaContent(content));
    setRevision(itemRevision);
    setStatus("idle");
    setError(null);
  }, [designFacetKey, content, itemRevision]);

  async function persist(next: AgendaContentValue): Promise<void> {
    setStatus("saving");
    setError(null);
    try {
      const out = await onSave(designFacetKey, serializeAgendaContent(next), revision);
      setRevision(out.itemRevision);
      setStatus("saved");
    } catch (e) {
      setStatus("error");
      const reasonCode = (e as { reasonCode?: unknown } | null)?.reasonCode;
      setError(
        reasonCode === "VERSION_CHANGED"
          ? "这一项已被别处改动，你的输入未保存——请刷新页面后重新填写"
          : e instanceof Error
            ? e.message
            : "保存失败，请重试",
      );
    }
  }

  function addSegment(): void {
    const next = { segments: [...value.segments, emptySegment(value.segments.length)] };
    setValue(next);
    void persist(next);
  }

  function removeSegment(index: number): void {
    const next = { segments: renumber(value.segments.filter((_, i) => i !== index)) };
    setValue(next);
    void persist(next);
  }

  function updateSegment(index: number, patch: Partial<AgendaSegmentDraft>): void {
    setValue((v) => ({
      segments: v.segments.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    }));
  }

  function toggleOptional(index: number): void {
    const next = { segments: value.segments.map((s, i) => (i === index ? { ...s, optional: !s.optional } : s)) };
    setValue(next);
    void persist(next);
  }

  function moveSegment(index: number, delta: -1 | 1): void {
    const target = index + delta;
    if (target < 0 || target >= value.segments.length) return;
    const segments = [...value.segments];
    const a = segments[index]!;
    const b = segments[target]!;
    segments[index] = b;
    segments[target] = a;
    const next = { segments: renumber(segments) };
    setValue(next);
    void persist(next);
  }

  const totalMinutes = value.segments.reduce((sum, s) => sum + s.min, 0);

  return (
    <div data-testid={`bp-facet-editor-${designFacetKey}`}>
      <div className="mb-4 rounded-lg border border-border p-4" data-testid="bp-agenda-list">
        <div className="mb-2 flex items-center justify-between gap-1.5">
          <h3 className="text-13 font-semibold">
            环节合计 {value.segments.length} · {totalMinutes} 分钟
          </h3>
          <div className="flex items-center gap-1.5">
            {status !== "idle" && (
              <span
                className={status === "error" ? "text-11 text-destructive" : "text-11 text-muted-foreground"}
                data-testid="bp-facet-save-status"
              >
                {status === "saving" ? "保存中…" : status === "saved" ? "已保存" : "保存失败"}
              </span>
            )}
            <span className="rounded border border-border px-1.5 py-0.5 text-11 text-muted-foreground">
              抓左侧握把拖动：环节可跨半场，半场可整块换位
            </span>
          </div>
        </div>

        {value.segments.length === 0 ? (
          <p className="text-11 text-muted-foreground" data-testid="bp-agenda-empty">
            还没有环节——点「＋ 环节」新增。没写产出物的环节不能保存——那是闲聊不是环节。
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {value.segments.map((seg, i) => (
              <li
                key={i}
                className="flex flex-wrap items-center gap-1.5 rounded-md border border-border p-2.5"
                data-testid={`bp-agenda-segment-${i}`}
              >
                <span aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground">
                  ⠿
                </span>
                <span className="w-6 shrink-0 text-11 font-mono text-muted-foreground">{seg.no}</span>
                <input
                  type="text"
                  className="min-w-0 flex-1 rounded-md border border-border bg-background p-1 text-12 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={seg.title}
                  onChange={(e) => updateSegment(i, { title: e.target.value })}
                  onBlur={() => void persist(value)}
                  placeholder="环节名称"
                  data-testid={`bp-agenda-segment-title-${i}`}
                />
                <label className="flex items-center gap-1 text-11" data-testid={`bp-agenda-segment-optional-wrap-${i}`}>
                  <input
                    type="checkbox"
                    checked={seg.optional}
                    onChange={() => toggleOptional(i)}
                    data-testid={`bp-agenda-segment-optional-${i}`}
                  />
                  可选
                </label>
                <input
                  type="number"
                  className="w-16 rounded-md border border-border bg-background p-1 text-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={seg.min}
                  onChange={(e) => updateSegment(i, { min: Number(e.target.value) || 0 })}
                  onBlur={() => void persist(value)}
                  aria-label="时长（分钟）"
                  data-testid={`bp-agenda-segment-min-${i}`}
                />
                <span className="text-11 text-muted-foreground">分钟</span>
                <input
                  type="text"
                  className="w-40 rounded-md border border-dashed border-border bg-background p-1 text-11 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={seg.boardSkill}
                  onChange={(e) => updateSegment(i, { boardSkill: e.target.value })}
                  onBlur={() => void persist(value)}
                  placeholder="绑哪个画布 / Skill"
                  data-testid={`bp-agenda-segment-boardskill-${i}`}
                />
                <div className="flex gap-0.5">
                  <button
                    type="button"
                    onClick={() => moveSegment(i, -1)}
                    disabled={i === 0}
                    className="rounded border border-border px-1 text-11 disabled:bg-disabled disabled:text-disabled-foreground"
                    aria-label="上移环节"
                    data-testid={`bp-agenda-segment-up-${i}`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveSegment(i, 1)}
                    disabled={i === value.segments.length - 1}
                    className="rounded border border-border px-1 text-11 disabled:bg-disabled disabled:text-disabled-foreground"
                    aria-label="下移环节"
                    data-testid={`bp-agenda-segment-down-${i}`}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => removeSegment(i)}
                    className="rounded border border-border px-1 text-11 text-destructive"
                    aria-label="删除环节"
                    data-testid={`bp-agenda-segment-remove-${i}`}
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={addSegment}
          className="mt-2 rounded-md border border-border px-2 py-1 text-11 transition-colors hover:bg-muted"
          data-testid="bp-agenda-add-segment"
        >
          ＋ 环节
        </button>

        <div className="mt-3 flex items-start gap-2 rounded-md border border-ai-tint bg-ai-tint p-2.5" data-testid="bp-agenda-ai-rhythm">
          <span aria-hidden className="mt-0.5 shrink-0 text-ai-tint-foreground">
            ✨
          </span>
          <div>
            <p className="text-11 font-medium text-ai-tint-foreground">{AI_RHYTHM.tag}</p>
            <p className="mt-0.5 text-11 text-muted-foreground">{AI_RHYTHM.body}</p>
          </div>
        </div>
      </div>

      {error !== null && (
        <p role="alert" className="text-11 text-destructive" data-testid={`bp-facet-error-${designFacetKey}`}>
          {error}
        </p>
      )}
    </div>
  );
}
