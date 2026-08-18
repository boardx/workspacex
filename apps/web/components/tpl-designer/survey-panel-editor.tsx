"use client";
import * as React from "react";
import type { FacetSaveFn } from "./facet-content-editor";

/**
 * 「问卷」结构化编辑器（第 1 项，分组二）——`design-deltas/
 * blueprint-design-facet-panels/contract.md` 的 `SurveyContent` 字段提议落地成
 * 真实可编辑表单，替换该项此前统一使用的 `FacetTextEditor` 自由文本框。
 *
 * ⚠ 逐项对照 `apps/web/components/tpl/designer-panels.tsx` 的 `SurveyPanel` 与
 * `apps/web/lib/mock/tpl.ts` 的 `SURVEY_PANEL`（2026-08-17 人类强化指令的纪律：
 * UI 具体形态以原型为准，不照 contract.md 字段列表自行设计）：原型是「按问卷分
 * 卡片，每张卡一个名字 / 发放时机徽标 / 用途说明 / 占位题目骨架清单」的结构，
 * `timing` 是一段自由文本（"开始前 5 天发 · 60% 阻断开始"），阻断阈值等信息
 * 直接写在这段文本里，不是 contract.md 提议的拆开的 `kind` 枚举 +
 * `blockingThreshold`/`estimatedMinutes` 字段——本编辑器以原型为准，不强行拆成
 * 没有对应原型控件可以对照的字段。
 */

export interface SurveyCardDraft {
  readonly name: string;
  readonly timing: string;
  readonly purpose: string;
  readonly skeleton: readonly string[];
}

export interface SurveyContentValue {
  readonly surveys: readonly SurveyCardDraft[];
}

function emptyCard(): SurveyCardDraft {
  return { name: "", timing: "", purpose: "", skeleton: [] };
}

function emptyValue(): SurveyContentValue {
  return { surveys: [] };
}

export function parseSurveyContent(content: string): SurveyContentValue {
  if (content.trim() === "") return emptyValue();
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null) return emptyValue();
    const p = parsed as Partial<SurveyContentValue>;
    if (!Array.isArray(p.surveys)) return emptyValue();
    return {
      surveys: p.surveys.map((s: Partial<SurveyCardDraft>) => ({
        name: typeof s?.name === "string" ? s.name : "",
        timing: typeof s?.timing === "string" ? s.timing : "",
        purpose: typeof s?.purpose === "string" ? s.purpose : "",
        skeleton: Array.isArray(s?.skeleton) ? s.skeleton.filter((q): q is string => typeof q === "string") : [],
      })),
    };
  } catch {
    return emptyValue();
  }
}

export function serializeSurveyContent(value: SurveyContentValue): string {
  return value.surveys.length === 0 ? "" : JSON.stringify(value);
}

export function SurveyPanelEditor({
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
  const [value, setValue] = React.useState<SurveyContentValue>(() => parseSurveyContent(content));
  const [revision, setRevision] = React.useState(itemRevision);
  const [status, setStatus] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setValue(parseSurveyContent(content));
    setRevision(itemRevision);
    setStatus("idle");
    setError(null);
  }, [designFacetKey, content, itemRevision]);

  async function persist(next: SurveyContentValue): Promise<void> {
    setStatus("saving");
    setError(null);
    try {
      const out = await onSave(designFacetKey, serializeSurveyContent(next), revision);
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

  function addSurvey(): void {
    const next = { surveys: [...value.surveys, emptyCard()] };
    setValue(next);
    void persist(next);
  }

  function removeSurvey(index: number): void {
    const next = { surveys: value.surveys.filter((_, i) => i !== index) };
    setValue(next);
    void persist(next);
  }

  function updateSurvey(index: number, patch: Partial<SurveyCardDraft>): void {
    setValue((v) => ({ surveys: v.surveys.map((s, i) => (i === index ? { ...s, ...patch } : s)) }));
  }

  function addQuestion(index: number): void {
    const next = {
      surveys: value.surveys.map((s, i) => (i === index ? { ...s, skeleton: [...s.skeleton, ""] } : s)),
    };
    setValue(next);
    void persist(next);
  }

  function updateQuestion(sIndex: number, qIndex: number, text: string): void {
    setValue((v) => ({
      surveys: v.surveys.map((s, i) =>
        i === sIndex ? { ...s, skeleton: s.skeleton.map((q, j) => (j === qIndex ? text : q)) } : s,
      ),
    }));
  }

  function removeQuestion(sIndex: number, qIndex: number): void {
    const next = {
      surveys: value.surveys.map((s, i) =>
        i === sIndex ? { ...s, skeleton: s.skeleton.filter((_, j) => j !== qIndex) } : s,
      ),
    };
    setValue(next);
    void persist(next);
  }

  return (
    <div data-testid={`bp-facet-editor-${designFacetKey}`}>
      <div className="mb-2 flex items-center gap-1.5">
        {status !== "idle" && (
          <span
            className={status === "error" ? "text-11 text-destructive" : "text-11 text-muted-foreground"}
            data-testid="bp-facet-save-status"
          >
            {status === "saving" ? "保存中…" : status === "saved" ? "已保存" : "保存失败"}
          </span>
        )}
      </div>

      {value.surveys.length === 0 ? (
        <p className="mb-3 text-11 text-muted-foreground" data-testid="bp-survey-empty">
          还没有问卷——点「＋ 加一份问卷」新增。
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {value.surveys.map((s, i) => (
            <li key={i} className="rounded-lg border border-border p-4" data-testid={`bp-survey-card-${i}`}>
              <div className="mb-2 flex items-center gap-1.5">
                <input
                  type="text"
                  className="flex-1 rounded-md border border-border bg-background p-1.5 text-13 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={s.name}
                  onChange={(e) => updateSurvey(i, { name: e.target.value })}
                  onBlur={() => void persist(value)}
                  placeholder="问卷名（如「会前预习问卷」）"
                  data-testid={`bp-survey-name-${i}`}
                />
                <button
                  type="button"
                  onClick={() => removeSurvey(i)}
                  className="shrink-0 rounded-md border border-border px-2 py-1 text-11 text-destructive transition-colors hover:bg-muted"
                  data-testid={`bp-survey-remove-${i}`}
                >
                  删除
                </button>
              </div>
              <input
                type="text"
                className="mb-2 w-full rounded-md border border-dashed border-border bg-background p-1.5 text-11 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={s.timing}
                onChange={(e) => updateSurvey(i, { timing: e.target.value })}
                onBlur={() => void persist(value)}
                placeholder="发放时机（如「开始前 5 天发 · 60% 阻断开始」）"
                data-testid={`bp-survey-timing-${i}`}
              />
              <textarea
                className="mb-2 min-h-10 w-full rounded-md border border-border bg-background p-1.5 text-11 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={s.purpose}
                onChange={(e) => updateSurvey(i, { purpose: e.target.value })}
                onBlur={() => void persist(value)}
                placeholder="用途说明（如「让现场不用花时间对齐背景。8 题、约 6 分钟。」）"
                data-testid={`bp-survey-purpose-${i}`}
              />
              <ul className="flex flex-col gap-1">
                {s.skeleton.map((q, qi) => (
                  <li key={qi} className="flex items-center gap-1.5" data-testid={`bp-survey-question-row-${i}-${qi}`}>
                    <input
                      type="text"
                      className="flex-1 rounded-md bg-panel px-2.5 py-1.5 text-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={q}
                      onChange={(e) => updateQuestion(i, qi, e.target.value)}
                      onBlur={() => void persist(value)}
                      placeholder="占位题目骨架"
                      data-testid={`bp-survey-question-${i}-${qi}`}
                    />
                    <button
                      type="button"
                      onClick={() => removeQuestion(i, qi)}
                      className="shrink-0 rounded border border-border px-1 text-11 text-destructive"
                      aria-label="删除题目"
                      data-testid={`bp-survey-question-remove-${i}-${qi}`}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => addQuestion(i)}
                className="mt-2 rounded-md border border-border px-2 py-1 text-11 transition-colors hover:bg-muted"
                data-testid={`bp-survey-add-question-${i}`}
              >
                ＋ 题目
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={addSurvey}
        className="mt-3 rounded-md border border-border px-2 py-1 text-11 transition-colors hover:bg-muted"
        data-testid="bp-survey-add"
      >
        ＋ 加一份问卷 · 或从问卷 Studio 引入
      </button>

      {error !== null && (
        <p role="alert" className="mt-2 text-11 text-destructive" data-testid={`bp-facet-error-${designFacetKey}`}>
          {error}
        </p>
      )}
    </div>
  );
}
