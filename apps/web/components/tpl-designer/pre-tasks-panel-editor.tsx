"use client";
import * as React from "react";
import type { FacetSaveFn } from "./facet-content-editor";

/**
 * 「会前任务」结构化编辑器（第 3 项，分组二）——`design-deltas/
 * blueprint-design-facet-panels/contract.md` 的 `PreTaskContent` 字段提议
 * 落地成真实可编辑表单，替换该项此前统一使用的 `FacetTextEditor` 自由文本框。
 *
 * ⚠ 逐项对照 `apps/web/components/tpl/designer-panels.tsx` 的 `HomeworkPanel`
 * 与 `apps/web/lib/mock/tpl.ts` 的 `HOMEWORK_PANEL`：
 * - 任务卡片（`tasks[]{title,seg,forWhom,ifNot,due}`）可增删改。
 * - 「挂到具体环节」（`seg`）与「不做会怎样」（`ifNot`）是原型明确的**硬约束
 *   字段**（intro 逐字写着"每项任务必须挂到具体环节，并写清「不做会怎样」。
 *   挂不上环节的任务就是无意义的作业"），因此界面上给它们明确的必填提示——
 *   但**不做前端阻断**：这一层校验属于套用/发布时的门控，不是编辑器该拦的，
 *   编辑器只如实提示（同 F193 起「面板只负责真实读写」的既有边界）。
 * - `forWhom` 原型只有「全体」「仅组长」两种，做成单选而不是自由文本。
 * - 催办规则（`reminderRule`）在原型里是一张 AI 说明卡片，不是可编辑字段。
 */

export const PRE_TASK_AUDIENCES = ["全体", "仅组长"] as const;
export type PreTaskAudience = (typeof PRE_TASK_AUDIENCES)[number];

const REMINDER_RULE =
  "催办由 AI 做，不由引导师做：截止前 24h 未提交自动发个性化提醒（提到他本人在问卷里写的那条）；仍未提交则在概览的就绪检查里标红。";

export interface PreTaskDraft {
  readonly title: string;
  readonly seg: string;
  readonly forWhom: PreTaskAudience;
  readonly ifNot: string;
  readonly due: string;
}

export interface PreTaskContentValue {
  readonly tasks: readonly PreTaskDraft[];
}

function emptyTask(): PreTaskDraft {
  return { title: "", seg: "", forWhom: "全体", ifNot: "", due: "" };
}

function emptyValue(): PreTaskContentValue {
  return { tasks: [] };
}

export function parsePreTaskContent(content: string): PreTaskContentValue {
  if (content.trim() === "") return emptyValue();
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null) return emptyValue();
    const p = parsed as Partial<PreTaskContentValue>;
    if (!Array.isArray(p.tasks)) return emptyValue();
    return {
      tasks: p.tasks.map((t: Partial<PreTaskDraft>) => ({
        title: typeof t?.title === "string" ? t.title : "",
        seg: typeof t?.seg === "string" ? t.seg : "",
        forWhom: PRE_TASK_AUDIENCES.includes(t?.forWhom as never) ? (t.forWhom as PreTaskAudience) : "全体",
        ifNot: typeof t?.ifNot === "string" ? t.ifNot : "",
        due: typeof t?.due === "string" ? t.due : "",
      })),
    };
  } catch {
    return emptyValue();
  }
}

export function serializePreTaskContent(value: PreTaskContentValue): string {
  return value.tasks.length === 0 ? "" : JSON.stringify(value);
}

export function PreTasksPanelEditor({
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
  const [value, setValue] = React.useState<PreTaskContentValue>(() => parsePreTaskContent(content));
  const [revision, setRevision] = React.useState(itemRevision);
  const [status, setStatus] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setValue(parsePreTaskContent(content));
    setRevision(itemRevision);
    setStatus("idle");
    setError(null);
  }, [designFacetKey, content, itemRevision]);

  async function persist(next: PreTaskContentValue): Promise<void> {
    setStatus("saving");
    setError(null);
    try {
      const out = await onSave(designFacetKey, serializePreTaskContent(next), revision);
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

  function addTask(): void {
    const next = { tasks: [...value.tasks, emptyTask()] };
    setValue(next);
    void persist(next);
  }

  function removeTask(index: number): void {
    const next = { tasks: value.tasks.filter((_, i) => i !== index) };
    setValue(next);
    void persist(next);
  }

  function updateTask(index: number, patch: Partial<PreTaskDraft>): void {
    setValue((v) => ({ tasks: v.tasks.map((t, i) => (i === index ? { ...t, ...patch } : t)) }));
  }

  function setAudience(index: number, audience: PreTaskAudience): void {
    const next = { tasks: value.tasks.map((t, i) => (i === index ? { ...t, forWhom: audience } : t)) };
    setValue(next);
    void persist(next);
  }

  return (
    <div data-testid={`bp-facet-editor-${designFacetKey}`}>
      <div className="mb-2 flex items-center gap-1.5">
        {status !== "idle" && (
          <span className={status === "error" ? "text-11 text-destructive" : "text-11 text-muted-foreground"} data-testid="bp-facet-save-status">
            {status === "saving" ? "保存中…" : status === "saved" ? "已保存" : "保存失败"}
          </span>
        )}
      </div>

      <div className="mb-4 rounded-lg border border-border p-4" data-testid="bp-hw-list">
        <h3 className="mb-2 text-13 font-semibold">任务清单</h3>
        {value.tasks.length === 0 ? (
          <p className="text-11 text-muted-foreground" data-testid="bp-hw-empty">
            还没有会前任务——点「＋ 任务」新增。
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {value.tasks.map((t, i) => (
              <li key={i} className="rounded-md border border-border p-2.5" data-testid={`bp-hw-task-${i}`}>
                <div className="mb-1 flex items-center gap-1.5">
                  <input
                    type="text"
                    className="flex-1 rounded-md border border-border bg-background p-1 text-12 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={t.title}
                    onChange={(e) => updateTask(i, { title: e.target.value })}
                    onBlur={() => void persist(value)}
                    placeholder="任务标题（如「带 2 个你亲历的失败案例」）"
                    data-testid={`bp-hw-title-${i}`}
                  />
                  <input
                    type="text"
                    className="w-24 shrink-0 rounded-md border border-border bg-background p-1 text-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={t.seg}
                    onChange={(e) => updateTask(i, { seg: e.target.value })}
                    onBlur={() => void persist(value)}
                    placeholder="挂环节 03"
                    aria-label="挂到哪个环节（必填）"
                    data-testid={`bp-hw-seg-${i}`}
                  />
                  <button
                    type="button"
                    onClick={() => removeTask(i)}
                    className="shrink-0 rounded-md border border-border px-2 py-1 text-11 text-destructive transition-colors hover:bg-muted"
                    data-testid={`bp-hw-remove-${i}`}
                  >
                    删除
                  </button>
                </div>
                <div className="mb-1 flex items-center gap-1.5">
                  {PRE_TASK_AUDIENCES.map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setAudience(i, a)}
                      className={
                        t.forWhom === a
                          ? "rounded border border-primary px-1.5 py-0.5 text-11 text-primary transition-colors"
                          : "rounded border border-border px-1.5 py-0.5 text-11 text-muted-foreground transition-colors hover:bg-muted"
                      }
                      data-testid={`bp-hw-audience-${i}-${a}`}
                    >
                      {a}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  className="mb-1 w-full rounded-md border border-border bg-background p-1 text-11 text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={t.ifNot}
                  onChange={(e) => updateTask(i, { ifNot: e.target.value })}
                  onBlur={() => void persist(value)}
                  placeholder="不做会怎样（必填——写不出来的任务就该删掉）"
                  data-testid={`bp-hw-ifnot-${i}`}
                />
                <input
                  type="text"
                  className="w-full rounded-md border border-dashed border-border bg-background p-1 text-11 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={t.due}
                  onChange={(e) => updateTask(i, { due: e.target.value })}
                  onBlur={() => void persist(value)}
                  placeholder="截止（如「开始前 2 天 · 文字/语音均可，AI 会预读并提炼」）"
                  data-testid={`bp-hw-due-${i}`}
                />
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={addTask}
          className="mt-2 rounded-md border border-border px-2 py-1 text-11 transition-colors hover:bg-muted"
          data-testid="bp-hw-add"
        >
          ＋ 任务
        </button>
      </div>

      <div
        className="mb-4 flex items-start gap-2 rounded-md border border-ai-tint bg-ai-tint p-2.5"
        data-testid="bp-hw-reminder"
      >
        <span aria-hidden className="mt-0.5 shrink-0 text-ai-tint-foreground">
          ✨
        </span>
        <div>
          <p className="text-11 font-medium text-ai-tint-foreground">催办由 AI 做</p>
          <p className="mt-0.5 text-11 text-muted-foreground">{REMINDER_RULE}</p>
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
