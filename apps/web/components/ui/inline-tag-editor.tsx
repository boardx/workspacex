"use client";
import * as React from "react";
import { Plus, Tag } from "lucide-react";
import { TagChip } from "@/components/ui/tag-chip";
import { cn } from "@/lib/utils";
import { hasTag, normalizeTag, sameTag } from "@/lib/tag-utils";

/**
 * 卡片/行里的**内联标签编辑器**——全仓唯一一份（2026-09-30 人类要求统一标签创建体验）。
 *
 * 由收件箱的 `TagEditor`（2026-09-08）泛化而来，项目卡、收件箱卡/行/drawer 共用：
 * 已有标签是可删胶囊（给 `onFilter` 时点标签 = 按它筛选）+ 一个「+ 标签」按钮，点开是内联输入框；
 * 回车 / 逗号（中英文）确认，IME 组合输入期间不确认，Esc 取消，失焦把草稿并进去；
 * 忽略大小写去重；满额时禁用「+」并说明。已有标签词表（`knownTags`）用原生 datalist 做补全。
 *
 * ## 每次增删就是一次完整保存（`onChange` 拿到的是最终集合）
 * 标签是集合语义，「删掉一个」本身就是完整意图；攒到一个「保存」按钮上会停在「看起来删了、刷新又回来」的假象里。
 *
 * ## 事件不冒泡
 * 编辑器总是嵌在「整张卡片 / 整行本身就是打开按钮」且可能可拖拽的容器里：click / keydown / pointerdown
 * 全部 `stopPropagation`，否则在输入框里按空格会打开 drawer、按 Enter 会同时触发卡片的「打开」。
 * 拖拽：调用方拿 `onEditingChange` 在编辑期间关掉 `draggable`。
 *
 * testid：包裹 `${p}-tags`；胶囊 `${p}-tag-${tag}`（筛选 `…-filter`、移除 `${p}-tag-remove-${tag}`）；
 * 输入框 `${p}-tag-input`；添加按钮 `${p}-tag-add`。
 */
export function InlineTagEditor({
  tags: tagsIn, onChange, onFilter, busy = false, testidPrefix, compact = false, onEditingChange,
  maxTags, maxTagLength, knownTags, error,
}: {
  /** 契约里必给，但真实响应/夹具可能漏——缺省成 `[]`，宁可少显示也不白屏。 */
  tags: readonly string[] | undefined;
  onChange: (next: readonly string[]) => void;
  onFilter?: (tag: string) => void;
  busy?: boolean;
  testidPrefix: string;
  /** 卡片上的紧凑态：没有标签且没在编辑时只显示一个「+」。 */
  compact?: boolean;
  onEditingChange?: (editing: boolean) => void;
  maxTags: number;
  maxTagLength: number;
  /** 已有标签（`标签 → 用量`），给输入框做补全。 */
  knownTags?: ReadonlyMap<string, number>;
  /** 保存失败的一句话（调用方给，显示在编辑器旁）。 */
  error?: string | null;
}) {
  const tags = React.useMemo<readonly string[]>(() => tagsIn ?? [], [tagsIn]);
  const [editing, setEditingState] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const composing = React.useRef(false);
  const listId = React.useId();
  const setEditing = (v: boolean) => {
    setEditingState(v);
    onEditingChange?.(v);
  };
  React.useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const full = tags.length >= maxTags;
  const commit = () => {
    const t = normalizeTag(draft).slice(0, maxTagLength);
    setDraft("");
    // 重复（忽略大小写）直接忽略：标签是集合语义，两个同名标签没有任何额外含义。
    if (t === "" || hasTag(tags, t) || full) return;
    onChange([...tags, t]);
  };

  const suggestions = React.useMemo(
    () => [...(knownTags?.keys() ?? [])].filter((k) => !hasTag(tags, k)).slice(0, 20),
    [knownTags, tags],
  );

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
          testId={`${testidPrefix}-tag-${t}`}
          removeTestId={`${testidPrefix}-tag-remove-${t}`}
          filterTestId={`${testidPrefix}-tag-${t}-filter`}
          filterTitle={`只看标签「${t}」`}
          onClick={onFilter === undefined ? undefined : () => onFilter(t)}
          onRemove={() => onChange(tags.filter((x) => !sameTag(x, t)))}
          disabled={busy}
        >
          {t}
        </TagChip>
      ))}
      {editing ? (
        <>
          <input
            ref={inputRef}
            value={draft}
            maxLength={maxTagLength}
            disabled={busy}
            aria-label="新标签"
            placeholder="标签，回车添加"
            list={suggestions.length > 0 ? listId : undefined}
            onChange={(e) => setDraft(e.target.value)}
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={() => { composing.current = false; }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (composing.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter" || e.key === "," || e.key === "，") { e.preventDefault(); commit(); }
              if (e.key === "Escape") { e.preventDefault(); setDraft(""); setEditing(false); }
            }}
            onBlur={() => { commit(); setEditing(false); }}
            data-testid={`${testidPrefix}-tag-input`}
            className="h-5 w-24 rounded-control border border-input bg-card px-1.5 text-10 text-card-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-disabled disabled:text-disabled-foreground"
          />
          {suggestions.length > 0 ? (
            <datalist id={listId}>
              {suggestions.map((k) => <option key={k} value={k} />)}
            </datalist>
          ) : null}
        </>
      ) : (
        <button
          type="button"
          aria-label="添加标签"
          title={full ? `最多 ${String(maxTags)} 个标签` : "添加标签"}
          disabled={busy || full}
          onClick={() => setEditing(true)}
          data-testid={`${testidPrefix}-tag-add`}
          className={cn(
            "inline-flex h-5 items-center gap-0.5 rounded-full border border-dashed border-border px-1.5 text-10 text-muted-foreground transition-colors duration-fast hover:border-primary hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-foreground",
            compact && tags.length > 0 && "invisible group-hover:visible group-focus-within:visible",
          )}
        >
          {compact ? <Plus aria-hidden className="h-3 w-3" /> : <Tag aria-hidden className="h-3 w-3" />}
          {!compact && "加标签"}
        </button>
      )}
      {error ? <span className="text-10 text-destructive" data-testid={`${testidPrefix}-tags-error`}>{error}</span> : null}
    </div>
  );
}
