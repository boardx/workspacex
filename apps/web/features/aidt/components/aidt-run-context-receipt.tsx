"use client";
import * as React from "react";
import type { AidtContextReceipt } from "@repo/contracts/aidt-run-context";
import { Button } from "@/components/ui/button";
import { readAidtRunContext } from "@/features/aidt/lib/live-aidt-run-context";

type ExpectedTask = { purpose: "stage"; stageId: 1 | 2 | 3 | 4 | 5 | 6 } | { purpose: "summary" };
export type AidtRunContextReceiptProps = {
  projectId: string; threadId: string; runId: string | null; sessionToken: string; lifecycleKey: string; expected?: ExpectedTask;
};
const LABEL: Record<AidtContextReceipt["application"]["state"], string> = {
  prepared: "材料已固定", assembled: "模型输入已组装", "message-dispatch-observed": "材料已随本轮消息派发",
  "checkpoint-resume-observed": "已沿用原材料续跑", "failed-before-dispatch": "材料尚未确认派发", unknown: "派发情况待核对",
};

/** Remount on scope changes, including A→B→A, so old promises cannot revive an old receipt. */
export function AidtRunContextReceipt(props: AidtRunContextReceiptProps) {
  const key = JSON.stringify([props.lifecycleKey, props.projectId, props.threadId, props.runId, props.sessionToken, props.expected]);
  return props.runId ? <Receipt key={key} {...props} runId={props.runId} /> : null;
}

function Receipt({ projectId, runId, sessionToken, expected }: AidtRunContextReceiptProps & { runId: string }) {
  const expectedPurpose = expected?.purpose;
  const expectedStageId = expected?.purpose === "stage" ? expected.stageId : undefined;
  const [open, setOpen] = React.useState(false);
  const [revision, refresh] = React.useReducer((value: number) => value + 1, 0);
  const [state, setState] = React.useState<{ phase: "idle" | "loading" | "error" | "ready"; receipt?: AidtContextReceipt }>({ phase: "idle" });
  React.useEffect(() => {
    if (!open) return;
    const cancellation = new AbortController(); let active = true; let timer: ReturnType<typeof setTimeout> | undefined; let deadline: ReturnType<typeof setTimeout> | undefined;
    let reads = 0;
    async function read() {
      reads++;
      setState(previous => ({ phase: "loading", receipt: previous.receipt }));
      deadline = setTimeout(() => {
        if (active) { setState({ phase: "error" }); cancellation.abort(); }
      }, 15000);
      try {
        const receipt = await readAidtRunContext({ projectId, runId }, sessionToken, cancellation.signal);
        if (expectedPurpose && (receipt.purpose !== expectedPurpose || (expectedPurpose === "stage" && receipt.stageId !== expectedStageId))) throw new Error("AIDT_CONTEXT_RECEIPT_TASK_MISMATCH");
        if (!active || cancellation.signal.aborted) return;
        setState({ phase: "ready", receipt });
        // Only an expanded receipt polls, with a fixed bound. This never starts or resumes work.
        if (reads < 10 && ["prepared", "assembled"].includes(receipt.application.state)) timer = setTimeout(() => void read(), 3000);
      } catch {
        if (active && !cancellation.signal.aborted) setState({ phase: "error" });
      } finally {
        clearTimeout(deadline);
      }
    }
    void read();
    return () => { active = false; cancellation.abort(); if (timer) clearTimeout(timer); if (deadline) clearTimeout(deadline); };
  }, [open, revision, projectId, runId, sessionToken, expectedPurpose, expectedStageId]);
  const receipt = state.receipt;
  return <details className="border-b border-border px-4 py-2 text-12 text-muted-foreground" data-testid="aidt-run-context-receipt" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer rounded-control transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">本轮材料 · {receipt ? LABEL[receipt.application.state] : state.phase === "error" ? "读取失败" : "查看使用情况"}</summary>
    <div className="mt-2 space-y-2" aria-live="polite">
      {state.phase === "loading" && <p data-testid="aidt-run-context-receipt-loading">正在核对本轮回执…</p>}
      {state.phase === "error" && <p role="alert">本轮材料回执读取失败。请确认仍有小组访问权限后重试，当前状态尚未确认。</p>}
      {receipt && <>
        <p>{LABEL[receipt.application.state]}。{receipt.application.state === "prepared" ? "这只表示来源已保存到本轮快照，尚未确认交给模型。" : receipt.application.state === "assembled" ? "尚未取得向原生服务派发的回执。" : "派发或续跑回执不代表模型判断正确、研究有效或小组已确认结论。"}</p>
        <ul className="space-y-1" aria-label="本轮实际使用的保存版本">
          {receipt.stageRevisions.map(source => <li key={`current-${source.stageId}`}>第 {source.stageId} 步 · V{source.revision}</li>)}
          {receipt.historyRevisions.map(source => <li key={`history-${source.stageId}-${source.revision}`}>历史第 {source.stageId} 步 · V{source.revision}</li>)}
          {receipt.returnRevision !== undefined && <li>返工记录 · 第 6 步 V{receipt.returnRevision}</li>}
        </ul>
        {!receipt.stageRevisions.length && !receipt.historyRevisions.length && receipt.returnRevision === undefined && <p>本轮未选择已保存的阶段正文。</p>}
        {receipt.truncated && <p>本轮只使用了部分摘录，原始保存版本仍保留。</p>}
        {receipt.omissions.some(item => item.kind === "missing" || item.kind === "not-selected") && <p>部分步骤尚无保存稿或未被选择，不以缺失项补造内容。</p>}
        <p>个人检查点、原文件字节和教师点评未自动纳入。</p>
        <details><summary className="cursor-pointer transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">来源核对信息</summary><dl className="mt-1 space-y-1 break-all"><div><dt>快照校验值</dt><dd>{receipt.snapshotHash}</dd></div><div><dt>准备时间</dt><dd>{receipt.preparedAt}</dd></div>{receipt.application.assembledContextHash && <div><dt>组装校验值</dt><dd>{receipt.application.assembledContextHash}</dd></div>}</dl></details>
      </>}
      <Button size="sm" variant="outline" disabled={state.phase === "loading"} onClick={() => refresh()}>刷新回执</Button>
    </div>
  </details>;
}
