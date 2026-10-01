"use client";
import * as React from "react";
import type { z } from "zod";
import type * as C from "@repo/contracts/chat";
import { openCitation } from "@/lib/live-chat";
import type { CitationView } from "@/lib/chat-citation-view";

/**
 * issue #4244 —— 助手消息引用在**实时**聊天界面里的渲染与 `citation_opened` 上报。
 *
 * PR #4230 起 `getThread` 的 `messages[].citations` 有真实数据（契约 `Citation`，每条带
 * `citationId`）。本文件是引用 UI 的**唯一一份实现**：预览页的 `AiMessage` 与实时面板
 * （`ChatLiveMessagePanel`、CopilotKit v2 助手消息）用的是同一个 `CitationList`，不另起第二套。
 *
 * 三层：
 *   ① `ThreadCitationsProvider` —— 由已经调了 `getThread` 的屏幕挂上，把
 *      `messageId → CitationView[]` 投影给下面的消息；
 *   ② `CitationScope` —— 一条消息的引用作用域（展开态 + 点开上报），正文里的 `[n]`
 *      标记与消息下方的引用列表共享它；
 *   ③ `MarkdownProse` 在作用域内把 `[n]`（且 n 真有对应引用）渲成可点标记。
 * 没有引用的消息不挂作用域 ⇒ 渲染与之前逐字节相同。
 */

type ContractCitation = z.infer<typeof C.Citation>;

/** 契约线上引用 → 展示视图（锚点三形态按 kind 取对应字段）。 */
export function toCitationView(c: ContractCitation): CitationView {
  const a = c.anchor;
  const anchor =
    a.kind === "page" ? (a.page !== null ? `第 ${a.page} 页` : "")
      : a.kind === "transcript" ? (a.range ?? "")
        : (a.messageId ?? "");
  return { citationId: c.citationId, index: c.index, sourceFullName: c.sourceFullName, anchor, anchorKind: a.kind };
}

const EMPTY: readonly CitationView[] = [];
const ThreadCitationsContext = React.createContext<ReadonlyMap<string, readonly CitationView[]> | null>(null);

export function ThreadCitationsProvider({
  messages, children,
}: {
  messages: readonly { id: string; citations: readonly ContractCitation[] }[] | null | undefined;
  children: React.ReactNode;
}) {
  const map = React.useMemo(() => {
    const m = new Map<string, readonly CitationView[]>();
    for (const msg of messages ?? []) {
      if (msg.citations.length > 0) m.set(msg.id, msg.citations.map(toCitationView));
    }
    return m;
  }, [messages]);
  return <ThreadCitationsContext.Provider value={map}>{children}</ThreadCitationsContext.Provider>;
}

/** 某条已落库消息的引用；没有 Provider / 没有引用 / id 未知 ⇒ 空数组。 */
export function useMessageCitations(messageId: string | null | undefined): readonly CitationView[] {
  const map = React.useContext(ThreadCitationsContext);
  if (!map || !messageId) return EMPTY;
  return map.get(messageId) ?? EMPTY;
}

interface CitationScopeValue {
  citations: readonly CitationView[];
  indexes: ReadonlySet<number>;
  openIdx: number | null;
  /** 列表行：切换展开；从关到开时上报。 */
  toggle: (index: number) => void;
  /** 正文标记：展开（已展开则保持）；从关到开时上报。 */
  open: (index: number) => void;
}

const CitationScopeContext = React.createContext<CitationScopeValue | null>(null);

export function useCitationScope(): CitationScopeValue | null {
  return React.useContext(CitationScopeContext);
}

/** 一条消息的引用作用域；`citations` 为空时不建作用域，子树按原样渲染。 */
export function CitationScope({
  citations, children,
}: { citations: readonly CitationView[]; children: React.ReactNode }) {
  const [openIdx, setOpenIdx] = React.useState<number | null>(null);
  const openIdxRef = React.useRef(openIdx);
  openIdxRef.current = openIdx;
  const value = React.useMemo<CitationScopeValue>(() => {
    const report = (index: number) => {
      if (openIdxRef.current === index) return;
      const id = citations.find((c) => c.index === index)?.citationId;
      // E3：fire-and-forget，`openCitation` 自身永不抛。
      if (id) openCitation(id);
    };
    return {
      citations,
      indexes: new Set(citations.map((c) => c.index)),
      openIdx,
      toggle: (index) => { report(index); setOpenIdx((v) => (v === index ? null : index)); },
      open: (index) => { report(index); setOpenIdx(index); },
    };
  }, [citations, openIdx]);
  if (citations.length === 0) return <>{children}</>;
  return <CitationScopeContext.Provider value={value}>{children}</CitationScopeContext.Provider>;
}

/** 引用列表：编号 + 出处全称 + 页码/时间段，点开定位（UC-8.2 R7 引用层，三段缺一不可）。
 *  须在 `CitationScope` 内渲染；作用域外（或无引用）什么都不画。 */
export function CitationList() {
  const scope = useCitationScope();
  if (!scope || scope.citations.length === 0) return null;
  const { citations, openIdx, toggle } = scope;
  return (
    <ol className="flex flex-col gap-1 rounded-md border border-border-subtle bg-card p-2" data-testid="chat-citations">
      {citations.map((c) => (
        <li key={c.index}>
          <button
            type="button"
            onClick={() => toggle(c.index)}
            aria-expanded={openIdx === c.index}
            data-testid="chat-citation-row"
            className="flex w-full items-baseline gap-2 rounded-sm px-1 py-0.5 text-left transition-colors duration-base hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="shrink-0 text-11 font-semibold text-primary">{c.index}</span>
            <span className="min-w-0 flex-1 text-11">
              <span className="text-card-foreground">{c.sourceFullName}</span>
              {c.anchor ? <span className="text-muted-foreground"> · {c.anchor}</span> : null}
            </span>
          </button>
          {openIdx === c.index && (
            <p className="ml-5 mt-0.5 rounded-sm bg-muted px-2 py-1 text-10 text-muted-foreground" data-testid="chat-citation-anchor">
              定位到 {c.anchor}（{c.anchorKind === "page" ? "文档页码" : c.anchorKind === "transcript" ? "转录时间码" : "消息锚点"}）· 不跳出线程
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

/* ─────────── 正文 `[n]` 标记：remark 插件 + `a` 渲染覆盖 ─────────── */

const MARKER_HREF_PREFIX = "#wsx-cite-";
const MARKER_RE = /\[(\d+)\]/g;

type MdNode = { type: string; value?: string; url?: string; children?: MdNode[] };

/**
 * 只改 mdast 的 `text` 节点（行内码/代码块是 `inlineCode`/`code`，不受影响；已在链接里的
 * 文本跳过），把 `[n]` 且 n ∈ indexes 的片段换成指向 `#wsx-cite-n` 的链接节点。
 * 没有匹配引用的 `[n]` 原样留作纯文本。
 */
export function remarkCitationMarkers(indexes: ReadonlySet<number>) {
  const walk = (node: MdNode) => {
    if (!node.children || node.type === "link" || node.type === "linkReference") return;
    const next: MdNode[] = [];
    for (const child of node.children) {
      if (child.type !== "text" || !child.value) {
        walk(child);
        next.push(child);
        continue;
      }
      const value = child.value;
      let cursor = 0;
      for (const m of value.matchAll(MARKER_RE)) {
        const n = Number(m[1]);
        if (!indexes.has(n)) continue;
        const at = m.index ?? 0;
        if (at > cursor) next.push({ type: "text", value: value.slice(cursor, at) });
        next.push({ type: "link", url: `${MARKER_HREF_PREFIX}${n}`, children: [{ type: "text", value: m[0] }] });
        cursor = at + m[0].length;
      }
      if (cursor === 0) next.push(child);
      else if (cursor < value.length) next.push({ type: "text", value: value.slice(cursor) });
    }
    node.children = next;
  };
  return () => (tree: MdNode) => { walk(tree); };
}

/** 从（可能被 sanitize 加了前缀的）href 里取出标记序号；不是标记返回 null。 */
export function citationMarkerIndex(href: string | undefined): number | null {
  if (!href) return null;
  const m = /#(?:user-content-)?wsx-cite-(\d+)$/.exec(href);
  return m ? Number(m[1]) : null;
}

/** 正文里的可点 `[n]` 标记。 */
export function CitationMarker({ index, label }: { index: number; label: React.ReactNode }) {
  const scope = useCitationScope();
  return (
    <button
      type="button"
      onClick={() => scope?.open(index)}
      aria-expanded={scope?.openIdx === index}
      data-testid="chat-citation-marker"
      data-citation-index={index}
      className="rounded-sm px-0.5 align-baseline font-semibold text-primary transition-colors duration-base hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {label}
    </button>
  );
}

/** 按已落库消息 id 从 `ThreadCitationsProvider` 取引用并建作用域（实时面板在消息 map 里用）。 */
export function PersistedMessageCitationScope({
  messageId, children,
}: { messageId: string | null | undefined; children: React.ReactNode }) {
  const citations = useMessageCitations(messageId);
  return <CitationScope citations={citations}>{children}</CitationScope>;
}
