/** 运行卡片 / 详情页头部共用的小格式化：用时、时间。 */
export function formatRunDuration(startIso: string, endIso: string): string | null {
  const ms = Date.parse(endIso) - Date.parse(startIso);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${Math.max(sec, 1)} 秒`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分 ${sec % 60} 秒`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时 ${min % 60} 分`;
  return `${Math.floor(h / 24)} 天 ${h % 24} 小时`;
}

export function formatRunTime(iso: string): string | null {
  return formatDateTime(iso);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 统一时间格式（本地时区，零填充）：2026-09-30 13:29。无法解析返回 null。 */
export function formatDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
