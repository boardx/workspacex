"use client";
import { canonicalBlueprintCopy, localizeBlueprintCopy } from "@/lib/i18n/blueprint-copy";

import { useI18n } from "@/lib/i18n/provider";

import * as React from "react";
import { Sparkles, Plus, Minus, UserPlus, Repeat, ArrowRight, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import type { ProjectRole } from "@/lib/identity";
import { cn } from "@/lib/utils";
import {
  PROJECT_TOPIC, PROJECT_GROUPS, UNGROUPED, INTERVIEW_SUBJECTS,
  GROUP_STATUS_LABEL, GROUP_STATUS_TONE, type ProjectGroup,
} from "@/lib/mock/tpl";
import { AiTag, SignoffFlag } from "./parts";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

const PREP_TABS = [
  { key: "topic", label: canonicalBlueprintCopy("blueprintFlow.topicAndGrouping"), signable: true },
  { key: "agenda", label: canonicalBlueprintCopy("blueprintFlow.agenda7Segments"), signable: false },
  { key: "materials", label: canonicalBlueprintCopy("blueprintFlow.materials9Items"), signable: false },
  { key: "pretasks", label: canonicalBlueprintCopy("blueprintFlow.preSessionTasks712"), signable: false },
];

export function ProjectPrepScreen({
  uiState, previewRole, onToast,
}: { uiState: UiState; previewRole: ProjectRole | null; onToast: (m: string) => void }) {
 const { t: blueprintI18n } = useI18n();

  const [groupCount, setGroupCount] = React.useState(PROJECT_GROUPS.length);
  const canWrite = previewRole === "facilitator" || previewRole === "groupLead";

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 p-4" data-testid="tpl-prep">
      <header className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <h1 className="text-20 font-bold tracking-tight">{blueprintI18n("blueprintFlow.projectPreparation")}</h1>
          <Badge tone="primary">{blueprintI18n("blueprintFlow.blueprintHMWV4")}</Badge>
        </div>
        <p className="text-12 text-muted-foreground">{blueprintI18n("blueprintFlow.afterApplyingFacilitatorsEditContentRatherThanRebuildStructure")}</p>
      </header>

      <Tabs defaultValue="topic">
        <TabsList data-testid="tpl-prep-tabs">
          {PREP_TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key} data-testid="tpl-prep-tab">{localizeBlueprintCopy(blueprintI18n, t.label)}</TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="topic">
          <StateShell
            state={uiState}
            skeletonRows={6}
            emptyHint={blueprintI18n("blueprintFlow.onlyTheBlueprintIsSelectedTopicAndGroupsRemainUndecided")}
            errors={{ "topic": blueprintI18n("blueprintFlow.theTopicExceedsTheSuggested30CharacterLimitWithoutDecision") }}
            depFailure={{ what: blueprintI18n("blueprintFlow.theInsightLibrary09KgIsUnavailableAITopicBackground") }}
            denial={{ layer: "project", reason: blueprintI18n("blueprintFlow.observersAreReadOnlyAndCannotSeeWriteActionsMembers") }}
            successMessage={blueprintI18n("blueprintFlow.savedAndSyncedGroupsAgendaAndAllAIContextNow")}
          >
            <div className="flex flex-col gap-4">
              <TopicSection canWrite={canWrite} onToast={onToast} />
              <GroupingSection groupCount={groupCount} setGroupCount={setGroupCount} canWrite={canWrite} onToast={onToast} />
            </div>
          </StateShell>
        </TabsContent>

        {PREP_TABS.filter((t) => !t.signable).map((t) => (
          <TabsContent key={t.key} value={t.key}>
            <SignoffFlag kind="unexplored" title={blueprintI18n("blueprintFlow.editorOpenedFromTheValue1SubtabSecondarySignOff", { value1: String(localizeBlueprintCopy(blueprintI18n, t.label)) })}>{blueprintI18n("blueprintFlow.unexploredDoesNotMeanAbsentFromThePrototypeThisDomain")}{localizeBlueprintCopy(blueprintI18n, t.label)}{blueprintI18n("blueprintFlow.wasNotOpenedDuringPrototypeInspectionItsInteractionsWillNot")}</SignoffFlag>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

/* ── 定题（单点继承）─────────────────────────────────────────────────── */

function TopicSection({ canWrite, onToast }: { canWrite: boolean; onToast: (m: string) => void }) {
 const { t: blueprintI18n } = useI18n();

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border p-4" data-testid="tpl-topic-section">
      <p className="rounded-md bg-panel px-2.5 py-1.5 text-11 text-muted-foreground" data-testid="tpl-topic-rule">{blueprintI18n("blueprintFlow.theSessionHasOneTopicAndOneBackgroundGroupsAgenda")}</p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tpl-topic">{blueprintI18n("blueprintFlow.topicOneSentencePreferablyWithin30CharactersWithTimingAnd")}</Label>
        <Input id="tpl-topic" defaultValue={PROJECT_TOPIC.topic} disabled={!canWrite} data-testid="tpl-topic-input" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tpl-bg">{blueprintI18n("blueprintFlow.backgroundWhyHoldThisSessionNow")}</Label>
        <Textarea id="tpl-bg" rows={3} defaultValue={PROJECT_TOPIC.background} disabled={!canWrite} data-testid="tpl-bg-input" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="xs" variant="ai" disabled={!canWrite} onClick={() => onToast(canonicalBlueprintCopy("blueprintFlow.aIGenerateTopicMachineOutputHumanConfirmationRequired"))} data-testid="tpl-ai-topic"><Sparkles aria-hidden className="h-3 w-3" />{blueprintI18n("blueprintFlow.aIGenerateTopic")}</Button>
        <Button size="xs" variant="ai" disabled={!canWrite} onClick={() => onToast(canonicalBlueprintCopy("blueprintFlow.aIGenerateBackgroundMachineOutputHumanConfirmationRequired"))} data-testid="tpl-ai-bg"><Sparkles aria-hidden className="h-3 w-3" />{blueprintI18n("blueprintFlow.aIGenerateBackground")}</Button>
        <Button size="xs" variant="ai" disabled={!canWrite} onClick={() => onToast(canonicalBlueprintCopy("blueprintFlow.rewriteUsingInsightsMachineOutputHumanConfirmationRequired"))} data-testid="tpl-ai-rewrite"><Sparkles aria-hidden className="h-3 w-3" />{blueprintI18n("blueprintFlow.rewriteUsingInsights")}</Button>
      </div>
      <AiTag sources={PROJECT_TOPIC.sources} />
      <div className="flex items-center gap-2">
        <Button size="sm" variant="primary" disabled={!canWrite} onClick={() => onToast(canonicalBlueprintCopy("blueprintFlow.savedAndSyncedGroupsAgendaAndAIContextNowUse"))} data-testid="tpl-topic-save">
          <Save aria-hidden className="h-3.5 w-3.5" />{blueprintI18n("blueprintFlow.saveAndSyncToSession")}</Button>
        <span className="text-10 text-muted-foreground">{blueprintI18n("blueprintFlow.savingSynchronizesDownstreamBeyondThisPage")}</span>
      </div>
    </section>
  );
}

/* ── 分组编排 ─────────────────────────────────────────────────────────── */

function GroupingSection({
  groupCount, setGroupCount, canWrite, onToast,
}: { groupCount: number; setGroupCount: (n: number) => void; canWrite: boolean; onToast: (m: string) => void }) {
 const { t: blueprintI18n } = useI18n();

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border p-4" data-testid="tpl-grouping-section">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-13 font-semibold">{blueprintI18n("blueprintFlow.groupArrangement")}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-11 text-muted-foreground">{blueprintI18n("blueprintFlow.numberOfGroups")}</span>
          <div className="flex items-center rounded-md border border-border">
            <Button size="icon" variant="ghost" aria-label={blueprintI18n("blueprintFlow.removeOneGroup")} disabled={!canWrite} onClick={() => setGroupCount(Math.max(1, groupCount - 1))} data-testid="tpl-group-minus"><Minus aria-hidden className="h-3 w-3" /></Button>
            <span className="w-6 text-center text-12" data-testid="tpl-group-count">{groupCount}</span>
            <Button size="icon" variant="ghost" aria-label={blueprintI18n("blueprintFlow.addOneGroup")} disabled={!canWrite} onClick={() => setGroupCount(groupCount + 1)} data-testid="tpl-group-plus"><Plus aria-hidden className="h-3 w-3" /></Button>
          </div>
          <Button size="xs" variant="ai" disabled={!canWrite} onClick={() => onToast(canonicalBlueprintCopy("blueprintFlow.aIBalanceGroupsByBackgroundSuggestionHumanConfirmationRequired"))} data-testid="tpl-ai-balance"><Sparkles aria-hidden className="h-3 w-3" />{blueprintI18n("blueprintFlow.aIBalanceGroupsByBackground")}</Button>
          <Button size="xs" variant="outline" disabled={!canWrite} onClick={() => setGroupCount(groupCount + 1)} data-testid="tpl-group-add"><Plus aria-hidden className="h-3 w-3" />{blueprintI18n("blueprintFlow.addGroup")}</Button>
        </div>
      </div>

      <ul className="flex flex-col gap-1.5">
        {PROJECT_GROUPS.slice(0, groupCount).map((g) => <GroupRow key={g.ordinal} g={g} canWrite={canWrite} onToast={onToast} />)}
      </ul>

      <div className="flex items-center gap-2 rounded-md border border-dashed border-border p-2" data-testid="tpl-ungrouped">
        <span className="text-11 text-muted-foreground">{blueprintI18n("survey.design.ungrouped")}{UNGROUPED.length}{blueprintI18n("blueprintFlow.people")}{UNGROUPED.join("、")}</span>
        <Button size="xs" variant="ai" className="ml-auto" disabled={!canWrite} onClick={() => onToast(canonicalBlueprintCopy("blueprintFlow.aIAssignByBackgroundSuggestionHumanConfirmationRequired"))} data-testid="tpl-ai-assign"><Sparkles aria-hidden className="h-3 w-3" />{blueprintI18n("blueprintFlow.aIAssignByBackground")}</Button>
      </div>

      <p className="text-10 text-muted-foreground">{blueprintI18n("blueprintFlow.topicsScenariosAndGroupsFlowIntoTheAgendaAndLive")}</p>
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={() => onToast(canonicalBlueprintCopy("blueprintFlow.goToAgendaSubtab"))} data-testid="tpl-to-agenda">{blueprintI18n("blueprintFlow.goToAgenda")}<ArrowRight aria-hidden className="h-3.5 w-3.5" /></Button>
      </div>

      <SubjectTable canWrite={canWrite} onToast={onToast} />
    </section>
  );
}

function GroupRow({ g, canWrite, onToast }: { g: ProjectGroup; canWrite: boolean; onToast: (m: string) => void }) {
 const { t: blueprintI18n } = useI18n();

  const [open, setOpen] = React.useState(g.ordinal === 2);
  return (
    <li className="rounded-md border border-border" data-testid="tpl-group-row">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 p-2.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="text-11 font-semibold text-muted-foreground">{g.ordinal}</span>
        <span className="text-12 font-medium">{g.name}</span>
        <Badge tone={GROUP_STATUS_TONE[g.status]} data-testid="tpl-group-status">{GROUP_STATUS_LABEL[g.status] === "缺 N 人" ? g.statusDetail : localizeBlueprintCopy(blueprintI18n, GROUP_STATUS_LABEL[g.status])}</Badge>
        <span className="truncate text-11 text-muted-foreground">{g.scenario}</span>
        <span className="ml-auto text-11 text-muted-foreground">{g.memberCount}{blueprintI18n("blueprintFlow.peopleLead")}{g.lead}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-1.5 border-t border-border p-2.5">
          <p className="text-11"><span className="text-muted-foreground">{blueprintI18n("blueprintFlow.scenarioWhatThisGroupExplores")}</span>{g.scenario}</p>
          <div className="flex items-center gap-1.5">
            <span className="text-11 text-muted-foreground">{blueprintI18n("canvas.member")}{g.memberCount}{blueprintI18n("blueprintFlow.people")}</span>
            <Button size="xs" variant="outline" disabled={!canWrite} onClick={() => onToast(canonicalBlueprintCopy("blueprintFlow.addPeopleToValue1", { value1: String(g.name) }))} data-testid="tpl-group-addmember"><UserPlus aria-hidden className="h-3 w-3" />{blueprintI18n("blueprintFlow.addPerson")}</Button>
            <Button size="xs" variant="outline" disabled={!canWrite} onClick={() => onToast(canonicalBlueprintCopy("blueprintFlow.changeValue1SLead", { value1: String(g.name) }))} data-testid="tpl-group-changelead"><Repeat aria-hidden className="h-3 w-3" />{blueprintI18n("blueprintFlow.changeLead")}</Button>
          </div>
        </div>
      )}
    </li>
  );
}

/* ── 观察/访谈对象表 ──────────────────────────────────────────────────── */

const SUBJECT_COLS = ["对象", "部门角色", "联系方式", "背景与要问什么", "方式", "状态"];

function SubjectTable({ canWrite, onToast }: { canWrite: boolean; onToast: (m: string) => void }) {
 const { t: blueprintI18n } = useI18n();

  return (
    <div className="mt-1 flex flex-col gap-2 rounded-md border border-border p-3" data-testid="tpl-subject-table">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-12 font-semibold">{blueprintI18n("blueprintFlow.observationInterviewParticipants")}</span>
        <Button size="xs" variant="ai" className="ml-auto" disabled={!canWrite} onClick={() => onToast(canonicalBlueprintCopy("blueprintFlow.aISuggestParticipantsMachineOutputHumanConfirmationRequired"))} data-testid="tpl-subject-ai"><Sparkles aria-hidden className="h-3 w-3" />{blueprintI18n("blueprintFlow.aISuggestParticipants")}</Button>
        <Button size="xs" variant="outline" disabled={!canWrite} onClick={() => onToast(canonicalBlueprintCopy("blueprintFlow.addInterviewParticipant"))} data-testid="tpl-subject-add"><Plus aria-hidden className="h-3 w-3" />{blueprintI18n("blueprintFlow.addParticipant")}</Button>
      </div>
      <div className="overflow-x-auto" data-allow-x-scroll="访谈对象表六列，窄屏允许横向滚动看全">
        <Table className="w-full min-w-[640px] border-collapse text-11">
          <TableHeader>
            <TableRow className="border-b border-border text-left text-muted-foreground">
              {SUBJECT_COLS.map((c) => <TableHead key={c} className="px-2 py-1 font-medium">{localizeBlueprintCopy(blueprintI18n, c)}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {INTERVIEW_SUBJECTS.map((s, i) => (
              <TableRow key={i} className="border-b border-border/60" data-testid="tpl-subject-row">
                <TableCell className="px-2 py-1.5">{s.name}</TableCell>
                <TableCell className="px-2 py-1.5 text-muted-foreground">{s.role}</TableCell>
                <TableCell className="px-2 py-1.5 text-muted-foreground">{s.contact}</TableCell>
                <TableCell className="px-2 py-1.5 text-muted-foreground">{s.focus}</TableCell>
                <TableCell className="px-2 py-1.5">{s.method}</TableCell>
                <TableCell className="px-2 py-1.5">
                  {s.status.includes("AI") ? <Badge tone="ai">{s.status}</Badge> : <Badge tone="outline">{s.status}</Badge>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-10 text-muted-foreground">{blueprintI18n("blueprintFlow.interviewAIUsesThisTableToScheduleSessionsAndGenerate")}</p>
    </div>
  );
}
