"use client";
import * as React from "react";

/**
 * 标签输入器（R2，2026-08-25）——新建 / 改名弹窗共用。
 *
 * `Design.pdf` §3.2「标签与筛选」逐条实现：
 * · 已选标签为可删胶囊（×）；
 * · 输入框边打边搜已有标签，候选列表显示「N 个模板在用」；
 * · 输入的词不存在时，候选首项为「＋ 新建标签「xxx」」；
 * · **回车或逗号直接确认新建**；
 * · 输入框为空时按退格删除最后一个标签。
 *
 * ## 候选来自真实数据，不是写死的枚举
 *
 * `knownTags` 由调用方从当前模板库的真实 `tags` 聚合而来（同 §3.2「不是写死的枚举」）。
 * 本组件不持有任何标签清单——它连"这个组织有哪些标签"都不知道，只渲染传进来的那份。
 */
export function TemplateTagInput({
  value, onChange, knownTags, disabled = false, testIdPrefix = "tpladmin-tag",
}: {
  readonly value: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
  /** `标签 → 有多少个模板在用`，由调用方从真实模板列表聚合。 */
  readonly knownTags: ReadonlyMap<string, number>;
  readonly disabled?: boolean;
  readonly testIdPrefix?: string;
}) {
  const [draft, setDraft] = React.useState("");
  const trimmed = draft.trim();

  function add(tag: string): void {
    const t = tag.trim();
    if (t.length === 0 || value.includes(t)) {
      setDraft("");
      return;
    }
    onChange([...value, t]);
    setDraft("");
  }

  function remove(tag: string): void {
    onChange(value.filter((t) => t !== tag));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    // 回车或逗号（中英文都认——使用者在中文输入法下打出的是「，」）直接确认。
    if ((e.key === "Enter" || e.key === "," || e.key === "，") && trimmed.length > 0) {
      e.preventDefault();
      add(trimmed);
      return;
    }
    // 输入框为空时退格删掉最后一个——这是标签输入框的通行手势，`Design.pdf` 点名要求。
    if (e.key === "Backspace" && draft.length === 0 && value.length > 0) {
      e.preventDefault();
      onChange(value.slice(0, -1));
    }
  }

  const suggestions = React.useMemo(() => {
    const pool = [...knownTags.entries()]
      .filter(([tag]) => !value.includes(tag) && (trimmed.length === 0 || tag.includes(trimmed)))
      .slice(0, 8)
      .map(([tag, count]) => ({ tag, note: `${count} 个模板在用`, isNew: false }));
    // 输入的词在已有标签里找不到 ⇒ 首项是「新建」，同 Design.pdf §3.2。
    if (trimmed.length > 0 && !knownTags.has(trimmed) && !value.includes(trimmed)) {
      return [{ tag: trimmed, note: "回车也可以", isNew: true }, ...pool];
    }
    return pool;
  }, [knownTags, value, trimmed]);

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5"
        data-testid={`${testIdPrefix}-box`}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded-full bg-foreground px-2 py-0.5 text-10 font-medium text-background"
            data-testid={`${testIdPrefix}-chip-${tag}`}
          >
            {tag}
            {!disabled && (
              <button
                type="button"
                className="opacity-70 transition-opacity duration-150 hover:opacity-100"
                aria-label={`移除标签 ${tag}`}
                onClick={() => remove(tag)}
                data-testid={`${testIdPrefix}-remove-${tag}`}
              >
                ×
              </button>
            )}
          </span>
        ))}
        <input
          className="min-w-32 flex-1 bg-transparent text-12 outline-none disabled:cursor-not-allowed"
          placeholder={value.length === 0 ? "输入标签，回车确认" : ""}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="添加标签"
          data-testid={`${testIdPrefix}-input`}
        />
      </div>

      {!disabled && suggestions.length > 0 && (
        <div
          className="flex max-h-36 flex-col overflow-auto rounded-md border border-border-subtle"
          data-testid={`${testIdPrefix}-suggestions`}
        >
          {suggestions.map((s) => (
            <button
              key={`${s.isNew ? "new:" : ""}${s.tag}`}
              type="button"
              className="flex items-center gap-2 border-b border-border-subtle px-2.5 py-1.5 text-left text-11 transition-colors duration-150 last:border-b-0 hover:bg-muted"
              onClick={() => add(s.tag)}
              data-testid={`${testIdPrefix}-suggestion-${s.tag}`}
            >
              <span className="font-medium">{s.isNew ? `＋ 新建标签「${s.tag}」` : s.tag}</span>
              <span className="ml-auto text-10 text-muted-foreground">{s.note}</span>
            </button>
          ))}
        </div>
      )}

      <span className="text-10 text-muted-foreground" data-testid={`${testIdPrefix}-hint`}>
        {value.length > 0
          ? `已选 ${value.length} 个标签 —— 模板库里可按它们筛选`
          : "输入即搜索已有标签，回车新建一个"}
      </span>
    </div>
  );
}
