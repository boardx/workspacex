/**
 * F162 —— 「取最先触发的那一条」。纯函数，不碰数据库。
 *
 * ## 「最先触发」是什么意思
 *
 * 一次调用可能同时命中多条规则（个人的、团队的、模型的）。产品要的不是「笼统地说超限」，
 * 而是**说清楚是哪一条把你拦下的**。判据：`观测值 / 阈值` 最大的那条最先到达自己的上限，
 * 它就是生效的那条。
 *
 * ⚠ 这条语义借自 phase-03 F14（异常检测三级阈值取最先触发），**只借语义不领 feature**：
 *   这里不做 F14 的四类任务处置矩阵、不做机密数据禁降级——那些要 F14 自己的签核。
 *
 * ## 为什么不是「取最严的动作」
 *
 * 「最严」需要给四个动作排一个全序（block > require_approval > degrade > warn），而那个
 * 全序是**我们现在没有依据可以裁的**：一条「拒绝调用」和一条「需人工批准」哪个更严，
 * 取决于组织怎么运作，不取决于代码。比值判据不需要那个全序，且能给出可解释的答案：
 * 「你在 X 规则上到了 96%，它先到，所以按它处置」。
 *
 * ## 并列时的确定性
 *
 * 比值相同（含两条都是 0 用量、都未触发的情况）时按 `ruleId` 升序取第一条——不是因为
 * 哪条更重要，而是因为**同一批输入必须给出同一个答案**。随机或哈希序会让同一次调用在
 * 两台机器上被不同的规则拦下，而两条日志各自看起来都对。
 */

export interface EvaluableRule {
  readonly ruleId: string;
  readonly thresholdTokens: number;
  readonly observedTokens: number;
  readonly enabled: boolean;
}

export interface TriggeredRule<T extends EvaluableRule> {
  readonly rule: T;
  /** `observed / threshold`。恒 > 1 才算触发（见 `pickFirstTriggered`）。 */
  readonly usedRatio: number;
}

/** `observed / threshold`；阈值非正时记 0（数据库 CHECK 已挡住，这里不让它变成 Infinity）。 */
export function usedRatio(rule: EvaluableRule): number {
  return rule.thresholdTokens > 0 ? rule.observedTokens / rule.thresholdTokens : 0;
}

/**
 * 已触发（`observed >= threshold`）的规则里，比值最大的那条；一条都没触发时返回 null。
 *
 * ⚠ 停用的规则不参与。停用不是「阈值设成无穷大」，是**这条规则现在不存在**——
 * 让它参与再在别处过滤，就会出现「事件里记着一条已停用的规则把人拦下了」。
 */
export function pickFirstTriggered<T extends EvaluableRule>(
  rules: readonly T[],
): TriggeredRule<T> | null {
  const triggered = rules
    .filter((r) => r.enabled && r.thresholdTokens > 0 && r.observedTokens >= r.thresholdTokens)
    .map((rule) => ({ rule, usedRatio: usedRatio(rule) }));
  if (triggered.length === 0) return null;
  return triggered.reduce((best, cur) =>
    cur.usedRatio > best.usedRatio
      ? cur
      : cur.usedRatio < best.usedRatio
        ? best
        // 并列：ruleId 升序取第一条，保证同一批输入恒给同一个答案。
        : (cur.rule.ruleId < best.rule.ruleId ? cur : best),
  );
}
