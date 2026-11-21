"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import type { AidtSharedReportController } from "../lib/use-aidt-shared-stages";
import { isAidtReportDraft, readAidtChatReportDraft } from "../lib/aidt-summary-results";
import type { AidtReportHistoryScope } from "../lib/aidt-report-history";

type Message = { id: string; role: string; content?: unknown };
type Candidate = Awaited<ReturnType<typeof readAidtChatReportDraft>>;
type Props = {
  messages: readonly Message[];
  loading: boolean;
  running: boolean;
  projectId: string;
  entityId: string;
  threadId: string | null;
  text: string | null;
  onChange: (markdown: string) => void;
  shared: AidtSharedReportController;
  historyScope?: AidtReportHistoryScope;
  readOnly?: boolean;
  onDraftReady?: (markdown: string) => void;
};

export function AidtReportConversation(props: Props) {
  const scope = props.historyScope;
  return <Conversation key={JSON.stringify([props.projectId, props.entityId, props.threadId, scope?.orgId, scope?.userId, scope?.sessionToken, scope?.lifecycleKey, props.readOnly])} {...props} />;
}

function Conversation({ messages, loading, running, projectId, entityId, threadId, text, shared, historyScope, readOnly, onChange, onDraftReady }: Props) {
  const [result, setResult] = React.useState<{ messageId: string; draft: Candidate; failed?: boolean } | null>(null);
  const [retry, setRetry] = React.useState(0);
  const latestFirst = [...messages].reverse();
  const assistant = latestFirst.find(message => message.role === "assistant");
  const latestHuman = latestFirst.find(message => message.role === "user");
  const humanDraft = typeof latestHuman?.content === "string" && isAidtReportDraft(latestHuman.content) && latestHuman.content.trim().length <= 85000 ? latestHuman.content.trim() : null;
  const pending = loading || running;
  const scope = historyScope;
  const openOutput = React.useRef(onDraftReady);
  openOutput.current = onDraftReady;
  React.useEffect(() => {
    if (pending || !threadId || !assistant?.id || !scope || scope.projectId !== projectId) return;
    const controller = new AbortController();
    void readAidtChatReportDraft(scope, entityId, threadId, assistant.id, controller.signal).then(draft => {
      if (controller.signal.aborted) return;
      setResult({ messageId: assistant.id, draft });
      if (draft) openOutput.current?.(draft.markdown.trim());
    }).catch(() => {
      if (!controller.signal.aborted) setResult({ messageId: assistant.id, draft: null, failed: true });
    });
    return () => controller.abort();
  // The enclosing key remounts on authorization, project, entity, or thread changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, projectId, entityId, assistant?.id, pending, retry]);

  if (readOnly) return null;
  const current = !pending && result?.messageId === assistant?.id ? result : null;
  const proposal = current?.draft?.markdown.trim();
  const canSave = !pending && text !== null && shared.canSave && !shared.saving;
  const canConfirm = !pending && text !== null && shared.canConfirm && !shared.saving;
  function adopt(markdown: string, model: boolean) {
    if (pending || shared.saving) return;
    if (model && current?.draft?.sourceReview.status === "available") {
      const receipt = current.draft.sourceReview.receipt;
      shared.chooseSources?.(receipt.application.state === "message-dispatch-observed" ? receipt.stageRevisions : []);
    } else if (model) {
      shared.chooseSources?.([]);
    }
    onChange(markdown);
    openOutput.current?.(markdown);
  }

  return <section aria-label="报告操作" data-testid="aidt-report-chat-actions" className="space-y-2 px-4 py-2">
    <div className="flex flex-wrap gap-2">
      {proposal && proposal !== text && <Button size="sm" variant="outline" disabled={shared.saving} onClick={() => adopt(proposal, true)}>采用报告草稿</Button>}
      {!pending && humanDraft && humanDraft !== text && <Button size="sm" variant="outline" disabled={shared.saving} onClick={() => adopt(humanDraft, false)}>采用我的改写</Button>}
      {canSave && <Button size="sm" data-testid="aidt-report-save" onClick={() => void shared.save()}>保存报告草稿</Button>}
      {canConfirm && <Button size="sm" data-testid="aidt-report-confirm" onClick={() => void shared.confirm?.()}>确认小组报告</Button>}
      {current?.failed && <Button size="sm" variant="outline" onClick={() => setRetry(count => count + 1)}>重新读取报告草稿</Button>}
      {shared.needsBaseReview && <Button size="sm" variant="outline" onClick={shared.reviewBase} disabled={shared.loading || shared.saving}>已核对服务器版本，继续保存</Button>}
    </div>
    {(shared.error || shared.loadError) && <p role="alert" className="text-12">{shared.error ?? shared.loadError}</p>}
    {shared.needsBaseReview && <details><summary className="cursor-pointer text-12">查看服务器报告</summary><p className="text-12 whitespace-pre-wrap">{shared.serverMarkdown ?? "暂无报告"}</p></details>}
    {shared.saving && <p role="status" className="text-12">正在保存…</p>}
    {shared.matchesServer && shared.confirmedAtRevision && <p role="status" className="text-12">小组报告已确认 · V{shared.confirmedAtRevision}</p>}
  </section>;
}
