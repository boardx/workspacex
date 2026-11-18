"use client";
import { canonicalBlueprintCopy, localizeBlueprintCopy } from "@/lib/i18n/blueprint-copy";

import { useI18n } from "@/lib/i18n/provider";

import * as React from "react";
import { Check, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import type { ProjectRole } from "@/lib/identity";
import { cn } from "@/lib/utils";
import {
  BLUEPRINTS, DURATION_TIERS, TIER_LABEL, AGENDA_COUNT_BY_TIER, DEFAULT_TIER,
  INIT_CATEGORIES, configTotal, type DurationTierView,
} from "@/lib/mock/tpl";
import { SignoffFlag, ConfirmDialog } from "./parts";
import { ProjectSideGaps } from "./project-gaps";

const APPLICABLE = BLUEPRINTS.filter((b) => b.state === "published");

export function ApplyWizardScreen({
  uiState, previewRole, onToast,
}: { uiState: UiState; previewRole: ProjectRole | null; onToast: (m: string) => void }) {
 const { t: blueprintI18n } = useI18n();

  const [step, setStep] = React.useState<1 | 2>(1);
  const [bpId, setBpId] = React.useState<string>(APPLICABLE[0]!.id);
  const [tier, setTier] = React.useState<DurationTierView>(DEFAULT_TIER);
  const [confirm, setConfirm] = React.useState(false);
  const bp = APPLICABLE.find((b) => b.id === bpId)!;
  const total = configTotal();
  const agenda = AGENDA_COUNT_BY_TIER[tier];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-20 font-bold tracking-tight">{blueprintI18n("projects.new")}</h1>
        <p className="text-12 text-muted-foreground">{blueprintI18n("blueprintFlow.chooseAPublishedBlueprintAndDurationTierToInitializeSix")}</p>
        <div className="mt-1 flex items-center gap-2 text-11">
          <StepDot n={1} active={step >= 1} label={blueprintI18n("blueprintFlow.chooseBlueprint")} />
          <ChevronRight aria-hidden className="h-3 w-3 text-muted-foreground" />
          <StepDot n={2} active={step >= 2} label={blueprintI18n("blueprintFlow.chooseTierAndPreview")} />
        </div>
      </header>

      <StateShell
        state={uiState}
        skeletonRows={5}
        emptyHint={blueprintI18n("blueprintFlow.thisOrganizationHasNoPublishedBlueprintsYetPublishOneIn")}
        errors={{ "apply": blueprintI18n("blueprintFlow.cannotCreateTopicAndGroupLeadAreMissingLowReadiness") }}
        depFailure={{ what: blueprintI18n("blueprintFlow.theBlueprintSnapshotServiceUC01KernelIsUnavailable") }}
        denial={{ layer: "organization", reason: blueprintI18n("blueprintFlow.onlyProjectLeadsOrAuthorizedFacilitatorsCanCreateProjectsIdentity") }}
        successMessage={blueprintI18n("blueprintFlow.projectCreatedWithTheHMWV4SnapshotOpeningProjectPreparation")}
      >
        {step === 1 ? (
          <section className="flex flex-col gap-2" data-testid="tpl-apply-step1">
            <span className="text-12 font-medium">{blueprintI18n("blueprintFlow.availableBlueprintsPublishedOnly")}</span>
            {APPLICABLE.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setBpId(b.id)}
                data-testid="tpl-apply-blueprint"
                className={cn(
                  "flex items-center gap-2 rounded-lg border p-3 text-left transition-colors duration-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  b.id === bpId ? "border-primary bg-accent" : "border-border hover:bg-muted",
                )}
              >
                <span className={cn("flex h-4 w-4 items-center justify-center rounded-full border", b.id === bpId ? "border-primary bg-primary text-primary-foreground" : "border-input")}>
                  {b.id === bpId && <Check aria-hidden className="h-3 w-3" />}
                </span>
                <div className="flex-1">
                  <div className="text-13 font-medium">{b.name} <Badge tone="primary">v{b.version}</Badge></div>
                  <div className="text-10 text-muted-foreground">
                    {b.agendaSegments}{blueprintI18n("blueprintFlow.segments")}{b.duration}{blueprintI18n("blueprintFlow.used")}{b.usedCount}{blueprintI18n("blueprintFlow.times")}{b.doneCount}/{total}{blueprintI18n("blueprintFlow.configured")}{b.satisfaction ? blueprintI18n("blueprintFlow.satisfactionValue1", { value1: String(b.satisfaction.mean.toFixed(1)) }) : ""}
                  </div>
                </div>
              </button>
            ))}
            <div className="flex justify-end">
              <Button size="sm" variant="primary" onClick={() => setStep(2)} data-testid="tpl-apply-next">{blueprintI18n("blueprintFlow.nextChooseTier")}<ChevronRight aria-hidden className="h-3.5 w-3.5" /></Button>
            </div>
          </section>
        ) : (
          <section className="flex flex-col gap-3" data-testid="tpl-apply-step2">
            <div className="flex flex-col gap-1.5">
              <span className="text-12 font-medium">{blueprintI18n("blueprintFlow.durationTierDefaultsToTheBlueprintSTwoDaysTier")}</span>
              <div className="flex flex-wrap gap-2">
                {DURATION_TIERS.map((t) => (
                  <Button key={t} size="sm" variant={t === tier ? "primary" : "outline"} onClick={() => setTier(t)} data-testid="tpl-apply-tier">
                    {localizeBlueprintCopy(blueprintI18n, TIER_LABEL[t])} · {AGENDA_COUNT_BY_TIER[t]}{blueprintI18n("blueprintFlow.segment2")}</Button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5 rounded-lg border border-border p-3" data-testid="tpl-apply-init-preview">
              <span className="text-12 font-medium">{blueprintI18n("blueprintFlow.whatWillBeInitializedSixTypesBlueprintOverview")}</span>
              <p className="text-11 text-muted-foreground">{blueprintI18n("blueprintFlow.applying")}{bp.name} v{bp.version}」+「{localizeBlueprintCopy(blueprintI18n, TIER_LABEL[tier])}{blueprintI18n("blueprintFlow.writes")}{agenda}{blueprintI18n("blueprintFlow.agendaSegmentsAndTheFollowingSixTypesOfDefaults")}</p>
              <ul className="flex flex-col gap-1">
                {INIT_CATEGORIES.map((c) => (
                  <li key={c.key} className="flex items-center gap-2 text-11" data-testid="tpl-apply-init-item">
                    <Badge tone="primary">{localizeBlueprintCopy(blueprintI18n, c.label)}</Badge>
                    <span className="text-muted-foreground">→ {localizeBlueprintCopy(blueprintI18n, c.lands)}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex items-center justify-between">
              <Button size="sm" variant="ghost" onClick={() => setStep(1)} data-testid="tpl-apply-back">{blueprintI18n("research.previous")}</Button>
              <Button size="sm" variant="primary" onClick={() => setConfirm(true)} data-testid="tpl-apply-create">{blueprintI18n("blueprintFlow.createProject")}</Button>
            </div>
          </section>
        )}
      </StateShell>

      {/* 项目侧缺失概念 —— UC-2.2 是项目唯一出生路径，但「项目」域需求刚被发现缺失 */}
      <ProjectSideGaps />

      <ConfirmDialog
        open={confirm}
        tone="primary"
        title={blueprintI18n("blueprintFlow.createProjectAndBindTheBlueprintSnapshot")}
        confirmLabel={blueprintI18n("blueprintFlow.confirmCreation")}
        onConfirm={() => { setConfirm(false); onToast(canonicalBlueprintCopy("blueprintFlow.projectCreatedWithTheValue1VValue2SnapshotLaterBlueprint", { value1: String(bp.name), value2: String(bp.version) })); }}
        onClose={() => setConfirm(false)}
        impact={
          <div className="flex flex-col gap-1">
            <p>{blueprintI18n("blueprintFlow.allSixInitializationTypesAreWrittenAtomicallyEitherAllSucceed")}</p>
            <p>{blueprintI18n("blueprintFlow.projectBindsTo")}<b>{bp.name} v{bp.version}</b>{blueprintI18n("blueprintFlow.sSpecificVersionSnapshotLaterFacilitatorEditsDoNotModify")}</p>
            <SignoffFlag kind="confirmed-missing" title={blueprintI18n("blueprintFlow.theTwoStepWizardIsADesignChoiceNotSpecified")}>{blueprintI18n("blueprintFlow.r8RecommendsTwoStepsChooseBlueprintThenChooseTierAnd")}</SignoffFlag>
          </div>
        }
      />
    </div>
  );
}

function StepDot({ n, active, label }: { n: number; active: boolean; label: string }) {
 const { t: blueprintI18n } = useI18n();

  return (
    <span className="flex items-center gap-1">
      <span className={cn("flex h-4 w-4 items-center justify-center rounded-full text-10 font-semibold", active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{n}</span>
      <span className={cn(active ? "text-background-foreground" : "text-muted-foreground")}>{localizeBlueprintCopy(blueprintI18n, label)}</span>
    </span>
  );
}
