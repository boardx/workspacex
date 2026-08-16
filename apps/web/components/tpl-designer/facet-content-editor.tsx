"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * 蓝本设计器**真实**可编辑面板（解开 D-05 二级 sign-off 之后的第一个实现增量）。
 *
 * ## 为什么是一个通用文本编辑器，不是 16 份各自的结构化表单
 *
 * `updateDesignFacet` 契约今天的 `content` 字段是**不透明字符串**（BP-02/F174 签核形状，
 * `design-deltas/blueprint-design-facet-panels/` 明确"本变更不改动任何已签核契约操作的形状"）。
 * `contract.md` 给出的 16 份结构化提议是**未来**把这个字符串升级成结构化 JSON 时的参考，
 * 不是这一轮的交付物——先把"能不能真编辑、真保存、真联动完成度"这条主链路做对，
 * 比一次性造 16 份结构化表单更快落地、风险更小（单一组件，测试面窄，行为一致）。
 * 第 4 项"角色与权限"的权限矩阵是**例外**：人类已明确裁决其交互形状（灰格只读/其余可勾选），
 * 属于签核过的具体交互，因此单独给它一个结构化组件（见下方 `PermissionMatrixEditor`）。
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

  return (
    <div className="mb-4 rounded-lg border border-border p-4" data-testid={`bp-facet-editor-${designFacetKey}`}>
      <div className="mb-2 flex items-center gap-1.5">
        <h3 className="text-13 font-semibold">内容</h3>
        <SaveStatusBadge status={status} />
      </div>
      <textarea
        className="min-h-24 w-full rounded-md border border-border bg-background p-2 text-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

/* ══════════════════════════════════════════════════════════════════════════
 * 「角色与权限」权限矩阵 —— 人类已裁决的交互（design-deltas/blueprint-design-facet-panels/）：
 * 灰色格子只读（产品硬约束，界面禁用不可点击），其余格子可勾选，方法负责人可自由配置默认值。
 *
 * ⚠ **哪些 (capability, role) 组合恒为灰色，contract.md 明确登记为待实现前走查确认的缺口**
 * （原型静态 HTML 抽取看不到交互态）。下面 `LOCKED_CELLS` 是一份**保守的临时默认值**——
 * 不是签核过的产品数据，是让"灰格禁用/其余可勾选"这条交互能先跑起来的占位判断：
 *   · "看已发布结论"对引导/组长恒可见（职责需要）——设为只读+恒真。
 *   · "改议程"对组员/观察者恒不可开——设为只读+恒假（防止越权改动主持权）。
 * 其余 18 格默认可勾选，初始值全 false（未配置态）。
 * 真正的产品级灰格清单需要人类原型走查后来替换这份默认值，替换处只有这一个数组，
 * 不散落在别处（同 `design-facet-table.ts` 的单一事实源纪律）。
 * ══════════════════════════════════════════════════════════════════════════ */

export const PERMISSION_CAPABILITIES = [
  "改议程",
  "写本组画布",
  "提交本组产出",
  "看别组过程",
  "看已发布结论",
] as const;
export type PermissionCapability = (typeof PERMISSION_CAPABILITIES)[number];

export const PERMISSION_ROLES = ["引导", "组长", "组员", "观察者"] as const;
export type PermissionRole = (typeof PERMISSION_ROLES)[number];

/** key = `${capability}::${role}`。⚠ 临时默认值，见上方长注——待人类产品走查后替换。 */
const LOCKED_CELLS: Record<string, boolean> = {
  "看已发布结论::引导": true,
  "看已发布结论::组长": true,
  "改议程::组员": false,
  "改议程::观察者": false,
};

export interface PermissionMatrixValue {
  readonly [cellKey: string]: boolean;
}

function cellKey(capability: PermissionCapability, role: PermissionRole): string {
  return `${capability}::${role}`;
}

/** 把矩阵值序列化成一段可存进 `content: string` 的文本（JSON），供 `updateDesignFacet` 使用。 */
export function serializePermissionMatrix(value: PermissionMatrixValue): string {
  return JSON.stringify(value);
}

/** 反序列化；空串/坏数据一律回退成"全未配置"（不抛错——不能因为一条坏数据把整个面板打崩）。 */
export function parsePermissionMatrix(content: string): PermissionMatrixValue {
  if (content.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed === "object" && parsed !== null) return parsed as PermissionMatrixValue;
    return {};
  } catch {
    return {};
  }
}

export function PermissionMatrixEditor({
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
  const [matrix, setMatrix] = React.useState<PermissionMatrixValue>(() => parsePermissionMatrix(content));
  const [revision, setRevision] = React.useState(itemRevision);
  const [status, setStatus] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setMatrix(parsePermissionMatrix(content));
    setRevision(itemRevision);
    setStatus("idle");
    setError(null);
  }, [designFacetKey, content, itemRevision]);

  async function toggle(capability: PermissionCapability, role: PermissionRole): Promise<void> {
    const key = cellKey(capability, role);
    if (key in LOCKED_CELLS) return; // 灰色只读格：界面上禁用，点击直接不生效（同 disabled 语义）
    const next = { ...matrix, [key]: !matrix[key] };
    setMatrix(next);
    setStatus("saving");
    setError(null);
    try {
      const out = await onSave(designFacetKey, serializePermissionMatrix(next), revision);
      setRevision(out.itemRevision);
      setStatus("saved");
    } catch (e) {
      setMatrix(matrix); // 回滚本地乐观更新
      setStatus("error");
      setError(describeSaveError(e));
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-border p-4" data-testid={`bp-facet-editor-${designFacetKey}`}>
      <div className="mb-2 flex items-center gap-1.5">
        <h3 className="text-13 font-semibold">角色权限默认值矩阵</h3>
        <SaveStatusBadge status={status} />
      </div>
      <p className="mb-2 text-11 text-muted-foreground" data-testid="bp-permission-matrix-note">
        灰色格子不可在蓝本里放开——它们是产品的硬约束，不是默认值。其余格子可勾选，作为方法负责人可配置的默认值。
      </p>
      <table className="w-full border-collapse text-12" data-testid="bp-permission-matrix">
        <thead>
          <tr>
            <th className="p-1.5 text-left text-11 font-medium text-muted-foreground">能力 \ 角色</th>
            {PERMISSION_ROLES.map((role) => (
              <th key={role} className="p-1.5 text-center text-11 font-medium text-muted-foreground">{role}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PERMISSION_CAPABILITIES.map((capability) => (
            <tr key={capability} className="border-t border-border">
              <td className="p-1.5 text-12">{capability}</td>
              {PERMISSION_ROLES.map((role) => {
                const key = cellKey(capability, role);
                const locked = key in LOCKED_CELLS;
                const checked = locked ? LOCKED_CELLS[key]! : (matrix[key] ?? false);
                return (
                  <td key={role} className="p-1.5 text-center">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={locked}
                      onChange={() => void toggle(capability, role)}
                      aria-label={`${capability} · ${role}`}
                      data-testid={`bp-permission-cell-${capability}-${role}`}
                      className={cn(locked && "cursor-not-allowed opacity-50")}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {error !== null && (
        <p role="alert" className="mt-2 text-11 text-destructive" data-testid={`bp-facet-error-${designFacetKey}`}>
          {error}
        </p>
      )}
    </div>
  );
}
