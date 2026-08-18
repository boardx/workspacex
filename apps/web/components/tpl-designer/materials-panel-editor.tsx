"use client";
import * as React from "react";
import type { FacetSaveFn } from "./facet-content-editor";

/**
 * 「项目材料」结构化编辑器（第 2 项，分组三）——替换该项此前的 `FacetTextEditor`。
 *
 * ⚠ 逐项对照 `apps/web/components/tpl/designer-panels.tsx` 的 `MaterialsPanel` 与
 * `apps/web/lib/mock/tpl.ts` 的 `MATERIALS_PANEL`：原型是一张四列表格
 * （物料 / 数量 / 用于环节 / 谁准备），下方一句固定脚注说明「数量会按实际人数
 * 重算」。`owner` 原型只出现「场地方」「我方」「我方打印」三种取值，做成单选而
 * 不是自由文本；数量保持自由文本（原型里是 "16 叠"/"4 ＋ 2 备" 这类带单位与
 * 备用量的串，不是纯数字，拆成数值+单位没有对应原型控件）。
 * 「导出清单」按钮在原型里没有真实落点，本编辑器不造一个假按钮。
 */

export const MATERIAL_OWNERS = ["场地方", "我方", "我方打印"] as const;
export type MaterialOwner = (typeof MATERIAL_OWNERS)[number];

const FOOTNOTE =
  "数量会按实际人数重算——这里写的是 16 人 / 4 组的基准；套用时人数一变，清单自动换算并标出需要额外采购的项。";

export interface MaterialRowDraft {
  readonly name: string;
  readonly qty: string;
  readonly forSeg: string;
  readonly owner: MaterialOwner;
}

export interface MaterialsContentValue {
  readonly rows: readonly MaterialRowDraft[];
}

function emptyRow(): MaterialRowDraft {
  return { name: "", qty: "", forSeg: "", owner: "场地方" };
}

function emptyValue(): MaterialsContentValue {
  return { rows: [] };
}

export function parseMaterialsContent(content: string): MaterialsContentValue {
  if (content.trim() === "") return emptyValue();
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null) return emptyValue();
    const p = parsed as Partial<MaterialsContentValue>;
    if (!Array.isArray(p.rows)) return emptyValue();
    return {
      rows: p.rows.map((r: Partial<MaterialRowDraft>) => ({
        name: typeof r?.name === "string" ? r.name : "",
        qty: typeof r?.qty === "string" ? r.qty : "",
        forSeg: typeof r?.forSeg === "string" ? r.forSeg : "",
        owner: MATERIAL_OWNERS.includes(r?.owner as never) ? (r.owner as MaterialOwner) : "场地方",
      })),
    };
  } catch {
    return emptyValue();
  }
}

export function serializeMaterialsContent(value: MaterialsContentValue): string {
  return value.rows.length === 0 ? "" : JSON.stringify(value);
}

export function MaterialsPanelEditor({
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
  const [value, setValue] = React.useState<MaterialsContentValue>(() => parseMaterialsContent(content));
  const [revision, setRevision] = React.useState(itemRevision);
  const [status, setStatus] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setValue(parseMaterialsContent(content));
    setRevision(itemRevision);
    setStatus("idle");
    setError(null);
  }, [designFacetKey, content, itemRevision]);

  async function persist(next: MaterialsContentValue): Promise<void> {
    setStatus("saving");
    setError(null);
    try {
      const out = await onSave(designFacetKey, serializeMaterialsContent(next), revision);
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

  function updateRow(index: number, patch: Partial<MaterialRowDraft>): void {
    setValue((v) => ({ rows: v.rows.map((r, i) => (i === index ? { ...r, ...patch } : r)) }));
  }

  function setOwner(index: number, owner: MaterialOwner): void {
    const next = { rows: value.rows.map((r, i) => (i === index ? { ...r, owner } : r)) };
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

      <div className="mb-4 rounded-lg border border-border p-4" data-testid="bp-mat-list">
        <h3 className="mb-2 text-13 font-semibold">物料清单 · {value.rows.length} 件</h3>
        {value.rows.length === 0 ? (
          <p className="text-11 text-muted-foreground" data-testid="bp-mat-empty">
            还没有物料——点「＋ 物料」新增。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-12" data-testid="bp-mat-table">
              <thead>
                <tr className="border-b border-border text-11 text-muted-foreground">
                  <th className="py-1.5 pr-2 text-left font-medium">物料</th>
                  <th className="px-2 py-1.5 text-left font-medium">数量</th>
                  <th className="px-2 py-1.5 text-left font-medium">用于环节</th>
                  <th className="px-2 py-1.5 text-left font-medium">谁准备</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {value.rows.map((r, i) => (
                  <tr key={i} className="border-b border-border-subtle" data-testid={`bp-mat-row-${i}`}>
                    <td className="py-1.5 pr-2">
                      <input
                        type="text"
                        className="w-full rounded-md border border-border bg-background p-1 text-12 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        value={r.name}
                        onChange={(e) => updateRow(i, { name: e.target.value })}
                        onBlur={() => void persist(value)}
                        placeholder="便签（4 色，76mm）"
                        data-testid={`bp-mat-name-${i}`}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="text"
                        className="w-20 rounded-md border border-border bg-background p-1 font-mono text-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        value={r.qty}
                        onChange={(e) => updateRow(i, { qty: e.target.value })}
                        onBlur={() => void persist(value)}
                        placeholder="16 叠"
                        data-testid={`bp-mat-qty-${i}`}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="text"
                        className="w-20 rounded-md border border-border bg-background p-1 text-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        value={r.forSeg}
                        onChange={(e) => updateRow(i, { forSeg: e.target.value })}
                        onBlur={() => void persist(value)}
                        placeholder="03 / 04"
                        data-testid={`bp-mat-seg-${i}`}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex gap-0.5">
                        {MATERIAL_OWNERS.map((o) => (
                          <button
                            key={o}
                            type="button"
                            onClick={() => setOwner(i, o)}
                            aria-pressed={r.owner === o}
                            className={
                              r.owner === o
                                ? "rounded border border-primary px-1 py-0.5 text-10 text-primary transition-colors"
                                : "rounded border border-border px-1 py-0.5 text-10 text-muted-foreground transition-colors hover:bg-muted"
                            }
                            data-testid={`bp-mat-owner-${i}-${o}`}
                          >
                            {o}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <button
                        type="button"
                        onClick={() => removeRow(i)}
                        className="rounded border border-border px-1 text-11 text-destructive"
                        aria-label="删除物料"
                        data-testid={`bp-mat-remove-${i}`}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 rounded-md bg-panel px-2.5 py-1.5 text-11 text-muted-foreground" data-testid="bp-mat-footnote">
          {FOOTNOTE}
        </p>
        <button
          type="button"
          onClick={addRow}
          className="mt-2 rounded-md border border-border px-2 py-1 text-11 transition-colors hover:bg-muted"
          data-testid="bp-mat-add"
        >
          ＋ 物料
        </button>
      </div>

      {error !== null && (
        <p role="alert" className="text-11 text-destructive" data-testid={`bp-facet-error-${designFacetKey}`}>
          {error}
        </p>
      )}
    </div>
  );
}
