"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface TagFilterOption {
  /** 选择/匹配用的值（字符串标签就是标签本身；白板这类「标签是 id」的模型传 id）。 */
  readonly tag: string;
  /** 显示名；不给就显示 `tag`。 */
  readonly label?: string;
  /** 有这个标签的条目数（可选，显示在标签后）。 */
  readonly count?: number;
}

/**
 * 标签筛选栏——**全仓唯一一份**（2026-09-30 人类要求统一标签的搜索体验）。
 *
 * 此前各页各写：单选 / 多选 OR / 多选 AND 并存，样式与折叠方式也不同。统一为：
 *   · 第一项「全部标签」= 清除筛选；
 *   · 默认**多选**（命中任一，`mode="multi"`）；历史上本来是单选的页面传 `mode="single"`；
 *   · 标签太多时只露出前 `maxVisible` 个 +「更多标签 (n)」，已选中的标签永远露出；
 *   · 可选用量数字。
 * 这里只管选择状态，匹配逻辑在 `lib/tag-utils.ts` 的 `matchesTags`。
 * testid：`${prefix}-tag-all` / `${prefix}-tag-${tag}` / `${prefix}-tag-more`。
 */
export function TagFilterBar({
  tags, selected, onChange, prefix, business, mode = "multi", match = "any", maxVisible = 8, className, extras, allActive,
}: {
  tags: readonly TagFilterOption[];
  selected: readonly string[];
  onChange: (next: readonly string[]) => void;
  prefix: string;
  /** 「按标签筛选{business}」读屏标签。 */
  business: string;
  mode?: "single" | "multi";
  /** 多选时的匹配规则，仅用于提示文案（真正的匹配在页面/后端用 `matchesTags`）：默认命中任一；设计工作台是签核过的「同时包含」。 */
  match?: "any" | "all";
  maxVisible?: number;
  className?: string;
  /** 「全部标签」后面的额外筛选项（如白板的「无标签」）。 */
  extras?: React.ReactNode;
  /** 覆盖「全部标签」的高亮判断（有额外筛选项生效时它不该亮）。默认：没选任何标签就亮。 */
  allActive?: boolean;
}) {
  const [expanded, setExpanded] = React.useState(false);
  if (tags.length === 0 && extras === undefined) return null;
  const allOn = allActive ?? selected.length === 0;

  const visible = expanded
    ? tags
    : tags.filter((o, i) => i < maxVisible || selected.includes(o.tag));
  const hidden = tags.length - visible.length;

  const toggle = (tag: string) => {
    if (mode === "single") onChange(selected.includes(tag) ? [] : [tag]);
    else onChange(selected.includes(tag) ? selected.filter((t) => t !== tag) : [...selected, tag]);
  };

  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-2", className)} role="group" aria-label={`按标签筛选${business}`}>
      <Button
        size="sm"
        variant={allOn ? "primary" : "outline"}
        aria-pressed={allOn}
        data-testid={`${prefix}-tag-all`}
        onClick={() => onChange([])}
      >
        全部标签
      </Button>
      {extras}
      {visible.map((o) => (
        <Button
          key={o.tag}
          size="sm"
          className="max-w-full whitespace-normal break-all text-left"
          variant={selected.includes(o.tag) ? "primary" : "outline"}
          aria-pressed={selected.includes(o.tag)}
          data-testid={`${prefix}-tag-${o.tag}`}
          onClick={() => toggle(o.tag)}
        >
          {o.label ?? o.tag}
          {o.count !== undefined ? <>{" "}<span className="text-10 opacity-70">{String(o.count)}</span></> : null}
        </Button>
      ))}
      {mode === "multi" && selected.length > 1 ? (
        <span className="text-11 text-muted-foreground" data-testid={`${prefix}-tag-rule`}>
          {match === "all" ? "显示同时包含所选标签的" : "显示包含任一所选标签的"}
        </span>
      ) : null}
      {hidden > 0 || (expanded && tags.length > maxVisible) ? (
        <Button size="sm" variant="ghost" data-testid={`${prefix}-tag-more`} aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          {expanded ? "收起" : `更多标签 (${String(hidden)})`}
        </Button>
      ) : null}
    </div>
  );
}
