"use client";
import * as React from "react";
import type { FacetSaveFn } from "./facet-content-editor";

/**
 * 「流程 Agenda」结构化编辑器（第 2 项，分组一）——`design-deltas/
 * blueprint-design-facet-panels/contract.md` 的 `AgendaContent` 字段提议
 * 落地成真实可编辑表单，替换该项此前统一使用的 `FacetTextEditor` 自由文本框
 * （同 `topic-panel-editor.tsx`/`grouping-panel-editor.tsx` 的先例）。
 *
 * ## 本轮范围比 `contract.md` 的完整提议窄——如实收紧，不是漏做
 *
 * `contract.md` 的 `AgendaSegmentDraft` 还包含 `canvasBinding`/`skillBinding`
 * （绑定画布模板/Skill 引用）——这两个字段需要从"已存在的画布模板/Skill 清单"里选，
 * 不是自由文本，接它们要先有一个选择器组件（复用 `Agent 编排`/`Skill 绑定` 面板
 * 落地时会用到的同一套选择器，不在本增量重复造一份）。`contract.md` 的
 * `aiPacingSuggestions`（AI 节奏校对建议）本身就标注"可选"，需要真实 AI 调用，
 * 不在本轮范围。拖拽排序（半场/环节互换顺序）是原型的交互亮点，但本轮编辑器
 * 用"上移/下移"按钮达到同等效果（可排序），不做像素级的拖拽手势——
 * 交互精修留给后续增量，不影响"半场/环节结构真实可编辑"这条主链路。
 */

export interface AgendaSegmentDraft {
  readonly title: string;
  readonly duration: number; // 分钟
  readonly facilitatorRole: string;
  readonly groupRole: string;
  readonly optional: boolean;
}

export interface AgendaHalfDay {
  readonly segments: readonly AgendaSegmentDraft[];
}

export interface AgendaContentValue {
  readonly halfDays: readonly AgendaHalfDay[];
}

function emptySegment(): AgendaSegmentDraft {
  return { title: "", duration: 30, facilitatorRole: "", groupRole: "", optional: false };
}

function emptyValue(): AgendaContentValue {
  return { halfDays: [] };
}

export function parseAgendaContent(content: string): AgendaContentValue {
  if (content.trim() === "") return emptyValue();
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null) return emptyValue();
    const p = parsed as Partial<AgendaContentValue>;
    if (!Array.isArray(p.halfDays)) return emptyValue();
    return {
      halfDays: p.halfDays.map((hd: Partial<AgendaHalfDay>) => ({
        segments: Array.isArray(hd?.segments)
          ? hd.segments.map((s: Partial<AgendaSegmentDraft>) => ({
              title: typeof s?.title === "string" ? s.title : "",
              duration: typeof s?.duration === "number" && s.duration > 0 ? s.duration : 30,
              facilitatorRole: typeof s?.facilitatorRole === "string" ? s.facilitatorRole : "",
              groupRole: typeof s?.groupRole === "string" ? s.groupRole : "",
              optional: typeof s?.optional === "boolean" ? s.optional : false,
            }))
          : [],
      })),
    };
  } catch {
    return emptyValue();
  }
}

export function serializeAgendaContent(value: AgendaContentValue): string {
  const isEmpty = value.halfDays.length === 0 || value.halfDays.every((hd) => hd.segments.length === 0);
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

  function addHalfDay(): void {
    const next = { halfDays: [...value.halfDays, { segments: [] }] };
    setValue(next);
    void persist(next);
  }

  function removeHalfDay(hIndex: number): void {
    const next = { halfDays: value.halfDays.filter((_, i) => i !== hIndex) };
    setValue(next);
    void persist(next);
  }

  function addSegment(hIndex: number): void {
    const next = {
      halfDays: value.halfDays.map((hd, i) =>
        i === hIndex ? { segments: [...hd.segments, emptySegment()] } : hd,
      ),
    };
    setValue(next);
    void persist(next);
  }

  function removeSegment(hIndex: number, sIndex: number): void {
    const next = {
      halfDays: value.halfDays.map((hd, i) =>
        i === hIndex ? { segments: hd.segments.filter((_, j) => j !== sIndex) } : hd,
      ),
    };
    setValue(next);
    void persist(next);
  }

  function updateSegment(hIndex: number, sIndex: number, patch: Partial<AgendaSegmentDraft>): void {
    setValue((v) => ({
      halfDays: v.halfDays.map((hd, i) =>
        i === hIndex
          ? { segments: hd.segments.map((s, j) => (j === sIndex ? { ...s, ...patch } : s)) }
          : hd,
      ),
    }));
  }

  function moveSegment(hIndex: number, sIndex: number, delta: -1 | 1): void {
    const hd = value.halfDays[hIndex];
    if (hd === undefined) return;
    const target = sIndex + delta;
    if (target < 0 || target >= hd.segments.length) return;
    const segments = [...hd.segments];
    const a = segments[sIndex]!;
    const b = segments[target]!;
    segments[sIndex] = b;
    segments[target] = a;
    const next = { halfDays: value.halfDays.map((h, i) => (i === hIndex ? { segments } : h)) };
    setValue(next);
    void persist(next);
  }

  const totalMinutes = value.halfDays.reduce(
    (sum, hd) => sum + hd.segments.reduce((s, seg) => s + seg.duration, 0),
    0,
  );

  return (
    <div data-testid={`bp-facet-editor-${designFacetKey}`}>
      <div className="mb-3 flex items-center gap-1.5">
        {status !== "idle" && (
          <span
            className={status === "error" ? "text-11 text-destructive" : "text-11 text-muted-foreground"}
            data-testid="bp-facet-save-status"
          >
            {status === "saving" ? "保存中…" : status === "saved" ? "已保存" : "保存失败"}
          </span>
        )}
        {value.halfDays.length > 0 && (
          <span className="text-11 text-muted-foreground" data-testid="bp-agenda-total-minutes">
            环节合计时长 {totalMinutes} 分钟
          </span>
        )}
        <button
          type="button"
          onClick={addHalfDay}
          className="ml-auto rounded-md border border-border px-2 py-1 text-11 transition-colors hover:bg-muted"
          data-testid="bp-agenda-add-halfday"
        >
          ＋ 半场
        </button>
      </div>

      {value.halfDays.length === 0 ? (
        <p className="text-11 text-muted-foreground" data-testid="bp-agenda-empty">
          还没有半场——点「＋ 半场」新增，一个半场约 3–3.5 小时、3–4 个环节。
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {value.halfDays.map((hd, hIndex) => (
            <li key={hIndex} className="rounded-lg border border-border p-3" data-testid={`bp-agenda-halfday-${hIndex}`}>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-12 font-semibold">半场 {hIndex + 1}</h4>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => addSegment(hIndex)}
                    className="rounded-md border border-border px-2 py-0.5 text-11 transition-colors hover:bg-muted"
                    data-testid={`bp-agenda-add-segment-${hIndex}`}
                  >
                    ＋ 环节
                  </button>
                  <button
                    type="button"
                    onClick={() => removeHalfDay(hIndex)}
                    className="rounded-md border border-border px-2 py-0.5 text-11 text-destructive transition-colors hover:bg-muted"
                    data-testid={`bp-agenda-remove-halfday-${hIndex}`}
                  >
                    删除半场
                  </button>
                </div>
              </div>
              {hd.segments.length === 0 ? (
                <p className="text-11 text-muted-foreground">本半场还没有环节。</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {hd.segments.map((seg, sIndex) => (
                    <li
                      key={sIndex}
                      className="flex flex-wrap items-center gap-1.5 rounded-md border border-border p-1.5"
                      data-testid={`bp-agenda-segment-${hIndex}-${sIndex}`}
                    >
                      <input
                        type="text"
                        className="min-w-0 flex-1 rounded-md border border-border bg-background p-1 text-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        value={seg.title}
                        onChange={(e) => updateSegment(hIndex, sIndex, { title: e.target.value })}
                        onBlur={() => void persist(value)}
                        placeholder="环节名称"
                        data-testid={`bp-agenda-segment-title-${hIndex}-${sIndex}`}
                      />
                      <input
                        type="number"
                        className="w-16 rounded-md border border-border bg-background p-1 text-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        value={seg.duration}
                        onChange={(e) => updateSegment(hIndex, sIndex, { duration: Number(e.target.value) || 0 })}
                        onBlur={() => void persist(value)}
                        aria-label="时长（分钟）"
                        data-testid={`bp-agenda-segment-duration-${hIndex}-${sIndex}`}
                      />
                      <span className="text-11 text-muted-foreground">分钟</span>
                      <input
                        type="text"
                        className="w-24 rounded-md border border-border bg-background p-1 text-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        value={seg.facilitatorRole}
                        onChange={(e) => updateSegment(hIndex, sIndex, { facilitatorRole: e.target.value })}
                        onBlur={() => void persist(value)}
                        placeholder="引导师职责"
                        data-testid={`bp-agenda-segment-facilitator-${hIndex}-${sIndex}`}
                      />
                      <input
                        type="text"
                        className="w-24 rounded-md border border-border bg-background p-1 text-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        value={seg.groupRole}
                        onChange={(e) => updateSegment(hIndex, sIndex, { groupRole: e.target.value })}
                        onBlur={() => void persist(value)}
                        placeholder="组长/组员职责"
                        data-testid={`bp-agenda-segment-grouprole-${hIndex}-${sIndex}`}
                      />
                      <label className="flex items-center gap-1 text-11">
                        <input
                          type="checkbox"
                          checked={seg.optional}
                          onChange={() => {
                            updateSegment(hIndex, sIndex, { optional: !seg.optional });
                            void persist({
                              halfDays: value.halfDays.map((h, i) =>
                                i === hIndex
                                  ? {
                                      segments: h.segments.map((s, j) =>
                                        j === sIndex ? { ...s, optional: !s.optional } : s,
                                      ),
                                    }
                                  : h,
                              ),
                            });
                          }}
                          data-testid={`bp-agenda-segment-optional-${hIndex}-${sIndex}`}
                        />
                        可选
                      </label>
                      <div className="flex gap-0.5">
                        <button
                          type="button"
                          onClick={() => moveSegment(hIndex, sIndex, -1)}
                          disabled={sIndex === 0}
                          className="rounded border border-border px-1 text-11 disabled:bg-disabled disabled:text-disabled-foreground"
                          aria-label="上移"
                          data-testid={`bp-agenda-segment-up-${hIndex}-${sIndex}`}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => moveSegment(hIndex, sIndex, 1)}
                          disabled={sIndex === hd.segments.length - 1}
                          className="rounded border border-border px-1 text-11 disabled:bg-disabled disabled:text-disabled-foreground"
                          aria-label="下移"
                          data-testid={`bp-agenda-segment-down-${hIndex}-${sIndex}`}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => removeSegment(hIndex, sIndex)}
                          className="rounded border border-border px-1 text-11 text-destructive"
                          aria-label="删除环节"
                          data-testid={`bp-agenda-segment-remove-${hIndex}-${sIndex}`}
                        >
                          ✕
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {error !== null && (
        <p role="alert" className="mt-2 text-11 text-destructive" data-testid={`bp-facet-error-${designFacetKey}`}>
          {error}
        </p>
      )}
    </div>
  );
}
