"use client";
import * as React from "react";

/**
 * 标签输入器——**全仓唯一一份**（2026-09-09 人类指令：「标签的输入，请参考其他的界面的
 * tags 的输入，统一体验」）。
 *
 * 此前同一个交互在四处各写各的：`canvas/template-tag-input.tsx`（胶囊 + 边打边搜）、
 * `design-loop/inbox-tags.tsx`（内联「+ 标签」）、`design-loop/workbench-screen.tsx`
 * 与 `design-loop/inbox-drawer.tsx`（两个纯文本逗号分隔框）。同一件事四种手势，
 * 用户每换一个界面就要重学一次——本仓「同一事实不得声明在两处」的 UI 版。
 *
 * 收敛到最完整的那份（原 `TemplateTagInput`，`Design.pdf` §3.2）：
 * · 已选标签为可删胶囊（×）；
 * · 输入即搜索已有标签，候选显示用量（`noteFor`，由调用方定文案）；
 * · 输入的词不存在时首项为「＋ 新建标签「xxx」」；
 * · **回车或逗号（中英文都认）确认**；
 * · 输入框为空时退格删掉最后一个。
 *
 * ## `flush()`：chip 交互最常见的那个 bug，这里堵死
 *
 * 「打完最后一个标签没按回车就点保存 ⇒ 那个标签丢了」——这是本仓当初**拒绝**用 chip
 * 编辑器的唯一理由（见 workbench-screen 迭代 13 的旧头注）。所以本组件把未确认的草稿
 * 通过 `onDraftChange` 暴露给调用方，调用方在提交前调 `commitDraft()` 把它并进去。
 * 不这样做就是拿一个 bug 换另一个 bug。
 *
 * ## 上限是**拒绝**，不是静默截断
 *
 * 满了就禁用输入并说一句，而不是照收然后在提交时 `.slice(0, max)`——静默截断会让用户
 * 以为存进去了。
 */
export function TagInput({
  value,
  onChange,
  knownTags,
  noteFor,
  maxTags,
  maxTagLength,
  disabled = false,
  draft = "",
  onDraftChange,
  testIdPrefix = "tag",
  emptyHint,
}: {
  readonly value: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
  /** `标签 → 用量`，由调用方从真实数据聚合。本组件不持有任何标签清单。 */
  readonly knownTags: ReadonlyMap<string, number>;
  /** 候选行右侧那句话，例如 `(n) => \`${n} 个模板在用\``。不给则不显示用量。 */
  readonly noteFor?: (count: number) => string;
  readonly maxTags?: number;
  readonly maxTagLength?: number;
  readonly disabled?: boolean;
  /** 受控草稿——调用方持有它才能在提交前 `commitDraft`，见头注。 */
  readonly draft?: string;
  readonly onDraftChange?: (next: string) => void;
  readonly testIdPrefix?: string;
  readonly emptyHint?: string;
}) {
  const composing = React.useRef(false);
  const [uncontrolled, setUncontrolled] = React.useState("");
  const text = onDraftChange === undefined ? uncontrolled : draft;
  const setText = onDraftChange ?? setUncontrolled;
  const trimmed = text.trim();
  const full = maxTags !== undefined && value.length >= maxTags;

  function add(tag: string): void {
    const t = maxTagLength === undefined ? tag.trim() : tag.trim().slice(0, maxTagLength);
    setText("");
    if (t.length === 0 || value.includes(t) || full) return;
    onChange([...value, t]);
  }

  function remove(tag: string): void {
    onChange(value.filter((t) => t !== tag));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    // IME confirmation belongs to the composition session, not to chip editing.
    if (composing.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
    // 回车或逗号（中文输入法下打出的是「，」）直接确认。
    if ((e.key === "Enter" || e.key === "," || e.key === "，") && trimmed.length > 0) {
      e.preventDefault();
      add(trimmed);
      return;
    }
    // 输入框为空时退格删掉最后一个——标签输入框的通行手势。
    if (e.key === "Backspace" && text.length === 0 && value.length > 0) {
      e.preventDefault();
      onChange(value.slice(0, -1));
    }
  }

  const suggestions = React.useMemo(() => {
    if (full) return [];
    const pool = [...knownTags.entries()]
      .filter(([tag]) => !value.includes(tag) && (trimmed.length === 0 || tag.includes(trimmed)))
      .slice(0, 8)
      .map(([tag, count]) => ({ tag, note: noteFor?.(count) ?? "", isNew: false }));
    if (trimmed.length > 0 && !knownTags.has(trimmed) && !value.includes(trimmed)) {
      return [{ tag: trimmed, note: "回车也可以", isNew: true }, ...pool];
    }
    return pool;
  }, [knownTags, value, trimmed, noteFor, full]);

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5"
        data-testid={`${testIdPrefix}-box`}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded-full bg-inverse px-2 py-0.5 text-10 font-medium text-inverse-foreground"
            data-testid={`${testIdPrefix}-chip-${tag}`}
          >
            {tag}
            {!disabled && (
              <button
                type="button"
                className="text-inverse-foreground/70 transition-colors duration-fast hover:text-inverse-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          className="min-w-32 flex-1 rounded-control bg-transparent text-12 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
          placeholder={full ? "" : value.length === 0 ? "输入标签，回车确认" : ""}
          value={text}
          disabled={disabled || full}
          maxLength={maxTagLength}
          onChange={(e) => setText(e.target.value)}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={() => { composing.current = false; }}
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
              className="flex items-center gap-2 border-b border-border-subtle px-2.5 py-1.5 text-left text-11 transition-colors duration-fast last:border-b-0 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => add(s.tag)}
              data-testid={`${testIdPrefix}-suggestion-${s.tag}`}
            >
              <span className="font-medium">{s.isNew ? `＋ 新建标签「${s.tag}」` : s.tag}</span>
              {s.note !== "" && <span className="ml-auto text-10 text-muted-foreground">{s.note}</span>}
            </button>
          ))}
        </div>
      )}

      <span className="text-10 text-muted-foreground" data-testid={`${testIdPrefix}-hint`}>
        {full
          ? `最多 ${String(maxTags)} 个标签，已经满了——删掉一个才能再加`
          : value.length > 0
            ? `已选 ${String(value.length)} 个标签`
            : (emptyHint ?? "输入即搜索已有标签，回车新建一个")}
      </span>
    </div>
  );
}

/** 把未按回车的草稿并进集合——调用方在提交前调它，见 `TagInput` 头注。 */
export function commitDraft(
  value: readonly string[],
  draft: string,
  opts?: { readonly maxTags?: number; readonly maxTagLength?: number },
): readonly string[] {
  const t = opts?.maxTagLength === undefined ? draft.trim() : draft.trim().slice(0, opts.maxTagLength);
  if (t === "" || value.includes(t)) return value;
  if (opts?.maxTags !== undefined && value.length >= opts.maxTags) return value;
  return [...value, t];
}
