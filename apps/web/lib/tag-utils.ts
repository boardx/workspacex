/**
 * 标签的纯函数——**全仓唯一一份**（2026-09-30 人类要求「统一 tag 的创建、搜索体验」）。
 *
 * 此前每个页面各写各的：有的精确比较、有的不去重；搜索有的含标签、有的只搜名称；
 * 词表有的从列表聚合、有的走接口。这里只收敛「怎么比较、怎么匹配、怎么聚合」，
 * 不认识任何业务对象，也不碰后端契约——各模块的上限（个数/长度）仍由它自己的契约常量决定。
 */

/** 去首尾空白、把连续空白折成一个空格。 */
export function normalizeTag(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/** 两个标签是否同一个：忽略大小写与首尾空白（「Client」「client 」同一个）。 */
export function sameTag(a: string, b: string): boolean {
  return normalizeTag(a).toLocaleLowerCase() === normalizeTag(b).toLocaleLowerCase();
}

/** 是否已含某标签（忽略大小写）。 */
export function hasTag(tags: readonly string[], tag: string): boolean {
  return tags.some((t) => sameTag(t, tag));
}

/** 规范化并按「忽略大小写」去重，保留先出现的写法与顺序；空串丢弃。 */
export function dedupeTags(tags: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    const t = normalizeTag(raw);
    if (t !== "" && !hasTag(out, t)) out.push(t);
  }
  return out;
}

/**
 * 把一批带 `tags` 的条目聚合成「标签 → 用量」，按用量降序、同量按字典序。
 * 忽略大小写合并，显示用最先出现的写法。
 */
export function aggregateTags(items: ReadonlyArray<{ readonly tags?: readonly string[] | null }>): Map<string, number> {
  const counts = new Map<string, { label: string; n: number }>();
  for (const item of items) {
    for (const raw of item.tags ?? []) {
      const t = normalizeTag(raw);
      if (t === "") continue;
      const key = t.toLocaleLowerCase();
      const hit = counts.get(key);
      if (hit === undefined) counts.set(key, { label: t, n: 1 });
      else hit.n += 1;
    }
  }
  return new Map(
    [...counts.values()]
      .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, "zh-CN"))
      .map((v) => [v.label, v.n] as const),
  );
}

export type TagMatchMode = "any" | "all";

/**
 * 条目的标签是否满足当前筛选。`selected` 为空 = 不过滤。
 * `any`（默认）= 命中任一所选标签；`all` = 必须同时含所有所选标签。
 */
export function matchesTags(itemTags: readonly string[], selected: readonly string[], mode: TagMatchMode = "any"): boolean {
  if (selected.length === 0) return true;
  return mode === "all" ? selected.every((s) => hasTag(itemTags, s)) : selected.some((s) => hasTag(itemTags, s));
}

/**
 * 搜索框的统一口径：查询词（忽略大小写）命中「名称/描述等文本字段」**或任一标签**即命中。
 * 查询词为空 = 不过滤。所有客户端搜索都走这里，页面不再各自拼 `includes`。
 */
export function matchesQuery(
  query: string,
  fields: ReadonlyArray<string | null | undefined>,
  tags: readonly string[] = [],
): boolean {
  const q = normalizeTag(query).toLocaleLowerCase();
  if (q === "") return true;
  return [...fields, ...tags].some((f) => typeof f === "string" && f.toLocaleLowerCase().includes(q));
}

/** 搜索框统一占位文案：明确告诉用户标签也能搜。 */
export function searchPlaceholder(business: string): string {
  return `搜索${business}名称或标签`;
}
