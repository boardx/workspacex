"use client";

/**
 * 门② / 门③ 的确认面板，以及**越权留痕**的可读呈现。
 *
 * ## 门②审的是差异，不是全图
 *
 * 活动图里门②的判据是「核实推理链」，而推理链在第二次及以后的审核中**只有变化的
 * 部分是新的**——让人每次重读整张图，实际结果是没人读，直接点通过。所以这里在
 * 已有发布版时明说「本次要审的是与第 N 版的差异」，并指向图谱的版本差异面板
 * （`ChatGraphVersionHistory`，PR #3692 已实现的结构化 diff）。
 *
 * ## 审计栏为什么要给用户看，而不只是进日志
 *
 * `research_gate_audit` 记下了每一次推进与拒绝，包括 **Agent 试图跳门**的尝试。
 * 把它埋在日志里，等于只有工程师能看见；而"这个结论是不是有人真的审过"恰恰是
 * 行研人员和他的上级最该看见的事。三个月后复盘（测试 C）要回答的第一个问题
 * 就是这个。
 *
 * 所以这里默认只显示**被拒**的与**过门**的两类——普通阶段推进太多，会把信号淹掉。
 */
import * as React from "react";
import { AlertCircle, ShieldAlert, ShieldCheck } from "lucide-react";
import { researchWorkflow as C } from "@repo/contracts";
import { Button } from "@/components/ui/button";
import {
  explainResearchFailure,
  getResearchAudit,
  passResearchGate,
  type ResearchAuditEntry,
  type ResearchSession,
} from "@/lib/live-research-workflow";

/** 门② / 门③ 的确认卡。门①有自己的逐条界面，不走这里。 */
export function ResearchGatePanel({
  session,
  onChange,
}: {
  session: ResearchSession;
  onChange: (next: ResearchSession) => void;
}): JSX.Element | null {
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<{ what: string; next: string } | null>(null);

  const gate = C.pendingGate(session.phase);
  // 门① 有专门的逐条界面；fields/logic 属于"按哪版口径算"，不在本轮范围。
  if (gate !== "reasoning" && gate !== "plan") return null;

  const published = session.lineage.publishedGraphVersion;
  const noBatch = session.lineage.materialBatchId === null;

  async function pass() {
    setBusy(true);
    setFailure(null);
    try {
      onChange(await passResearchGate(session.threadId, gate!));
    } catch (e) {
      setFailure(explainResearchFailure(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      data-testid={`research-gate-panel-${gate}`}
      className="border-b border-border bg-background px-5 py-4 md:px-8"
    >
      <div className="mx-auto w-full max-w-screen-2xl space-y-3">
        <h2 className="text-12 font-semibold">{C.GATE_LABELS[gate]}</h2>

        <p data-testid="research-gate-scope" className="text-11 leading-relaxed text-muted-foreground">
          {gate === "reasoning" ? (
            published > 0 ? (
              <>
                本次要审的是<strong>与第 {published} 版的差异</strong>，不是整张图——
                展开图谱的「版本」面板看结构化差异（新增 / 删除 / 改动的节点与边）。
                确认后将发布第 {published + 1} 版。
              </>
            ) : (
              <>这是第一版，请核实每个节点的判断状态是否都有材料依据。确认后将发布第 1 版。</>
            )
          ) : (
            <>
              逐项核对调整方案：预测与实际的偏差、根因属于框架性还是执行性、对应的调整项。
              采纳后工作流版本 +1，并发布第 {published + 1} 版图谱。
            </>
          )}
        </p>

        {/* 没有材料批次血缘 = 没人审过材料。此时发布图谱正是需求文档禁止的那件事，
            服务端会拒（GATE_NOT_PASSED）。与其让用户点了才知道，不如提前说清。 */}
        {noBatch ? (
          <p
            data-testid="research-gate-no-batch"
            className="flex items-start gap-1.5 rounded bg-warning-tint px-2 py-1.5 text-11 text-warning-tint-foreground"
          >
            <AlertCircle aria-hidden className="mt-0.5 size-3 shrink-0" />
            <span>这条研判还没有通过门①的材料批次。结论必须挂在有人审过的材料上，请先完成材料确认。</span>
          </p>
        ) : null}

        {failure ? (
          <p data-testid="research-gate-failure" className="flex items-start gap-1.5 text-11 text-destructive">
            <AlertCircle aria-hidden className="mt-0.5 size-3 shrink-0" />
            <span>
              {failure.what}。{failure.next}
            </span>
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            data-testid={`research-pass-gate-${gate}`}
            // ⚠ 必须显式 primary：Button 的默认 variant 是 secondary（灰底），
            //   而禁用态也是灰的——不写这一行，"可以点"和"点不了"在屏幕上完全
            //   一样。2026-09-15 看截图发现，两个状态并排放才看得出来。
            variant="primary"
            disabled={busy || noBatch}
            onClick={() => void pass()}
          >
            {gate === "reasoning" ? "确认推理链成立，发布图谱" : "采纳调整方案"}
          </Button>
          {noBatch ? (
            <span data-testid="research-gate-disabled-reason" className="text-11 text-muted-foreground">
              材料尚未通过确认
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/**
 * 审计栏：这条研判被谁推进过、被拒过几次。
 *
 * **被拒的那些行才是重点**——尤其 `actorKind: "agent"` 且
 * `refusal: "GATE_NOT_PASSED"`：那是 Agent 试图跳过人工确认直接往下走。
 * 这种事发生了而没人看得见，门就只是拦住了这一次，拦不住下一次的设计退化。
 */
export function ResearchAuditTrail({ threadId }: { threadId: string }): JSX.Element | null {
  const [rows, setRows] = React.useState<ResearchAuditEntry[] | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void getResearchAudit(threadId)
      .then((r) => { if (!cancelled) setRows(r); })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, [threadId]);

  // 只显示过门与被拒：普通阶段推进条数多，会把信号淹掉。
  const notable = (rows ?? []).filter((r) => r.outcome === "refused" || r.action.startsWith("gate:"));
  if (notable.length === 0) return null;

  const skipAttempts = notable.filter((r) => r.actorKind === "agent" && r.refusal === "GATE_NOT_PASSED").length;

  return (
    <section data-testid="research-audit-trail" className="px-5 py-3 md:px-8">
      <div className="mx-auto w-full max-w-screen-2xl space-y-2">
        <h3 className="text-11 font-semibold text-muted-foreground">推进记录</h3>

        {skipAttempts > 0 ? (
          <p data-testid="research-skip-attempts" className="flex items-center gap-1.5 text-11 text-warning">
            <ShieldAlert aria-hidden className="size-3" />
            Agent 曾 {skipAttempts} 次试图跳过人工确认，已被拦下。
          </p>
        ) : null}

        <ul className="space-y-1">
          {notable.slice(0, 20).map((r, i) => (
            <li key={`${r.createdAt}-${i}`} data-testid="research-audit-row" data-outcome={r.outcome} className="flex items-center gap-2 text-11">
              {r.outcome === "allowed" ? (
                <ShieldCheck aria-hidden className="size-3 text-success" />
              ) : (
                <ShieldAlert aria-hidden className="size-3 text-destructive" />
              )}
              <span className="text-muted-foreground">
                {new Date(r.createdAt).toLocaleString("zh-CN")}
              </span>
              <span>{r.actorKind === "human" ? "人工" : "Agent"}</span>
              <span className="text-muted-foreground">
                {r.action.startsWith("gate:")
                  ? C.GATE_LABELS[r.action.slice(5) as C.ResearchGateName]
                  : `推进到 ${C.PHASE_LABELS[r.action.slice(8) as C.ResearchPhaseName] ?? r.action}`}
              </span>
              {r.refusal ? (
                <span className="text-destructive">被拒：{C.REFUSAL_LABELS[r.refusal]}</span>
              ) : (
                <span className="text-success">通过</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
