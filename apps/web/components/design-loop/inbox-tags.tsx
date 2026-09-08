"use client";
import * as React from "react";
import { Plus, X, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { INBOX_TAG_MAX_LENGTH, INBOX_TAGS_MAX_COUNT } from "@/lib/live-inbox";

/**
 * 2026-09-08——收件箱标签的两个共享部件（人类指令「card 要有 tags 的输入功能」+
 * 「整体界面上方要有 tags 过滤」）。
 *
 *   · `TagChip`：一枚标签。给了 `onClick` 就是按钮（点它 = 按这个标签筛选），否则只读文本；
 *     给了 `onRemove` 多一个 × 按钮。
 *   · `TagEditor`：已有标签 + 「+ 标签」内联输入。**同一份编辑器**挂在看板卡片、列表行与
 *     drawer 三处——三处只差 `testidPrefix` 与 `compact`，不各写一份。
 *
 * ## 为什么每次增删就是一次完整保存（`onChange` 拿到的是最终集合）
 *
 * 标签是集合语义，"删掉一个标签"本身就是一个完整意图；攒到一个「保存」按钮上会让界面停在
 * "看起来删了、刷新又回来"的假象里（本仓反复栽过的坑，见 `ExceptionDevPanel` 旧头注）。
 * 调用方（`inbox-screen.tsx` 的 `saveTags`）按 `kind` 选写路径，这里不知道也不关心来源。
 *
 * ## 事件不冒泡
 *
 * 编辑器总是嵌在「整张卡片 / 整行本身就是打开按钮」且卡片可拖拽的容器里：click / keydown /
 * pointerdown 全部 `stopPropagation`，否则在输入框里按空格会打开 drawer、按 Enter 会同时
 * 触发卡片的"打开"。拖拽：调用方拿 `onEditingChange` 在编辑期间关掉 `draggable`。
 */
export function TagChip({
  tag, onClick, onRemove, disabled, testidPrefix,
}: {
  tag: string;
  onClick?: () => void;
  onRemove?: () => void;
  disabled?: boolean;
  /** 芯片 `${prefix}-tag-${tag}`，筛选按钮 `…-filter`，移除按钮 `${prefix}-tag-remove-${tag}`。 */
  testidPrefix: string;
}) {
  const testid = `${testidPrefix}-tag-${tag}`;
  const base = "inline-flex max-w-full items-center gap-0.5 rounded-control border border-border bg-card px-1.5 py-0.5 text-10 text-card-foreground";
  const label = <span className="truncate">{tag}</span>;
  return (
    <span className={cn(base, "group/tag")} data-testid={testid}>
      {onClick === undefined ? (
        label
      ) : (
        <button
          type="button"
          title={`只看标签「${tag}」`}
          className="truncate underline-offset-2 transition-colors duration-fast hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={(e) => { e.stopPropagation(); onClick(); }}
          onKeyDown={(e) => e.stopPropagation()}
          data-testid={`${testid}-filter`}
        >
          {tag}
        </button>
      )}
      {onRemove !== undefined && (
        <button
          type="button"
          aria-label={`移除标签 ${tag}`}
          disabled={disabled}
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          onKeyDown={(e) => e.stopPropagation()}
          className="rounded-control text-muted-foreground transition-colors duration-fast hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-disabled disabled:text-disabled-foreground"
          data-testid={`${testidPrefix}-tag-remove-${tag}`}
        >
          <X aria-hidden className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

export function TagEditor({
  tags, onChange, onFilter, busy, testidPrefix, compact = false, onEditingChange,
}: {
  tags: readonly string[];
  /** 增删后的**最终集合**——调用方直接拿去保存。 */
  onChange: (next: readonly string[]) => void;
  /** 点一枚标签 ⇒ 按它筛选。不给则标签只读。 */
  onFilter?: (tag: string) => void;
  busy: boolean;
  /** 例如 `inbox-card-B-1` ⇒ 标签 `inbox-card-B-1-tag-<t>`、输入框 `inbox-card-B-1-tag-input`。 */
  testidPrefix: string;
  /** 卡片上的紧凑态：没有标签且没在编辑时只显示一个「+」。 */
  compact?: boolean;
  onEditingChange?: (editing: boolean) => void;
}) {
  const [editing, setEditingState] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const setEditing = (v: boolean) => {
    setEditingState(v);
    onEditingChange?.(v);
  };
  React.useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const full = tags.length >= INBOX_TAGS_MAX_COUNT;
  const commit = () => {
    const t = draft.trim();
    setDraft("");
    // 重复标签直接忽略：标签是集合语义，两个同名标签没有任何额外含义。
    if (t === "" || tags.includes(t) || full) return;
    onChange([...tags, t]);
  };

  return (
    <div
      className={cn("flex flex-wrap items-center gap-1", compact ? "min-h-5" : "min-h-6")}
      data-testid={`${testidPrefix}-tags`}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {!compact && tags.length === 0 && !editing && <span className="text-11 text-muted-foreground">还没有标签</span>}
      {tags.map((t) => (
        <TagChip
          key={t}
          tag={t}
          testidPrefix={testidPrefix}
          onClick={onFilter === undefined ? undefined : () => onFilter(t)}
          onRemove={() => onChange(tags.filter((x) => x !== t))}
          disabled={busy}
        />
      ))}
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          maxLength={INBOX_TAG_MAX_LENGTH}
          disabled={busy}
          aria-label="新标签"
          placeholder="标签，回车添加"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            if (e.key === "Escape") { e.preventDefault(); setDraft(""); setEditing(false); }
          }}
          onBlur={() => { commit(); setEditing(false); }}
          data-testid={`${testidPrefix}-tag-input`}
          className="h-5 w-24 rounded-control border border-input bg-card px-1.5 text-10 text-card-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-disabled disabled:text-disabled-foreground"
        />
      ) : (
        <button
          type="button"
          aria-label="添加标签"
          title={full ? `最多 ${INBOX_TAGS_MAX_COUNT} 个标签` : "添加标签"}
          disabled={busy || full}
          onClick={() => setEditing(true)}
          data-testid={`${testidPrefix}-tag-add`}
          className={cn(
            "inline-flex h-5 items-center gap-0.5 rounded-control border border-dashed border-border px-1 text-10 text-muted-foreground transition-colors duration-fast hover:border-primary hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-foreground",
            compact && tags.length > 0 && "invisible group-hover:visible group-focus-within:visible",
          )}
        >
          {compact ? <Plus aria-hidden className="h-3 w-3" /> : <Tag aria-hidden className="h-3 w-3" />}
          {!compact && "加标签"}
        </button>
      )}
    </div>
  );
}
