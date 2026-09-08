/**
 * 2026-09-08——收件箱标签的领域规则（纯函数）。
 *
 * 标签是**集合**语义：去首尾空白、去空、去重（保留首次出现的顺序）。契约层
 * （`InboxTag`）已经挡掉了空与超长，这里再做一次是为了让"两个只差空白的重复标签"
 * 不会以两条身份落库——`error_logs.tags` 那条写路径（`update-system-error-lifecycle.ts`）
 * 与本侧表共用这一个函数。
 */
export function normalizeInboxTags(tags: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const t = raw.trim();
    if (t === "" || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}
