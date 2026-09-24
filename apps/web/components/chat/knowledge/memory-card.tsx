"use client";

import * as React from "react";
import { Sparkles, Trash2, Check, RefreshCw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import type { MemoryCard as MemoryCardData } from "@/lib/mock/knowledge-graph";

/**
 * U-4：对话里的「记住 / 忘掉」行内确认卡（uc-18-6 A/B）。
 * - **AI 只生成卡片，人点一下才生效**（I-15：执行身份是点击的人）。
 * - 记住卡：内容可改字（Textarea），按「记住」→ 变「已记住 · 撤销」。
 * - 忘掉卡：逐条列出、默认全选、可取消勾选，按「忘掉」执行选中的。
 * - 危险动作（忘掉）用 destructive 按钮 + 影响说明（硬规则 ⑦）。
 * - 卡片可折叠、不遮正文（E8）；一轮最多一张（在页面层保证）。
 * 状态：open / done（已生效）/ dismissed（不用）/ stale（期间内容已变，需刷新，E2）。
 *
 * ⚠ 纯前端 mock：动作只切本地状态，不落后端。
 */
export function MemoryCard({ card }: { card: MemoryCardData }) {
  const isRemember = card.kind === "remember";
  const [localState, setLocalState] = React.useState(card.state);
  const [text, setText] = React.useState(card.items[0]?.statement ?? "");
  const [checked, setChecked] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(card.items.map((it, i) => [it.claimId ?? `new-${i}`, true])),
  );
  const selectedCount = Object.values(checked).filter(Boolean).length;
  const rootTestId = isRemember ? "kg-card-remember" : "kg-card-forget";

  if (localState === "stale") {
    return (
      <div className="mt-2 flex flex-col gap-2 rounded-lg border border-warning bg-warning-tint p-3" data-testid="kg-card-stale">
        <p className="flex items-center gap-1 text-11 text-warning-tint-foreground">
          <AlertTriangle aria-hidden className="h-3.5 w-3.5" />
          这条内容已经变了，先刷新再决定
        </p>
        <Button size="xs" variant="outline" className="self-start" data-testid="kg-card-refresh">
          <RefreshCw aria-hidden className="mr-1 h-3 w-3" />
          刷新
        </Button>
      </div>
    );
  }

  if (localState === "done") {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-10 text-muted-foreground" data-testid="kg-card-done">
        <Check aria-hidden className="h-3 w-3 text-success" />
        {isRemember ? "已记住" : "已忘掉"}
        <span aria-hidden>·</span>
        <button
          type="button"
          className="underline-offset-2 transition-colors duration-base hover:underline"
          data-testid="kg-card-undo"
          onClick={() => setLocalState("open")}
        >
          撤销
        </button>
      </p>
    );
  }

  if (localState === "dismissed") {
    return (
      <p className="mt-2 text-10 text-muted-foreground" data-testid="kg-card-dismissed">
        好的，不记这条
      </p>
    );
  }

  return (
    <div
      className="mt-2 flex flex-col gap-2 rounded-lg border border-ai-tint bg-ai-tint/40 p-3"
      data-testid={rootTestId}
    >
      <div className="flex items-center gap-1.5">
        {isRemember ? (
          <Sparkles aria-hidden className="h-4 w-4 text-ai-tint-foreground" />
        ) : (
          <Trash2 aria-hidden className="h-4 w-4 text-destructive" />
        )}
        <span className="text-11 font-medium text-ai-tint-foreground">
          {isRemember ? "要记到你的长期记忆吗？" : "要忘掉这些吗？下面这些我就不再提了"}
        </span>
      </div>

      {isRemember ? (
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          aria-label="要记住的内容（可改）"
          data-testid="kg-card-remember-text"
          className="text-11"
        />
      ) : (
        <ul className="flex flex-col gap-1">
          {card.items.map((it, i) => {
            const key = it.claimId ?? `new-${i}`;
            return (
              <li key={key} className="flex items-start gap-2" data-testid={`kg-card-forget-item-${key}`}>
                <Checkbox
                  className="mt-0.5"
                  checked={checked[key] ?? false}
                  onChange={(e) => setChecked((s) => ({ ...s, [key]: e.target.checked }))}
                  aria-label={`忘掉 ${it.statement}`}
                  data-testid={`kg-card-forget-check-${key}`}
                />
                <span className="text-11 text-background-foreground">{it.statement}</span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center gap-1.5">
        <Button
          size="xs"
          variant={isRemember ? "secondary" : "destructive"}
          disabled={isRemember ? text.trim().length === 0 : selectedCount === 0}
          data-testid="kg-card-accept"
          onClick={() => setLocalState("done")}
        >
          {isRemember ? "记住" : `忘掉（${selectedCount}）`}
        </Button>
        <Button size="xs" variant="ghost" data-testid="kg-card-dismiss" onClick={() => setLocalState("dismissed")}>
          {isRemember ? "不用" : "取消"}
        </Button>
      </div>
    </div>
  );
}
