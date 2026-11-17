/** Location context only; API authorization remains authoritative. */
export function memberChatProjectFromLocation(pathname: string, search: Pick<URLSearchParams, "getAll">): string | null {
  const candidate = (raw: string | undefined): string | null => {
    if (!raw || raw !== raw.trim() || /[/\\\u0000-\u0020\u007f]/.test(raw) || ["new", "live"].includes(raw)) return null;
    return raw;
  };
  const route = /^\/(?:projects|aidt)\/([^/]+)\/?$/.exec(pathname);
  if (route) {
    try { return candidate(decodeURIComponent(route[1]!)); } catch { return null; }
  }
  const values = search.getAll("projectId");
  return values.length === 1 ? candidate(values[0]) : null;
}
