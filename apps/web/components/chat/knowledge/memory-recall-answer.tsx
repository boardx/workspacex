"use client";

import * as React from "react";
import { MessageSquare, FileText, ArrowUpRight, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KG_TRI_STATE_LABEL_ZH } from "@repo/contracts/chat-knowledge-graph";
import type { RecallGroup } from "@/lib/mock/knowledge-graph";

/**
 * uc-18-6 C：「你记得关于 X 的什么」——按「你确认过 / AI 记下的」分两组回答，每条带出处，
 * 末尾一个「管理记忆」链接打开面板（价值在对话里，面板是可选的）。
 *
 * ⚠ 纯前端 mock：跳到来源 / 管理记忆只回调，不真实导航。
 */
export function MemoryRecallAnswer({
  groups,
  onJumpTo,
  onManage,
}: {
  groups: RecallGroup[];
  onJumpTo?: (sourceRef: string) => void;
  onManage?: () => void;
}) {
  return (
    <div className="mt-2 flex flex-col gap-3" data-testid="kg-recall-answer">
      {groups.map((g) => (
        <section key={g.triState} data-testid={`kg-recall-group-${g.triState}`}>
          <h4 className="mb-1 text-11 font-medium text-muted-foreground">{KG_TRI_STATE_LABEL_ZH[g.triState]}</h4>
          <ul className="flex flex-col gap-1.5">
            {g.items.map((it) => (
              <li
                key={it.claimId}
                data-testid={`kg-recall-item-${it.claimId}`}
                className="rounded-md border border-border-subtle bg-background p-2"
              >
                <p className="text-11 text-background-foreground">{it.statement}</p>
                <button
                  type="button"
                  className="mt-1 flex items-center gap-1 text-10 text-muted-foreground underline-offset-2 transition-colors duration-base hover:underline"
                  data-testid={`kg-recall-source-${it.claimId}`}
                  onClick={() => onJumpTo?.(it.sourceRef)}
                >
                  {it.sourceKind === "attachment" ? (
                    <FileText aria-hidden className="h-3 w-3" />
                  ) : (
                    <MessageSquare aria-hidden className="h-3 w-3" />
                  )}
                  来自你 {it.capturedDate} 的对话
                  <ArrowUpRight aria-hidden className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <Button size="xs" variant="ghost" className="self-start" data-testid="kg-recall-manage" onClick={onManage}>
        <Settings2 aria-hidden className="mr-1 h-3 w-3" />
        管理记忆
      </Button>
    </div>
  );
}
