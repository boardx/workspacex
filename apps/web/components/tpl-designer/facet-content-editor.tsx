"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";

/**
 * 蓝本设计器**真实**可编辑面板的通用兜底编辑器。
 *
 * ## 本文件今天装的是什么
 *
 * `FacetTextEditor`——通用自由文本编辑器，现在**只作兜底**（见
 * `facet-editor-registry.ts`：13 个 designFacetKey 一个都不会落到它）。
 *
 * ⚠ 别把下面的历史读成现状：F193 落地时 16 项确实统一走 `FacetTextEditor`
 * （只有权限矩阵是例外），F204–F207 已把 15 项**全部**换成专属结构化编辑器；
 * 2026-08-31 产品决策移除 `roles-and-perms`（角色与权限）/`group-capabilities`
 * （组内能力）两项后，本文件原本装的 `PermissionMatrixEditor`（「角色与权限」
 * 专属编辑器）随之一并删除——它是 `roles-and-perms` 唯一的调用方，产品决策
 * 去掉这一项，配套的专属组件没有理由继续留在仓库里。
 * `updateDesignFacet` 的 `content` 字段仍是**不透明字符串**（BP-02/F174 签核形状，
 * `design-deltas/blueprint-design-facet-panels/` 明确"本变更不改动任何已签核契约操作的形状"）
 * ——变的只是前端往这个字符串里写什么（现在写的是各面板的结构化 JSON），契约一字未改。
 *
 * ## 乐观并发
 *
 * `expectedItemRevision` 用调用方传入的当前值；空字符串哨兵表示"以为还没人填过"，
 * 与后端 `updateDesignFacet` 的既有约定一致。保存失败若是 `VERSION_CHANGED`
 * （并发冲突），提示用户刷新，不静默覆盖、不重试。
 */
export interface FacetSaveResult {
  readonly itemRevision: string;
  readonly completeness: { readonly done: number; readonly denominator: number };
}

export type FacetSaveFn = (
  designFacetKey: string,
  value: string,
  expectedItemRevision: string,
) => Promise<FacetSaveResult>;

export function FacetTextEditor({
  designFacetKey,
  content,
  itemRevision,
  onSave,
  placeholder,
}: {
  readonly designFacetKey: string;
  readonly content: string;
  readonly itemRevision: string;
  readonly onSave: FacetSaveFn;
  readonly placeholder?: string;
}) {
  const [value, setValue] = React.useState(content);
  const [revision, setRevision] = React.useState(itemRevision);
  const [status, setStatus] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);

  // 切换到另一个配置项（不同 designFacetKey）或外部刷新带来新内容时，同步本地态。
  React.useEffect(() => {
    setValue(content);
    setRevision(itemRevision);
    setStatus("idle");
    setError(null);
  }, [designFacetKey, content, itemRevision]);

  async function handleBlur(): Promise<void> {
    if (value === content) return; // 未改动，不发起写请求
    setStatus("saving");
    setError(null);
    try {
      const out = await onSave(designFacetKey, value, revision);
      setRevision(out.itemRevision);
      setStatus("saved");
    } catch (e) {
      setStatus("error");
      setError(describeSaveError(e));
    }
  }

  async function handleSaveClick(): Promise<void> {
    setStatus("saving");
    setError(null);
    try {
      const out = await onSave(designFacetKey, value, revision);
      setRevision(out.itemRevision);
      setStatus("saved");
    } catch (e) {
      setStatus("error");
      setError(describeSaveError(e));
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-border p-4" data-testid={`bp-facet-editor-${designFacetKey}`}>
      <div className="mb-2 flex items-center gap-1.5">
        <h3 className="text-13 font-semibold">内容</h3>
        <SaveStatusBadge status={status} />
        <button
          type="button"
          onClick={() => void handleSaveClick()}
          disabled={status === "saving"}
          className="rounded-md border border-border px-2 py-1 text-11 transition-colors hover:bg-muted"
          data-testid="bp-facet-save-button"
        >
          保存
        </button>
      </div>
      <Textarea
        className="min-h-24 w-full text-12"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void handleBlur()}
        placeholder={placeholder ?? "填写这一项的内容…"}
        data-testid={`bp-facet-content-${designFacetKey}`}
      />
      {error !== null && (
        <p role="alert" className="mt-1 text-11 text-destructive" data-testid={`bp-facet-error-${designFacetKey}`}>
          {error}
        </p>
      )}
    </div>
  );
}

function SaveStatusBadge({ status }: { status: "idle" | "saving" | "saved" | "error" }) {
  if (status === "idle") return null;
  const label = status === "saving" ? "保存中…" : status === "saved" ? "已保存" : "保存失败";
  return (
    <span
      className={cn(
        "text-11",
        status === "error" ? "text-destructive" : "text-muted-foreground",
      )}
      data-testid="bp-facet-save-status"
    >
      {label}
    </span>
  );
}

function describeSaveError(e: unknown): string {
  const reasonCode = (e as { reasonCode?: unknown } | null)?.reasonCode;
  if (reasonCode === "VERSION_CHANGED") {
    return "这一项已被别处改动，你的输入未保存——请刷新页面后重新填写";
  }
  if (typeof reasonCode === "string" && reasonCode.length > 0) return `保存失败（${reasonCode}）`;
  if (e instanceof Error) return e.message;
  return "保存失败，请重试";
}
