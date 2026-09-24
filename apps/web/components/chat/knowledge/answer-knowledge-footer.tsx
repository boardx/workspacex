"use client";

import * as React from "react";
import { Quote, ChevronDown, Route, AlertTriangle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  RETRIEVAL_CHANNEL_LABEL_ZH,
  type RecalledCitation,
  type ChannelHealth,
} from "@/lib/mock/knowledge-graph";

/**
 * 回答下方：引用 chip + 「为什么召回」展开（retrievalReasons / channels，含图路径）
 * + 图 / 向量不可用的可见提示（uc-18-2 R8 / E1 / E2，**不静默降级**）。
 * L1 命中标「来自个人空间知识」（uc-18-4 R3-6）。
 *
 * ⚠ channels 用契约 `RetrievalChannel`；图路径字符串是从 KgEdge/KgObject 组合出的展示，
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
  const down = channelHealth.filter((c) => !c.available);

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-border-subtle pt-2" data-testid="kg-answer-footer">
      {/* 不可用提示（不静默降级） */}
      {down.length > 0 ? (
        <div className="flex flex-col gap-1" data-testid="kg-channel-unavailable">
          {down.map((c) => (
            <p
              key={c.channel}
              role="alert"
              className="flex items-center gap-1 text-11 text-warning-foreground"
              data-testid={`kg-channel-down-${c.channel}`}
            >
              <AlertTriangle aria-hidden className="h-3.5 w-3.5" />
              {RETRIEVAL_CHANNEL_LABEL_ZH[c.channel]}检索不可用，本次回答可能不完整
            </p>
          ))}
        </div>
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
            {c.unconfirmed ? <Badge tone="warning">未确认</Badge> : null}
            {c.fromPersonal ? (
              <Badge tone="ai" data-testid={`kg-from-personal-${c.citationId}`}>
                <Sparkles aria-hidden className="h-2.5 w-2.5" />
                来自个人空间知识
              </Badge>
            ) : null}
          </button>
        ))}
      </div>

      {/* 为什么召回 */}
      <Button
        variant="ghost"
        size="xs"
        className="self-start"
        aria-expanded={expanded}
        data-testid="kg-why-recall-toggle"
        onClick={() => setExpanded((v) => !v)}
      >
        为什么召回
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
