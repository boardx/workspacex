"use client";

import * as React from "react";
import { Quote, ChevronDown, Route, AlertTriangle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  RETRIEVAL_CHANNEL_LABEL_ZH,
  KG_RELATED_QUERY_DEGRADED_ZH,
  relatedQueryDegraded,
  type RecalledCitation,
  type ChannelHealth,
} from "@/lib/mock/knowledge-graph";
import { KG_TRI_STATE_LABEL_ZH } from "@repo/contracts/chat-knowledge-graph";

/**
 * 回答下方：引用 chip + 「为什么用到它」展开（channels + 关系路径 + 相关度）
 * + 关联查询不可用时的一行可见提示（uc-18-2 R8 / E1 / E2，**不静默降级**，用词表第五节的固定说法）。
 * 跨会话命中标「来自你 {日期} 的对话」（uc-18-4 R3-6）。
 *
 * ⚠ channels 用契约 `RetrievalChannel`；关系路径字符串是从 KgEdge/KgObject 组合出的展示，
 *   context-pack 当前无专门字段（见 ui-preview/README 缺口清单）。
 */
export function AnswerKnowledgeFooter({
  citations,
  channelHealth,
  onJumpTo,
}: {
  citations: RecalledCitation[];
  channelHealth: ChannelHealth[];
  onJumpTo?: (sourceRef: string) => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const degraded = relatedQueryDegraded(channelHealth);

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-border-subtle pt-2" data-testid="kg-answer-footer">
      {/* 查不全提示（不静默降级；文案是用词表的固定说法，带图标不只靠颜色） */}
      {degraded ? (
        <p
          role="alert"
          className="flex items-center gap-1 text-11 text-warning-foreground"
          data-testid="kg-channel-unavailable"
        >
          <AlertTriangle aria-hidden className="h-3.5 w-3.5" />
          {KG_RELATED_QUERY_DEGRADED_ZH}
        </p>
      ) : null}

      {/* 引用 chips */}
      <div className="flex flex-wrap items-center gap-1.5" data-testid="kg-citation-chips">
        <Quote aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
        {citations.map((c, i) => (
          <button
            key={c.citationId}
            type="button"
            data-testid={`kg-citation-${c.citationId}`}
            onClick={() => onJumpTo?.(c.sourceRef)}
            className="inline-flex items-center gap-1 rounded-control border border-border bg-card px-1.5 py-0.5 text-10 text-card-foreground transition-colors duration-base hover:bg-muted"
          >
            <span className="text-muted-foreground">[{i + 1}]</span>
            {c.label}
            {c.unconfirmed ? <Badge tone="warning">{KG_TRI_STATE_LABEL_ZH.pending}</Badge> : null}
            {c.fromPersonalDate ? (
              <Badge tone="ai" data-testid={`kg-from-personal-${c.citationId}`}>
                <Clock aria-hidden className="h-2.5 w-2.5" />
                来自你 {c.fromPersonalDate} 的对话
              </Badge>
            ) : null}
          </button>
        ))}
      </div>

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
          {citations.map((c, i) => (
            <div key={c.citationId} className="flex flex-col gap-1" data-testid={`kg-recall-reason-${c.citationId}`}>
              <span className="text-11 text-background-foreground">
                [{i + 1}] {c.label}
              </span>
              <div className="flex flex-wrap items-center gap-1">
                {c.channels.map((ch) => (
                  <Badge key={ch} tone={ch === "graph" ? "ai" : "neutral"} data-testid={`kg-recall-channel-${c.citationId}-${ch}`}>
                    {RETRIEVAL_CHANNEL_LABEL_ZH[ch]}
                  </Badge>
                ))}
                <span className="text-10 text-muted-foreground">相关度 {c.score.toFixed(2)}</span>
                {c.reasonLabels.map((r) => (
                  <span key={r} className="text-10 text-muted-foreground">· {r}</span>
                ))}
              </div>
              {c.graphPath ? (
                <p className="flex items-center gap-1 text-10 text-ai-tint-foreground" data-testid={`kg-graph-path-${c.citationId}`}>
                  <Route aria-hidden className="h-3 w-3" />
                  {c.graphPath}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
