"use client";
import * as React from "react";
import { useI18n } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/locale";
import { translate, type MessageKey } from "@/lib/i18n/messages";
import { graphClaimKindLabel, graphTriStateLabel } from "@/lib/knowledge-graph-copy";
import { projectEvidenceKindLabel } from "@/lib/i18n/project-evidence-copy";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionTitle } from "./parts";
import { getStoredSessionToken } from "@/lib/api-client";
import { Textarea } from "@/components/ui/textarea";
import {
  KG_ADOPT_RATIONALE_MAX, KG_TRI_STATE_LABEL_ZH, isAdoptableClaimKind, type KgAdoptedDecision, type KgClaimKind, type KgClaim, type KgEvidenceAnchor,
} from "@repo/contracts/chat-knowledge-graph";
import { PROJECT_EVIDENCE_TO_AI_SOURCE, ProjectEvidenceSourceKind, type ProjectEvidenceSourceKind as EvidenceKind } from "@repo/contracts/project-evidence";
import { getProjectAiSettings, type ProjectAiSourceKind } from "@/lib/live-project-ai-settings";
import {
  adoptProjectDecision, fetchClaimSources, fetchProjectKnowledge, fetchProjectReasoning, knowledgeGraphErrorCode, promoteToOrg,
  type ClaimSources, type ProjectKnowledge, type ProjectReasoning, type PromotionChoice, type PromotionResults,
} from "@/lib/knowledge-graph-api";
import { httpFailureText } from "@/lib/http-failure-text";
import { ApiError } from "@/lib/api-client";
import { ClaimSourceDrawer } from "@/components/chat/knowledge/claim-source-drawer";
import { useClaimSourcesDrawer } from "@/components/chat/knowledge/knowledge-panel";

type ReadFailure = { readonly cause: unknown };
type PromotionFailure = ReadFailure | { readonly key: MessageKey };


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
 * B3-T4（#4498）：事实 / 猜测每条多一个「采纳为项目决策」按钮——点开填理由（≤ 500 字）再确认，`adoptProjectDecision`
 * 新建一条「决定」并回链到来源；成功后重读项目记忆，决定区显示「采纳自 …」与理由（`adoptedDecisions`，旧响应缺省 ⇒
 * 不显示）。观察者 / 非成员由服务端拒（KG_NOT_OWNER / KG_NOT_VISIBLE），如实显示。
 * B3-T2（#4496）：每条结论显示它的**证据来源类型**标签（六类，按锚点 `sourceKind` 去重，标签文案取契约
 * `PROJECT_EVIDENCE_SOURCE_LABEL_ZH`）；来源在设置页「AI 权限」里被关掉的标灰、title「来源已关闭」——已入图的
 * 结论不删，只标。关没关由 `getProjectAiSettings` 本地推导（`PROJECT_EVIDENCE_TO_AI_SOURCE` 反投影），
 * `getProjectKnowledge` 契约不改。锚点不在 `getProjectKnowledge` 的结论里（只在 `getClaimSources`），
 * 所以面板加载后逐条（顺序、上限 `SOURCE_KINDS_PREFETCH_LIMIT`）取来源填标签；分享自个人记忆的那些不取
 * （R9 口径 404）。协调者若在 `getProjectKnowledge.out` 加每条结论的 sourceKinds，这里的预取就可以拿掉。
 */
// S10（#4367）：成员可以把个人记忆里的目标 / 偏好分享进来，这两类也要列出来（否则分享了却看不见）。
const KIND_ORDER: readonly KgClaimKind[] = ["decision", "fact", "hypothesis", "risk", "todo", "goal", "preference"];

/** 面板加载后为了填来源标签逐条预取来源的上限：每条一次请求，再多就等用户点「来源」。 */
export const SOURCE_KINDS_PREFETCH_LIMIT = 30;

/**
 * 设置页五个开关 → 被关掉的证据来源（六类）。映射只在契约 `PROJECT_EVIDENCE_TO_AI_SOURCE` 一份，这里只是反过来过滤。
 * `allowed = null`（还没读到 / 读失败）⇒ 什么都不标：不知道就不乱标。
 */
export function closedEvidenceKinds(allowed: readonly ProjectAiSourceKind[] | null): ReadonlySet<EvidenceKind> {
  if (allowed === null) return new Set();
  const on = new Set<ProjectAiSourceKind>(allowed);
  return new Set(ProjectEvidenceSourceKind.options.filter((k) => !on.has(PROJECT_EVIDENCE_TO_AI_SOURCE[k])));
}

/** 锚点 → 去重后的来源类型（按契约枚举顺序，稳定）。 */
export function evidenceSourceKinds(evidence: readonly Pick<KgEvidenceAnchor, "sourceKind">[]): readonly EvidenceKind[] {
  const seen = new Set(evidence.map((e) => e.sourceKind));
  return ProjectEvidenceSourceKind.options.filter((k) => seen.has(k));
}

export function ProjectBrainPanel({ projectId }: { projectId: string }) {
  const { locale, t } = useI18n();
  const [data, setData] = React.useState<ProjectKnowledge | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<ReadFailure | null>(null);
  const [crossReasoning, setCrossReasoning] = React.useState<ProjectReasoning | null>(null);
  const [crossReasoningError, setCrossReasoningError] = React.useState<ReadFailure | null>(null);
  const aiAllowed = useProjectAiAllowed(projectId);
  const closed = React.useMemo(() => closedEvidenceKinds(aiAllowed), [aiAllowed]);

  const load = React.useCallback(async () => {
    if (!getStoredSessionToken()) { setData(null); setCrossReasoning(null); return; }
    setLoading(true); setError(null); setCrossReasoningError(null);
    // 两个请求并行；推理那一路失败只让它那一区显示失败，项目记忆本身照常显示。
    const reasoningReq = fetchProjectReasoning(projectId).then(
      (r) => { setCrossReasoning(r); },
      (e: unknown) => { setCrossReasoning(null); setCrossReasoningError({ cause: e }); },
    );
    try {
      setData(await fetchProjectKnowledge(projectId));
    } catch (e) {
      setError({ cause: e });
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
  const sharedBy = React.useMemo(
    () => new Map((data?.sharedFromPersonal ?? []).map((x) => [x.claimId, x.sharedByName] as const)),
    [data?.sharedFromPersonal],
  );
  const adoptedFrom = React.useMemo(() => {
    const statements = new Map((data?.claims ?? []).map((c) => [c.id, c.statement] as const));
    return new Map((data?.adoptedDecisions ?? []).map((d) => [d.decisionClaimId, { ...d, sourceStatement: statements.get(d.sourceClaimId) ?? null }] as const));
  }, [data?.claims, data?.adoptedDecisions]);
  const kinds = useClaimSourceKinds(data?.claims ?? [], sharedBy);
  const drawer = useClaimSourcesDrawer(kinds.load);
  const org = useOrgPromotion(projectId, data?.canPromoteToOrg === true);
  const adopt = useAdoption(projectId, load);
  const row = (c: KgClaim) => (
    <ClaimRow key={c.id} claim={c} sharedBy={sharedBy.get(c.id)} adoptedFrom={adoptedFrom.get(c.id)} onOpenSources={drawer.open} org={org} adopt={adopt} sourceKinds={kinds.byClaim.get(c.id)} closed={closed} />
  );

  return (
    <section data-testid="project-brain">
      <SectionTitle meta={data ? t("projectBrain.summary", { claims: data.claims.length, objects: data.objects.length }) : t("projectBrain.memory")}>{t("projectBrain.brain")}</SectionTitle>
      <Card>
        {error !== null ? (
          <div className="flex items-center gap-2 p-4">
            <p className="flex-1 text-12 text-destructive" data-testid="project-brain-error">{describeFailure(error.cause, locale)}</p>
            <Button size="xs" variant="outline" onClick={() => void load()} data-testid="project-brain-retry">{t("ui.retry")}</Button>
          </div>
        ) : loading && data === null ? (
          <p className="p-4 text-12 text-muted-foreground" data-testid="project-brain-loading">{t("projectBrain.memoryLoading")}</p>
        ) : data === null ? (
          <p className="p-4 text-12 text-muted-foreground" data-testid="project-brain-anonymous">{t("projectBrain.signIn")}</p>
        ) : groups.length === 0 ? (
          <p className="p-4 text-12 leading-relaxed text-muted-foreground" data-testid="project-brain-empty">
            {t("projectBrain.brainEmpty")}
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-border" data-testid="project-brain-groups">
            {reasoning !== null ? (
              <div className="flex flex-col gap-2 bg-muted/30 p-3.5" data-testid="project-brain-reasoning">
                <div className="flex items-center gap-2">
                  <span className="text-12 font-medium">{t("projectBrain.hypothesesConflicts")}</span>
                  <span className="font-mono text-11 text-muted-foreground">{reasoning.hypotheses.length + reasoning.conflicts.length}</span>
                </div>
                {reasoning.conflicts.length > 0 ? (
                  <div className="flex flex-col gap-1" data-testid="project-brain-conflicts">
                    <span className="text-11 text-muted-foreground">{t("projectBrain.conflictsHelp")}</span>
                    <ul className="flex flex-col gap-1">
                      {reasoning.conflicts.map(row)}
                    </ul>
                  </div>
                ) : null}
                {reasoning.hypotheses.length > 0 ? (
                  <div className="flex flex-col gap-1" data-testid="project-brain-hypotheses">
                    <span className="text-11 text-muted-foreground">{t("projectBrain.hypothesesHelp")}</span>
                    <ul className="flex flex-col gap-1">
                      {reasoning.hypotheses.map(row)}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
            <CrossSourceReasoning projectId={projectId} reasoning={crossReasoning} error={crossReasoningError} onOpenSources={drawer.open} />
            {groups.map((g) => (
              <div key={g.kind} className="flex flex-col gap-1.5 p-3.5" data-testid={`project-brain-group-${g.kind}`}>
                <div className="flex items-center gap-2">
                  <span className="text-12 font-medium">{graphClaimKindLabel(g.kind, locale)}</span>
                  <span className="font-mono text-11 text-muted-foreground">{g.claims.length}</span>
                </div>
                <ul className="flex flex-col gap-1">
                  {g.claims.map(row)}
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

/** 「AI 权限」现值（只读；读失败 ⇒ null，面板不标任何来源为已关闭）。 */
function useProjectAiAllowed(projectId: string): readonly ProjectAiSourceKind[] | null {
  const [allowed, setAllowed] = React.useState<readonly ProjectAiSourceKind[] | null>(null);
  React.useEffect(() => {
    let alive = true;
    if (!getStoredSessionToken()) { setAllowed(null); return; }
    getProjectAiSettings(projectId)
      .then((s) => { if (alive) setAllowed(s.allowedSources); })
      .catch(() => { if (alive) setAllowed(null); });
    return () => { alive = false; };
  }, [projectId]);
  return allowed;
}

interface ClaimSourceKinds {
  readonly byClaim: ReadonlyMap<string, readonly EvidenceKind[]>;
  /** 来源抽屉的加载器：同一次请求顺手把标签也填上。 */
  readonly load: (claimId: string) => Promise<ClaimSources>;
}

/**
 * 每条结论的证据来源类型：面板加载后顺序预取（上限 `SOURCE_KINDS_PREFETCH_LIMIT`），抽屉打开时同一个加载器再填。
 * 单条失败只是那条没有标签（来源抽屉自己会如实报错）；分享自个人记忆的不取。
 */
function useClaimSourceKinds(claims: readonly KgClaim[], sharedBy: ReadonlyMap<string, string>): ClaimSourceKinds {
  const [byClaim, setByClaim] = React.useState<ReadonlyMap<string, readonly EvidenceKind[]>>(new Map());
  const load = React.useCallback(async (claimId: string) => {
    const sources = await fetchClaimSources(claimId);
    const kinds = evidenceSourceKinds(sources.evidence);  // 在 setState 之外算：载荷不对在这里抛，预取的 try/catch 接得住
    setByClaim((prev) => new Map(prev).set(claimId, kinds));
    return sources;
  }, []);
  const ids = claims.filter((c) => !sharedBy.has(c.id)).slice(0, SOURCE_KINDS_PREFETCH_LIMIT).map((c) => c.id).join("\u0000");
  React.useEffect(() => {
    let alive = true;
    void (async () => {
      for (const id of ids === "" ? [] : ids.split("\u0000")) {
        if (!alive) return;
        try { await load(id); } catch { /* 那条没有标签；抽屉会如实报 */ }
      }
    })();
    return () => { alive = false; };
  }, [ids, load]);
  return { byClaim, load };
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

const sourceLabels = (kinds: readonly ProjectEvidenceSourceKind[], locale: Locale = "zh-CN"): string => kinds.map((k) => projectEvidenceKindLabel(k, locale)).join(" / ");

/**
 * 一组引用：每个 `evidenceId` 一个链到来源页的链接；一个都没有而有 `claimId` 时，回退成打开既有来源抽屉的按钮。
 * 两者都没有 ⇒ 什么都不画（契约保证推理链每一步至少有一个，冲突 / 缺口的条目本身总有 claimId）。
 */
function Citations({ projectId, evidenceIds, claimId, testid, onOpenSources }: {
  projectId: string; evidenceIds: readonly string[]; claimId?: string; testid: string; onOpenSources: (claimId: string) => void;
}) {
  const { t } = useI18n();
  if (evidenceIds.length > 0) {
    return (
      <span className="flex flex-wrap gap-1" data-testid={testid}>
        {evidenceIds.map((id, i) => (
          <a key={id} href={evidenceHref(projectId, id)} className="text-11 text-primary underline-offset-2 transition-colors duration-base hover:underline" data-testid={`${testid}-evidence-${id}`}>
            {t("projectBrain.citation", { index: i + 1 })}
          </a>
        ))}
      </span>
    );
  }
  if (claimId === undefined) return null;
  return (
    <Button size="xs" variant="ghost" onClick={() => onOpenSources(claimId)} data-testid={`${testid}-fallback`}>{t("projectBrain.sources")}</Button>
  );
}

/** B3-T3 三区：跨来源冲突 / 缺口与建议 / 推理链。三块都空 ⇒ 整节不画；推理接口失败 ⇒ 只在这里说明。 */
function CrossSourceReasoning({ projectId, reasoning, error, onOpenSources }: {
  projectId: string; reasoning: ProjectReasoning | null; error: ReadFailure | null; onOpenSources: (claimId: string) => void;
}) {
  const { locale, t } = useI18n();
  if (error !== null) {
    return <p className="p-3.5 text-11 text-destructive" data-testid="project-brain-cross-error">{t("projectBrain.reasoningFailed")}{describeFailure(error.cause, locale)}</p>;
  }
  if (reasoning === null || (reasoning.conflicts.length === 0 && reasoning.gaps.length === 0 && reasoning.chains.length === 0)) return null;
  return (
    <div className="flex flex-col gap-3 bg-muted/20 p-3.5" data-testid="project-brain-cross-reasoning">
      {reasoning.conflicts.length > 0 ? (
        <div className="flex flex-col gap-1" data-testid="project-brain-cross-conflicts">
          <div className="flex items-center gap-2">
            <span className="text-12 font-medium">{t("projectBrain.crossConflicts")}</span>
            <span className="font-mono text-11 text-muted-foreground">{reasoning.conflicts.length}</span>
          </div>
          <span className="text-11 text-muted-foreground">{t("projectBrain.crossHelp")}</span>
          <ul className="flex flex-col gap-1.5">
            {reasoning.conflicts.map((c) => (
              <li key={c.id} className="flex flex-col gap-1 text-12" data-testid={`project-brain-cross-conflict-${c.id}`}>
                <div className="flex items-center gap-2">
                  <Badge tone={c.kind === "cross_source" ? "danger" : "outline"}>{c.kind === "cross_source" ? t("projectBrain.differentSources") : t("projectBrain.sameSource")}</Badge>
                </div>
                {([["A", c.claimIds[0], c.statementA, c.sourceKindsA, c.evidenceIdsA], ["B", c.claimIds[1], c.statementB, c.sourceKindsB, c.evidenceIdsB]] as const).map(([side, claimId, statement, kinds, ids]) => (
                  <div key={side} className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 leading-relaxed">
                      <span>{statement}</span>
                      {kinds.length > 0 ? <span className="ml-1 text-11 text-muted-foreground">（{sourceLabels(kinds, locale)}）</span> : <span className="ml-1 text-11 text-muted-foreground">（{t("projectBrain.noSource")}）</span>}
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
            <span className="text-12 font-medium">{t("projectBrain.gaps")}</span>
            <span className="font-mono text-11 text-muted-foreground">{reasoning.gaps.length}</span>
          </div>
          <span className="text-11 text-muted-foreground">{t("projectBrain.gapsHelp")}</span>
          <ul className="flex flex-col gap-1.5">
            {reasoning.gaps.map((g) => (
              <li key={g.claimId} className="flex items-start gap-2 text-12" data-testid={`project-brain-gap-${g.claimId}`}>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5 leading-relaxed">
                  <span>{g.statement}</span>
                  <span className="text-11 text-muted-foreground" data-testid={`project-brain-gap-${g.claimId}-suggestion`}>{g.suggestion}</span>
                </span>
                <Badge tone="outline">{g.kind === "no_evidence" ? t("projectBrain.noSource") : t("projectBrain.onlySources", { sources: sourceLabels(g.sourceKinds, locale) })}</Badge>
                {g.kind === "single_source" ? (
                  <Button size="xs" variant="ghost" onClick={() => onOpenSources(g.claimId)} data-testid={`project-brain-gap-${g.claimId}-sources`}>{t("projectBrain.sources")}</Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {reasoning.chains.length > 0 ? (
        <div className="flex flex-col gap-1" data-testid="project-brain-chains">
          <div className="flex items-center gap-2">
            <span className="text-12 font-medium">{t("projectBrain.chains")}</span>
            <span className="font-mono text-11 text-muted-foreground">{reasoning.chains.length}</span>
          </div>
          <span className="text-11 text-muted-foreground">{t("projectBrain.chainsHelp")}</span>
          <ul className="flex flex-col gap-2">
            {reasoning.chains.map((chain) => (
              <li key={chain.claimId} className="flex flex-col gap-1 text-12" data-testid={`project-brain-chain-${chain.claimId}`}>
                <ol className="flex flex-col gap-0.5">
                  {chain.steps.map((step, i) => (
                    <li key={i} className="flex items-start gap-2" data-testid={`project-brain-chain-${chain.claimId}-step-${i}`}>
                      <span className="shrink-0 font-mono text-11 text-muted-foreground">{step.kind === "premise" ? t("projectBrain.premise") : t("projectBrain.inference")}</span>
                      <span className="min-w-0 flex-1 leading-relaxed">
                        <span className={step.kind === "inference" ? "font-medium" : undefined}>{step.text}</span>
                        {step.sourceKinds.length > 0 ? <span className="ml-1 text-11 text-muted-foreground">（{sourceLabels(step.sourceKinds, locale)}）</span> : null}
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
  | { readonly kind: "failed"; readonly text: PromotionFailure };

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
        if (result === undefined) set(claimId, { kind: "failed", text: { key: "projectBrain.missingResult" } });
        else set(claimId, { kind: "done", result });
      })
      .catch((e: unknown) => set(claimId, { kind: "failed", text: { cause: e } }));
  }, [projectId, set]);
  return { enabled, states, promote };
}

type AdoptionState =
  | { readonly kind: "editing"; readonly rationale: string }
  | { readonly kind: "busy"; readonly rationale: string }
  | { readonly kind: "done"; readonly decisionClaimId: string }
  | { readonly kind: "failed"; readonly rationale: string; readonly text: ReadFailure };

interface Adoption {
  readonly states: ReadonlyMap<string, AdoptionState>;
  readonly open: (claimId: string) => void;
  readonly edit: (claimId: string, rationale: string) => void;
  readonly cancel: (claimId: string) => void;
  readonly confirm: (claimId: string) => void;
}

/** 「采纳为项目决策」：点开填理由 → 确认 → `adoptProjectDecision`；成功后重读项目记忆，新决定连同「采纳自 …」一起出现。 */
function useAdoption(projectId: string, reload: () => Promise<void>): Adoption {
  const [states, setStates] = React.useState<ReadonlyMap<string, AdoptionState>>(new Map());
  const set = React.useCallback((claimId: string, state: AdoptionState | null) => {
    setStates((prev) => {
      const next = new Map(prev);
      if (state === null) next.delete(claimId); else next.set(claimId, state);
      return next;
    });
  }, []);
  const open = React.useCallback((claimId: string) => set(claimId, { kind: "editing", rationale: "" }), [set]);
  const edit = React.useCallback((claimId: string, rationale: string) => set(claimId, { kind: "editing", rationale: rationale.slice(0, KG_ADOPT_RATIONALE_MAX) }), [set]);
  const cancel = React.useCallback((claimId: string) => set(claimId, null), [set]);
  const confirm = React.useCallback((claimId: string) => {
    setStates((prev) => {
      const cur = prev.get(claimId);
      const rationale = cur !== undefined && cur.kind !== "done" ? cur.rationale.trim() : "";
      if (rationale.length === 0) return prev;
      void adoptProjectDecision(projectId, claimId, rationale)
        .then(async (out) => {
          set(claimId, { kind: "done", decisionClaimId: out.decisionClaimId });
          await reload();
        })
        .catch((e: unknown) => set(claimId, { kind: "failed", rationale, text: { cause: e } }));
      return new Map(prev).set(claimId, { kind: "busy", rationale });
    });
  }, [projectId, reload, set]);
  return { states, open, edit, cancel, confirm };
}

function describeAdoptFailure(e: unknown, locale: Locale = "zh-CN"): string {
  const code = knowledgeGraphErrorCode(e);
  if (code === "KG_NOT_OWNER") return translate(locale, "projectBrain.reason.adoptObserver");
  if (code === "KG_NOT_VISIBLE") return translate(locale, "projectBrain.reason.adoptNoRole");
  if (code === "KG_CONTESTED_NEEDS_RESOLUTION") return translate(locale, "projectBrain.reason.adoptConflict");
  if (code === "KG_CLAIM_NOT_FOUND") return translate(locale, "projectBrain.reason.adoptNotFound");
  if (e instanceof ApiError) return httpFailureText(e.status, locale);
  return e instanceof Error ? e.message : translate(locale, "projectBrain.reason.adoptFailed");
}

interface AdoptedFrom extends KgAdoptedDecision {
  /** 来源那条的陈述（来源已失效 / 不在项目记忆里 ⇒ null，只显示理由） */
  readonly sourceStatement: string | null;
}

function ClaimRow({ claim, sharedBy, adoptedFrom, onOpenSources, org, adopt, sourceKinds, closed }: {
  claim: KgClaim; sharedBy?: string; adoptedFrom?: AdoptedFrom; onOpenSources: (claimId: string) => void; org: OrgPromotion; adopt: Adoption;
  sourceKinds?: readonly EvidenceKind[]; closed: ReadonlySet<EvidenceKind>;
}) {
  const { locale, t } = useI18n();
  const tone = claim.triState === "confirmed" ? "success" : claim.triState === "conflict" ? "danger" : "warning";
  const state = org.states.get(claim.id);
  const adoption = adopt.states.get(claim.id);
  const adoptable = isAdoptableClaimKind(claim.kind) && sharedBy === undefined;
  return (
    <li className="flex flex-col gap-1 text-12" data-testid={`project-brain-claim-${claim.id}`}>
      <div className="flex items-start gap-2">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 leading-relaxed">
          <span>{claim.statement}</span>
          {sharedBy !== undefined ? (
            <span className="text-11 text-muted-foreground" data-testid={`project-brain-shared-by-${claim.id}`}>{sharedPersonalLabel(sharedBy, locale)}</span>
          ) : null}
          {adoptedFrom !== undefined ? (
            <span className="text-11 text-muted-foreground" data-testid={`project-brain-adopted-from-${claim.id}`}>
              {adoptedFrom.sourceStatement !== null ? t("projectBrain.adoptedFrom", { statement: adoptedFrom.sourceStatement }) : t("projectBrain.adoptedMissing")}
              {t("projectBrain.adoptionRationale", { rationale: adoptedFrom.rationale })}
              {t("projectBrain.adoptionBy", { actor: adoptedFrom.adoptedBy })}
            </span>
          ) : null}
          {sourceKinds !== undefined && sourceKinds.length > 0 ? (
            <span className="flex flex-wrap items-center gap-1" data-testid={`project-brain-source-kinds-${claim.id}`}>
              {sourceKinds.map((k) => {
                const off = closed.has(k);
                return (
                  <Badge
                    key={k}
                    tone="outline"
                    className={off ? "opacity-50" : undefined}
                    title={off ? t("projectBrain.sourceDisabled") : undefined}
                    data-testid={`project-brain-source-kind-${claim.id}-${k}`}
                    data-closed={off ? "true" : undefined}
                  >
                    {projectEvidenceKindLabel(k, locale)}
                  </Badge>
                );
              })}
            </span>
          ) : null}
        </span>
        <Badge tone={tone === "success" ? "primary" : "outline"}>{Object.hasOwn(KG_TRI_STATE_LABEL_ZH, claim.triState) ? graphTriStateLabel(claim.triState, locale) : claim.triState}</Badge>
        <span className="shrink-0 font-mono text-11 text-muted-foreground" title={t("projectBrain.evidenceCounts")}>
          +{claim.supportingCount} / −{claim.contradictingCount}
        </span>
        {/* S10：分享来的那条，证据在分享人的个人对话里，别人打不开（R9 口径 404）——不给一个点了必失败的按钮 */}
        {sharedBy === undefined ? (
          <Button size="xs" variant="ghost" onClick={() => onOpenSources(claim.id)} data-testid={`project-brain-sources-${claim.id}`}>{t("projectBrain.sources")}</Button>
        ) : null}
        {adoptable && (adoption === undefined || adoption.kind === "failed") ? (
          <Button size="xs" variant="outline" onClick={() => adopt.open(claim.id)} data-testid={`project-brain-adopt-${claim.id}`}>
            {t("projectBrain.adopt")}
          </Button>
        ) : null}
        {org.enabled && state?.kind !== "done" ? (
          <Button
            size="xs"
            variant="outline"
            disabled={state?.kind === "busy"}
            onClick={() => org.promote(claim.id)}
            data-testid={`project-brain-promote-org-${claim.id}`}
          >
            {t("projectBrain.rememberOrg")}
          </Button>
        ) : null}
      </div>
      {adoption !== undefined && (adoption.kind === "editing" || adoption.kind === "busy") ? (
        <div className="flex flex-col gap-1.5" data-testid={`project-brain-adopt-form-${claim.id}`}>
          <Textarea
            value={adoption.rationale}
            maxLength={KG_ADOPT_RATIONALE_MAX}
            disabled={adoption.kind === "busy"}
            placeholder={t("projectBrain.rationalePlaceholder", { max: KG_ADOPT_RATIONALE_MAX })}
            onChange={(e) => adopt.edit(claim.id, e.target.value)}
            data-testid={`project-brain-adopt-rationale-${claim.id}`}
          />
          <div className="flex items-center gap-2">
            <span className="font-mono text-11 text-muted-foreground">{adoption.rationale.length} / {KG_ADOPT_RATIONALE_MAX}</span>
            <Button
              size="xs"
              variant="primary"
              disabled={adoption.kind === "busy" || adoption.rationale.trim().length === 0}
              onClick={() => adopt.confirm(claim.id)}
              data-testid={`project-brain-adopt-confirm-${claim.id}`}
            >
              {t("projectBrain.confirmAdopt")}
            </Button>
            <Button size="xs" variant="ghost" disabled={adoption.kind === "busy"} onClick={() => adopt.cancel(claim.id)} data-testid={`project-brain-adopt-cancel-${claim.id}`}>{t("projectBrain.cancel")}</Button>
          </div>
        </div>
      ) : null}
      {adoption !== undefined && (adoption.kind === "done" || adoption.kind === "failed") ? (
        <div className="text-11 text-muted-foreground" data-testid={`project-brain-adopt-result-${claim.id}`}>
          {adoption.kind === "done" ? t("projectBrain.adopted") : describeAdoptFailure(adoption.text.cause, locale)}
        </div>
      ) : null}
      {state !== undefined && state.kind !== "busy" ? (
        <div className="flex items-center gap-2 text-11 text-muted-foreground" data-testid={`project-brain-promote-org-result-${claim.id}`}>
          <span>{state.kind === "failed" ? ("key" in state.text ? t(state.text.key) : describePromoteFailure(state.text.cause, locale)) : describePromoteResult(state.result, locale)}</span>
          {state.kind === "done" && state.result.outcome === "needs_choice" ? (
            <>
              <Button size="xs" variant="outline" onClick={() => org.promote(claim.id, "merge")} data-testid={`project-brain-promote-org-merge-${claim.id}`}>{t("projectBrain.merge")}</Button>
              <Button size="xs" variant="ghost" onClick={() => org.promote(claim.id, "coexist")} data-testid={`project-brain-promote-org-coexist-${claim.id}`}>{t("projectBrain.coexist")}</Button>
            </>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function describePromoteResult(r: PromotionResults["results"][number], locale: Locale = "zh-CN"): string {
  switch (r.outcome) {
    case "promoted": return translate(locale, "projectBrain.reason.promoted");
    case "merged_into_existing": return translate(locale, "projectBrain.reason.merged");
    case "coexisting": return translate(locale, "projectBrain.reason.coexisting");
    case "needs_choice": return translate(locale, "projectBrain.reason.choose");
    case "rejected":
      if (r.code === "KG_EVIDENCE_REVOKED") return translate(locale, "projectBrain.reason.revokedSource");
      if (r.code === "KG_CONTESTED_NEEDS_RESOLUTION") return translate(locale, "projectBrain.reason.promoteConflict");
      return translate(locale, "projectBrain.reason.promoteNotFound");
  }
}

function describePromoteFailure(e: unknown, locale: Locale = "zh-CN"): string {
  const code = knowledgeGraphErrorCode(e);
  if (code === "KG_NOT_OWNER") return translate(locale, "projectBrain.reason.promoteRole");
  if (code === "KG_NOT_VISIBLE") return translate(locale, "projectBrain.reason.promoteNoAccess");
  if (e instanceof ApiError) return httpFailureText(e.status, locale);
  return e instanceof Error ? e.message : translate(locale, "projectBrain.reason.promoteFailed");
}

function describeFailure(e: unknown, locale: Locale = "zh-CN"): string {
  const code = knowledgeGraphErrorCode(e);
  if (code === "KG_NOT_VISIBLE") return translate(locale, "projectBrain.reason.memoryNoRole");
  if (e instanceof ApiError) return httpFailureText(e.status, locale);
  return e instanceof Error ? e.message : translate(locale, "projectBrain.reason.loadFailed");
}

function sharedPersonalLabel(name: string, locale: Locale): string {
  const trimmed = name.trim();
  return trimmed === "" ? translate(locale, "chatKnowledge.recall.sharedAnonymous") : translate(locale, "chatKnowledge.recall.shared", { name: trimmed });
}
