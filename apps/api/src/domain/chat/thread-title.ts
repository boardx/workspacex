/**
 * 线程**自动命名** —— 唯一的一处规则（🔴 issue #2094，人类裁决落地，回指 #2068）。
 *
 * 人类 2026-08-26 审计原话：
 * > 对话列表不可辨认——大量「新对话」…无法寻找历史任务。
 * > 改进方向：自动生成任务标题、状态、产物数量和更新时间。
 *
 * `mutate-thread.ts:137` 的 `DEFAULT_PERSONAL_THREAD_TITLE = "新对话"` 旁边逐字留着
 * 「内容自动命名（取首条消息）是后续」。本文件就是那个「后续」。
 *
 * ## 命名来源：截取首条用户消息，**不是**让模型生成摘要
 *
 * 两条路都能产出标题，代价与失败模式完全不同，这里选前者，理由是三条而不是审美：
 *
 *   ① **模型摘要的降级路径必然是截断**。模型超时/限流/不可用时总得给个标题，
 *      而唯一不依赖外部的答案就是截断首条消息。也就是说截断这条路**无论如何都要写**。
 *      先写它，再谈要不要在上面叠一层模型——反过来做，就是在还没有地板的时候盖二楼。
 *   ② **延迟会被用户看见**。标题是侧栏第一眼的东西。模型摘要意味着卡片先叫「新对话」，
 *      几秒后自己变了名字——一个会自己变的标题比一个平淡的标题更难用。
 *   ③ **不可判定**。模型输出不确定，验收用例只能断言「不等于新对话」这种弱条件；
 *      截断是纯函数，可以逐字断言，本文件的单元测试就是这么钉的。
 *
 * ⚠ 这里**故意留了缝**给将来的模型摘要：`deriveThreadTitle` 是纯函数且是唯一入口，
 *   将来若要叠模型，只需在调用点先试模型、失败落回本函数，**不必**再写第二份截断规则。
 *
 * ## 2026-08-27 更新：模型摘要已落地（人类裁决，接受代价）
 *
 * 见 `application/chat/generate-thread-title.ts` 头注——`message-roundtrip.ts` 的调用点
 * 现在先试模型，模型不可用/超时/空结果时落回本文件的 `deriveThreadTitle`。**本文件
 * 一行没改**：`deriveThreadTitle` 仍是纯函数、仍是唯一的截断规则来源，落地的只是
 * `clampModelGeneratedTitle`——它与 `deriveThreadTitle` 共用同一段折叠/码点截断逻辑
 * （`collapseAndClamp`），不是第二份规则。
 *
 * ## 生成时机：服务端，首条用户消息落库时
 *
 * 在 `acceptHumanMessage`（`application/chat/message-roundtrip.ts`）里、消息写入成功
 * 之后触发。**不在前端做**——前端做的话，agui-bridge 自动建的线程（`title: null`）、
 * 刷新、第二个浏览器标签页各自会有不同答案，那就是三份规则。
 *
 * ## 空线程（devapp 实测 58 条里 36 条）
 *
 * 自动命名对它们**没有输入**，本文件也不假装有：一条没发过消息的线程叫什么都是编的。
 * 那个场景由另外两件事回答，都不在本文件：
 *   · 卡片状态显示 `not-started`（`thread-badges.ts` 的 `threadCardStatus`），
 *     让「还没开始」与「已完成」在列表上肉眼可分；
 *   · 前端「新建对话」在已有一条空线程时**复用它而不是再建一条**
 *     （`copilotkit-v2-shell.tsx`），从源头掐掉 36 条的累积。
 *
 * ## 用户能不能改
 *
 * 能，且**走既有通路**：`mutateThread` 的 `op: "rename"` 早就端到端实现了
 * （`mutate-thread.ts:306` → `pg-chat-repository.ts:311`），卡片「…」菜单里的
 * `handleRename` 也早就接好了。本 issue **不新造改名能力**。
 *
 * 自动命名与手动改名的优先级由一条 SQL 条件保证、而不是由约定保证：自动命名的
 * UPDATE 带 `WHERE title = '新对话'`，所以只要用户改过名，自动命名就是个 no-op。
 * 见 `pg-chat-repository.ts` 的 `autoTitleThread`。
 *
 * ## 2026-09-16 更新：取材时机改成**会话级**，本文件仍是截断规则的唯一来源
 *
 * 只看首条消息起名，在「你好」开头的会话上起出来的就是「你好」（人类实测截图）。
 * 什么时候重算 / 拿哪些消息算 / 算完要不要落地，三件判定都在
 * `domain/chat/thread-title-algorithm.ts`——**本文件依旧一行没改**：`deriveThreadTitle`
 * 仍是第 1 档模型不可用时唯一的落地点，`clampModelGeneratedTitle` 仍是模型结果落库前
 * 唯一的折叠/码点截断入口。
 */

/** 标题上限。远小于 `normalizeTitle` 的 200，侧栏一行放得下才有意义。 */
export const AUTO_TITLE_MAX_LENGTH = 24;

/** 超长时的省略号。单字符，计入 `AUTO_TITLE_MAX_LENGTH`。 */
const ELLIPSIS = "…";

/**
 * 从首条用户消息正文推导线程标题。**纯函数**。
 *
 * 规则（逐条都有理由，不是随手写的）：
 *   · 换行、制表、连续空白**折叠成单个空格**——侧栏是单行，原样带换行会让
 *     `title` 里藏着界面上看不见的字符，搜索与断言都会莫名其妙地不匹配。
 *   · 首尾空白去掉。
 *   · 按 **Unicode 码点**（不是 UTF-16 code unit）截断：`"…".length` 之类的
 *     长度算术遇到 emoji / 罕用汉字会把一个字劈成两半，产出乱码标题。
 *   · 截断后加省略号，**总长仍 ≤ 上限**。
 *
 * @returns 推导出的标题；正文为空白（没有可用输入）时返回 `null`——
 *          返回空串会写进 `title` 列，产出一张没有标题的卡片，
 *          那比留着「新对话」更糟：用户看不出是没起名还是起名失败。
 */
export function deriveThreadTitle(body: string): string | null {
  return collapseAndClamp(stripLeadingRequestFraming(body));
}

/**
 * 剥开场白**只在正文本来就装不进标题时**才做。
 *
 * 理由是剥它的收益从哪来：收益只存在于「标题会被截断」这一种情形——那时前十来个码点被
 * 「我要你做一件事」占掉，真正的主题被截掉。正文本来就装得下时，原文已经是完整的，
 * 剥掉动词只会把「帮我写一份周报」变成「写一份周报」：同样不截断、同样七个字、少一个人称，
 * **没有任何收益，还改掉了既有行为**（`thread-title-and-status.test.ts`「短正文原样成为标题」）。
 *
 * 所以这道门不是保守起见，是把改动限制在它真正有用的那一段：短正文逐字节不变。
 */
function needsFramingStrip(collapsed: string): boolean {
  return Array.from(collapsed).length > AUTO_TITLE_MAX_LENGTH;
}

/**
 * 请求式开场白的**闭集**：只删，不改写、不生成。
 *
 * ## 为什么要有这一步（2026-09-22，人类实测截图）
 *
 * 那条线程的标题是「做一个深度研究，关于 AI 原型转型在中国的高…」——24 个码点用完了，
 * 而**信息量最大的那一半被截掉了**：真正的主题是「AI 原型转型在中国的高校的实践」（14 个码点，
 * 根本不需要省略号）。前 10 个码点讲的是「我要你做一件事」这个所有消息都成立的事实。
 *
 * ⚠ 这条落回路径在本地版是**常态而不是例外**：起名的模型往返只有 3 秒预算
 * （`THREAD_TITLE_TIMEOUT_MS`），而它与用户刚发起的那次 run 抢同一个本地模型槽——实测冷启
 * 一次起名要 6.2 秒，必然超预算 ⇒ 落回本函数。所以本函数的产出质量，就是本地版大多数
 * 线程标题的质量。
 *
 * ## 纪律：只删已知前缀，且删完必须还剩得下东西
 *
 * 不做分词、不做改写、不猜语义——只在**开头**匹配一组固定措辞并删掉它。删完若剩不下
 * 至少 `MIN_TOPIC_POINTS` 个码点（例如「帮我写一下」整句都是框架），就**原样返回**：
 * 一个更短但无意义的标题比一个带框架的长标题更糟。
 */
const REQUEST_FRAMING = [
  "做一个深度研究，关于", "做一个深度研究关于", "做一个深度研究",
  "帮我做一个", "帮我写一个", "帮我写一下", "帮我生成一个", "帮我生成", "帮我分析一下", "帮我分析", "帮我查一下", "帮我查", "帮我",
  "请帮我", "请你", "请问", "请",
  "我想要", "我想", "我需要",
  "写一个", "写一份", "写一下", "生成一个", "生成一份", "生成",
  "分析一下", "分析", "研究一下", "研究", "调研一下", "调研",
  "总结一下", "总结", "介绍一下", "介绍",
] as const;

/** 删掉开场白后至少要剩下这么多码点，否则原样返回（见 `REQUEST_FRAMING` 的纪律一节）。 */
const MIN_TOPIC_POINTS = 4;

/** 开场白后面常跟的连接词/标点，一并删掉——留着它们会让标题以「，」或「关于」开头。 */
const LEADING_CONNECTORS = /^[\s,，、:：。.!！?？~—-]*(?:关于|有关|针对)?[\s,，、:：]*/u;

function stripLeadingRequestFraming(body: string): string {
  const text = body.replace(/\s+/gu, " ").trim();
  if (!needsFramingStrip(text)) return body;
  // 最长优先：「做一个深度研究，关于」必须先于「做一个」被匹配到，否则只会剥掉一层。
  const framing = [...REQUEST_FRAMING].sort((a, b) => b.length - a.length)
    .find((prefix) => text.startsWith(prefix));
  if (framing === undefined) return body;
  const rest = text.slice(framing.length).replace(LEADING_CONNECTORS, "");
  return Array.from(rest).length >= MIN_TOPIC_POINTS ? rest : body;
}

/**
 * 折叠/截断的共享实现——`deriveThreadTitle`（首条消息截断）与
 * `clampModelGeneratedTitle`（模型摘要的收尾处理）**必须**共用同一段规则，
 * 不能各写一份：那会是「同一事实声明在两处」，两处上限/码点纪律迟早漂移。
 */
function collapseAndClamp(text: string): string | null {
  const collapsed = text.replace(/\s+/gu, " ").trim();
  if (collapsed.length === 0) return null;

  // `Array.from` 按码点切分；`slice` 直接按 code unit 会劈开代理对。
  const points = Array.from(collapsed);
  if (points.length <= AUTO_TITLE_MAX_LENGTH) return collapsed;
  return points.slice(0, AUTO_TITLE_MAX_LENGTH - 1).join("") + ELLIPSIS;
}

/**
 * 模型生成的标题落地前的收尾——**不信任模型已经产出一个干净的短标题**：模型可能
 * 带换行/多余空白，也可能超出 `AUTO_TITLE_MAX_LENGTH`（prompt 只是要求，不是约束）。
 * 复用 `collapseAndClamp`，与 `deriveThreadTitle` 逐字同一套折叠/截断规则——见本文件
 * 「2026-08-27 更新」一节。空白/空结果同样返回 `null`，调用点据此落回
 * `deriveThreadTitle(首条消息原文)`，而不是把一个空标题写进 `title` 列。
 */
export function clampModelGeneratedTitle(text: string): string | null {
  return collapseAndClamp(text);
}
