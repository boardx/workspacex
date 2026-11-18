"use client";
import { canonicalBlueprintCopy, localizeBlueprintCopy } from "@/lib/i18n/blueprint-copy";

import { useI18n } from "@/lib/i18n/provider";

import * as React from "react";
import { GitPullRequestArrow, Check, X, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import type { ProjectRole } from "@/lib/identity";
import { DEVIATIONS, PENDING_CHANGES, type PendingChange } from "@/lib/mock/tpl";
import { ConfirmDialog, SignoffFlag } from "./parts";

export function PromoteScreen({
  uiState, previewRole, onToast,
}: { uiState: UiState; previewRole: ProjectRole | null; onToast: (m: string) => void }) {
 const { t: blueprintI18n } = useI18n();

  // 「蓝本维护者」是谁尚未裁决（缺 D-1）；此处以引导师=不可合并、方法负责人=可合并演示
  const canMerge = previewRole === "facilitator" ? false : true;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 p-4" data-testid="tpl-promote">
      <header className="flex flex-col gap-0.5">
        <h1 className="text-20 font-bold tracking-tight">{blueprintI18n("blueprintFlow.submitProjectImprovementsBackToABlueprint")}</h1>
        <p className="text-12 text-muted-foreground">{blueprintI18n("blueprintFlow.projectEditsDoNotModifyTheBlueprintSubmitBackTo")}</p>
      </header>

      <SignoffFlag kind="unexplored" title={blueprintI18n("blueprintFlow.theUseCaseCannotBeSignedOffOneSideIs")} testid="tpl-promote-flag">{blueprintI18n("blueprintFlow.theProjectRetrospectiveScreenIncludingDeviationsWasNotInspectedSo")}</SignoffFlag>

      <StateShell
        state={uiState}
        skeletonRows={6}
        emptyHint={blueprintI18n("blueprintFlow.thisSessionFollowedTheBlueprintExactlyNoDeviationsToSubmit")}
        errors={{ "promote": blueprintI18n("blueprintFlow.submissionRejectedASelectedItemHasNoReasonReasonsAre") }}
        depFailure={{ what: blueprintI18n("blueprintFlow.theBlueprintSnapshotServiceIsUnavailableSubmissionIsPausedBecause") }}
        denial={{ layer: "project", reason: blueprintI18n("blueprintFlow.observersCannotSubmitImprovementsFacilitatorsSubmitMethodOwnersBlueprintMaintainers") }}
        successMessage={blueprintI18n("blueprintFlow.reviewChangesAttachedToTheBlueprintWithoutChangingContentOr")}
      >
        <div className="grid gap-3 lg:grid-cols-2">
          {/* 项目侧：偏离清单 + 勾选 + 理由 */}
          <ProjectDeviations onToast={onToast} />
          {/* 蓝本侧：待审改动收件面 */}
          <MaintainerInbox canMerge={canMerge} onToast={onToast} />
        </div>
      </StateShell>
    </div>
  );
}

function ProjectDeviations({ onToast }: { onToast: (m: string) => void }) {
 const { t: blueprintI18n } = useI18n();

  const [checked, setChecked] = React.useState<Set<string>>(new Set([DEVIATIONS[0]!.configItemKey]));
  const [reasons, setReasons] = React.useState<Record<string, string>>({});
  const toggle = (k: string) => setChecked((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border p-4" data-testid="tpl-deviations">
      <div className="flex items-center gap-2">
        <GitPullRequestArrow aria-hidden className="h-4 w-4 text-muted-foreground" />
        <span className="text-13 font-semibold">{blueprintI18n("blueprintFlow.projectSideDeviationsRetrospectiveSubmitBackToBlueprint")}</span>
      </div>
      <p className="text-10 text-muted-foreground">{blueprintI18n("blueprintFlow.compareOriginalBlueprintValuesWithSessionValuesForEachConfiguration")}</p>
      <ul className="flex flex-col gap-2">
        {DEVIATIONS.map((d) => {
          const on = checked.has(d.configItemKey);
          return (
            <li key={d.configItemKey} className="flex flex-col gap-1.5 rounded-md border border-border p-2.5" data-testid="tpl-deviation-row">
              <Checkbox
                checked={on}
                onChange={() => toggle(d.configItemKey)}
                data-testid="tpl-deviation-check"
                label={<span className="text-12 font-medium">{d.configItemLabel}</span>}
                description={<span>{blueprintI18n("blueprintFlow.blueprintValue")}{d.before}{blueprintI18n("blueprintFlow.sessionValue")}{d.after}</span>}
              />
              {on && (
                <Input
                  placeholder={blueprintI18n("blueprintFlow.whyRetainThisInTheBlueprintRequired")}
                  value={reasons[d.configItemKey] ?? ""}
                  onChange={(e) => setReasons((r) => ({ ...r, [d.configItemKey]: e.target.value }))}
                  data-testid="tpl-deviation-reason"
                />
              )}
            </li>
          );
        })}
      </ul>
      <Button
        size="sm"
        variant="primary"
        className="w-fit"
        onClick={() => onToast(canonicalBlueprintCopy("blueprintFlow.submittedReviewChangesAwaitingBlueprintMaintainerReviewSubmissionDoesNot"))}
        data-testid="tpl-promote-submit"
      >{blueprintI18n("blueprintFlow.submitBackToBlueprint")}</Button>
      <p className="text-10 text-muted-foreground">{blueprintI18n("blueprintFlow.submittedAwaitingMaintainerReviewNotYetEffective")}</p>
    </section>
  );
}

function MaintainerInbox({ canMerge, onToast }: { canMerge: boolean; onToast: (m: string) => void }) {
 const { t: blueprintI18n } = useI18n();

  const [merging, setMerging] = React.useState<PendingChange | null>(null);
  // 同一处（流程 Agenda）被多场改过 → 并排显示各自理由
  const grouped = PENDING_CHANGES.reduce<Record<string, PendingChange[]>>((acc, c) => {
    (acc[c.configItemLabel] ??= []).push(c);
    return acc;
  }, {});

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border p-4" data-testid="tpl-inbox">
      <div className="flex items-center gap-2">
        <Inbox aria-hidden className="h-4 w-4 text-muted-foreground" />
        <span className="text-13 font-semibold">{blueprintI18n("blueprintFlow.blueprintSideReviewInbox")}</span>
        <Badge tone="warning" className="ml-auto">{PENDING_CHANGES.length}{blueprintI18n("blueprintFlow.pendingReview")}</Badge>
      </div>
      <SignoffFlag kind="confirmed-missing" title={blueprintI18n("blueprintFlow.thisInboxAndItsEntryBadgeAndNotificationsAreConfirmed")}>{blueprintI18n("blueprintFlow.entryLocationListRowDesignerHeaderOrSeparateInboxUnread")}</SignoffFlag>
      {Object.entries(grouped).map(([label, changes]) => (
        <div key={label} className="flex flex-col gap-1.5 rounded-md border border-border p-2.5" data-testid="tpl-inbox-group">
          <div className="flex items-center gap-2">
            <span className="text-12 font-medium">{localizeBlueprintCopy(blueprintI18n, label)}</span>
            {changes.length > 1 && <Badge tone="outline">{blueprintI18n("blueprintFlow.sameField")}{changes.length}{blueprintI18n("blueprintFlow.sessionsSubmittedImprovementsCompareReasons")}</Badge>}
          </div>
          {changes.map((c) => (
            <div key={c.id} className="flex flex-col gap-1 border-t border-border/60 pt-1.5" data-testid="tpl-inbox-item">
              <div className="text-11">{c.before} → <b>{c.after}</b></div>
              <div className="text-10 text-muted-foreground">{blueprintI18n("chatEscalation.reasonPrefix")}{c.rationale}</div>
              <div className="text-10 text-muted-foreground">{blueprintI18n("chatInspector.sourceUrl")}{c.sourceProject} · {c.proposedBy} · {c.proposedAt}{blueprintI18n("blueprintFlow.basedOnV")}{c.baseVersion}</div>
              <div className="flex items-center gap-1.5">
                <Button size="xs" variant="outline" disabled={!canMerge} onClick={() => setMerging(c)} data-testid="tpl-inbox-accept"><Check aria-hidden className="h-3 w-3" />{blueprintI18n("blueprintFlow.accept")}</Button>
                <Button size="xs" variant="ghost" disabled={!canMerge} onClick={() => onToast(canonicalBlueprintCopy("blueprintFlow.rejectedValue1FromValue2", { value1: String(c.configItemLabel), value2: String(c.sourceProject) }))} data-testid="tpl-inbox-reject"><X aria-hidden className="h-3 w-3" />{blueprintI18n("chatPermissions.deny")}</Button>
                {!canMerge && <span className="text-10 text-muted-foreground">{blueprintI18n("blueprintFlow.onlyBlueprintMaintainersCanMerge")}</span>}
              </div>
            </div>
          ))}
        </div>
      ))}

      <ConfirmDialog
        open={!!merging}
        tone="primary"
        title={blueprintI18n("blueprintFlow.acceptAndMergeChangesIntoTheBlueprintDraft")}
        confirmLabel={blueprintI18n("blueprintFlow.confirmMerge")}
        onConfirm={() => { onToast(canonicalBlueprintCopy("blueprintFlow.acceptedValue1AddedToBlueprintDraftPublicationStillFollowsUC", { value1: String(merging?.configItemLabel) })); setMerging(null); }}
        onClose={() => setMerging(null)}
        impact={
          <div className="flex flex-col gap-1">
            <p>{blueprintI18n("blueprintFlow.acceptedChangesEnterTheBlueprintS")}<b>{blueprintI18n("canvas.draft2")}</b>{blueprintI18n("blueprintFlow.draftWithoutChangingTheCurrentVersionPublicationStillRequiresCompleted")}</p>
            <p className="text-muted-foreground">{blueprintI18n("blueprintFlow.eachMergedFieldCanTraceItsSourceProjectAuthorTime")}</p>
          </div>
        }
      />
    </section>
  );
}
