/**
 * issue #3389 —— **一轮 assistant 正文只有一份事实：账本里的 `text_delta` 字节。**
 *
 * 本文件是「若干段助手正文 → 这一轮的一段正文」这个组合规则的**唯一**定义，当前唯一
 * 调用点是 `deep-agent-model-provider.ts` 的 `joinTurnAssistantBodies`（落库那行怎么由
 * 本轮的若干段助手正文拼出来）。拼法不许在调用点各写一遍。
 *
 * ⚠ #3394 曾让 `execution-journal-relay.ts` 的 `finish()` 也用它来接受「多条气泡拼起来
 * 等于落库那行」的轮次，实测三条真回归后已回退：`chat_message_id` 只有一个
 * `streamingMessageId`，一个映射只能认领一条气泡。见 issue #3397。
 *
 * 规则本身逐字沿用 #3243 定下的那条（`joinTurnAssistantBodies` 原实现）：逐段 `trim`、
 * 丢空段、逐字重复的段只留一条、用空行拼接。**不要**在任何调用点另写一遍。
 */
export function composeAssistantBodies(bodies: readonly string[]): string {
  const kept: string[] = [];
  const seen = new Set<string>();
  for (const raw of bodies) {
    const body = raw.trim();
    if (body === "" || seen.has(body)) continue;
    seen.add(body);
    kept.push(body);
  }
  return kept.join("\n\n");
}
