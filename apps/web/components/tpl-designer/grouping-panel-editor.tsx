"use client";
import * as React from "react";
import type { FacetSaveFn } from "./facet-content-editor";

/**
 * 「分组规则」结构化编辑器（第 3 项，分组一）——`design-deltas/
 * blueprint-design-facet-panels/contract.md` 的 `GroupingRuleContent` 字段提议
 * 落地成真实可编辑表单，替换该项此前统一使用的 `FacetTextEditor` 自由文本框（同
 * `topic-panel-editor.tsx`/F194 的先例）。
 *
 * ⚠ 逐项对照 `apps/web/components/tpl/designer-panels.tsx` 的 `GroupingPanel`
 * 与 `apps/web/lib/mock/tpl.ts` 的 `GROUPING_PANEL`（2026-08-17 人类第二次强化
 * 指令后重做）——布局、字段名、固定 vs 可填的边界都以这两处为准，不是照
 * `contract.md` 的字段列表自行设计。
 *
 * ## 固定 vs 可填
 *
 * `sizingRules`（3 档规模卡片 + `sizingNote`）与 `assignRules`（5 条固定分配
 * 规则的静态参考清单）是**结构性事实**（原型逐字抽取，不是可配置项）。真正可
 * 编辑的只有**场景清单**（长度不固定，用户增删）——每行 `name`/`ask`/`leadProfile`
 * 三个字段，对应原型「场景名 / 这组要回答什么 / 组长画像」。
 */

const SIZING_RULES = [
  { range: "12–16 人", groups: "4 组 · 默认", per: "每组 3 人" },
  { range: "≤ 11 人", groups: "3 组", per: "每组 2–4 人" },
  { range: "≥ 18 人", groups: "6 组", per: "加一名协同引导师" },
] as const;

const SIZING_NOTE = "低于 2 人合并；每组一路录音；缺人现场可调";

const ASSIGN_RULES = [
  "套用时 AI 先给一版，引导师拖拽调整",
  "组长默认取该场景画像匹配度最高的人，可一键换",
  "按背景均衡：同部门的人尽量不在同一组",
  "每组带一张观察/访谈对象表（对象、部门、联系方式、背景、方式）",
  "缺人时在分组卡片上标红，并给出需要什么背景的人",
] as const;

export interface GroupScenario {
  readonly name: string;
  readonly ask: string;
  readonly leadProfile: string;
}

export interface GroupingContentValue {
  readonly scenarios: readonly GroupScenario[];
}

function emptyValue(): GroupingContentValue {
  return { scenarios: [] };
}

export function parseGroupingContent(content: string): GroupingContentValue {
  if (content.trim() === "") return emptyValue();
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null) return emptyValue();
    const p = parsed as Partial<GroupingContentValue>;
    return {
      scenarios: Array.isArray(p.scenarios)
        ? p.scenarios.filter(
            (s): s is GroupScenario =>
              typeof s === "object" && s !== null && typeof (s as GroupScenario).name === "string",
          )
        : [],
    };
  } catch {
    return emptyValue();
  }
}

export function serializeGroupingContent(value: GroupingContentValue): string {
  const isEmpty = value.scenarios.length === 0;
  return isEmpty ? "" : JSON.stringify(value);
}

export function GroupingPanelEditor({
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
  const [value, setValue] = React.useState<GroupingContentValue>(() => parseGroupingContent(content));
  const [revision, setRevision] = React.useState(itemRevision);
  const [status, setStatus] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setValue(parseGroupingContent(content));
    setRevision(itemRevision);
    setStatus("idle");
    setError(null);
  }, [designFacetKey, content, itemRevision]);

  async function persist(next: GroupingContentValue): Promise<void> {
    setStatus("saving");
    setError(null);
    try {
      const out = await onSave(designFacetKey, serializeGroupingContent(next), revision);
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

  function addScenario(): void {
    setValue((v) => ({
      ...v,
      scenarios: [...v.scenarios, { name: "", ask: "", leadProfile: "" }],
    }));
  }

  function updateScenario(index: number, patch: Partial<GroupScenario>): void {
    setValue((v) => ({
      ...v,
      scenarios: v.scenarios.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    }));
  }

  function removeScenario(index: number): void {
    const next = { ...value, scenarios: value.scenarios.filter((_, i) => i !== index) };
    setValue(next);
    void persist(next); // 删除立即保存——不像文本输入等 blur，删除是一次离散动作
  }

  return (
    <div data-testid={`bp-facet-editor-${designFacetKey}`}>
      <div className="mb-4 rounded-lg border border-border p-4" data-testid="bp-grouping-sizing">
        <div className="mb-2 flex items-center gap-1.5">
          <h3 className="text-13 font-semibold">按人数自动落到组数</h3>
          {status !== "idle" && (
            <span
              className={status === "error" ? "text-11 text-destructive" : "text-11 text-muted-foreground"}
              data-testid="bp-facet-save-status"
            >
              {status === "saving" ? "保存中…" : status === "saved" ? "已保存" : "保存失败"}
            </span>
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {SIZING_RULES.map((r) => (
            <div key={r.range} className="rounded-md border border-border p-2.5" data-testid="bp-grouping-sizing-row">
              <p className="text-12 font-medium">{r.range}</p>
              <p className="text-11 text-muted-foreground">
                {r.groups} · {r.per}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-1.5 text-11 text-muted-foreground">{SIZING_NOTE}</p>
      </div>

      <div className="mb-4 rounded-lg border border-border p-4" data-testid="bp-grouping-scenarios">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-13 font-semibold">场景清单（每组认领一个，套用时可增删改）</h3>
          <span className="rounded border border-border px-1.5 py-0.5 text-11 text-muted-foreground">最值钱的部分</span>
        </div>
        {value.scenarios.length === 0 ? (
          <p className="text-11 text-muted-foreground" data-testid="bp-grouping-scenarios-empty">
            还没有场景——点「＋ 场景」新增。
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {value.scenarios.map((s, i) => (
              <li key={i} className="flex flex-col gap-1 p-2.5" data-testid="bp-grouping-scenario-row">
                <div className="flex items-center gap-1.5">
                  <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-11 text-muted-foreground">
                    第 {i + 1} 组
                  </span>
                  <input
                    type="text"
                    className="flex-1 rounded-md border border-border bg-background p-1.5 text-12 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={s.name}
                    onChange={(e) => updateScenario(i, { name: e.target.value })}
                    onBlur={() => void persist(value)}
                    placeholder="场景名（如「业主首次评估」）"
                    data-testid={`bp-grouping-scenario-name-${i}`}
                  />
                  <button
                    type="button"
                    onClick={() => removeScenario(i)}
                    className="shrink-0 rounded-md border border-border px-2 py-1 text-11 text-destructive transition-colors hover:bg-muted"
                    data-testid={`bp-grouping-scenario-remove-${i}`}
                  >
                    删除
                  </button>
                </div>
                <input
                  type="text"
                  className="w-full rounded-md border border-border bg-background p-1.5 text-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={s.ask}
                  onChange={(e) => updateScenario(i, { ask: e.target.value })}
                  onBlur={() => void persist(value)}
                  placeholder="这组要回答什么"
                  data-testid={`bp-grouping-scenario-question-${i}`}
                />
                <input
                  type="text"
                  className="w-full rounded-md border border-dashed border-border bg-background p-1.5 text-11 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={s.leadProfile}
                  onChange={(e) => updateScenario(i, { leadProfile: e.target.value })}
                  onBlur={() => void persist(value)}
                  placeholder="组长画像（可选）"
                  data-testid={`bp-grouping-scenario-leader-${i}`}
                />
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={addScenario}
          className="mt-2 rounded-md border border-border px-2 py-1 text-11 transition-colors hover:bg-muted"
          data-testid="bp-grouping-add-scenario"
        >
          ＋ 场景
        </button>
      </div>

      <div className="mb-4 rounded-lg border border-border p-4" data-testid="bp-grouping-assign-rules">
        <h3 className="mb-2 text-13 font-semibold">组长与成员分配（套用时 AI 先给一版，引导师拖拽调整）</h3>
        <ul className="flex flex-col gap-1.5">
          {ASSIGN_RULES.map((r) => (
            <li key={r} className="flex items-start gap-2 text-12 text-muted-foreground" data-testid="bp-grouping-assign-rule">
              <span aria-hidden className="mt-0.5">✓</span>
              {r}
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
