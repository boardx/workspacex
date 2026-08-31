"use client";
import * as React from "react";
import { ArrowRight, Copy, Upload, Github, Check, Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import { cn } from "@/lib/utils";
import {
  AG_ASSET_NAV, AG_ORG_QUOTA, AG_DASHBOARD_TILES, AG_MODELS,
  AG_MARKET_CARDS, AG_MARKET_SOURCES, AG_MARKET_UNCONFIRMED, AG_NEWSKILL_PATHS,
  AG_GATES, AG_DEDUP, AG_REWRITE_DIFF,
  AG_VISIBILITY, AG_EDITORS, AG_OWNER, AG_REVIEW_RULE, AG_PUBLISH_CHECKLIST, AG_RELEASE,
  AG_PRODUCT_VALUES,
  AG_SKILL_TREE, AG_SKILL_MAIN, AG_AGENT_TREE, AG_AGENT_MAIN,
  AG_TRYRUN_SCENARIOS, AG_TRYRUN_INPUT, AG_TRYRUN_PARAMS, AG_TRYRUN_COST,
  AG_TRYRUN_TRACE, AG_TRYRUN_OUTPUT, AG_TRYRUN_CHECKS, AG_TRYRUN_FOOTER,
  AG_BLUEPRINT_HEADER, AG_BLUEPRINTS, blueprintProgressTone,
  type AgView, type AssetPreflightItemView,
} from "@/lib/mock/asset-governance";
import {
  ScreenHead, BackstageGate, VerdictBadge, Meter, FileTree, CodeView, DangerConfirm, Panel,
} from "./ag-shared";
import { AssetCodeEditor } from "./asset-code-editor";
import { ApiError, getStoredSessionToken } from "@/lib/api-client";
import { getAssetDirectory, readAssetFile, writeAssetFile, type AssetDirectory } from "@/lib/asset-directory";
import { runSkillTrialRun, pollSkillTrialRun, isTrialRunAuthExpiredError } from "@/lib/skill-trial-run";
import type { FileNode } from "@/lib/mock/asset-governance";

type ScreenProps = { state: UiState; view: AgView };

/** 契约 `AssetFileBadge` → 现有 `FileTree` 图标档位。JS/SH 目前 fixture 未命中，落到 md。 */
const BADGE_TO_KIND: Record<string, FileNode["kind"]> = {
  MD: "md", PY: "py", JSON: "json", YAML: "yaml", JS: "md", SH: "md", CSV: "json", JSONL: "json",
};

function formatBytes(n: number): string {
  return n < 1024 ? `${n}B` : `${(n / 1024).toFixed(1)}k`;
}

function describeAssetError(e: unknown): string {
  if (e instanceof ApiError) return e.reasonCode ?? `HTTP ${e.status}`;
  if (e instanceof Error) return e.message;
  return "未知错误";
}

/** 统一包壳：先做后台投影门（member），再套七态 StateShell。 */
function Wrap({
  view, what, state, empty, invalid, dep, children,
}: {
  view: AgView;
  what: string;
  state: UiState;
  empty?: string;
  invalid?: Record<string, string>;
  dep?: { what: string };
  children: React.ReactNode;
}) {
  return (
    <BackstageGate view={view} what={what}>
      <StateShell
        state={state}
        emptyHint={empty ?? "还没有内容"}
        errors={invalid}
        depFailure={dep}
        denial={{ layer: "organization", reason: "你的组织角色不含资产治理权限（需管理员 / 维护者 / 审核人 / 领域负责人）" }}
        successMessage="已保存"
        skeletonRows={5}
      >
        {children}
      </StateShell>
    </BackstageGate>
  );
}

/* ─────────────────────────── ⑦ 后台外壳 · 数据总览 ─────────────────────────── */

export function AgDashboard({ state, view }: ScreenProps) {
  return (
    <Wrap view={view} what="后台数据总览" state={state} empty="本月还没有任何活动记录">
      <div className="flex flex-col gap-4">
        <ScreenHead title="数据总览" uc="⑦ 后台外壳 + 左栏 IA">
          全组织活动、消耗与异常 · 更新于 1 分钟前 · 远洋咨询 · 组织 ID {AG_ORG_QUOTA.orgId}
        </ScreenHead>

        <Panel testid="ag-dashboard-quota">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-12 font-medium text-background-foreground">本月组织额度</span>
            <span className="font-mono text-13 font-semibold text-background-foreground">{AG_ORG_QUOTA.pct}%</span>
          </div>
          <Meter value={AG_ORG_QUOTA.pct} max={100} tone="warning" testid="ag-dashboard-quota-meter" />
          <p className="mt-1.5 font-mono text-10 text-muted-foreground">
            {AG_ORG_QUOTA.usedWan} 万 / {AG_ORG_QUOTA.totalWan} 万 tokens · 还剩 {AG_ORG_QUOTA.daysLeft} 天
          </p>
        </Panel>

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {AG_DASHBOARD_TILES.map((t) => (
            <Panel key={t.k} testid="ag-dashboard-tile">
              <p className="text-10 text-muted-foreground">{t.k}</p>
              <p className="mt-1 text-20 font-semibold text-background-foreground">{t.v}</p>
              <p className="mt-0.5 text-9 text-muted-foreground">{t.sub}</p>
            </Panel>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-11 font-medium text-background-foreground">六种资产 · 一套公共治理机制</p>
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
            {AG_ASSET_NAV.map((a) => (
              <Panel key={a.kind} testid="ag-dashboard-asset">
                <div className="flex items-center gap-2">
                  <span className="grid h-6 w-6 place-items-center rounded-md bg-muted font-mono text-9 text-muted-foreground">{a.icon}</span>
                  <span className="text-12 font-medium text-background-foreground">{a.label}</span>
                  <Badge tone="outline" className="ml-auto font-mono">{a.count}</Badge>
                </div>
                <p className="mt-1.5 text-9 leading-relaxed text-muted-foreground">{a.govHint}</p>
              </Panel>
            ))}
          </div>
          <p className="text-9 text-muted-foreground">
            「模型」资产已接入 {AG_MODELS.length}+ 个（含开源自托管）；上面每一种资产都走同一套导入六道关、可见范围、负责人与复核周期。
          </p>
        </div>
      </div>
    </Wrap>
  );
}

/* ─────────────────────────── ⑧ 项目蓝本列表 ─────────────────────────── */

export function AgBlueprint({ state, view }: ScreenProps) {
  const h = AG_BLUEPRINT_HEADER;
  return (
    <Wrap view={view} what="项目蓝本库" state={state} empty="还没有任何蓝本，从头新建或从市场导入一个">
      <div className="flex flex-col gap-4">
        <ScreenHead
          title={h.title}
          uc="⑧ 后台 → 项目蓝本"
          actions={
            <>
              <Button size="sm" variant="outline" data-testid="ag-blueprint-export">导出</Button>
              <Button size="sm" variant="primary" data-testid="ag-blueprint-new">＋ 新建蓝本</Button>
            </>
          }
        >
          {h.sub}
        </ScreenHead>

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <span className="text-13 font-medium text-background-foreground">{h.sectionTitle}</span>
          </div>
          <p className="text-10 leading-relaxed text-muted-foreground">{h.sectionSub}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {h.chips.map((c, i) => (
              <Button key={c.id} size="xs" variant={i === 0 ? "primary" : "outline"} data-testid="ag-blueprint-filter">
                {c.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {AG_BLUEPRINTS.map((b) => {
            const tone = blueprintProgressTone(b.configured);
            const total = AG_PRODUCT_VALUES.blueprintTotalSegments.value;
            return (
              <Panel key={b.id} testid="ag-blueprint-card" className="flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-13 font-medium text-background-foreground">{b.title}</span>
                      {b.status === "published" ? (
                        <Badge tone="primary" className="font-mono">已发布 {b.version}</Badge>
                      ) : (
                        <Badge tone="warning">草稿</Badge>
                      )}
                    </div>
                    <p className="text-11 text-muted-foreground">{b.desc}</p>
                  </div>
                </div>

                {b.status === "published" ? (
                  <p className="font-mono text-9 text-muted-foreground">
                    {b.meta} · {b.used} · {b.satisfaction}
                  </p>
                ) : (
                  <p className="inline-flex items-center gap-1 text-10 font-medium text-destructive" data-testid="ag-blueprint-blocknote">
                    {b.blockNote}
                  </p>
                )}

                <div className="flex items-center gap-2">
                  <span className="shrink-0 font-mono text-9 text-muted-foreground">{b.configured}/{total} 环节已配</span>
                  <Meter value={b.configured} max={total} tone={tone} testid="ag-blueprint-progress" />
                </div>

                <div className="flex items-center gap-1">
                  <Button size="xs" variant="outline" className="gap-1" data-testid="ag-blueprint-edit">
                    编辑设计 <ArrowRight aria-hidden className="h-3 w-3" />
                  </Button>
                  <Button size="icon" variant="ghost" aria-label="复制为副本" data-testid="ag-blueprint-dup">
                    <Copy aria-hidden className="h-3.5 w-3.5" />
                  </Button>
                  <DangerConfirm
                    testid="ag-blueprint-delete"
                    trigger="删除"
                    confirmLabel="仍要删除此蓝本"
                    impact={
                      <>
                        <span className="font-medium text-background-foreground">影响范围：删除「{b.title}」</span>
                        <span>· 已用它开过 {b.used.replace("用过 ", "").replace(" 次", "")} 个项目——那些项目锁在自己的版本上，不受影响。</span>
                        <span>· 新建项目将无法再套用它。此操作不可撤销。</span>
                      </>
                    }
                  />
                </div>
              </Panel>
            );
          })}
        </div>
        <p className="text-9 text-muted-foreground">
          蓝本设计器本体（16 个面板）不在本域——见 `ui-preview/tpl-v2/`。本域只画后台宿主与列表。
        </p>
      </div>
    </Wrap>
  );
}

/* ─────────────────────────── ① 新建 Skill ─────────────────────────── */

export function AgNewSkill({ state, view }: ScreenProps) {
  return (
    <Wrap view={view} what="新建 Skill" state={state} empty="市场同步为空——先在「添加源」里连一个社区源"
      invalid={{ repo: "仓库地址格式不对：应为 github.com/<org>/<repo>" }}
      dep={{ what: "Codex 社区同步失败 · 凭据过期——去「添加源」修复后再从它导入" }}>
      <div className="flex flex-col gap-4">
        <ScreenHead title="新建 Skill" uc="① 三条路径">
          一个 skill 是一个目录：SKILL.md ＋ 参考资料 ＋ 可选脚本。可以从空白开始写，也可以把现成的目录导进来再改。
        </ScreenHead>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          {AG_NEWSKILL_PATHS.map((p, i) => (
            <Panel key={p.id} testid="ag-newskill-path" className={cn("flex flex-col gap-2", i === 1 && "border-inverse")}>
              <div className="flex items-center gap-2">
                {p.id === "import" && <Github aria-hidden className="h-4 w-4 text-muted-foreground" />}
                <span className="text-12 font-medium text-background-foreground">{p.label}</span>
              </div>
              <p className="text-10 leading-relaxed text-muted-foreground">{p.desc}</p>
              {p.id === "import" && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 font-mono text-10 text-muted-foreground">
                    github.com/org/skill-repo
                  </div>
                  <Button size="xs" variant="outline" className="gap-1" data-testid="ag-newskill-upload">
                    <Upload aria-hidden className="h-3 w-3" /> 上传 .zip 或整个目录
                  </Button>
                </div>
              )}
              <Badge tone="outline" className="w-fit font-mono text-9">{p.meta}</Badge>
            </Panel>
          ))}
        </div>

        <p className="rounded-md border border-ai/20 bg-ai-tint/40 px-3 py-2 text-10 leading-relaxed text-ai-tint-foreground">
          导入后自动做兼容性检查与安全扫描，通过才能发布给全体成员。
        </p>

        <div className="flex flex-col gap-2">
          <span className="text-11 font-medium text-background-foreground">或从市场挑一个改</span>
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-3">
            {AG_MARKET_CARDS.map((m) => (
              <Panel key={m.id} testid="ag-newskill-market" className="flex flex-col gap-1.5">
                <span className="text-12 font-medium text-background-foreground">{m.name}</span>
                <span className="font-mono text-9 text-muted-foreground">{m.total} 个 · 已同步 {m.synced}</span>
                <Button size="xs" variant="outline" data-testid="ag-newskill-browse">浏览</Button>
              </Panel>
            ))}
          </div>
          <p className="text-9 text-muted-foreground">
            未确认的源：{AG_MARKET_UNCONFIRMED.map((u) => `${u.name}（${u.status}）`).join("、")}——原型运行态里没有，不发明。
          </p>
        </div>
      </div>
    </Wrap>
  );
}

/* ─────────────────────────── ② 导入向导 · 六道关 ─────────────────────────── */

function WizardSteps({ active }: { active: 2 | 3 }) {
  const steps = [
    { n: 1, label: "来源" },
    { n: 2, label: "配置" },
    { n: 3, label: "治理与发布" },
  ];
  return (
    <div className="flex items-center gap-2" data-testid="ag-wizard-steps">
      {steps.map((s, i) => (
        <React.Fragment key={s.n}>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-10",
              s.n === active ? "bg-primary text-primary-foreground" : "text-muted-foreground",
            )}
          >
            <span className="font-mono">{s.n}</span> {s.label}
          </span>
          {i < steps.length - 1 && <span className="text-muted-foreground">—</span>}
        </React.Fragment>
      ))}
      <span className="ml-auto font-mono text-9 text-muted-foreground">草稿自动保存 · 14:52</span>
    </div>
  );
}

export function AgGates({ state, view }: ScreenProps) {
  return (
    <Wrap view={view} what="导入落地检查" state={state} empty="还没有待导入的资产"
      invalid={{ dedup: "第 04 关未处理：查重分歧必须先给出结论（合并 / 分别保留 / 放弃）才能继续" }}
      dep={{ what: "沙箱试跑依赖的评测服务暂时不可用——第 05 关无法完成" }}>
      <div className="flex flex-col gap-4">
        <WizardSteps active={2} />
        <ScreenHead title="落地检查 · 六道关" uc="② 导入向导 · 第 2 步"
          actions={<Badge tone="warning" className="font-mono">4 / 6 · 已通过 · 1 项待处理</Badge>}>
          六道关全过才能发布，任何一道阻断都不能跳过。
        </ScreenHead>

        <div className="flex flex-col gap-2">
          {AG_GATES.map((g) => (
            <Panel key={g.no} testid="ag-gate-row" className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-9 text-muted-foreground">{g.no}</span>
                <span className="text-12 font-medium text-background-foreground">{g.name}</span>
                <span className="ml-auto"><VerdictBadge verdict={g.verdict} /></span>
              </div>
              <p className="text-11 leading-relaxed text-muted-foreground">{g.detail}</p>
            </Panel>
          ))}
        </div>

        {/* 第 04 关 · 查重分歧 */}
        <Panel testid="ag-gate-dedup" className="flex flex-col gap-3 border-destructive/30 bg-destructive/5">
          <span className="text-12 font-medium text-background-foreground">第 04 关 · 查重分歧，需要你判断</span>
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
            {[AG_DEDUP.existing, AG_DEDUP.incoming].map((c, i) => (
              <div key={i} className="flex flex-col gap-1 rounded-md border border-border bg-card p-2.5">
                <span className="text-11 font-medium text-background-foreground">{c.title}</span>
                <p className="text-10 leading-relaxed text-muted-foreground">{c.desc}</p>
                <p className="font-mono text-9 text-muted-foreground">{c.calls} · {c.satisfaction}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {AG_DEDUP.exits.map((e) =>
              e.id === "abort" ? (
                <DangerConfirm
                  key={e.id}
                  testid="ag-gate-abort"
                  trigger={e.label}
                  confirmLabel="确认放弃本次导入"
                  impact={
                    <>
                      <span className="font-medium text-background-foreground">影响范围：放弃导入 Jobs-to-be-done</span>
                      <span>· 已跑完的前 3 关结果一并丢弃，下次导入需重跑。草稿不保留。</span>
                    </>
                  }
                />
              ) : (
                <Button key={e.id} size="sm" variant={e.id === "merge" ? "primary" : "outline"} data-testid="ag-gate-exit">
                  {e.label}
                </Button>
              ),
            )}
          </div>
        </Panel>

        {/* 第 03 关建议 · 原文与改写对照 */}
        <Panel testid="ag-gate-diff" className="flex flex-col gap-2">
          <span className="text-11 font-medium text-background-foreground">原文与改写对照 · {AG_REWRITE_DIFF.hint}</span>
          <div className="flex flex-col gap-1 font-mono text-10">
            <div className="rounded-md bg-destructive/10 px-2 py-1 text-destructive">－ 原文 {AG_REWRITE_DIFF.before}</div>
            <div className="rounded-md bg-success/10 px-2 py-1 text-success">＋ 改写为 {AG_REWRITE_DIFF.after}</div>
          </div>
          <Button size="xs" variant="primary" className="w-fit gap-1" data-testid="ag-gate-accept">
            <Check aria-hidden className="h-3 w-3" /> {AG_REWRITE_DIFF.accept}
          </Button>
        </Panel>
      </div>
    </Wrap>
  );
}

/* ─────────────────────────── ③ 导入向导 · 治理与发布 ─────────────────────────── */

export function AgGovernance({
  state, view, checklist = AG_PUBLISH_CHECKLIST,
}: ScreenProps & { checklist?: readonly AssetPreflightItemView[] }) {
  const [vis, setVis] = React.useState<string>("team");
  const [cycle, setCycle] = React.useState<number>(AG_PRODUCT_VALUES.reviewCycleDefaultMonths.value);
  // F136: derived from each item's own `blocking`/`passed` -- not a single hand-set boolean --
  // so a screen with zero blocking-and-failed items disables nothing, and any one of them
  // reopening the gate is enough (uc-23-4 R3 第四项 / domain I-22).
  const blockingItems = checklist.filter((c) => c.blocking && !c.passed);
  const redOpen = blockingItems.length > 0;
  return (
    <Wrap view={view} what="治理与发布" state={state} empty="没有待发布的资产"
      invalid={{ owner: "必须指定一名负责人才能发布" }}
      dep={{ what: "领域负责人联签服务不可用——「全组织」可见范围暂时无法提交" }}>
      <div className="flex flex-col gap-4">
        <WizardSteps active={3} />
        <ScreenHead title="治理与发布" uc="③ 导入向导 · 第 3 步"
          actions={
            <>
              <Button size="sm" variant="outline" data-testid="ag-gov-draft">存为草稿</Button>
              <DangerConfirm
                testid="ag-gov-gray"
                danger={false}
                trigger={AG_RELEASE.options[1]!.label}
                confirmLabel="确认灰度发布"
                impact={
                  <>
                    <span className="font-medium text-background-foreground">发布方式：灰度</span>
                    <span>· {AG_RELEASE.note}</span>
                    <span>· 回退：灰度期内任一异常，一键撤回，不触达其余 43 人。</span>
                  </>
                }
              />
            </>
          }>
          这一步六种资产完全一样：<strong className="font-medium text-background-foreground">谁能用、出问题谁负责、什么时候重新检查</strong>。三个都填完才能发布。
        </ScreenHead>

        {/* 可见范围 */}
        <Panel testid="ag-gov-visibility" className="flex flex-col gap-2">
          <span className="text-11 font-medium text-background-foreground">可见范围</span>
          <div className="flex flex-col gap-1.5">
            {AG_VISIBILITY.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setVis(v.id)}
                data-testid="ag-gov-visibility-option"
                className={cn(
                  "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors",
                  vis === v.id ? "border-inverse bg-muted" : "border-border hover:bg-muted",
                )}
              >
                <span className={cn("grid h-3.5 w-3.5 place-items-center rounded-full border", vis === v.id ? "border-inverse" : "border-border")}>
                  {vis === v.id && <span className="h-1.5 w-1.5 rounded-full bg-inverse" />}
                </span>
                <span className="text-11 font-medium text-background-foreground">{v.label}</span>
                <span className="text-10 text-muted-foreground">{v.detail}</span>
                {v.needsCosign && vis === v.id && <Badge tone="warning" className="ml-auto">需联签</Badge>}
              </button>
            ))}
          </div>
        </Panel>

        {/* 谁能改它 */}
        <Panel testid="ag-gov-editors" className="flex flex-col gap-2">
          <span className="text-11 font-medium text-background-foreground">谁能改它</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {AG_EDITORS.map((e) => (
              <Badge key={e} tone={e.startsWith("＋") ? "outline" : "neutral"} className="font-normal">{e}</Badge>
            ))}
          </div>
        </Panel>

        {/* 责任与复核 */}
        <Panel testid="ag-gov-review" className="flex flex-col gap-2">
          <span className="text-11 font-medium text-background-foreground">责任与复核</span>
          <div className="flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-11 text-primary-foreground">{AG_OWNER.initial}</span>
            <span className="text-11 text-background-foreground">负责人 {AG_OWNER.name} · {AG_OWNER.team}</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-10 text-muted-foreground">复核周期</span>
            <div className="flex items-center gap-1.5">
              {AG_PRODUCT_VALUES.reviewCyclesMonths.value.map((m) => (
                <Button key={m} size="xs" variant={cycle === m ? "primary" : "outline"} onClick={() => setCycle(m)} data-testid="ag-gov-cycle">
                  {m} 个月
                </Button>
              ))}
            </div>
          </div>
          <p className="rounded-md border border-warning/30 bg-warning/5 px-2 py-1.5 text-10 leading-relaxed text-muted-foreground">
            {AG_REVIEW_RULE}
          </p>
        </Panel>

        {/* 发布前检查 -- 派生视图：每一条都带 sourceRef，可追回来源（F136, domain I-22） */}
        <Panel testid="ag-gov-checklist" className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-11 font-medium text-background-foreground">发布前检查</span>
            {redOpen && <Badge tone="danger">{blockingItems.length} 项未完成</Badge>}
          </div>
          <div className="flex flex-col gap-1.5">
            {checklist.map((c, i) => {
              const red = c.blocking && !c.passed;
              return (
                <div
                  key={i}
                  className="flex items-center gap-2"
                  data-testid="ag-gov-check-item"
                  data-source-ref={c.sourceRef}
                  data-blocking={c.blocking}
                  data-passed={c.passed}
                  title={`来源：${c.sourceRef}`}
                >
                  <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded", c.passed ? "bg-success text-success-foreground" : "border border-destructive")}>
                    {c.passed && <Check aria-hidden className="h-2.5 w-2.5" />}
                  </span>
                  <span className={cn("text-10", c.passed ? "text-muted-foreground" : "font-medium text-destructive")}>{c.label}</span>
                  <span className="sr-only" data-testid="ag-gov-check-source">{c.sourceRef}</span>
                  {red && c.action && (
                    <Button size="xs" variant="outline" className="ml-auto" data-testid="ag-gov-check-fix">{c.action}</Button>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-9 text-muted-foreground">红色项未清空时「发布」保持禁用。</p>
          <Button size="sm" variant="primary" disabled={redOpen} data-testid="ag-gov-publish"
            className="w-fit disabled:bg-disabled disabled:text-disabled-foreground">
            发布 v5
          </Button>
        </Panel>
      </div>
    </Wrap>
  );
}

/* ─────────────────────────── ④/⑤ 编辑器（Skill / Agent 同构）─────────────────────────── */

function Editor({
  kind, state, view, assetId, assetLabel, compact = false,
}: {
  kind: "skill" | "agent";
  state: UiState;
  view: AgView;
  /**
   * #848：调用方（如 `/admin/skill` 的编辑入口）可以传一个**真实** `assetId`，
   * 覆盖掉这个组件原本写死的 `main.slug`（该 prototype 常量对应固定的示例 skill，
   * 与目录页里的真实记录八竿子打不着）。不传 = 与此前行为逐字一致（`/asset-governance`
   * 原型路由继续用 `main.slug`），⇒ 向后兼容，不影响该路由已有的七态演示与既有测试。
   *
   * ⚠ 只对 `kind === "skill"` 有意义：`PgAssetFileRepository` 目前只把 `skill` 接到真实
   * `skills`/`skill_versions`/`skill_version_files`（#785），`agent` 仍回退到
   * `FixtureAssetFileRepository`（#787 未解决）——调用方不应该对 `agent` 传 `assetId`，
   * 传了也只会打到同一份写死的 fixture 目录，不会变得更真。
   */
  assetId?: string;
  /** 配 `assetId` 一起传：显示用的真实名称，覆盖 `main.name`。不传则回退 `main.name`。 */
  assetLabel?: string;
  /**
   * #1971 —— 人类截图实测反馈：`/admin/skill/[id]` 全屏编辑页里，`ScreenHead`
   * 的大标题 + 说明段落与页面自己的（更紧凑的）头部信息重复，挤占了文件树/代码
   * 编辑器本该占大部分屏幕的空间。`compact` 时跳过 `ScreenHead`，只保留数据源
   * 徽标 + 文件树/编辑器本体。
   *
   * ⚠ 默认 `false`——`/asset-governance` 原型路由（`AgSkillEditor`/`AgAgentEditor`
   * 的其它调用点）不传，行为与既有七态演示逐字一致。
   */
  compact?: boolean;
}) {
  const mockTree = kind === "skill" ? AG_SKILL_TREE : AG_AGENT_TREE;
  const main = kind === "skill" ? AG_SKILL_MAIN : AG_AGENT_MAIN;
  const liveAssetId = assetId ?? main.slug;
  const liveAssetLabel = assetLabel ?? main.name;
  const [sel, setSel] = React.useState(mockTree[0]!.path);
  const [tab, setTab] = React.useState<"edit" | "preview">("edit");
  const label = kind === "skill" ? "Skill" : "Agent";
  const uc = kind === "skill" ? "④ Skill 编辑器" : "⑤ Agent 编辑器";

  // ── F367：真实 GetAssetDirectory / ReadAssetFile（`asset-directory.controller.ts`）。
  // 只在本地已有 F122 登录写入的 session token 时才打真实接口——本页面没有自己的登录 UI，
  // 未登录时保持原有 mock 展示（不是网络失败，是从没发起请求）。
  // ⚠ #848 之前这里写着「文件字节仍来自 FixtureAssetFileRepository」——那句话在 #785
  //   之后只对 `agent` 仍成立：`kind === "skill"` 时，`PgAssetFileRepository` 已经把
  //   `assetId` 解析成真实 `skills.id`，返回的是这个组织这个 skill 自己的
  //   `skill_version_files`，不是随便传什么都返回同一份 fixture。
  const [liveDir, setLiveDir] = React.useState<AssetDirectory | null>(null);
  const [liveError, setLiveError] = React.useState<string | null>(null);
  const isLive = liveDir !== null;

  React.useEffect(() => {
    setLiveDir(null);
    setLiveError(null);
    const token = getStoredSessionToken();
    if (!token) return;
    let cancelled = false;
    getAssetDirectory(kind, liveAssetId)
      .then((dir) => {
        if (!cancelled) setLiveDir(dir);
      })
      .catch((e) => {
        if (!cancelled) setLiveError(describeAssetError(e));
      });
    return () => {
      cancelled = true;
    };
  }, [kind, liveAssetId]);

  const tree: FileNode[] = liveDir
    ? liveDir.files.map((f) => ({
        path: f.path,
        size: formatBytes(f.sizeBytes),
        kind: BADGE_TO_KIND[f.badge] ?? "md",
      }))
    : mockTree;

  const [liveBody, setLiveBody] = React.useState<string | null>(null);
  const [fileBusy, setFileBusy] = React.useState(false);

  /**
   * 平台官方 skill（`skill-platform-*`，四个）对任何组织只读可见——`getDirectory` 现在
   * 显式带出这个信号（见 `AssetDirectoryRecord.readOnly` 的头注，这是它存在的全部理由）。
   * ⚠ 只对 `isLive` 有意义：mock 态 `liveDir` 恒为 `null`，`?? false` 落到「可编辑」，
   *   与 mock 态原有行为一致——`readOnly` 不是给 mock 态新加的限制。
   */
  const readOnly = liveDir?.readOnly ?? false;

  /**
   * 试跑（`POST /skill-versions/:versionId/trial-run`，见 `lib/skill-trial-run.ts`）。
   * ⚠ 只在 `isLive && kind === "skill"` 时可点——mock 态没有真实 `versionId`，
   *   `agent` 这一档仍是 fixture（#787 未解决），两者点了都只会打到假数据或 404，
   *   按本仓「宁可显式禁用并说明，不放一个点了没反应/报假错的按钮」的纪律禁用。
   */
  /**
   * 人类反馈（2026-08-17）：试跑面板与代码编辑区堆叠在一起，界面太挤——改成
   * 「代码 / 试跑」两个互斥的 tab，同一屏只显示一个，不再上下堆叠滚动。
   */
  const [editorTab, setEditorTab] = React.useState<"code" | "trialrun">("code");
  const [trialRunInput, setTrialRunInput] = React.useState("");
  const [trialRunPending, setTrialRunPending] = React.useState(false);
  const [trialRunOutput, setTrialRunOutput] = React.useState<{ output: string; durationMs: number; tokens: number } | null>(null);
  const [trialRunError, setTrialRunError] = React.useState<string | null>(null);
  /**
   * #1941 —— 同 issue #1819/PR #1820 里 `chat-live-message-panel.tsx` 的
   * `runObservation.authExpired` 同一条纪律：401 与其它可重试失败区分开单独标出，
   * 好让渲染那一层不必靠正则匹配文案来判断是不是这一种终态。
   */
  const [trialRunAuthExpired, setTrialRunAuthExpired] = React.useState(false);
  const trialRunAvailable = isLive && kind === "skill";

  const runTrialRun = async () => {
    if (!trialRunAvailable || trialRunPending) return;
    const versionId = liveDir?.currentVersionId ?? null;
    if (versionId === null) {
      setTrialRunError("这个 skill 还没有已发布的版本，无法试跑。");
      return;
    }
    setTrialRunPending(true);
    setTrialRunError(null);
    setTrialRunAuthExpired(false);
    try {
      // F962 之后 POST 恒转异步（`trialRun` 恒 null，`asyncTaskId` 恒非 null）——
      // 见 `lib/skill-trial-run.ts` 头注「POST 恒转异步，轮询是必需的一半」。但契约
      // 类型上两个字段都是 `nullable`（`trialRun`/`asyncTaskId` 互斥，不是各自独立
      // 可空），按类型诚实处理：`trialRun` 非空就是同步结果直接可用（契约没有排除
      // 这条路径，只是当前实现恒不走），`asyncTaskId` 非空才需要轮询。
      const submitted = await runSkillTrialRun(versionId, trialRunInput);
      const polled =
        submitted.trialRun !== null
          ? { status: "succeeded" as const, trialRun: submitted.trialRun, failure: null }
          : submitted.asyncTaskId !== null
            ? await pollSkillTrialRun(submitted.asyncTaskId)
            : null;
      if (polled === null) {
        setTrialRunError("试跑提交响应既没有结果也没有任务 id，无法继续。");
        return;
      }
      if (polled.status === "failed") {
        // `failure.stderr` 是真实执行原文，不是友好文案（同 #660 的既有纪律）——
        // 按 code 给一句人话前缀，但原文必须跟着，不能只留一句「失败了」。
        const failure = polled.failure;
        setTrialRunError(
          failure === null
            ? "试跑失败（未知原因）"
            : `${failure.code}${failure.stderr ? `：${failure.stderr}` : ""}`,
        );
        return;
      }
      if (polled.trialRun === null) {
        // 契约类型允许非终态时 trialRun 为 null；轮询已经在终态才返回，
        // 到这里说明是 succeeded 但 trialRun 仍是 null——按类型诚实处理，不断言非空。
        setTrialRunError("试跑已结束，但没有返回结果内容。");
        return;
      }
      setTrialRunOutput({
        output: polled.trialRun.output,
        durationMs: polled.trialRun.durationMs,
        tokens: polled.trialRun.tokens,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "TRIALRUN_POLL_BUDGET_EXCEEDED") {
        setTrialRunError("试跑仍在后台执行，尚未在等待时间内完成——可以稍后刷新页面查看。");
        return;
      }
      // #1941 —— 401 是不可恢复的：bearer 已过期，`describeAssetError` 的通用兜底
      // 会把它显示成裸 `HTTP 401`/reasonCode，不可行动。单独识别出来，换成明确的
      // "登录已失效，请重新登录"（同 issue #1819/PR #1820 里 AgentRun 轮询的同一条纪律）。
      if (isTrialRunAuthExpiredError(error)) {
        setTrialRunAuthExpired(true);
        setTrialRunError("登录已失效，请重新登录。");
        return;
      }
      setTrialRunError(describeAssetError(error));
    } finally {
      setTrialRunPending(false);
    }
  };
  /**
   * #881：编辑缓冲区。`liveBody` 是**服务端那一版**，`draft` 是用户正在改的那一版，
   * 两者不等 ⇒ 真的有未保存改动。
   * ⚠ 在此之前，界面上那句「有未保存改动」是**写死的**，永远显示——
   *   一个恒真的状态指示等于没有指示，而且是假话。
   */
  const [draft, setDraft] = React.useState<string>("");
  const dirty = isLive && liveBody !== null && draft !== liveBody;

  React.useEffect(() => {
    setLiveBody(null);
    if (!isLive) return;
    let cancelled = false;
    setFileBusy(true);
    readAssetFile(kind, liveAssetId, sel)
      .then((f) => {
        if (!cancelled) { setLiveBody(f.body); setDraft(f.body); }
      })
      .catch((e) => {
        if (!cancelled) setLiveError(describeAssetError(e));
      })
      .finally(() => {
        if (!cancelled) setFileBusy(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, kind, liveAssetId, sel]);

  return (
    <Wrap view={view} what={`${label} 编辑器`} state={state} empty={`这个 ${label} 目录还是空的`}
      invalid={{ frontmatter: "SKILL.md 的 frontmatter 缺 name/description——保存前必须补齐" }}
      dep={{ what: "试跑依赖的评测服务不可用——右上「试跑」暂时不可点" }}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2" data-testid={`ag-${kind}-editor-top`}>
          <div className="flex items-center gap-2">
            <Button size="xs" variant="ghost" data-testid={`ag-${kind}-back`}>‹ {label} 列表</Button>
            <span className="text-13 font-medium text-background-foreground">{liveAssetLabel}</span>
            <Badge tone="outline" className="font-mono">{liveAssetId}</Badge>
            {"model" in main && <Badge tone="ai" className="font-mono">{(main as typeof AG_AGENT_MAIN).model}</Badge>}
            {/* #881：只在**真的**有未保存改动时显示。此前这段是写死的，永远显示。 */}
            {dirty ? (
              <span className="inline-flex items-center gap-1 text-9 text-warning" data-testid={`ag-${kind}-dirty`}>
                <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden /> 有未保存改动
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5">
            <DangerConfirm
              testid={`ag-${kind}-publish`}
              trigger="保存并发布"
              danger={false}
              confirmLabel="确认发布新版本"
              // ⚠ 只有真实数据态才接真实写入。mock 态**不接**——那样会对着一份假目录
              //   发出真实写请求，写到一个并不是你在看的那个 skill 上。
              // ⚠ 平台官方 skill（`readOnly`）同样不接：写路径本来就会被服务端拒绝
              //   （`PgAssetFileRepository` 的写方法从不落到平台行），按钮显式禁用 +
              //   说明原因，好过让用户点了「确认发布」才在网络请求里撞见一个 404。
              disabled={!isLive || !dirty || readOnly}
              title={readOnly ? "平台官方 skill，对所有组织只读——无法在此保存" : undefined}
              onConfirm={isLive && !readOnly ? async () => {
                await writeAssetFile(kind, liveAssetId, sel, draft);
                // 写成功后把「服务端那一版」推进到刚保存的内容 ⇒ dirty 归位。
                // ⚠ 不重新 GET：服务端返回的就是它写下的字节，再读一次不会更真，
                //   反而会把「保存成功」与「读成功」两件事绑在一起。
                setLiveBody(draft);
              } : undefined}
              impact={
                <>
                  <span className="font-medium text-background-foreground">影响范围：发布 {liveAssetLabel} 新版本</span>
                  <span>· 已建实例锁定在旧版本、不因发新版漂移。</span>
                  <span>· 新绑定将使用新版本；发布需先过一次无阻断试跑。</span>
                </>
              }
            />
          </div>
        </div>

        {/*
          人类反馈（2026-08-17）：试跑面板与代码编辑区此前上下堆叠，界面太挤——
          改成互斥的「代码 / 试跑」tab，同一屏只显示一个区块，不再靠滚动切换。
        */}
        <div className="flex items-center gap-1 border-b border-border" data-testid={`ag-${kind}-editor-tabs`}>
          <Button
            size="sm"
            variant={editorTab === "code" ? "primary" : "ghost"}
            onClick={() => setEditorTab("code")}
            // ⚠ 不能叫 `ag-${kind}-editortab-code`——会撞上既有的 `[data-testid$="-code"]`
            //   后缀选择器（那个选择器要找的是代码文本框本身，不是这颗 tab 按钮），
            //   实测（真栈 e2e ②）：两者都以 "-code" 结尾时 Playwright 判定 strict mode
            //   violation（同一个后缀选择器命中 2 个元素）。
            data-testid={`ag-${kind}-editortab-content`}
          >
            代码
          </Button>
          <Button
            size="sm"
            variant={editorTab === "trialrun" ? "primary" : "ghost"}
            className="gap-1"
            disabled={!trialRunAvailable}
            title={trialRunAvailable ? undefined : "试跑需要真实数据态下的 skill（agent 与预览态 mock 暂不支持）"}
            onClick={() => setEditorTab("trialrun")}
            data-testid={`ag-${kind}-editortab-trialrun`}
          >
            <Play aria-hidden className="h-3 w-3" /> 试跑
          </Button>
        </div>

        {editorTab === "trialrun" && trialRunAvailable ? (
          <Panel testid={`ag-${kind}-trialrun-panel`} className="flex flex-col gap-2">
            <p className="text-11 text-muted-foreground">
              用一句样例输入真实调一次模型——system 是当前发布版本的 SKILL.md
              正文（不是你还没保存的草稿），输出不入库。
            </p>
            <textarea
              data-testid={`ag-${kind}-trialrun-input`}
              className="min-h-[72px] w-full rounded-md border border-border bg-card p-2 font-mono text-11 leading-relaxed text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="试一条样例输入…"
              value={trialRunInput}
              onChange={(e) => setTrialRunInput(e.target.value)}
              disabled={trialRunPending}
            />
            <div className="flex items-center gap-2">
              <Button
                size="xs"
                variant="primary"
                data-testid={`ag-${kind}-trialrun-run`}
                disabled={trialRunPending}
                onClick={() => void runTrialRun()}
              >
                {trialRunPending ? "运行中…" : "运行一次"}
              </Button>
            </div>
            {trialRunError ? (
              <p
                className="text-11 text-destructive"
                data-testid={`ag-${kind}-trialrun-error`}
                data-trial-run-auth-expired={trialRunAuthExpired || undefined}
              >
                {trialRunError}
              </p>
            ) : null}
            {trialRunOutput ? (
              <div className="flex flex-col gap-1 rounded-md border border-border-subtle bg-muted/30 p-2" data-testid={`ag-${kind}-trialrun-output`}>
                <p className="whitespace-pre-wrap font-mono text-11 text-card-foreground">{trialRunOutput.output}</p>
                <p className="text-9 text-muted-foreground">{trialRunOutput.durationMs}ms · {trialRunOutput.tokens} tokens</p>
              </div>
            ) : null}
          </Panel>
        ) : null}

        {editorTab === "code" ? (
          <>
            {!compact && (
              <ScreenHead title={`${label} 编辑器`} uc={uc}>
                左侧文件树就是发布出去的目录结构；右侧编辑 {sel}。
              </ScreenHead>
            )}

            <div className="flex items-center gap-2" data-testid={`ag-${kind}-data-source`}>
              {isLive ? (
                <Badge tone="primary" className="font-mono text-9">真实数据 · GetAssetDirectory</Badge>
              ) : (
                <Badge tone="outline" className="font-mono text-9">
                  {getStoredSessionToken() === null ? "预览态 mock · 未登录（/project/live 登录后自动切换真实接口）" : "预览态 mock"}
                </Badge>
              )}
              {/*
                平台官方 skill（`skill-platform-*`）对任何组织只读——不是「读失败回退
                mock」，是「真的读到了，但这份来源不接受这个组织的写」。与上面
                `isLive` 的徽标是两件独立的事：前者说数据来自哪，这个说这份数据能不能改，
                两个问题各自答完才是这块区域该说的全部。
              */}
              {isLive && readOnly && (
                <Badge tone="outline" className="font-mono text-9" data-testid={`ag-${kind}-readonly`}>
                  平台官方 skill · 全组织只读
                </Badge>
              )}
              {liveError && (
                <span className="text-9 text-destructive" data-testid={`ag-${kind}-live-error`}>接口错误：{liveError}（已回退 mock）</span>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-[200px_1fr]">
              <Panel testid={`ag-${kind}-filepane`} className="h-fit">
                <FileTree files={tree} selected={sel} onSelect={setSel} testidPrefix={`ag-${kind}`} />
              </Panel>
              <div className="flex min-w-0 flex-col gap-2">
                <div className="flex items-center gap-1">
                  <Button size="xs" variant={tab === "edit" ? "primary" : "ghost"} onClick={() => setTab("edit")} data-testid={`ag-${kind}-tab-edit`}>编辑</Button>
                  <Button size="xs" variant={tab === "preview" ? "primary" : "ghost"} onClick={() => setTab("preview")} data-testid={`ag-${kind}-tab-preview`}>预览</Button>
                  <span className="ml-auto font-mono text-9 text-muted-foreground">{main.footer}</span>
                </div>
                {isLive ? (
                  fileBusy ? (
                    <Panel testid={`ag-${kind}-code-loading`}>
                      <p className="text-10 text-muted-foreground">读取中…</p>
                    </Panel>
                  ) : (
                    tab === "edit" ? (
                      /**
                       * #881：真实数据态下这里是**可编辑**的。此前是只读 `CodeView`，
                       * 配一个不接任何写路径的「保存并发布」按钮——按钮在说谎。
                       * #1884：原生 `<textarea>` 换成 Monaco（语法高亮 + 内联校验）——
                       * frontmatter 规则对 `skill`/`agent` 都定义了（`RootFrontmatterAssetKind`），
                       * 只要选中的文件是这次读到的目录自己的 `rootFile` 就接上；`agent` 今天
                       * 读到的仍是 `FixtureAssetFileRepository` 的固定内容（`#787` 未解决），
                       * 校验逻辑本身是真的，只是它验证的数据源还不是真实存储——与 `isLive`
                       * 徽标已经如实展示的「数据源」区分是两件事。
                       */
                      <AssetCodeEditor
                        testid={`ag-${kind}-code`}
                        path={sel}
                        value={draft}
                        onChange={setDraft}
                        // 平台官方 skill：编辑区本身也只读，不只是保存按钮禁用——
                        // 允许在 Monaco 里改字符、只在点保存那一刻才拒绝，会让用户以为
                        // 改动已经生效，直到保存才发现白改了。
                        readOnly={readOnly}
                        rootFrontmatterCheck={
                          liveDir ? { assetKind: kind, isRootFile: sel === liveDir.rootFile } : undefined
                        }
                        // #1971：全屏编辑页把省下来的 chrome 空间让给代码编辑器本体。
                        height={compact ? "62vh" : undefined}
                      />
                    ) : (
                      <CodeView body={draft} testid={`ag-${kind}-code`} />
                    )
                  )
                ) : sel === mockTree[0]!.path ? (
                  <CodeView body={main.body} testid={`ag-${kind}-code`} />
                ) : (
                  <Panel testid={`ag-${kind}-otherfile`}>
                    <p className="font-mono text-11 text-muted-foreground">{sel}</p>
                    <p className="mt-1 text-10 text-muted-foreground">
                      （原型态：仅根文件展示完整内容，其余文件在此以占位呈现，用于验证文件树导航与「目录即发布结构」的心智。）
                    </p>
                  </Panel>
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </Wrap>
  );
}

export function AgSkillEditor(p: ScreenProps & { assetId?: string; assetLabel?: string; compact?: boolean }) {
  return (
    <Editor
      kind="skill"
      state={p.state}
      view={p.view}
      assetId={p.assetId}
      assetLabel={p.assetLabel}
      compact={p.compact}
    />
  );
}
export function AgAgentEditor(p: ScreenProps) {
  return <Editor kind="agent" state={p.state} view={p.view} />;
}

/* ─────────────────────────── ⑥ 试跑台 ─────────────────────────── */

export function AgTryRun({ state, view }: ScreenProps) {
  const [scene, setScene] = React.useState("real");
  return (
    <Wrap view={view} what="试跑台" state={state} empty="还没有可试跑的 Agent——先在编辑器里建一个"
      invalid={{ input: "输入材料为空：真实场景至少要挂一份材料" }}
      dep={{ what: "评测服务不可用——「运行一次」与「跑全部用例」暂时不可点" }}>
      <div className="flex flex-col gap-4">
        <ScreenHead title="试跑 · Ava" uc="⑥ 试跑台"
          actions={<Badge tone="outline" className="font-mono">agent · ava</Badge>}>
          用当前未保存的提示词跑，不影响线上。
        </ScreenHead>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_1.1fr]">
          {/* 左：输入 */}
          <div className="flex flex-col gap-3">
            <Panel testid="ag-tryrun-scenarios" className="flex flex-col gap-2">
              <span className="text-11 font-medium text-background-foreground">测试场景</span>
              {AG_TRYRUN_SCENARIOS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setScene(s.id)}
                  data-testid="ag-tryrun-scenario"
                  className={cn(
                    "flex flex-col gap-0.5 rounded-md border px-2.5 py-1.5 text-left transition-colors",
                    scene === s.id ? "border-inverse bg-muted" : "border-border hover:bg-muted",
                  )}
                >
                  <span className="text-11 font-medium text-background-foreground">{s.label}</span>
                  <span className="text-9 text-muted-foreground">{s.desc}</span>
                </button>
              ))}
            </Panel>

            <Panel testid="ag-tryrun-input" className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-11 font-medium text-background-foreground">输入材料</span>
                <Button size="xs" variant="ghost" data-testid="ag-tryrun-swap">换一批材料</Button>
              </div>
              <p className="text-10 leading-relaxed text-muted-foreground">{AG_TRYRUN_INPUT}</p>
            </Panel>

            <Panel testid="ag-tryrun-params" className="flex flex-col gap-1.5">
              <span className="text-11 font-medium text-background-foreground">运行参数</span>
              {AG_TRYRUN_PARAMS.map((p) => (
                <div key={p.k} className="flex items-center justify-between text-10">
                  <span className="text-muted-foreground">{p.k}</span>
                  <span className="font-mono text-background-foreground">{p.v}</span>
                </div>
              ))}
              <div className="mt-1 flex items-center gap-1.5">
                <Button size="sm" variant="primary" data-testid="ag-tryrun-run">运行一次</Button>
                <Button size="sm" variant="outline" data-testid="ag-tryrun-runall">跑全部用例</Button>
              </div>
            </Panel>
          </div>

          {/* 右：运行结果 */}
          <div className="flex flex-col gap-3">
            <Panel testid="ag-tryrun-result" className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-11 font-medium text-background-foreground">运行结果</span>
                <span className="font-mono text-9 text-muted-foreground">{AG_TRYRUN_COST}</span>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-10 font-medium text-muted-foreground">执行轨迹</span>
                {AG_TRYRUN_TRACE.map((t, i) => (
                  <div key={i} className="flex items-start gap-2" data-testid="ag-tryrun-trace">
                    <Check aria-hidden className="mt-0.5 h-3 w-3 shrink-0 text-success" />
                    <div className="flex flex-col">
                      <span className="text-10 text-background-foreground">{t.label}</span>
                      <span className={cn("font-mono text-9", t.danger ? "text-destructive" : "text-muted-foreground")}>{t.meta}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-10 font-medium text-muted-foreground">输出</span>
                <CodeView body={AG_TRYRUN_OUTPUT} testid="ag-tryrun-output" />
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-10 font-medium text-muted-foreground">自动校验</span>
                {AG_TRYRUN_CHECKS.map((c, i) => (
                  <div key={i} className="flex items-center gap-2" data-testid="ag-tryrun-check">
                    <Badge tone="primary" className="font-mono text-9">PASS</Badge>
                    <span className="text-10 text-background-foreground">{c.label}</span>
                    <span className="ml-auto font-mono text-9 text-muted-foreground">{c.meta}</span>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel testid="ag-tryrun-pin" className="flex items-center justify-between gap-2">
              <span className="text-10 text-muted-foreground">{AG_TRYRUN_FOOTER}</span>
              <div className="flex items-center gap-1.5">
                <Button size="xs" variant="primary" data-testid="ag-tryrun-save">存为回归用例</Button>
                <Button size="xs" variant="ghost" data-testid="ag-tryrun-rerun">重跑</Button>
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </Wrap>
  );
}
