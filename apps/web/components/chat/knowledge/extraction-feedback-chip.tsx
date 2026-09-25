"use client";

import * as React from "react";
import { Sparkles } from "lucide-react";
import {
  applyHumanAction, fetchMessageExtraction, fetchThreadKnowledge, knowledgeGraphErrorCode,
} from "@/lib/knowledge-graph-api";
import { describeHumanActionFailure } from "@/lib/knowledge-graph-failure";
import { truncateStatement } from "@/lib/knowledge-graph-recall";
import { requestKnowledgeReload, useKnowledgeSnapshot } from "@/lib/knowledge-graph-events";
import { TURN_MEMORY_REPOLL_DELAYS_MS } from "./turn-memory-line";

/**
 * issue #4180 —— 发送这条消息的用户下方，一句「刚被抽取出新知识」的轻量反馈：
 * 「已记下：{claim 摘要} · 撤销」。
 *
 * ## 这不是 F09 的 `TurnMemoryLine`
 *
 * `TurnMemoryLine`（`turn-memory-line.tsx`）挂在**回答**下方，`captured` 按「回答 + 它前面
 * 紧邻的用户消息」这一整轮算，说的是「这一轮记下了几条」。这里挂在**用户自己发的那条消息**
 * 下方，只问「这一条消息自己」产生了什么——两者数据来源不同（`getMessageExtraction` vs
 * `getTurnMemory`），互不替代：用户发完消息后，AI 通常已经在答了，回答下方的「已记下 N 条」
 * 要等抽取跑完才有；而这条反馈直接挂在用户自己的消息上，不用等一整轮答完。
 *
 * ## 轮询：复用 `TurnMemoryLine` 同一套「有限次补读」，不新开一条通道
 *
 * 抽取是异步的（2 秒轮询 + 模型调用），消息刚发出去时通常还没抽完。这里与
 * `TurnMemoryLine` 共用同一个补读延迟表 `TURN_MEMORY_REPOLL_DELAYS_MS`——同一份「最多补读
 * 几次、不做常驻轮询」的纪律，不另建一套时间表。挂载条件（只对本会话真的发出去的用户消息）
 * 由调用方（`copilotkit-v2-user-message.tsx`）判断，这个组件本身不关心「是不是本会话发的」。
 *
 * ## 撤销：复用 F10 `applyHumanAction{revokeClaim}`，不新开一条撤销路径
 *
 * 与 `AnswerMemoryLine`（F10 既有实现）同一条纪律：版本号在点击时现取（`fetchThreadKnowledge`），
 * 不用挂载时的旧快照；`KG_CLAIM_NOT_FOUND`（已经被别处撤销 / 忘掉）视为已撤销，不报错。
 *
 * ## 「不再出现」：撤销后天然消失，未撤销时按 claimId 记在这个标签页里
 *
 * 撤销会让这条结论不再是「活的」（`revoked_at` 非空），下次 `getMessageExtraction` 自然
 * 不会再把它读出来——不需要额外记账。用户点了「撤销」但请求还没回来之前，以及为了不在同一次
 * 会话里对同一条消息反复闪现，已经处理过的 claimId 在这个组件实例的本地状态里排除，
 * 不持久化到别处（同 `ConflictPromptCard`/`AnswerMemoryLine` 对「已处理」只在本地状态里
 * 记一次的既有做法，见两者头注）。
 */
export function ExtractionFeedbackChip({
  threadId,
  messageId,
}: {
  readonly threadId: string;
  readonly messageId: string;
}) {
  const [claims, setClaims] = React.useState<readonly { readonly claimId: string; readonly statement: string }[]>([]);
  const [handled, setHandled] = React.useState<ReadonlySet<string>>(() => new Set());
  const [undoingId, setUndoingId] = React.useState<string | null>(null);
  const [errorFor, setErrorFor] = React.useState<Readonly<Record<string, string>>>({});
  const snapshot = useKnowledgeSnapshot(threadId);
  const canUndo = snapshot?.canEdit === true;

  React.useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();
    setClaims([]);

    const attempt = (index: number): void => {
      fetchMessageExtraction(threadId, messageId, controller.signal).then(
        (value) => {
          if (cancelled) return;
          const delay = TURN_MEMORY_REPOLL_DELAYS_MS[index];
          if (value.claims.length === 0 && delay !== undefined) {
            timer = setTimeout(() => attempt(index + 1), delay);
            return;
          }
          setClaims(value.claims);
        },
        () => {
          if (!cancelled) setClaims([]);
        },
      );
    };
    attempt(0);

    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== null) clearTimeout(timer);
    };
  }, [threadId, messageId]);

  const undo = React.useCallback(async (claimId: string): Promise<void> => {
    setUndoingId(claimId);
    setErrorFor((cur) => {
      if (!(claimId in cur)) return cur;
      const next = { ...cur };
      delete next[claimId];
      return next;
    });
    try {
      // 版本号点击时现取：同 `AnswerMemoryLine.undo` 的既有纪律，拿快照里的旧版本号
      // 去撤销第一次必撞 KG_REVISION_CHANGED。
      const revision = (await fetchThreadKnowledge(threadId)).revision;
      await applyHumanAction(threadId, revision, { type: "revokeClaim", claimId });
      setHandled((cur) => (cur.has(claimId) ? cur : new Set(cur).add(claimId)));
    } catch (e) {
      if (knowledgeGraphErrorCode(e) === "KG_CLAIM_NOT_FOUND") {
        setHandled((cur) => (cur.has(claimId) ? cur : new Set(cur).add(claimId)));
      } else {
        setErrorFor((cur) => ({ ...cur, [claimId]: describeHumanActionFailure(e) }));
      }
    } finally {
      setUndoingId(null);
      requestKnowledgeReload(threadId);
    }
  }, [threadId]);

  const visible = claims.filter((c) => !handled.has(c.claimId));
  if (visible.length === 0) return null;

  return (
    <div className="mt-1 flex flex-col gap-1" data-testid="kg-extraction-feedback">
      {visible.map((c) => (
        <div key={c.claimId} className="flex flex-col gap-0.5">
          <p className="flex items-center gap-1 text-10 text-muted-foreground" data-testid={`kg-extraction-line-${c.claimId}`}>
            <Sparkles aria-hidden className="h-3 w-3" />
            已记下：{truncateStatement(c.statement)}
            {canUndo ? (
              <>
                <span aria-hidden>·</span>
                <button
                  type="button"
                  className="text-muted-foreground underline-offset-2 transition-colors duration-base hover:underline disabled:cursor-not-allowed disabled:text-disabled-foreground disabled:hover:no-underline"
                  data-testid={`kg-extraction-undo-${c.claimId}`}
                  disabled={undoingId === c.claimId}
                  onClick={() => void undo(c.claimId)}
                >
                  {undoingId === c.claimId ? "撤销中…" : "撤销"}
                </button>
              </>
            ) : null}
          </p>
          {errorFor[c.claimId] !== undefined ? (
            <p role="alert" className="text-10 text-destructive" data-testid={`kg-extraction-undo-error-${c.claimId}`}>
              {errorFor[c.claimId]}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
