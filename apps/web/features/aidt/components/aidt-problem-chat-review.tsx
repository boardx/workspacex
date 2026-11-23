"use client";

import * as React from "react";
import Link from "next/link";
import { isAidtProblemControlText, StageContent } from "@repo/contracts/aidt-stages";
import { AidtConfirmAction } from "./aidt-confirm-action";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { aidtRoundConfirmation, aidtRoundDigest, aidtRoundMissingOutput, aidtRoundPayload } from "../lib/aidt-round-completion";
import { readAidtProblemEntityDraft, updateAidtProblemEntity } from "../lib/aidt-problem-entities";
import { reconcileAidtEntity, saveAidtStage, type AidtSharedStage } from "../lib/live-aidt-stages";
import { AidtProblemCandidates } from "./aidt-problem-candidates";
import { aidtHref } from "../lib/project-aidt";
import { problemReflectionMissingFields } from "../lib/aidt-problem-reflection";
import { readAidtProblemDirections } from "../lib/aidt-problem-directions";

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
  const candidateTools = entityId ? <AidtProblemCandidates {...{ projectId, entityId, stage, sessionToken, messages, loading, running, onRefresh }} /> : null;
  const roundMissing = aidtRoundMissingOutput(1, reviewed);
  if (roundMissing) {
    const hasStudentDraft = [draft.fields.initial, draft.fields.rewrittenTheme, draft.fields.whyWorthStudying, draft.fields.sourceDetails]
      .some(value => Boolean(value?.trim() && !isAidtProblemControlText(value)));
    const directions = readAidtProblemDirections(draft.fields.problemDirections);
    const missing = [
      ...problemReflectionMissingFields(draft),
      ...(!draft.fields.rewrittenTheme?.trim() ? ["改写命题"] : []),
      ...(directions.length && !directions.some(direction => direction.id === draft.fields.problemDirectionId) ? ["研究方向"] : []),
    ];
    const prompts: Record<string, string> = {
      原始命题: "用自己的话说说想研究什么。",
      选题理由: "为什么值得研究？",
      问题来源: "是亲自观察、听到抱怨，还是我们的猜测？",
      来源描述: "具体看到、听到或猜测了什么？可以说明尚不确定。",
      改写命题: "聚焦想研究的用户、场景和体验，写出本轮命题。",
      研究方向: "说明选择哪个候选方向，以及选择理由。",
    };
    return <>{candidateTools}<AidtConfirmAction size="sm" disabled={running || loading} blocker={missing.length ? missing.map(label => `${label}：${prompts[label]}`).join(" ") : roundMissing} onConfirm={() => {}}>确认本轮成果并保存</AidtConfirmAction>{hasStudentDraft && <section role="status" aria-label="本步待补充" data-testid="aidt-problem-missing-input" className="mx-auto w-full max-w-2xl space-y-2 px-4 py-2 text-13">
      <p>本步还需要补充</p>
      {missing.length ? <ul className="list-disc space-y-1 pl-5">{missing.map(label => <li key={label}>{label}：{prompts[label]}</li>)}</ul> : <p>{roundMissing}</p>}
      <p>请在当前聊天中补充这些内容，再核对本轮成果。</p>
    </section>}</>;
  }
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
    {candidateTools}
    {confirmed ? <><p>本轮成果已确认并保存</p><Button asChild size="sm" variant="outline"><Link href={next}>继续第2步</Link></Button></> :
      <><p className="whitespace-pre-wrap break-words">{draft.fields.rewrittenTheme}</p>
        <Button type="button" size="sm" disabled={saving || running || loading} onClick={() => void confirm()}>{saving ? "正在保存确认…" : "确认本轮成果并保存"}</Button></>}
    {status && <p role="status">{status}</p>}
  </section>;
}
