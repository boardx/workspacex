/**
 * Issue #4290（第 8 轮）—— 本人明确改口时，新决定取代本人的旧决定。
 *
 * 场景：同一个人在个人会话 A 说「我决定关注 211 高校」，之后在会话 B 说「改成关注 985 吧」。F16
 * （`conflict.ts`）只认「同一组实体、同一指标、不同数值」，211 → 985 的 about 实体不同，不出冲突卡；
 * 于是两条决定都活着，会话 C 的模型同时拿到互相矛盾的两条。
 *
 * 人类决定（2026-09-26，usecases.md #4290 条目）：
 *   1. **只有明确改口才取代**：新决定带改口信号，且与**同一作者**一条仍生效的旧决定主题相同。
 *      并列的补充（「也关注 985」）两条都保留。
 *   2. **自动生效、可撤销**：旧决定转 superseded（原因 `decision_changed`），不再召回；会话里显示
 *      「已用〈新〉取代〈旧〉 · 撤销」，撤销后旧决定恢复。
 *
 * 本文件是纯函数：只回答「这条新决定是不是在改掉那条旧决定」。候选怎么取（这条消息刚抽出的决定；
 * 本会话里同一作者的活决定，个人线程里再加所有者本人个人空间的活决定）、落不落表（复核、改状态、留撤销
 * 快照）都在数据库函数 `kg_supersede_candidates` / `kg_apply_supersedes`（迁移 20260926140000）。
 *
 * ## 判定规则（确定、可复现，不调模型——同 `conflict.ts` / `decision-claim.ts` 的理由）
 *
 * 文本先归一：NFKC、小写、去掉全部空白。
 *
 * 一对（新决定 N，旧决定 O）进入候选，当且仅当**全部**成立：
 *   1. 两条都是 decision；id 不同；
 *   2. **同一作者**：两边作者都已知且相等（作者未知 ⇒ 不取代；不同作者之间只走 F16）；
 *   3. N 带**改口信号**，且不落在任何一条否决里：
 *      - 改口词（`CHANGE_WORDS`：改成 / 改为 / 换成 / 换为 / 改用 / 换用 / 转为 / 转而 / 转向 / 改主意 / 改口 / 取代 / 替换 / 代替 / 算了）；
 *      - 或否定式改口，且「不」**支配框架动词**：「不再 + 框架动词」（不再关注…）、「不 + 框架动词 + 对象 + 了」（不用 X 了、不关注 X 了）。
 *        「不再犹豫」「不急了」「不用再讨论了」（不用 + 再 / 担心 / 急 / 管……是「不需要」）都不算；
 *      否决：并列补充（`ADDITIVE`：也 / 还要 / 还想 / 另外 / 同时 / 再加 / 加上 / 以及 / 并且 / 额外 / 增加 / 补充）；
 *      否定的改口（「不改成」「没换成」「别改用」……）；问句（句末问号、疑问词、句末「吗 / 呢 / 么」）；假设 / 条件（「如果 / 假如 / 要是……」开头）；
 *   4. **不是重说**：N 的框架对象非空且等于 O 的对象（「改成关注 985 高校」对「关注 985 高校」、「不再用 Vue 了，改用 React 做前端」
 *      对「用 React 做前端」）⇒ 不取代——重说 / 重申旧决定永远不是改口；
 *   5. **主题相同**，三档，取最强的一档（见下）：
 *      - 明说（explicit）：O 的「对象」**连在 N 的改口句式上**——「不再 + 框架动词 + 旧」「不 + 框架动词 + 旧 + 了」「把旧换成 / 改成…」
 *        「（分句开头的）旧 + 换成 / 改成 / 算了」，且旧对象右边是句末 / 分句标点 / 语气词 / 改口词。只是碰巧出现在新句别处
 *        （「上线日期改成周五，先测试」对「做测试」）不算；左右两边都是固定的非字母数字，ASCII 对象因此按词边界匹配（Go ≠ Google）；
 *      - 同框架同类（same_kind）：两条的「框架动词」相同，且「对象」的类别词相同——「关注 211 高校」→「改成关注 985 高校」；
 *      - 同框架、一边缺类别词（frame_only）：框架动词相同，至少一边的对象没有类别词——「关注 211 高校」→「改成关注 985 吧」。
 *      框架动词相同但两边类别词**不同**（「关注 211 高校」对「改成关注 AI 方向」）⇒ 不算同一主题。
 *
 * **框架**：先把否定式改口的片段（「不再关注 211 高校」「不用 Vue 了」）换成分句标点——框架只取**肯定**的那部分；再去掉决定动词
 * （决定 / 选定 / 确定 / 定为 / 敲定 / 拍板）与改口词（改用 / 换用 读作「用」）；从左往右找第一个框架动词（`FRAME_VERBS`，同一位置取
 * 最长的：采用 > 用；单字的 用 / 做 / 选 在词里——费用、用户、做法、选项、不用……——不算）；它后面到第一个分句标点为止、去掉句末语气词的
 * 部分是「对象」；对象末尾连续汉字的最后两个字是「类别词」（「211高校」→「高校」，「985」没有类别词）。
 *
 * **一条新决定取代哪几条**：取最强的非空一档；这一档里的旧决定按归一文本分组——只有**一组**（同一句话可能在
 * 会话里和个人空间里各有一条）才取代这一组的全部；多于一组 ⇒ 说不清改的是哪一条，一条都不取代。
 * 宁可漏，不可误（R4 A1 同一原则）：漏了，用户还能在面板里手动忘掉旧的；误取代会让一条还有效的决定悄悄消失。
 */
import { INTERROGATIVE, QUESTION_END } from "./question-detection";

export type SupersedeClaimKind = "fact" | "hypothesis" | "decision" | "todo" | "risk";

/** 这条消息刚抽出、还没人看过的结论。 */
export interface SupersedeFresh {
  readonly id: string;
  readonly kind: SupersedeClaimKind;
  readonly statement: string;
  /** 说出它的人（这条消息的作者）；未知为 null。 */
  readonly authorId: string | null;
}

/** 还活着的旧决定（本会话的，或所有者本人个人空间的）。 */
export interface LiveDecision {
  readonly id: string;
  readonly kind: SupersedeClaimKind;
  readonly statement: string;
  /** 会话里的：它全部原话的唯一作者（不唯一 / 不是人 ⇒ null）；个人空间的：空间主人。 */
  readonly authorId: string | null;
  readonly scope: "chat_session" | "personal";
}

export interface SupersedePair {
  readonly newerClaimId: string;
  readonly olderClaimId: string;
}

/** 主题相同的三档（数字越小越强）。 */
export type TopicMatch = "explicit" | "same_kind" | "frame_only";
const MATCH_RANK: Record<TopicMatch, number> = { explicit: 0, same_kind: 1, frame_only: 2 };

/** 本身就是改口的词（不带「不」）。 */
const CHANGE_WORDS = "改成|改为|换成|换为|改用|换用|转为|转而|转向|改主意|改口|取代|替换|代替|算了";
const CHANGE_WORD = new RegExp(CHANGE_WORDS);
const CHANGE_WORDS_G = new RegExp(CHANGE_WORDS, "g");
const ADDITIVE = /也|还要|还想|另外|同时|再加|加上|以及|并且|额外|增加|补充/;
const NEGATED_CHANGE = /(?:不|没有?|未|别|不要|不想)(?:改成|改为|换成|换为|改用|换用|转为|转向)/;
const QUESTION_TAIL = /(?:吗|呢|么)[。.!！~～]*$/;
const HYPOTHETICAL_LEAD = /^(?:如果|假如|假设|要是|倘若|假使|万一)/;

const DECISION_WORDS = /决定|选定|确定|定为|敲定|拍板/g;
/** 框架动词：同一位置按长度优先匹配（「采用」不会被读成「用」）。 */
const FRAME_VERBS = [
  "选择", "选用", "采用", "使用", "关注", "聚焦", "主攻", "侧重", "研究", "面向", "针对", "报考", "用", "选", "做",
] as const;
/** 单字框架动词在词里时不算（费用、用户、做法、选项……；前面是「不 / 没」的是否定，也不算肯定的框架）。 */
const COMPOUND_BEFORE: Readonly<Record<string, string>> = {
  用: "费信作使采应适通享试可有没实常专备惯运引挪征录雇不",
  做: "看叫当不没",
  选: "挑筛候人精入当评海初复推落普竞不没",
};
const COMPOUND_AFTER: Readonly<Record<string, string>> = {
  用: "户品途法力料语词量具例",
  做: "法工",
  选: "项手题票举区民型",
};
/** 「不用」后面是这些 ⇒「不需要」，不是「不再用某个东西」。 */
const NEED_NOT = /^(?:再|担心|着急|急|管|客气|谢|说|怕|想)/;
const CLAUSE_BREAK = /[，。,；;！!？?、]/;
const TAIL_PARTICLES = /(?:吧|了|啊|呀|哦|啦|嘛|的)+$/;
/** 明说旧对象时，旧对象右边必须是这些之一（句末 / 分句标点 / 语气词 / 改口词）——ASCII 对象因此按词边界匹配（Go ≠ Google）。 */
const RIGHT_EDGE = /^(?:$|[，。,；;！!？?、]|了|吧|啦|呀|啊|改成|改为|换成|换为|算了)/;
const OLD_THEN_CHANGE = /^(?:改成|改为|换成|换为|算了)/;

/** 归一：NFKC、小写、去掉全部空白。 */
export function normalizeStatement(statement: string): string {
  return statement.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

/** text 第 i 位上的框架动词（最长的那个）；单字动词在词里（费用 / 用户……）不算。checkBefore=false：前一个字已知是「不」。 */
function frameVerbAt(text: string, i: number, checkBefore = true): string | null {
  const verb = FRAME_VERBS.find((v) => text.startsWith(v, i));
  if (verb === undefined) return null;
  if (verb.length > 1) return verb;
  if (checkBefore && i > 0 && COMPOUND_BEFORE[verb]!.includes(text[i - 1]!)) return null;
  const next = text[i + 1];
  if (next !== undefined && COMPOUND_AFTER[verb]!.includes(next)) return null;
  return verb;
}

function clauseEnd(text: string, from: number): number {
  const m = CLAUSE_BREAK.exec(text.slice(from));
  return m === null ? text.length : from + m.index;
}

/**
 * 否定式改口的片段（[起, 止)）：「不再 + 框架动词 …」到分句末；「不 + 框架动词 + 对象 + 了」到「了」。
 * 「不再犹豫」「不急了」「不用再讨论了」这类不支配框架动词的，不算。
 */
function negatedChangeSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (let i = text.indexOf("不"); i !== -1; i = text.indexOf("不", i + 1)) {
    const end = clauseEnd(text, i);
    if (text.startsWith("不再", i)) {
      if (frameVerbAt(text, i + 2, false) !== null) spans.push([i, end]);
      continue;
    }
    const verb = frameVerbAt(text, i + 1, false);
    if (verb === null) continue;
    const body = i + 1 + verb.length;
    if (verb === "用" && NEED_NOT.test(text.slice(body))) continue;
    const le = text.indexOf("了", body + 1);
    if (le !== -1 && le < end && le - body <= 12) spans.push([i, le + 1]);
  }
  return spans;
}

/** 新决定是不是在明确改口（改口信号命中，且不是并列补充 / 否定的改口 / 问句 / 假设）。 */
export function hasChangeSignal(statement: string): boolean {
  const text = normalizeStatement(statement);
  if (!CHANGE_WORD.test(text) && negatedChangeSpans(text).length === 0) return false;
  if (ADDITIVE.test(text) || NEGATED_CHANGE.test(text)) return false;
  if (QUESTION_END.test(text) || QUESTION_TAIL.test(text) || INTERROGATIVE.test(text)) return false;
  if (HYPOTHETICAL_LEAD.test(text)) return false;
  return true;
}

export interface DecisionFrame {
  /** 框架动词；找不到为 null。 */
  readonly verb: string | null;
  /** 对象（框架动词之后到第一个分句标点、去掉句末语气词）；没有框架动词时为空串。 */
  readonly object: string;
  /** 对象末尾连续汉字的最后两个字；没有则为 null。 */
  readonly kind: string | null;
}

/** 一条决定（肯定的那部分）的「框架动词 + 对象 + 类别词」（见文件头）。 */
export function decisionFrame(statement: string): DecisionFrame {
  let text = normalizeStatement(statement);
  for (const [from, to] of negatedChangeSpans(text).reverse()) text = `${text.slice(0, from)}，${text.slice(to)}`;
  text = text.replace(DECISION_WORDS, "").replace(/改用|换用/g, "用").replace(CHANGE_WORDS_G, "");
  for (let i = 0; i < text.length; i += 1) {
    const verb = frameVerbAt(text, i);
    if (verb === null) continue;
    const rest = text.slice(i + verb.length).replace(/^(?:了|在)/, "");
    const clause = rest.split(CLAUSE_BREAK)[0] ?? "";
    const object = clause.replace(TAIL_PARTICLES, "");
    const han = /\p{Script=Han}+$/u.exec(object)?.[0] ?? "";
    return { verb, object, kind: han.length >= 2 ? han.slice(-2) : null };
  }
  return { verb: null, object: "", kind: null };
}

/**
 * N 的原文是不是在改口句式里点名了旧对象 OLD（见文件头「明说」）：
 * 不再 + 框架动词 + OLD；不 + 框架动词 + OLD + 了；把 + OLD + 换成 / 改成…；分句开头的 OLD + 换成 / 改成 / 算了。
 */
function namesOldInChange(text: string, old: string): boolean {
  if (old.length < 2) return false;
  for (let i = text.indexOf(old); i !== -1; i = text.indexOf(old, i + 1)) {
    const before = text.slice(0, i);
    const after = text.slice(i + old.length);
    if (!RIGHT_EDGE.test(after)) continue;
    if (FRAME_VERBS.some((v) => before.endsWith(`不再${v}`))) return true;
    if (after.startsWith("了") && FRAME_VERBS.some((v) => before.endsWith(`不${v}`))) return true;
    if (OLD_THEN_CHANGE.test(after) && (before.endsWith("把") || i === 0 || CLAUSE_BREAK.test(before.slice(-1)))) return true;
  }
  return false;
}

/**
 * 单对判定：N 是不是在改掉 O，是的话落在哪一档主题匹配（见文件头 1–5）。不是 ⇒ null。
 */
export function supersedeMatch(fresh: SupersedeFresh, older: LiveDecision): TopicMatch | null {
  if (fresh.kind !== "decision" || older.kind !== "decision" || fresh.id === older.id) return null;
  if (fresh.authorId === null || older.authorId === null || fresh.authorId !== older.authorId) return null;
  if (!hasChangeSignal(fresh.statement)) return null;
  const n = decisionFrame(fresh.statement);
  const o = decisionFrame(older.statement);
  // 重说 / 重申旧决定（新决定的对象就是旧对象）永远不是改口
  if (n.object !== "" && n.object === o.object) return null;
  if (namesOldInChange(normalizeStatement(fresh.statement), o.object)) return "explicit";
  if (n.verb === null || n.verb !== o.verb) return null;
  if (n.kind !== null && o.kind !== null) return n.kind === o.kind ? "same_kind" : null;
  return "frame_only";
}

/**
 * 这一批新结论各自取代哪些旧决定（见文件头「一条新决定取代哪几条」）。结果按新条、旧条 id 排序，确定可复现。
 */
export function findSupersedes(fresh: readonly SupersedeFresh[], live: readonly LiveDecision[]): SupersedePair[] {
  const pairs: SupersedePair[] = [];
  for (const f of fresh) {
    let best = Number.POSITIVE_INFINITY;
    let hits: LiveDecision[] = [];
    for (const o of live) {
      const m = supersedeMatch(f, o);
      if (m === null) continue;
      const rank = MATCH_RANK[m];
      if (rank < best) { best = rank; hits = [o]; } else if (rank === best) hits.push(o);
    }
    if (hits.length === 0) continue;
    const keys = new Set(hits.map((o) => normalizeStatement(o.statement)));
    if (keys.size !== 1) continue;
    for (const o of hits) pairs.push({ newerClaimId: f.id, olderClaimId: o.id });
  }
  return pairs.sort((x, y) => x.newerClaimId.localeCompare(y.newerClaimId) || x.olderClaimId.localeCompare(y.olderClaimId));
}
