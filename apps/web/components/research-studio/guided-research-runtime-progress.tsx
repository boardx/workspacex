import { research as C } from "@repo/contracts";
import type { GuidedResearchRuntime } from "@/lib/guided-research-api";
export const researchStageLabels = { planning: "规划研究任务", searching: "检索资料", organizing: "整理来源证据", writing: "撰写报告章节", reviewing: "检查分析与证据质量", synthesizing: "综合研究结论" } as const;
export function GuidedResearchRuntimeProgress({ state }: { state: GuidedResearchRuntime }) {
  const progress = state.progress;
  if (!progress) return null;
  const title = progress.sectionId ? state.outline.find((section) => section.id === progress.sectionId)?.title : null;
  const searching = progress.stage === "searching";
  const succeeded = state.tasks.filter((task) => task.status === "succeeded").length;
  const failed = state.tasks.filter((task) => task.status === "failed").length;
  const processed = succeeded + failed;
  const total = searching ? state.tasks.length || progress.total : progress.total;
  return <section className="space-y-2 rounded-lg border border-border bg-card p-4" data-testid="research-runtime-progress">
    <p role="status" aria-live="polite" className="text-12 font-medium">{researchStageLabels[progress.stage]} · {searching ? `已处理 ${processed} / ${total} · 成功 ${succeeded} · 失败 ${failed}` : `${progress.completed} / ${progress.total}`}{!state.busy && state.errorCode ? " · 已暂停" : ""}</p>
    {title && <p className="text-12 text-muted-foreground">{title}</p>}
    {total > 0 && <progress className="h-2 w-full accent-primary" value={searching ? succeeded : progress.completed} max={total} aria-label={searching ? "检索成功任务" : researchStageLabels[progress.stage]} />}
    {searching && failed > 0 && <p className="text-12 text-destructive">{failed} 项检索失败，尚未取得所需资料。</p>}
  </section>;
}
export function GuidedResearchPlanDetails({ state, errors }: { state: GuidedResearchRuntime; errors: Record<string, string> }) {
  return <div className="space-y-3">
    {state.researchPlan && <details className="rounded-lg border border-border bg-card p-4" data-testid="research-plan-details"><summary className="cursor-pointer text-12 font-medium">研究计划</summary><div className="mt-3 space-y-3 text-12"><div><h3 className="font-semibold">研究问题</h3><p className="mt-1 whitespace-pre-wrap">{state.researchPlan.optimizedQuestion}</p></div><div><h3 className="font-semibold">执行思路</h3><p className="mt-1 whitespace-pre-wrap">{state.researchPlan.overview}</p></div></div></details>}
    <details className="rounded-lg border border-border bg-card p-4"><summary className="cursor-pointer text-12 font-medium">检索任务明细 · {state.tasks.length} 项</summary><div className="mt-3 space-y-3">{state.tasks.map((task) => <section key={task.id} className="space-y-2 rounded-md border border-border p-3 text-12" data-testid="research-task-details">
      <h3 className="font-medium">{task.title || task.query}</h3>
      {task.objective && <p className="whitespace-pre-wrap">{task.objective}</p>}
      <p className="break-words text-muted-foreground">原始检索词：{task.query}</p>
      {Boolean(task.deliverables?.length) && <div><p className="font-medium">预期产出</p><ul className="mt-1 list-disc space-y-1 pl-4">{task.deliverables!.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
      <p className="text-muted-foreground">{{ pending: "等待检索", running: "正在检索", succeeded: "已完成", failed: "检索失败" }[task.status]} · 尝试 {task.searchAttempts?.length ?? task.attempts} 次</p>
      {Boolean(task.searchAttempts?.length) && <div>
        <p className="font-medium">实际检索尝试</p>
        <ol className="mt-1 space-y-2" aria-label="检索尝试历史">{task.searchAttempts!.map((attempt, index) => <li key={index} className="space-y-1">
          <p className={attempt.status === "failed" ? "text-destructive" : "text-muted-foreground"}>尝试 {index + 1} · {{ running: "正在检索", succeeded: "检索成功", failed: "检索失败" }[attempt.status]}</p>
          <p className="break-words whitespace-pre-wrap">{attempt.query}</p>
          {attempt.errorCode && <p className="text-destructive">{errors[attempt.errorCode] ?? "任务执行失败，请重试。"}</p>}
        </li>)}</ol>
      </div>}
      {task.status === "failed" && (task.searchAttempts?.length ?? 0) >= C.GUIDED_RESEARCH_SEARCH_ATTEMPT_LIMIT
        ? <p className="text-destructive">已达自动检索尝试上限，请补充来源或调整研究计划。</p>
        : task.errorCode && <p className="text-destructive">{errors[task.errorCode] ?? "任务执行失败，请重试。"}</p>}
    </section>)}</div></details>
  </div>;
}
