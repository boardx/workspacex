"use client";
import { localizeBlueprintCopy } from "@/lib/i18n/blueprint-copy";

import { useI18n } from "@/lib/i18n/provider";

import * as React from "react";
import {
  Clock, Globe, Cpu, Gauge, ChevronRight, Plus, GripVertical, Sparkles,
  Check, X, Lock, AlertTriangle, QrCode, Printer, Users, FileText, Mic,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { DurationTierView, MeetingFormat, ConfigItem } from "@/lib/mock/tpl";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import {
  DURATION_TIERS, TIER_LABEL, AGENDA_COUNT_BY_TIER, TIER_HALF_SESSIONS,
  MEETING_FORMATS, MEETING_LANGS, ONLINE_EXTRA_SEGMENTS, MODEL_STRATEGY, QUOTA_POLICY,
  INIT_CATEGORIES, TOPIC_PANEL, AGENDA_PANEL, GROUPING_PANEL, ROLES_PANEL, SURVEY_PANEL,
  INTERVIEW_PLAN_PANEL, HOMEWORK_PANEL, VENUE_PANEL, MATERIALS_PANEL, PRINT_PANEL,
  CAPS_PANEL, AGENT_PANEL, SKILL_PANEL, OUTPUTS_PANEL, REPORT_PANEL,
} from "@/lib/mock/tpl";

/* ══════════════════════════════════════════════════════════════════════════
 * 16 个配置面板的渲染器 —— 保真度重做（PROTOTYPE-FIDELITY-AUDIT-2「重做」）。
 * v1 只画了 1 个（基本配置）、其余 15 个标「未探明」占位。本文件把 16 个全部落成真实组件。
 * 内容全部逐字来自原型（偏移见 lib/mock/tpl.ts 各 *_PANEL 常量注释）。
 * ══════════════════════════════════════════════════════════════════════════ */

/* ── 小节容器与行原语 ─────────────────────────────────────────────────── */
function Section({
  icon: Icon, title, testid, aside, children,
}: { icon?: React.ElementType; title: string; testid: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-4 rounded-lg border border-border p-4" data-testid={testid}>
      <div className="mb-2 flex items-center gap-1.5">
        {Icon && <Icon aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />}
        <h3 className="text-13 font-semibold">{title}</h3>
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

function Intro({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 rounded-md bg-panel px-2.5 py-1.5 text-12 leading-relaxed text-muted-foreground" data-testid="tpl-panel-intro">{children}</p>;
}

function PanelHeader({ item }: { item: ConfigItem }) {
 const { t: blueprintI18n } = useI18n();

  return (
    <div className="mb-3 flex items-center gap-2" data-testid="tpl-panel-header">
      <h2 className="text-16 font-semibold">{localizeBlueprintCopy(blueprintI18n, item.label)}</h2>
      {item.required && <Badge tone="outline">{blueprintI18n("blueprintFlow.requiredLabel")}</Badge>}
      <Badge tone={item.done ? "primary" : "neutral"} className="ml-auto">{item.done ? blueprintI18n("blueprintFlow.configured") : blueprintI18n("blueprintFlow.notConfigured")}{item.count ? ` · ${item.count}` : ""}</Badge>
    </div>
  );
}

function AiNote({ tag = "AI", children }: { tag?: string; children: React.ReactNode }) {
  return (
    <div className="mt-2 flex gap-2 rounded-md border border-ai/20 bg-ai-tint/40 p-2.5" data-testid="tpl-ai-note">
      <Sparkles aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ai-tint-foreground" />
      <div className="text-11 leading-relaxed">
        <Badge tone="ai" className="mr-1">{tag}</Badge>{children}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * 面板 1 · 基本配置（总览）—— 档位 / 形式语言 / 模型 / 配额 / 六类初始化一览
 * ══════════════════════════════════════════════════════════════════════════ */
export function BasicOverviewPanel({ item }: { item: ConfigItem }) {
 const { t: blueprintI18n } = useI18n();

  const [tier, setTier] = React.useState<DurationTierView>("two-day");
  const [format, setFormat] = React.useState<MeetingFormat>("hybrid");
  const [lang, setLang] = React.useState("bilingual");
  const agendaCount = AGENDA_COUNT_BY_TIER[tier] + (format === "online" ? ONLINE_EXTRA_SEGMENTS.length : 0);
  return (
    <>
      <PanelHeader item={item} />
      <Intro>{blueprintI18n("blueprintFlow.definesWhenThisBlueprintCanBeAppliedDurationTierIs")}<b className="text-background-foreground">{blueprintI18n("blueprintFlow.optionalSegmentsAreAddedOrRemovedAutomaticallyRequiredSegmentsOnly2")}</b>。</Intro>

      <Section icon={Clock} title={blueprintI18n("blueprintFlow.durationTier")} testid="tpl-duration-section"
        aside={<Badge tone="neutral">{blueprintI18n("blueprintFlow.chooseATierBeforeApplyingTheSegmentTableUpdatesAccordingly")}</Badge>}>
        <div className="grid gap-2 sm:grid-cols-2">
          {DURATION_TIERS.map((t) => (
            <button key={t} type="button" onClick={() => setTier(t)} data-testid="tpl-tier"
              className={cn("flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left transition-colors duration-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                t === tier ? "border-primary bg-accent" : "border-border hover:bg-muted")}>
              <span className="text-12 font-medium">{localizeBlueprintCopy(blueprintI18n, TIER_LABEL[t])}{t === "two-day" ? blueprintI18n("blueprintFlow.default") : ""} · {localizeBlueprintCopy(blueprintI18n, TIER_HALF_SESSIONS[t])} · {AGENDA_COUNT_BY_TIER[t]}{blueprintI18n("blueprintFlow.segment2")}</span>
              <span className="text-10 text-muted-foreground">{localizeBlueprintCopy(blueprintI18n, TIER_NOTE[t])}</span>
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Button size="xs" variant="ghost" data-testid="tpl-tier-add"><Plus aria-hidden className="h-3.5 w-3.5" />{blueprintI18n("blueprintFlow.tier")}</Button>
          <span className="text-11" data-testid="tpl-agenda-count">{blueprintI18n("blueprintFlow.currentLabel")}<b>{localizeBlueprintCopy(blueprintI18n, TIER_LABEL[tier])}</b>{blueprintI18n("blueprintFlow.agendaSegments")}<b>{agendaCount}</b>{blueprintI18n("blueprintFlow.items6")}{format === "online" && <span className="text-muted-foreground">{blueprintI18n("blueprintFlow.including")}{ONLINE_EXTRA_SEGMENTS.map((title) => localizeBlueprintCopy(blueprintI18n, title)).join("、")}）</span>}</span>
        </div>
        <p className="mt-2 text-11 leading-relaxed text-muted-foreground">{blueprintI18n("blueprintFlow.tiersUseHalfDaySessionsEachLastsAbout33")}</p>
      </Section>

      <Section icon={Globe} title={blueprintI18n("blueprintFlow.formatAndLanguage")} testid="tpl-format-section">
        <span className="mb-1 block text-11 font-medium text-muted-foreground">{blueprintI18n("blueprintFlow.defaultFormat")}</span>
        <div className="flex flex-wrap gap-2">
          {MEETING_FORMATS.map((f) => (
            <button key={f.key} type="button" onClick={() => setFormat(f.key)} data-testid="tpl-format"
              className={cn("flex flex-col items-start gap-0.5 rounded-md border px-2.5 py-1.5 text-left transition-colors duration-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                f.key === format ? "border-primary bg-accent" : "border-border hover:bg-muted")}>
              <span className="text-12 font-medium">{localizeBlueprintCopy(blueprintI18n, f.label)}</span>
              <span className="text-10 text-muted-foreground">{localizeBlueprintCopy(blueprintI18n, f.note)}</span>
            </button>
          ))}
        </div>
        {format === "online" && (
          <p className="mt-1.5 text-11 text-warning-foreground" data-testid="tpl-online-added">{blueprintI18n("blueprintFlow.automaticallyAdded")}{ONLINE_EXTRA_SEGMENTS.join("」「")}{blueprintI18n("blueprintFlow.toTheAgendaPrintMaterialsAreSkippedSwitchingBackTo")}</p>
        )}
        <span className="mb-1 mt-3 block text-11 font-medium text-muted-foreground">{blueprintI18n("blueprintFlow.languageControlsGeneratedDeliverablesAndReportTemplates")}</span>
        <div className="flex flex-wrap gap-2">
          {MEETING_LANGS.map((l) => (
            <Button key={l.key} size="sm" variant={l.key === lang ? "primary" : "outline"} onClick={() => setLang(l.key)} data-testid="tpl-lang">
              {localizeBlueprintCopy(blueprintI18n, l.label)}{l.note ? ` · ${localizeBlueprintCopy(blueprintI18n, l.note)}` : ""}
            </Button>
          ))}
        </div>
      </Section>

      <Section icon={Cpu} title={blueprintI18n("blueprintFlow.modelPolicyThreeScenarioBasedRoutesNotOneGlobalChoice")} testid="tpl-model-section">
        <div className="grid gap-2 sm:grid-cols-3">
          {MODEL_STRATEGY.map((m) => (
            <div key={m.lane} className={cn("flex flex-col gap-1 rounded-md border p-2.5", m.hardRoute ? "border-warning/40 bg-warning/5" : "border-border")} data-testid="tpl-model-lane">
              <span className="text-12 font-medium">{localizeBlueprintCopy(blueprintI18n, m.label)}</span>
              <span className="text-13 font-semibold">{m.model}</span>
              <span className="text-10 text-muted-foreground">{localizeBlueprintCopy(blueprintI18n, m.note)}</span>
              {m.hardRoute && <Badge tone="warning" className="mt-0.5 w-fit">{blueprintI18n("blueprintFlow.doNotSwitchEvenWhenQuotaIsDowngraded")}</Badge>}
            </div>
          ))}
        </div>
      </Section>

      <Section icon={Gauge} title={blueprintI18n("blueprintFlow.quotaAndFallback")} testid="tpl-quota-section">
        <p className="text-12" data-testid="tpl-quota-line">{blueprintI18n("blueprintFlow.budgetPerSession")}<b>{(QUOTA_POLICY.perSessionTokenBudget / 1_000_000).toFixed(1)}M token</b>{blueprintI18n("blueprintFlow.at")}<b>{QUOTA_POLICY.downgradeAtRatio * 100}%</b>{blueprintI18n("blueprintFlow.automaticallySwitchToACheaperModelAndNotifyInThe")}<b>{blueprintI18n("blueprintFlow.doNotStopTheSession")}</b>。
        </p>
        <p className="mt-1 text-11 italic text-muted-foreground">「{QUOTA_POLICY.rationale}」</p>
      </Section>

      <Section icon={ChevronRight} title={blueprintI18n("blueprintFlow.whatApplyingInitializesSixTypesUpdatesWithSettings")} testid="tpl-init-preview">
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {INIT_CATEGORIES.map((c) => (
            <li key={c.key} className="flex flex-col gap-0.5 p-2.5" data-testid="tpl-init-category">
              <div className="flex items-center gap-2">
                <Badge tone="primary">{localizeBlueprintCopy(blueprintI18n, c.label)}</Badge>
                <span className="text-10 text-muted-foreground">→ {localizeBlueprintCopy(blueprintI18n, c.lands)}</span>
              </div>
              <p className="text-11 text-muted-foreground">{localizeBlueprintCopy(blueprintI18n, c.writes)}</p>
            </li>
          ))}
        </ul>
        <p className="mt-2 rounded-md bg-panel px-2.5 py-1.5 text-11 text-muted-foreground" data-testid="tpl-init-footnote">{blueprintI18n("blueprintFlow.theseAreDefaultsFacilitatorChangesInAProjectDoNot")}</p>
      </Section>
    </>
  );
}
const TIER_NOTE: Record<DurationTierView, string> = {
  "half-day": "只到收敛，不做原型", "one-day": "加商业模式草稿", "two-day": "加原型与用户测试", "three-day": "加迭代与落地计划",
};

/* ── 面板 2 · 主题与背景 ──────────────────────────────────────────────── */
export function TopicPanel({ item }: { item: ConfigItem }) {
 const { t: blueprintI18n } = useI18n();

  return (
    <>
      <PanelHeader item={item} />
      <Intro>{localizeBlueprintCopy(blueprintI18n, TOPIC_PANEL.intro)}</Intro>
      <Section title={localizeBlueprintCopy(blueprintI18n, TOPIC_PANEL.topicPattern.label)} testid="tpl-topic-pattern">
        <div className="rounded-md border border-border bg-panel p-3">
          <p className="text-13 font-medium" data-testid="tpl-topic-template">{TOPIC_PANEL.topicPattern.template}</p>
          <p className="mt-1 text-11 text-muted-foreground">{TOPIC_PANEL.topicPattern.note}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {TOPIC_PANEL.topicPattern.rules.map((r) => <Badge key={r} tone="outline" data-testid="tpl-topic-rule">{r}</Badge>)}
          </div>
        </div>
      </Section>
      <Section title={blueprintI18n("blueprintFlow.backgroundDetailsMissingItemsPromptTheFacilitator")} testid="tpl-topic-bg">
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {TOPIC_PANEL.backgroundFields.map((f) => (
            <li key={f.key} className="flex items-center gap-2 p-2.5" data-testid="tpl-topic-field">
              <span className="w-24 shrink-0 text-12 font-medium">{localizeBlueprintCopy(blueprintI18n, f.label)}</span>
              <span className="flex-1 text-11 text-muted-foreground">{localizeBlueprintCopy(blueprintI18n, f.hint)}</span>
              <Badge tone="neutral">{localizeBlueprintCopy(blueprintI18n, f.source)}</Badge>
            </li>
          ))}
        </ul>
      </Section>
      <Section title={blueprintI18n("blueprintFlow.generationAndValidation")} testid="tpl-topic-gen">
        <ul className="flex flex-col gap-1.5">
          {TOPIC_PANEL.genRules.map((r) => (
            <li key={r} className="flex items-start gap-2 text-12" data-testid="tpl-topic-genrule"><Sparkles aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ai-tint-foreground" />{r}</li>
          ))}
        </ul>
      </Section>
    </>
  );
}

/* ── 面板 3 · 流程 Agenda ─────────────────────────────────────────────── */
export function AgendaPanel({ item }: { item: ConfigItem }) {
 const { t: blueprintI18n } = useI18n();

  const total = AGENDA_PANEL.segments.reduce((a, s) => a + s.min, 0);
  return (
    <>
      <PanelHeader item={item} />
      <Intro>{localizeBlueprintCopy(blueprintI18n, AGENDA_PANEL.intro)}</Intro>
      <Section title={blueprintI18n("blueprintFlow.totalSegmentsValue1Value2Minutes", { value1: String(AGENDA_PANEL.segments.length), value2: String(total) })} testid="tpl-agenda-list"
        aside={<Badge tone="neutral">{AGENDA_PANEL.dragHint}</Badge>}>
        <ul className="flex flex-col gap-1.5">
          {AGENDA_PANEL.segments.map((s) => (
            <li key={s.no} className="flex items-center gap-2 rounded-md border border-border p-2.5" data-testid="tpl-agenda-seg">
              <GripVertical aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="w-6 shrink-0 text-11 font-mono text-muted-foreground">{s.no}</span>
              <span className="flex-1 text-12 font-medium">{s.title}</span>
              {s.optional ? <Badge tone="outline">{blueprintI18n("blueprintFlow.optional")}</Badge> : <Badge tone="primary">{blueprintI18n("blueprintFlow.required2")}</Badge>}
              <Badge tone="neutral">{s.min}m</Badge>
              <span className="hidden text-10 text-muted-foreground sm:inline">{blueprintI18n("blueprintFlow.bind")}{s.boardSkill}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {AGENDA_PANEL.actions.map((a) => <Button key={a} size="xs" variant="ghost" data-testid="tpl-agenda-action">{a}</Button>)}
        </div>
        <AiNote tag={AGENDA_PANEL.aiRhythm.tag}>{AGENDA_PANEL.aiRhythm.body} <Button size="xs" variant="outline" className="ml-1" data-testid="tpl-agenda-adopt">{blueprintI18n("blueprintFlow.acceptSuggestion")}</Button></AiNote>
      </Section>
    </>
  );
}

/* ── 面板 4 · 分组规则 ────────────────────────────────────────────────── */
export function GroupingPanel({ item }: { item: ConfigItem }) {
 const { t: blueprintI18n } = useI18n();

  return (
    <>
      <PanelHeader item={item} />
      <Intro>{localizeBlueprintCopy(blueprintI18n, GROUPING_PANEL.intro)}</Intro>
      <Section icon={Users} title={blueprintI18n("blueprintFlow.automaticallyCalculateGroupCountFromParticipantCount")} testid="tpl-grouping-sizing">
        <div className="grid gap-2 sm:grid-cols-3">
          {GROUPING_PANEL.sizingRules.map((r) => (
            <div key={r.range} className="rounded-md border border-border p-2.5" data-testid="tpl-grouping-size">
              <p className="text-12 font-medium">{localizeBlueprintCopy(blueprintI18n, r.range)}</p>
              <p className="text-11 text-muted-foreground">{localizeBlueprintCopy(blueprintI18n, r.groups)} · {localizeBlueprintCopy(blueprintI18n, r.per)}</p>
            </div>
          ))}
        </div>
        <p className="mt-1.5 text-11 text-muted-foreground">{localizeBlueprintCopy(blueprintI18n, GROUPING_PANEL.sizingNote)}</p>
      </Section>
      <Section title={blueprintI18n("blueprintFlow.scenariosOnePerGroupEditableWhenApplying")} testid="tpl-grouping-scenarios"
        aside={<Badge tone="primary">{blueprintI18n("blueprintFlow.theMostValuablePart")}</Badge>}>
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {GROUPING_PANEL.scenarios.map((s, i) => (
            <li key={s.name} className="flex items-center gap-2 p-2.5" data-testid="tpl-grouping-scenario">
              <Badge tone="neutral">{blueprintI18n("blueprintFlow.groupNumber", { number: String(i + 1) })}</Badge>
              <div className="flex-1">
                <p className="text-12 font-medium">{s.name}</p>
                <p className="text-11 text-muted-foreground">{blueprintI18n("blueprintFlow.thisGroupMustAnswer")}{s.ask}</p>
              </div>
              <Badge tone="outline">{blueprintI18n("blueprintFlow.groupLeadProfile")}{s.leadProfile}</Badge>
            </li>
          ))}
        </ul>
        <Button size="xs" variant="ghost" className="mt-2" data-testid="tpl-grouping-add"><Plus aria-hidden className="h-3.5 w-3.5" />{blueprintI18n("blueprintFlow.scenario")}</Button>
      </Section>
      <Section title={blueprintI18n("blueprintFlow.assignGroupLeadsAndMembersAIProposesAnInitialAllocation")} testid="tpl-grouping-assign">
        <ul className="flex flex-col gap-1.5">
          {GROUPING_PANEL.assignRules.map((r) => <li key={r} className="flex items-start gap-2 text-12 text-muted-foreground" data-testid="tpl-grouping-rule"><Check aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />{r}</li>)}
        </ul>
      </Section>
    </>
  );
}

/* ── 面板 5 · 角色与权限（权限矩阵 + 灰色硬约束）────────────────────────── */
export function RolesPanel({ item }: { item: ConfigItem }) {
 const { t: blueprintI18n } = useI18n();

  return (
    <>
      <PanelHeader item={item} />
      <Intro>{localizeBlueprintCopy(blueprintI18n, ROLES_PANEL.intro)}</Intro>
      <Section title={blueprintI18n("blueprintFlow.groupingMethod")} testid="tpl-roles-mode">
        <div className="flex flex-wrap items-center gap-2">
          {ROLES_PANEL.groupingMode.options.map((o, i) => <Button key={o} size="sm" variant={i === 0 ? "primary" : "outline"} data-testid="tpl-roles-modeopt">{localizeBlueprintCopy(blueprintI18n, o)}</Button>)}
          <Badge tone="neutral">{localizeBlueprintCopy(blueprintI18n, ROLES_PANEL.groupingMode.perGroup)}</Badge>
        </div>
        <p className="mt-1.5 text-11 text-muted-foreground">{localizeBlueprintCopy(blueprintI18n, ROLES_PANEL.groupingMode.note)}</p>
        <p className="mt-1 text-11 text-muted-foreground">{blueprintI18n("blueprintFlow.groupLeadsSelectedBy")}{ROLES_PANEL.leadFrom.map((label) => localizeBlueprintCopy(blueprintI18n, label)).join(" / ")}</p>
      </Section>
      <Section title={blueprintI18n("blueprintFlow.defaultRolePermissions")} testid="tpl-roles-matrix">
        <div className="overflow-x-auto">
          <Table className="w-full border-collapse text-12" data-testid="tpl-roles-perm-table">
            <TableHeader>
              <TableRow className="border-b border-border text-11 text-muted-foreground">
                <TableHead className="py-1.5 pr-2 text-left font-medium">{blueprintI18n("workflowGrants.capability")}</TableHead>
                {ROLES_PANEL.roleCols.map((c) => <TableHead key={c} className="px-2 py-1.5 text-center font-medium" data-testid="tpl-roles-col">{localizeBlueprintCopy(blueprintI18n, c)}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {ROLES_PANEL.permRows.map((row) => (
                <TableRow key={row.cap} className="border-b border-border-subtle" data-testid="tpl-roles-permrow">
                  <TableCell className="py-1.5 pr-2 font-medium">{localizeBlueprintCopy(blueprintI18n, row.cap)}</TableCell>
                  {row.vals.map((v, ci) => {
                    const col = ROLES_PANEL.roleCols[ci]!;
                    const locked = row.lockedFor.includes(col);
                    return (
                      <TableCell key={ci} className="px-2 py-1.5 text-center" data-testid="tpl-roles-cell">
                        {v
                          ? <Check aria-hidden className="mx-auto h-3.5 w-3.5 text-success" />
                          : <span className={cn("mx-auto flex h-3.5 w-3.5 items-center justify-center", locked ? "text-muted-foreground/40" : "text-muted-foreground")}>{locked ? <Lock aria-hidden className="h-3 w-3" /> : "—"}</span>}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-11 text-muted-foreground" data-testid="tpl-roles-locknote"><Lock aria-hidden className="h-3 w-3" />{localizeBlueprintCopy(blueprintI18n, ROLES_PANEL.lockNote)}</p>
      </Section>
      <Section title={blueprintI18n("blueprintFlow.invitationsAndEntry")} testid="tpl-roles-invite">
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {ROLES_PANEL.invite.map((iv) => (
            <li key={iv.who} className="flex items-center gap-2 p-2.5" data-testid="tpl-roles-inviterow">
              <span className="w-24 shrink-0 text-12 font-medium">{localizeBlueprintCopy(blueprintI18n, iv.who)}</span>
              <span className="flex-1 text-11 text-muted-foreground">{localizeBlueprintCopy(blueprintI18n, iv.how)}</span>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

/* ── 面板 6 · 问卷 ────────────────────────────────────────────────────── */
export function SurveyPanel({ item }: { item: ConfigItem }) {
 const { t: blueprintI18n } = useI18n();

  return (
    <>
      <PanelHeader item={item} />
      <Intro>{localizeBlueprintCopy(blueprintI18n, SURVEY_PANEL.intro)}</Intro>
      {SURVEY_PANEL.surveys.map((s) => (
        <Section key={s.name} icon={FileText} title={s.name} testid="tpl-survey"
          aside={<Badge tone="warning">{s.timing}</Badge>}>
          <p className="mb-2 text-11 text-muted-foreground">{s.purpose}</p>
          <ul className="flex flex-col gap-1">
            {s.skeleton.map((q, i) => <li key={i} className="rounded-md bg-panel px-2.5 py-1.5 text-12" data-testid="tpl-survey-q">{q}</li>)}
          </ul>
        </Section>
      ))}
      <Button size="xs" variant="ghost" data-testid="tpl-survey-add"><Plus aria-hidden className="h-3.5 w-3.5" />{blueprintI18n("blueprintFlow.addSurveyOrImportFromSurveyStudio2")}</Button>
    </>
  );
}

/* ── 面板 7 · 访谈与对象 ──────────────────────────────────────────────── */
export function InterviewPanel({ item }: { item: ConfigItem }) {
 const { t: blueprintI18n } = useI18n();

  return (
    <>
      <PanelHeader item={item} />
      <Intro>{localizeBlueprintCopy(blueprintI18n, INTERVIEW_PLAN_PANEL.intro)}</Intro>
      <Section icon={Mic} title={INTERVIEW_PLAN_PANEL.planLabel} testid="tpl-itv-plan">
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {INTERVIEW_PLAN_PANEL.roles.map((r) => (
            <li key={r.role} className="flex items-center gap-2 p-2.5" data-testid="tpl-itv-role">
              <span className="w-28 shrink-0 text-12 font-medium">{r.role}</span>
              <div className="flex-1">
                <p className="text-11 text-muted-foreground">{blueprintI18n("blueprintFlow.whatToLearn2")}{r.ask}</p>
                <p className="text-10 text-muted-foreground">{blueprintI18n("blueprintFlow.outline")}{r.guide}</p>
              </div>
              <Badge tone="neutral">{r.quota}{blueprintI18n("blueprintFlow.sessions")}</Badge>
            </li>
          ))}
        </ul>
        <Button size="xs" variant="ghost" className="mt-2" data-testid="tpl-itv-add"><Plus aria-hidden className="h-3.5 w-3.5" />{blueprintI18n("blueprintFlow.interviewRole2")}</Button>
        <p className="mt-1.5 text-11 italic text-muted-foreground">{INTERVIEW_PLAN_PANEL.virtualNote}</p>
      </Section>
      <Section title={blueprintI18n("blueprintFlow.defaultConsentSettings")} testid="tpl-itv-auth">
        <ul className="flex flex-col gap-1.5">
          {INTERVIEW_PLAN_PANEL.authDefaults.map((a) => (
            <li key={a} className={cn("flex items-start gap-2 text-12", a.includes("硬约束") ? "text-warning-foreground" : "text-muted-foreground")} data-testid="tpl-itv-auth-item">
              {a.includes("硬约束") ? <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Check aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />}{a}
            </li>
          ))}
        </ul>
      </Section>
      <Section title={blueprintI18n("blueprintFlow.evidenceRulesIncludedInTheSessionEvidenceMatrix")} testid="tpl-itv-evidence">
        <p className="text-12 leading-relaxed text-muted-foreground">{INTERVIEW_PLAN_PANEL.evidenceRules}</p>
      </Section>
    </>
  );
}

/* ── 面板 8 · 会前任务 Homework ───────────────────────────────────────── */
export function HomeworkPanel({ item }: { item: ConfigItem }) {
 const { t: blueprintI18n } = useI18n();

  return (
    <>
      <PanelHeader item={item} />
      <Intro>{localizeBlueprintCopy(blueprintI18n, HOMEWORK_PANEL.intro)}</Intro>
      <Section title={blueprintI18n("blueprintFlow.tasks")} testid="tpl-hw-list">
        <ul className="flex flex-col gap-2">
          {HOMEWORK_PANEL.tasks.map((t) => (
            <li key={t.title} className="rounded-md border border-border p-2.5" data-testid="tpl-hw-task">
              <div className="flex items-center gap-2">
                <span className="flex-1 text-12 font-medium">{t.title}</span>
                <Badge tone="primary" data-testid="tpl-hw-seg">{blueprintI18n("blueprintFlow.attach")}{t.seg}</Badge>
                {t.forWhom !== "全体" && <Badge tone="outline">{t.forWhom}</Badge>}
              </div>
              <p className="mt-1 text-11 text-destructive" data-testid="tpl-hw-ifnot">{blueprintI18n("blueprintFlow.consequenceOfSkipping")}{t.ifNot}</p>
              <p className="mt-0.5 text-10 text-muted-foreground">{blueprintI18n("blueprintFlow.deadline")}{t.due}</p>
            </li>
          ))}
        </ul>
        <Button size="xs" variant="ghost" className="mt-2" data-testid="tpl-hw-add"><Plus aria-hidden className="h-3.5 w-3.5" />{blueprintI18n("notifications.kind.task")}</Button>
      </Section>
      <AiNote tag={blueprintI18n("blueprintFlow.aIHandlesReminders")}>{HOMEWORK_PANEL.reminderRule}</AiNote>
    </>
  );
}

/* ── 面板 9 · 场地与形式 ──────────────────────────────────────────────── */
export function VenuePanel({ item }: { item: ConfigItem }) {
 const { t: blueprintI18n } = useI18n();

  return (
    <>
      <PanelHeader item={item} />
      <Intro>{localizeBlueprintCopy(blueprintI18n, VENUE_PANEL.intro)}</Intro>
      <Section title={blueprintI18n("blueprintFlow.spaceRequirementsBecomeTasksWhenApplied")} testid="tpl-venue-space">
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {VENUE_PANEL.space.map((s) => (
            <li key={s.item} className="flex items-center gap-2 p-2.5" data-testid="tpl-venue-space-item">
              <span className="w-24 shrink-0 text-12 font-medium">{s.item}</span>
              <span className="flex-1 text-11 text-muted-foreground">{s.spec}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title={blueprintI18n("blueprintFlow.formatOptions")} testid="tpl-venue-formats">
        <div className="flex flex-col gap-2">
          {VENUE_PANEL.formats.map((f) => (
            <div key={f.key} className={cn("rounded-md border p-2.5", f.label.includes("默认") ? "border-primary bg-accent" : "border-border")} data-testid="tpl-venue-format">
              <p className="text-12 font-medium">{localizeBlueprintCopy(blueprintI18n, f.label)}</p>
              <p className="text-11 text-muted-foreground">{localizeBlueprintCopy(blueprintI18n, f.detail)}</p>
            </div>
          ))}
        </div>
      </Section>
      <Section title={blueprintI18n("blueprintFlow.venueLayout")} testid="tpl-venue-layout"
        aside={<Badge tone="neutral">{blueprintI18n("blueprintFlow.sentAsAnImageToTheVenueWhenApplied")}</Badge>}>
        <div className="grid grid-cols-2 gap-2 rounded-md border border-dashed border-border p-3">
          {VENUE_PANEL.layout.groups.map((g) => (
            <div key={g} className="flex h-14 items-center justify-center rounded-full border border-border bg-panel text-11 text-muted-foreground" data-testid="tpl-venue-group">{g}</div>
          ))}
        </div>
        <p className="mt-1.5 text-11 text-muted-foreground">{VENUE_PANEL.layout.center}</p>
      </Section>
    </>
  );
}

/* ── 面板 10 · 项目材料 ───────────────────────────────────────────────── */
export function MaterialsPanel({ item }: { item: ConfigItem }) {
 const { t: blueprintI18n } = useI18n();

  return (
    <>
      <PanelHeader item={item} />
      <Intro>{localizeBlueprintCopy(blueprintI18n, MATERIALS_PANEL.intro)}</Intro>
      <Section title={localizeBlueprintCopy(blueprintI18n, MATERIALS_PANEL.label)} testid="tpl-mat-list"
        aside={<Button size="xs" variant="outline" data-testid="tpl-mat-export">{blueprintI18n("blueprintFlow.exportList")}</Button>}>
        <div className="overflow-x-auto">
          <Table className="w-full border-collapse text-12" data-testid="tpl-mat-table">
            <TableHeader>
              <TableRow className="border-b border-border text-11 text-muted-foreground">
                <TableHead className="py-1.5 pr-2 text-left font-medium">{blueprintI18n("blueprintFlow.material")}</TableHead>
                <TableHead className="px-2 py-1.5 text-left font-medium">{blueprintI18n("blueprintFlow.quantity")}</TableHead>
                <TableHead className="px-2 py-1.5 text-left font-medium">{blueprintI18n("blueprintFlow.usedInSegment")}</TableHead>
                <TableHead className="px-2 py-1.5 text-left font-medium">{blueprintI18n("blueprintFlow.preparedBy")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {MATERIALS_PANEL.rows.map((r) => (
                <TableRow key={r.name} className="border-b border-border-subtle" data-testid="tpl-mat-row">
                  <TableCell className="py-1.5 pr-2 font-medium">{r.name}</TableCell>
                  <TableCell className="px-2 py-1.5 font-mono text-11">{r.qty}</TableCell>
                  <TableCell className="px-2 py-1.5 text-11 text-muted-foreground">{r.forSeg}</TableCell>
                  <TableCell className="px-2 py-1.5"><Badge tone="outline">{r.owner}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="mt-2 rounded-md bg-panel px-2.5 py-1.5 text-11 text-muted-foreground" data-testid="tpl-mat-footnote">{MATERIALS_PANEL.footnote}</p>
        <Button size="xs" variant="ghost" className="mt-2" data-testid="tpl-mat-add"><Plus aria-hidden className="h-3.5 w-3.5" />{blueprintI18n("blueprintFlow.material")}</Button>
      </Section>
    </>
  );
}

/* ── 面板 11 · 分组打印素材 ───────────────────────────────────────────── */
export function PrintPanel({ item }: { item: ConfigItem }) {
 const { t: blueprintI18n } = useI18n();

  return (
    <>
      <PanelHeader item={item} />
      <Intro>{localizeBlueprintCopy(blueprintI18n, PRINT_PANEL.intro)}</Intro>
      <Section icon={Printer} title={blueprintI18n("blueprintFlow.printouts4Items")} testid="tpl-print-list"
        aside={<Button size="xs" variant="outline" data-testid="tpl-print-export">{blueprintI18n("blueprintFlow.exportAllPDFs")}</Button>}>
        <div className="flex flex-col gap-2">
          {PRINT_PANEL.items.map((p) => (
            <div key={p.name} className="flex gap-2 rounded-md border border-border p-2.5" data-testid="tpl-print-item">
              <Badge tone="neutral" className="h-fit">{p.size}</Badge>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-12 font-medium">{p.name}</span>
                  {p.ai && <Badge tone="ai"><Sparkles aria-hidden className="h-2.5 w-2.5" />{blueprintI18n("blueprintFlow.aIGenerated")}</Badge>}
                  <Badge tone="outline" className="ml-auto">{p.qty}</Badge>
                </div>
                <p className="mt-0.5 text-11 text-muted-foreground">{p.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>
      <Section icon={QrCode} title={blueprintI18n("blueprintFlow.capturePaperWorkInTheSystemQRCodeAndOCR")} testid="tpl-print-ocr">
        <p className="text-12 leading-relaxed text-muted-foreground">{PRINT_PANEL.ocrNote}</p>
      </Section>
    </>
  );
}

/* ── 面板 12 · 组内能力 ───────────────────────────────────────────────── */
export function CapsPanel({ item }: { item: ConfigItem }) {
 const { t: blueprintI18n } = useI18n();

  return (
    <>
      <PanelHeader item={item} />
      <Intro>{localizeBlueprintCopy(blueprintI18n, CAPS_PANEL.intro)}</Intro>
      <Section title={blueprintI18n("blueprintFlow.whatMembersUseItForThisColumnBecomesEachGroup")} testid="tpl-caps-list">
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {CAPS_PANEL.caps.map((c) => {
            const on = c.state.startsWith("开");
            return (
              <li key={c.name} className="flex items-center gap-2 p-2.5" data-testid="tpl-caps-item">
                <span className="w-28 shrink-0 text-12 font-medium">{c.name}</span>
                <span className="flex-1 text-11 text-muted-foreground">{c.use}</span>
                <Badge tone={on ? "primary" : "neutral"} data-testid="tpl-caps-state">{localizeBlueprintCopy(blueprintI18n, c.state)}</Badge>
              </li>
            );
          })}
        </ul>
      </Section>
      <Section title={blueprintI18n("blueprintFlow.deliverableDestinationsWhereEachGroupCapabilitySendsItsOutput")} testid="tpl-caps-reflow">
        <ul className="flex flex-col gap-1.5">
          {CAPS_PANEL.reflow.map((r) => (
            <li key={r.cap} className="flex items-center gap-2 text-12" data-testid="tpl-caps-reflow-item">
              <span className="font-medium">{localizeBlueprintCopy(blueprintI18n, r.cap)}</span><ChevronRight aria-hidden className="h-3.5 w-3.5 text-muted-foreground" /><span className="text-muted-foreground">{localizeBlueprintCopy(blueprintI18n, r.to)}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title={blueprintI18n("blueprintFlow.visibilityWhoCanSeeWhichGroupContent")} testid="tpl-caps-visibility">
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {CAPS_PANEL.visibility.map((v) => (
            <li key={v.who} className="flex flex-col gap-0.5 p-2.5 sm:flex-row sm:items-center sm:gap-2" data-testid="tpl-caps-vis-row">
              <span className="w-20 shrink-0 text-12 font-medium">{localizeBlueprintCopy(blueprintI18n, v.who)}</span>
              <span className="flex-1 text-11 text-success">{blueprintI18n("blueprintFlow.canSee")}{localizeBlueprintCopy(blueprintI18n, v.canSee)}</span>
              <span className="flex-1 text-11 text-muted-foreground">{blueprintI18n("blueprintFlow.cannotSee")}{localizeBlueprintCopy(blueprintI18n, v.cannot)}</span>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

/* ── 面板 13 · Agent 编排 ─────────────────────────────────────────────── */
export function AgentPanel({ item }: { item: ConfigItem }) {
 const { t: blueprintI18n } = useI18n();

  return (
    <>
      <PanelHeader item={item} />
      <Intro>{localizeBlueprintCopy(blueprintI18n, AGENT_PANEL.intro)}</Intro>
      <Section icon={Cpu} title={localizeBlueprintCopy(blueprintI18n, AGENT_PANEL.label)} testid="tpl-agent-list">
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {AGENT_PANEL.agents.map((a) => (
            <li key={a.name} className="flex items-center gap-2 p-2.5" data-testid="tpl-agent-row">
              <span className="w-24 shrink-0 text-12 font-medium">{a.name}</span>
              <div className="flex-1">
                <p className="text-11 text-muted-foreground">{a.does}</p>
                <p className="text-10 text-muted-foreground">{blueprintI18n("blueprintFlow.present")}{a.segs}</p>
              </div>
              {a.canSpeak ? <Badge tone="primary">{blueprintI18n("blueprintFlow.maySpeakProactively")}</Badge> : <Badge tone="neutral">{blueprintI18n("blueprintFlow.notProactive")}</Badge>}
              <Badge tone="outline">{localizeBlueprintCopy(blueprintI18n, a.state)}</Badge>
            </li>
          ))}
        </ul>
      </Section>
      <Section title={blueprintI18n("blueprintFlow.interventionLevel")} testid="tpl-agent-intervention">
        <p className="text-12 font-medium">{AGENT_PANEL.intervention.threshold}</p>
        <AiNote tag={blueprintI18n("blueprintFlow.thresholdHistory")}>{AGENT_PANEL.intervention.history}</AiNote>
        <ul className="mt-2 flex flex-col gap-1">
          {AGENT_PANEL.intervention.rules.map((r) => <li key={r} className="flex items-start gap-2 text-11 text-muted-foreground" data-testid="tpl-agent-rule"><Check aria-hidden className="mt-0.5 h-3 w-3 shrink-0 text-success" />{r}</li>)}
        </ul>
      </Section>
      <Section icon={Lock} title={blueprintI18n("blueprintFlow.nonNegotiableConstraints")} testid="tpl-agent-hardlimits">
        <ul className="flex flex-col gap-1.5">
          {AGENT_PANEL.hardLimits.map((h) => (
            <li key={h} className="flex items-start gap-2 rounded-md bg-panel px-2.5 py-1.5 text-12" data-testid="tpl-agent-hardlimit"><Lock aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />{h}</li>
          ))}
        </ul>
      </Section>
    </>
  );
}

/* ── 面板 14 · Skill 绑定（含降级阻断发布）──────────────────────────────── */
export function SkillPanel({ item }: { item: ConfigItem }) {
 const { t: blueprintI18n } = useI18n();

  return (
    <>
      <PanelHeader item={item} />
      <Intro>{localizeBlueprintCopy(blueprintI18n, SKILL_PANEL.intro)}</Intro>
      <div className="mb-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2.5" data-testid="tpl-skill-degrade-warning">
        <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
        <p className="text-11 leading-relaxed text-destructive">{SKILL_PANEL.degradeWarning} <Button size="xs" variant="outline" className="ml-1" data-testid="tpl-skill-alt">{blueprintI18n("blueprintFlow.viewAlternatives")}</Button></p>
      </div>
      <Section title={localizeBlueprintCopy(blueprintI18n, SKILL_PANEL.label)} testid="tpl-skill-list">
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {SKILL_PANEL.skills.map((s) => (
            <li key={s.name} className={cn("flex items-center gap-2 p-2.5", s.degraded && "bg-muted/40")} data-testid="tpl-skill-row">
              <Badge tone="neutral" className="w-10 justify-center">{s.seg}</Badge>
              <div className="flex-1">
                <span className={cn("text-12 font-medium", s.degraded && "text-muted-foreground")}>{s.name}</span>
                <p className="text-10 text-muted-foreground">{s.desc}</p>
              </div>
              {s.degraded && <Badge tone="danger" data-testid="tpl-skill-degraded">{blueprintI18n("blueprintFlow.downgradedReplacementNeeded")}</Badge>}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-11 text-muted-foreground">{SKILL_PANEL.genericNote}</p>
        <Button size="xs" variant="ghost" className="mt-2" data-testid="tpl-skill-add"><Plus aria-hidden className="h-3.5 w-3.5" />{blueprintI18n("blueprintFlow.bindSkill2")}</Button>
      </Section>
    </>
  );
}

/* ── 面板 15 · 输出物 ─────────────────────────────────────────────────── */
export function OutputsPanel({ item }: { item: ConfigItem }) {
 const { t: blueprintI18n } = useI18n();

  return (
    <>
      <PanelHeader item={item} />
      <Intro>{localizeBlueprintCopy(blueprintI18n, OUTPUTS_PANEL.intro)}</Intro>
      <Section title={localizeBlueprintCopy(blueprintI18n, OUTPUTS_PANEL.label)} testid="tpl-out-list">
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {OUTPUTS_PANEL.rows.map((r) => (
            <li key={r.name} className="flex items-center gap-2 p-2.5" data-testid="tpl-out-row">
              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", r.required ? "bg-destructive" : "bg-muted-foreground/40")} />
              <span className="flex-1 text-12 font-medium">{r.name}{r.required && <Badge tone="danger" className="ml-1.5">{blueprintI18n("blueprintFlow.required")}</Badge>}</span>
              <Badge tone="ai">{r.gen}</Badge>
              <ChevronRight aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
              <Badge tone="outline">{localizeBlueprintCopy(blueprintI18n, r.to)}</Badge>
            </li>
          ))}
        </ul>
        <Button size="xs" variant="ghost" className="mt-2" data-testid="tpl-out-add"><Plus aria-hidden className="h-3.5 w-3.5" />{blueprintI18n("blueprintFlow.deliverable2")}</Button>
      </Section>
      <Section icon={Lock} title={blueprintI18n("blueprintFlow.feedbackRules")} testid="tpl-out-reflow">
        <p className="text-12 leading-relaxed text-muted-foreground">{OUTPUTS_PANEL.reflowRule}</p>
      </Section>
      <Section title={blueprintI18n("blueprintFlow.closureCheck")} testid="tpl-out-checks">
        <ul className="flex flex-col gap-1.5">
          {OUTPUTS_PANEL.closeChecks.map((c) => <li key={c} className="flex items-start gap-2 text-12" data-testid="tpl-out-check"><Check aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />{c}</li>)}
        </ul>
      </Section>
    </>
  );
}

/* ── 面板 16 · 报告模板 ───────────────────────────────────────────────── */
export function ReportPanel({ item }: { item: ConfigItem }) {
 const { t: blueprintI18n } = useI18n();

  return (
    <>
      <PanelHeader item={item} />
      <Intro>{localizeBlueprintCopy(blueprintI18n, REPORT_PANEL.intro)}</Intro>
      <Section icon={FileText} title={localizeBlueprintCopy(blueprintI18n, REPORT_PANEL.client.label)} testid="tpl-report-client"
        aside={<Button size="xs" variant="ghost" data-testid="tpl-report-add"><Plus aria-hidden className="h-3.5 w-3.5" />{blueprintI18n("blueprintFlow.reportVersion")}</Button>}>
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {REPORT_PANEL.client.chapters.map((c, i) => (
            <li key={i} className="flex items-center gap-2 p-2.5" data-testid="tpl-report-chapter">
              <span className="w-6 shrink-0 font-mono text-11 text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
              <span className="flex-1 text-12">{c.title}</span>
              <Badge tone={c.by.includes("必须") ? "danger" : "ai"} data-testid="tpl-report-by">{c.by}</Badge>
            </li>
          ))}
        </ul>
      </Section>
      <Section title={localizeBlueprintCopy(blueprintI18n, REPORT_PANEL.internal.label)} testid="tpl-report-internal">
        <p className="text-12 leading-relaxed text-muted-foreground">{REPORT_PANEL.internal.note}</p>
      </Section>
      <Section icon={Lock} title={blueprintI18n("blueprintFlow.writingConstraints")} testid="tpl-report-rules">
        <ul className="flex flex-col gap-1.5">
          {REPORT_PANEL.writingRules.map((r) => <li key={r} className="flex items-start gap-2 text-12" data-testid="tpl-report-rule"><Lock aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />{r}</li>)}
        </ul>
        <AiNote tag={blueprintI18n("blueprintFlow.historicalData")}>{REPORT_PANEL.historyNote}</AiNote>
      </Section>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * 面板分发表 —— key → 渲染器。designer-screen 用它渲染当前选中的面板。
 * ══════════════════════════════════════════════════════════════════════════ */
export const PANEL_RENDERERS: Record<string, React.ComponentType<{ item: ConfigItem }>> = {
  "basic-overview": BasicOverviewPanel,
  "topic-and-background": TopicPanel,
  "flow-agenda": AgendaPanel,
  "grouping-rule": GroupingPanel,
  "roles-and-perms": RolesPanel,
  survey: SurveyPanel,
  "interview-and-subjects": InterviewPanel,
  "pre-tasks": HomeworkPanel,
  "venue-and-format": VenuePanel,
  "project-materials": MaterialsPanel,
  "print-materials": PrintPanel,
  "group-capabilities": CapsPanel,
  "agent-orchestration": AgentPanel,
  "skill-binding": SkillPanel,
  outputs: OutputsPanel,
  "report-template": ReportPanel,
};
