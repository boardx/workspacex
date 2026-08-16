"use client";
import * as React from "react";
import type { FacetSaveFn } from "./facet-content-editor";

/**
 * 「分组规则」结构化编辑器（第 3 项，分组一）——`design-deltas/
 * blueprint-design-facet-panels/contract.md` 的 `GroupingRuleContent` 字段提议
 * 落地成真实可编辑表单，替换该项此前统一使用的 `FacetTextEditor` 自由文本框（同
 * `topic-panel-editor.tsx`/F194 的先例）。
 *
 * ⚠ 与「角色与权限」（G1，草稿问题 2）的已知内容重叠**未裁决**——本编辑器只按
 * `contract.md` 现有的字段提议实现，不预判合并结果、不擅自去掉任何一侧的字段。
 *
 * ## 固定 vs 可填
 *
 * `sizePresets`（3 个预设规模卡片）与 `rules`（4 条固定规则标签）是**结构性事实**
 * （草稿逐字抽取自原型），本编辑器展示为只读参考。真正可编辑的是**场景清单**
 * （长度不固定，用户增删）与**组长产生方式**两个布尔开关。
 */

const SIZE_PRESETS = [
  { groupCount: "4 组", membersPerGroup: "每组 3 人", usageHint: "12–16 人时用（默认）" },
  { groupCount: "3 组", membersPerGroup: "每组 3–4 人", usageHint: "9–11 人时用" },
  { groupCount: "6 组", membersPerGroup: "每组 3 人", usageHint: "18 人以上，加一名协同引导师" },
] as const;

const GROUPING_RULES = ["每组 2–4 人", "低于 2 人合并", "每组一路录音", "缺人现场可调"] as const;

export interface GroupScenario {
  readonly scenario: string;
  readonly whatToAnswer: string;
  readonly defaultLeaderProfile: string;
}

export interface GroupingContentValue {
  readonly scenarios: readonly GroupScenario[];
  readonly autoMatchByProfile: boolean;
  readonly balanceByBackground: boolean;
}

function emptyValue(): GroupingContentValue {
  return { scenarios: [], autoMatchByProfile: true, balanceByBackground: true };
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
              typeof s === "object" && s !== null && typeof (s as GroupScenario).scenario === "string",
          )
        : [],
      autoMatchByProfile: typeof p.autoMatchByProfile === "boolean" ? p.autoMatchByProfile : true,
      balanceByBackground: typeof p.balanceByBackground === "boolean" ? p.balanceByBackground : true,
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
      scenarios: [...v.scenarios, { scenario: "", whatToAnswer: "", defaultLeaderProfile: "" }],
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

  function toggle(key: "autoMatchByProfile" | "balanceByBackground"): void {
    const next = { ...value, [key]: !value[key] };
    setValue(next);
    void persist(next);
  }

  return (
    <div data-testid={`bp-facet-editor-${designFacetKey}`}>
      <div className="mb-4 rounded-lg border border-border p-4" data-testid="bp-grouping-presets">
        <div className="mb-2 flex items-center gap-1.5">
          <h3 className="text-13 font-semibold">规模</h3>
          {status !== "idle" && (
            <span
              className={status === "error" ? "text-11 text-destructive" : "text-11 text-muted-foreground"}
              data-testid="bp-facet-save-status"
            >
              {status === "saving" ? "保存中…" : status === "saved" ? "已保存" : "保存失败"}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {SIZE_PRESETS.map((p) => (
            <div key={p.groupCount} className="rounded-md border border-border p-2 text-12">
              <p className="font-medium">
                {p.groupCount} · {p.membersPerGroup}
              </p>
              <p className="text-11 text-muted-foreground">{p.usageHint}</p>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {GROUPING_RULES.map((r) => (
            <span key={r} className="rounded border border-border px-1.5 py-0.5 text-11 text-muted-foreground">
              {r}
            </span>
          ))}
        </div>
      </div>

      <div className="mb-4 rounded-lg border border-border p-4" data-testid="bp-grouping-scenarios">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-13 font-semibold">场景清单</h3>
          <button
            type="button"
            onClick={addScenario}
            className="rounded-md border border-border px-2 py-1 text-11 transition-colors hover:bg-muted"
            data-testid="bp-grouping-add-scenario"
          >
            ＋ 加场景
          </button>
        </div>
        {value.scenarios.length === 0 ? (
          <p className="text-11 text-muted-foreground" data-testid="bp-grouping-scenarios-empty">
            还没有场景——点「＋ 加场景」新增。
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {value.scenarios.map((s, i) => (
              <li key={i} className="flex flex-col gap-1 rounded-md border border-border p-2" data-testid="bp-grouping-scenario-row">
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    className="flex-1 rounded-md border border-border bg-background p-1.5 text-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={s.scenario}
                    onChange={(e) => updateScenario(i, { scenario: e.target.value })}
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
                  value={s.whatToAnswer}
                  onChange={(e) => updateScenario(i, { whatToAnswer: e.target.value })}
                  onBlur={() => void persist(value)}
                  placeholder="这组要回答什么"
                  data-testid={`bp-grouping-scenario-question-${i}`}
                />
                <input
                  type="text"
                  className="w-full rounded-md border border-dashed border-border bg-background p-1.5 text-11 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={s.defaultLeaderProfile}
                  onChange={(e) => updateScenario(i, { defaultLeaderProfile: e.target.value })}
                  onBlur={() => void persist(value)}
                  placeholder="默认组长画像（可选）"
                  data-testid={`bp-grouping-scenario-leader-${i}`}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mb-4 rounded-lg border border-border p-4" data-testid="bp-grouping-leader-assignment">
        <h3 className="mb-2 text-13 font-semibold">组长与成员分配</h3>
        <label className="mb-1.5 flex items-center gap-2 text-12">
          <input
            type="checkbox"
            checked={value.autoMatchByProfile}
            onChange={() => toggle("autoMatchByProfile")}
            data-testid="bp-grouping-auto-match"
          />
          组长默认取场景画像匹配度最高的人（可一键换）
        </label>
        <label className="flex items-center gap-2 text-12">
          <input
            type="checkbox"
            checked={value.balanceByBackground}
            onChange={() => toggle("balanceByBackground")}
            data-testid="bp-grouping-balance-background"
          />
          按背景均衡（同部门不同组）
        </label>
      </div>

      {error !== null && (
        <p role="alert" className="text-11 text-destructive" data-testid={`bp-facet-error-${designFacetKey}`}>
          {error}
        </p>
      )}
    </div>
  );
}
