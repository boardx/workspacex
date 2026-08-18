"use client";
import * as React from "react";
import type { FacetSaveFn } from "./facet-content-editor";

/**
 * 「报告模板」结构化编辑器（第 2 项，分组五）——替换该项此前的 `FacetTextEditor`。
 *
 * ⚠ 逐项对照 `apps/web/components/tpl/designer-panels.tsx` 的 `ReportPanel` 与
 * `apps/web/lib/mock/tpl.ts` 的 `REPORT_PANEL`：
 * - **客户交付版**：一份带编号的章节骨架，每章有标题 + 由谁写（`by`）。原型把
 *   `by` 包含「必须」二字的章节渲染成 danger 徽标、其余渲染成 ai 徽标——本编辑器
 *   把「必须人写」做成真实可勾选的布尔，其余情况下 `by` 是自由文本（原型出现
 *   "AI 起草"/"AI 生成"/"必须保留" 等多种值，不是闭集）。
 * - **内部复盘版**：原型是一段固定说明（这一份不给客户，是蓝本迭代的输入），
 *   不是可编辑字段。
 * - **写作硬约束**：四条产品级约束，原型用 Lock 图标渲染成只读清单，保持只读。
 * - 底部 AI 历史数据卡是只读说明。
 */

const INTERNAL_NOTE =
  "给自己看的那一份：哪个环节超时、哪条 AI 建议被否、哪些假设后来被推翻。这份不给客户，它是蓝本迭代的输入。";

const WRITING_RULES = [
  "结论先行，不铺陈过程",
  "每条结论必须挂至少一条可点开的证据",
  "引用过期或低置信证据必须标注",
  "拒绝 AI 分析的受访者只能用原文引述",
] as const;

const HISTORY_NOTE =
  "套用后 AI 会先出草稿，等你改。历史数据：一场半天项目的纪要，AI 起草约 3 分钟，引导师平均改 22 分钟。改动最多的一节是「一页纸结论」，所以那一节写死为必须人写。";

export interface ReportChapterDraft {
  readonly title: string;
  readonly by: string;
  readonly humanRequired: boolean;
}

export interface ReportContentValue {
  readonly chapters: readonly ReportChapterDraft[];
}

function emptyChapter(): ReportChapterDraft {
  return { title: "", by: "AI 起草", humanRequired: false };
}

function emptyValue(): ReportContentValue {
  return { chapters: [] };
}

export function parseReportContent(content: string): ReportContentValue {
  if (content.trim() === "") return emptyValue();
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null) return emptyValue();
    const p = parsed as Partial<ReportContentValue>;
    if (!Array.isArray(p.chapters)) return emptyValue();
    return {
      chapters: p.chapters.map((c: Partial<ReportChapterDraft>) => ({
        title: typeof c?.title === "string" ? c.title : "",
        by: typeof c?.by === "string" ? c.by : "",
        humanRequired: typeof c?.humanRequired === "boolean" ? c.humanRequired : false,
      })),
    };
  } catch {
    return emptyValue();
  }
}

export function serializeReportContent(value: ReportContentValue): string {
  return value.chapters.length === 0 ? "" : JSON.stringify(value);
}

export function ReportPanelEditor({
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
  const [value, setValue] = React.useState<ReportContentValue>(() => parseReportContent(content));
  const [revision, setRevision] = React.useState(itemRevision);
  const [status, setStatus] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setValue(parseReportContent(content));
    setRevision(itemRevision);
    setStatus("idle");
    setError(null);
  }, [designFacetKey, content, itemRevision]);

  async function persist(next: ReportContentValue): Promise<void> {
    setStatus("saving");
    setError(null);
    try {
      const out = await onSave(designFacetKey, serializeReportContent(next), revision);
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

  function addChapter(): void {
    const next = { chapters: [...value.chapters, emptyChapter()] };
    setValue(next);
    void persist(next);
  }

  function removeChapter(index: number): void {
    const next = { chapters: value.chapters.filter((_, i) => i !== index) };
    setValue(next);
    void persist(next);
  }

  function updateChapter(index: number, patch: Partial<ReportChapterDraft>): void {
    setValue((v) => ({ chapters: v.chapters.map((c, i) => (i === index ? { ...c, ...patch } : c)) }));
  }

  function toggleHumanRequired(index: number): void {
    const next = {
      chapters: value.chapters.map((c, i) => (i === index ? { ...c, humanRequired: !c.humanRequired } : c)),
    };
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
      </div>

      <div className="mb-4 rounded-lg border border-border p-4" data-testid="bp-report-client">
        <h3 className="mb-2 text-13 font-semibold">客户交付版 · {value.chapters.length} 章骨架</h3>
        {value.chapters.length === 0 ? (
          <p className="text-11 text-muted-foreground" data-testid="bp-report-empty">
            还没有章节——点「＋ 章节」新增。
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {value.chapters.map((c, i) => (
              <li key={i} className="flex items-center gap-1.5 p-2.5" data-testid={`bp-report-chapter-${i}`}>
                <span className="w-6 shrink-0 font-mono text-11 text-muted-foreground">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <input
                  type="text"
                  className="flex-1 rounded-md border border-border bg-background p-1 text-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={c.title}
                  onChange={(e) => updateChapter(i, { title: e.target.value })}
                  onBlur={() => void persist(value)}
                  placeholder="章节标题（如「一页纸结论：3 个题目与推进顺序」）"
                  data-testid={`bp-report-title-${i}`}
                />
                <input
                  type="text"
                  className="w-24 shrink-0 rounded-md border border-dashed border-border bg-background p-1 text-11 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={c.by}
                  onChange={(e) => updateChapter(i, { by: e.target.value })}
                  onBlur={() => void persist(value)}
                  placeholder="AI 起草"
                  aria-label="由谁写"
                  data-testid={`bp-report-by-${i}`}
                />
                <label className="flex shrink-0 items-center gap-1 text-11 text-destructive">
                  <input
                    type="checkbox"
                    checked={c.humanRequired}
                    onChange={() => toggleHumanRequired(i)}
                    data-testid={`bp-report-human-${i}`}
                  />
                  必须人写
                </label>
                <button
                  type="button"
                  onClick={() => removeChapter(i)}
                  className="shrink-0 rounded border border-border px-1 text-11 text-destructive"
                  aria-label="删除章节"
                  data-testid={`bp-report-remove-${i}`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={addChapter}
          className="mt-2 rounded-md border border-border px-2 py-1 text-11 transition-colors hover:bg-muted"
          data-testid="bp-report-add"
        >
          ＋ 章节
        </button>
      </div>

      <div className="mb-4 rounded-lg border border-border p-4" data-testid="bp-report-internal">
        <h3 className="mb-2 text-13 font-semibold">内部复盘版 · 6 页</h3>
        <p className="text-12 leading-relaxed text-muted-foreground">{INTERNAL_NOTE}</p>
      </div>

      <div className="mb-4 rounded-lg border border-border p-4" data-testid="bp-report-rules">
        <h3 className="mb-2 text-13 font-semibold">写作硬约束</h3>
        <ul className="flex flex-col gap-1.5">
          {WRITING_RULES.map((r) => (
            <li key={r} className="flex items-start gap-2 text-12" data-testid="bp-report-rule">
              <span aria-hidden className="mt-0.5 text-muted-foreground">
                🔒
              </span>
              {r}
            </li>
          ))}
        </ul>
        <div className="mt-2 flex items-start gap-2 rounded-md border border-ai-tint bg-ai-tint p-2.5" data-testid="bp-report-history">
          <span aria-hidden className="mt-0.5 shrink-0 text-ai-tint-foreground">
            ✨
          </span>
          <div>
            <p className="text-11 font-medium text-ai-tint-foreground">历史数据</p>
            <p className="mt-0.5 text-11 text-muted-foreground">{HISTORY_NOTE}</p>
          </div>
        </div>
      </div>

      {error !== null && (
        <p role="alert" className="text-11 text-destructive" data-testid={`bp-facet-error-${designFacetKey}`}>
          {error}
        </p>
      )}
    </div>
  );
}
