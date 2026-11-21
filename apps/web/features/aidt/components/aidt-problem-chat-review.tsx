"use client";

import * as React from "react";
import Link from "next/link";
import { StageContent } from "@repo/contracts/aidt-stages";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { aidtRoundConfirmation, aidtRoundDigest, aidtRoundMissingOutput, aidtRoundPayload } from "../lib/aidt-round-completion";
import { readAidtProblemEntityDraft, updateAidtProblemEntity } from "../lib/aidt-problem-entities";
import { reconcileAidtEntity, saveAidtStage, type AidtSharedStage } from "../lib/live-aidt-stages";
import { aidtHref } from "../lib/project-aidt";

export function AidtProblemChatReview({ projectId, entityId, stage, sessionToken, threadId, loading, running, messages, onRefresh }: {
  projectId: string; entityId?: string; stage?: AidtSharedStage; sessionToken: string; threadId: string | null;
  loading: boolean; running: boolean; messages: readonly { id: string; role: string; content?: unknown }[];
  onRefresh: () => void;
}) {
  const refresh = React.useRef(onRefresh);
  refresh.current = onRefresh;
  const [recovery, setRecovery] = React.useState<"loading" | "done" | "error">(entityId ? "loading" : "done");
  const [recoveryAttempt, retryRecovery] = React.useReducer((attempt: number) => attempt + 1, 0);
  React.useEffect(() => {
    if (!threadId || !entityId) return;
    const controller = new AbortController();
    setRecovery("loading");
    void reconcileAidtEntity(projectId, 1, entityId, sessionToken, controller.signal).then(() => {
      if (!controller.signal.aborted) { setRecovery("done"); refresh.current(); }
    }).catch(() => { if (!controller.signal.aborted) setRecovery("error"); });
    return () => controller.abort();
  }, [projectId, entityId, sessionToken, threadId, recoveryAttempt]);
  const settled = !loading && !running && threadId ? [...messages].reverse().find(turn => turn.role === "assistant" && typeof turn.content === "string" && turn.content.trim())?.id : undefined;
  const observed = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!settled || settled === observed.current) return;
    observed.current = settled;
    refresh.current();
  }, [settled]);
  const [status, setStatus] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const inFlight = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => inFlight.current?.abort(), []);
  if (recovery === "error") return <p role="status" className="px-4 text-12">暂时无法同步问题草稿。<Button size="sm" variant="ghost" onClick={retryRecovery}>重试同步</Button></p>;
  if (!stage || !threadId || recovery === "loading") return null;
  const draft = entityId ? readAidtProblemEntityDraft(stage.content.draft, entityId) : stage.content.draft;
  const reviewed = { ...draft, fields: { ...draft.fields, problemReflectionConfirmed: "true" } };
  if (aidtRoundMissingOutput(1, reviewed)) return null;
  const next = aidtHref(projectId, 2) + (entityId ? "&" + new URLSearchParams({ problemEntity: entityId, problemRevision: String(stage.revision) }) : "");
  const confirm = async () => {
    if (inFlight.current || running || loading) return;
    const controller = new AbortController();
    inFlight.current = controller;
    setSaving(true); setStatus("");
    try {
      const digest = await aidtRoundDigest(aidtRoundPayload(projectId, 1, reviewed, stage.sourceStageRevisions));
      const fields = { ...reviewed.fields, roundCompletion: aidtRoundConfirmation(projectId, 1, digest) };
      const confirmedDraft = entityId
        ? updateAidtProblemEntity(stage.content.draft, entityId, old => ({ ...old, fields }))
        : { ...stage.content.draft, fields };
      await saveAidtStage({ projectId, stageId: 1, expectedRevision: stage.revision, operationId: crypto.randomUUID(),
        content: StageContent.parse({ ...stage.content, draft: confirmedDraft }), sourceStageRevisions: stage.sourceStageRevisions }, sessionToken, controller.signal);
      if (!controller.signal.aborted) refresh.current();
    } catch (error) {
      if (!controller.signal.aborted) {
        setStatus(error instanceof ApiError && error.status === 409 ? "小组草稿已更新，请核对最新版本后确认。" : "确认尚未保存，请重试。");
        refresh.current();
      }
    } finally {
      inFlight.current = null;
      if (!controller.signal.aborted) setSaving(false);
    }
  };
  const confirmed = Boolean(draft.fields.roundCompletion && draft.fields.problemReflectionConfirmed === "true");
  return <section aria-label="对话中的成果确认" data-testid="aidt-round-completion" className="mx-auto w-full max-w-2xl space-y-2 px-4 py-2 text-13">
    {confirmed ? <><p>本轮成果已确认并保存</p><Button asChild size="sm" variant="outline"><Link href={next}>继续第2步</Link></Button></> :
      <><p className="whitespace-pre-wrap break-words">{draft.fields.rewrittenTheme}</p>
        <Button type="button" size="sm" disabled={saving || running || loading} onClick={() => void confirm()}>{saving ? "正在保存确认…" : "确认本轮成果并保存"}</Button></>}
    {status && <p role="status">{status}</p>}
  </section>;
}
