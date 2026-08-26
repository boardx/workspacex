"use client";
import * as React from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { FacetSaveFn } from "./facet-content-editor";

/**
 * 「分组打印素材」结构化编辑器（第 3 项，分组三）——替换该项此前的 `FacetTextEditor`。
 *
 * ⚠ 逐项对照 `apps/web/components/tpl/designer-panels.tsx` 的 `PrintPanel` 与
 * `apps/web/lib/mock/tpl.ts` 的 `PRINT_PANEL`：每件打印件一张卡，左侧是纸张尺寸
 * 徽标（A0/A3/A5/A4），右侧是名称 + 可选的「AI 生成」标记 + 份数 + 一段 detail
 * 说明。底部是一段固定的二维码 OCR 回流说明（`ocrNote`），原型里是纯说明文字，
 * 不是可编辑字段。「导出全部 PDF」按钮在原型里没有真实落点，本编辑器不造假按钮。
 * `size` 原型只出现 A0/A3/A5/A4 四种，做成单选而不是自由文本；`qty` 保持自由文本
 * （原型是 "4 张 ＋ 2 备" 这类带备用量的串）。
 */

export const PRINT_SIZES = ["A0", "A3", "A4", "A5"] as const;
export type PrintSize = (typeof PRINT_SIZES)[number];

const OCR_NOTE =
  "贴完纸怎么进系统：每张 A0 右下角印二维码。手机拍照上传后，便签级 OCR 按分区归位，每张便签保留在原图中的位置，可点回原图核对。";

export interface PrintItemDraft {
  readonly size: PrintSize;
  readonly name: string;
  readonly qty: string;
  readonly ai: boolean;
  readonly detail: string;
}

export interface PrintContentValue {
  readonly items: readonly PrintItemDraft[];
}

function emptyItem(): PrintItemDraft {
  return { size: "A0", name: "", qty: "", ai: false, detail: "" };
}

function emptyValue(): PrintContentValue {
  return { items: [] };
}

export function parsePrintContent(content: string): PrintContentValue {
  if (content.trim() === "") return emptyValue();
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null) return emptyValue();
    const p = parsed as Partial<PrintContentValue>;
    if (!Array.isArray(p.items)) return emptyValue();
    return {
      items: p.items.map((it: Partial<PrintItemDraft>) => ({
        size: PRINT_SIZES.includes(it?.size as never) ? (it.size as PrintSize) : "A0",
        name: typeof it?.name === "string" ? it.name : "",
        qty: typeof it?.qty === "string" ? it.qty : "",
        ai: typeof it?.ai === "boolean" ? it.ai : false,
        detail: typeof it?.detail === "string" ? it.detail : "",
      })),
    };
  } catch {
    return emptyValue();
  }
}

export function serializePrintContent(value: PrintContentValue): string {
  return value.items.length === 0 ? "" : JSON.stringify(value);
}

export function PrintPanelEditor({
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
  const [value, setValue] = React.useState<PrintContentValue>(() => parsePrintContent(content));
  const [revision, setRevision] = React.useState(itemRevision);
  const [status, setStatus] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setValue(parsePrintContent(content));
    setRevision(itemRevision);
    setStatus("idle");
    setError(null);
  }, [designFacetKey, content, itemRevision]);

  async function persist(next: PrintContentValue): Promise<void> {
    setStatus("saving");
    setError(null);
    try {
      const out = await onSave(designFacetKey, serializePrintContent(next), revision);
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

  function addItem(): void {
    const next = { items: [...value.items, emptyItem()] };
    setValue(next);
    void persist(next);
  }

  function removeItem(index: number): void {
    const next = { items: value.items.filter((_, i) => i !== index) };
    setValue(next);
    void persist(next);
  }

  function updateItem(index: number, patch: Partial<PrintItemDraft>): void {
    setValue((v) => ({ items: v.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) }));
  }

  function commitItem(index: number, patch: Partial<PrintItemDraft>): void {
    const next = { items: value.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) };
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

      <div className="mb-4 rounded-lg border border-border p-4" data-testid="bp-print-list">
        <h3 className="mb-2 text-13 font-semibold">打印件（{value.items.length} 件）</h3>
        {value.items.length === 0 ? (
          <p className="text-11 text-muted-foreground" data-testid="bp-print-empty">
            还没有打印件——点「＋ 打印件」新增。
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {value.items.map((it, i) => (
              <div key={i} className="flex gap-2 rounded-md border border-border p-2.5" data-testid={`bp-print-item-${i}`}>
                <div className="flex h-fit shrink-0 flex-col gap-0.5">
                  {PRINT_SIZES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => commitItem(i, { size: s })}
                      aria-pressed={it.size === s}
                      className={
                        it.size === s
                          ? "rounded border border-primary px-1.5 py-0.5 text-10 text-primary transition-colors"
                          : "rounded border border-border px-1.5 py-0.5 text-10 text-muted-foreground transition-colors hover:bg-muted"
                      }
                      data-testid={`bp-print-size-${i}-${s}`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <div className="flex-1">
                  <div className="mb-1 flex items-center gap-1.5">
                    <Input
                      type="text"
                      className="flex-1 text-12 font-medium"
                      value={it.name}
                      onChange={(e) => updateItem(i, { name: e.target.value })}
                      onBlur={() => void persist(value)}
                      placeholder="打印件名（如「HMW 画布」）"
                      data-testid={`bp-print-name-${i}`}
                    />
                    <Checkbox
                      className="shrink-0"
                      checked={it.ai}
                      onChange={() => commitItem(i, { ai: !it.ai })}
                      label="AI 生成"
                      data-testid={`bp-print-ai-${i}`}
                    />
                    <Input
                      type="text"
                      className="w-24 shrink-0 text-11"
                      value={it.qty}
                      onChange={(e) => updateItem(i, { qty: e.target.value })}
                      onBlur={() => void persist(value)}
                      placeholder="4 张 ＋ 2 备"
                      aria-label="份数"
                      data-testid={`bp-print-qty-${i}`}
                    />
                    <button
                      type="button"
                      onClick={() => removeItem(i)}
                      className="shrink-0 rounded border border-border px-1 text-11 text-destructive"
                      aria-label="删除打印件"
                      data-testid={`bp-print-remove-${i}`}
                    >
                      ✕
                    </button>
                  </div>
                  <Textarea
                    className="min-h-10 w-full text-11 text-muted-foreground"
                    value={it.detail}
                    onChange={(e) => updateItem(i, { detail: e.target.value })}
                    onBlur={() => void persist(value)}
                    placeholder="说明（与哪个画布模板同构、含哪些分区、带组号与二维码等）"
                    data-testid={`bp-print-detail-${i}`}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={addItem}
          className="mt-2 rounded-md border border-border px-2 py-1 text-11 transition-colors hover:bg-muted"
          data-testid="bp-print-add"
        >
          ＋ 打印件
        </button>
      </div>

      <div className="mb-4 rounded-lg border border-border p-4" data-testid="bp-print-ocr">
        <h3 className="mb-2 text-13 font-semibold">贴完纸怎么进系统（二维码 OCR 回流）</h3>
        <p className="text-12 leading-relaxed text-muted-foreground">{OCR_NOTE}</p>
      </div>

      {error !== null && (
        <p role="alert" className="text-11 text-destructive" data-testid={`bp-facet-error-${designFacetKey}`}>
          {error}
        </p>
      )}
    </div>
  );
}
