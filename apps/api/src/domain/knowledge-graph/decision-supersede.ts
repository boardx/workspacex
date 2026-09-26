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
 *   3. N 带**改口信号**（`CHANGE_MARKER`：改成 / 改为 / 换成 / 换为 / 改用 / 换用 / 转为 / 转而 / 转向 / 不再 /
 *      改主意 / 改口 / 取代 / 替换 / 代替 / 算了，或「不…了」），且不落在任何一条否决里：
 *      - 并列补充（`ADDITIVE`：也 / 还要 / 还想 / 另外 / 同时 / 再加 / 加上 / 以及 / 并且 / 额外 / 增加 / 补充）；
 *      - 否定的改口（「不改成」「没换成」「别改用」……）；
 *      - 问句（句末问号、疑问词、句末「吗 / 呢 / 么」）；假设 / 条件（「如果 / 假如 / 要是……」开头）；
 *   4. **主题相同**，三档，取最强的一档（见下）：
 *      - 明说（explicit）：N 的原文里出现了 O 的「对象」（见「框架」）——「不再关注 211 高校」「把 211 高校换成 985 高校」；
 *      - 同框架同类（same_kind）：两条的「框架动词」相同，且「对象」的类别词相同——「关注 211 高校」→「改成关注 985 高校」；
 *      - 同框架、一边缺类别词（frame_only）：框架动词相同，至少一边的对象没有类别词——「关注 211 高校」→「改成关注 985 吧」。
 *      框架动词相同但两边类别词**不同**（「关注 211 高校」对「改成关注 AI 方向」）⇒ 不算同一主题。
 *
 * **框架**：去掉决定动词（决定 / 选定 / 确定 / 定为 / 敲定 / 拍板）与改口信号后，从左往右找第一个框架动词
 * （`FRAME_VERBS`，同一位置取最长的：采用 > 用）；它后面到第一个分句标点为止、去掉句末语气词的部分是「对象」；
 * 对象末尾连续汉字的最后两个字是「类别词」（「211高校」→「高校」，「985」没有类别词）。
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

const CHANGE_WORDS = "改成|改为|换成|换为|改用|换用|转为|转而|转向|不再|改主意|改口|取代|替换|代替|算了";
const CHANGE_MARKER = new RegExp(`${CHANGE_WORDS}|不[^，。,；;！!？?]{1,12}了`);
const ADDITIVE = /也|还要|还想|另外|同时|再加|加上|以及|并且|额外|增加|补充/;
const NEGATED_CHANGE = /(?:不|没有?|未|别|不要|不想)(?:改成|改为|换成|换为|改用|换用|转为|转向)/;
const QUESTION_TAIL = /(?:吗|呢|么)[。.!！~～]*$/;
const HYPOTHETICAL_LEAD = /^(?:如果|假如|假设|要是|倘若|假使|万一)/;

const DECISION_WORDS = /决定|选定|确定|定为|敲定|拍板/g;
const CHANGE_WORDS_G = new RegExp(CHANGE_WORDS, "g");
/** 框架动词：同一位置按长度优先匹配（「采用」不会被读成「用」）。 */
const FRAME_VERBS = [
  "选择", "选用", "采用", "使用", "关注", "聚焦", "主攻", "侧重", "研究", "面向", "针对", "报考", "用", "选", "做",
] as const;
const CLAUSE_BREAK = /[，。,；;！!？?、]/;
const TAIL_PARTICLES = /(?:吧|了|啊|呀|哦|啦|嘛|的)+$/;

/** 归一：NFKC、小写、去掉全部空白。 */
export function normalizeStatement(statement: string): string {
  return statement.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

/** 新决定是不是在明确改口（改口信号命中，且不是并列补充 / 否定的改口 / 问句 / 假设）。 */
export function hasChangeSignal(statement: string): boolean {
  const text = normalizeStatement(statement);
  if (!CHANGE_MARKER.test(text)) return false;
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

/** 一条决定的「框架动词 + 对象 + 类别词」（见文件头）。 */
export function decisionFrame(statement: string): DecisionFrame {
  const text = normalizeStatement(statement).replace(DECISION_WORDS, "").replace(CHANGE_WORDS_G, "");
  for (let i = 0; i < text.length; i += 1) {
    const verb = FRAME_VERBS.find((v) => text.startsWith(v, i));
    if (verb === undefined) continue;
    const rest = text.slice(i + verb.length).replace(/^(?:了|在)/, "");
    const clause = rest.split(CLAUSE_BREAK)[0] ?? "";
    const object = clause.replace(TAIL_PARTICLES, "");
    const han = /\p{Script=Han}+$/u.exec(object)?.[0] ?? "";
    return { verb, object, kind: han.length >= 2 ? han.slice(-2) : null };
  }
  return { verb: null, object: "", kind: null };
}

/**
 * 单对判定：N 是不是在改掉 O，是的话落在哪一档主题匹配（见文件头 1–4）。不是 ⇒ null。
 */
export function supersedeMatch(fresh: SupersedeFresh, older: LiveDecision): TopicMatch | null {
  if (fresh.kind !== "decision" || older.kind !== "decision" || fresh.id === older.id) return null;
  if (fresh.authorId === null || older.authorId === null || fresh.authorId !== older.authorId) return null;
  if (!hasChangeSignal(fresh.statement)) return null;
  const n = decisionFrame(fresh.statement);
  const o = decisionFrame(older.statement);
  if (o.object.length >= 2 && normalizeStatement(fresh.statement).includes(o.object)) return "explicit";
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
