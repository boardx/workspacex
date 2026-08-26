"use client";
import * as React from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { FacetSaveFn } from "./facet-content-editor";

/**
 * 「输出物」结构化编辑器（第 1 项，分组五）——替换该项此前的 `FacetTextEditor`。
 *
 * ⚠ 逐项对照 `apps/web/components/tpl/designer-panels.tsx` 的 `OutputsPanel` 与
 * `apps/web/lib/mock/tpl.ts` 的 `OUTPUTS_PANEL`：
 * - 每行是「产出名 + 是否必须 + 生成方式 + 去向」，原型用一个红点/灰点标必须性，
 *   必须项额外带「必须」徽标——本编辑器把 `required` 做成真实可勾选。
 * - 「回流规则」与「结项检查」两节在原型里是固定说明/静态 ✓ 清单，不是可编辑
 *   字段——它们是产品级约束（正式产出只能绑固定快照、结项四项检查），保持只读。
 * - `gen`（生成方式）与 `to`（去向）原型是自由文本徽标（"AI 提取 · 人确认"、
 *   "决策台账"），保持自由文本，不发明枚举。
 */

const REFLOW_RULE =
  "正式产出与被决策引用的只能绑固定快照，不能绑活文档，否则事后改动会让已签字的决策依据发生变化。画布可以继续改，但改的是新版本。";

const CLOSE_CHECKS = [
  "两件必须有的产出都存在",
  "每个行动项都有责任人与日期",
  "决策的拍板栏是人名",
  "复盘会已排期（未做则 14 天后提醒）",
] as const;

export interface OutputRowDraft {
  readonly name: string;
  readonly gen: string;
  readonly to: string;
  readonly required: boolean;
}

export interface OutputsContentValue {
  readonly rows: readonly OutputRowDraft[];
}

function emptyRow(): OutputRowDraft {
  return { name: "", gen: "", to: "", required: false };
}

function emptyValue(): OutputsContentValue {
  return { rows: [] };
}

export function parseOutputsContent(content: string): OutputsContentValue {
  if (content.trim() === "") return emptyValue();
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null) return emptyValue();
    const p = parsed as Partial<OutputsContentValue>;
    if (!Array.isArray(p.rows)) return emptyValue();
    return {
      rows: p.rows.map((r: Partial<OutputRowDraft>) => ({
        name: typeof r?.name === "string" ? r.name : "",
        gen: typeof r?.gen === "string" ? r.gen : "",
        to: typeof r?.to === "string" ? r.to : "",
        required: typeof r?.required === "boolean" ? r.required : false,
      })),
    };
  } catch {
    return emptyValue();
  }
}

export function serializeOutputsContent(value: OutputsContentValue): string {
  return value.rows.length === 0 ? "" : JSON.stringify(value);
}

export function OutputsPanelEditor({
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
  const [value, setValue] = React.useState<OutputsContentValue>(() => parseOutputsContent(content));
  const [revision, setRevision] = React.useState(itemRevision);
  const [status, setStatus] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setValue(parseOutputsContent(content));
    setRevision(itemRevision);
    setStatus("idle");
    setError(null);
  }, [designFacetKey, content, itemRevision]);

  async function persist(next: OutputsContentValue): Promise<void> {
    setStatus("saving");
    setError(null);
    try {
      const out = await onSave(designFacetKey, serializeOutputsContent(next), revision);
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

  function addRow(): void {
    const next = { rows: [...value.rows, emptyRow()] };
    setValue(next);
    void persist(next);
  }

  function removeRow(index: number): void {
    const next = { rows: value.rows.filter((_, i) => i !== index) };
    setValue(next);
    void persist(next);
  }

  function updateRow(index: number, patch: Partial<OutputRowDraft>): void {
    setValue((v) => ({ rows: v.rows.map((r, i) => (i === index ? { ...r, ...patch } : r)) }));
  }

  function toggleRequired(index: number): void {
    const next = { rows: value.rows.map((r, i) => (i === index ? { ...r, required: !r.required } : r)) };
    setValue(next);
    void persist(next);
  }

  const requiredCount = value.rows.filter((r) => r.required).length;

  return (
    <div data-testid={`bp-facet-editor-${designFacetKey}`}>
      <div className="mb-2 flex items-center gap-1.5">
        {status !== "idle" && (
          <span className={status === "error" ? "text-11 text-destructive" : "text-11 text-muted-foreground"} data-testid="bp-facet-save-status">
            {status === "saving" ? "保存中…" : status === "saved" ? "已保存" : "保存失败"}
          </span>
        )}
      </div>

      <div className="mb-4 rounded-lg border border-border p-4" data-testid="bp-out-list">
        <h3 className="mb-2 text-13 font-semibold">
          产出清单 · {value.rows.length} 件（{requiredCount} 件必须有，缺了不能结项）
        </h3>
        {value.rows.length === 0 ? (
          <p className="text-11 text-muted-foreground" data-testid="bp-out-empty">
            还没有产出物——点「＋ 输出物」新增。
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {value.rows.map((r, i) => (
              <li key={i} className="flex flex-col gap-1 p-2.5" data-testid={`bp-out-row-${i}`}>
                <div className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className={
                      r.required
                        ? "h-1.5 w-1.5 shrink-0 rounded-full bg-destructive"
                        : "h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40"
                    }
                  />
                  <Input
                    type="text"
                    className="flex-1 text-12 font-medium"
                    value={r.name}
                    onChange={(e) => updateRow(i, { name: e.target.value })}
                    onBlur={() => void persist(value)}
                    placeholder="产出名（如「3 个可推进题目（含依据）」）"
                    data-testid={`bp-out-name-${i}`}
                  />
                  <Checkbox
                    className="shrink-0"
                    checked={r.required}
                    onChange={() => toggleRequired(i)}
                    label="必须"
                    data-testid={`bp-out-required-${i}`}
                  />
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    className="shrink-0 rounded border border-border px-1 text-11 text-destructive"
                    aria-label="删除产出物"
                    data-testid={`bp-out-remove-${i}`}
                  >
                    ✕
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="text"
                    className="flex-1 text-11"
                    value={r.gen}
                    onChange={(e) => updateRow(i, { gen: e.target.value })}
                    onBlur={() => void persist(value)}
                    placeholder="生成方式（如「AI 提取 · 人确认」）"
                    data-testid={`bp-out-gen-${i}`}
                  />
                  <span aria-hidden className="shrink-0 text-muted-foreground">
                    ›
                  </span>
                  <Input
                    type="text"
                    className="flex-1 border-dashed text-11 text-muted-foreground"
                    value={r.to}
                    onChange={(e) => updateRow(i, { to: e.target.value })}
                    onBlur={() => void persist(value)}
                    placeholder="去向（如「决策台账」）"
                    data-testid={`bp-out-to-${i}`}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={addRow}
          className="mt-2 rounded-md border border-border px-2 py-1 text-11 transition-colors hover:bg-muted"
          data-testid="bp-out-add"
        >
          ＋ 输出物
        </button>
      </div>

      <div className="mb-4 rounded-lg border border-border p-4" data-testid="bp-out-reflow">
        <h3 className="mb-2 text-13 font-semibold">回流规则</h3>
        <p className="text-12 leading-relaxed text-muted-foreground">{REFLOW_RULE}</p>
      </div>

      <div className="mb-4 rounded-lg border border-border p-4" data-testid="bp-out-checks">
        <h3 className="mb-2 text-13 font-semibold">结项检查</h3>
        <ul className="flex flex-col gap-1.5">
          {CLOSE_CHECKS.map((c) => (
            <li key={c} className="flex items-start gap-2 text-12" data-testid="bp-out-check">
              <span aria-hidden className="mt-0.5 text-success">
                ✓
              </span>
              {c}
            </li>
          ))}
        </ul>
      </div>

      {error !== null && (
        <p role="alert" className="text-11 text-destructive" data-testid={`bp-facet-error-${designFacetKey}`}>
          {error}
        </p>
      )}
    </div>
  );
}
