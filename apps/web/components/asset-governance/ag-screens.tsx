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

type ScreenProps = { state: UiState; view: AgView };

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
            <span className="text-12 font-medium text-foreground">本月组织额度</span>
            <span className="font-mono text-13 font-semibold text-foreground">{AG_ORG_QUOTA.pct}%</span>
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
              <p className="mt-1 text-20 font-semibold text-foreground">{t.v}</p>
              <p className="mt-0.5 text-9 text-muted-foreground">{t.sub}</p>
            </Panel>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-11 font-medium text-foreground">六种资产 · 一套公共治理机制</p>
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
            {AG_ASSET_NAV.map((a) => (
              <Panel key={a.kind} testid="ag-dashboard-asset">
                <div className="flex items-center gap-2">
                  <span className="grid h-6 w-6 place-items-center rounded-md bg-muted font-mono text-9 text-muted-foreground">{a.icon}</span>
                  <span className="text-12 font-medium text-foreground">{a.label}</span>
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
            <span className="text-13 font-medium text-foreground">{h.sectionTitle}</span>
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
                      <span className="truncate text-13 font-medium text-foreground">{b.title}</span>
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
                        <span className="font-medium text-foreground">影响范围：删除「{b.title}」</span>
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
            <Panel key={p.id} testid="ag-newskill-path" className={cn("flex flex-col gap-2", i === 1 && "border-foreground")}>
              <div className="flex items-center gap-2">
                {p.id === "import" && <Github aria-hidden className="h-4 w-4 text-muted-foreground" />}
                <span className="text-12 font-medium text-foreground">{p.label}</span>
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
          <span className="text-11 font-medium text-foreground">或从市场挑一个改</span>
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-3">
            {AG_MARKET_CARDS.map((m) => (
              <Panel key={m.id} testid="ag-newskill-market" className="flex flex-col gap-1.5">
                <span className="text-12 font-medium text-foreground">{m.name}</span>
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
                <span className="text-12 font-medium text-foreground">{g.name}</span>
                <span className="ml-auto"><VerdictBadge verdict={g.verdict} /></span>
              </div>
              <p className="text-11 leading-relaxed text-muted-foreground">{g.detail}</p>
            </Panel>
          ))}
        </div>

        {/* 第 04 关 · 查重分歧 */}
        <Panel testid="ag-gate-dedup" className="flex flex-col gap-3 border-destructive/30 bg-destructive/5">
          <span className="text-12 font-medium text-foreground">第 04 关 · 查重分歧，需要你判断</span>
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
            {[AG_DEDUP.existing, AG_DEDUP.incoming].map((c, i) => (
              <div key={i} className="flex flex-col gap-1 rounded-md border border-border bg-card p-2.5">
                <span className="text-11 font-medium text-foreground">{c.title}</span>
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
                      <span className="font-medium text-foreground">影响范围：放弃导入 Jobs-to-be-done</span>
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
          <span className="text-11 font-medium text-foreground">原文与改写对照 · {AG_REWRITE_DIFF.hint}</span>
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
                    <span className="font-medium text-foreground">发布方式：灰度</span>
                    <span>· {AG_RELEASE.note}</span>
                    <span>· 回退：灰度期内任一异常，一键撤回，不触达其余 43 人。</span>
                  </>
                }
              />
            </>
          }>
          这一步六种资产完全一样：<strong className="font-medium text-foreground">谁能用、出问题谁负责、什么时候重新检查</strong>。三个都填完才能发布。
        </ScreenHead>

        {/* 可见范围 */}
        <Panel testid="ag-gov-visibility" className="flex flex-col gap-2">
          <span className="text-11 font-medium text-foreground">可见范围</span>
          <div className="flex flex-col gap-1.5">
            {AG_VISIBILITY.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setVis(v.id)}
                data-testid="ag-gov-visibility-option"
                className={cn(
                  "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors",
                  vis === v.id ? "border-foreground bg-muted" : "border-border hover:bg-muted",
                )}
              >
                <span className={cn("grid h-3.5 w-3.5 place-items-center rounded-full border", vis === v.id ? "border-foreground" : "border-border")}>
                  {vis === v.id && <span className="h-1.5 w-1.5 rounded-full bg-foreground" />}
                </span>
                <span className="text-11 font-medium text-foreground">{v.label}</span>
                <span className="text-10 text-muted-foreground">{v.detail}</span>
                {v.needsCosign && vis === v.id && <Badge tone="warning" className="ml-auto">需联签</Badge>}
              </button>
            ))}
          </div>
        </Panel>

        {/* 谁能改它 */}
        <Panel testid="ag-gov-editors" className="flex flex-col gap-2">
          <span className="text-11 font-medium text-foreground">谁能改它</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {AG_EDITORS.map((e) => (
              <Badge key={e} tone={e.startsWith("＋") ? "outline" : "neutral"} className="font-normal">{e}</Badge>
            ))}
          </div>
        </Panel>

        {/* 责任与复核 */}
        <Panel testid="ag-gov-review" className="flex flex-col gap-2">
          <span className="text-11 font-medium text-foreground">责任与复核</span>
          <div className="flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-11 text-primary-foreground">{AG_OWNER.initial}</span>
            <span className="text-11 text-foreground">负责人 {AG_OWNER.name} · {AG_OWNER.team}</span>
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
            <span className="text-11 font-medium text-foreground">发布前检查</span>
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
  kind, state, view,
}: {
  kind: "skill" | "agent";
  state: UiState;
  view: AgView;
}) {
  const tree = kind === "skill" ? AG_SKILL_TREE : AG_AGENT_TREE;
  const main = kind === "skill" ? AG_SKILL_MAIN : AG_AGENT_MAIN;
  const [sel, setSel] = React.useState(tree[0]!.path);
  const [tab, setTab] = React.useState<"edit" | "preview">("edit");
  const label = kind === "skill" ? "Skill" : "Agent";
  const uc = kind === "skill" ? "④ Skill 编辑器" : "⑤ Agent 编辑器";
  return (
    <Wrap view={view} what={`${label} 编辑器`} state={state} empty={`这个 ${label} 目录还是空的`}
      invalid={{ frontmatter: "SKILL.md 的 frontmatter 缺 name/description——保存前必须补齐" }}
      dep={{ what: "试跑依赖的评测服务不可用——右上「试跑」暂时不可点" }}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2" data-testid={`ag-${kind}-editor-top`}>
          <div className="flex items-center gap-2">
            <Button size="xs" variant="ghost" data-testid={`ag-${kind}-back`}>‹ {label} 列表</Button>
            <span className="text-13 font-medium text-foreground">{main.name}</span>
            <Badge tone="outline" className="font-mono">{main.slug}</Badge>
            {"model" in main && <Badge tone="ai" className="font-mono">{(main as typeof AG_AGENT_MAIN).model}</Badge>}
            <span className="inline-flex items-center gap-1 text-9 text-warning">
              <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden /> 有未保存改动
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="xs" variant="outline" className="gap-1" data-testid={`ag-${kind}-tryrun`}>
              <Play aria-hidden className="h-3 w-3" /> 试跑
            </Button>
            <DangerConfirm
              testid={`ag-${kind}-publish`}
              trigger="保存并发布"
              danger={false}
              confirmLabel="确认发布新版本"
              impact={
                <>
                  <span className="font-medium text-foreground">影响范围：发布 {main.name} 新版本</span>
                  <span>· 已建实例锁定在旧版本、不因发新版漂移。</span>
                  <span>· 新绑定将使用新版本；发布需先过一次无阻断试跑。</span>
                </>
              }
            />
          </div>
        </div>

        <ScreenHead title={`${label} 编辑器`} uc={uc}>
          左侧文件树就是发布出去的目录结构；右侧编辑 {sel}。
        </ScreenHead>

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
            {sel === tree[0]!.path ? (
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
      </div>
    </Wrap>
  );
}

export function AgSkillEditor(p: ScreenProps) {
  return <Editor kind="skill" state={p.state} view={p.view} />;
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
              <span className="text-11 font-medium text-foreground">测试场景</span>
              {AG_TRYRUN_SCENARIOS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setScene(s.id)}
                  data-testid="ag-tryrun-scenario"
                  className={cn(
                    "flex flex-col gap-0.5 rounded-md border px-2.5 py-1.5 text-left transition-colors",
                    scene === s.id ? "border-foreground bg-muted" : "border-border hover:bg-muted",
                  )}
                >
                  <span className="text-11 font-medium text-foreground">{s.label}</span>
                  <span className="text-9 text-muted-foreground">{s.desc}</span>
                </button>
              ))}
            </Panel>

            <Panel testid="ag-tryrun-input" className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-11 font-medium text-foreground">输入材料</span>
                <Button size="xs" variant="ghost" data-testid="ag-tryrun-swap">换一批材料</Button>
              </div>
              <p className="text-10 leading-relaxed text-muted-foreground">{AG_TRYRUN_INPUT}</p>
            </Panel>

            <Panel testid="ag-tryrun-params" className="flex flex-col gap-1.5">
              <span className="text-11 font-medium text-foreground">运行参数</span>
              {AG_TRYRUN_PARAMS.map((p) => (
                <div key={p.k} className="flex items-center justify-between text-10">
                  <span className="text-muted-foreground">{p.k}</span>
                  <span className="font-mono text-foreground">{p.v}</span>
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
                <span className="text-11 font-medium text-foreground">运行结果</span>
                <span className="font-mono text-9 text-muted-foreground">{AG_TRYRUN_COST}</span>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-10 font-medium text-muted-foreground">执行轨迹</span>
                {AG_TRYRUN_TRACE.map((t, i) => (
                  <div key={i} className="flex items-start gap-2" data-testid="ag-tryrun-trace">
                    <Check aria-hidden className="mt-0.5 h-3 w-3 shrink-0 text-success" />
                    <div className="flex flex-col">
                      <span className="text-10 text-foreground">{t.label}</span>
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
                    <span className="text-10 text-foreground">{c.label}</span>
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
