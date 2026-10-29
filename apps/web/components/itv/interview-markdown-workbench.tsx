"use client";
import * as React from "react";
import { useInterviewSource } from "./interview-session-provider";
import { useRouter } from "next/navigation";
import type { DigitalInterviewWorkflowView } from "@/lib/interview-api";
import { loadInterviewMarkdown, branchInterviewMarkdown, type InterviewMarkdownEnvelope } from "@/lib/interview-markdown-api";
import { WorkflowActionButton as ActionButton } from "@/components/research-studio/research-workflow-actions";
import { InterviewWorkbenchHeader, INTERVIEW_WORKBENCH_STEPS } from "./interview-workbench-header";
import { InterviewMarkdownPlanningStep } from "./interview-markdown-planning-step";
import { InterviewMarkdownEditingStep } from "./interview-markdown-editing-step";
import { InterviewMarkdownResultsStep } from "./interview-markdown-results-step";
import type { WorkbenchStep } from "./digital-interview-workflow";
import { InterviewRevisionAction } from "./interview-step-header";
import { researchWorkspaceStyle } from "@/components/research-studio/research-workspace-style";
import { InterviewCompletionContext } from "./interview-completion-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";


function completionOf(interviewId: string, source: InterviewMarkdownEnvelope) {
  return { interviewId, version: source.version, steps: source.documents.filter(doc => source.states.some(state => state.documentId === doc.documentId && (state.status === "confirmed" || state.status === "completed"))).map(doc => doc.step) };
}

/** Legacy workflow contributes identity metadata only, never an editable research body. */
export function InterviewMarkdownWorkbench({ identity, step, reportPin }: { identity: DigitalInterviewWorkflowView; step: WorkbenchStep; reportPin?: { documentId: string; version: number } }) {
  const router = useRouter();
  const { source: sharedSource, setSource, refresh, cache, syncError } = useInterviewSource(identity.interviewId);
  const completion = React.useContext(InterviewCompletionContext);
  const cached = completion?.value?.interviewId === identity.interviewId ? completion.value : null;
  const [version, setVersion] = React.useState(cached?.version ?? identity.version);
  const [snapshot, setSnapshot] = React.useState(cached);
  const currentCompletion = sharedSource ? completionOf(identity.interviewId, sharedSource) : snapshot;
  const completed = currentCompletion?.interviewId === identity.interviewId ? currentCompletion.steps : [];
  const [completionError, setCompletionError] = React.useState(false);
  const [retryEpoch, setRetryEpoch] = React.useState(0);
  const publishCompletion = completion?.update;
  const [branchEpoch, setBranchEpoch] = React.useState(0);
  const [branching, setBranching] = React.useState(false);
  const [runningStep, setRunningStep] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");
  const dirty = React.useRef(false);
  React.useEffect(() => {
    const controller = new AbortController();
    void (cache ? refresh() : loadInterviewMarkdown(identity.interviewId, controller.signal)).then((source) => {
      if (controller.signal.aborted) return;
      const value = completionOf(identity.interviewId, source);
      setSnapshot(value); publishCompletion?.(value); setCompletionError(false);
    }).catch(() => { if (!controller.signal.aborted) setCompletionError(true); });
    return () => controller.abort();
  }, [identity.interviewId, version, retryEpoch, publishCompletion, cache, refresh]);
  React.useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, []);
  function navigate(path: string) {
    if (dirty.current && !window.confirm("有未保存的 Markdown 修改，确定离开并放弃这些修改吗？")) return;
    dirty.current = false; router.push(path);
  }
  const onContinue = (next: string) => navigate(`/itv/${encodeURIComponent(identity.interviewId)}/${next}`);
  async function revise() {
    if (branching || runningStep !== null || !["intake", "analysis", "experts", "outline"].includes(step)) return;
    if (!window.confirm("创建新修订将保留旧版本，并在新修订中重新确认当前及后续步骤。继续吗？")) return;
    setBranching(true); setError("");
    try {
      const current = await loadInterviewMarkdown(identity.interviewId);
      const next = await branchInterviewMarkdown(identity.interviewId, { expectedVersion: current.version, fromStep: step as "intake" | "analysis" | "experts" | "outline" });
      const value = completionOf(identity.interviewId, next);
      setSnapshot(value); publishCompletion?.(value); setSource(next);
      dirty.current = false; setBranchEpoch((value) => value + 1); setVersion(next.version);
    } catch { setError("新修订未创建；原版本保持不变。请重新载入当前版本后重试。"); }
    finally { setBranching(false); }
  }
  const editing = { interviewId: identity.interviewId, onVersionChange: setVersion, onRunningStepChange: setRunningStep, onDirtyChange: (value: boolean) => { dirty.current = value; } };
  return <div data-testid="itv-markdown-workbench" className="min-h-dvh min-w-0 bg-muted/20">
      <InterviewWorkbenchHeader name={identity.name} tags={identity.tags} steps={INTERVIEW_WORKBENCH_STEPS} activeStep={step} runningStep={runningStep} completedSteps={completed} completionPending={!currentCompletion || currentCompletion.interviewId !== identity.interviewId} status="Markdown 研究工作台" version={sharedSource?.version ?? version} topic={null} onStepChange={onContinue} onReturnToList={() => navigate("/itv?tab=history")} />
      <main className={cn(researchWorkspaceStyle.main, "pb-8")}>
      {completionError && <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 text-sm text-muted-foreground"><p>步骤状态暂时无法更新，已知状态与访谈内容保留。</p><Button variant="outline" size="sm" onClick={() => { setCompletionError(false); setRetryEpoch(value => value + 1); }}>重试步骤状态</Button></div>}
      {syncError && <div role="status" className="mt-4 flex items-center gap-3 text-sm text-muted-foreground"><p>{syncError}</p><Button variant="outline" size="sm" onClick={() => void refresh().catch(() => {})}>重试同步</Button></div>}
      {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
      <InterviewRevisionAction.Provider value={completed.includes(step) && ["intake", "analysis", "experts", "outline"].includes(step) ? <ActionButton variant="outline" loading={branching} disabled={branching || runningStep !== null} onClick={() => void revise()}>{branching ? "正在创建新修订…" : "创建新修订并修改"}</ActionButton> : null}>
      <section key={`${step}:${branchEpoch}`} className="mt-4">
        {(step === "intake" || step === "analysis") && <InterviewMarkdownPlanningStep {...editing} step={step} onContinue={onContinue} />}
        {(step === "experts" || step === "outline") && <InterviewMarkdownEditingStep {...editing} step={step} onContinue={onContinue} />}
        {(step === "runs" || step === "report") && <InterviewMarkdownResultsStep interviewId={identity.interviewId} step={step} runs={[]} reportPin={reportPin} onVersionChange={setVersion} onRunningStepChange={setRunningStep} onReport={() => onContinue("report")} />}
      </section>
      </InterviewRevisionAction.Provider>
      </main>
  </div>;
}
