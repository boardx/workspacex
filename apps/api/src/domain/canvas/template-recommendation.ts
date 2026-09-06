/**
 * 「现在该推荐哪几个画布模板」——`recommendCanvasTemplates`（issue #2825）的**全部
 * 判定逻辑**，纯函数，不做 I/O。
 *
 * ## 为什么这条规则要住在一个纯函数里
 *
 * 它替换掉的是前端 `copilotkit-v2-panel-body.tsx` 里那条写死的「生成用户画像」chip：
 * 一条常量、永不变化、与后台模板库无关。把新规则放回前端只是把一份写死的清单换成
 * 另一份写死的清单；放进用例文件则要起数据库才能断言「画像之后推荐旅程图」。这里
 * 是唯一一处判定，输入全是已经取好的事实，测试直接喂表格断言。
 *
 * ## 输入的两件事实，各自的来源
 *
 * · `threadText`——线程里全部已落库消息正文（调用方拼接）。从中扫 ```` ```canvas ````/
 *   ```` ```persona ```` 围栏的 `模板: <key>` 行，得到「这条线程已经画过哪些模板」。
 *   那个格式不是为本函数发明的：它是 `buildCanvasTemplateGuidance`（issue #1493）
 *   写进 system prompt、模型照着产出的既有围栏语法，也是前端
 *   `lib/canvas/canvas-fence.ts` 渲染时认的同一份语法。
 * · `published`——当次对这个人可见的已发布模板（key/displayName/recommendAfter）。
 *   「可不可见」由 `listTemplates` 判过，本函数不再判第二次。
 *
 * ## 三条判定，没有第四条
 *
 * ① 线程里画过的模板，取它们各自的 `recommendAfter`，按「被推荐次数多的在前，
 *    并列时按模板库顺序」排序。
 * ② 已经画过的模板不再推荐——重画一遍除了多花一次模型调用什么也不会变（同
 *    `personaGeneratedOnce` 那条既有理由）。
 * ③ 线程里一个画布都没有 ⇒ 推荐**起点模板**：在当次这张推荐图里入度为 0 的已发布
 *    模板。不另写一份「起点清单」常量——那会是同一件事实的第二处声明，且组织改了
 *    推荐关系之后立刻对不上（本仓栽过五次的形状，见 AGENTS.md）。
 *
 * ⚠ `recommendAfter` 里指向不存在/未发布/不可见模板的 key 一律**跳过**，不报错：
 *   写入时不校验存在性是契约明写的决定（见 `updateTemplateMetadata.in.recommendAfter`），
 *   所以消费端必须能安静地容忍它。
 */
import { extractMermaidBlocks } from "@repo/fabric-markdown/markdown";
import { parseTemplateText } from "@repo/fabric-markdown/templates";

/** 一条已发布模板行——本函数只要这三栏，不吃整个 `CanvasTemplateListing`。 */
export interface RecommendableTemplate {
  readonly key: string;
  readonly displayName: string;
  /** 库里那一列（内置模板的空值已由读路径按 `BUILTIN_RECOMMEND_AFTER` 兜底）。 */
  readonly recommendAfter: readonly string[];
}

export interface TemplateRecommendation {
  readonly key: string;
  readonly displayName: string;
}

/**
 * 线程正文里出现过哪些画布模板 key（去重，保持首次出现顺序）。
 *
 * ```persona 是 `模板: persona` 的别名（`template-engine` 文件头，前端
 * `canvas-fence.ts` 逐字同款判定），所以围栏语言本身就是 key；```canvas 则读
 * 第一行的 `模板: <key>`。解析不出 key 的围栏跳过——流式途中被截断的半截围栏
 * （`closed: false`）就是这种，它不是「格式错了」，只是还没写完。
 */
export function detectCanvasTemplateKeys(threadText: string): readonly string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const block of extractMermaidBlocks(threadText)) {
    if (block.lang !== "canvas" && block.lang !== "persona") continue;
    const key = block.lang === "persona"
      ? "persona"
      : (parseTemplateText(block.code).templateKey ?? "").trim();
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    ordered.push(key);
  }
  return ordered;
}

/**
 * 起点模板 = 在当次这张推荐图里没有任何已发布模板指向它的那些（入度为 0），
 * 按「它自己能带出多少后续」（出度）从多到少排，并列按模板库顺序。
 *
 * ## 为什么起点之间还要再排一次序，而不是直接按模板库顺序取前几个
 *
 * 入度为 0 的模板通常有十个左右（默认配置下：用户画像 / HMW / PESTEL / SWOT /
 * AI 战略画布 / 黄金圈 / 三视角 / 汉堡沟通 / 戏剧结构…），而建议行只放得下 3 条。
 * 按模板库顺序（`ORDER BY key`）取前三，选出来的是**按 key 的字典序**排在最前的
 * 三个——那是一个与"适不适合开场"完全无关的顺序，实测结果是「AI 战略画布 / 汉堡
 * 沟通模型 / 戏剧结构金字塔」，对一段刚开始的对话毫无意义。
 *
 * 出度是这张图里**现成的、会随后台配置一起变**的信号：一个能带出三个后续步骤的
 * 模板（用户画像 → 旅程图/同理心/JTBD）在方法论上就是比一个谁也带不出的模板更像
 * 开场。它是一个**启发式**，不是断言"出度高就一定该先画"——但它比字典序诚实，
 * 而且不需要引入第二份"哪些算开场模板"的清单（那正是本仓反复栽跟头的形状）。
 *
 * 导出是为了让「组织把推荐关系全清空之后，起点是不是变成全部模板」这类问题能在
 * 一个纯函数上被断言，而不是等一次 HTTP 往返（同 `list-templates.ts` 的 `statusesFor`
 * 那条既有理由）。
 */
export function entryTemplates(
  published: readonly RecommendableTemplate[],
): readonly RecommendableTemplate[] {
  const pointedAt = new Set<string>();
  for (const t of published) for (const next of t.recommendAfter) pointedAt.add(next);
  const order = new Map(published.map((t, i) => [t.key, i] as const));
  return published
    .filter((t) => !pointedAt.has(t.key))
    .sort((a, b) =>
      (b.recommendAfter.length - a.recommendAfter.length)
      || ((order.get(a.key) ?? 0) - (order.get(b.key) ?? 0)));
}

export function recommendTemplates(input: {
  /**
   * 这条线程已经画过哪些模板。**由调用方算好传进来**，本函数不自己扫正文——
   * 「画过」有两个来源：`detectCanvasTemplateKeys` 认的 canvas 围栏，以及
   * `summarizePersonaFromThread` 那条产出（它落的是 mermaid mindmap 围栏 +
   * 一条 `PERSONA_SUMMARY_AUTHOR_ID` 的 assistant 消息，正文里**没有** canvas
   * 围栏，扫不出来）。第二个来源要读消息的 `authorId`，那是 chat 领域的事实，
   * 不该被拖进一个 canvas 领域的纯函数里。
   */
  readonly drawnKeys: readonly string[];
  readonly published: readonly RecommendableTemplate[];
  /** chip 最多几条——契约 `out.items` 的上限（`.max(4)`）由调用方传，本函数不硬编码。 */
  readonly limit: number;
}): readonly TemplateRecommendation[] {
  const byKey = new Map(input.published.map((t) => [t.key, t] as const));
  const already = new Set(input.drawnKeys);

  // 线程里还一个画布都没有：推起点模板（判定③）。
  if (already.size === 0) {
    return entryTemplates(input.published)
      .slice(0, input.limit)
      .map((t) => ({ key: t.key, displayName: t.displayName }));
  }

  // 判定①：已画过的模板各自的下一步，统计被推荐次数。
  const votes = new Map<string, number>();
  for (const key of already) {
    const source = byKey.get(key);
    if (source === undefined) continue; // 画过一个已停用/已不可见的模板——没有下一步可推。
    for (const next of source.recommendAfter) {
      if (!byKey.has(next)) continue; // 指向不存在/未发布/不可见的 key，安静跳过。
      if (already.has(next)) continue; // 判定②：画过的不再推荐。
      votes.set(next, (votes.get(next) ?? 0) + 1);
    }
  }

  // 并列时按模板库顺序（`listTemplates` 的 `ORDER BY key, version`）——一个稳定、
  // 与调用次数无关的顺序，避免同一条线程刷新两次 chip 换位置。
  const order = new Map(input.published.map((t, i) => [t.key, i] as const));
  return [...votes.entries()]
    .sort((a, b) => (b[1] - a[1]) || ((order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0)))
    .slice(0, input.limit)
    .map(([key]) => ({ key, displayName: byKey.get(key)!.displayName }));
}

/**
 * 点这条 chip 要发出去的那句话。**服务端拼**——「怎么让模型照这个模板产出围栏」
 * 是 `buildCanvasTemplateGuidance` 那套格式约定的一部分（`模板: <key>` 首行、
 * ```` ```canvas ```` 围栏），前端再拼一遍就是同一条规则的第二份副本。
 *
 * 这里只说「用哪个模板、基于本次对话」，**不重复围栏格式说明**：那段已经在
 * system prompt 里（每次 run 都注入），在用户消息里再写一遍既占 token 又会与
 * 那一份漂移。
 */
export function buildRecommendationPrompt(t: TemplateRecommendation): string {
  return `请基于我们目前这段对话的内容，用「${t.displayName}」（模板 key：${t.key}）`
    + `这个工作坊协作画布模板，产出一份 canvas 围栏。只写对话里真实出现过的信息，`
    + `没有依据的分区留空，不要编造。`;
}
