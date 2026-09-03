"use client";
import * as React from "react";
import { Input } from "@/components/ui/input";
import type { FacetSaveFn } from "./facet-content-editor";

/**
 * 「场地与形式」结构化编辑器（第 1 项，分组三）——`contract.md` 的 `VenueContent`
 * 字段提议落地成真实可编辑表单，替换该项此前的 `FacetTextEditor` 自由文本框。
 *
 * ⚠ 逐项对照 `apps/web/components/tpl/designer-panels.tsx` 的 `VenuePanel` 与
 * `apps/web/lib/mock/tpl.ts` 的 `VENUE_PANEL`：
 * - 「空间要求」是 5 行固定字段名（主场地/分组空间/墙面/屏幕/网络）+ 每行一段
 *   规格文本。`contract.md` 把 `SpaceRequirement.value` 标为 `unknown`（G2：输入
 *   形态未确认，不假设控件）——原型渲染的是纯文本规格串，因此本编辑器落成
 *   **单行文本输入**，与原型呈现一致，不发明下拉/数值控件。字段名恒定不可增删。
 * - 「形式差异」三张卡（混合/全线上/纯线下）是原型给定的固定对照说明，且原型把
 *   「本蓝本默认」那张高亮——本编辑器把「选哪种形式」做成真实可选的单选（这是
 *   蓝本该定的事），三张卡的 detail 文案沿用原型的固定说明，不做成可编辑字段。
 * - 「现场布置图」在原型里是示意性的分组圆圈 + 一句中央说明，`contract.md` 也标为
 *   可选示意——本编辑器展示为只读示意，不做图形编辑器。
 */

export const VENUE_SPACE_FIELDS = ["主场地", "分组空间", "墙面", "屏幕", "网络"] as const;
export type VenueSpaceField = (typeof VENUE_SPACE_FIELDS)[number];

const SPACE_PLACEHOLDERS: Record<VenueSpaceField, string> = {
  主场地: "可容 16 人 · 桌椅可移动",
  分组空间: "4 个角落或 2 个小会议室",
  墙面: "6 米可贴纸的墙 · 或 4 块移动白板",
  屏幕: "1 主屏 · 各组一台笔记本",
  网络: "≥ 5Mbps（远程组员接入）",
};

export const VENUE_FORMATS = [
  {
    key: "hybrid",
    label: "混合",
    detail: "线下分组，远程组员用手机进组。每组需一台设备开麦做转录。",
  },
  {
    key: "online",
    label: "全线上",
    detail: "自动增「破冰」「举手排队」两环节，打印素材整节自动跳过。",
  },
  {
    key: "offline",
    label: "纯线下",
    detail: "打印素材份数 ×1.2；需准备离线兜底（断网时本地采集队列）。",
  },
] as const;
export type VenueFormatKey = (typeof VENUE_FORMATS)[number]["key"];

const LAYOUT_GROUPS = ["第 1 组 · 圆桌 4 座", "第 2 组", "第 3 组", "第 4 组"] as const;
const LAYOUT_CENTER = "主屏与引导师站位 · 中央留 2 米走动空间";

export interface VenueContentValue {
  readonly space: Readonly<Record<string, string>>;
  readonly format: VenueFormatKey;
}

function emptyValue(): VenueContentValue {
  return { space: {}, format: "hybrid" };
}

export function parseVenueContent(content: string): VenueContentValue {
  if (content.trim() === "") return emptyValue();
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null) return emptyValue();
    const p = parsed as Partial<VenueContentValue>;
    const space: Record<string, string> = {};
    if (typeof p.space === "object" && p.space !== null) {
      for (const f of VENUE_SPACE_FIELDS) {
        const v = (p.space as Record<string, unknown>)[f];
        if (typeof v === "string") space[f] = v;
      }
    }
    return {
      space,
      format: VENUE_FORMATS.some((f) => f.key === p.format) ? (p.format as VenueFormatKey) : "hybrid",
    };
  } catch {
    return emptyValue();
  }
}

export function serializeVenueContent(value: VenueContentValue): string {
  const allEmpty = VENUE_SPACE_FIELDS.every((f) => (value.space[f] ?? "").trim() === "");
  return allEmpty ? "" : JSON.stringify(value);
}

export function VenuePanelEditor({
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
  const [value, setValue] = React.useState<VenueContentValue>(() => parseVenueContent(content));
  const [revision, setRevision] = React.useState(itemRevision);
  const [status, setStatus] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setValue(parseVenueContent(content));
    setRevision(itemRevision);
    setStatus("idle");
    setError(null);
  }, [designFacetKey, content, itemRevision]);

  async function persist(next: VenueContentValue): Promise<void> {
    setStatus("saving");
    setError(null);
    try {
      const out = await onSave(designFacetKey, serializeVenueContent(next), revision);
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

  function updateSpace(field: VenueSpaceField, text: string): void {
    setValue((v) => ({ ...v, space: { ...v.space, [field]: text } }));
  }

  function setFormat(key: VenueFormatKey): void {
    const next = { ...value, format: key };
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
        <button
          type="button"
          onClick={() => void persist(value)}
          disabled={status === "saving"}
          className="rounded-md border border-border px-2 py-1 text-11 transition-colors hover:bg-muted"
          data-testid="bp-facet-save-button"
        >
          保存
        </button>
      </div>

      <div className="mb-4 rounded-lg border border-border p-4" data-testid="bp-venue-space">
        <h3 className="mb-2 text-13 font-semibold">空间要求（套用时直接变成待办）</h3>
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {VENUE_SPACE_FIELDS.map((f) => (
            <li key={f} className="flex items-center gap-2 p-2.5" data-testid={`bp-venue-space-row-${f}`}>
              <span className="w-24 shrink-0 text-12 font-medium">{f}</span>
              <Input
                type="text"
                className="flex-1 text-11"
                value={value.space[f] ?? ""}
                onChange={(e) => updateSpace(f, e.target.value)}
                onBlur={() => void persist(value)}
                placeholder={SPACE_PLACEHOLDERS[f]}
                data-testid={`bp-venue-space-${f}`}
              />
            </li>
          ))}
        </ul>
      </div>

      <div className="mb-4 rounded-lg border border-border p-4" data-testid="bp-venue-formats">
        <h3 className="mb-2 text-13 font-semibold">形式差异（选一种作为本蓝本默认）</h3>
        <div className="flex flex-col gap-2">
          {VENUE_FORMATS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFormat(f.key)}
              aria-pressed={value.format === f.key}
              className={
                value.format === f.key
                  ? "rounded-md border border-primary bg-accent p-2.5 text-left transition-colors"
                  : "rounded-md border border-border p-2.5 text-left transition-colors hover:bg-muted"
              }
              data-testid={`bp-venue-format-${f.key}`}
            >
              <p className="text-12 font-medium">
                {f.label}
                {value.format === f.key ? " · 本蓝本默认" : ""}
              </p>
              <p className="text-11 text-muted-foreground">{f.detail}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 rounded-lg border border-border p-4" data-testid="bp-venue-layout">
        <h3 className="mb-2 text-13 font-semibold">现场布置图（套用时作为一张图发给场地方）</h3>
        <div className="grid grid-cols-2 gap-2 rounded-md border border-dashed border-border p-3">
          {LAYOUT_GROUPS.map((g) => (
            <div
              key={g}
              className="flex h-14 items-center justify-center rounded-full border border-border bg-panel text-11 text-muted-foreground"
              data-testid="bp-venue-layout-group"
            >
              {g}
            </div>
          ))}
        </div>
        <p className="mt-1.5 text-11 text-muted-foreground">{LAYOUT_CENTER}</p>
      </div>

      {error !== null && (
        <p role="alert" className="text-11 text-destructive" data-testid={`bp-facet-error-${designFacetKey}`}>
          {error}
        </p>
      )}
    </div>
  );
}
