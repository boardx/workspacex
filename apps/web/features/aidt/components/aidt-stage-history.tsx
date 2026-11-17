"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { listAidtStageHistory, type AidtSharedStage } from "@/features/aidt/lib/live-aidt-stages";
import { aidtUiStageSummary } from "@/features/aidt/lib/aidt-ui-drafts";

type Props = { projectId: string; stageId: number; sessionToken: string | null; currentRevision?: number };
type HistoryState = { phase: "loading" | "ready" | "error"; items: AidtSharedStage[]; next: number | null; accessDenied?: boolean };

/** A scope change unmounts the old reader before the new scope can display any rows. */
export function AidtStageHistory(props: Props) {
  if (!props.sessionToken) return <p className="text-12 text-muted-foreground">登录后可查看本组的历史版本。</p>;
  return <HistoryReader key={JSON.stringify([props.projectId, props.stageId, props.sessionToken, props.currentRevision])} {...props} sessionToken={props.sessionToken} />;
}
function HistoryReader({ projectId, stageId, sessionToken, currentRevision }: Props & { sessionToken: string }) {
  const [state, setState] = React.useState<HistoryState>({ phase: "loading", items: [], next: null });
  const [beforeRevision, setBeforeRevision] = React.useState<number>();
  const [retry, setRetry] = React.useState(0);
  React.useEffect(() => {
    const controller = new AbortController();
    setState((previous) => ({ ...previous, phase: "loading" }));
    void listAidtStageHistory(projectId, stageId, sessionToken, { beforeRevision, limit: 10 }, controller.signal).then((page) => {
      if (!controller.signal.aborted) setState((previous) => ({ phase: "ready", items: beforeRevision === undefined ? page.items : [...previous.items, ...page.items], next: page.nextBeforeRevision }));
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      const accessDenied = error instanceof ApiError && [401, 403, 404].includes(error.status);
      setState((previous) => accessDenied ? { phase: "error", items: [], next: null, accessDenied } : { ...previous, phase: "error", accessDenied: false });
    });
    return () => controller.abort();
  }, [projectId, stageId, sessionToken, beforeRevision, retry]);
  return <section aria-label="本步历史版本" className="mt-3 space-y-3 text-12" data-testid="aidt-stage-history">
    <p className="text-muted-foreground">只读查看已保存记录。共享版本号记录保存次序，不代表原型版本或研究已验证。</p>
    {state.items.map((stage) => <details key={stage.revision} className="rounded-lg border border-border p-3" data-testid="aidt-history-revision">
      <summary className="cursor-pointer font-medium">共享 V{stage.revision}{stage.revision === currentRevision ? " · 当前已读取版本" : ""}<span className="ml-2 font-normal text-muted-foreground">{stage.updatedAt}</span></summary>
      <p className="mt-2 break-words text-muted-foreground">提交者：{stage.updatedBy}</p>
      <p className="mt-1 text-muted-foreground">实际保存的前序引用：{stage.sourceStageRevisions.length ? stage.sourceStageRevisions.map((source) => `第${source.stageId}步 V${source.revision}`).join("、") : "未绑定前序版本"}</p>
      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-sans" data-testid={`aidt-history-content-${stage.revision}`}>{aidtUiStageSummary(stageId, stage.content.draft) || "已保存空草稿"}</pre>
      {stage.content.summaryReport && <details className="mt-2"><summary className="cursor-pointer">当时保存的小组报告</summary><p className="mt-2 text-muted-foreground">报告来源：{stage.content.summaryReport.sourceStageRevisions.length ? stage.content.summaryReport.sourceStageRevisions.map((source) => `第${source.stageId}步 V${source.revision}`).join("、") : "未绑定来源版本"}</p><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-sans">{stage.content.summaryReport.markdown}</pre></details>}
    </details>)}
    {state.phase === "loading" && <p role="status">正在读取历史版本…</p>}
    {state.phase === "ready" && !state.items.length && <p data-testid="aidt-history-empty">本组尚无本步共享保存记录。</p>}
    {state.phase === "error" && <div role="alert"><p>{state.accessDenied ? "当前登录无法访问本组历史，已隐藏此前记录。请核对登录和项目权限后重试。" : "历史版本读取失败，已显示的记录仍保留。可以重试。"}</p><Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => { if (!state.items.length) setBeforeRevision(undefined); setRetry((value) => value + 1); }}>重试读取历史</Button></div>}
    {state.phase === "ready" && state.next !== null && <Button type="button" size="sm" variant="outline" onClick={() => setBeforeRevision(state.next!)}>查看更多历史</Button>}
  </section>;
}
