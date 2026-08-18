"use client";
import * as React from "react";
import type { FacetSaveFn } from "./facet-content-editor";

/**
 * 「组内能力」结构化编辑器（第 4 项，分组三）——替换该项此前的 `FacetTextEditor`。
 *
 * ⚠ 逐项对照 `apps/web/components/tpl/designer-panels.tsx` 的 `CapsPanel` 与
 * `apps/web/lib/mock/tpl.ts` 的 `CAPS_PANEL`，三节结构完整保留：
 * - **组员用它做什么**：7 项能力恒定（原型的 `caps` 是固定能力清单，不是用户可
 *   增删的自由列表——它对应产品真实存在的能力集），每项只有「开 / 关」状态与
 *   一段用途说明可配；「与 AI 的对话」原型标为「开 · 必留」，即恒开不可关，本
 *   编辑器把它的开关禁用并标注必留，与原型语义一致。
 * - **产出回流**：三条固定映射（能力 → 落到哪），原型是静态说明，不可编辑。
 * - **可见性**：三行固定（组员/引导师/观察者各自看得到与看不到什么），原型是
 *   静态说明，不可编辑——这是权限硬约束的投影，不是蓝本可配置项。
 */

interface CapDef {
  readonly name: string;
  readonly defaultOn: boolean;
  readonly mustKeep: boolean;
  readonly usePlaceholder: string;
  /**
   * 原型 `CAPS_PANEL.caps[].state` 里跟在「开/关」后面的那半句限定语
   * （「· 必留」「· 两天档才开」）。它不是装饰：「关」和「关 · 两天档才开」
   * 对方法负责人是两件事——后者是在说"这一档不开、换个档位会开"，
   * 丢了它就变成一个没有理由的关闭开关。
   */
  readonly stateQualifier: string | null;
}

export const GROUP_CAPABILITIES: readonly CapDef[] = [
  { name: "与 AI 的对话", defaultOn: true, mustKeep: true, usePlaceholder: "本组共享推演，组员私聊汇总在这", stateQualifier: "必留" },
  { name: "用户访谈", defaultOn: true, mustKeep: false, usePlaceholder: "访谈 AI 代跑并回流转写", stateQualifier: null },
  { name: "深度研究", defaultOn: true, mustKeep: false, usePlaceholder: "带出处的分路检索", stateQualifier: null },
  { name: "用户研究", defaultOn: false, mustKeep: false, usePlaceholder: "概念测试与可用性回合", stateQualifier: "两天档才开" },
  { name: "画布便签", defaultOn: true, mustKeep: false, usePlaceholder: "本组假设树与证据卡", stateQualifier: null },
  { name: "组内投票", defaultOn: true, mustKeep: false, usePlaceholder: "收敛用，结果回主持台", stateQualifier: null },
  { name: "证据检索", defaultOn: true, mustKeep: false, usePlaceholder: "从洞察库与转写里取证", stateQualifier: null },
];

const REFLOW = [
  { cap: "画布节点与证据卡", to: "成果沉淀的产出清单" },
  { cap: "投票结果", to: "主持台，作为切环节的依据" },
  { cap: "访谈转写与研究报告", to: "洞察库，下一场可复用" },
] as const;

const VISIBILITY = [
  { who: "组员", canSee: "本组全部 · 自己的私聊", cannot: "别组内容 · 别组私聊" },
  { who: "引导师", canSee: "所有组 · 所有对话", cannot: "组员私聊" },
  { who: "观察者", canSee: "已发布产出与脱敏聚合", cannot: "原始转写与私聊" },
] as const;

export interface CapsContentValue {
  /** capName → 是否开启；缺省时用 `GROUP_CAPABILITIES[].defaultOn`。 */
  readonly enabled: Readonly<Record<string, boolean>>;
  /** capName → 用途说明；缺省时留空（展示 placeholder）。 */
  readonly uses: Readonly<Record<string, string>>;
}

function emptyValue(): CapsContentValue {
  return { enabled: {}, uses: {} };
}

export function parseCapsContent(content: string): CapsContentValue {
  if (content.trim() === "") return emptyValue();
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null) return emptyValue();
    const p = parsed as Partial<CapsContentValue>;
    const enabled: Record<string, boolean> = {};
    const uses: Record<string, string> = {};
    for (const c of GROUP_CAPABILITIES) {
      const e = (p.enabled as Record<string, unknown> | undefined)?.[c.name];
      if (typeof e === "boolean") enabled[c.name] = e;
      const u = (p.uses as Record<string, unknown> | undefined)?.[c.name];
      if (typeof u === "string") uses[c.name] = u;
    }
    return { enabled, uses };
  } catch {
    return emptyValue();
  }
}

export function serializeCapsContent(value: CapsContentValue): string {
  const noOverride = Object.keys(value.enabled).length === 0;
  const noUses = GROUP_CAPABILITIES.every((c) => (value.uses[c.name] ?? "").trim() === "");
  return noOverride && noUses ? "" : JSON.stringify(value);
}

function isOn(value: CapsContentValue, cap: CapDef): boolean {
  if (cap.mustKeep) return true; // 必留项恒开，存的值不能把它关掉
  return value.enabled[cap.name] ?? cap.defaultOn;
}

export function CapsPanelEditor({
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
  const [value, setValue] = React.useState<CapsContentValue>(() => parseCapsContent(content));
  const [revision, setRevision] = React.useState(itemRevision);
  const [status, setStatus] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setValue(parseCapsContent(content));
    setRevision(itemRevision);
    setStatus("idle");
    setError(null);
  }, [designFacetKey, content, itemRevision]);

  async function persist(next: CapsContentValue): Promise<void> {
    setStatus("saving");
    setError(null);
    try {
      const out = await onSave(designFacetKey, serializeCapsContent(next), revision);
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

  function toggleCap(cap: CapDef): void {
    if (cap.mustKeep) return; // 必留项禁用，点击不生效（同 disabled 语义）
    const next = { ...value, enabled: { ...value.enabled, [cap.name]: !isOn(value, cap) } };
    setValue(next);
    void persist(next);
  }

  function updateUse(capName: string, text: string): void {
    setValue((v) => ({ ...v, uses: { ...v.uses, [capName]: text } }));
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

      <div className="mb-4 rounded-lg border border-border p-4" data-testid="bp-caps-list">
        <h3 className="mb-2 text-13 font-semibold">组员用它做什么（套用后每组左栏就是这一列）</h3>
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {GROUP_CAPABILITIES.map((c) => {
            const on = isOn(value, c);
            return (
              <li key={c.name} className="flex items-center gap-2 p-2.5" data-testid={`bp-caps-item-${c.name}`}>
                <label className="flex w-32 shrink-0 items-center gap-1.5 text-12 font-medium">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={c.mustKeep}
                    onChange={() => toggleCap(c)}
                    aria-label={`${c.name}${c.mustKeep ? "（必留）" : ""}`}
                    data-testid={`bp-caps-toggle-${c.name}`}
                    className={c.mustKeep ? "cursor-not-allowed opacity-50" : undefined}
                  />
                  {c.name}
                </label>
                <input
                  type="text"
                  className="flex-1 rounded-md border border-border bg-background p-1 text-11 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={value.uses[c.name] ?? ""}
                  onChange={(e) => updateUse(c.name, e.target.value)}
                  onBlur={() => void persist(value)}
                  placeholder={c.usePlaceholder}
                  data-testid={`bp-caps-use-${c.name}`}
                />
                <span
                  className="shrink-0 rounded border border-border px-1.5 py-0.5 text-11 text-muted-foreground"
                  data-testid={`bp-caps-state-${c.name}`}
                >
                  {`${on ? "开" : "关"}${c.stateQualifier === null ? "" : ` · ${c.stateQualifier}`}`}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mb-4 rounded-lg border border-border p-4" data-testid="bp-caps-reflow">
        <h3 className="mb-2 text-13 font-semibold">产出回流（组内每种能力产出落到哪）</h3>
        <ul className="flex flex-col gap-1.5">
          {REFLOW.map((r) => (
            <li key={r.cap} className="flex items-center gap-2 text-12" data-testid="bp-caps-reflow-item">
              <span className="font-medium">{r.cap}</span>
              <span aria-hidden className="text-muted-foreground">
                ›
              </span>
              <span className="text-muted-foreground">{r.to}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mb-4 rounded-lg border border-border p-4" data-testid="bp-caps-visibility">
        <h3 className="mb-2 text-13 font-semibold">可见性（谁能看到组内的哪些内容）</h3>
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {VISIBILITY.map((v) => (
            <li
              key={v.who}
              className="flex flex-col gap-0.5 p-2.5 sm:flex-row sm:items-center sm:gap-2"
              data-testid="bp-caps-vis-row"
            >
              <span className="w-20 shrink-0 text-12 font-medium">{v.who}</span>
              <span className="flex-1 text-11 text-success">看得到：{v.canSee}</span>
              <span className="flex-1 text-11 text-muted-foreground">看不到：{v.cannot}</span>
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
