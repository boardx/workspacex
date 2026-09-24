"use client";
import * as React from "react";
import { GuidedResearchIntentPlan } from "./guided-research-intent-plan";
import { GuidedResearchTrustConsole } from "./guided-research-trust-console";
import { GuidedResearchReadiness } from "./guided-research-readiness";

export function GuidedResearchTrustConsolePreview() {
  const [configured, setConfigured] = React.useState(false);
  const [paused, setPaused] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  return <main className="mx-auto max-w-7xl space-y-5 p-6">
    <header><h1 className="text-24 font-semibold">Deep Research 可信研究控制台</h1><p className="mt-1 text-sm text-muted-foreground">检查研究边界、实时活动、证据覆盖和发布质量门。</p></header>
    {!configured && <GuidedResearchIntentPlan initialIntent={undefined} initialPolicy={undefined} revision={0} disabled={false} onConfirm={() => setConfigured(true)} />}
    {configured && <>
      <GuidedResearchTrustConsole pending={false} onSteer={(action) => setPaused(action === "pause")} runtime={{ planRevision: 1, controlStatus: paused ? "paused" : "running",
        activity: [{ id: "a1", sequence: 1, stage: "searching", taskId: "task-1", summary: paused ? "研究已暂停" : "正在核验监管与产品一手资料", occurredAt: "2026-09-24T10:00:00Z", status: paused ? "paused" : "started" }],
        coverage: [{ sectionId: "market", questionId: "market:q1", status: ready ? "answered" : "weak", evidenceIds: ["source-1"], reasons: [ready ? "已获得两类独立来源" : "仍缺少独立交叉验证"] }],
        claimEvidence: [{ claimId: "claim-1", evidenceId: "evidence-1", quote: "产品允许用户在启动前审阅研究计划，并在运行过程中调整研究重点。", sourceId: "source-1", retrievedAt: "2026-09-24T09:58:00Z", confidence: ready ? "high" : "medium", traceIds: ["task-1"] }],
        conflicts: ready ? [] : [{ id: "conflict-1", claimIds: ["claim-1", "claim-2"], sourceIds: ["source-1", "source-2"], severity: "severe", status: "open", resolution: null }],
      }} />
      <GuidedResearchReadiness quality={{ citationCoverage: ready ? 100 : 67, authority: 80, recency: 100, crossValidation: ready ? 100 : 33, openGapCount: ready ? 0 : 1, overall: ready ? 95 : 70, explanations: ["评分来自已保存的来源、覆盖和冲突状态"] }} readiness={{ status: ready ? "ready" : "limited", blockers: ready ? [] : ["存在未解决的严重冲突"], warnings: ready ? [] : ["部分问题证据较弱"] }} />
      <button type="button" className="rounded-md border border-border px-4 py-2 text-sm" onClick={() => setReady(!ready)}>{ready ? "恢复缺口示例" : "模拟补齐证据"}</button>
    </>}
  </main>;
}
