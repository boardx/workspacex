"use client";
import * as React from "react";
import type { FacetSaveFn } from "./facet-content-editor";

/**
 * 「主题与背景」结构化编辑器（第 1 项，分组一）——`design-deltas/
 * blueprint-design-facet-panels/contract.md` 的 `ThemeContent` 字段提议落地成
 * 真实可编辑表单，替换该项此前统一使用的 `FacetTextEditor` 自由文本框。
 *
 * ⚠ 存储形状不变：仍然写进 `updateDesignFacet` 的 `content: string` 字段，
 * 只是这个字符串现在装的是 `JSON.stringify(TopicContentValue)`，不是任意文本——
 * 契约本身一字未改（同 `PermissionMatrixEditor` 的先例）。
 *
 * ## 固定 vs 可填
 *
 * `contract.md` 的 `ThemeStatement.template`/`rules` 与 5 行 `BackgroundElement`
 * 的 `element`/`source` 都是**结构性事实**（草稿逐字抽取自原型，不是可配置项）——
 * 用户只填两类真正的内容：① 套进固定句式的主题陈述文本 ② 5 个背景要素各自的
 * 内容 + 挂的来源说明（`citedFrom`，可选，未填时草稿"未挂来源标灰"）。
 */

const THEME_TEMPLATE = "「以什么〔时间约束〕达成什么〔可验证的结果〕」";
const THEME_NOTE = "AI 按这个句式从洞察里生成候选";
const THEME_RULES = ["必须含时间约束", "必须可证伪", "≤ 30 字", "不写解决方案"] as const;

const BACKGROUND_ELEMENTS = [
  { element: "为什么现在", hint: "触发这场讨论的事件或截止日", source: "客户输入 / 会前访谈" },
  { element: "已知结论", hint: "调研已经能确定的 2–3 条", source: "洞察库（自动带入）" },
  { element: "硬约束", hint: "预算、合规、时间、资质", source: "客户输入" },
  { element: "要拍板的事", hint: "这一场必须出的决定", source: "引导师填写" },
  { element: "不讨论的事", hint: "明确移出本场的议题", source: "引导师填写" },
] as const;

const GEN_RULES = [
  "套用时 AI 先出草稿，引导师改完才算定题",
  "从 12 条洞察/访谈里生成 3 个候选主题，标注支持它的强洞察条数",
  "背景草稿必须逐句挂来源，未挂来源的句子标灰",
  "没定主题前，议程与分组页只读",
] as const;

export interface TopicBackgroundRow {
  readonly element: string;
  readonly content: string;
  readonly citedFrom: string;
}

export interface TopicContentValue {
  readonly themeStatementText: string;
  readonly background: readonly TopicBackgroundRow[];
}

function emptyValue(): TopicContentValue {
  return {
    themeStatementText: "",
    background: BACKGROUND_ELEMENTS.map((b) => ({ element: b.element, content: "", citedFrom: "" })),
  };
}

/** 反序列化；空串/坏数据/字段缺失一律回退成"全未配置"（不抛错，不能因一条坏数据打崩整个面板）。 */
export function parseTopicContent(content: string): TopicContentValue {
  if (content.trim() === "") return emptyValue();
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null) return emptyValue();
    const p = parsed as Partial<TopicContentValue>;
    const themeStatementText = typeof p.themeStatementText === "string" ? p.themeStatementText : "";
    const byElement = new Map((Array.isArray(p.background) ? p.background : []).map((r) => [r.element, r]));
    const background = BACKGROUND_ELEMENTS.map((b) => {
      const row = byElement.get(b.element);
      return {
        element: b.element,
        content: typeof row?.content === "string" ? row.content : "",
        citedFrom: typeof row?.citedFrom === "string" ? row.citedFrom : "",
      };
    });
    return { themeStatementText, background };
  } catch {
    return emptyValue();
  }
}

export function serializeTopicContent(value: TopicContentValue): string {
  // 全空时序列化成空串——这样"完全没填"仍然对应 `updateDesignFacet` 既有的
  // "未填 = 无行"语义（同 F186 的写入侧过滤纪律），不会因为存了一份全空的 JSON
  // 骨架而被误判成"已配"。
  const isAllEmpty =
    value.themeStatementText.trim() === "" && value.background.every((b) => b.content.trim() === "");
  return isAllEmpty ? "" : JSON.stringify(value);
}

export function TopicPanelEditor({
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
  const [value, setValue] = React.useState<TopicContentValue>(() => parseTopicContent(content));
  const [revision, setRevision] = React.useState(itemRevision);
  const [status, setStatus] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setValue(parseTopicContent(content));
    setRevision(itemRevision);
    setStatus("idle");
    setError(null);
  }, [designFacetKey, content, itemRevision]);

  async function persist(next: TopicContentValue): Promise<void> {
    setStatus("saving");
    setError(null);
    try {
      const out = await onSave(designFacetKey, serializeTopicContent(next), revision);
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

  function updateStatement(text: string): void {
    setValue((v) => ({ ...v, themeStatementText: text }));
  }

  function updateBackground(element: string, patch: Partial<TopicBackgroundRow>): void {
    setValue((v) => ({
      ...v,
      background: v.background.map((row) => (row.element === element ? { ...row, ...patch } : row)),
    }));
  }

  return (
    <div data-testid={`bp-facet-editor-${designFacetKey}`}>
      <div className="mb-4 rounded-lg border border-border p-4" data-testid="bp-topic-statement">
        <div className="mb-2 flex items-center gap-1.5">
          <h3 className="text-13 font-semibold">主题句式</h3>
          {status !== "idle" && (
            <span
              className={status === "error" ? "text-11 text-destructive" : "text-11 text-muted-foreground"}
              data-testid="bp-facet-save-status"
            >
              {status === "saving" ? "保存中…" : status === "saved" ? "已保存" : "保存失败"}
            </span>
          )}
        </div>
        <p className="mb-1 text-13 font-medium">{THEME_TEMPLATE}</p>
        <p className="mb-2 text-11 text-muted-foreground">{THEME_NOTE}</p>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {THEME_RULES.map((r) => (
            <span key={r} className="rounded border border-border px-1.5 py-0.5 text-11 text-muted-foreground">
              {r}
            </span>
          ))}
        </div>
        <textarea
          className="min-h-16 w-full rounded-md border border-border bg-background p-2 text-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={value.themeStatementText}
          onChange={(e) => updateStatement(e.target.value)}
          onBlur={() => void persist(value)}
          placeholder="按上面的句式填写这次的主题…"
          data-testid="bp-topic-statement-input"
        />
      </div>

      <div className="mb-4 rounded-lg border border-border p-4" data-testid="bp-topic-background">
        <h3 className="mb-2 text-13 font-semibold">背景要素（缺一项就提示引导师补）</h3>
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {BACKGROUND_ELEMENTS.map((b) => {
            const row = value.background.find((r) => r.element === b.element)!;
            return (
              <li key={b.element} className="flex flex-col gap-1 p-2.5" data-testid="bp-topic-bg-row">
                <div className="flex items-center gap-2">
                  <span className="w-24 shrink-0 text-12 font-medium">{b.element}</span>
                  <span className="flex-1 text-11 text-muted-foreground">{b.hint}</span>
                  <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-11 text-muted-foreground">{b.source}</span>
                </div>
                <input
                  type="text"
                  className="w-full rounded-md border border-border bg-background p-1.5 text-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={row.content}
                  onChange={(e) => updateBackground(b.element, { content: e.target.value })}
                  onBlur={() => void persist(value)}
                  placeholder={`填写"${b.element}"…`}
                  data-testid={`bp-topic-bg-content-${b.element}`}
                />
                <input
                  type="text"
                  className="w-full rounded-md border border-dashed border-border bg-background p-1.5 text-11 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={row.citedFrom}
                  onChange={(e) => updateBackground(b.element, { citedFrom: e.target.value })}
                  onBlur={() => void persist(value)}
                  placeholder="挂来源（可选）——未挂来源在参与者视图会标灰"
                  data-testid={`bp-topic-bg-cited-${b.element}`}
                />
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mb-4 rounded-lg border border-border p-4" data-testid="bp-topic-genrules">
        <h3 className="mb-2 text-13 font-semibold">生成与校验</h3>
        <ul className="flex flex-col gap-1.5">
          {GEN_RULES.map((r) => (
            <li key={r} className="flex items-start gap-2 text-12 text-muted-foreground" data-testid="bp-topic-genrule">
              <span aria-hidden className="mt-0.5">✨</span>
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
