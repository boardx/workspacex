"use client";

import * as React from "react";
import { ArrowUpRight, Check, Clock3, ThumbsDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { KgRecalledMemory } from "@repo/contracts/chat-knowledge-graph";
import type { CitationCorrection, CitationCorrectionKind } from "@/lib/knowledge-graph-api";
import { MemoryCard } from "./memory-card";
import { ConflictPromptCard } from "./conflict-prompt-card";

/** 新说法的上限（契约 `correctCitation.in.replacement`）。 */
const REPLACEMENT_MAX = 2000;

const DONE_NOTE: Record<CitationCorrection["outcome"], string> = {
  forgotten: "已忘掉这条，之后的回答不再用它",
  superseded: "已改成新的说法，之后的回答按新的来",
  expired: "已标为过时，之后的回答不再用它",
};

export type CitationCorrect = (kind: CitationCorrectionKind, replacement?: string) => Promise<CitationCorrection>;

/**
 * S7（#4364）—— 点开一条引用 chip 后的展开行：完整的那句话、「跳到原消息」、以及只给所有者的两个纠正动作。
 *
 * - 「这条不对」：先问一句「正确的是？（可不填）」。
 *   · 不填 ⇒ 出 F17 的**忘掉卡**（同一个 `MemoryCard`，只列这一条）；点「忘掉」才生效。
 *   · 填了 ⇒ 出 #4290 的**改口卡**（同一个 `ConflictPromptCard`，`possible_change`：「用〈新〉取代〈旧〉？」）；点「取代」才生效，
 *     「两条都保留」= 什么都不改。
 * - 「已过时」：一点就生效（`expireClaim`）。
 * - 执行都经 `onCorrect`（`correctCitation`，服务端再核一遍这是不是这一轮的引用、你是不是所有者兼提问人）；
 *   失败时抛出的 Error 带给人看的话，卡片 / 按钮原样恢复。
 * - `canCorrect = false`（不是所有者）：只有原话和「跳到原消息」，没有纠正入口。
 *
 * testid 一律不用 `kg-citation-` 前缀：那个前缀按 chip 计数（F15 评测 E2 / E4 的选择器）。
 */
export function CitationDetail({
  memory,
  canCorrect,
  onJump,
  onCorrect,
}: {
  memory: KgRecalledMemory;
  canCorrect: boolean;
  onJump: () => Promise<boolean>;
  onCorrect?: CitationCorrect;
}) {
  const id = memory.claimId;
  const [mode, setMode] = React.useState<"idle" | "wrong">("idle");
  const [replacement, setReplacement] = React.useState("");
  const [done, setDone] = React.useState<CitationCorrection["outcome"] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);

  const jump = async (): Promise<void> => {
    setNote(null);
    try {
      if (!(await onJump())) setNote("这条的原话找不到了（可能只来自附件，或原对话已经看不到）。");
    } catch {
      setNote("没能打开原消息，请稍后再试。");
    }
  };

  const expire = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      setDone((await correct("expired")).outcome);
    } catch (e) {
      setNote(e instanceof Error && e.message !== "" ? e.message : "没能完成这次操作，请稍后重试。");
    } finally {
      setBusy(false);
    }
  };

  const typed = replacement.trim();
  const correctable = canCorrect && onCorrect !== undefined;
  const correct: CitationCorrect = (kind, text) => {
    if (onCorrect === undefined) return Promise.reject(new Error("没能完成这次操作，请稍后重试。"));
    return onCorrect(kind, text);
  };

  return (
    <div className="mt-1 flex flex-col gap-1.5 rounded-md border border-border-subtle bg-background p-2" data-testid={`kg-cite-detail-${id}`}>
      <p className="text-11 text-background-foreground" data-testid={`kg-cite-statement-${id}`}>{memory.statement}</p>
      {done !== null ? (
        <p role="status" className="flex items-center gap-1 text-10 text-muted-foreground" data-testid={`kg-cite-done-${id}`}>
          <Check aria-hidden className="h-3 w-3 text-success" />
          {DONE_NOTE[done]}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="xs" variant="ghost" data-testid={`kg-cite-jump-${id}`} onClick={() => void jump()}>
            <ArrowUpRight aria-hidden className="mr-1 h-3 w-3" />
            跳到原消息
          </Button>
          {correctable ? (
            <>
              <Button
                size="xs"
                variant="outline"
                aria-expanded={mode === "wrong"}
                disabled={busy}
                data-testid={`kg-cite-wrong-${id}`}
                onClick={() => { setNote(null); setMode((m) => (m === "wrong" ? "idle" : "wrong")); }}
              >
                <ThumbsDown aria-hidden className="mr-1 h-3 w-3" />
                这条不对
              </Button>
              <Button size="xs" variant="outline" disabled={busy} data-testid={`kg-cite-expired-${id}`} onClick={() => void expire()}>
                <Clock3 aria-hidden className="mr-1 h-3 w-3" />
                已过时
              </Button>
            </>
          ) : null}
        </div>
      )}

      {correctable && done === null && mode === "wrong" ? (
        <div className="flex flex-col gap-1" data-testid={`kg-cite-wrong-panel-${id}`}>
          <label className="flex flex-col gap-0.5 text-10 text-muted-foreground">
            正确的是？（可不填，不填就是忘掉这条）
            <Input
              value={replacement}
              maxLength={REPLACEMENT_MAX}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder="例如：主库改用 MySQL"
              data-testid={`kg-cite-replacement-${id}`}
              className="text-11"
            />
          </label>
          {typed === "" ? (
            <MemoryCard
              key="forget"
              card={{ cardId: `cite-${id}`, kind: "forget", items: [{ claimId: id, statement: memory.statement }], state: "open" }}
              canAct
              onAct={async (decision) => {
                const card = { cardId: `cite-${id}`, kind: "forget" as const, items: [{ claimId: id, statement: memory.statement }] };
                if (decision === "dismiss") {
                  setMode("idle");
                  return { ...card, state: "dismissed" as const };
                }
                const out = await correct("wrong");
                setDone(out.outcome);
                return { ...card, state: "done" as const };
              }}
            />
          ) : (
            <ConflictPromptCard
              key={`supersede:${typed}`}
              prompt={{
                promptId: `cite-${id}`, kind: "possible_change",
                newerClaim: { id: "", statement: typed },
                olderClaim: { id, statement: memory.statement, saidAt: memory.saidAt ?? "" },
              }}
              canResolve
              onResolve={async (resolution) => {
                if (resolution !== "keep_new") return;
                setDone((await correct("wrong", typed)).outcome);
              }}
            />
          )}
        </div>
      ) : null}

      {note !== null ? (
        <p role="alert" className="text-10 text-destructive" data-testid={`kg-cite-error-${id}`}>{note}</p>
      ) : null}
    </div>
  );
}
