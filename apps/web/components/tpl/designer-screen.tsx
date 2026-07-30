"use client";
import * as React from "react";
import { ArrowLeft, Check, Plus, Eye, Play, Rocket, Clock, Globe, Cpu, Gauge, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import type { ProjectRole } from "@/lib/identity";
import { cn } from "@/lib/utils";
import {
  CONFIG_ITEMS, CONFIG_GROUPS, configTotal, configDoneCount, blockingRequiredItems,
  DURATION_TIERS, TIER_LABEL, AGENDA_COUNT_BY_TIER, TIER_HALF_SESSIONS, DEFAULT_TIER,
  MEETING_FORMATS, MEETING_LANGS, ONLINE_EXTRA_SEGMENTS, MODEL_STRATEGY, QUOTA_POLICY,
  INIT_CATEGORIES, type ConfigItem, type DurationTier, type MeetingFormat,
} from "@/lib/mock/tpl";
import { ConfirmDialog, SignoffFlag } from "./parts";

const RULE = "蓝本管骨架与默认值，不管具体内容。套用后引导师可逐场覆盖，改动只影响那一场。";

export function DesignerScreen({
  uiState, previewRole, onToast,
}: { uiState: UiState; previewRole: ProjectRole | null; onToast: (m: string) => void }) {
  const [tier, setTier] = React.useState<DurationTier>(DEFAULT_TIER);
  const [format, setFormat] = React.useState<MeetingFormat>("hybrid");
  const [lang, setLang] = React.useState("bilingual");
  const [selKey, setSelKey] = React.useState<string>(CONFIG_ITEMS[0]!.key);
  const [confirmPublish, setConfirmPublish] = React.useState(false);

  const total = configTotal();
  const done = configDoneCount();
  const blocking = blockingRequiredItems();
  const trialRunDone = false; // 未试跑 —— 演示发布门槛
  const nextVersion = 5;
  const agendaCount = AGENDA_COUNT_BY_TIER[tier] + (format === "online" ? ONLINE_EXTRA_SEGMENTS.length : 0);
  const selected = CONFIG_ITEMS.find((i) => i.key === selKey)!;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 3.0 设计器外壳：顶部固定版本条 + 三动作按钮 */}
      <header className="flex flex-col gap-1.5 border-b border-border px-4 py-3" data-testid="tpl-designer-header">
        <div className="flex items-center gap-2">
          <Button size="icon" variant="ghost" aria-label="返回蓝本列表" data-testid="tpl-designer-back"><ArrowLeft aria-hidden className="h-4 w-4" /></Button>
          <h1 className="text-16 font-semibold">HMW 定题项目 · 蓝本设计</h1>
        </div>
        <p className="text-12 text-muted-foreground" data-testid="tpl-version-line">
          v4 已发布 · 用过 12 次 · <span className="text-background-foreground">改动生成 v{nextVersion}，已开过的项目锁在自己的版本上</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral" data-testid="tpl-autosave">草稿自动保存 · 14:52</Badge>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => onToast("以参与者（组员）可见性渲染当前草稿 —— 只读，不改草稿、不产生版本")} data-testid="tpl-preview-participant"><Eye aria-hidden className="h-3.5 w-3.5" /> 预览参与者视图</Button>
            <Button size="sm" variant="outline" onClick={() => onToast("已用当前草稿开一场试跑实例，标记「已试跑」（不计入用过 N 次）")} data-testid="tpl-trial-run"><Play aria-hidden className="h-3.5 w-3.5" /> 试跑一场</Button>
            <Button size="sm" variant="primary" onClick={() => setConfirmPublish(true)} data-testid="tpl-publish"><Rocket aria-hidden className="h-3.5 w-3.5" /> 发布 v{nextVersion}</Button>
          </div>
        </div>
        <p className="rounded-md bg-panel px-2.5 py-1.5 text-11 text-muted-foreground" data-testid="tpl-rule-sentence">{RULE}</p>
      </header>

      <StateShell
        state={uiState}
        className="flex min-h-0 flex-1"
        skeletonRows={8}
        emptyHint={`新建蓝本 · 0/${total} 已配。逐项填完即可预览、试跑、发布。`}
        errors={{
          publish: blocking.length
            ? `无法发布：还有 ${blocking.length} 个必填项未完成（${blocking.map((b) => b.label).join("、")}）。⚠ 「哪些必填」清单本身仍待人类给出（缺 D-2），此处为占位示例。`
            : "无法发布：本草稿尚未试跑。点「试跑一场」后才能发布。",
        }}
        depFailure={{ what: "模型清单（20-model）暂不可用：第 12 项 Agent 编排与模型策略只能从已启用模型中选，现无法读取可选模型。" }}
        denial={{ layer: "project", reason: "观察者不能编辑蓝本，也看不到未发布草稿；只能只读查看已发布且脱敏的版本。" }}
        successMessage={`已发布 v${nextVersion}，旧版 v4 归档（已开过的项目仍锁在 v4）`}
      >
        {/* 左：五组配置目录 + 完成度侧栏；右：当前项面板 + 档位/形式语言/模型/配额/初始化一览 */}
        <div className="flex min-h-0 w-full flex-col lg:flex-row">
          <ConfigDirectory total={total} done={done} blocking={blocking} selKey={selKey} onSelect={setSelKey} />
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <CurrentPanel item={selected} />
            <DurationSection tier={tier} onTier={setTier} agendaCount={agendaCount} format={format} />
            <FormatLangSection format={format} onFormat={setFormat} lang={lang} onLang={setLang} agendaCount={agendaCount} tierBase={AGENDA_COUNT_BY_TIER[tier]} />
            <ModelSection />
            <QuotaSection />
            <InitPreview />
          </div>
        </div>
      </StateShell>

      <ConfirmDialog
        open={confirmPublish}
        title={`发布 v${nextVersion}？`}
        tone="primary"
        confirmLabel={`确认发布 v${nextVersion}`}
        onConfirm={() => { setConfirmPublish(false); onToast(`已发布 v${nextVersion}；旧版 v4 自动归档；已开过的项目仍锁在 v4`); }}
        onClose={() => setConfirmPublish(false)}
        impact={
          <div className="flex flex-col gap-1.5">
            <p>发布将校验两道门槛（缺一不可）：</p>
            <p className={cn("flex items-center gap-1.5", blocking.length ? "text-destructive" : "text-success")}>
              {blocking.length ? "✗" : "✓"} 必填项已完成
              {blocking.length ? `（还差 ${blocking.length}：${blocking.map((b) => b.label).join("、")}）` : ""}
            </p>
            <p className={cn("flex items-center gap-1.5", trialRunDone ? "text-success" : "text-destructive")}>
              {trialRunDone ? "✓" : "✗"} 已试跑一场{trialRunDone ? "" : "（未试跑 —— 请先点「试跑一场」）"}
            </p>
            <p className="text-muted-foreground">通过后生成 v{nextVersion}、旧版 v4 归档；<b>已开过的项目仍锁在自己的版本上</b>，不受影响。</p>
            <SignoffFlag kind="backlog-conflict" title="「必填项完成才能发布」与运行态原型冲突（缺 D-9）">
              原型里 15/16、12/16、9/16 的蓝本均为「已发布」，即原型允许未配满即发布。O-18⑤ 的和解是「那些缺项 required=false」，需人类确认成立。
            </SignoffFlag>
          </div>
        }
      />
    </div>
  );
}

/* ── 五组配置目录 + 完成度 ────────────────────────────────────────────── */

function ConfigDirectory({
  total, done, blocking, selKey, onSelect,
}: {
  total: number; done: number; blocking: ConfigItem[]; selKey: string; onSelect: (k: string) => void;
}) {
  const firstBlocking = blocking[0]?.key;
  return (
    <aside className="shrink-0 overflow-y-auto border-b border-border p-3 lg:w-64 lg:border-b-0 lg:border-r" data-testid="tpl-config-directory">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-12 font-semibold">设计配置</span>
        {/* 完成度：分母恒读表（禁止硬编码 16/15），可点直达第一个未完成必填项 */}
        <button
          type="button"
          className="rounded-sm text-11 font-medium text-muted-foreground transition-colors hover:text-background-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => firstBlocking && onSelect(firstBlocking)}
          data-testid="tpl-completion"
        >
          {done}/{total}
        </button>
      </div>
      <Progress value={done} max={total} label={`完成度 ${done}/${total}`} className="mb-3" />
      {CONFIG_GROUPS.map((g) => {
        const items = CONFIG_ITEMS.filter((i) => i.group === g.key);
        const groupDone = items.every((i) => i.done);
        return (
          <div key={g.key} className="mb-3">
            <div className="mb-1 flex items-center gap-1 px-1 text-11 font-medium text-muted-foreground" data-testid="tpl-config-group">
              {g.label}{groupDone && <Check aria-hidden className="h-3 w-3 text-success" />}
            </div>
            <ul className="flex flex-col gap-0.5">
              {items.map((i) => (
                <li key={i.key}>
                  <button
                    type="button"
                    onClick={() => onSelect(i.key)}
                    data-testid="tpl-config-item"
                    className={cn(
                      "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-12 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      i.key === selKey ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                    )}
                  >
                    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", i.done ? "bg-success" : "bg-muted-foreground/40")} />
                    <span className="flex-1 truncate">{i.label}</span>
                    {i.required && <Badge tone="outline" data-testid="tpl-required-tag">必填</Badge>}
                    <span className="text-10 text-muted-foreground">{i.count}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <SignoffFlag kind="unexplored" title="第 16 项 + 各配置项的面板内部" testid="tpl-flag-16th">
        原型面板标题写 16、实际枚举 15。第 16 项属「未探明」（不阻断，分母恒读表）。各项打开后的编辑器属二级 sign-off，未探明，未画。
      </SignoffFlag>
    </aside>
  );
}

function CurrentPanel({ item }: { item: ConfigItem }) {
  return (
    <section className="mb-4 rounded-lg border border-border p-4" data-testid="tpl-current-panel">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-14 font-semibold">{item.label}</h2>
        {item.required && <Badge tone="outline">必填</Badge>}
        <Badge tone={item.done ? "primary" : "neutral"} className="ml-auto">{item.done ? "已配" : "未配"} · {item.count}</Badge>
      </div>
      <SignoffFlag kind="unexplored" title="此项打开后的具体编辑器 —— 二级 sign-off，未探明">
        本域只负责目录、完成度、进入入口与保存契约；「{item.label}」的面板内部交互在原型中未探明，补抽取后再签。这里只放占位。
      </SignoffFlag>
    </section>
  );
}

/* ── 时长档位 ─────────────────────────────────────────────────────────── */

function DurationSection({
  tier, onTier, agendaCount, format,
}: { tier: DurationTier; onTier: (t: DurationTier) => void; agendaCount: number; format: MeetingFormat }) {
  return (
    <Section icon={Clock} title="时长档位" testid="tpl-duration-section">
      <div className="flex flex-wrap items-center gap-2">
        {DURATION_TIERS.map((t) => (
          <Button key={t} size="sm" variant={t === tier ? "primary" : "outline"} onClick={() => onTier(t)} data-testid="tpl-tier">
            {TIER_LABEL[t]}{t === "two-day" ? "（默认）" : ""} · {AGENDA_COUNT_BY_TIER[t]} 环节
          </Button>
        ))}
        <Button size="sm" variant="ghost" data-testid="tpl-tier-add"><Plus aria-hidden className="h-3.5 w-3.5" /> 档位</Button>
      </div>
      <p className="mt-2 text-12" data-testid="tpl-agenda-count">
        当前档位 <b>{TIER_LABEL[tier]}</b>（{TIER_HALF_SESSIONS[tier]}）→ 议程环节 <b>{agendaCount}</b> 个
        {format === "online" && <span className="text-muted-foreground">（含全线上自动加的 {ONLINE_EXTRA_SEGMENTS.join("、")}）</span>}
        。第 2 项「流程 Agenda」计数与此相等。
      </p>
      <p className="mt-1 text-11 leading-relaxed text-muted-foreground">
        档位以半场（半天）为单位。一个半场约 3–3.5 小时、3–4 个环节，这是人能保持专注的上限；跨半场的休息与交接是流程的一部分，不是空隙——多天项目的成败通常取决于「隔夜之后怎么接上」。
      </p>
      <SignoffFlag kind="backlog-conflict" title="换档位「可选自动增删 / 必留只压缩时间」是 Backlog 口径（缺 D-8）">
        原型只说「环节表随之变化」，没有可选/必留之分，也没有压缩时间；回滚语义为纯反推。此处换档位仅重算数字，未演示增删动画与撤销。
      </SignoffFlag>
    </Section>
  );
}

/* ── 形式与语言 ───────────────────────────────────────────────────────── */

function FormatLangSection({
  format, onFormat, lang, onLang, agendaCount, tierBase,
}: {
  format: MeetingFormat; onFormat: (f: MeetingFormat) => void;
  lang: string; onLang: (l: string) => void; agendaCount: number; tierBase: number;
}) {
  return (
    <Section icon={Globe} title="形式与语言" testid="tpl-format-section">
      <div className="flex flex-col gap-1.5">
        <span className="text-11 font-medium text-muted-foreground">默认形式</span>
        <div className="flex flex-wrap gap-2">
          {MEETING_FORMATS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => onFormat(f.key)}
              data-testid="tpl-format"
              className={cn(
                "flex flex-col items-start gap-0.5 rounded-md border px-2.5 py-1.5 text-left transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                f.key === format ? "border-primary bg-accent" : "border-border hover:bg-muted",
              )}
            >
              <span className="text-12 font-medium">{f.label}</span>
              <span className="text-10 text-muted-foreground">{f.note}</span>
            </button>
          ))}
        </div>
        {format === "online" && (
          <p className="text-11 text-warning-foreground" data-testid="tpl-online-added">
            已自动向议程环节表追加「{ONLINE_EXTRA_SEGMENTS.join("」「")}」两个环节（来源：形式设置 · 可移除）；{tierBase} → {agendaCount}。切回混合/线下会对称移除。
          </p>
        )}
      </div>
      <div className="mt-3 flex flex-col gap-1.5">
        <span className="text-11 font-medium text-muted-foreground">语言（影响产出与报告模板生成语言）</span>
        <div className="flex flex-wrap gap-2">
          {MEETING_LANGS.map((l) => (
            <Button key={l.key} size="sm" variant={l.key === lang ? "primary" : "outline"} onClick={() => onLang(l.key)} data-testid="tpl-lang">
              {l.label}{l.note ? ` · ${l.note}` : ""}
            </Button>
          ))}
        </div>
      </div>
    </Section>
  );
}

/* ── 模型策略 ─────────────────────────────────────────────────────────── */

function ModelSection() {
  return (
    <Section icon={Cpu} title="模型策略（三条按场景分派，非全局单选）" testid="tpl-model-section">
      <div className="grid gap-2 sm:grid-cols-3">
        {MODEL_STRATEGY.map((m) => (
          <div key={m.lane} className={cn("flex flex-col gap-1 rounded-md border p-2.5", m.hardRoute ? "border-warning/40 bg-warning/5" : "border-border")} data-testid="tpl-model-lane">
            <span className="text-12 font-medium">{m.label}</span>
            <span className="text-13 font-semibold">{m.model}</span>
            <span className="text-10 text-muted-foreground">{m.note}</span>
            {m.hardRoute && <Badge tone="warning" className="mt-0.5 w-fit">配额降级也不切</Badge>}
          </div>
        ))}
      </div>
    </Section>
  );
}

function QuotaSection() {
  const budgetM = (QUOTA_POLICY.perSessionTokenBudget / 1_000_000).toFixed(1);
  return (
    <Section icon={Gauge} title="配额与降级" testid="tpl-quota-section">
      <p className="text-12" data-testid="tpl-quota-line">
        单场预算 <b>{budgetM}M token</b>，达 <b>{QUOTA_POLICY.downgradeAtRatio * 100}%</b> 自动降级到便宜模型并在对话里提示，<b>不硬停</b>。
      </p>
      <p className="mt-1 text-11 italic text-muted-foreground">「{QUOTA_POLICY.rationale}」</p>
      <SignoffFlag kind="note" title="3.5M / 90% 是否项目级可覆盖、与三级阈值如何取舍 —— 缺 D-3">
        proto-03 有组织 90% / 成员 85% / Agent 三级阈值（「最先触发的一条生效」），与单场预算的取舍未确认。
      </SignoffFlag>
    </Section>
  );
}

/* ── 套用后会初始化什么（六类一览）──────────────────────────────────────── */

function InitPreview() {
  return (
    <Section icon={ChevronRight} title="套用后会初始化什么（六类 · 随配置实时变化）" testid="tpl-init-preview">
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {INIT_CATEGORIES.map((c) => (
          <li key={c.key} className="flex flex-col gap-0.5 p-2.5" data-testid="tpl-init-category">
            <div className="flex items-center gap-2">
              <Badge tone="primary">{c.label}</Badge>
              <span className="text-10 text-muted-foreground">→ {c.lands}</span>
            </div>
            <p className="text-11 text-muted-foreground">{c.writes}</p>
          </li>
        ))}
      </ul>
      <p className="mt-2 rounded-md bg-panel px-2.5 py-1.5 text-11 text-muted-foreground" data-testid="tpl-init-footnote">
        写入的是默认值。引导师在那一场里改，不会回写蓝本；要沉淀就在复盘里「提交回蓝本」。
      </p>
    </Section>
  );
}

/* ── 小节容器 ─────────────────────────────────────────────────────────── */

function Section({
  icon: Icon, title, testid, children,
}: { icon: typeof Clock; title: string; testid: string; children: React.ReactNode }) {
  return (
    <section className="mb-4 rounded-lg border border-border p-4" data-testid={testid}>
      <h3 className="mb-2 flex items-center gap-1.5 text-13 font-semibold">
        <Icon aria-hidden className="h-3.5 w-3.5 text-muted-foreground" /> {title}
      </h3>
      {children}
    </section>
  );
}
