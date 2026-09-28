/**
 * issue #4362（S5）—— 新个人对话的开场简报：纯组装（不调模型、不读库）。
 *
 * 输入是查看者本人个人空间的材料（`SessionBriefingPort.sources` 已按本人读好、经个人空间判定放行）：
 *   - 长期记忆里的活条目（目标 / 决定 / 待办 …），带挂接的目标；
 *   - 本人个人对话里记下、还没进长期记忆的待办（S0-2=A：个人空间 = 同一用户全部个人对话）；
 *   - 本人个人对话里还开着的矛盾卡 / 可能改口卡（F16 / #4290）。
 * 输出三段、有界：上次在做的事（最近的目标与决定）≤ 3、没做完的待办 ≤ 2、还没定下来的 ≤ 1，合计 ≤ `KG_BRIEFING_MAX_ITEMS`。
 * 原文超长截断；「续上」的首问逐字引用记忆原文（这样下一轮召回的字面路一定命中它，引用 chip 指回的正是这一条）。
 * 没有材料 ⇒ 空数组（界面什么都不显示）。
 */
import { knowledgeGraph as KG } from "@repo/contracts";

export interface BriefingClaim {
  readonly id: string;
  readonly kind: KG.KgClaimKind;
  readonly statement: string;
  readonly triState: KG.KgTriState;
  /** 最早说出来的时间（ISO）；没有原话为 null */
  readonly saidAt: string | null;
  /** 入库时间（ISO）：没有 saidAt 时用它排新旧 */
  readonly createdAt: string;
  /** 出自本人哪个个人对话（点开看原话）；不是本人个人对话（项目会话晋升来的等）为 null */
  readonly threadId: string | null;
}

export interface BriefingThreadTodo {
  readonly id: string;
  readonly statement: string;
  readonly triState: KG.KgTriState;
  readonly saidAt: string | null;
  readonly createdAt: string;
  readonly threadId: string;
}

export interface BriefingCard {
  readonly promptId: string;
  readonly kind: KG.KgConflictPromptKind;
  readonly threadId: string;
  readonly createdAt: string;
  readonly newer: { readonly id: string; readonly statement: string; readonly kind: KG.KgClaimKind; readonly scope: "chat_session" | "personal" };
  readonly older: { readonly id: string; readonly statement: string };
}

export interface BriefingSources {
  readonly personal: readonly BriefingClaim[];
  readonly threadTodos: readonly BriefingThreadTodo[];
  readonly cards: readonly BriefingCard[];
  /** 决定 / 待办 id → 它挂着的目标 id（活的 serves_goal） */
  readonly goalOf: ReadonlyMap<string, string>;
}

/** 各段上限（合计 = KG_BRIEFING_MAX_ITEMS）。 */
export const BRIEFING_SECTION_LIMIT: Record<KG.KgBriefingSection, number> = { recent: 3, open_todos: 2, unresolved: 1 };

const clip = (s: string, max: number) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
};
const newest = (a: { saidAt: string | null; createdAt: string; id: string }, b: { saidAt: string | null; createdAt: string; id: string }) =>
  (b.saidAt ?? b.createdAt).localeCompare(a.saidAt ?? a.createdAt) || a.id.localeCompare(b.id);
const basis = (s: string) => s.normalize("NFKC").replace(/\s+/g, "").toLowerCase();

/** 「续上」首问：逐字引用记忆原文，整句不超过契约上限（原文太长时截原文，不截引号外的话）。 */
export function resumePrompt(kind: KG.KgClaimKind | KG.KgConflictPromptKind, statement: string, older?: string): string {
  const max = KG.KG_BRIEFING_PROMPT_MAX_CHARS;
  const q = (s: string, room: number) => clip(s, Math.max(8, room));
  switch (kind) {
    case "conflict":
    case "possible_change": {
      const frame = kind === "conflict" ? ["我之前说过「", "」，后来又说「", "」。帮我理一下，以哪个为准？"] : ["我之前说「", "」，后来说「", "」——是不是改主意了？帮我确认一下。"];
      const room = Math.floor((max - frame.join("").length) / 2);
      return `${frame[0]}${q(older ?? "", room)}${frame[1]}${q(statement, room)}${frame[2]}`;
    }
    case "goal": return `接着聊我的目标：「${q(statement, max - 20)}」。帮我规划下一步。`;
    case "decision": return `之前定下的：「${q(statement, max - 20)}」。接下来怎么推进？`;
    case "todo": return `继续这件待办：「${q(statement, max - 24)}」。现在该做哪一步？`;
    default: return `接着上次说的：「${q(statement, max - 12)}」。`;
  }
}

export function composeBriefing(src: BriefingSources): KG.KgBriefingItem[] {
  const goals = new Map(src.personal.filter((c) => c.kind === "goal").map((g) => [g.id, g]));
  const goalRef = (id: string) => {
    const g = goals.get(src.goalOf.get(id) ?? "");
    return g === undefined ? null : { claimId: g.id, statement: clip(g.statement, KG.KG_BRIEFING_STATEMENT_MAX_CHARS) };
  };
  const personalItem = (section: KG.KgBriefingSection, c: BriefingClaim): KG.KgBriefingItem => ({
    itemId: `${section}:${c.id}`, section, kind: c.kind, cardKind: null,
    statement: clip(c.statement, KG.KG_BRIEFING_STATEMENT_MAX_CHARS), counterpart: null, goal: goalRef(c.id),
    saidAt: c.saidAt, cite: { claimId: c.id, scope: "personal", threadId: c.threadId },
    resumePrompt: resumePrompt(c.kind, c.statement),
  });

  // 有矛盾的条目不放进「上次在做的事」——它在「还没定下来的」里（卡还开着的话）。
  const live = src.personal.filter((c) => c.triState !== "conflict");
  const recent = [
    ...live.filter((c) => c.kind === "goal").sort(newest).slice(0, 2),
    ...live.filter((c) => c.kind === "decision").sort(newest).slice(0, 2),
  ].sort(newest).slice(0, BRIEFING_SECTION_LIMIT.recent).map((c) => personalItem("recent", c));

  const seen = new Set<string>();
  const todos = [
    ...live.filter((c) => c.kind === "todo").map((c) => ({ c, personal: true as const })),
    ...src.threadTodos.filter((t) => t.triState !== "conflict").map((c) => ({ c, personal: false as const })),
  ]
    .sort((a, b) => newest(a.c, b.c))
    .filter((x) => {
      const k = basis(x.c.statement);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, BRIEFING_SECTION_LIMIT.open_todos)
    .map((x): KG.KgBriefingItem => x.personal
      ? personalItem("open_todos", x.c as BriefingClaim)
      : {
        itemId: `open_todos:${x.c.id}`, section: "open_todos", kind: "todo", cardKind: null,
        statement: clip(x.c.statement, KG.KG_BRIEFING_STATEMENT_MAX_CHARS), counterpart: null, goal: null, saidAt: x.c.saidAt,
        cite: { claimId: x.c.id, scope: "chat_session", threadId: (x.c as BriefingThreadTodo).threadId },
        resumePrompt: resumePrompt("todo", x.c.statement),
      });

  const unresolved = [...src.cards]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.promptId.localeCompare(b.promptId))
    .slice(0, BRIEFING_SECTION_LIMIT.unresolved)
    .map((p): KG.KgBriefingItem => ({
      itemId: `unresolved:${p.promptId}`, section: "unresolved", kind: p.newer.kind, cardKind: p.kind,
      statement: clip(p.newer.statement, KG.KG_BRIEFING_STATEMENT_MAX_CHARS),
      counterpart: { claimId: p.older.id, statement: clip(p.older.statement, KG.KG_BRIEFING_STATEMENT_MAX_CHARS) },
      goal: null, saidAt: null,
      cite: { claimId: p.newer.id, scope: p.newer.scope, threadId: p.threadId },
      resumePrompt: resumePrompt(p.kind, p.newer.statement, p.older.statement),
    }));

  return [...recent, ...todos, ...unresolved].slice(0, KG.KG_BRIEFING_MAX_ITEMS);
}
