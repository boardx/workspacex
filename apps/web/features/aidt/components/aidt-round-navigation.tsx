"use client";
import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { aidtHref } from "../lib/project-aidt";
import { isAidtReflectionConfirmed, readAidtReturnDecision, readAidtQuestionSnapshot } from "../lib/aidt-verification-loop";
import { listAidtStageHistory, type AidtSharedStage } from "../lib/live-aidt-stages";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";

/** Navigation carries a saved reflection reference, never clears historical work. */
export function AidtRoundNavigation({ projectId, stageNumber, draft, savedRound, matchesServer, returnRevision, sessionToken, testEntityId }: {
  projectId: string; stageNumber: number; draft: AidtUiStageDraft;
  savedRound?: AidtSharedStage; matchesServer: boolean; returnRevision: string | null; sessionToken?: string | null; testEntityId?: string;
}) {
  const decision = readAidtReturnDecision(stageNumber === 6 ? draft : savedRound?.content.draft ?? { fields: {}, ideas: [], selectedIdeaId: "" });
  if (stageNumber < 6) {
    if (!returnRevision) return null;
    const wanted = /^[1-9]\d*$/.test(returnRevision) ? Number(returnRevision) : NaN;
    if (!Number.isSafeInteger(wanted) || wanted >= Number.MAX_SAFE_INTEGER) return <ReturnUnavailable projectId={projectId} revision={returnRevision} message="返回链接中的历史版本号无效，请到第6步核对。" />;
    if (savedRound?.revision === wanted && savedRound.projectId === projectId && savedRound.stageId === 6) return validReturn(savedRound, projectId, stageNumber, wanted) ? <ReturnContext round={savedRound} /> : <ReturnUnavailable projectId={projectId} revision={returnRevision} message="这份学习记录尚未确认或选择了其他返回步骤，请核对后继续。" />;
    if (!sessionToken) return <ReturnUnavailable projectId={projectId} revision={returnRevision} message="登录后才能读取这次返回所引用的历史学习记录。" />;
    return <HistoricalReturn key={JSON.stringify([projectId, stageNumber, wanted, sessionToken])} projectId={projectId} stageNumber={stageNumber} revision={wanted} sessionToken={sessionToken} />;
  }
  if (decision.kind !== "selected" || (testEntityId && draft.fields.reflectionTestEntityId !== testEntityId)) return null;
  const ready = matchesServer && savedRound && isAidtReflectionConfirmed(draft)
    && validReturn(savedRound, projectId, Number(decision.step), savedRound.revision);
  return <div className="space-y-2 border-t border-border pt-3 text-12" data-testid="aidt-round-navigation">{ready ? <Link className="inline-flex rounded-md border border-border px-3 py-2 font-medium text-primary transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" href={`${aidtHref(projectId, Number(decision.step), { tool: "outcome" })}&returnRevision=${savedRound.revision}`}>带着本轮反思，回到第{decision.step}步 · {decision.label}</Link> : <p role="status" className="text-muted-foreground">先核对本轮学习记录并保存到小组，再带着已保存依据返回第{decision.step}步。返回前四步不需要先生成新原型。</p>}</div>;
}

function validReturn(round: AidtSharedStage, projectId: string, stage: number, revision: number) {
  const decision = readAidtReturnDecision(round.content.draft);
  return round.projectId === projectId && round.stageId === 6 && round.revision === revision && isAidtReflectionConfirmed(round.content.draft) && decision.kind === "selected" && Number(decision.step) === stage;
}
function ReturnContext({ round: saved }: { round: AidtSharedStage }) {
  const round = saved.content.draft;
  return <aside className="rounded-lg border border-border bg-muted p-3 text-12" data-testid="aidt-return-context"><p className="font-medium">带着上一轮学习继续 · 第6步共享 V{saved.revision}</p><p className="mt-2 whitespace-pre-wrap">原验证问题：{readAidtQuestionSnapshot(round)?.question || "未记录"}</p><p className="mt-1 whitespace-pre-wrap">返回原因：{round.fields.returnReason || "未记录"}</p><p className="mt-1 whitespace-pre-wrap">下一行动：{round.fields.nextAction || "未记录"}</p><p className="mt-2 text-muted-foreground">旧成果与原型保留；在本步修订后另存新版本。</p></aside>;
}
function ReturnUnavailable({ projectId, revision, message, onRetry }: { projectId: string; revision: string; message: string; onRetry?: () => void }) {
  return <aside role="alert" className="rounded-lg border border-border p-3 text-12" data-testid="aidt-return-unavailable"><p>{message}</p><div className="mt-2 flex flex-wrap items-center gap-3">{onRetry && <Button type="button" size="sm" variant="outline" onClick={onRetry}>重试读取本轮学习</Button>}<Link className="text-primary underline" href={aidtHref(projectId, 6, { tool: "outcome" })}>到第6步历史核对共享 V{revision}</Link></div></aside>;
}
function HistoricalReturn({ projectId, stageNumber, revision, sessionToken }: { projectId: string; stageNumber: number; revision: number; sessionToken: string }) {
  const [state, setState] = React.useState<{ phase: "loading" | "error" | "ready"; round?: AidtSharedStage }>({ phase: "loading" });
  const [retry, setRetry] = React.useState(0);
  React.useEffect(() => {
    const controller = new AbortController();
    setState({ phase: "loading" });
    void listAidtStageHistory(projectId, 6, sessionToken, { beforeRevision: revision + 1, limit: 1 }, controller.signal).then((page) => {
      if (controller.signal.aborted) return;
      const round = page.items.length === 1 ? page.items[0] : undefined;
      setState(round && validReturn(round, projectId, stageNumber, revision) ? { phase: "ready", round } : { phase: "error" });
    }).catch(() => { if (!controller.signal.aborted) setState({ phase: "error" }); });
    return () => controller.abort();
  }, [projectId, stageNumber, revision, sessionToken, retry]);
  if (state.phase === "ready" && state.round) return <ReturnContext round={state.round} />;
  if (state.phase === "loading") return <p role="status" className="rounded-lg border border-border p-3 text-12">正在读取第6步共享 V{revision} 的本轮学习记录…</p>;
  return <ReturnUnavailable projectId={projectId} revision={String(revision)} message="未能读取与本步骤匹配的历史学习记录。尚未带入上下文，请重试或核对第6步历史。" onRetry={() => setRetry((value) => value + 1)} />;
}
