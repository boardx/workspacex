/**
 * Phase 18 S8（#4365，epic #4359）——「值得记」前置门控：调抽取模型之前，先用规则判一条消息值不值得抽。
 *
 * 寒暄（「你好」「谢谢」）、纯提问（「项目什么时候上线？」）、很短的应答（「好的」「收到」）里没有可以长期记住的东西，
 * 却每条都要花一次抽取模型调用。这里把它们挡在模型之前；被挡下的消息照常出队，记一条带原因的结构化日志并计数
 * （`ExtractionSloRecorder`，管理页「记忆抽取 SLO」一栏可见省下了多少次调用）。
 *
 * ## 宁可多抽，不可漏记（方向与 decision-claim.ts / self-intent-claim.ts 相反，理由相同）
 *
 * 门控判错的两种代价不对称：多放过一条寒暄，只是多花一次模型调用；错挡一条「我的目标是…」「预算定为 500 万」，
 * 这句话就**永远**不会被记下（队列行已出队，只有「整理本会话」能补）。所以：
 *
 *   1. **先判保护**：消息里只要出现本人意向（目标 / 偏好 / 打算）、决定性动词（`DECISION_VERBS`，与 decision-claim.ts
 *      同一份词表）或「记住 / 忘掉」这类记忆指令，一律放行给模型——不论它是不是问句、有多短。
 *   2. **再判跳过**：只有整条消息**完全**落在下面三类之一才跳过；混了任何别的内容（数字、实体、第二句话）都放行。
 *      - `greeting`：整条只是问候 / 致谢 / 道别；
 *      - `acknowledgement`：整条只是很短的应答词（≤ 12 个字符）；
 *      - `pure_question`：一句话的提问，且不带数字、不是求证式问句（「预算是 50 万对吗？」在断言内容，放行）。
 *
 * 纯函数，不调模型：同样的消息永远得到同样的结论（可测、可复现）。可选的「便宜模型判一次」在应用层、默认关闭，
 * 而且只看这里判为「放行」且**未受保护**的消息——受保护的消息永远到不了那一步。
 */
import { DECISION_VERBS } from "./decision-claim";
import { INTERROGATIVE, QUESTION_END } from "./question-detection";

export type WorthSkipReason = "greeting" | "acknowledgement" | "pure_question";

export type WorthVerdict =
  | { readonly verdict: "extract"; readonly protectedBy: WorthProtection | null }
  | { readonly verdict: "skip"; readonly reason: WorthSkipReason };

/** 为什么这条消息绝不能跳过（只用于日志与测试断言）。 */
export type WorthProtection = "self_intent" | "decision" | "memory_instruction";

/**
 * 本人意向：目标 / 偏好 / 打算。与 self-intent-claim.ts 判的是**结论**不同，这里判的是**原始消息**，所以更宽：
 * 不要求句首、不排除问句与假设——宁可多放一条给模型。
 */
const SELF_INTENT = new RegExp([
  // 不看主语：「张三的目标是…」「我们的目标是…」也是目标陈述（门控只决定「给不给模型看」，宽一点无害）
  "目标|梦想|愿望|计划|打算|偏好|倾向|喜欢|讨厌|习惯|原则",
  "我的(?:方向)",
  "我(?:想|希望|要|需要|打算|计划|准备|期望|渴望|立志|决心)",
  "我(?:更|比较|最|很|特别|真的|一直|不太?|不怎么)?(?:喜欢|偏好|偏爱|倾向|讨厌|爱|习惯|在意|看重|介意)",
  "\\bmy\\s+(?:goal|plan|aim|preference|dream)s?\\b",
  "\\bi\\s+(?:want|wish|hope|plan|intend|prefer|like|love|hate|dislike|need|aim)\\b",
  "\\bi(?:'d| would)\\s+(?:like|rather|prefer)\\b",
].join("|"), "i");

const DECISION = new RegExp(`${DECISION_VERBS}|定下|定了|拍了板|\\bdecid(?:e|ed|ing)\\b|\\bwe(?:'ll| will)\\b`, "i");

/** 记忆指令（F17 memory-intent 的触发词外加它的否定 / 疑问形式：宽松匹配，只用来「放行」）。 */
const MEMORY_INSTRUCTION = /记住|记下|记一下|记得|别忘|不要忘|忘掉|忘记|别记|不要记|\bremember\b|\bforget\b/i;

/** 去掉标点、空白、表情和语气词之后剩下的「内容」。 */
const NOISE = /[\s\p{P}\p{S}\p{Extended_Pictographic}​﻿]+/gu;
const FILLER_LEAD = /^[啊呀哈呢吧啦嘛哦喔噢哇嗯的了]+/u;

const GREETING_TOKENS = [
  "你好", "您好", "你们好", "大家好", "哈喽", "嗨", "早", "早上好", "早安", "上午好", "中午好", "下午好", "晚上好", "晚安",
  "谢谢", "谢谢你", "谢谢您", "多谢", "感谢", "非常感谢", "太感谢", "辛苦", "辛苦了", "辛苦你", "再见", "拜拜", "回头见", "明天见",
  "hi", "hello", "hey", "morning", "goodmorning", "goodnight", "thanks", "thankyou", "thx", "ty", "bye", "goodbye", "cheers",
];
const ACK_TOKENS = [
  "好", "好的", "好滴", "好嘞", "好吧", "嗯", "嗯嗯", "恩", "哦", "噢", "喔", "行", "可以", "没问题", "收到", "明白", "明白了", "了解",
  "知道", "知道了", "懂", "懂了", "对", "对的", "是", "是的", "没错", "好好", "ok", "okay", "okk", "k", "kk", "yes", "yep", "yeah",
  "sure", "got", "gotit", "noted", "fine", "cool", "nice", "great", "👍",
];

/** 应答类的长度上限（去掉标点空白后）：再长就不是「很短的应答」了。 */
export const WORTH_ACK_MAX_CHARS = 12;
/** 纯提问的长度上限：长问题里常夹着背景陈述（「我们下周上线，预算够吗？」），交给模型。 */
export const WORTH_QUESTION_MAX_CHARS = 60;

/** 求证式问句：「…对吗 / 是吗 / 是不是 / 对不对 / 没错吧」——在断言内容，不是纯提问。 */
const CONFIRMATION = /对吗|是吗|是不是|对不对|没错吧|对吧|是吧|right\s*\?|correct\s*\?/i;
const QUESTION_TAIL = /(?:吗|呢|么|嘛)[\s?？。!！~～]*$/;
const SENTENCE_SPLIT = /[。！!；;\n]|[?？](?=.)/;

function content(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(NOISE, "");
}

/**
 * 整条内容能否被若干个词表里的词（词与词之间、末尾可夹语气词）完整拼出来。至少要命中一个词：
 * 只有语气词（「嗯嗯」之外的「啊啊」）不算问候。
 */
function composedOf(core: string, tokens: readonly string[]): boolean {
  const sorted = [...tokens].map((t) => t.toLowerCase().replace(NOISE, "")).filter((t) => t.length > 0).sort((a, b) => b.length - a.length);
  let rest = core;
  let hits = 0;
  for (let guard = 0; rest.length > 0 && guard < 20; guard += 1) {
    const hit = sorted.find((t) => rest.startsWith(t));
    if (hit !== undefined) {
      hits += 1;
      rest = rest.slice(hit.length);
      continue;
    }
    // 词与词之间 / 末尾的语气词
    const filler = FILLER_LEAD.exec(rest)?.[0] ?? "";
    if (hits === 0 || filler.length === 0) return false;
    rest = rest.slice(filler.length);
  }
  return hits > 0 && rest.length === 0;
}

export function protectionOf(text: string): WorthProtection | null {
  const t = text.normalize("NFKC");
  if (MEMORY_INSTRUCTION.test(t)) return "memory_instruction";
  if (SELF_INTENT.test(t)) return "self_intent";
  if (DECISION.test(t)) return "decision";
  return null;
}

function isPureQuestion(text: string): boolean {
  const t = text.normalize("NFKC").trim();
  const core = content(t);
  if (core.length === 0 || core.length > WORTH_QUESTION_MAX_CHARS) return false;
  if (/\d/.test(t)) return false;                                  // 带数字：「9/29 上线吗」里有可以记的数
  if (CONFIRMATION.test(t)) return false;                          // 求证式：在断言内容
  const sentences = t.split(SENTENCE_SPLIT).map((s) => s.trim()).filter((s) => content(s).length > 0);
  if (sentences.length !== 1) return false;                        // 夹了第二句话（往往是背景陈述）
  return QUESTION_END.test(t) || QUESTION_TAIL.test(t) || (INTERROGATIVE.test(t) && /[?？]/.test(t));
}

/**
 * 一条消息值不值得交给抽取模型。见文件头：先保护、再跳过；拿不准一律 `extract`。
 */
export function judgeWorthRemembering(body: string): WorthVerdict {
  const protectedBy = protectionOf(body);
  if (protectedBy !== null) return { verdict: "extract", protectedBy };
  const core = content(body);
  if (core.length === 0) {
    // 只有表情 / 标点（「👍」「🙂」「？？」）：没有任何文字可记，算应答。真正的空白消息触发器不排；真到这里也交给模型，不猜。
    return body.trim().length > 0 ? { verdict: "skip", reason: "acknowledgement" } : { verdict: "extract", protectedBy: null };
  }
  if (composedOf(core, GREETING_TOKENS)) return { verdict: "skip", reason: "greeting" };
  if (core.length <= WORTH_ACK_MAX_CHARS && composedOf(core, [...ACK_TOKENS, ...GREETING_TOKENS])) {
    return { verdict: "skip", reason: "acknowledgement" };
  }
  if (isPureQuestion(body)) return { verdict: "skip", reason: "pure_question" };
  return { verdict: "extract", protectedBy: null };
}
