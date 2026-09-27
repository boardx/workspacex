"use client";

import * as React from "react";
import { Quote, ChevronDown, Route, AlertTriangle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { KG_TRI_STATE_LABEL_ZH, type KgRecalledMemory } from "@repo/contracts/chat-knowledge-graph";
import {
  RETRIEVAL_CHANNEL_LABEL_ZH,
  KG_RELATED_QUERY_DEGRADED_ZH,
  graphPathText,
  personalOriginLabel,
  retrievalReasonLabels,
  truncateStatement,
} from "@/lib/knowledge-graph-recall";
import { requestOpenClaimSources } from "@/lib/knowledge-graph-events";
import { KG_CLAIM_KIND_LABEL_ZH } from "@/lib/knowledge-graph-view";
import { citationBasisPrefix, citedMemories } from "@/lib/knowledge-graph-citation";
import { CitationDetail, type CitationCorrect } from "./citation-detail";

/**
 * phase-18 F13 —— 回答下方：这次用到了哪些记忆、为什么（uc-18-2 R8 / E1，uc-18-4 R3-6）。
 *
 * 数据只来自 `getTurnMemory` 的 `recalled`（按召回名次）与 `recallDegraded`；服务端已按查看者过滤，
 * 这里**不补、不猜**，`recalled` 之外的东西一概不画。
 *
 * - 引用 chip「[n] 这一条」：「AI 记下的」/「有矛盾」用契约三态文案；长期记忆里的标「来自你 {M/D} 的对话」。
 *   点一下打开那一条的来源抽屉（默认经 `requestOpenClaimSources` 交给右栏记忆面板）。
 * - 「为什么用到它」：通道（全文 / 相似 / 关联）、召回理由（filter-action 单源展示名）、关系路径。
 *   **不显示 `score`**：那是原始 RRF 分（约 0.01–0.03），不是给人看的「相关度」。
 * - 查不全提示：**只看 `recallDegraded`**（本轮计划走关联查询但没能执行）。不看向量是否可用——
 *   MVP 没部署向量，那不是降级，不该每条回答都挂一句「查不全」。
 * - S7（#4364）：chip 只画服务端对账后的 `cited`（本轮召回集合里、回答真的用到了的；省略 ⇒ 全部 `recalled`），
 *   chip 上写「依据你 {M/D} 的决定」。点 chip：照旧打开来源抽屉，同时在下面展开这一条（完整原话、「跳到原消息」、
 *   只给所有者的「这条不对」/「已过时」，见 `CitationDetail`）。「为什么用到它」仍列本轮召回到的全部。
 */
export function AnswerKnowledgeFooter({
  recalled,
  recallDegraded,
  cited,
  onOpenSource = requestOpenClaimSources,
  canCorrect = false,
  onJump,
  onCorrect,
}: {
  recalled: readonly KgRecalledMemory[];
  recallDegraded: boolean;
  /** S7：服务端对账后的引用 id（按召回名次）；省略 ⇒ 全部 `recalled` */
  cited?: readonly string[];
  /** 点引用 chip：打开这一条的来源抽屉 */
  onOpenSource?: (claimId: string) => void;
  /** S7：是否给「这条不对」/「已过时」（只给所有者） */
  canCorrect?: boolean;
  /** S7：展开行里的「跳到原消息」；不给 ⇒ 不画这个展开行 */
  onJump?: (claimId: string) => Promise<boolean>;
  /** S7：纠正一条引用 */
  onCorrect?: (claimId: string, ...args: Parameters<CitationCorrect>) => ReturnType<CitationCorrect>;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const [open, setOpen] = React.useState<string | null>(null);
  if (recalled.length === 0 && !recallDegraded) return null;
  const chips = citedMemories(recalled, cited);
  const openMemory = open === null ? undefined : chips.find((m) => m.claimId === open);

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-border-subtle pt-2" data-testid="kg-answer-footer">
      {/* 查不全提示（不静默降级；文案是用词表的固定说法，带图标不只靠颜色） */}
      {recallDegraded ? (
        <p
          role="status"
          className="flex items-center gap-1 text-11 text-warning-foreground"
          data-testid="kg-channel-unavailable"
        >
          <AlertTriangle aria-hidden className="h-3.5 w-3.5" />
          {KG_RELATED_QUERY_DEGRADED_ZH}
        </p>
      ) : null}

      {recalled.length > 0 ? (
        <>
          {/* 引用 chips */}
          {chips.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5" data-testid="kg-citation-chips">
            <Quote aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
            {chips.map((m, i) => {
              const origin = personalOriginLabel(m);
              return (
                <button
                  key={m.claimId}
                  type="button"
                  title={m.statement}
                  aria-expanded={onJump === undefined ? undefined : open === m.claimId}
                  data-testid={`kg-citation-${m.claimId}`}
                  onClick={() => {
                    onOpenSource(m.claimId);
                    setOpen((cur) => (cur === m.claimId ? null : m.claimId));
                  }}
                  className="inline-flex max-w-full items-center gap-1 rounded-control border border-border bg-card px-1.5 py-0.5 text-10 text-card-foreground transition-colors duration-base hover:bg-muted"
                >
                  <span className="text-muted-foreground">[{i + 1}]</span>
                  {/* S7：「依据你 9/20 的决定」——前半句 + 类型（issue #4343：目标 / 偏好 / 决定 …）。
                      testid 不用 kg-citation- 前缀：那个前缀留给 chip 本身。 */}
                  <span className="shrink-0 text-muted-foreground" data-testid={`kg-cite-basis-${m.claimId}`}>
                    {citationBasisPrefix(m)}
                    <span data-testid={`kg-cite-kind-${m.claimId}`}>{KG_CLAIM_KIND_LABEL_ZH[m.kind]}</span>
                  </span>
                  <span className="truncate">{truncateStatement(m.statement)}</span>
                  {m.triState === "pending" ? (
                    <Badge tone="warning" data-testid={`kg-citation-pending-${m.claimId}`}>{KG_TRI_STATE_LABEL_ZH.pending}</Badge>
                  ) : null}
                  {m.triState === "conflict" ? (
                    <Badge tone="danger" data-testid={`kg-citation-conflict-${m.claimId}`}>{KG_TRI_STATE_LABEL_ZH.conflict}</Badge>
                  ) : null}
                  {origin !== null ? (
                    <Badge tone="ai" data-testid={`kg-from-personal-${m.claimId}`}>
                      <Clock aria-hidden className="h-2.5 w-2.5" />
                      {origin}
                    </Badge>
                  ) : null}
                </button>
              );
            })}
          </div>
          ) : null}

          {/* S7：点开的那一条——完整原话、跳到原消息、纠正 */}
          {openMemory !== undefined && onJump !== undefined ? (
            <CitationDetail
              key={openMemory.claimId}
              memory={openMemory}
              canCorrect={canCorrect}
              onJump={() => onJump(openMemory.claimId)}
              {...(onCorrect !== undefined
                ? { onCorrect: (kind: Parameters<CitationCorrect>[0], replacement?: string) => onCorrect(openMemory.claimId, kind, replacement) }
                : {})}
            />
          ) : null}

          {/* 为什么用到它 */}
          <Button
            variant="ghost"
            size="xs"
            className="self-start"
            aria-expanded={expanded}
            data-testid="kg-why-recall-toggle"
            onClick={() => setExpanded((v) => !v)}
          >
            为什么用到它
            <ChevronDown aria-hidden className={`ml-1 h-3 w-3 transition-transform duration-base ${expanded ? "rotate-180" : ""}`} />
          </Button>

          {expanded ? (
            <div className="flex flex-col gap-2 rounded-md border border-border-subtle bg-background p-2" data-testid="kg-why-recall-body">
              {recalled.map((m, i) => {
                const path = graphPathText(m.graphPath);
                return (
                  <div key={m.claimId} className="flex flex-col gap-1" data-testid={`kg-recall-reason-${m.claimId}`}>
                    <span className="text-11 text-background-foreground">
                      [{i + 1}] {m.statement}
                    </span>
                    <div className="flex flex-wrap items-center gap-1">
                      {m.channels.map((ch) => (
                        <Badge key={ch} tone={ch === "graph" ? "ai" : "neutral"} data-testid={`kg-recall-channel-${m.claimId}-${ch}`}>
                          {RETRIEVAL_CHANNEL_LABEL_ZH[ch]}
                        </Badge>
                      ))}
                      {retrievalReasonLabels(m.retrievalReasons).map((r, j) => (
                        <span key={r} className="text-10 text-muted-foreground" data-testid={`kg-recall-why-${m.claimId}-${m.retrievalReasons[j] ?? r}`}>
                          · {r}
                        </span>
                      ))}
                    </div>
                    {path !== null ? (
                      <p className="flex items-center gap-1 text-10 text-ai-tint-foreground" data-testid={`kg-graph-path-${m.claimId}`}>
                        <Route aria-hidden className="h-3 w-3 shrink-0" />
                        {path}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
