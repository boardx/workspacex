"use client";

import * as React from "react";
import Link from "next/link";
import { Brain, MessageSquare } from "lucide-react";
import {
  KG_CLAIM_KIND_DISPLAY_ORDER,
  KG_CLAIM_KIND_LABEL_ZH,
  type KgMemoryCard,
} from "@repo/contracts/chat-knowledge-graph";
import { chatMemoryHref } from "@/lib/chat-memory-link";

type Item = KgMemoryCard["items"][number];

/**
 * Issue #4361（phase-18 S4）——「你记得我什么」的回答下方：本人个人空间里的记忆清单（U-4 同一个位置，`kind = overview`）。
 *
 * - 按种类分组（契约 `KG_CLAIM_KIND_DISPLAY_ORDER` / `KG_CLAIM_KIND_LABEL_ZH`，面板同一份用词），每条带来源：
 *   来自本人哪个对话（点开跳到那个对话、打开记忆页签看原话）；没有可跳的对话 ⇒「长期记忆」。
 * - 服务端按现在的事实过滤：已经忘掉 / 被取代的不在这里（getTurnMemory 读的时候判）。
 * - 这张卡**没有任何动作**（只是清单）；要改 / 要忘，说「忘掉 …」「我改主意了…」，或者去「大脑」页。
 * - 卡上最多 20 条；底部一条去「大脑」页看全部的链接。
 */
export function MemoryOverviewCard({ card }: { card: KgMemoryCard }) {
  const groups = KG_CLAIM_KIND_DISPLAY_ORDER
    .map((kind) => ({ kind, items: card.items.filter((it) => it.claimKind === kind) }))
    .filter((g) => g.items.length > 0);
  // 没带种类的条目（不应出现；保守起见不丢）放在最后
  const other = card.items.filter((it) => it.claimKind === undefined);
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg border border-ai-tint bg-ai-tint/40 p-3" data-testid="kg-card-overview">
      <div className="flex items-center gap-1.5">
        <Brain aria-hidden className="h-4 w-4 text-ai-tint-foreground" />
        <span className="text-11 font-medium text-ai-tint-foreground">我记得的关于你的事（只有你看得到）</span>
      </div>
      {groups.map((g) => (
        <section key={g.kind} className="flex flex-col gap-1" data-testid={`kg-overview-group-${g.kind}`}>
          <h4 className="text-10 font-medium text-muted-foreground">{KG_CLAIM_KIND_LABEL_ZH[g.kind]}</h4>
          <ul className="flex flex-col gap-1">
            {g.items.map((it) => <OverviewItem key={it.claimId ?? it.statement} item={it} />)}
          </ul>
        </section>
      ))}
      {other.length > 0 ? (
        <ul className="flex flex-col gap-1">{other.map((it) => <OverviewItem key={it.claimId ?? it.statement} item={it} />)}</ul>
      ) : null}
      <Link
        href="/brain"
        className="self-start text-10 text-primary underline-offset-2 transition-colors duration-base hover:underline"
        data-testid="kg-overview-brain-link"
      >
        在「大脑」里看全部、改或忘掉
      </Link>
    </div>
  );
}

function OverviewItem({ item }: { item: Item }) {
  const href = item.source ? chatMemoryHref({ threadId: item.source.threadId, projectId: null }) : null;
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5" data-testid={`kg-overview-item-${item.claimId ?? ""}`}>
      <span className="text-11 text-background-foreground">{item.statement}</span>
      {item.source && href !== null ? (
        <Link
          href={href}
          // 对话之间的跳转走整页导航（同 thread-knowledge-tab 的「跳到原消息」）：`/chat/[threadId]` 两个会话之间的软导航
          // 会整棵页面子树重挂载、偶发停在旧会话（copilotkit-v2-shell.tsx #2259 / #2402），带 `?memory=` 的请求就接不住。
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            window.location.assign(href);
          }}
          className="inline-flex items-center gap-1 text-10 text-primary underline-offset-2 transition-colors duration-base hover:underline"
          data-testid="kg-overview-source-link"
        >
          <MessageSquare aria-hidden className="h-3 w-3" />
          来自「{item.source.title}」
        </Link>
      ) : (
        <span className="text-10 text-muted-foreground" data-testid="kg-overview-source-longterm">长期记忆</span>
      )}
    </li>
  );
}
