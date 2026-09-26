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
 * 文本先归一：NFKC、小写、去掉全部空白。**核心是分句规则**：改口词只对它所在的那个分句说话，新框架只从改口分句里读，
 * 别的分句里的框架永远不和另一处的改口词配对。没有「哪些词不算」的词表——分不清的，一律不取代。
 *
 * 一对（新决定 N，旧决定 O）进入候选，当且仅当**全部**成立：
 *   1. 两条都是 decision；id 不同；
 *   2. **同一作者**：两边作者都已知且相等（作者未知 ⇒ 不取代；不同作者之间只走 F16）；
 *   3. N 整句不落在任何一条否决里：并列补充（`ADDITIVE`：也 / 还要 / 另外 / 同时 / 加上……）；否定的改口（「不改成」
 *      「没换成」「别改用」「不再改成」……）；问句（句末问号、疑问词、句末「吗 / 呢 / 么」）；假设（「如果 / 要是……」开头）；
 *      且 N 至少有一个**改口分句**（`changeClauses`）：
 *      - **分句**：按 ，,；;。!！?？、 与连接词（但 / 但是 / 不过 / 然后 / 可是 / 只是 / 而是 / 因为 / 所以）切开，去掉决定动词；
 *      - **改口分句**只有下面五种句式，改口标记都**直接**支配同一分句里紧跟的框架动词或对象：
 *        a. 改成 / 改为 / 换成 / 换为 / 转为 + 紧跟的框架动词 + 对象，或直接跟对象（新框架 = 后面那段；「改成周五」动词为空）；
 *           改用 / 换用 + 对象（读作「用 + 对象」）。改口词前面剥掉虚词（我 / 那就 / 还是……）后剩下的是**主语**；
 *        b. 把 + 旧 + 换成 / 改成…：「把」和改口词之间是**点名的旧对象**（它同时是主语）；
 *        c. 不再 + 框架动词 + 旧：点名旧对象，没有新框架；
 *        d. 不 + 框架动词 + 旧 + 了（「了」在分句末）：点名旧对象，没有新框架。「不用多想了」「不做过多讨论了」句式上与
 *           「不用 Vue 了」相同，只点名「多想」「过多讨论」——它们不是任何旧决定的对象，所以不取代任何东西；
 *        e. 旧 + 算了（整个分句）：后面紧跟另一个改口分句或句子到此结束 ⇒ 点名旧对象。唯一跨分句的窄口子：「（旧）算了，
 *           还是 + 框架动词 + 对象」——只有紧跟在「算了」分句后、以「还是」开头的那一个分句可以提供新框架；
 *   4. **不是重说**：任一改口分句的新对象与 O 的对象相等、或一个包含另一个（React 对 React做前端、Vue 对 Vue写原型、
 *      985 对 985高校）⇒ 不取代——重说 / 重申旧决定永远不是改口；
 *   5. **主题相同**：存在一个改口分句，它的主语为空或出现在 O 的原文里（「后端改用 Rust」对「后端用 Go」可以，「周会改成用
 *      腾讯会议」对「用 Vue」不行），并且落在下面三档之一，取最强的一档：
 *      - 明说（explicit）：它点名的旧对象（b–e，至少两个字符）**等于** O 的对象——整段相等，所以 ASCII 天然按词边界（Go ≠ Google）；
 *      - 同框架同类（same_kind）：它的新框架动词与 O 的相同，且两边对象的类别词相同——「关注 211 高校」→「改成关注 985 高校」；
 *      - 同框架、一边缺类别词（frame_only）：框架动词相同，至少一边的对象没有类别词——「关注 211 高校」→「改成关注 985 吧」。
 *      框架动词相同但两边类别词**不同**（「关注 211 高校」对「改成关注 AI 方向」、「报考北大」对「改成报考清华」）⇒ 不算同一主题。
 *
 * **框架**（`decisionFrame`，也用来读 O）：有带新框架的改口分句 ⇒ 取第一个；否则取第一个不是改口分句的分句里第一个框架动词
 * （`FRAME_VERBS`，同一位置取最长的：采用 > 用；单字的 用 / 做 / 选 在词里——费用、用户、做法、选项、不用……——不算），
 * 它后面到分句末、去掉句末语气词的部分是「对象」；对象末尾连续汉字的最后两个字是「类别词」（「211高校」→「高校」，「985」没有）。
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

/** 肯定的改口词：必须直接支配紧跟在后面的框架动词或对象。 */
const CHANGE_WORD = /改成|改为|换成|换为|改用|换用|转为/;
const ADDITIVE = /也|还要|还想|另外|同时|再加|加上|以及|并且|额外|增加|补充/;
const NEGATED_CHANGE = /(?:不|没有?|未|别|不要|不想|不再|不会)(?:改成|改为|换成|换为|改用|换用|转为)/;
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
/** 分句：标点与连接词（连接词两边是两个分句）。 */
const CLAUSE_BREAK = /[，。,；;！!？?、]/;
const CONNECTIVES = /但是|但|不过|然后|可是|只是|而是|因为|所以/g;
/** 分句开头不算「主语」的虚词（剥不掉 ⇒ 当成主语，旧决定必须包含它——剥漏只会让取代变少）。 */
const LEAD_FILLERS = /^(?:我们|我|咱们|咱|那就|那么|那|就|还是|干脆|索性|最后|最终|直接|现在|以后|今后)+/;
const TAIL_PARTICLES = /(?:吧|了|啊|呀|哦|啦|嘛|的)+$/;
const GIVE_UP = /^(.*?)算了[吧啊呀啦哦嘛]*$/;
const STILL_LEAD = /^(?:那就|那|就|我们|我)?还是/;

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

export interface DecisionFrame {
  /** 框架动词；找不到为 null。 */
  readonly verb: string | null;
  /** 对象（框架动词之后到分句末、去掉句末语气词）；没有框架动词时为空串。 */
  readonly object: string;
  /** 对象末尾连续汉字的最后两个字；没有则为 null。 */
  readonly kind: string | null;
}

const NO_FRAME: DecisionFrame = { verb: null, object: "", kind: null };

function makeFrame(verb: string | null, rawObject: string): DecisionFrame {
  const object = rawObject.replace(TAIL_PARTICLES, "");
  const han = /\p{Script=Han}+$/u.exec(object)?.[0] ?? "";
  return { verb, object, kind: han.length >= 2 ? han.slice(-2) : null };
}

/** 从 text 开头读「框架动词 + 对象」；开头不是框架动词 ⇒ verbOptional 时整段当对象（动词为 null），否则 null。 */
function frameAtStart(text: string, verbOptional: boolean): DecisionFrame | null {
  const rest = text.replace(/^了/, "");
  const verb = frameVerbAt(rest, 0);
  if (verb !== null) return makeFrame(verb, rest.slice(verb.length).replace(/^(?:了|在)/, ""));
  return verbOptional && rest !== "" ? makeFrame(null, rest) : null;
}

/** 分句：按标点与连接词切开，去掉决定动词（决定 / 确定……），丢掉空分句。 */
function splitClauses(text: string): string[] {
  return text.replace(CONNECTIVES, "，").split(CLAUSE_BREAK)
    .map((c) => c.replace(DECISION_WORDS, "")).filter((c) => c !== "");
}

/** 一个改口句式（都出自同一个分句；「算了 + 还是…」是唯一跨到下一分句的窄口子）。 */
export interface ChangeClause {
  /** 这个分句自己读出的新框架（改成 / 换成……后面那段）；否定式与「旧 + 算了」没有新框架。 */
  readonly frame: DecisionFrame | null;
  /** 改口句式里被点名的旧对象（不再 + 动词 + 旧、不 + 动词 + 旧 + 了、把旧换成…、旧 + 算了）。 */
  readonly namedOld: string | null;
  /** 改口词前面剥掉虚词后剩下的主语（「后端改用 Rust」的「后端」）；非空时旧决定原文必须包含它。 */
  readonly subject: string;
}

const lead = (s: string): string => s.replace(LEAD_FILLERS, "");
const nonEmpty = (s: string): string | null => (s === "" ? null : s);

/** 一个分句里的改口句式（不含「算了」，它要看下一个分句）。 */
function clauseChanges(clause: string): ChangeClause[] {
  const out: ChangeClause[] = [];
  // 肯定式：改成 / 换成……必须紧跟框架动词或对象；改用 / 换用 本身读作「用」
  const cw = CHANGE_WORD.exec(clause);
  if (cw !== null) {
    let subject = lead(clause.slice(0, cw.index));
    const ba = subject.startsWith("把");
    if (ba) subject = subject.slice(1);
    const rest = clause.slice(cw.index + cw[0].length);
    const frame = cw[0] === "改用" || cw[0] === "换用"
      ? frameAtStart(rest, false) ?? (rest === "" ? null : makeFrame("用", rest))
      : frameAtStart(rest, true);
    if (frame !== null) out.push({ frame, namedOld: ba ? nonEmpty(subject.replace(TAIL_PARTICLES, "")) : null, subject });
  }
  // 否定式：「不再 + 框架动词 + 旧」「不 + 框架动词 + 旧 + 了」——只点名旧对象，没有新框架
  for (let i = clause.indexOf("不"); i !== -1; i = clause.indexOf("不", i + 1)) {
    const subject = lead(clause.slice(0, i));
    if (clause.startsWith("不再", i)) {
      const verb = frameVerbAt(clause, i + 2, false);
      if (verb === null) continue;
      const old = clause.slice(i + 2 + verb.length).replace(TAIL_PARTICLES, "");
      if (old !== "") out.push({ frame: null, namedOld: old, subject });
      continue;
    }
    const verb = frameVerbAt(clause, i + 1, false);
    if (verb === null) continue;
    const m = /^(.+?)了[吧啊呀啦哦嘛]*$/.exec(clause.slice(i + 1 + verb.length));
    const old = m?.[1]?.replace(TAIL_PARTICLES, "") ?? "";
    if (old !== "") out.push({ frame: null, namedOld: old, subject });
  }
  return out;
}

/** 全部改口句式，不看句子级否决（decisionFrame 读旧决定时也用）。 */
function rawChangeClauses(text: string): { clauses: string[]; changes: ChangeClause[]; changed: Set<number> } {
  const clauses = splitClauses(text);
  const per = clauses.map((c) => (GIVE_UP.test(c) ? [] : clauseChanges(c)));
  const changed = new Set<number>();
  per.forEach((cs, k) => { if (cs.length > 0) changed.add(k); });
  clauses.forEach((c, k) => {
    const g = GIVE_UP.exec(c);
    if (g === null) return;
    changed.add(k);
    const old = nonEmpty(lead(g[1]!).replace(/就$/, ""));
    const next = clauses[k + 1];
    if (next === undefined) {
      if (old !== null) per[k]!.push({ frame: null, namedOld: old, subject: "" });
      return;
    }
    if (per[k + 1]!.length > 0) {
      if (old !== null) per[k]!.push({ frame: null, namedOld: old, subject: "" });
      return;
    }
    const still = STILL_LEAD.exec(next);
    const frame = still === null ? null : frameAtStart(next.slice(still[0].length), false);
    if (frame === null) return;
    changed.add(k + 1);
    per[k]!.push({ frame, namedOld: old, subject: "" });
  });
  return { clauses, changes: per.flat(), changed };
}

/** 新决定里的改口句式；句子是并列补充 / 否定的改口 / 问句 / 假设 ⇒ 一个都没有。 */
export function changeClauses(statement: string): ChangeClause[] {
  const text = normalizeStatement(statement);
  if (ADDITIVE.test(text) || NEGATED_CHANGE.test(text)) return [];
  if (QUESTION_END.test(text) || QUESTION_TAIL.test(text) || INTERROGATIVE.test(text)) return [];
  if (HYPOTHETICAL_LEAD.test(text)) return [];
  return rawChangeClauses(text).changes;
}

/** 新决定里有没有至少一个改口分句（见文件头第 3 条）。 */
export function hasChangeSignal(statement: string): boolean {
  return changeClauses(statement).length > 0;
}

/**
 * 一条决定的「框架动词 + 对象 + 类别词」：有带新框架的改口分句 ⇒ 取第一个；否则取第一个不是改口分句的分句里
 * 第一个框架动词（否定式的「不用 Vue 了」因此不会被读成肯定的「用 Vue」）。
 */
export function decisionFrame(statement: string): DecisionFrame {
  const { clauses, changes, changed } = rawChangeClauses(normalizeStatement(statement));
  const fromChange = changes.find((c) => c.frame !== null)?.frame;
  if (fromChange) return fromChange;
  for (let k = 0; k < clauses.length; k += 1) {
    if (changed.has(k)) continue;
    const clause = clauses[k]!;
    for (let i = 0; i < clause.length; i += 1) {
      const verb = frameVerbAt(clause, i);
      if (verb !== null) return makeFrame(verb, clause.slice(i + verb.length).replace(/^(?:了|在)/, ""));
    }
  }
  return NO_FRAME;
}

/** 重说：两个对象相等、或一个包含另一个（React 对 React做前端、Vue 对 Vue写原型）。 */
const restates = (a: string, b: string): boolean => a !== "" && b !== "" && (a.includes(b) || b.includes(a));

/**
 * 单对判定：N 是不是在改掉 O，是的话落在哪一档主题匹配（见文件头 1–5）。不是 ⇒ null。
 */
export function supersedeMatch(fresh: SupersedeFresh, older: LiveDecision): TopicMatch | null {
  if (fresh.kind !== "decision" || older.kind !== "decision" || fresh.id === older.id) return null;
  if (fresh.authorId === null || older.authorId === null || fresh.authorId !== older.authorId) return null;
  const changes = changeClauses(fresh.statement);
  if (changes.length === 0) return null;
  const o = decisionFrame(older.statement);
  if (o.object === "") return null;
  // 重说 / 重申旧决定（任一改口分句的新对象与旧对象相等或互相包含）永远不是改口
  if (changes.some((c) => c.frame !== null && restates(c.frame.object, o.object))) return null;
  const olderText = normalizeStatement(older.statement).replace(DECISION_WORDS, "");
  let best: TopicMatch | null = null;
  for (const c of changes) {
    if (c.subject !== "" && !olderText.includes(c.subject)) continue;
    let m: TopicMatch | null = null;
    if (c.namedOld !== null && c.namedOld.length >= 2 && c.namedOld === o.object) m = "explicit";
    else if (c.frame !== null && c.frame.verb !== null && c.frame.verb === o.verb) {
      if (c.frame.kind !== null && o.kind !== null) m = c.frame.kind === o.kind ? "same_kind" : null;
      else m = "frame_only";
    }
    if (m !== null && (best === null || MATCH_RANK[m] < MATCH_RANK[best])) best = m;
  }
  return best;
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
