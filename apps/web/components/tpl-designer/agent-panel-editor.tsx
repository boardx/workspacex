"use client";
import * as React from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { FacetSaveFn } from "./facet-content-editor";

/**
 * 「Agent 编排」结构化编辑器（第 1 项，分组四）——替换该项此前的 `FacetTextEditor`。
 *
 * ⚠ 逐项对照 `apps/web/components/tpl/designer-panels.tsx` 的 `AgentPanel` 与
 * `apps/web/lib/mock/tpl.ts` 的 `AGENT_PANEL`，三节结构完整保留：
 * - **在场 agent**：每行是 agent 名 / 在场环节 / 做什么 / 是否可主动发言 / 状态。
 *   原型的 `state` 只有「默认开」「按需召唤 · 仅被召唤时」两类语义，做成单选。
 *   agent 行可增删（不同蓝本编排不同 agent 组合，这是蓝本该定的事）。
 * - **介入尺度**：`threshold` 是可配的数值（原型："提议收敛的触发阈值：重复 5 次"），
 *   `history` 是 AI 给的阈值历史说明卡（原型渲染成 AiNote，只读），`rules` 是三条
 *   固定行为约束（原型为静态 ✓ 清单，不可编辑）。
 * - **不可放开的硬约束**：四条产品级硬约束，原型用 Lock 图标渲染成只读清单——
 *   它们不是蓝本可配置项，本编辑器保持只读，不给任何开关。
 */

export const AGENT_STATES = ["默认开", "按需召唤"] as const;
export type AgentState = (typeof AGENT_STATES)[number];

const THRESHOLD_HISTORY =
  "曾因阈值过低被 9 位主持人反馈「打断太早」，已从 3 次提到 5 次";

const INTERVENTION_RULES = [
  "提议前先私下问引导师，不当众打断",
  "画布上可直接落笔（改动带 AI 署名）",
  "不可自动发起投票",
] as const;

const HARD_LIMITS = [
  "AI 不能写决策 —— 拍板栏只能是人名",
  "AI 不能替组长提交产出",
  "agent 互相调用必须留痕，不能私下接力",
  "个人层内容永不进 agent 上下文",
] as const;

export interface AgentRowDraft {
  readonly name: string;
  readonly segs: string;
  readonly does: string;
  readonly canSpeak: boolean;
  readonly state: AgentState;
}

export interface AgentContentValue {
  readonly agents: readonly AgentRowDraft[];
  readonly repeatThreshold: number;
}

function emptyAgent(): AgentRowDraft {
  return { name: "", segs: "", does: "", canSpeak: false, state: "默认开" };
}

function emptyValue(): AgentContentValue {
  return { agents: [], repeatThreshold: 5 };
}

export function parseAgentContent(content: string): AgentContentValue {
  if (content.trim() === "") return emptyValue();
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null) return emptyValue();
    const p = parsed as Partial<AgentContentValue>;
    return {
      agents: Array.isArray(p.agents)
        ? p.agents.map((a: Partial<AgentRowDraft>) => ({
            name: typeof a?.name === "string" ? a.name : "",
            segs: typeof a?.segs === "string" ? a.segs : "",
            does: typeof a?.does === "string" ? a.does : "",
            canSpeak: typeof a?.canSpeak === "boolean" ? a.canSpeak : false,
            state: AGENT_STATES.includes(a?.state as never) ? (a.state as AgentState) : "默认开",
          }))
        : [],
      repeatThreshold:
        typeof p.repeatThreshold === "number" && p.repeatThreshold > 0 ? p.repeatThreshold : 5,
    };
  } catch {
    return emptyValue();
  }
}

export function serializeAgentContent(value: AgentContentValue): string {
  return value.agents.length === 0 ? "" : JSON.stringify(value);
}

export function AgentPanelEditor({
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
  const [value, setValue] = React.useState<AgentContentValue>(() => parseAgentContent(content));
  const [revision, setRevision] = React.useState(itemRevision);
  const [status, setStatus] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setValue(parseAgentContent(content));
    setRevision(itemRevision);
    setStatus("idle");
    setError(null);
  }, [designFacetKey, content, itemRevision]);

  async function persist(next: AgentContentValue): Promise<void> {
    setStatus("saving");
    setError(null);
    try {
      const out = await onSave(designFacetKey, serializeAgentContent(next), revision);
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

  function addAgent(): void {
    const next = { ...value, agents: [...value.agents, emptyAgent()] };
    setValue(next);
    void persist(next);
  }

  function removeAgent(index: number): void {
    const next = { ...value, agents: value.agents.filter((_, i) => i !== index) };
    setValue(next);
    void persist(next);
  }

  function updateAgent(index: number, patch: Partial<AgentRowDraft>): void {
    setValue((v) => ({ ...v, agents: v.agents.map((a, i) => (i === index ? { ...a, ...patch } : a)) }));
  }

  function commitAgent(index: number, patch: Partial<AgentRowDraft>): void {
    const next = { ...value, agents: value.agents.map((a, i) => (i === index ? { ...a, ...patch } : a)) };
    setValue(next);
    void persist(next);
  }

  const speakers = value.agents.filter((a) => a.canSpeak).length;

  return (
    <div data-testid={`bp-facet-editor-${designFacetKey}`}>
      <div className="mb-2 flex items-center gap-1.5">
        {status !== "idle" && (
          <span className={status === "error" ? "text-11 text-destructive" : "text-11 text-muted-foreground"} data-testid="bp-facet-save-status">
            {status === "saving" ? "保存中…" : status === "saved" ? "已保存" : "保存失败"}
          </span>
        )}
      </div>

      <div className="mb-4 rounded-lg border border-border p-4" data-testid="bp-agent-list">
        <h3 className="mb-2 text-13 font-semibold">
          在场 agent · {value.agents.length}（同一环节最多两个可主动发言，当前 {speakers}）
        </h3>
        {value.agents.length === 0 ? (
          <p className="text-11 text-muted-foreground" data-testid="bp-agent-empty">
            还没有 agent——点「＋ agent」新增。
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {value.agents.map((a, i) => (
              <li key={i} className="flex flex-col gap-1 p-2.5" data-testid={`bp-agent-row-${i}`}>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="text"
                    className="w-28 shrink-0 text-12 font-medium"
                    value={a.name}
                    onChange={(e) => updateAgent(i, { name: e.target.value })}
                    onBlur={() => void persist(value)}
                    placeholder="Facilitator"
                    data-testid={`bp-agent-name-${i}`}
                  />
                  <Checkbox
                    className="shrink-0"
                    checked={a.canSpeak}
                    onChange={() => commitAgent(i, { canSpeak: !a.canSpeak })}
                    label="可主动发言"
                    data-testid={`bp-agent-canspeak-${i}`}
                  />
                  <div className="flex shrink-0 gap-0.5">
                    {AGENT_STATES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => commitAgent(i, { state: s })}
                        aria-pressed={a.state === s}
                        className={
                          a.state === s
                            ? "rounded border border-primary px-1.5 py-0.5 text-10 text-primary transition-colors"
                            : "rounded border border-border px-1.5 py-0.5 text-10 text-muted-foreground transition-colors hover:bg-muted"
                        }
                        data-testid={`bp-agent-state-${i}-${s}`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeAgent(i)}
                    className="ml-auto shrink-0 rounded border border-border px-1 text-11 text-destructive"
                    aria-label="删除 agent"
                    data-testid={`bp-agent-remove-${i}`}
                  >
                    ✕
                  </button>
                </div>
                <Input
                  type="text"
                  className="w-full text-11"
                  value={a.does}
                  onChange={(e) => updateAgent(i, { does: e.target.value })}
                  onBlur={() => void persist(value)}
                  placeholder="做什么（如「推进议程、识别重复议题、提议收敛」）"
                  data-testid={`bp-agent-does-${i}`}
                />
                <Input
                  type="text"
                  className="w-full border-dashed text-11 text-muted-foreground"
                  value={a.segs}
                  onChange={(e) => updateAgent(i, { segs: e.target.value })}
                  onBlur={() => void persist(value)}
                  placeholder="在场环节（如「全程」或「03 / 04 / 05」）"
                  data-testid={`bp-agent-segs-${i}`}
                />
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={addAgent}
          className="mt-2 rounded-md border border-border px-2 py-1 text-11 transition-colors hover:bg-muted"
          data-testid="bp-agent-add"
        >
          ＋ agent
        </button>
      </div>

      <div className="mb-4 rounded-lg border border-border p-4" data-testid="bp-agent-intervention">
        <h3 className="mb-2 text-13 font-semibold">介入尺度</h3>
        <label className="flex items-center gap-2 text-12 font-medium">
          提议收敛的触发阈值：重复
          <Input
            type="number"
            className="w-16 text-12"
            value={value.repeatThreshold}
            onChange={(e) => setValue((v) => ({ ...v, repeatThreshold: Number(e.target.value) || 0 }))}
            onBlur={() => void persist(value)}
            data-testid="bp-agent-threshold"
          />
          次
        </label>
        <div className="mt-2 flex items-start gap-2 rounded-md border border-ai-tint bg-ai-tint p-2.5" data-testid="bp-agent-threshold-history">
          <span aria-hidden className="mt-0.5 shrink-0 text-ai-tint-foreground">
            ✨
          </span>
          <div>
            <p className="text-11 font-medium text-ai-tint-foreground">阈值史</p>
            <p className="mt-0.5 text-11 text-muted-foreground">{THRESHOLD_HISTORY}</p>
          </div>
        </div>
        <ul className="mt-2 flex flex-col gap-1">
          {INTERVENTION_RULES.map((r) => (
            <li key={r} className="flex items-start gap-2 text-11 text-muted-foreground" data-testid="bp-agent-rule">
              <span aria-hidden className="mt-0.5">
                ✓
              </span>
              {r}
            </li>
          ))}
        </ul>
      </div>

      <div className="mb-4 rounded-lg border border-border p-4" data-testid="bp-agent-hardlimits">
        <h3 className="mb-2 text-13 font-semibold">不可放开的硬约束</h3>
        <ul className="flex flex-col gap-1.5">
          {HARD_LIMITS.map((h) => (
            <li
              key={h}
              className="flex items-start gap-2 rounded-md bg-panel px-2.5 py-1.5 text-12"
              data-testid="bp-agent-hardlimit"
            >
              <span aria-hidden className="mt-0.5 text-muted-foreground">
                🔒
              </span>
              {h}
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
