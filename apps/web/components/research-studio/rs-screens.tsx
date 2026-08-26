"use client";
import * as React from "react";
import {
  Search, Pin, Archive, Copy, RefreshCw, AlertTriangle, ArrowLeft, Bot,
  ChevronRight, Filter, ShieldAlert, CheckCircle2, XCircle, EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StateShell } from "@/components/state/state-shell";
import { cn } from "@/lib/utils";
import type { UiState } from "@/lib/ui-state";
import {
  RS_KINDS, RS_DEPTHS, RS_SOURCES, RS_DELIVERABLES, RS_GROUPS, RS_NODES,
  RS_INTERNAL_SOURCES, RS_CONFIG_DEFAULT, RS_CONFIG_ALT, buildPreview,
  RS_LIST_TAGS, RS_LIST_ITEMS, RS_SIDEBAR,
  RS_PLAN, RS_PLAN_EVIDENCE, RS_PLAN_QUESTIONS,
  RS_DIALOG, RS_EXTERNAL_SOURCES, RS_RESULT,
  RS_CONCLUSION_ACTIONS, RS_LIVE_CONCLUSION_ACTIONS, RS_PROMOTE_BLOCKS, RS_PROMOTE_PARTIAL,
  RS_LIVE_TASKS, RS_CONFLICTS, liveCounts, actionAllowed, RS_EMPTY_HINT,
  type RsView, type RsScreen, type RsConfig,
} from "@/lib/mock/research-studio";
import { NewResearchFlow } from "./new-research";

/* ── 共享小件 ─────────────────────────────────────────────────────────── */

function Head({
  title, uc, sub, actions, testid,
}: { title: string; uc: string; sub?: string; actions?: React.ReactNode; testid: string }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2" data-testid={testid}>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-20 font-semibold tracking-tight text-background-foreground">{title}</h1>
          <Badge tone="outline">{uc}</Badge>
        </div>
        {sub && <p className="max-w-2xl text-12 leading-relaxed text-muted-foreground">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * ⚠ `hrefFor` 只给「已归档」这一个 tag 接了真过滤（N-7 / V4：归档后仍能被
 * 「已归档」标签筛出）。其余四个 tag（客户/内部/高优先级/全部）的过滤口径
 * **未裁**（Q-9：首项 `全部` vs 项目侧 `全部标签` 的差异），本文件不代裁，
 * 仍是纯展示态——不给它们编一套过滤逻辑。
 */
function TagRow({
  tags, active, hrefFor,
}: { tags: readonly string[]; active?: string; hrefFor?: (tag: string) => string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="rs-tag-filter">
      {tags.map((t) => {
        const isActive = (active ?? tags[0]) === t;
        const cls = cn(
          "rounded-full border px-2.5 py-0.5 text-11 transition-colors",
          isActive ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:bg-muted",
        );
        return hrefFor ? (
          <a key={t} data-testid={`rs-tag-${t}`} href={hrefFor(t)} className={cls}>{t}</a>
        ) : (
          <button key={t} data-testid={`rs-tag-${t}`} className={cls}>{t}</button>
        );
      })}
    </div>
  );
}

function Stat({ label, value, note, testid }: { label: string; value: React.ReactNode; note: string; testid: string }) {
  return (
    <div className="flex flex-1 flex-col gap-1 rounded-lg border border-border bg-card p-3" data-testid={testid}>
      <span className="text-11 text-muted-foreground">{label}</span>
      <span className="text-20 font-semibold tabular-nums text-background-foreground">{value}</span>
      <span className="text-10 text-muted-foreground">{note}</span>
    </div>
  );
}

function Confidence({ value, low }: { value: number | null; low: boolean }) {
  if (value === null) {
    // N-8：缺失渲染 —，不是 0
    return <span className="font-mono text-12 text-muted-foreground" data-testid="rs-conf-missing">—</span>;
  }
  return (
    <span
      className={cn("inline-flex items-center gap-1 font-mono text-12 tabular-nums", low ? "text-warning" : "text-background-foreground")}
      data-testid={low ? "rs-conf-low" : "rs-conf"}
    >
      {value.toFixed(1)}
      {low && <Badge tone="warning" className="ml-0.5">低置信</Badge>}
    </span>
  );
}

/** 视角受限时把动作按钮画成「点了会被拒」而不是灰按钮（N-10 / 阻断不是 disabled）。 */
function ActionButton({
  view, action, variant = "outline", testid, icon,
}: { view: RsView; action: string; variant?: "primary" | "outline" | "secondary"; testid: string; icon?: React.ReactNode }) {
  const allowed = actionAllowed(view, action);
  return (
    <Button
      size="sm"
      variant={allowed ? variant : "outline"}
      data-testid={testid}
      data-allowed={allowed}
      className={cn(!allowed && "border-dashed text-muted-foreground")}
      title={allowed ? undefined : "协作者范围外：点击将被服务端拒绝（预览投影，真实权限在服务端）"}
    >
      {icon}
      {action}
      {!allowed && <ShieldAlert aria-hidden className="ml-1 h-3.5 w-3.5 text-warning" />}
    </Button>
  );
}

/* ── 每屏的七态 StateShell 配置 ───────────────────────────────────────── */

function shellProps(screen: RsScreen): Partial<React.ComponentProps<typeof StateShell>> {
  const common = { emptyHint: RS_EMPTY_HINT[screen] };
  const dep = {
    list: { what: "研究列表服务暂时不可用（AGENT_RUN_FAILED）——已缓存的列表仍可看" },
    plan: { what: "计数服务暂时不可用——已就绪的证据行先看，不必等全部跑完" },
    new: { what: "Scout 模型暂不可达（MODEL_UNAVAILABLE）——研究仍可创建并停在「待运行」" },
    detail: { what: "检索有 3 路失败（AGENT_RUN_FAILED）——已完成的 9 路结果先看，失败路可重试" },
    live: { what: "一个现场任务的 agent 跑挂了——该行标失败，其余行不受影响" },
  }[screen];
  const errors: Record<string, string> = {
    list: { form: "标签筛选值非法" },
    plan: { evidenceTarget: "证据目标格式错误（应为正整数或留空）" },
    new: { question: "「要回答的问题」必填，且需一句话可判定（系统只做非空校验，不做语义判定）" },
    detail: { sourcePref: "要补的来源类别不在本研究的来源偏好内——请先改配置，不能静默越界（SOURCE_PREF_VIOLATION）" },
    live: { conflict: "冲突判定动作必须选一项，系统不替你预选（N-6）" },
  }[screen];
  const success = {
    list: "已归档该研究主题",
    plan: "计数已刷新",
    new: "研究已创建 · 20 分钟 · 6 路检索 正在跑",
    detail: "候选洞察已入库 · 待送综合 Studio 验证",
    live: "已判定：以样本为准 · 林可 · 14:52",
  }[screen];
  return {
    ...common,
    depFailure: { what: dep.what, retry: () => {} },
    errors,
    denial: {
      layer: "project",
      reason: "观察者只读：不能发起、不能追问、不能触发 agent，也没有任何出口动作（N-10）。原始逐字稿与私聊不在授权范围内。",
    },
    successMessage: success,
  };
}

/* ── 屏 1 · 研究 Studio 列表（UC-24.3 A/C）────────────────────────────── */

export function RsListScreen({
  state, view, sub, href,
}: {
  state: UiState;
  view: RsView;
  /** ⚠ N-7 / V4：`sub="archived"` 时改看已归档集合——归档不是删除，它必须能被筛出来。 */
  sub?: string;
  href?: (o: { sub?: string }) => string;
}) {
  // ⚠ 归档只是「换一个筛选条件看」，不是「从这个世界消失」——这是 N-7 的界面落点。
  const showArchived = sub === "archived";
  const items = RS_LIST_ITEMS.filter((i) => (showArchived ? i.archived : !i.archived));
  const tagHref = href
    ? (t: string) => href({ sub: t === "已归档" ? "archived" : undefined })
    : undefined;
  return (
    <StateShell state={state} {...shellProps("list")}>
      <div className="flex flex-col gap-4" data-testid="rs-list-screen">
        <Head
          testid="rs-list-head"
          title={showArchived ? `研究项目 · 已归档 ${items.length}` : `研究项目 · ${items.length}`}
          uc="UC-24.3"
          sub="打开任意一个进入全屏管理：研究问题、证据表、候选洞察。"
          /*
           * F144：入口换成真入口（`NewResearchFlow`）。**像素不变**——同一个 Button、
           * 同一个放大镜、同一句 `＋ 新建研究`；变的只有 `data-testid`
           * （`rs-list-new` → `rs-entry-studio`，由 `researchEntryTestId` 单点构造）。
           * ⚠ 角色写死 `facilitator`：本原型的视角切换器是 owner/collaborator 两档
           *   （U-1 已裁=B），观察者是**项目语境的只读投影**、落在七态的 `denied`
           *   （见 `ui-preview/research/README.md` 四①）。观察者入口不存在于 DOM
           *   这条断在组件级（`research-entry-observer-absent`），不在本屏。
           */
          actions={<NewResearchFlow role="facilitator" at="studio" icon={<Search className="h-3.5 w-3.5" aria-hidden />} />}
        />
        <TagRow tags={RS_LIST_TAGS} active={showArchived ? "已归档" : undefined} hrefFor={tagHref} />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {items.map((it) => (
            <div key={it.id} className="flex flex-col gap-2.5 rounded-lg border border-border bg-card p-3.5" data-testid={`rs-card-${it.id}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1.5">
                    {it.pinned && <Badge tone="warning" data-testid={`rs-card-${it.id}-pinned`}><Pin className="h-3 w-3" aria-hidden />关键 · 置顶</Badge>}
                    <Badge tone={it.status === "已完成" ? "primary" : it.status === "待复核" ? "warning" : "neutral"} data-testid={`rs-card-${it.id}-status`}>{it.status}</Badge>
                  </div>
                  <h3 className="text-14 font-medium text-background-foreground">{it.title}</h3>
                </div>
              </div>
              <div className="flex flex-col gap-1 text-11 text-muted-foreground">
                <span data-testid={`rs-card-${it.id}-progress`}>
                  证据 {it.evidence} / {it.evidenceTarget === null ? <span className="text-muted-foreground">—</span> : `目标 ${it.evidenceTarget}`}
                  {it.parallelRoutes > 0 && ` · Scout 并行 ${it.parallelRoutes} 路`}
                </span>
                <span data-testid={`rs-card-${it.id}-counts`}>{it.questions} 个研究问题 · {it.insights} 条候选洞察</span>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {it.tags.map((t) => <Badge key={t} tone="outline">{t}</Badge>)}
                <span className="text-11 text-muted-foreground">· {it.createdBy}发起</span>
              </div>
              <div className="mt-1 flex items-center gap-1.5 border-t border-border-subtle pt-2">
                <ActionButton view={view} action="复制" variant="outline" testid={`rs-card-${it.id}-copy`} icon={<Copy className="h-3.5 w-3.5" aria-hidden />} />
                {/* N-7：文案是「归档」不是「删除」；本域无硬删除 */}
                <ActionButton view={view} action="归档" variant="outline" testid={`rs-card-${it.id}-archive`} icon={<Archive className="h-3.5 w-3.5" aria-hidden />} />
              </div>
            </div>
          ))}
        </div>
        {/* Studio 左栏研究三段（三状态各一条）—— 放在列表尾部作为对照 */}
        <div className="rounded-lg border border-border-subtle bg-panel p-3" data-testid="rs-sidebar-3">
          <p className="mb-2 text-11 font-medium text-muted-foreground">Studio 左栏 · 研究三段（三种状态）</p>
          <div className="flex flex-col divide-y divide-border-subtle">
            {RS_SIDEBAR.map((s, i) => (
              <div key={i} className="flex flex-col gap-0.5 py-1.5" data-testid={`rs-sidebar-${i}`}>
                <span className="text-12 text-background-foreground">{s.title}</span>
                <span className="text-10 text-muted-foreground">{s.state}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </StateShell>
  );
}

/* ── 屏 2 · 研究计划详情（UC-24.3 D）三计数 + 证据表 ───────────────────── */

export function RsPlanScreen({ state, view, sub }: { state: UiState; view: RsView; sub?: string }) {
  const targetMissing = sub === "target-missing";
  const p = RS_PLAN;
  const groups = RS_PLAN_QUESTIONS.map((q) => ({ q, rows: RS_PLAN_EVIDENCE.filter((e) => e.question === q) }));
  return (
    <StateShell state={state} {...shellProps("plan")}>
      <div className="flex flex-col gap-4" data-testid="rs-plan-screen">
        <button className="flex w-fit items-center gap-1 text-12 text-muted-foreground transition-colors hover:text-foreground" data-testid="rs-plan-back">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />‹ 全部研究
        </button>
        <Head testid="rs-plan-head" title={`${p.title} · 研究计划`} uc="UC-24.3" sub={`${p.status} · Scout 并行 ${p.parallelRoutes} 路`} />
        <div className="flex flex-wrap gap-3">
          <Stat testid="rs-plan-questions" label="研究问题" value={p.questionCount ?? "—"} note={p.questionNote} />
          <Stat
            testid="rs-plan-evidence"
            label="证据"
            value={<span>{p.evidenceCount ?? "—"} / {targetMissing ? <span className="text-muted-foreground">—</span> : (p.evidenceTarget ?? "—")}</span>}
            note={p.evidenceNote}
          />
          <Stat testid="rs-plan-insights" label="候选洞察" value={p.candidateInsightCount ?? "—"} note={p.insightNote} />
        </div>
        <div className="overflow-hidden rounded-lg border border-border" data-testid="rs-evidence-table">
          <div className="grid grid-cols-[2fr_1.2fr_0.8fr_0.9fr] gap-2 border-b border-border bg-panel px-3 py-2 text-11 font-medium text-muted-foreground">
            <span>证据</span><span>来源</span><span>置信度</span><span>去向</span>
          </div>
          {groups.map((g) => (
            <div key={g.q} data-testid={`rs-evgroup-${g.q}`}>
              <div className="bg-muted/40 px-3 py-1 text-10 font-medium text-muted-foreground">{g.q}</div>
              {g.rows.map((e) => (
                <div key={e.id} className="grid grid-cols-[2fr_1.2fr_0.8fr_0.9fr] gap-2 border-b border-border-subtle px-3 py-2 text-12" data-testid={`rs-ev-${e.id}`}>
                  <span className="text-background-foreground">{e.claim}</span>
                  <span className="text-muted-foreground">{e.sourceShort}</span>
                  <Confidence value={e.confidence} low={e.confidence !== null && e.confidence <= 0.3} />
                  {/* Q-12 未裁：去向文案原样摆，反对证据高亮 */}
                  <Badge tone={e.disposition === "反对证据" ? "danger" : e.disposition === "参考" ? "outline" : "neutral"} data-testid={`rs-ev-${e.id}-disp`}>{e.disposition}</Badge>
                </div>
              ))}
            </div>
          ))}
        </div>
        <p className="text-10 text-muted-foreground">
          ⚠ 「去向」值域未定（Q-12）· 「反对证据」与决策链模板同名概念收敛未定 · 简称/全称映射未定（Q-7）——本屏摆原型给的值，不发明枚举。
        </p>
        {view === "collaborator" && (
          <p className="text-11 text-warning" data-testid="rs-plan-collab-note">协作者视角：可读全表；归档/改标签按范围受限。</p>
        )}
      </div>
    </StateShell>
  );
}

/* ── 屏 3 · 新建深度研究弹层（UC-24.1）───────────────────────────────── */

function Field({ n, label, hint, children }: { n: number; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5" data-testid={`rs-field-${n}`}>
      <label className="text-12 font-medium text-foreground">{n}. {label}{hint && <span className="ml-1 font-normal text-muted-foreground">· {hint}</span>}</label>
      {children}
    </div>
  );
}

export function RsNewScreen({ state, view, sub }: { state: UiState; view: RsView; sub?: string }) {
  const alt = sub === "alt";
  const groupPrefill = sub === "group-prefill";
  const c: RsConfig = alt
    ? RS_CONFIG_ALT
    : groupPrefill
      ? { ...RS_CONFIG_DEFAULT, groupRef: "g2" }
      : RS_CONFIG_DEFAULT;
  const preview = buildPreview(c);
  return (
    <StateShell state={state} {...shellProps("new")}>
      <div className="relative flex flex-col gap-4" data-testid="rs-new-screen">
        {/* 弹层（在列表背景上）*/}
        <div className="mx-auto w-full max-w-2xl rounded-xl border border-border bg-card shadow-lg" data-testid="rs-new-modal">
          <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-16 font-semibold text-background-foreground">新建深度研究</h2>
              <p className="max-w-lg text-11 leading-relaxed text-muted-foreground">
                先说清要查什么场景下的什么问题，研究模块据此决定检索路数与来源。
              </p>
            </div>
            <button className="text-muted-foreground transition-colors hover:text-foreground" data-testid="rs-new-close" aria-label="关闭">×</button>
          </div>
          <div className="flex flex-col gap-4 px-4 py-4">
            <Field n={1} label="研究场景" hint="在什么处境下要这个答案">
              <textarea data-testid="rs-input-scene" defaultValue={c.scene} rows={2} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-12 text-background-foreground" />
            </Field>
            <Field n={2} label="要回答的问题" hint="一句话，可判定">
              <textarea data-testid="rs-input-question" defaultValue={c.question} rows={2} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-12 text-background-foreground" />
            </Field>
            <Field n={3} label="研究类型">
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4" data-testid="rs-input-kind">
                {RS_KINDS.map((k) => (
                  <button key={k.code} data-testid={`rs-kind-${k.code}`} data-selected={c.kind === k.code}
                    className={cn("rounded-md border px-2 py-1.5 text-11", c.kind === k.code ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:bg-muted")}>
                    {k.label}
                  </button>
                ))}
              </div>
            </Field>
            <Field n={4} label="深度与时间盒">
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3" data-testid="rs-input-depth">
                {RS_DEPTHS.map((d) => (
                  <button key={d.code} data-testid={`rs-depth-${d.code}`} data-selected={c.depth === d.code}
                    className={cn("flex flex-col gap-0.5 rounded-md border px-2 py-1.5 text-left", c.depth === d.code ? "border-primary bg-accent" : "border-border hover:bg-muted")}>
                    <span className="text-12 font-medium text-background-foreground">{d.label}</span>
                    <span className="text-10 text-muted-foreground">{d.note}</span>
                  </button>
                ))}
              </div>
            </Field>
            <Field n={5} label="来源偏好" hint="可多选">
              <div className="flex flex-wrap gap-1.5" data-testid="rs-input-sources">
                {RS_SOURCES.map((s) => {
                  const on = c.sources.includes(s);
                  const internal = RS_INTERNAL_SOURCES.includes(s);
                  return (
                    <button key={s} data-testid={`rs-source-${s}`} data-selected={on}
                      className={cn("rounded-full border px-2.5 py-0.5 text-11", on ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:bg-muted")}>
                      {s}{internal && <Badge tone="outline" className="ml-1">内部</Badge>}
                    </button>
                  );
                })}
              </div>
              <p className="text-10 text-muted-foreground">全不选的行为未定（Q-5）——本原型不代裁，提交时不拦、由预览句显式提示「未选来源」。</p>
            </Field>
            <Field n={6} label="交付形式" hint="可多选">
              <div className="flex flex-wrap gap-1.5" data-testid="rs-input-deliverables">
                {RS_DELIVERABLES.map((d) => (
                  <button key={d} data-testid={`rs-deliverable-${d}`} data-selected={c.deliverables.includes(d)}
                    className={cn("rounded-full border px-2.5 py-0.5 text-11", c.deliverables.includes(d) ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:bg-muted")}>
                    {d}
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field n={7} label="挂到哪一组">
                <select data-testid="rs-input-group" defaultValue={c.groupRef} className="rounded-md border border-border bg-background px-2 py-1.5 text-12">
                  {RS_GROUPS.map((g) => <option key={g.ref} value={g.ref}>{g.label}</option>)}
                </select>
                {groupPrefill && <span className="text-10 text-warning" data-testid="rs-group-prefilled">从第 2 组能力面进入 · 已预填该组</span>}
              </Field>
              <Field n={7} label="哪个决策节点">
                <select data-testid="rs-input-node" defaultValue={c.nodeRef} className="rounded-md border border-border bg-background px-2 py-1.5 text-12">
                  {RS_NODES.map((nn) => <option key={nn.ref} value={nn.ref}>{nn.label}</option>)}
                </select>
              </Field>
            </div>
            {/* 实时预览句（N-4 / N-12）*/}
            <div className="rounded-md border border-ai/20 bg-ai-tint px-3 py-2" data-testid="rs-preview">
              <p className="text-11 leading-relaxed text-ai-tint-foreground"><Bot className="mr-1 inline h-3.5 w-3.5" aria-hidden />{preview}</p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button size="sm" variant="ghost" data-testid="rs-new-cancel">取消</Button>
              <Button size="sm" variant="primary" data-testid="rs-new-create">创建</Button>
            </div>
          </div>
        </div>
        {view === "collaborator" && (
          <p className="text-center text-11 text-muted-foreground" data-testid="rs-new-collab-note">协作者也可发起（范围限本组）；观察者无此入口（切到 denied 态）。</p>
        )}
      </div>
    </StateShell>
  );
}

/* ── 屏 4 · 研究主题详情（UC-24.2 对话+四段 + UC-24.4 出口/门控）───────── */

export function RsDetailScreen({ state, view, sub }: { state: UiState; view: RsView; sub?: string }) {
  const block = RS_PROMOTE_BLOCKS[sub === "block-no-source" ? "no-source" : sub === "block-disputed" ? "disputed" : sub === "block-conflict" ? "conflict" : ""];
  const partial = sub === "promote-partial";
  return (
    <StateShell state={state} {...shellProps("detail")}>
      <div className="flex flex-col gap-4" data-testid="rs-detail-screen">
        <button className="flex w-fit items-center gap-1 text-12 text-muted-foreground transition-colors hover:text-foreground" data-testid="rs-detail-back">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />‹ 全部研究主题
        </button>
        <Head testid="rs-detail-head" title="德国工商储的并网审批实际要多久？" uc="UC-24.2" sub="已出结论 · 来源 14" />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {/* 左半：深度对话 */}
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3" data-testid="rs-dialog">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-13 font-medium text-background-foreground"><Bot className="h-4 w-4 text-ai" aria-hidden />深度对话 · Scout</span>
              <span className="text-11 text-muted-foreground">41 分钟 · 3 轮</span>
            </div>
            {RS_DIALOG.map((r, i) => (
              <div key={i} className="flex flex-col gap-2" data-testid={`rs-round-${i}`}>
                <div className="self-end rounded-lg rounded-br-sm bg-accent px-3 py-1.5 text-12 text-accent-foreground">{r.ask}</div>
                <div className="flex flex-col gap-1.5 rounded-lg rounded-bl-sm border border-ai/20 bg-ai-tint px-3 py-2">
                  <p className="text-12 leading-relaxed text-ai-tint-foreground">{r.answer}</p>
                  <ol className="flex flex-col gap-0.5 border-t border-ai/10 pt-1.5" data-testid={`rs-round-${i}-steps`}>
                    {r.steps.map((s, j) => <li key={j} className="text-10 text-muted-foreground">{j + 1}. {s}</li>)}
                  </ol>
                </div>
              </div>
            ))}
            {view !== "collaborator" || true ? (
              <input data-testid="rs-followup-input" placeholder="继续追问，或让 Scout 补哪一类来源…" className="rounded-md border border-border bg-background px-2.5 py-1.5 text-12" />
            ) : null}
          </div>
          {/* 右半：四段结果 */}
          <div className="flex flex-col gap-3">
            <section className="rounded-lg border border-border bg-card p-3" data-testid="rs-sec-findings">
              <h3 className="mb-1.5 text-12 font-semibold text-background-foreground">① 关键发现</h3>
              <ul className="flex flex-col gap-1">{RS_RESULT.keyFindings.map((f, i) => <li key={i} className="text-12 text-background-foreground">· {f}</li>)}</ul>
            </section>
            <section className="rounded-lg border border-warning/30 bg-warning/5 p-3" data-testid="rs-sec-disputed">
              <h3 className="mb-1.5 flex items-center gap-1 text-12 font-semibold text-warning"><AlertTriangle className="h-3.5 w-3.5" aria-hidden />② 争议 / 不确定</h3>
              {RS_RESULT.disputed.map((d, i) => <p key={i} className="mb-1 text-11 leading-relaxed text-background-foreground">{d}</p>)}
              <Badge tone="warning" data-testid="rs-disputed-flag">此段永不进洞察库（N-2）</Badge>
            </section>
            <section className="rounded-lg border border-border bg-card p-3" data-testid="rs-sec-sources">
              <h3 className="mb-1.5 text-12 font-semibold text-background-foreground">③ 外部来源 · 14</h3>
              <div className="flex flex-col divide-y divide-border-subtle">
                {RS_EXTERNAL_SOURCES.map((s, i) => (
                  <div key={i} className="grid grid-cols-[auto_1fr_auto] items-center gap-2 py-1" data-testid={`rs-src-${i}`}>
                    <Badge tone="outline">{s.category}</Badge>
                    <span className="truncate text-11 text-background-foreground">
                      {s.fromTranscript && view === "collaborator" ? <span className="inline-flex items-center gap-1 text-muted-foreground"><EyeOff className="h-3 w-3" aria-hidden />来自本场转写（原文脱敏）</span> : s.name}
                    </span>
                    <Confidence value={s.confidence} low={s.low} />
                  </div>
                ))}
              </div>
              <p className="mt-1 text-10 text-muted-foreground">低置信来源完整列出、不过滤（N-3）；本场转写对无授权视角脱敏（X-B）。</p>
            </section>
            <section className="rounded-lg border border-border bg-card p-3" data-testid="rs-sec-conclusion">
              <h3 className="mb-1.5 text-12 font-semibold text-background-foreground">④ 研究结论</h3>
              {RS_RESULT.conclusion
                ? <p className="mb-2 text-12 leading-relaxed text-background-foreground">{RS_RESULT.conclusion}</p>
                : <p className="mb-2 rounded bg-muted px-2 py-1.5 text-11 text-muted-foreground" data-testid="rs-conclusion-datareq">零来源：这里是数据需求说明，不是结论（E2）。</p>}
              {/* 出口三按钮（UC-24.4）*/}
              <div className="flex flex-wrap items-center gap-1.5" data-testid="rs-conclusion-actions">
                <ActionButton view={view} action="加入洞察库" variant="primary" testid="rs-act-promote" />
                <ActionButton view={view} action="补充资料" variant="outline" testid="rs-act-supplement" />
                <ActionButton view={view} action="标为关键问题" variant="outline" testid="rs-act-pin" />
              </div>
              <p className="mt-1.5 text-10 text-muted-foreground">对话面同族动作（另一组，不合并 · Q-16）：{RS_LIVE_CONCLUSION_ACTIONS.join(" · ")}</p>
              {/* 门控阻断（点了被拒 + 说明，不是灰按钮）*/}
              {block && (
                <div className="mt-2 flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/5 p-2.5" role="alert" data-testid="rs-promote-blocked">
                  <span className="flex items-center gap-1 text-12 font-medium text-destructive"><XCircle className="h-3.5 w-3.5" aria-hidden />{block.title}</span>
                  <span className="font-mono text-10 text-destructive">{block.code}</span>
                  <span className="text-11 text-background-foreground">{block.detail}</span>
                  <span className="text-11 text-muted-foreground">{block.fix}</span>
                </div>
              )}
              {/* 部分成功：入库成功 + 节点回流失败 */}
              {partial && (
                <div className="mt-2 flex flex-col gap-1 rounded-md border border-warning/40 bg-warning/5 p-2.5" role="status" data-testid="rs-promote-partial">
                  <span className="flex items-center gap-1 text-12 font-medium text-success"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />{RS_PROMOTE_PARTIAL.insight}</span>
                  <span className="flex items-center gap-1 text-11 text-warning"><AlertTriangle className="h-3.5 w-3.5" aria-hidden />决策节点回流失败 · {RS_PROMOTE_PARTIAL.backflow.reason} · {RS_PROMOTE_PARTIAL.backflow.node}</span>
                  <span className="text-11 text-muted-foreground">{RS_PROMOTE_PARTIAL.note}</span>
                  <Button size="xs" variant="outline" data-testid="rs-backflow-retry" className="mt-1 w-fit"><RefreshCw className="h-3 w-3" aria-hidden />重试回流</Button>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </StateShell>
  );
}

/* ── 屏 5 · 现场深度研究与冲突判定（UC-24.5）──────────────────────────── */

export function RsLiveScreen({ state, view, sub }: { state: UiState; view: RsView; sub?: string }) {
  const filterOn = sub === "conflict-filter";
  const conflictEmpty = sub === "conflict-empty";
  const tasks = filterOn ? RS_LIVE_TASKS.filter((t) => t.conflicts > 0) : RS_LIVE_TASKS;
  const conflicts = conflictEmpty ? [] : RS_CONFLICTS;
  const cnt = liveCounts(RS_LIVE_TASKS);
  // 引导师(=owner)独有判定动作；collaborator 无判定动作（[设计]，Q-14 未裁前）
  const canResolve = view === "owner";
  return (
    <StateShell state={state} {...shellProps("live")}>
      <div className="flex flex-col gap-4" data-testid="rs-live-screen">
        <Head
          testid="rs-live-head"
          title="深度研究 · 现场"
          uc="UC-24.5"
          sub="现场提出的问题交给研究 agent 跑，回来带出处"
          actions={
            <div className="flex items-center gap-2">
              <button data-testid="rs-live-filter" data-on={filterOn} className={cn("flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-11", filterOn ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground")}>
                <Filter className="h-3 w-3" aria-hidden />只看有冲突的
              </button>
              {/* F144：同上，像素不变；`rs-live-new` → `rs-entry-live`。 */}
              <NewResearchFlow role="facilitator" at="live" />
            </div>
          }
        />
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3" data-testid="rs-live-tasks">
          <div className="flex items-center justify-between">
            <span className="text-12 font-medium text-background-foreground">本场研究任务</span>
            <span className="text-11 text-muted-foreground" data-testid="rs-live-counts">{cnt.total} 个 · {cnt.ready} 个已就绪</span>
          </div>
          <div className="flex flex-col divide-y divide-border-subtle">
            {tasks.map((t, i) => (
              <div key={i} className="grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-2 py-1.5 text-12" data-testid={`rs-task-${i}`}>
                <span className="font-mono text-11 text-muted-foreground">{t.time}</span>
                <span className="truncate text-background-foreground">{t.question}</span>
                <span className="text-11 text-muted-foreground" data-testid={`rs-task-${i}-proposer`}>{t.proposer} · {t.metric}</span>
                <Badge tone={t.failed ? "danger" : t.status === "已就绪" ? "primary" : t.status === "待判定" ? "warning" : "neutral"} data-testid={`rs-task-${i}-status`}>{t.failed ? "失败 · 可重试" : t.status}</Badge>
                <Button size="xs" variant="outline" data-testid={`rs-task-${i}-open`}>打开<ChevronRight className="h-3 w-3" aria-hidden /></Button>
              </div>
            ))}
          </div>
        </div>
        {/* 冲突待判定区（冲突为 0 时区块仍在，显示空态）*/}
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3" data-testid="rs-conflict-zone">
          <div className="flex flex-col gap-0.5">
            <span className="text-12 font-medium text-background-foreground">冲突待判定</span>
            <span className="text-10 text-muted-foreground">两条结论互相矛盾时，先标不确定再上台讨论</span>
          </div>
          {conflicts.length === 0 ? (
            <p className="rounded-md border border-dashed border-border py-4 text-center text-11 text-muted-foreground" data-testid="rs-conflict-empty">暂无待判定的冲突</p>
          ) : (
            conflicts.map((c) => (
              <div key={c.id} className="flex flex-col gap-2 rounded-md border border-warning/30 bg-warning/5 p-2.5" data-testid={`rs-conflict-${c.id}`}>
                <p className="text-12 text-background-foreground">{c.statement}</p>
                <p className="text-11 text-muted-foreground">{c.suggestion}<span className="ml-1 text-10 text-warning">（建议 ≠ 默认执行，N-6）</span></p>
                {canResolve ? (
                  <div className="flex flex-wrap items-center gap-1.5" data-testid={`rs-conflict-${c.id}-actions`}>
                    {c.actions.map((a) => (
                      <Button key={a} size="xs" variant="outline" data-testid={`rs-conflict-${c.id}-act-${a}`}>{a}</Button>
                    ))}
                  </div>
                ) : (
                  <p className="text-10 text-muted-foreground" data-testid={`rs-conflict-${c.id}-noresolve`}>协作者无冲突判定动作（判定改变全场口径，[设计]，Q-14 未裁）。</p>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </StateShell>
  );
}
