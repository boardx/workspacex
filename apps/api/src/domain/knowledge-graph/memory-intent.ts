/**
 * Phase 18 F17 —— 对话里「记住 / 忘掉」的意图识别（uc-18-6 A / B / A1），纯函数。
 *
 * **确定、保守，宁可漏不可误**（R4-A1、R9 误触发率 ≤ 2%）：只认消息**开头**的明确说法，
 * 不交给模型判断，也不猜「这个 / 刚才那个」指的是什么。
 *
 *   记住：「记住：…」「记住，…」「记下来：…」「记一下：…」（冒号 / 逗号必需）；
 *         「请记住 …」「帮我记住 …」（礼貌前缀本身足够明确，分隔符可省）。
 *   忘掉：「忘掉 …」（分隔符可省）；「别再提 …」「不要再提 …」「别再记 …」「不要再记 …」（分隔符可省，但紧跟的字
 *         不能和「提 / 记」组成别的词——「别再提醒我」「不要再记错」不是忘掉，见 TI_COMPOUND / JI_COMPOUND）；
 *         「忘记：…」「忘了：…」「别记：…」「不要记：…」（必须带冒号 / 逗号——「忘记密码怎么办」「忘了带钥匙」不是）。
 *
 * 一律不出卡：内容为空或太短；以问号或疑问语气结尾（「…吧？」「…吗」「…对吗」「…是不是」）；内容里有疑问词
 * （什么 / 谁 / 哪 / 怎么 / 多少 / 几…）；内容只是指代（「这个」「这一点」「这件事」「我刚才说的」）；
 * 记住的内容以商量语气结尾（「…吧」「…好不好」「…行不行」）；忘掉的对象带着下一句（逗号 / 句号），或者说的是对话本身
 * （对话 / 上下文 / 指令 / 规则 / 一切 / 过去 / 烦恼…），或者没有一个能拿去比对的词。记住的内容只取第一句。
 * ——spec 里的「把这个记下来」「这个很重要」「刚才那个说错了」因此都不出卡，照常回答。
 *
 * Issue #4361（phase-18 S4「在对话里管理记忆」）另加两类，同一条纪律（整句规则、宁可漏不可误）：
 *   改口：可选的「我改主意了 / 改主意了 / 想法变了 / 重新想了想…」开头，后面**紧跟**一个改口分句（改成 / 改为 / 换成 / 换为 /
 *         改用 / 换用 / 转为 / 不再 / 把…换成…），只有一句话，不是问句；改口分句本身要过 R8 的 `hasChangeSignal`
 *         （并列补充、否定的改口、假设、说着玩、自我更正都不算）。改的是**哪一条**、自动还是弹卡、还是什么都不做，
 *         全由 R8 的 `planSupersedes` 对本人个人空间里的活决定判（decision-supersede.ts，白名单不在这里复写）。
 *   查看：整句就是在问「你记得我什么」——「你（都）记得我什么 / 哪些事」「你记住了我哪些东西」「关于我你都知道什么」
 *         「你对我了解多少」「列出你记住的关于我的所有内容」「你的记忆里有我的什么」。只认整句：「你记得我昨天说的方案吗」
 *         是一个普通的召回问题（F08 照常回答），「你记得关于客户A的什么」不是在问「我」。
 *   「我忘了密码」「忘记密码怎么办」「遗忘曲线是什么」这类都不是任何一类（没有前缀 / 前缀后没有分隔）。
 */
import { hasChangeSignal } from "./decision-supersede";
import { INTERROGATIVE, QUESTION_END } from "./question-detection";
import { lexicalScore, lexicalTokens, type RecallClaim } from "./recall";

export type MemoryIntent =
  | { readonly kind: "remember"; readonly statement: string }
  | { readonly kind: "forget"; readonly target: string }
  /** #4361：「我改主意了，改成 Y」——statement 是去掉开头之后的那句改口（原话的一段，数据库核对它出自这条消息）。 */
  | { readonly kind: "change"; readonly statement: string }
  /** #4361：「你记得我什么」。 */
  | { readonly kind: "overview" };

/** 契约 KgMemoryCard.items[].statement 的上限。 */
export const MEMORY_CARD_STATEMENT_MAX = 2000;
/** 契约 KgMemoryCard.items 的上限。 */
export const MEMORY_CARD_MAX_ITEMS = 20;
/** 忘掉卡：目标词元至少这么大比例出现在一条记忆里才列出来（比召回的 0.2 严——列出来默认就是勾上的）。 */
export const FORGET_MIN_MATCH = 0.5;

const LEAD = "(?:请你?|麻烦你?)?(?:帮我)?";
const SEP = "\\s*[：:，,]\\s*";
const REMEMBER_WITH_SEP = new RegExp(`^${LEAD}(?:记住|记下来|记下|记一下)${SEP}`);
const REMEMBER_POLITE = /^(?:请你?|麻烦你?)?帮我记住(?![了没吗呢])\s*|^请你?记住(?![了没吗呢])\s*/;
/**
 * 「别再提 / 别再记」后面紧跟的字若能和「提 / 记」组成别的词，就不是「忘掉」：
 * 提醒 / 提交 / 提示 / 提出 / 提供 / 提高 / 提升 / 提到 / 提起 / 提前 / 提问 / 提议 / 提名 / 提取 / 提速 / 提案 / 提要 / 提现 / 提价 / 提防 / 提成 / 提拔 / 提炼 / 提货 / 提纲 / 提款 / 提及 / 提包 / 提携 / 提神 / 提请 / 提供；
 * 记错 / 记得 / 记性 / 记录 / 记住 / 记载 / 记忆 / 记者 / 记号 / 记账 / 记下 / 记着 / 记挂 / 记恨 / 记仇 / 记混 / 记不 / 记分 / 记名 / 记事 / 记叙 / 记述 / 记功 / 记过 / 记牢 / 记清 / 记起 / 记进 / 记入 / 记在 / 记上 / 记成 / 记到。
 * 带冒号 / 逗号时不看这一条（「别再提：提醒的事」照样是忘掉）。
 */
const TI_COMPOUND = "醒交示出供高升到起前问议名取速案要现价防成拔炼货纲款及包携神请";
const JI_COMPOUND = "错得性录住载忆者号账下着挂恨仇混不分名事叙述功过牢清起进入在上成到";
const FORGET_STRONG = new RegExp(
  `^${LEAD}(?:忘掉(?:${SEP}|\\s*)|(?:别再|不要再)(?:提(?:${SEP}|\\s*(?![${TI_COMPOUND}]))|记(?:${SEP}|\\s*(?![${JI_COMPOUND}]))))`,
);
const FORGET_WITH_SEP = new RegExp(`^${LEAD}(?:忘记|忘了|别记|不要记)${SEP}`);

/** 句末的疑问语气：「…吗」「…对吗」「…是不是」——是在问，不是在交代。 */
const QUESTION_TAIL = /(?:吗|呢|么|对吗|是吗|好吗|行吗|是不是|对不对|是否)$/;
/** 只有指代、没有内容：说的是「前面那个」，但前面哪个——不猜。 */
const DEICTIC_ONLY = /^(?:(?:这|那|它|上面|刚才|刚刚|以上|前面|之前)(?:个|些|条|件|句|事|点|一点|的|说的|提到的|那个|那条|这条|的话|的内容)*|一点|我(?:刚才|刚刚|上面|前面|之前)?说的(?:话|内容)?|刚说的(?:话)?)[。.!！~～]*$/;
/**
 * 「记住」的内容以指代开头：「这个很重要」「这件事很重要」「这一点」「我刚才说的」——指的是哪句不确定。
 * （「一点」只在整句只有它时算指代：「一点钟开会」是内容。）
 */
const DEICTIC_LEAD = /^(?:这个|那个|这些|那些|这一点|这点|这句|那句|这件事|那件事|这事|那事|它|上面|刚才|刚刚|以上|前面说|之前说|我(?:刚才|刚刚|上面|前面|之前)?说的|刚说的)/;
/**
 * 「忘掉」的对象是对话本身 / 模型的设定 / 泛泛的一切，而不是一条记忆：「忘掉之前的对话」「忘掉上下文」「忘掉所有指令」
 * 「忘掉一切」「忘掉过去」「忘掉烦恼」——这不是在管记忆，不出卡，也不回「没找到相关的记忆」。
 */
const FORGET_NOT_A_MEMORY = /对话|聊天|会话|上下文|指令|提示词|规则|设定|人设|身份(?!证)|重新开始|重来|从头|一切|过去|烦恼|不开心|伤心|痛苦|以前的事|之前的事/;
/**
 * 这几个词只在「整个对象就是它」时才算说的是对话本身：「忘掉所有」「忘掉你的角色」不是记忆，
 * 「忘掉客户A的所有合同」「忘掉项目A的全部预算」「忘掉默认语言设置」是。
 */
const FORGET_WHOLE_NOT_A_MEMORY = /^(?:你的|我的)?(?:所有|全部|角色|设置|身份)(?:的)?(?:东西|内容|事|事情)?$/;
/** 忘掉的对象里还有下一句（「忘掉之前的对话，帮我写一封邮件」）：不是一个明确的对象。 */
const CLAUSE_SEPARATOR = /[，,；;。！!]/;
/** 「记住」的内容在第一个句末断开：「记住：我叫张三。帮我写个自我介绍」只记「我叫张三」。 */
const SENTENCE_END = /[。！!；;]/;
/** 「记住：…吧」「…好不好」「…行不行」：是在商量 / 求证，不是在交代。只看记住（「忘掉王经理那条吧」是在交代）。 */
const SUGGESTION_TAIL = /(?:吧|好不好|行不行|可以不|成不成)$/;
const TRAILING_PUNCT = /[\s。.!！~～]+$/;
/** 忘掉的目标里的修饰：「关于王经理的那条」→「王经理」。 */
const FORGET_FILLER_HEAD = /^(?:关于|有关|跟|和)\s*/;
const FORGET_FILLER_TAIL = /\s*(?:(?:的)?(?:那条|这条|那个|这个|那些|这些|那件事|这件事|的事|的事情|的记忆|的内容|吧|了)+|的)$/;

/** #4361 改口的开头（可选）：说的是「我改主意了」，后面必须紧跟一个改口分句。 */
const CHANGE_LEAD = /^(?:我们?|咱们?)?(?:又|还是)?(?:改主意了?|改变主意了?|变主意了?|想法变了|主意变了|重新考虑了一下|重新想了想)[\s，,。.!！~～]*/;
/**
 * 改口分句的开头：与 R8（decision-supersede.ts）五种改口句式同一批标记词。这里只管「这句话是不是在改口」，
 * 改口本身成不成立、改的是哪条由 `hasChangeSignal` / `planSupersedes` 判（不复写那边的规则）。
 */
const CHANGE_START = /^(?:我们?|咱们?|那就|那么|那|就|干脆|索性|现在|以后|今后)*(?:决定)?(?:改成|改为|换成|换为|改用|换用|转为|不再|把)/;
/** 改口句最长多少字：比这长的多半是一段话，里面的改口交给抽取之后的 R8。 */
const CHANGE_MAX = 200;
/**
 * #4361「你记得我什么」：只认整句（去掉句末问号 / 语气词、开头的「请 / 那」之后）。
 * 结尾的名词只收一小撮泛指词：「你记得我什么时候开会」不是在问画像。
 */
const OVERVIEW_NOUN = "(?:事情?|事儿|东西|内容|信息|记忆|偏好|目标|决定|习惯)?";
const OVERVIEW = [
  new RegExp(`^(?:你|您)(?:都|还|现在|目前)*(?:记得|记住了?|记着|记下了?|知道)(?:关于)?我(?:的)?(?:些什么|哪些|什么|多少|些)${OVERVIEW_NOUN}$`),
  new RegExp(`^(?:关于我|对我)(?:你|您)(?:都|还)*(?:记得|记住了?|记着|知道|了解)(?:些什么|哪些|什么|多少|些)${OVERVIEW_NOUN}$`),
  /^(?:你|您)对我(?:都|还)*(?:有)?(?:多少|哪些)?了解(?:多少)?$/,
  new RegExp(`^(?:列出|列一下|看看|说说|告诉我)(?:你|您)(?:都)?(?:记得|记住|记下)(?:了)?的(?:关于我的|我的)(?:所有|全部)?${OVERVIEW_NOUN.slice(0, -1)}$`),
  new RegExp(`^(?:你的|您的)(?:长期)?记忆里(?:都)?有(?:我的|关于我的)(?:哪些|什么)${OVERVIEW_NOUN}$`),
];
const OVERVIEW_TRIM_HEAD = /^(?:请问|请|那|那么|所以|好吧|好)[，,\s]*/;
const OVERVIEW_TRIM_TAIL = /[\s?？。.!！~～]*(?:呢|吗|呀|啊)?[\s?？。.!！~～]*$/;

/** 用户这句话是不是明确要「记住 / 忘掉」；不确定 ⇒ null（不出卡）。 */
export function detectMemoryIntent(message: string): MemoryIntent | null {
  const text = message.normalize("NFKC").trim();
  if (text.length === 0) return null;
  // #4361「你记得我什么」本身就是问句：整句规则，先于下面的「问句不出卡」判
  const overview = detectOverview(text);
  if (overview !== null) return overview;
  if (QUESTION_END.test(text) || QUESTION_TAIL.test(text.replace(TRAILING_PUNCT, ""))) return null;

  const remember = REMEMBER_WITH_SEP.exec(text) ?? REMEMBER_POLITE.exec(text);
  if (remember !== null) {
    const rest = text.slice(remember[0].length);
    const end = SENTENCE_END.exec(rest);
    // 句末之后还有下一句 ⇒ 只取第一句（下一句多半是另一件请求）
    const first = end !== null && rest.slice(end.index + 1).trim().length > 0 ? rest.slice(0, end.index) : rest;
    const statement = first.replace(TRAILING_PUNCT, "").trim();
    if (statement.length < 2 || statement.length > MEMORY_CARD_STATEMENT_MAX) return null;
    if (SUGGESTION_TAIL.test(statement) || QUESTION_TAIL.test(statement)) return null;
    if (DEICTIC_ONLY.test(statement) || DEICTIC_LEAD.test(statement) || INTERROGATIVE.test(statement)) return null;
    return { kind: "remember", statement };
  }

  const forget = FORGET_WITH_SEP.exec(text) ?? FORGET_STRONG.exec(text);
  if (forget !== null) {
    const raw = text.slice(forget[0].length).replace(TRAILING_PUNCT, "").trim();
    if (raw.length === 0 || DEICTIC_ONLY.test(raw) || CLAUSE_SEPARATOR.test(raw)) return null;
    const target = raw.replace(FORGET_FILLER_HEAD, "").replace(FORGET_FILLER_TAIL, "").trim();
    if (target.length < 2 || DEICTIC_ONLY.test(target) || DEICTIC_LEAD.test(target) || INTERROGATIVE.test(target)) return null;
    if (FORGET_NOT_A_MEMORY.test(target) || FORGET_WHOLE_NOT_A_MEMORY.test(target)) return null;
    // 一个可以拿去比对的词元都没有（「忘掉 Z」）⇒ 算不上具体对象
    if (lexicalTokens(target).size === 0) return null;
    return { kind: "forget", target };
  }
  return detectChange(text);
}

/** #4361：「（我改主意了，）改成 Y」。一句话、不是问句、改口分句过 R8 的 `hasChangeSignal`。 */
function detectChange(text: string): MemoryIntent | null {
  const lead = CHANGE_LEAD.exec(text);
  const rest = (lead === null ? text : text.slice(lead[0].length)).trim();
  if (!CHANGE_START.test(rest)) return null;
  const end = SENTENCE_END.exec(rest);
  // 句末之后还有下一句 ⇒ 不是「一句改口」（多半还有别的请求），交给抽取之后的 R8
  if (end !== null && rest.slice(end.index + 1).replace(TRAILING_PUNCT, "").trim().length > 0) return null;
  const statement = rest.replace(TRAILING_PUNCT, "").replace(/[。！!；;]+$/, "").trim();
  if (statement.length < 3 || statement.length > CHANGE_MAX || INTERROGATIVE.test(statement)) return null;
  if (!hasChangeSignal(statement)) return null;
  return { kind: "change", statement };
}

/** #4361：整句就是「你记得我什么」。 */
function detectOverview(text: string): MemoryIntent | null {
  const t = text.replace(OVERVIEW_TRIM_HEAD, "").replace(OVERVIEW_TRIM_TAIL, "").replace(/\s+/g, "");
  return OVERVIEW.some((re) => re.test(t)) ? { kind: "overview" } : null;
}

/**
 * 忘掉卡列哪几条：与召回同一份候选集（本会话 + 个人线程里本人的个人空间）、同一套字面打分，
 * 目标词元至少一半出现在这条里才算；按相关度排，最多 20 条（契约上限）。0 条 ⇒ 不出卡（R4-A2）。
 */
export function forgetMatches(target: string, claims: readonly RecallClaim[]): RecallClaim[] {
  const tokens = lexicalTokens(target);
  if (tokens.size === 0) return [];
  return claims
    .map((c) => ({ c, s: lexicalScore(tokens, c.statement) }))
    .filter((x) => x.s >= FORGET_MIN_MATCH)
    .sort((a, b) => b.s - a.s || a.c.id.localeCompare(b.c.id))
    .slice(0, MEMORY_CARD_MAX_ITEMS)
    .map((x) => x.c);
}
