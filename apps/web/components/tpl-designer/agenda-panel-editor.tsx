"use client";
import * as React from "react";
import { GripVertical } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { FacetSaveFn } from "./facet-content-editor";

/**
 * 「流程 Agenda」结构化编辑器（第 2 项，分组一）——`design-deltas/
 * blueprint-design-facet-panels/contract.md` 的 `AgendaContent` 字段提议
 * 落地成真实可编辑表单，替换该项此前统一使用的 `FacetTextEditor` 自由文本框
 * （同 `topic-panel-editor.tsx`/`grouping-panel-editor.tsx` 的先例）。
 *
 * ⚠ 逐项对照 `apps/web/components/tpl/designer-panels.tsx` 的 `AgendaPanel`
 * 与 `apps/web/lib/mock/tpl.ts` 的 `AGENDA_PANEL`——原型的环节清单是**扁平列表**，
 * 没有"半场"嵌套，也没有分开的「引导师职责/组长职责」两列；只有一个合并的
 * `boardSkill`（"绑哪个画布/Skill"）自由文本列。
 *
 * ## 「半场」已落地为数据结构（2026-08-31）
 *
 * 下面这段曾经准确描述过一段时间的状态："半场"只是原型文案，`AGENDA_PANEL.segments`
 * 是扁平数组，没有 `day`/`session` 字段——现在不再准确，留作历史背景：原型的
 * `dragHint`（"抓左侧握把拖动：环节可跨半场，半场可整块换位"）与 `actions`
 * （含"上移半场/下移半场"）两处文案提到"半场"，当时确实没有配套的数据结构。
 * 用户反馈明确要求把"上下午/多天分组"做成真实可编辑的结构，本次改动就是这条
 * 提议本身的落地：`AgendaSegmentDraft` 新增 `day`（第几天，从 1 开始）与
 * `session`（`"AM" | "PM"`）两个字段，环节列表按 `day → session` 分组渲染，
 * 拖拽重排收窄为**只在同一天同一半场内**生效（跨组重排是"改环节属于哪个半场"，
 * 是另一个操作，走环节行上的 day/session 选择控件，不是拖拽）。旧数据没有这两个
 * 字段时，解析时回退成 `day: 1, session: "AM"`，不会因为老蓝本缺字段而崩。
 *
 * ## 拖拽实现：指针事件，不是像素级动画库
 *
 * 用 Pointer Events（`onPointerDown`/`onPointerMove`/`onPointerUp`）而不是原生
 * HTML5 Drag and Drop：后者在触屏上行为不一致、在 jsdom/RTL 里几乎无法可靠模拟；
 * Pointer Events 统一了鼠标与触摸，且能在组件测试里用 `fireEvent.pointerDown` 等
 * 真实触发。没有引入新依赖——拖拽逻辑只是"跟踪指针位置、用 `elementFromPoint`
 * 找到当前悬停在哪一行、实时交换数组顺序、松手时落库"，30 行内能说清楚的逻辑
 * 不值得为它加一个库。
 *
 * 抓手是原型同款的 `GripVertical` 图标（之前占位用的是 Unicode `⠿`，现在换成
 * 与原型一致的 lucide 图标，见 dragHint 徽标同样保留在列表右上角）。
 * 拖拽只在抓手上响应（不是整行都能拖，原型的 `GripVertical` 就画在行首左侧，
 * 不是整行可拖）。**"上移/下移"按钮原样保留**——键盘操作/屏幕阅读器场景不适合
 * 鼠标拖拽，两条路径并存，不是二选一。
 *
 * ## 仍收窄的部分——如实收紧，不是漏做
 *
 * `contract.md` 的 `canvasBinding`/`skillBinding` 结构化绑定（从已存在的画布模板/
 * Skill 清单里选）需要一个选择器组件，留给 Agent 编排/Skill 绑定面板落地时复用同一
 * 套选择器，不在本增量重复造一份——`boardSkill` 暂时仍是自由文本，与原型一致
 * （原型本身也只是纯文本展示，没有真实选择器）。`aiRhythm` 是 AI 对照历史场次
 * 给的节奏建议，原型里"采纳建议"按钮背后没有真实 AI 调用，本编辑器把这张卡片
 * 展示为只读参考（同 `contract.md` 里"需要真实 AI 调用，不在本轮范围"的既有收紧）。
 * "插入环节"/"还原顺序"/"按新顺序重算时间"三个原型 ghost 按钮同样没有真实行为
 * 背书（原型没有"撤销栈"或"起始时间"字段）——已有的「＋ 环节」等价于"插入环节"，
 * 其余两个不造假按钮。
 */

const AI_RHYTHM = {
  tag: "AI 已核对过节奏",
  body: "对照 12 场两天档记录：第 2 天上午的「原型搭建」平均超时 22 分钟，是全场最大缺口；而「组间互评」若少于 20m，昨天的决策会被重新争论一遍。建议 10 加到 90m，把 11 压到 30m。",
} as const;

export type AgendaSession = "AM" | "PM";

export interface AgendaSegmentDraft {
  readonly no: string;
  readonly title: string;
  readonly min: number;
  readonly boardSkill: string;
  readonly optional: boolean;
  readonly day: number;
  readonly session: AgendaSession;
}

export interface AgendaContentValue {
  readonly segments: readonly AgendaSegmentDraft[];
}

const SESSION_LABEL: Record<AgendaSession, string> = { AM: "上午", PM: "下午" };
const DAY_OPTIONS = Array.from({ length: 7 }, (_, d) => ({ value: String(d + 1), label: `第 ${d + 1} 天` }));
const SESSION_OPTIONS = [
  { value: "AM", label: "上午" },
  { value: "PM", label: "下午" },
] as const;

function padNo(index: number): string {
  return String(index + 1).padStart(2, "0");
}

function emptySegment(index: number): AgendaSegmentDraft {
  return { no: padNo(index), title: "", min: 30, boardSkill: "", optional: false, day: 1, session: "AM" };
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
        // 旧数据没有 day/session（引入这两个字段之前存的蓝本）——回退成第 1 天上午，
        // 不因缺字段崩掉整个面板。
        day: typeof s?.day === "number" && Number.isInteger(s.day) && s.day > 0 ? s.day : 1,
        session: s?.session === "PM" ? "PM" : "AM",
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

  /** 改一个环节属于哪天/哪个半场——这是"这个环节归到哪组"的操作，不是拖拽重排，立即落库。 */
  function updateDaySession(index: number, patch: Partial<Pick<AgendaSegmentDraft, "day" | "session">>): void {
    const next = { segments: value.segments.map((s, i) => (i === index ? { ...s, ...patch } : s)) };
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

  /* ── 拖拽重排：抓手响应 Pointer Events，实时交换、松手落库 ───────────────
   * 用 ref 而不是 state 存 draggingIndex/valueRef：拖拽中 pointermove 触发频率
   * 很高，走 state 会导致这一帧的 setValue 还没提交、下一帧 pointermove 读到的
   * `value` 是闭包捕获的旧值——用 ref 保证每次都读到最新数组。
   */
  const draggingIndexRef = React.useRef<number | null>(null);
  const valueRef = React.useRef(value);
  valueRef.current = value;
  const [draggingIndex, setDraggingIndex] = React.useState<number | null>(null);

  function handleGripPointerDown(e: React.PointerEvent<HTMLSpanElement>, index: number): void {
    if (e.button !== 0 && e.pointerType === "mouse") return; // 只响应主按键/触摸
    e.currentTarget.setPointerCapture?.(e.pointerId); // jsdom 测试环境没有这个方法
    draggingIndexRef.current = index;
    setDraggingIndex(index);
  }

  function handleGripPointerMove(e: React.PointerEvent<HTMLSpanElement>): void {
    if (draggingIndexRef.current === null) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const row = el?.closest<HTMLElement>("[data-agenda-index]");
    if (row === null || row === undefined) return;
    const overIndex = Number(row.dataset.agendaIndex);
    const from = draggingIndexRef.current;
    if (Number.isNaN(overIndex) || overIndex === from) return;

    // 只在同一天同一半场内允许拖拽交换——跨组意味着改变这个环节属于哪天哪个
    // 半场，那是另一个操作（环节行上的 day/session 选择控件），不是拖拽重排。
    const dragged = valueRef.current.segments[from];
    const target = valueRef.current.segments[overIndex];
    if (dragged === undefined || target === undefined) return;
    if (dragged.day !== target.day || dragged.session !== target.session) return;

    const segments = [...valueRef.current.segments];
    const [moved] = segments.splice(from, 1);
    segments.splice(overIndex, 0, moved!);
    setValue({ segments }); // 拖拽中只更新本地态做实时预览，不逐帧发请求
    draggingIndexRef.current = overIndex;
    setDraggingIndex(overIndex);
  }

  function handleGripPointerUp(e: React.PointerEvent<HTMLSpanElement>): void {
    if (draggingIndexRef.current === null) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId); // jsdom 测试环境没有这个方法
    draggingIndexRef.current = null;
    setDraggingIndex(null);
    // 松手才落库、才重算编号——同「上移/下移」的既有节流纪律（拖动中不逐帧发 PUT）。
    const next = { segments: renumber(valueRef.current.segments) };
    setValue(next);
    void persist(next);
  }

  const totalMinutes = value.segments.reduce((sum, s) => sum + s.min, 0);

  // 按 day → session 分组渲染，组内保持 `value.segments` 里的原有相对顺序；
  // `index` 存的是环节在 `value.segments` 里的全局下标（data-testid/拖拽/
  // 上移下移都按这个全局下标寻址，分组只影响渲染顺序，不改变存储结构）。
  const groups: { day: number; session: AgendaSession; indices: number[] }[] = [];
  value.segments.forEach((seg, i) => {
    let g = groups.find((x) => x.day === seg.day && x.session === seg.session);
    if (g === undefined) {
      g = { day: seg.day, session: seg.session, indices: [] };
      groups.push(g);
    }
    g.indices.push(i);
  });
  groups.sort((a, b) => (a.day !== b.day ? a.day - b.day : a.session === b.session ? 0 : a.session === "AM" ? -1 : 1));

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
            <button
              type="button"
              onClick={() => void persist(value)}
              disabled={status === "saving"}
              className="rounded-md border border-border px-2 py-1 text-11 transition-colors hover:bg-muted"
              data-testid="bp-facet-save-button"
            >
              保存
            </button>
            <span className="rounded border border-border px-1.5 py-0.5 text-11 text-muted-foreground">
              抓左侧握把拖动：同一天同一半场内可重排；换天/换半场用环节行上的选择器
            </span>
          </div>
        </div>

        {value.segments.length === 0 ? (
          <p className="text-11 text-muted-foreground" data-testid="bp-agenda-empty">
            还没有环节——点「＋ 环节」新增。没写产出物的环节不能保存——那是闲聊不是环节。
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {groups.map((group) => (
              <div key={`${group.day}-${group.session}`} data-testid={`bp-agenda-group-${group.day}-${group.session}`}>
                <h4 className="mb-1 text-11 font-semibold text-muted-foreground">
                  第 {group.day} 天 · {SESSION_LABEL[group.session]}
                </h4>
                <ul className="flex flex-col gap-1.5">
                  {group.indices.map((i) => {
                    const seg = value.segments[i]!;
                    return (
                      <li
                        key={i}
                        data-agenda-index={i}
                        className={
                          draggingIndex === i
                            ? "flex flex-wrap items-center gap-1.5 rounded-md border border-primary bg-accent p-2.5 shadow-md opacity-80 transition-all duration-150 ease-out"
                            : "flex flex-wrap items-center gap-1.5 rounded-md border border-border p-2.5 transition-all duration-150 ease-out"
                        }
                        data-testid={`bp-agenda-segment-${i}`}
                      >
                        <span
                          role="button"
                          tabIndex={-1}
                          aria-label={`拖动排序：${seg.title || "环节 " + seg.no}`}
                          aria-hidden={false}
                          className="flex h-3.5 w-3.5 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground active:cursor-grabbing"
                          data-testid={`bp-agenda-segment-grip-${i}`}
                          onPointerDown={(e) => handleGripPointerDown(e, i)}
                          onPointerMove={handleGripPointerMove}
                          onPointerUp={handleGripPointerUp}
                          onPointerCancel={handleGripPointerUp}
                        >
                          <GripVertical aria-hidden className="h-3.5 w-3.5" />
                        </span>
                        <span className="w-6 shrink-0 text-11 font-mono text-muted-foreground">{seg.no}</span>
                        <Input
                          type="text"
                          className="min-w-0 flex-1 text-12 font-medium"
                          value={seg.title}
                          onChange={(e) => updateSegment(i, { title: e.target.value })}
                          onBlur={() => void persist(value)}
                          placeholder="环节名称"
                          data-testid={`bp-agenda-segment-title-${i}`}
                        />
                        <Checkbox
                          checked={seg.optional}
                          onChange={() => toggleOptional(i)}
                          label="可选"
                          data-testid={`bp-agenda-segment-optional-${i}`}
                        />
                        <Input
                          type="number"
                          className="w-16 text-12"
                          value={seg.min}
                          onChange={(e) => updateSegment(i, { min: Number(e.target.value) || 0 })}
                          onBlur={() => void persist(value)}
                          aria-label="时长（分钟）"
                          data-testid={`bp-agenda-segment-min-${i}`}
                        />
                        <span className="text-11 text-muted-foreground">分钟</span>
                        <Input
                          type="text"
                          className="w-40 border-dashed text-11 text-muted-foreground"
                          value={seg.boardSkill}
                          onChange={(e) => updateSegment(i, { boardSkill: e.target.value })}
                          onBlur={() => void persist(value)}
                          placeholder="绑哪个画布 / Skill"
                          data-testid={`bp-agenda-segment-boardskill-${i}`}
                        />
                        <Select
                          options={DAY_OPTIONS}
                          value={String(seg.day)}
                          onValueChange={(v) => updateDaySession(i, { day: Number(v) || 1 })}
                          className="h-7 min-w-[5rem] text-11"
                          data-testid={`bp-agenda-segment-day-${i}`}
                        />
                        <Select
                          options={SESSION_OPTIONS}
                          value={seg.session}
                          onValueChange={(v) => updateDaySession(i, { session: v === "PM" ? "PM" : "AM" })}
                          className="h-7 min-w-[4.5rem] text-11"
                          data-testid={`bp-agenda-segment-session-${i}`}
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
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
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
