"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import type { DigitalInterviewWorkflowView } from "@/lib/interview-api";
import { loadInterviewMarkdown, branchInterviewMarkdown } from "@/lib/interview-markdown-api";
import { Button } from "@/components/ui/button";
import { InterviewWorkbenchHeader, INTERVIEW_WORKBENCH_STEPS } from "./interview-workbench-header";
import { InterviewMarkdownPlanningStep } from "./interview-markdown-planning-step";
import { InterviewMarkdownEditingStep } from "./interview-markdown-editing-step";
import { InterviewMarkdownResultsStep } from "./interview-markdown-results-step";
import type { WorkbenchStep } from "./digital-interview-workflow";


/** Legacy workflow contributes identity metadata only, never an editable research body. */
export function InterviewMarkdownWorkbench({ identity, step, reportPin }: { identity: DigitalInterviewWorkflowView; step: WorkbenchStep; reportPin?: { documentId: string; version: number } }) {
  const router = useRouter();
  const [version, setVersion] = React.useState(identity.version);
  const [completed, setCompleted] = React.useState<readonly string[]>([]);
  const [branchEpoch, setBranchEpoch] = React.useState(0);
  const [branching, setBranching] = React.useState(false);
  const [error, setError] = React.useState("");
  const dirty = React.useRef(false);
  React.useEffect(() => {
    const controller = new AbortController();
    void loadInterviewMarkdown(identity.interviewId, controller.signal).then((source) => {
      if (controller.signal.aborted) return;
      setCompleted(source.documents.filter((doc) => source.states.some((state) => state.documentId === doc.documentId && (state.status === "confirmed" || state.status === "completed"))).map((doc) => doc.step));
    }).catch(() => { /* Child surfaces initialization/retry errors. */ });
    return () => controller.abort();
  }, [identity.interviewId, version]);
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
    if (branching || !["intake", "analysis", "experts", "outline"].includes(step)) return;
    if (!window.confirm("创建新修订将保留旧版本，并在新修订中重新确认当前及后续步骤。继续吗？")) return;
    setBranching(true); setError("");
    try {
      const current = await loadInterviewMarkdown(identity.interviewId);
      const next = await branchInterviewMarkdown(identity.interviewId, { expectedVersion: current.version, fromStep: step as "intake" | "analysis" | "experts" | "outline" });
      dirty.current = false; setBranchEpoch((value) => value + 1); setVersion(next.version);
    } catch { setError("新修订未创建；原版本保持不变。请重新载入当前版本后重试。"); }
    finally { setBranching(false); }
  }
  const editing = { interviewId: identity.interviewId, onVersionChange: setVersion, onDirtyChange: (value: boolean) => { dirty.current = value; } };
  return <main data-testid="itv-markdown-workbench" className="min-h-screen w-full bg-background px-4 py-4 lg:px-6">
    <div className="mx-auto max-w-[1440px]">
      <InterviewWorkbenchHeader name={identity.name} tags={identity.tags} steps={INTERVIEW_WORKBENCH_STEPS} activeStep={step} completedSteps={completed} status="Markdown 研究工作台" version={version} topic={null} onStepChange={onContinue} onReturnToList={() => navigate("/itv?tab=history")} />
      {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
      {completed.includes(step) && ["intake", "analysis", "experts", "outline"].includes(step) && <div className="mt-4 flex justify-end"><Button variant="outline" disabled={branching} onClick={() => void revise()}>{branching ? "正在创建新修订…" : "创建新修订并修改"}</Button></div>}
      <section key={`${step}:${branchEpoch}`} className="mt-4">
        {(step === "intake" || step === "analysis") && <InterviewMarkdownPlanningStep {...editing} step={step} onContinue={onContinue} />}
        {(step === "experts" || step === "outline") && <InterviewMarkdownEditingStep {...editing} step={step} onContinue={onContinue} />}
        {(step === "runs" || step === "report") && <InterviewMarkdownResultsStep interviewId={identity.interviewId} step={step} runs={[]} reportPin={reportPin} onVersionChange={setVersion} onReport={() => onContinue("report")} />}
      </section>
    </div>
  </main>;
}
