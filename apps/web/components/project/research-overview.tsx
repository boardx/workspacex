"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionTitle, ObserverNotice, StatChip } from "./parts";
import { observerHidden, type ProjectRole } from "@/lib/project-workbench";
import { ProjectBrainPanel } from "./project-brain-panel";
import { ApiError, getStoredSessionToken } from "@/lib/api-client";
import { useOptionalSession } from "@/components/session/session-provider";
import { KG_TRI_STATE_LABEL_ZH, type KgClaim, type KgClaimKind, type KgTriState } from "@repo/contracts/chat-knowledge-graph";
import { KG_CLAIM_KIND_LABEL_ZH } from "@/lib/knowledge-graph-view";
import { fetchClaimSources, fetchProjectKnowledge, knowledgeGraphErrorCode, type ProjectKnowledge } from "@/lib/knowledge-graph-api";
import { getProjectTopic, saveProjectTopic } from "@/lib/live-project-prep";
import { createDigitalInterviewDraft } from "@/lib/live-digital-interview";
import { createTask } from "@/lib/live-tasks";
import { httpFailureText } from "@/lib/http-failure-text";
import { ClaimSourceDrawer } from "@/components/chat/knowledge/claim-source-drawer";
import { useClaimSourcesDrawer } from "@/components/chat/knowledge/knowledge-panel";
import { cn } from "@/lib/utils";

/**
 * 研究总览（原型 isWsRov）—— 研究 / 访谈 / 问卷 / 深度研究在项目下的汇总投影。
 *
 * 项目中枢 B2-S3（#4427）：三块（洞察库 / 洞察来源分布 / 尚未验证的假设）全部改读**真实**项目记忆
 * （`getProjectKnowledge(projectId)`，与「项目大脑」面板同一数据源）。每一块的判定规则都写在本文件
 * 的注释里，并在界面上用一句话说清——不出现任何拍脑袋的数字。
 *
 * ⚠ 由「记到项目大脑」晋升来的项目记忆**恒为** `status: accepted` / `triState: confirmed`，所以
 *   「验证过没有」不能只看三态；这里用 `reviewedBy`（有没有真人复核过）与支持 / 反对证据数一起判。
 * ⚠ 观察者显著更少：原始洞察库与未验证假设是内部研究过程，整块消失，只剩脱敏的来源分布。
 * ⚠ 项目中枢 R8：「项目大脑」面板（`ProjectBrainPanel`）——项目记忆 L2 的真实结论，按类型分组。
 */

/* ────────────────────────────── 纯判定规则（单测直接覆盖） ────────────────────────────── */

/**
 * 「强 / 弱」洞察：
 *   强 = 真人复核过（`reviewedBy !== null`）**且**至少两条支持证据**且**没有反对证据；
 *   弱 = 其余全部。只有真人来源能把洞察标成「强」，AI 自己记下的再多也只是「弱」。
 */
export function isStrongInsight(c: KgClaim): boolean {
  return c.reviewedBy !== null && c.supportingCount >= 2 && c.contradictingCount === 0;
}

/**
 * 「尚未验证的假设」：`kind = hypothesis` 且（没人复核过 **或** 支持证据不足两条 **或** 有反对证据）。
 * 按 支持 − 反对 升序——站得最不稳的排最前。
 */
export function unverifiedHypotheses(claims: readonly KgClaim[]): KgClaim[] {
  return claims
    .filter((c) => c.kind === "hypothesis" && (c.reviewedBy === null || c.supportingCount < 2 || c.contradictingCount > 0))
    .sort((a, b) => (a.supportingCount - a.contradictingCount) - (b.supportingCount - b.contradictingCount));
}

/** 洞察库的来源筛选：真人确认 = 真人复核过；AI 记下 = 模型 / 导入写入且还没人复核；有矛盾 = 三态为 conflict。 */
export type SourceFilter = "all" | "human" | "ai" | "conflict";
export function matchesSourceFilter(c: KgClaim, f: SourceFilter): boolean {
  if (f === "all") return true;
  if (f === "human") return c.reviewedBy !== null;
  if (f === "ai") return c.createdBy !== "human" && c.reviewedBy === null;
  return c.triState === "conflict";
}

/** 来源分布：按写入者 / 类型 / 三态 / 强弱各数一遍。全部由 claims 逐条数出来，没有任何预设值。 */
export function sourceDistribution(claims: readonly KgClaim[]) {
  const byCreator = { human: 0, model: 0, import: 0 };
  const byKind: Record<KgClaimKind, number> = { fact: 0, hypothesis: 0, decision: 0, todo: 0, risk: 0 };
  const byTriState: Record<KgTriState, number> = { pending: 0, confirmed: 0, conflict: 0 };
  let strong = 0;
  for (const c of claims) {
    byCreator[c.createdBy] += 1;
    byKind[c.kind] += 1;
    byTriState[c.triState] += 1;
    if (isStrongInsight(c)) strong += 1;
  }
  return { total: claims.length, byCreator, byKind, byTriState, strong, weak: claims.length - strong };
}

const KIND_ORDER: readonly KgClaimKind[] = ["decision", "fact", "hypothesis", "risk", "todo"];
const TRI_ORDER: readonly KgTriState[] = ["confirmed", "pending", "conflict"];
const SOURCE_FILTERS: ReadonlyArray<{ key: SourceFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "human", label: "真人确认" },
  { key: "ai", label: "AI 记下" },
  { key: "conflict", label: "有矛盾" },
];
/** 访谈名的长度上限——只是给访谈起个能认出来的名字，正文以假设原句为准。 */
const INTERVIEW_NAME_MAX = 40;

export function ResearchOverview({ view, readOnly = false, projectId }: {
  view: ProjectRole; readOnly?: boolean; projectId?: string;
}) {
  const isObserver = observerHidden(view);
  const [data, setData] = React.useState<ProjectKnowledge | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!projectId || !getStoredSessionToken()) { setData(null); return; }
    setLoading(true); setError(null);
    try {
      setData(await fetchProjectKnowledge(projectId));
    } catch (e) {
      setError(describeLoadFailure(e));
    } finally {
      setLoading(false);
    }
  }, [projectId]);
  React.useEffect(() => { void load(); }, [load]);

  const claims = React.useMemo(() => data?.claims ?? [], [data]);
  const drawer = useClaimSourcesDrawer(loadSources);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-6" data-testid="project-research">
      <p className="rounded-md border border-border bg-panel px-3 py-2 text-11 text-muted-foreground">
        本屏汇总的是本项目的项目记忆——在项目对话的知识面板里「记到项目大脑」的内容。访谈 / 问卷 / 深度研究的产出尚未挂到项目上。
      </p>

      {projectId ? <ProjectBrainPanel projectId={projectId} /> : null}

      {error !== null ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-panel px-3 py-2">
          <p className="flex-1 text-11 text-destructive" data-testid="project-research-error">{error}</p>
          <Button size="xs" variant="outline" onClick={() => void load()} data-testid="project-research-retry">重试</Button>
        </div>
      ) : null}

      {isObserver ? (
        <ObserverNotice
          testId="project-research-observer-notice"
          what="原始洞察库与尚未验证的假设属于内部研究过程，不在观察者只读范围内。你能看到的是下方脱敏的洞察来源分布。"
        />
      ) : (
        <InsightsSection claims={claims} loading={loading && data === null} onOpenSources={drawer.open} />
      )}

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <SourcesSection claims={claims} />
        {!isObserver && projectId ? (
          <UnverifiedSection
            claims={claims}
            projectId={projectId}
            canEditTopic={view === "facilitator"}
            readOnly={readOnly}
          />
        ) : null}
      </div>

      <ClaimSourceDrawer
        data={drawer.data}
        open={drawer.isOpen}
        loading={drawer.loading}
        error={drawer.error}
        onRetry={drawer.retry}
        onClose={drawer.close}
      />
    </div>
  );
}

function loadSources(claimId: string) {
  return fetchClaimSources(claimId);
}

/* ────────────────────────────── ① 洞察库 ────────────────────────────── */

function InsightsSection({ claims, loading, onOpenSources }: {
  claims: readonly KgClaim[]; loading: boolean; onOpenSources: (claimId: string) => void;
}) {
  const [kind, setKind] = React.useState<KgClaimKind | "all">("all");
  const [source, setSource] = React.useState<SourceFilter>("all");
  const shown = claims.filter((c) => (kind === "all" || c.kind === kind) && matchesSourceFilter(c, source));
  const presentKinds = KIND_ORDER.filter((k) => claims.some((c) => c.kind === k));

  return (
    <section data-testid="project-research-insights">
      <SectionTitle meta={claims.length > 0 ? `${claims.length} 条 · 每条都能点回原始证据` : "每条都必须能点回原始证据"}>洞察库</SectionTitle>
      <Card>
        {loading ? (
          <p className="p-4 text-11 text-muted-foreground" data-testid="project-research-insights-loading">读取项目记忆中…</p>
        ) : claims.length === 0 ? (
          <p className="p-4 text-11 leading-relaxed text-muted-foreground" data-testid="project-research-insights-empty">
            本项目还没有洞察。在项目对话的知识面板里点「记到项目大脑」，记下的内容会出现在这里。
          </p>
        ) : (
          <div className="flex flex-col gap-3 p-3.5">
            <div className="flex flex-wrap items-center gap-1.5" data-testid="project-research-insights-filters">
              <FilterChip active={kind === "all"} onClick={() => setKind("all")} testId="project-research-insights-kind-all">全部类型</FilterChip>
              {presentKinds.map((k) => (
                <FilterChip key={k} active={kind === k} onClick={() => setKind(k)} testId={`project-research-insights-kind-${k}`}>
                  {KG_CLAIM_KIND_LABEL_ZH[k]}
                </FilterChip>
              ))}
              <span aria-hidden className="mx-1 h-3 w-px bg-border" />
              {SOURCE_FILTERS.map((f) => (
                <FilterChip key={f.key} active={source === f.key} onClick={() => setSource(f.key)} testId={`project-research-insights-source-${f.key}`}>
                  {f.label}
                </FilterChip>
              ))}
            </div>
            <p className="text-10 text-muted-foreground">
              真人确认 = 有人复核过；AI 记下 = 模型或导入写入、还没人复核；有矛盾 = 两边都有证据、还没人定。
            </p>
            {shown.length === 0 ? (
              <p className="text-11 text-muted-foreground" data-testid="project-research-insights-filtered-empty">这个筛选下没有洞察。</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border" data-testid="project-research-insights-list">
                {shown.map((c) => (
                  <li key={c.id} className="flex items-start gap-2 py-2 text-11" data-testid={`project-research-insight-${c.id}`}>
                    <span className="min-w-0 flex-1 leading-relaxed">{c.statement}</span>
                    <Badge tone="outline">{KG_CLAIM_KIND_LABEL_ZH[c.kind]}</Badge>
                    <Badge tone={c.triState === "confirmed" ? "primary" : "outline"}>{KG_TRI_STATE_LABEL_ZH[c.triState]}</Badge>
                    <span className="shrink-0 font-mono text-10 text-muted-foreground" title="支持 / 反对的证据数">
                      +{c.supportingCount} / −{c.contradictingCount}
                    </span>
                    <Button size="xs" variant="ghost" onClick={() => onOpenSources(c.id)} data-testid={`project-research-sources-${c.id}`}>来源</Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>
    </section>
  );
}

function FilterChip({ active, onClick, testId, children }: {
  active: boolean; onClick: () => void; testId: string; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "rounded-sm border px-1.5 py-0.5 text-10 font-medium transition-colors hover:bg-muted",
        active ? "border-primary bg-primary text-primary-foreground hover:bg-primary-hover" : "border-border text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

/* ────────────────────────────── ② 洞察来源分布 ────────────────────────────── */

function SourcesSection({ claims }: { claims: readonly KgClaim[] }) {
  const d = sourceDistribution(claims);
  return (
    <section data-testid="project-research-sources">
      <SectionTitle meta={d.total > 0 ? `共 ${d.total} 条` : undefined}>洞察来源分布</SectionTitle>
      <Card>
        {d.total === 0 ? (
          <p className="p-4 text-11 leading-relaxed text-muted-foreground" data-testid="project-research-sources-empty">
            暂无数据。只有真人来源能把洞察标成「强」，虚拟来源将单独计数。
          </p>
        ) : (
          <div className="flex flex-col gap-3 p-3.5 text-11">
            <DistRow label="按谁记下">
              <StatChip tone="success" testId="project-research-sources-creator-human">真人 {d.byCreator.human}</StatChip>
              <StatChip tone="ai" testId="project-research-sources-creator-model">模型 {d.byCreator.model}</StatChip>
              <StatChip testId="project-research-sources-creator-import">导入 {d.byCreator.import}</StatChip>
            </DistRow>
            <DistRow label="按类型">
              {KIND_ORDER.map((k) => (
                <StatChip key={k} testId={`project-research-sources-kind-${k}`}>{KG_CLAIM_KIND_LABEL_ZH[k]} {d.byKind[k]}</StatChip>
              ))}
            </DistRow>
            <DistRow label="按状态">
              {TRI_ORDER.map((t) => (
                <StatChip key={t} tone={t === "conflict" ? "danger" : t === "pending" ? "warning" : "neutral"} testId={`project-research-sources-tri-${t}`}>
                  {KG_TRI_STATE_LABEL_ZH[t]} {d.byTriState[t]}
                </StatChip>
              ))}
            </DistRow>
            <DistRow label="强 / 弱">
              <StatChip tone="success" testId="project-research-sources-strong">强 {d.strong}</StatChip>
              <StatChip tone="warning" testId="project-research-sources-weak">弱 {d.weak}</StatChip>
            </DistRow>
            <p className="text-10 leading-relaxed text-muted-foreground">
              强 = 真人复核过、至少 2 条支持证据、没有反对证据；其余都算弱。AI 自己记下的再多也只是弱。
            </p>
          </div>
        )}
      </Card>
    </section>
  );
}

function DistRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-14 shrink-0 text-10 text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/* ────────────────────────────── ③ 尚未验证的假设 ────────────────────────────── */

type ActionState = { kind: "idle" } | { kind: "busy" } | { kind: "ok"; text: string } | { kind: "error"; text: string };

function UnverifiedSection({ claims, projectId, canEditTopic, readOnly }: {
  claims: readonly KgClaim[]; projectId: string; canEditTopic: boolean; readOnly: boolean;
}) {
  const list = unverifiedHypotheses(claims);
  const router = useRouter();
  const userId = useOptionalSession()?.session?.userId ?? null;
  const [states, setStates] = React.useState<Record<string, ActionState>>({});
  const setState = (id: string, s: ActionState) => setStates((prev) => ({ ...prev, [id]: s }));

  /** 加入定题：读当前定题，把假设原句追加成背景的新一行，标题不动，带 revision 防覆盖别人的改动。 */
  const addToTopic = async (c: KgClaim) => {
    setState(c.id, { kind: "busy" });
    try {
      const topic = await getProjectTopic(projectId);
      const background = topic.background.trim() === "" ? c.statement : `${topic.background}\n${c.statement}`;
      await saveProjectTopic({ projectId, title: topic.title, background, expectedTopicRevision: topic.revision });
      setState(c.id, { kind: "ok", text: "已加入定题背景" });
    } catch (e) {
      setState(c.id, { kind: "error", text: describeTopicFailure(e) });
    }
  };

  /** 安排真人验证：以假设为名建一场访谈草稿（挂在本项目下），建好直接跳到访谈设置页。 */
  const scheduleInterview = async (c: KgClaim) => {
    setState(c.id, { kind: "busy" });
    try {
      const created = await createDigitalInterviewDraft({
        name: c.statement.length > INTERVIEW_NAME_MAX ? c.statement.slice(0, INTERVIEW_NAME_MAX) : c.statement,
        tags: [],
        scope: { kind: "project", projectId, researchProjectId: null },
        requestId: crypto.randomUUID(),
      });
      setState(c.id, { kind: "ok", text: "已建访谈草稿" });
      router.push(`/itv/${created.interviewId}/setup`);
    } catch (e) {
      setState(c.id, { kind: "error", text: describeInterviewFailure(e) });
    }
  };

  /**
   * 派任务重新核实：建一条待办给自己（负责人 = 当前登录用户），落在项目待办里。
   * 不传 `status`：服务端 `create-task.ts` 对人建的卡默认 `todo`、显式 `inbox` 直接拒绝（uc-11-1 R3.5）。
   */
  const assignTask = async (c: KgClaim) => {
    if (userId === null) { setState(c.id, { kind: "error", text: "请先登录再派任务" }); return; }
    setState(c.id, { kind: "busy" });
    try {
      await createTask({ projectId, title: `重新核实：${c.statement}`, ownerUserId: userId });
      setState(c.id, { kind: "ok", text: "已建待办" });
    } catch (e) {
      setState(c.id, { kind: "error", text: describeTaskFailure(e) });
    }
  };

  return (
    <section data-testid="project-research-unverified">
      <SectionTitle meta={list.length > 0 ? `${list.length} 条 · 站得最不稳的在前` : undefined}>尚未验证的假设</SectionTitle>
      <Card>
        {list.length === 0 ? (
          <p className="p-4 text-11 leading-relaxed text-muted-foreground" data-testid="project-research-unverified-empty">
            {claims.length === 0 ? "暂无数据。项目里还没有记下任何猜测。" : "项目里记下的猜测都已被真人复核、有至少 2 条支持证据且没有反对证据。"}
          </p>
        ) : (
          <div className="flex flex-col gap-3 p-3.5">
            <p className="text-10 leading-relaxed text-muted-foreground">
              列出的是「猜测」里没人复核过、支持证据不足 2 条、或有反对证据的；按 支持 − 反对 排，最不稳的在前。
            </p>
            <ul className="flex flex-col gap-2" data-testid="project-research-unverified-list">
              {list.map((c) => {
                const s = states[c.id] ?? { kind: "idle" };
                const busy = s.kind === "busy";
                const disabled = readOnly || busy;
                return (
                  <li key={c.id} className="flex flex-col gap-2 rounded-md border border-border bg-panel p-3 text-11" data-testid={`project-research-unverified-${c.id}`}>
                    <div className="flex items-start gap-2">
                      <span className="min-w-0 flex-1 leading-relaxed">{c.statement}</span>
                      <Badge tone={c.triState === "conflict" ? "danger" : "outline"}>{KG_TRI_STATE_LABEL_ZH[c.triState]}</Badge>
                      <span className="shrink-0 font-mono text-10 text-muted-foreground" title="支持 / 反对的证据数">
                        +{c.supportingCount} / −{c.contradictingCount}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {canEditTopic ? (
                        <Button size="xs" variant="outline" disabled={disabled} onClick={() => void addToTopic(c)} data-testid={`project-research-topic-${c.id}`}>加入定题</Button>
                      ) : null}
                      <Button size="xs" variant="outline" disabled={disabled} onClick={() => void scheduleInterview(c)} data-testid={`project-research-verify-${c.id}`}>安排真人验证</Button>
                      <Button size="xs" variant="outline" disabled={disabled} onClick={() => void assignTask(c)} data-testid={`project-research-task-${c.id}`}>派任务重新核实</Button>
                      {s.kind === "busy" ? <span className="text-10 text-muted-foreground">处理中…</span> : null}
                      {s.kind === "ok" ? <span className="text-10 text-success" data-testid={`project-research-action-ok-${c.id}`}>{s.text}</span> : null}
                      {s.kind === "error" ? <span role="alert" className="text-10 text-destructive" data-testid={`project-research-action-error-${c.id}`}>{s.text}</span> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Card>
    </section>
  );
}

/* ────────────────────────────── 失败 → 人话（不上屏内部错误码） ────────────────────────────── */

function describeLoadFailure(e: unknown): string {
  const code = knowledgeGraphErrorCode(e);
  if (code === "KG_NOT_VISIBLE") return "你不在这个项目里，看不到它的洞察。";
  if (e instanceof ApiError) return httpFailureText(e.status);
  return e instanceof Error ? e.message : "读取失败，请稍后重试。";
}

function describeTopicFailure(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.reasonCode === "VERSION_CHANGED") return "定题刚被别人改过，请重试一次";
    if (e.reasonCode === "ROLE_INSUFFICIENT" || e.reasonCode === "NO_PROJECT_ROLE") return "你没有编辑定题的权限";
    return httpFailureText(e.status);
  }
  return e instanceof Error ? e.message : "加入定题失败，请稍后重试";
}

function describeInterviewFailure(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.reasonCode === "DIGITAL_INTERVIEW_INPUT_INVALID") return "这条假设不能直接作为访谈名，请先改短一些";
    if (e.reasonCode === "IDEMPOTENCY_KEY_REUSED") return "这场访谈已经建过了，去访谈列表里找";
    return httpFailureText(e.status);
  }
  return e instanceof Error ? e.message : "建访谈失败，请稍后重试";
}

function describeTaskFailure(e: unknown): string {
  if (e instanceof ApiError) return httpFailureText(e.status);
  return e instanceof Error ? e.message : "建待办失败，请稍后重试";
}
