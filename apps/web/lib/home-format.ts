/** 首页卡片用的「多久以前」。纯函数（`now` 可注入以便单测）；解析不了的时间返回 null，由调用方省略而不是显示 NaN。 */
export function formatRelativeTime(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const sec = Math.max(0, Math.floor((now - t) / 1000));
  if (sec < 60) return "刚刚";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${String(min)} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${String(hour)} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${String(day)} 天前`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${String(month)} 个月前`;
  return `${String(Math.floor(month / 12))} 年前`;
}

/**
 * 头像缩写。`max = 2`（默认）：中文取前两字，英文取两个词的首字母/单词前两个字母；
 * `max = 1`：只取第一个字/字母（小头像放不下两个字）。空名字回落 "?"。
 */
export function initialsOf(name: string, max: 1 | 2 = 2): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "?";
  if (max === 1) return Array.from(trimmed)[0]!.toUpperCase();
  if (/^[一-鿿]/.test(trimmed)) return trimmed.slice(0, 2);
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0]!}${parts[1]![0]!}`.toUpperCase();
  return trimmed.slice(0, 2).toUpperCase();
}
