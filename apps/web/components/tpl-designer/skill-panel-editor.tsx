"use client";
import * as React from "react";
import type { FacetSaveFn } from "./facet-content-editor";

/**
 * 「Skill 绑定」结构化编辑器（第 2 项，分组四）——替换该项此前的 `FacetTextEditor`。
 *
 * ⚠ 逐项对照 `apps/web/components/tpl/designer-panels.tsx` 的 `SkillPanel` 与
 * `apps/web/lib/mock/tpl.ts` 的 `SKILL_PANEL`：
 * - 每行是「绑在哪个环节 + Skill 名 + 一句说明」，Skill **绑在环节上而不是绑在人上**
 *   （原型 intro 逐字如此），因此 `seg` 是每行的第一个字段。
 * - `degraded`（组织层已降级）**不是蓝本可编辑的字段**——它是组织层 Skill 治理的
 *   投影（某个 Skill 满意度跌破阈值被组织降级），蓝本编辑器只能如实显示、不能
 *   在这里"改成没降级"。因此本编辑器把它渲染成只读徽标 + 顶部的阻断发布警告条，
 *   与原型的 `degradeWarning` 语义一致；用户能做的是解绑或换一个 Skill。
 * - 顶部警告条只在真的存在降级绑定时出现——原型是硬编码一条文案，这里改成按
 *   实际数据条件渲染，这不是"自行设计"，而是把原型的静态示意接上真实数据。
 */

export interface SkillBindingDraft {
  readonly seg: string;
  readonly name: string;
  readonly desc: string;
  /** 组织层治理结果的投影，蓝本侧只读——见文件头注。 */
  readonly degraded: boolean;
}

export interface SkillContentValue {
  readonly skills: readonly SkillBindingDraft[];
}

function emptyBinding(): SkillBindingDraft {
  return { seg: "", name: "", desc: "", degraded: false };
}

function emptyValue(): SkillContentValue {
  return { skills: [] };
}

export function parseSkillContent(content: string): SkillContentValue {
  if (content.trim() === "") return emptyValue();
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null) return emptyValue();
    const p = parsed as Partial<SkillContentValue>;
    if (!Array.isArray(p.skills)) return emptyValue();
    return {
      skills: p.skills.map((s: Partial<SkillBindingDraft>) => ({
        seg: typeof s?.seg === "string" ? s.seg : "",
        name: typeof s?.name === "string" ? s.name : "",
        desc: typeof s?.desc === "string" ? s.desc : "",
        degraded: typeof s?.degraded === "boolean" ? s.degraded : false,
      })),
    };
  } catch {
    return emptyValue();
  }
}

export function serializeSkillContent(value: SkillContentValue): string {
  return value.skills.length === 0 ? "" : JSON.stringify(value);
}

export function SkillPanelEditor({
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
  const [value, setValue] = React.useState<SkillContentValue>(() => parseSkillContent(content));
  const [revision, setRevision] = React.useState(itemRevision);
  const [status, setStatus] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setValue(parseSkillContent(content));
    setRevision(itemRevision);
    setStatus("idle");
    setError(null);
  }, [designFacetKey, content, itemRevision]);

  async function persist(next: SkillContentValue): Promise<void> {
    setStatus("saving");
    setError(null);
    try {
      const out = await onSave(designFacetKey, serializeSkillContent(next), revision);
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

  function addBinding(): void {
    const next = { skills: [...value.skills, emptyBinding()] };
    setValue(next);
    void persist(next);
  }

  function removeBinding(index: number): void {
    const next = { skills: value.skills.filter((_, i) => i !== index) };
    setValue(next);
    void persist(next);
  }

  function updateBinding(index: number, patch: Partial<SkillBindingDraft>): void {
    setValue((v) => ({ skills: v.skills.map((s, i) => (i === index ? { ...s, ...patch } : s)) }));
  }

  const degradedList = value.skills.filter((s) => s.degraded);

  return (
    <div data-testid={`bp-facet-editor-${designFacetKey}`}>
      <p className="mb-3 text-11 text-muted-foreground">
        Skill 绑在环节上而不是绑在人上。到了那个环节，对应的 skill 自动可用，引导师不用记它叫什么。
        {status !== "idle" && (
          <span className={status === "error" ? "ml-2 text-destructive" : "ml-2"} data-testid="bp-facet-save-status">
            {status === "saving" ? "保存中…" : status === "saved" ? "已保存" : "保存失败"}
          </span>
        )}
      </p>

      {degradedList.length > 0 && (
        <div
          className="mb-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2.5"
          data-testid="bp-skill-degrade-warning"
        >
          <span aria-hidden className="mt-0.5 shrink-0 text-destructive">
            ⚠
          </span>
          <p className="text-11 leading-relaxed text-destructive">
            {degradedList.length} 个 Skill 已在组织层降级：
            {degradedList.map((s) => `「${s.name}」`).join("、")}。
            发布前必须替换或解绑，否则套用时对应环节会缺能力。
          </p>
        </div>
      )}

      <div className="mb-4 rounded-lg border border-border p-4" data-testid="bp-skill-list">
        <h3 className="mb-2 text-13 font-semibold">
          绑定的 Skill · {value.skills.length}（灰色为组织层已降级，需替换）
        </h3>
        {value.skills.length === 0 ? (
          <p className="text-11 text-muted-foreground" data-testid="bp-skill-empty">
            还没有绑定 Skill——点「＋ 绑定 Skill」新增。
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {value.skills.map((s, i) => (
              <li
                key={i}
                className={s.degraded ? "flex flex-col gap-1 bg-muted/40 p-2.5" : "flex flex-col gap-1 p-2.5"}
                data-testid={`bp-skill-row-${i}`}
              >
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    className="w-14 shrink-0 rounded-md border border-border bg-background p-1 text-center text-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={s.seg}
                    onChange={(e) => updateBinding(i, { seg: e.target.value })}
                    onBlur={() => void persist(value)}
                    placeholder="03"
                    aria-label="绑在哪个环节"
                    data-testid={`bp-skill-seg-${i}`}
                  />
                  <input
                    type="text"
                    className={
                      s.degraded
                        ? "flex-1 rounded-md border border-border bg-background p-1 text-12 font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        : "flex-1 rounded-md border border-border bg-background p-1 text-12 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    }
                    value={s.name}
                    onChange={(e) => updateBinding(i, { name: e.target.value })}
                    onBlur={() => void persist(value)}
                    placeholder="Skill 名（如「语音转便签」）"
                    data-testid={`bp-skill-name-${i}`}
                  />
                  {s.degraded && (
                    <span
                      className="shrink-0 rounded border border-destructive/40 px-1.5 py-0.5 text-10 text-destructive"
                      data-testid={`bp-skill-degraded-${i}`}
                    >
                      已降级 · 待替换
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeBinding(i)}
                    className="shrink-0 rounded border border-border px-1 text-11 text-destructive"
                    aria-label="解绑 Skill"
                    data-testid={`bp-skill-remove-${i}`}
                  >
                    ✕
                  </button>
                </div>
                <input
                  type="text"
                  className="w-full rounded-md border border-dashed border-border bg-background p-1 text-11 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={s.desc}
                  onChange={(e) => updateBinding(i, { desc: e.target.value })}
                  onBlur={() => void persist(value)}
                  placeholder="一句说明（如「说出来即成便签，落到对应分区」）"
                  data-testid={`bp-skill-desc-${i}`}
                />
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={addBinding}
          className="mt-2 rounded-md border border-border px-2 py-1 text-11 transition-colors hover:bg-muted"
          data-testid="bp-skill-add"
        >
          ＋ 绑定 Skill
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
