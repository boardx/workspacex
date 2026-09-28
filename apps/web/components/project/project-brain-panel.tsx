"use client";
import * as React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionTitle } from "./parts";
import { getStoredSessionToken } from "@/lib/api-client";
import { KG_TRI_STATE_LABEL_ZH, type KgClaimKind, type KgClaim } from "@repo/contracts/chat-knowledge-graph";
import { KG_CLAIM_KIND_LABEL_ZH } from "@/lib/knowledge-graph-view";
import { sharedFromPersonalLabelZh as sharedFromPersonalLabel } from "@repo/contracts/chat-knowledge-graph";
import {
  fetchClaimSources, fetchProjectKnowledge, fetchProjectReasoning, knowledgeGraphErrorCode, promoteToOrg,
  type ProjectKnowledge, type ProjectReasoning, type PromotionChoice, type PromotionResults,
} from "@/lib/knowledge-graph-api";
import { PROJECT_EVIDENCE_SOURCE_LABEL_ZH, type ProjectEvidenceSourceKind } from "@repo/contracts/project-evidence";
import { httpFailureText } from "@/lib/http-failure-text";
import { ApiError } from "@/lib/api-client";
import { ClaimSourceDrawer } from "@/components/chat/knowledge/claim-source-drawer";
import { useClaimSourcesDrawer } from "@/components/chat/knowledge/knowledge-panel";

/**
 * 「项目大脑」面板（项目中枢 R8）——研究洞察 › 研究总览。
 *
 * 数据：`getProjectKnowledge(projectId)`（项目记忆 L2：由「记到项目大脑」晋升来的结论）。按类型分组
 * （事实 / 决定 / 待办 / 风险 / 猜测），每条带三态与支持 / 反对证据数。全部真实：项目里还没人记下
 * 东西 ⇒ 如实空态，并告诉用户怎么记（项目对话的知识面板）。
 * 非成员 ⇒ 服务端 403 `KG_NOT_VISIBLE`，如实显示。
 *
 * R9（推理）：分组之上先摆「假设与矛盾」——`kind = hypothesis` 的按 支持 − 反对 证据数排序（还没站住的
 * 在前），`triState = conflict` 的单列「有矛盾」；每条可点「来源」打开既有的来源抽屉（`getClaimSources`
 * 对项目结论回链到证据会话，只对项目成员）。
 *
 * B2-S4（#4428）：服务端 `canPromoteToOrg`（组织 lead / admin）为 true 时，每条多一个「记到组织记忆」按钮
 * （`promoteToOrg`，L2 → L3）；逐条显示结果，相近时让人选合并 / 并存。旧响应没有这个字段 ⇒ 没有入口。
 *
 * B3-T3（#4497）：再取 `getProjectReasoning(projectId)`（服务端确定性算出，不调模型），在分组之上多三区：
 * 跨来源冲突 / 缺口与建议 / 推理链。每条引用可点：有 `evidenceId` 的链到「研究洞察 › 来源」并带 `evidence=` 参数
 * （T1 的来源页读它定位到那条证据）；没有的（老数据）回退到既有的来源抽屉。推理接口单独失败不拖垮整个面板。
 */
// S10（#4367）：成员可以把个人记忆里的目标 / 偏好分享进来，这两类也要列出来（否则分享了却看不见）。
const KIND_ORDER: readonly KgClaimKind[] = ["decision", "fact", "hypothesis", "risk", "todo", "goal", "preference"];

export function ProjectBrainPanel({ projectId }: { projectId: string }) {
  const [data, setData] = React.useState<ProjectKnowledge | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [crossReasoning, setCrossReasoning] = React.useState<ProjectReasoning | null>(null);
  const [crossReasoningError, setCrossReasoningError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!getStoredSessionToken()) { setData(null); setCrossReasoning(null); return; }
    setLoading(true); setError(null); setCrossReasoningError(null);
    // 两个请求并行；推理那一路失败只让它那一区显示失败，项目记忆本身照常显示。
    const reasoningReq = fetchProjectReasoning(projectId).then(
      (r) => { setCrossReasoning(r); },
      (e: unknown) => { setCrossReasoning(null); setCrossReasoningError(describeFailure(e)); },
    );
    try {
      setData(await fetchProjectKnowledge(projectId));
    } catch (e) {
      setError(describeFailure(e));
    } finally {
      setLoading(false);
    }
    await reasoningReq;
  }, [projectId]);
  React.useEffect(() => { void load(); }, [load]);

  const groups = KIND_ORDER
    .map((kind) => ({ kind, claims: (data?.claims ?? []).filter((c) => c.kind === kind) }))
    .filter((g) => g.claims.length > 0);
  const reasoning = reasoningView(data?.claims ?? []);
  const drawer = useClaimSourcesDrawer(loadSources);
  const org = useOrgPromotion(projectId, data?.canPromoteToOrg === true);
  const sharedBy = React.useMemo(
    () => new Map((data?.sharedFromPersonal ?? []).map((x) => [x.claimId, x.sharedByName] as const)),
    [data?.sharedFromPersonal],
  );

  return (
    <section data-testid="project-brain">
      <SectionTitle meta={data ? `${data.claims.length} 条 · ${data.objects.length} 个实体` : "项目记忆"}>项目大脑</SectionTitle>
      <Card>
        {error !== null ? (
          <div className="flex items-center gap-2 p-4">
            <p className="flex-1 text-11 text-destructive" data-testid="project-brain-error">{error}</p>
            <Button size="xs" variant="outline" onClick={() => void load()} data-testid="project-brain-retry">重试</Button>
          </div>
        ) : loading && data === null ? (
          <p className="p-4 text-11 text-muted-foreground" data-testid="project-brain-loading">读取项目记忆中…</p>
        ) : data === null ? (
          <p className="p-4 text-11 text-muted-foreground" data-testid="project-brain-anonymous">请先登录。</p>
        ) : groups.length === 0 ? (
          <p className="p-4 text-11 leading-relaxed text-muted-foreground" data-testid="project-brain-empty">
            这个项目还没有记下任何东西。在项目对话的知识面板里点「记到项目大脑」，或在个人记忆里点「分享到项目…」，记下的内容会出现在这里，项目里的对话也会自动想起它。
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-border" data-testid="project-brain-groups">
            {reasoning !== null ? (
              <div className="flex flex-col gap-2 bg-muted/30 p-3.5" data-testid="project-brain-reasoning">
                <div className="flex items-center gap-2">
                  <span className="text-12 font-medium">假设与矛盾</span>
                  <span className="font-mono text-10 text-muted-foreground">{reasoning.hypotheses.length + reasoning.conflicts.length}</span>
                </div>
                {reasoning.conflicts.length > 0 ? (
                  <div className="flex flex-col gap-1" data-testid="project-brain-conflicts">
                    <span className="text-10 text-muted-foreground">有矛盾——两边都有证据，还没人定</span>
                    <ul className="flex flex-col gap-1">
                      {reasoning.conflicts.map((c) => <ClaimRow key={c.id} claim={c} sharedBy={sharedBy.get(c.id)} onOpenSources={drawer.open} org={org} />)}
                    </ul>
                  </div>
                ) : null}
                {reasoning.hypotheses.length > 0 ? (
                  <div className="flex flex-col gap-1" data-testid="project-brain-hypotheses">
                    <span className="text-10 text-muted-foreground">猜测——按证据强弱排，站得最不稳的在前</span>
                    <ul className="flex flex-col gap-1">
                      {reasoning.hypotheses.map((c) => <ClaimRow key={c.id} claim={c} sharedBy={sharedBy.get(c.id)} onOpenSources={drawer.open} org={org} />)}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
            <CrossSourceReasoning projectId={projectId} reasoning={crossReasoning} error={crossReasoningError} onOpenSources={drawer.open} />
            {groups.map((g) => (
              <div key={g.kind} className="flex flex-col gap-1.5 p-3.5" data-testid={`project-brain-group-${g.kind}`}>
                <div className="flex items-center gap-2">
                  <span className="text-12 font-medium">{KG_CLAIM_KIND_LABEL_ZH[g.kind]}</span>
                  <span className="font-mono text-10 text-muted-foreground">{g.claims.length}</span>
                </div>
                <ul className="flex flex-col gap-1">
                  {g.claims.map((c) => <ClaimRow key={c.id} claim={c} sharedBy={sharedBy.get(c.id)} onOpenSources={drawer.open} org={org} />)}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>
      <ClaimSourceDrawer
        data={drawer.data}
        open={drawer.isOpen}
        loading={drawer.loading}
        error={drawer.error}
        onRetry={drawer.retry}
        onClose={drawer.close}
      />
    </section>
  );
}

function loadSources(claimId: string) {
  return fetchClaimSources(claimId);
}

/**
 * 推理视图：矛盾（`triState = conflict`，任何类型）单列；猜测（`kind = hypothesis`，不含已列入矛盾的）
 * 按 支持 − 反对 升序——净证据最少的最先看到。两边都空 ⇒ null，面板不画这一节。
 */
export function reasoningView(claims: readonly KgClaim[]): { conflicts: KgClaim[]; hypotheses: KgClaim[] } | null {
  const conflicts = claims.filter((c) => c.triState === "conflict");
  const hypotheses = claims
    .filter((c) => c.kind === "hypothesis" && c.triState !== "conflict")
    .sort((a, b) => (a.supportingCount - a.contradictingCount) - (b.supportingCount - b.contradictingCount));
  return conflicts.length === 0 && hypotheses.length === 0 ? null : { conflicts, hypotheses };
}

/** 来源页的深链：T1 的「研究洞察 › 来源」读 `evidence=` 参数定位到那条证据。这里只负责生成链接。 */
export function evidenceHref(projectId: string, evidenceId: string): string {
  return `/projects/${encodeURIComponent(projectId)}?tab=research&sub=sources&evidence=${encodeURIComponent(evidenceId)}`;
}

const sourceLabels = (kinds: readonly ProjectEvidenceSourceKind[]): string => kinds.map((k) => PROJECT_EVIDENCE_SOURCE_LABEL_ZH[k]).join(" / ");

/**
 * 一组引用：每个 `evidenceId` 一个链到来源页的链接；一个都没有而有 `claimId` 时，回退成打开既有来源抽屉的按钮。
 * 两者都没有 ⇒ 什么都不画（契约保证推理链每一步至少有一个，冲突 / 缺口的条目本身总有 claimId）。
 */
function Citations({ projectId, evidenceIds, claimId, testid, onOpenSources }: {
  projectId: string; evidenceIds: readonly string[]; claimId?: string; testid: string; onOpenSources: (claimId: string) => void;
}) {
  if (evidenceIds.length > 0) {
    return (
      <span className="flex flex-wrap gap-1" data-testid={testid}>
        {evidenceIds.map((id, i) => (
          <a key={id} href={evidenceHref(projectId, id)} className="text-10 text-primary underline-offset-2 hover:underline" data-testid={`${testid}-evidence-${id}`}>
            出处 {i + 1}
          </a>
        ))}
      </span>
    );
  }
  if (claimId === undefined) return null;
  return (
    <Button size="xs" variant="ghost" onClick={() => onOpenSources(claimId)} data-testid={`${testid}-fallback`}>来源</Button>
  );
}

/** B3-T3 三区：跨来源冲突 / 缺口与建议 / 推理链。三块都空 ⇒ 整节不画；推理接口失败 ⇒ 只在这里说明。 */
function CrossSourceReasoning({ projectId, reasoning, error, onOpenSources }: {
  projectId: string; reasoning: ProjectReasoning | null; error: string | null; onOpenSources: (claimId: string) => void;
}) {
  if (error !== null) {
    return <p className="p-3.5 text-10 text-destructive" data-testid="project-brain-cross-error">推理没读出来：{error}</p>;
  }
  if (reasoning === null || (reasoning.conflicts.length === 0 && reasoning.gaps.length === 0 && reasoning.chains.length === 0)) return null;
  return (
    <div className="flex flex-col gap-3 bg-muted/20 p-3.5" data-testid="project-brain-cross-reasoning">
      {reasoning.conflicts.length > 0 ? (
        <div className="flex flex-col gap-1" data-testid="project-brain-cross-conflicts">
          <div className="flex items-center gap-2">
            <span className="text-12 font-medium">跨来源冲突</span>
            <span className="font-mono text-10 text-muted-foreground">{reasoning.conflicts.length}</span>
          </div>
          <span className="text-10 text-muted-foreground">两处说法对不上——各自的出处列在下面，点开核对</span>
          <ul className="flex flex-col gap-1.5">
            {reasoning.conflicts.map((c) => (
              <li key={c.id} className="flex flex-col gap-1 text-11" data-testid={`project-brain-cross-conflict-${c.id}`}>
                <div className="flex items-center gap-2">
                  <Badge tone={c.kind === "cross_source" ? "danger" : "outline"}>{c.kind === "cross_source" ? "不同来源" : "同一来源"}</Badge>
                </div>
                {([["A", c.claimIds[0], c.statementA, c.sourceKindsA, c.evidenceIdsA], ["B", c.claimIds[1], c.statementB, c.sourceKindsB, c.evidenceIdsB]] as const).map(([side, claimId, statement, kinds, ids]) => (
                  <div key={side} className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 leading-relaxed">
                      <span>{statement}</span>
                      {kinds.length > 0 ? <span className="ml-1 text-10 text-muted-foreground">（{sourceLabels(kinds)}）</span> : <span className="ml-1 text-10 text-muted-foreground">（没有出处）</span>}
                    </span>
                    <Citations projectId={projectId} evidenceIds={ids} claimId={claimId} testid={`project-brain-cross-conflict-${c.id}-${side}`} onOpenSources={onOpenSources} />
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {reasoning.gaps.length > 0 ? (
        <div className="flex flex-col gap-1" data-testid="project-brain-gaps">
          <div className="flex items-center gap-2">
            <span className="text-12 font-medium">缺口与建议</span>
            <span className="font-mono text-10 text-muted-foreground">{reasoning.gaps.length}</span>
          </div>
          <span className="text-10 text-muted-foreground">还缺出处的猜测与决定</span>
          <ul className="flex flex-col gap-1.5">
            {reasoning.gaps.map((g) => (
              <li key={g.claimId} className="flex items-start gap-2 text-11" data-testid={`project-brain-gap-${g.claimId}`}>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5 leading-relaxed">
                  <span>{g.statement}</span>
                  <span className="text-10 text-muted-foreground" data-testid={`project-brain-gap-${g.claimId}-suggestion`}>{g.suggestion}</span>
                </span>
                <Badge tone="outline">{g.kind === "no_evidence" ? "没有出处" : `只有${sourceLabels(g.sourceKinds)}`}</Badge>
                {g.kind === "single_source" ? (
                  <Button size="xs" variant="ghost" onClick={() => onOpenSources(g.claimId)} data-testid={`project-brain-gap-${g.claimId}-sources`}>来源</Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {reasoning.chains.length > 0 ? (
        <div className="flex flex-col gap-1" data-testid="project-brain-chains">
          <div className="flex items-center gap-2">
            <span className="text-12 font-medium">推理链</span>
            <span className="font-mono text-10 text-muted-foreground">{reasoning.chains.length}</span>
          </div>
          <span className="text-10 text-muted-foreground">从前提到推论，每一步都有出处</span>
          <ul className="flex flex-col gap-2">
            {reasoning.chains.map((chain) => (
              <li key={chain.claimId} className="flex flex-col gap-1 text-11" data-testid={`project-brain-chain-${chain.claimId}`}>
                <ol className="flex flex-col gap-0.5">
                  {chain.steps.map((step, i) => (
                    <li key={i} className="flex items-start gap-2" data-testid={`project-brain-chain-${chain.claimId}-step-${i}`}>
                      <span className="shrink-0 font-mono text-10 text-muted-foreground">{step.kind === "premise" ? "前提" : "推论"}</span>
                      <span className="min-w-0 flex-1 leading-relaxed">
                        <span className={step.kind === "inference" ? "font-medium" : undefined}>{step.text}</span>
                        {step.sourceKinds.length > 0 ? <span className="ml-1 text-10 text-muted-foreground">（{sourceLabels(step.sourceKinds)}）</span> : null}
                      </span>
                      <Citations projectId={projectId} evidenceIds={step.evidenceIds} claimId={step.claimId} testid={`project-brain-chain-${chain.claimId}-step-${i}-cite`} onOpenSources={onOpenSources} />
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

type OrgPromotionState =
  | { readonly kind: "busy" }
  | { readonly kind: "done"; readonly result: PromotionResults["results"][number] }
  | { readonly kind: "failed"; readonly text: string };

interface OrgPromotion {
  /** 服务端说这个人能记到组织记忆（组织 lead / admin）；false ⇒ 不出入口 */
  readonly enabled: boolean;
  readonly states: ReadonlyMap<string, OrgPromotionState>;
  readonly promote: (claimId: string, choice?: PromotionChoice["choice"]) => void;
}

/** 「记到组织记忆」：一次记一条，逐条保存结果；相近（needs_choice）时把选择再交回同一接口。 */
function useOrgPromotion(projectId: string, enabled: boolean): OrgPromotion {
  const [states, setStates] = React.useState<ReadonlyMap<string, OrgPromotionState>>(new Map());
  const set = React.useCallback((claimId: string, state: OrgPromotionState) => {
    setStates((prev) => new Map(prev).set(claimId, state));
  }, []);
  const promote = React.useCallback((claimId: string, choice?: PromotionChoice["choice"]) => {
    set(claimId, { kind: "busy" });
    void promoteToOrg(projectId, [claimId], choice ? [{ claimId, choice }] : undefined)
      .then((out) => {
        const result = out.results.find((r) => r.claimId === claimId);
        if (result === undefined) set(claimId, { kind: "failed", text: "服务端没有返回这一条的结果。" });
        else set(claimId, { kind: "done", result });
      })
      .catch((e: unknown) => set(claimId, { kind: "failed", text: describePromoteFailure(e) }));
  }, [projectId, set]);
  return { enabled, states, promote };
}

function ClaimRow({ claim, sharedBy, onOpenSources, org }: { claim: KgClaim; sharedBy?: string; onOpenSources: (claimId: string) => void; org: OrgPromotion }) {
  const tone = claim.triState === "confirmed" ? "success" : claim.triState === "conflict" ? "danger" : "warning";
  const state = org.states.get(claim.id);
  return (
    <li className="flex flex-col gap-1 text-11" data-testid={`project-brain-claim-${claim.id}`}>
      <div className="flex items-start gap-2">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 leading-relaxed">
          <span>{claim.statement}</span>
          {sharedBy !== undefined ? (
            <span className="text-10 text-muted-foreground" data-testid={`project-brain-shared-by-${claim.id}`}>{sharedFromPersonalLabel(sharedBy)}</span>
          ) : null}
        </span>
        <Badge tone={tone === "success" ? "primary" : "outline"}>{KG_TRI_STATE_LABEL_ZH[claim.triState]}</Badge>
        <span className="shrink-0 font-mono text-10 text-muted-foreground" title="支持 / 反对的证据数">
          +{claim.supportingCount} / −{claim.contradictingCount}
        </span>
        {/* S10：分享来的那条，证据在分享人的个人对话里，别人打不开（R9 口径 404）——不给一个点了必失败的按钮 */}
        {sharedBy === undefined ? (
          <Button size="xs" variant="ghost" onClick={() => onOpenSources(claim.id)} data-testid={`project-brain-sources-${claim.id}`}>来源</Button>
        ) : null}
        {org.enabled && state?.kind !== "done" ? (
          <Button
            size="xs"
            variant="outline"
            disabled={state?.kind === "busy"}
            onClick={() => org.promote(claim.id)}
            data-testid={`project-brain-promote-org-${claim.id}`}
          >
            记到组织记忆
          </Button>
        ) : null}
      </div>
      {state !== undefined && state.kind !== "busy" ? (
        <div className="flex items-center gap-2 text-10 text-muted-foreground" data-testid={`project-brain-promote-org-result-${claim.id}`}>
          <span>{state.kind === "failed" ? state.text : describePromoteResult(state.result)}</span>
          {state.kind === "done" && state.result.outcome === "needs_choice" ? (
            <>
              <Button size="xs" variant="outline" onClick={() => org.promote(claim.id, "merge")} data-testid={`project-brain-promote-org-merge-${claim.id}`}>合并</Button>
              <Button size="xs" variant="ghost" onClick={() => org.promote(claim.id, "coexist")} data-testid={`project-brain-promote-org-coexist-${claim.id}`}>分开记</Button>
            </>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function describePromoteResult(r: PromotionResults["results"][number]): string {
  switch (r.outcome) {
    case "promoted": return "已记到组织记忆。";
    case "merged_into_existing": return "组织记忆里已有同一条，已合并。";
    case "coexisting": return "已作为单独一条记到组织记忆。";
    case "needs_choice": return "组织记忆里已有相近的一条，要合并还是分开记？";
    case "rejected":
      if (r.code === "KG_EVIDENCE_REVOKED") return "它的出处已经不在了，记不了。";
      if (r.code === "KG_CONTESTED_NEEDS_RESOLUTION") return "这条有矛盾，先解决再记。";
      return "这条不在项目记忆里。";
  }
}

function describePromoteFailure(e: unknown): string {
  const code = knowledgeGraphErrorCode(e);
  if (code === "KG_NOT_OWNER") return "只有组织负责人或管理员能记到组织记忆。";
  if (code === "KG_NOT_VISIBLE") return "你看不到这个项目，记不了。";
  if (e instanceof ApiError) return httpFailureText(e.status);
  return e instanceof Error ? e.message : "没记上，请稍后重试。";
}

function describeFailure(e: unknown): string {
  const code = knowledgeGraphErrorCode(e);
  if (code === "KG_NOT_VISIBLE") return "你不在这个项目里，看不到它的项目记忆。";
  if (e instanceof ApiError) return httpFailureText(e.status);
  return e instanceof Error ? e.message : "读取失败，请稍后重试。";
}
