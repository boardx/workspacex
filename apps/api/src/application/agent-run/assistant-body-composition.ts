/**
 * issue #3389 —— **一轮 assistant 正文只有一份事实：账本里的 `text_delta` 字节。**
 *
 * 本文件是「若干段助手正文 → 这一轮的一段正文」这个组合规则的**唯一**定义。三处用它，
 * 且必须是同一份实现，否则同一句话又会在两处各算一遍：
 *
 *   ① `deep-agent-model-provider.ts` 的 `joinTurnAssistantBodies` —— 落库那行怎么由本轮
 *      的若干段助手正文拼出来；
 *   ② `execution-journal-relay.ts` 的 `finish()` —— 判断 wire 上已经流出去的那些气泡
 *      **是不是已经**逐字拼成了落库那行；是就无事可做。
 *
 * 两处必须是同一份实现。#3389 之前 ② 根本没有「组合」这个概念，只会拿**单条**气泡去和
 * 落库那行比等号——多气泡轮次（先流一段正文、调工具、再流一段）因此必然不成立，于是
 * `finish()` 走「撤回已流出的全部气泡 + 整段重发」，用户看到正文出来又消失（真栈实测
 * 空白窗口 ~1.07s，四轮形状一致）。
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
