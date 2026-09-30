"use client";
/**
 * UC-WC-3 —— Workflow 实例产出页（PRD / 研究简报 / 数据需求说明）。
 *
 * 数据只来自两条契约路由：`GET /workflow-instances/:id/output`（产出本体）与
 * `GET /workflow-instances/:id`（标题、阶段名、版本）。API 没有逐阶段产出正文的读路由，
 * 所以运行面板的阶段产出链接落到这里，并在顶部标明「来自哪个阶段」。
 */
import { useCallback, useEffect, useState } from "react";
import type { workContent } from "@repo/contracts";
import type { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { outputDisplayLabel, stageDisplayName, workflowDisplayName } from "@/lib/workflow-display-copy";
import {
  getWorkflowInstance,
  getWorkflowInstanceOutput,
  workflowErrorCode,
  type WorkflowInstanceOutput,
  type WorkflowInstanceProjection,
} from "@/lib/workflow-runtime-api";
import { evidenceSourceLabel, humaniseMetricName, humaniseOutputText, isInternalMetricId } from "@/lib/workflow-output-display";
import { workSkillDisplayName } from "@/lib/work-skill-display-copy";
import { describeWorkflowError } from "./workflow-copy";

type Claim = z.infer<typeof workContent.EvidencedClaim>;
type Output = NonNullable<WorkflowInstanceOutput["output"]>;

const CONFIDENCE_TEXT: Record<Claim["confidence"], string> = { low: "置信度低", medium: "置信度中", high: "置信度高" };
const CONFIDENCE_TONE: Record<Claim["confidence"], "outline" | "neutral" | "success"> = { low: "outline", medium: "neutral", high: "success" };
const KIND_TEXT: Record<Output["kind"], string> = { prd: "产品需求文档（PRD）", research_brief: "研究简报", data_needs_statement: "数据需求说明" };

export interface WorkflowOutputViewerProps {
  readonly instanceId: string;
  /** 从运行面板阶段行点进来时带的产出 id，用于标明来源阶段。 */
  readonly outputId?: string | null;
}

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; output: WorkflowInstanceOutput; projection: WorkflowInstanceProjection | null };

export function WorkflowOutputViewer({ instanceId, outputId }: WorkflowOutputViewerProps) {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const [output, projection] = await Promise.all([
        getWorkflowInstanceOutput(instanceId),
        getWorkflowInstance(instanceId).catch(() => null),
      ]);
      setState({ kind: "ready", output, projection });
    } catch (err) {
      setState({ kind: "error", message: describeWorkflowError(workflowErrorCode(err)) });
    }
  }, [instanceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const runHref = `/workflows/runs/${encodeURIComponent(instanceId)}`;
  const back = (
    <a href={runHref} data-testid="workflow-output-back" className="text-12 text-muted-foreground underline underline-offset-2">
      返回运行详情
    </a>
  );

  if (state.kind === "loading") {
    return (
      <section data-testid="workflow-output-viewer" data-state="loading" aria-busy="true" className="space-y-3">
        {back}
        <div className="h-6 w-1/2 animate-pulse rounded-md bg-muted" />
        <div className="h-24 animate-pulse rounded-lg bg-muted" />
        <p className="text-12 text-muted-foreground">正在加载产出…</p>
      </section>
    );
  }
  if (state.kind === "error") {
    return (
      <section data-testid="workflow-output-viewer" data-state="error" className="space-y-3">
        {back}
        <div role="alert" data-testid="workflow-output-error" className="rounded-lg border border-destructive p-3 text-13">
          <p>产出加载失败：{state.message}</p>
          <Button className="mt-2" size="sm" variant="outline" onClick={() => void load()} data-testid="workflow-output-retry">重试</Button>
        </div>
      </section>
    );
  }

  const { output, projection } = state;
  const source = outputId && projection
    ? projection.stages
        .flatMap((s, i) => s.outputs.map((o) => ({ stageName: stageDisplayName(s.stageId, s.title, i), label: outputDisplayLabel(o.label, "") === o.label ? o.label : null, outputId: o.outputId })))
        .find((o) => o.outputId === outputId)
    : undefined;

  return (
    <section data-testid="workflow-output-viewer" data-state={output.output ? "ready" : "empty"} className="space-y-4">
      {back}
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-16 font-semibold" data-testid="workflow-output-heading">
            {projection ? workflowDisplayName(projection.workflowKey) : "运行产出"}
          </h2>
          <Badge tone={output.outcome === "complete" ? "success" : "warning"} data-testid="workflow-output-outcome">
            {output.outcome === "complete" ? "已完成" : "部分待处理"}
          </Badge>
          {output.output ? <Badge tone="outline">{KIND_TEXT[output.output.kind]}</Badge> : null}
        </div>
        {projection ? (
          <p className="text-12 text-muted-foreground" data-testid="workflow-output-version">流程定义版本 v{projection.definitionVersion}</p>
        ) : null}
      </header>

      {source ? (
        <div role="note" data-testid="workflow-output-source" className="rounded-lg border bg-muted p-3 text-12">
          你点开的是「{source.stageName}」阶段的产出{source.label ? `「${source.label}」` : ""}。阶段产出会汇总进本次运行的最终产出，以下为最终产出全文。
        </div>
      ) : null}

      {output.output ? <OutputBody output={output.output} /> : (
        <div data-testid="workflow-output-empty" className="rounded-lg border border-dashed p-6 text-center text-13 text-muted-foreground">
          这次运行还没有生成产出。运行完成后产出会出现在这里。
        </div>
      )}

      {output.manualChecklist.length > 0 ? (
        <Block title="待人工核对" testId="workflow-output-checklist">
          <ul className="list-disc space-y-1 pl-5 text-13">{output.manualChecklist.map((c, i) => <li key={i}>{humaniseOutputText(c)}</li>)}</ul>
        </Block>
      ) : null}
      {output.deferredProposals.length > 0 ? (
        <Block title="暂缓写入的建议" testId="workflow-output-deferred">
          <ul className="space-y-1 text-13">
            {output.deferredProposals.map((d, i) => <li key={i}>{d.field}：{humaniseOutputText(d.proposedValue)}<Evidence refs={d.evidenceRefs} /></li>)}
          </ul>
        </Block>
      ) : null}

      {projection ? <Versions projection={projection} digest={output.output?.digest ?? null} evidenceRefs={collectEvidenceRefs(output)} metricIds={output.output?.kind === "prd" ? output.output.metrics.map((m) => m.name).filter(isInternalMetricId) : []} /> : null}
    </section>
  );
}

function Block(props: { readonly title: string; readonly testId: string; readonly children: React.ReactNode }) {
  return (
    <section data-testid={props.testId} className="rounded-lg border bg-card p-4">
      <h3 className="mb-2 text-14 font-semibold">{props.title}</h3>
      {props.children}
    </section>
  );
}

function Evidence({ refs }: { readonly refs: readonly string[] }) {
  if (refs.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1 text-12 text-muted-foreground" data-testid="workflow-output-evidence">
      <span>证据：</span>
      {refs.map((r, i) => (
        <span key={r} className="rounded-full border border-border bg-muted px-2 py-0.5 text-12" data-testid="workflow-output-evidence-chip">
          来源 {i + 1} · {evidenceSourceLabel(r)}
        </span>
      ))}
    </div>
  );
}

function ClaimView({ claim }: { readonly claim: Claim }) {
  return (
    <div>
      <div className="flex flex-wrap items-start gap-2">
        <p className="flex-1 text-13">{humaniseOutputText(claim.text)}</p>
        <Badge tone={CONFIDENCE_TONE[claim.confidence]}>{CONFIDENCE_TEXT[claim.confidence]}</Badge>
      </div>
      <Evidence refs={claim.evidenceRefs} />
    </div>
  );
}

function OutputBody({ output }: { readonly output: Output }) {
  if (output.kind === "prd") {
    return (
      <article data-testid="workflow-output-prd" className="space-y-4">
        <h3 className="text-20 font-semibold tracking-tight" data-testid="workflow-output-title">{humaniseOutputText(output.title, KIND_TEXT.prd)}</h3>
        <Block title="问题陈述" testId="workflow-output-problem"><ClaimView claim={output.problem} /></Block>
        <Block title="需求" testId="workflow-output-requirements">
          <ol className="space-y-2">
            {output.requirements.map((r) => (
              <li key={r.id} className="flex items-start gap-2 text-13">
                <code className="shrink-0 text-12 text-muted-foreground">{r.id}</code>
                <span className="flex-1">{humaniseOutputText(r.text)}</span>
                <Badge tone="outline">优先级 {r.priority}</Badge>
              </li>
            ))}
          </ol>
        </Block>
        <Block title="衡量指标" testId="workflow-output-metrics">
          <dl className="space-y-2 text-13">
            {output.metrics.map((m) => (
              <div key={m.name}><dt className="font-medium">{humaniseMetricName(m.name)}</dt><dd className="text-muted-foreground">{humaniseOutputText(m.definition)}</dd></div>
            ))}
          </dl>
        </Block>
      </article>
    );
  }
  if (output.kind === "research_brief") {
    return (
      <article data-testid="workflow-output-brief" className="space-y-4">
        <h3 className="text-20 font-semibold tracking-tight" data-testid="workflow-output-title">{humaniseOutputText(output.title, KIND_TEXT.research_brief)}</h3>
        <Block title="结论" testId="workflow-output-claims">
          <ul className="space-y-3">{output.claims.map((c) => <li key={c.claimId}><ClaimView claim={c} /></li>)}</ul>
        </Block>
        {output.risks.length > 0 ? (
          <Block title="风险" testId="workflow-output-risks">
            <ul className="space-y-3">{output.risks.map((c) => <li key={c.claimId}><ClaimView claim={c} /></li>)}</ul>
          </Block>
        ) : null}
      </article>
    );
  }
  return (
    <article data-testid="workflow-output-data-needs" className="space-y-4">
      <h3 className="text-20 font-semibold tracking-tight" data-testid="workflow-output-title">{humaniseOutputText(output.question, KIND_TEXT.data_needs_statement)}</h3>
      <Block title="缺少的材料" testId="workflow-output-missing">
        <ul className="list-disc space-y-1 pl-5 text-13">{output.missing.map((m, i) => <li key={i}>{m}</li>)}</ul>
      </Block>
    </article>
  );
}

function collectEvidenceRefs(output: WorkflowInstanceOutput): string[] {
  const refs: string[] = [];
  const o = output.output;
  if (o?.kind === "prd") refs.push(...o.problem.evidenceRefs);
  if (o?.kind === "research_brief") for (const c of [...o.claims, ...o.risks]) refs.push(...c.evidenceRefs);
  for (const d of output.deferredProposals) refs.push(...d.evidenceRefs);
  return [...new Set(refs)];
}

function Versions({ projection, digest, evidenceRefs, metricIds }: { readonly projection: WorkflowInstanceProjection; readonly digest: string | null; readonly evidenceRefs: readonly string[]; readonly metricIds: readonly string[] }) {
  const pinned = projection.stages.flatMap((s, i) => s.pinnedSkills.map((p) => ({ ...p, stageName: stageDisplayName(s.stageId, s.title, i) })));
  return (
    <Block title="版本信息" testId="workflow-output-versions">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-12">
        <dt className="text-muted-foreground">流程</dt><dd>{workflowDisplayName(projection.workflowKey)} · 第 {projection.definitionVersion} 版</dd>
        {pinned.map((p) => (
          <div key={`${p.stageId}-${p.stableId}`} className="contents">
            <dt className="text-muted-foreground">{p.stageName}</dt><dd>{workSkillDisplayName(p.stableId) ?? "内置技能"} · v{p.version}</dd>
          </div>
        ))}
      </dl>
      <details data-testid="workflow-output-tech-details" className="mt-3 text-12 text-muted-foreground">
        <summary className="cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">技术详情</summary>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt>流程标识</dt><dd><code>{`${projection.workflowKey}@${projection.definitionVersion}`}</code></dd>
          {digest ? (<><dt>产出摘要</dt><dd><code className="break-all" data-testid="workflow-output-digest">{digest}</code></dd></>) : null}
          {pinned.length > 0 ? (<><dt>技能编号</dt><dd><code>{pinned.map((p) => `${p.stableId}@${p.version}`).join(", ")}</code></dd></>) : null}
          {evidenceRefs.length > 0 ? (<><dt>证据引用</dt><dd><code className="break-all">{evidenceRefs.join(", ")}</code></dd></>) : null}
          {metricIds.length > 0 ? (<><dt>指标编号</dt><dd><code className="break-all">{metricIds.join(", ")}</code></dd></>) : null}
        </dl>
      </details>
    </Block>
  );
}
