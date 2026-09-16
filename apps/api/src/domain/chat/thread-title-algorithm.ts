/**
 * **会话级标题**的算法 —— 什么时候重算、拿哪些消息去算、算出来了要不要落地。
 * 纯函数，零 I/O，唯一的一处规则（2026-09-16 人类指令：「整个 chat 的 session 需要有
 * 一个 title 的 summary，用模型来计算，但是要有一些技巧，建立一个算法来计算」）。
 *
 * ## 为什么要有这份算法：只看首条消息起名，起出来的就是「你好」
 *
 * #2094 的自动命名（`thread-title.ts` + `application/chat/generate-thread-title.ts`）只在
 * **首条**用户消息落库时跑一次。人类 2026-09-16 的实测截图里，侧栏一屏的标题是
 * 「你好」「你好啊」「你可以做什么?」「请检查」「新对话」——每一个都**忠实地**概括了
 * 首条消息，也每一个都找不回那次会话在做什么。根因不在模型也不在截断，在**取材时机**：
 * 一次会话的主题往往在第二、第三条消息才出现，第一条只是打招呼。
 *
 * 「那就每条消息都重算一次」是错的，三条代价都是用户能看见的：
 *   ① **钱和延迟**：起名挂在 `acceptHumanMessage` 上，每条消息重算 = 每条消息多一次
 *      模型往返（`THREAD_TITLE_TIMEOUT_MS` 的封顶也是每条都可能吃满）。
 *   ② **标题会抖**：侧栏卡片名字每说一句就变一次，比一个平淡的名字更难用——用户靠
 *      「我记得它叫什么」找回历史会话，名字一直变等于这条线索不存在。
 *   ③ **越聊越跑偏**：拿最后几条消息去概括，长会话的标题会漂成最后一个话题，
 *      丢掉这次会话真正在做的事。
 *
 * 所以本文件是三件**互相独立**的判定，合起来才是「技巧」：
 *
 *   1. `planTitleRefresh` —— **什么时候算**：固定阶梯 `TITLE_REFRESH_LADDER`，
 *      一条线程一生最多算 `TITLE_REFRESH_LADDER.length` 次，单调不回退。
 *   2. `buildTitleEvidence` —— **拿什么算**：不是整段 transcript，是「首条 + 最近 N 条
 *      用户消息 + 首条助手回复」的定长摘要，逐条按码点截断、总预算封顶。
 *   3. `shouldReplaceTitle` —— **算完要不要落地**：信息增益门。新名字没比旧名字多说
 *      出什么（同义、包含、依然是寒暄）就不写，宁可留着上一档的结果也不让它抖。
 *
 * ⚠ 三件都是纯函数且是各自唯一的入口。写入判定本身仍在 SQL 里
 *   （`pg-chat-repository.ts` 的 `autoTitleThread`：`title_source <> 'user'` +
 *   `auto_title_stage < $stage`）——本文件负责「该不该」，SQL 负责「并发下也确实只有
 *   一次」，不是同一件事声明两处。
 */

/** 标题当前归谁。与迁移 `20260916030000` 的 `chat_threads.title_source` 闭集逐字一致。 */
export type ThreadTitleSource = "default" | "auto" | "user";

/**
 * **重算阶梯**：线程累计人类消息数达到这些档位时各重算一次标题。档位 i（从 1 数）
 * 对应 `auto_title_stage = i`。
 *
 * 为什么是 1 / 4 / 12 而不是「每 N 条」：
 *   · **1**：首条就得有个名字，否则卡片在整轮对话期间都叫「新对话」（这是 #2094 的
 *     既有行为，本算法不退化它）。
 *   · **4**：实测里「你好 → 真正的诉求」这个形状在前三四条消息内一定展开完了。这是
 *     捞回「你好」类会话的那一档，也是收益最大的一档。
 *   · **12**：长会话往往中途换了题。再给一次，之后**不再改**——一个到某个点就稳定下来
 *     的名字才能被记住。
 * 上限即 `length`：一条线程一生最多三次模型往返，与消息数无关。
 */
export const TITLE_REFRESH_LADDER: readonly number[] = [1, 4, 12];

/** 每一档取多少条**最近的**人类消息进摘要。档位越高，会话越长，需要的上下文越多。 */
const RECENT_HUMAN_BY_STAGE: readonly number[] = [1, 3, 5];

/** 摘要里单条消息的码点上限。超出的部分对「起个名字」没有边际价值，只有 token 成本。 */
export const EVIDENCE_PER_MESSAGE_MAX = 180;

/** 摘要总码点预算。封顶的是**成本**，不是正确性——达到预算后按优先级丢最不重要的。 */
export const EVIDENCE_TOTAL_MAX = 1_200;

/** 新旧标题都是自动名时，新名至少要多出这么多码点的信息才值得改写。见 `shouldReplaceTitle`。 */
const MIN_TITLE_GAIN = 4;

export interface ThreadTitleState {
  /** 标题现在归谁（库里的 `title_source`）。 */
  readonly source: ThreadTitleSource;
  /** 已完成到阶梯第几档（库里的 `auto_title_stage`），0 = 从未自动命名。 */
  readonly stage: number;
  /** 线程累计人类消息数，**含刚落库的这一条**。 */
  readonly humanMessageCount: number;
}

export type TitleRefreshPlan =
  | {
      readonly refresh: true;
      /** 本次要推进到的档位（1 起）。写库时用作 `auto_title_stage < $stage` 的比较值。 */
      readonly stage: number;
      /** 本次摘要取多少条最近人类消息。 */
      readonly recentHumanLimit: number;
    }
  | {
      readonly refresh: false;
      /** 不重算的**理由**。调用点把它记进日志——「标题为什么没变」是实测时第一个要问的。 */
      readonly reason: "user-owned" | "not-at-checkpoint" | "ladder-exhausted";
    };

/**
 * **什么时候算**。纯判定，不发起任何调用。
 *
 * 单调性由 `stage > state.stage` 保证：同一档不会算第二次，回退的档位（并发下先到的
 * 高档已经写入）也不会。用户手动改过名（`source === "user"`）直接出局——这条在这里
 * 短路是为了**省掉注定被 SQL 丢掉的那次模型往返**，真正的不可覆盖仍由 SQL 的
 * `title_source <> 'user'` 保证（同 `isThreadTitleDefault` 与那条 UPDATE 的既有分工）。
 */
export function planTitleRefresh(state: ThreadTitleState): TitleRefreshPlan {
  if (state.source === "user") return { refresh: false, reason: "user-owned" };

  // 达到的最高档位。阶梯升序，从后往前找第一个够得着的。
  let stage = 0;
  for (let i = TITLE_REFRESH_LADDER.length - 1; i >= 0; i -= 1) {
    if (state.humanMessageCount >= (TITLE_REFRESH_LADDER[i] as number)) {
      stage = i + 1;
      break;
    }
  }
  if (stage === 0) return { refresh: false, reason: "not-at-checkpoint" };
  if (stage <= state.stage) {
    return {
      refresh: false,
      reason: state.stage >= TITLE_REFRESH_LADDER.length ? "ladder-exhausted" : "not-at-checkpoint",
    };
  }
  return {
    refresh: true,
    stage,
    recentHumanLimit: RECENT_HUMAN_BY_STAGE[stage - 1] as number,
  };
}

export interface TitleEvidenceMessage {
  readonly role: "human" | "agent";
  readonly body: string;
}

/**
 * **拿什么算**。把一段会话压成一份定长摘要，交给模型。
 *
 * 选材优先级（预算不够时从低优先级开始丢，不是简单地截断尾巴）：
 *   1. **首条有信息量的人类消息** —— 会话的意图锚。丢了它，长会话的标题会漂成最后一个话题。
 *   2. **最近 `recentHumanLimit` 条人类消息** —— 意图在后面才展开的那一半（本算法存在的理由）。
 *   3. **首条助手回复** —— 只取一条、只取开头，用来消歧（用户说「帮我看看这个」时，
 *      主语在助手的回复里）。它是**可丢**的那一项：助手正文最长、最容易把预算吃光。
 *
 * 低信息量消息（`isLowInformation`：寒暄、「在吗」、「你能做什么」）**不进摘要**——它们是
 * 首条消息起名失败的直接原因。全部消息都低信息量时返回 `null`：没有可用输入，调用点据此
 * 让标题停在「新对话」，**不编一个**。
 *
 * @returns 带角色前缀、按时间顺序的多行文本；无可用输入时 `null`。
 */
export function buildTitleEvidence(
  messages: readonly TitleEvidenceMessage[],
  recentHumanLimit: number,
): string | null {
  const usable = messages
    .map((m, index) => ({
      index,
      role: m.role,
      text: clampCodePoints(m.body.replace(/\s+/gu, " ").trim(), EVIDENCE_PER_MESSAGE_MAX),
    }))
    .filter((m) => m.text.length > 0 && !isLowInformation(m.text));
  const humans = usable.filter((m) => m.role === "human");
  const firstAgent = usable.find((m) => m.role === "agent") ?? null;

  if (humans.length === 0) return null;

  // 按优先级收集，再按时间顺序还原——顺序影响模型对「先说什么后说什么」的理解。
  const picked = new Map<number, TitleEvidenceMessage>();
  const take = (index: number, role: "human" | "agent", text: string): boolean => {
    if (picked.has(index)) return true;
    const spent = Array.from(picked.values())
      .reduce((n, p) => n + Array.from(p.body).length, 0);
    if (spent + Array.from(text).length > EVIDENCE_TOTAL_MAX) return false;
    picked.set(index, { role, body: text });
    return true;
  };

  take(humans[0]!.index, "human", humans[0]!.text);
  for (const h of humans.slice(-Math.max(1, recentHumanLimit))) take(h.index, "human", h.text);
  if (firstAgent !== null) take(firstAgent.index, "agent", firstAgent.text);

  const lines = Array.from(picked.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, m]) => `${m.role === "human" ? "用户" : "助手"}：${m.body}`);
  return lines.length === 0 ? null : lines.join("\n");
}

/**
 * **低信息量**判定 —— 这段文字拿去起名，起出来的就是它自己。
 *
 * 判据是「去掉标点空白后，整条消息就是一个寒暄/元问句」，**不是**「短」：「改 K8s 探针」
 * 只有六个字却信息量十足，而「你好呀你好呀」很长也依然没有内容。所以用**归一化后全等**
 * 匹配闭集，不用 `includes`——`includes` 会把「你好，帮我把登录接口的超时改成 30 秒」
 * 也判成寒暄，那是把本算法要救的会话反过来枪毙。
 */
export function isLowInformation(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, "");
  if (normalized.length === 0) return true;
  if (Array.from(normalized).length <= 1) return true;
  if (LOW_INFORMATION_PHRASES.has(normalized)) return true;
  return LOW_INFORMATION_PATTERNS.some((re) => re.test(normalized));
}

/** 寒暄/元问句闭集。归一化（小写 + 去标点空白）之后**全等**比较。 */
const LOW_INFORMATION_PHRASES: ReadonlySet<string> = new Set([
  "你好", "您好", "你好啊", "你好呀", "哈喽", "喂", "在吗", "在不在", "有人吗",
  "早上好", "晚上好", "下午好", "谢谢", "多谢", "好的", "收到", "嗯嗯", "没事了",
  "测试", "试一下", "随便聊聊", "新对话", "请检查",
  "hi", "hello", "hey", "yo", "test", "testing", "ok", "okay", "thanks", "thankyou",
  "goodmorning", "goodevening", "help",
]);

/** 元问句——问的是「你是谁/你能干嘛」，不是一件要办的事。 */
const LOW_INFORMATION_PATTERNS: readonly RegExp[] = [
  /^你(是谁|叫什么|能做什么|可以做什么|会做什么|会什么|有什么功能|能干什么)$/u,
  /^(介绍一下|自我介绍)$/u,
  /^(what|who)(canyoudo|areyou|doyoudo)$/u,
  /^whatcanyoudo$/u,
];

/**
 * **算完要不要落地** —— 信息增益门，本算法防抖的那一半。
 *
 * 拒绝写入的四种情况，每一种都对应一次用户会看见的抖动：
 *   · 候选为空 / 依然是寒暄 —— 模型也没能从这段会话里读出主题，保留现状好过写个更差的。
 *   · 与现名归一化后全等 —— 白写一次 UPDATE，还会自增 `version` 把并发改名顶掉。
 *   · 现名是用户起的 —— 永不覆盖（与 `planTitleRefresh` 同一条纪律，这里是第二道门，
 *     因为调用点可能在读状态之后、写入之前被用户改名抢跑）。
 *   · 新旧互相包含且增量不足 `MIN_TITLE_GAIN` 码点 —— 「登录超时」→「登录超时问题」
 *     不值得让侧栏名字变一次。
 */
export function shouldReplaceTitle(
  current: string,
  candidate: string | null,
  currentSource: ThreadTitleSource,
): boolean {
  if (currentSource === "user") return false;
  if (candidate === null) return false;
  const next = candidate.trim();
  if (next.length === 0 || isLowInformation(next)) return false;
  const prev = current.trim();
  if (prev === next) return false;
  if (currentSource === "default") return true;

  const shorter = prev.length <= next.length ? prev : next;
  const longer = prev.length <= next.length ? next : prev;
  if (longer.includes(shorter)) {
    const gain = Array.from(longer).length - Array.from(shorter).length;
    return gain >= MIN_TITLE_GAIN && longer === next;
  }
  return true;
}

/** 按**码点**截断（不是 UTF-16 code unit）——同 `thread-title.ts` 的既有纪律，
 *  code unit 切分会把 emoji / 罕用汉字劈成半个字。摘要里不加省略号：它是喂给模型的
 *  材料，不是给人看的标题，省略号只会占预算。 */
function clampCodePoints(text: string, max: number): string {
  const points = Array.from(text);
  return points.length <= max ? text : points.slice(0, max).join("");
}
