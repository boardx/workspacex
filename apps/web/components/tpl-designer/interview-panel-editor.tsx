"use client";
import * as React from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { FacetSaveFn } from "./facet-content-editor";

/**
 * 「访谈与对象」结构化编辑器（第 2 项，分组二）——`design-deltas/
 * blueprint-design-facet-panels/contract.md` 的 `InterviewContent` 字段提议
 * 落地成真实可编辑表单，替换该项此前统一使用的 `FacetTextEditor` 自由文本框。
 *
 * ⚠ 逐项对照 `apps/web/components/tpl/designer-panels.tsx` 的 `InterviewPanel`
 * 与 `apps/web/lib/mock/tpl.ts` 的 `INTERVIEW_PLAN_PANEL`：
 * - 访谈角色清单（`roles[]{role,ask,guide,quota}`）可增删改，对应原型的角色行
 *   （角色名 / 要问出什么 / 提纲 / 配额场次）。
 * - `authDefaults` 原型给的是 3 条，其中前两条是可配置默认值（录音转录 / AI 分析），
 *   第三条「未收到受访者本人确认前，开始访谈保持禁用」原型明确标注为**硬约束**
 *   （渲染成 warning 图标而不是 ✓），它不是可关的开关——本编辑器把它渲染成固定
 *   说明文字，不给勾选框，与原型的语义一致。
 * - 证据规则（`evidenceRules`）在原型里是一段固定说明文字，不是可编辑字段。
 */

export interface InterviewRoleDraft {
  readonly role: string;
  readonly ask: string;
  readonly guide: string;
  readonly quota: number;
}

export interface InterviewAuthDefaults {
  readonly recordAndTranscribeByDefault: boolean;
  readonly requestAiAnalysisByDefault: boolean;
}

export interface InterviewContentValue {
  readonly roles: readonly InterviewRoleDraft[];
  readonly auth: InterviewAuthDefaults;
}

const VIRTUAL_NOTE = "虚拟专家推演可作补充，但不计入独立证据";
const HARD_CONSTRAINT_NOTE = "未收到受访者本人确认前，「开始访谈」保持禁用 —— 硬约束";
const EVIDENCE_RULES_NOTE =
  "同一说法要被 2 个独立来源支持才算数；同场访谈里的附和不算独立；虚拟专家推演不计强度，只能作提问线索。这三条会写进现场的证据矩阵。";

function emptyRole(): InterviewRoleDraft {
  return { role: "", ask: "", guide: "", quota: 1 };
}

function defaultAuth(): InterviewAuthDefaults {
  return { recordAndTranscribeByDefault: true, requestAiAnalysisByDefault: false };
}

function emptyValue(): InterviewContentValue {
  return { roles: [], auth: defaultAuth() };
}

export function parseInterviewContent(content: string): InterviewContentValue {
  if (content.trim() === "") return emptyValue();
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null) return emptyValue();
    const p = parsed as Partial<InterviewContentValue>;
    const a = p.auth as Partial<InterviewAuthDefaults> | undefined;
    return {
      roles: Array.isArray(p.roles)
        ? p.roles.map((r: Partial<InterviewRoleDraft>) => ({
            role: typeof r?.role === "string" ? r.role : "",
            ask: typeof r?.ask === "string" ? r.ask : "",
            guide: typeof r?.guide === "string" ? r.guide : "",
            quota: typeof r?.quota === "number" && r.quota > 0 ? r.quota : 1,
          }))
        : [],
      auth: {
        recordAndTranscribeByDefault:
          typeof a?.recordAndTranscribeByDefault === "boolean" ? a.recordAndTranscribeByDefault : true,
        requestAiAnalysisByDefault:
          typeof a?.requestAiAnalysisByDefault === "boolean" ? a.requestAiAnalysisByDefault : false,
      },
    };
  } catch {
    return emptyValue();
  }
}

export function serializeInterviewContent(value: InterviewContentValue): string {
  return value.roles.length === 0 ? "" : JSON.stringify(value);
}

export function InterviewPanelEditor({
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
  const [value, setValue] = React.useState<InterviewContentValue>(() => parseInterviewContent(content));
  const [revision, setRevision] = React.useState(itemRevision);
  const [status, setStatus] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setValue(parseInterviewContent(content));
    setRevision(itemRevision);
    setStatus("idle");
    setError(null);
  }, [designFacetKey, content, itemRevision]);

  async function persist(next: InterviewContentValue): Promise<void> {
    setStatus("saving");
    setError(null);
    try {
      const out = await onSave(designFacetKey, serializeInterviewContent(next), revision);
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

  function addRole(): void {
    const next = { ...value, roles: [...value.roles, emptyRole()] };
    setValue(next);
    void persist(next);
  }

  function removeRole(index: number): void {
    const next = { ...value, roles: value.roles.filter((_, i) => i !== index) };
    setValue(next);
    void persist(next);
  }

  function updateRole(index: number, patch: Partial<InterviewRoleDraft>): void {
    setValue((v) => ({ ...v, roles: v.roles.map((r, i) => (i === index ? { ...r, ...patch } : r)) }));
  }

  function toggleAuth(key: keyof InterviewAuthDefaults): void {
    const next = { ...value, auth: { ...value.auth, [key]: !value.auth[key] } };
    setValue(next);
    void persist(next);
  }

  const totalQuota = value.roles.reduce((sum, r) => sum + r.quota, 0);

  return (
    <div data-testid={`bp-facet-editor-${designFacetKey}`}>
      <div className="mb-2 flex items-center gap-1.5">
        {status !== "idle" && (
          <span className={status === "error" ? "text-11 text-destructive" : "text-11 text-muted-foreground"} data-testid="bp-facet-save-status">
            {status === "saving" ? "保存中…" : status === "saved" ? "已保存" : "保存失败"}
          </span>
        )}
      </div>

      <div className="mb-4 rounded-lg border border-border p-4" data-testid="bp-itv-plan">
        <h3 className="mb-2 text-13 font-semibold">
          预设访谈计划 · {totalQuota} 场（按角色定配额，套用时补具体人名）
        </h3>
        {value.roles.length === 0 ? (
          <p className="text-11 text-muted-foreground" data-testid="bp-itv-empty">
            还没有访谈角色——点「＋ 访谈角色」新增。
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {value.roles.map((r, i) => (
              <li key={i} className="flex flex-col gap-1 p-2.5" data-testid={`bp-itv-role-row-${i}`}>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="text"
                    className="w-36 shrink-0 text-12 font-medium"
                    value={r.role}
                    onChange={(e) => updateRole(i, { role: e.target.value })}
                    onBlur={() => void persist(value)}
                    placeholder="角色（如「客户方决策人」）"
                    data-testid={`bp-itv-role-name-${i}`}
                  />
                  <Input
                    type="number"
                    className="w-16 text-12"
                    value={r.quota}
                    onChange={(e) => updateRole(i, { quota: Number(e.target.value) || 0 })}
                    onBlur={() => void persist(value)}
                    aria-label="配额场次"
                    data-testid={`bp-itv-role-quota-${i}`}
                  />
                  <span className="text-11 text-muted-foreground">场</span>
                  <button
                    type="button"
                    onClick={() => removeRole(i)}
                    className="ml-auto shrink-0 rounded-md border border-border px-2 py-1 text-11 text-destructive transition-colors hover:bg-muted"
                    data-testid={`bp-itv-role-remove-${i}`}
                  >
                    删除
                  </button>
                </div>
                <Input
                  type="text"
                  className="w-full text-11"
                  value={r.ask}
                  onChange={(e) => updateRole(i, { ask: e.target.value })}
                  onBlur={() => void persist(value)}
                  placeholder="要问出什么"
                  data-testid={`bp-itv-role-ask-${i}`}
                />
                <Input
                  type="text"
                  className="w-full border-dashed text-11 text-muted-foreground"
                  value={r.guide}
                  onChange={(e) => updateRole(i, { guide: e.target.value })}
                  onBlur={() => void persist(value)}
                  placeholder="提纲（如「JTBD 访谈法」）"
                  data-testid={`bp-itv-role-guide-${i}`}
                />
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={addRole}
          className="mt-2 rounded-md border border-border px-2 py-1 text-11 transition-colors hover:bg-muted"
          data-testid="bp-itv-add"
        >
          ＋ 访谈角色
        </button>
        <p className="mt-1.5 text-11 italic text-muted-foreground">{VIRTUAL_NOTE}</p>
      </div>

      <div className="mb-4 rounded-lg border border-border p-4" data-testid="bp-itv-auth">
        <h3 className="mb-2 text-13 font-semibold">默认授权设置</h3>
        <ul className="flex flex-col gap-1.5">
          <li>
            <Checkbox
              checked={value.auth.recordAndTranscribeByDefault}
              onChange={() => toggleAuth("recordAndTranscribeByDefault")}
              label="默认请求录音与转录 · 发受访者自助同意链接"
              data-testid="bp-itv-auth-record"
            />
          </li>
          <li>
            <Checkbox
              checked={value.auth.requestAiAnalysisByDefault}
              onChange={() => toggleAuth("requestAiAnalysisByDefault")}
              label="默认请求 AI 分析（建议逐人问）"
              data-testid="bp-itv-auth-ai"
            />
          </li>
          <li className="flex items-start gap-2 text-12 text-warning-foreground" data-testid="bp-itv-auth-hardlimit">
            <span aria-hidden className="mt-0.5">
              ⚠
            </span>
            {HARD_CONSTRAINT_NOTE}
          </li>
        </ul>
      </div>

      <div className="mb-4 rounded-lg border border-border p-4" data-testid="bp-itv-evidence">
        <h3 className="mb-2 text-13 font-semibold">证据规则（写进现场的证据矩阵）</h3>
        <p className="text-12 leading-relaxed text-muted-foreground">{EVIDENCE_RULES_NOTE}</p>
      </div>

      {error !== null && (
        <p role="alert" className="text-11 text-destructive" data-testid={`bp-facet-error-${designFacetKey}`}>
          {error}
        </p>
      )}
    </div>
  );
}
