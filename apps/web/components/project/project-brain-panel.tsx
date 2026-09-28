"use client";
import * as React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionTitle } from "./parts";
import { getStoredSessionToken } from "@/lib/api-client";
import { Textarea } from "@/components/ui/textarea";
import {
  KG_ADOPT_RATIONALE_MAX, KG_TRI_STATE_LABEL_ZH, isAdoptableClaimKind, type KgAdoptedDecision, type KgClaimKind, type KgClaim,
} from "@repo/contracts/chat-knowledge-graph";
import { KG_CLAIM_KIND_LABEL_ZH } from "@/lib/knowledge-graph-view";
import { sharedFromPersonalLabelZh as sharedFromPersonalLabel } from "@repo/contracts/chat-knowledge-graph";
import {
  adoptProjectDecision, fetchClaimSources, fetchProjectKnowledge, knowledgeGraphErrorCode, promoteToOrg,
  type ProjectKnowledge, type PromotionChoice, type PromotionResults,
} from "@/lib/knowledge-graph-api";
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
 * B3-T4（#4498）：事实 / 猜测每条多一个「采纳为项目决策」按钮——点开填理由（≤ 500 字）再确认，`adoptProjectDecision`
 * 新建一条「决定」并回链到来源；成功后重读项目记忆，决定区显示「采纳自 …」与理由（`adoptedDecisions`，旧响应缺省 ⇒
 * 不显示）。观察者 / 非成员由服务端拒（KG_NOT_OWNER / KG_NOT_VISIBLE），如实显示。
 */
// S10（#4367）：成员可以把个人记忆里的目标 / 偏好分享进来，这两类也要列出来（否则分享了却看不见）。
const KIND_ORDER: readonly KgClaimKind[] = ["decision", "fact", "hypothesis", "risk", "todo", "goal", "preference"];

export function ProjectBrainPanel({ projectId }: { projectId: string }) {
  const [data, setData] = React.useState<ProjectKnowledge | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!getStoredSessionToken()) { setData(null); return; }
    setLoading(true); setError(null);
    try {
      setData(await fetchProjectKnowledge(projectId));
    } catch (e) {
      setError(describeFailure(e));
    } finally {
      setLoading(false);
    }
  }, [projectId]);
  React.useEffect(() => { void load(); }, [load]);

  const groups = KIND_ORDER
    .map((kind) => ({ kind, claims: (data?.claims ?? []).filter((c) => c.kind === kind) }))
    .filter((g) => g.claims.length > 0);
  const reasoning = reasoningView(data?.claims ?? []);
  const drawer = useClaimSourcesDrawer(loadSources);
  const org = useOrgPromotion(projectId, data?.canPromoteToOrg === true);
  const adopt = useAdoption(projectId, load);
  const sharedBy = React.useMemo(
    () => new Map((data?.sharedFromPersonal ?? []).map((x) => [x.claimId, x.sharedByName] as const)),
    [data?.sharedFromPersonal],
  );
  const adoptedFrom = React.useMemo(() => {
    const statements = new Map((data?.claims ?? []).map((c) => [c.id, c.statement] as const));
    return new Map((data?.adoptedDecisions ?? []).map((d) => [d.decisionClaimId, { ...d, sourceStatement: statements.get(d.sourceClaimId) ?? null }] as const));
  }, [data?.claims, data?.adoptedDecisions]);
  const row = (c: KgClaim) => (
    <ClaimRow key={c.id} claim={c} sharedBy={sharedBy.get(c.id)} adoptedFrom={adoptedFrom.get(c.id)} onOpenSources={drawer.open} org={org} adopt={adopt} />
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
                      {reasoning.conflicts.map(row)}
                    </ul>
                  </div>
                ) : null}
                {reasoning.hypotheses.length > 0 ? (
                  <div className="flex flex-col gap-1" data-testid="project-brain-hypotheses">
                    <span className="text-10 text-muted-foreground">猜测——按证据强弱排，站得最不稳的在前</span>
                    <ul className="flex flex-col gap-1">
                      {reasoning.hypotheses.map(row)}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
            {groups.map((g) => (
              <div key={g.kind} className="flex flex-col gap-1.5 p-3.5" data-testid={`project-brain-group-${g.kind}`}>
                <div className="flex items-center gap-2">
                  <span className="text-12 font-medium">{KG_CLAIM_KIND_LABEL_ZH[g.kind]}</span>
                  <span className="font-mono text-10 text-muted-foreground">{g.claims.length}</span>
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

type AdoptionState =
  | { readonly kind: "editing"; readonly rationale: string }
  | { readonly kind: "busy"; readonly rationale: string }
  | { readonly kind: "done"; readonly decisionClaimId: string }
  | { readonly kind: "failed"; readonly rationale: string; readonly text: string };

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
        .catch((e: unknown) => set(claimId, { kind: "failed", rationale, text: describeAdoptFailure(e) }));
      return new Map(prev).set(claimId, { kind: "busy", rationale });
    });
  }, [projectId, reload, set]);
  return { states, open, edit, cancel, confirm };
}

function describeAdoptFailure(e: unknown): string {
  const code = knowledgeGraphErrorCode(e);
  if (code === "KG_NOT_OWNER") return "观察者不能替项目定决策。";
  if (code === "KG_NOT_VISIBLE") return "你不在这个项目里，定不了。";
  if (code === "KG_CONTESTED_NEEDS_RESOLUTION") return "这条有矛盾，先解决再采纳。";
  if (code === "KG_CLAIM_NOT_FOUND") return "这条不在项目记忆里，或不是事实 / 猜测。";
  if (e instanceof ApiError) return httpFailureText(e.status);
  return e instanceof Error ? e.message : "没采纳上，请稍后重试。";
}

interface AdoptedFrom extends KgAdoptedDecision {
  /** 来源那条的陈述（来源已失效 / 不在项目记忆里 ⇒ null，只显示理由） */
  readonly sourceStatement: string | null;
}

function ClaimRow({ claim, sharedBy, adoptedFrom, onOpenSources, org, adopt }: {
  claim: KgClaim; sharedBy?: string; adoptedFrom?: AdoptedFrom; onOpenSources: (claimId: string) => void; org: OrgPromotion; adopt: Adoption;
}) {
  const tone = claim.triState === "confirmed" ? "success" : claim.triState === "conflict" ? "danger" : "warning";
  const state = org.states.get(claim.id);
  const adoption = adopt.states.get(claim.id);
  const adoptable = isAdoptableClaimKind(claim.kind) && sharedBy === undefined;
  return (
    <li className="flex flex-col gap-1 text-11" data-testid={`project-brain-claim-${claim.id}`}>
      <div className="flex items-start gap-2">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 leading-relaxed">
          <span>{claim.statement}</span>
          {sharedBy !== undefined ? (
            <span className="text-10 text-muted-foreground" data-testid={`project-brain-shared-by-${claim.id}`}>{sharedFromPersonalLabel(sharedBy)}</span>
          ) : null}
          {adoptedFrom !== undefined ? (
            <span className="text-10 text-muted-foreground" data-testid={`project-brain-adopted-from-${claim.id}`}>
              {adoptedFrom.sourceStatement !== null ? `采纳自「${adoptedFrom.sourceStatement}」` : "采纳自一条已不在项目记忆里的记录"}
              {` · 理由：${adoptedFrom.rationale}`}
              {` · 由 ${adoptedFrom.adoptedBy} 采纳`}
            </span>
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
        {adoptable && (adoption === undefined || adoption.kind === "failed") ? (
          <Button size="xs" variant="outline" onClick={() => adopt.open(claim.id)} data-testid={`project-brain-adopt-${claim.id}`}>
            采纳为项目决策
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
            记到组织记忆
          </Button>
        ) : null}
      </div>
      {adoption !== undefined && (adoption.kind === "editing" || adoption.kind === "busy") ? (
        <div className="flex flex-col gap-1.5" data-testid={`project-brain-adopt-form-${claim.id}`}>
          <Textarea
            value={adoption.rationale}
            maxLength={KG_ADOPT_RATIONALE_MAX}
            disabled={adoption.kind === "busy"}
            placeholder="为什么把它定为项目决策？（必填，最多 500 字）"
            onChange={(e) => adopt.edit(claim.id, e.target.value)}
            data-testid={`project-brain-adopt-rationale-${claim.id}`}
          />
          <div className="flex items-center gap-2">
            <span className="font-mono text-10 text-muted-foreground">{adoption.rationale.length} / {KG_ADOPT_RATIONALE_MAX}</span>
            <Button
              size="xs"
              variant="primary"
              disabled={adoption.kind === "busy" || adoption.rationale.trim().length === 0}
              onClick={() => adopt.confirm(claim.id)}
              data-testid={`project-brain-adopt-confirm-${claim.id}`}
            >
              确认采纳
            </Button>
            <Button size="xs" variant="ghost" disabled={adoption.kind === "busy"} onClick={() => adopt.cancel(claim.id)} data-testid={`project-brain-adopt-cancel-${claim.id}`}>取消</Button>
          </div>
        </div>
      ) : null}
      {adoption !== undefined && (adoption.kind === "done" || adoption.kind === "failed") ? (
        <div className="text-10 text-muted-foreground" data-testid={`project-brain-adopt-result-${claim.id}`}>
          {adoption.kind === "done" ? "已采纳为项目决策，见上方「决定」。" : adoption.text}
        </div>
      ) : null}
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
