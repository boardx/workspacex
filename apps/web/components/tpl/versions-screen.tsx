"use client";
import { canonicalBlueprintCopy } from "@/lib/i18n/blueprint-copy";

import { useI18n } from "@/lib/i18n/provider";

import * as React from "react";
import { History, RotateCcw, Lock, CircleDot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import type { ProjectRole } from "@/lib/identity";
import { VERSION_HISTORY, CONFIG_ITEMS, type BlueprintVersion } from "@/lib/mock/tpl";
import { ConfirmDialog, SignoffFlag } from "./parts";

const labelOf = (key: string) => CONFIG_ITEMS.find((i) => i.key === key)?.label ?? key;

export function VersionsScreen({
  uiState, previewRole, onToast,
}: { uiState: UiState; previewRole: ProjectRole | null; onToast: (m: string) => void }) {
 const { t: blueprintI18n } = useI18n();

  const [rollback, setRollback] = React.useState<BlueprintVersion | null>(null);
  const current = VERSION_HISTORY[0]!; // v4 当前已发布
  const nextVersion = current.versionNumber + 2; // 回滚 = 新建 v(n+1)；此处示意 v6

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-4" data-testid="tpl-versions">
      <header className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <h1 className="text-20 font-bold tracking-tight">{blueprintI18n("blueprintFlow.versionsAndLockingHMW")}</h1>
          <Badge tone="primary">{blueprintI18n("blueprintFlow.currentV")}{current.versionNumber}</Badge>
        </div>
        <p className="text-12 text-muted-foreground">{blueprintI18n("blueprintFlow.changesCreateV")}{current.versionNumber + 1}{blueprintI18n("blueprintFlow.existingProjectsRetainTheirPinnedVersions2")}</p>
      </header>

      <SignoffFlag kind="confirmed-missing" title={blueprintI18n("blueprintFlow.versionHistoryRollbackEntryAndConfirmationAndDeletionImpactAre")} testid="tpl-versions-flag">{blueprintI18n("blueprintFlow.neitherDesignerNorListHasVersionHistoryRollbackOrDeletion")}</SignoffFlag>

      <StateShell
        state={uiState}
        skeletonRows={5}
        emptyHint={blueprintI18n("blueprintFlow.thisBlueprintIsStillADraftWithNoPublishedVersion")}
        errors={{ "rollback": blueprintI18n("blueprintFlow.rollbackRejectedTargetV4IsUsedBy3ActiveProjects") }}
        depFailure={{ what: blueprintI18n("blueprintFlow.versionStorageIsUnavailableVersionDiffsAndRollbackCalculationsAre") }}
        denial={{ layer: "organization", reason: blueprintI18n("blueprintFlow.methodOwnersPublishArchiveRollBackAndDeleteObserversAnd") }}
        successMessage={blueprintI18n("blueprintFlow.rolledBackCreatedVValue1WithV3ContentV3And", { value1: String(nextVersion) })}
      >
        <ul className="flex flex-col gap-2" data-testid="tpl-version-list">
          {VERSION_HISTORY.map((v) => (
            <li key={v.versionNumber} className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-3" data-testid="tpl-version-row">
              <div className="flex flex-wrap items-center gap-2">
                {v.versionNumber === current.versionNumber
                  ? <CircleDot aria-hidden className="h-3.5 w-3.5 text-primary" />
                  : <History aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />}
                <span className="text-13 font-semibold">v{v.versionNumber}</span>
                {v.state === "published"
                  ? <Badge tone="primary">{blueprintI18n("blueprintFlow.publishedCurrent")}</Badge>
                  : <Badge tone="neutral">{blueprintI18n("canvas.archived")}</Badge>}
                {v.rolledBackFrom && <Badge tone="outline">{blueprintI18n("blueprintFlow.rolledBackFromV")}{v.rolledBackFrom}</Badge>}
                {v.usedByActiveProjects > 0 && <Badge tone="warning" data-testid="tpl-version-locked"><Lock aria-hidden className="h-2.5 w-2.5" /> {v.usedByActiveProjects}{blueprintI18n("blueprintFlow.activeProjectsPinned")}</Badge>}
              </div>
              <div className="text-11 text-muted-foreground">
                {v.publishedBy}{blueprintI18n("blueprintFlow.publishedOn")}{v.publishedAt}
              </div>
              <div className="flex flex-wrap items-center gap-1" data-testid="tpl-version-diff">
                <span className="text-10 text-muted-foreground">{blueprintI18n("blueprintFlow.changes")}</span>
                {v.changedConfigItemKeys.length
                  ? v.changedConfigItemKeys.map((k) => <Badge key={k} tone="outline">{labelOf(k)}</Badge>)
                  : <span className="text-10 text-muted-foreground">{blueprintI18n("blueprintFlow.firstVersion")}</span>}
              </div>
              {v.versionNumber !== current.versionNumber && (
                <div>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={v.usedByActiveProjects > 0}
                    onClick={() => setRollback(v)}
                    data-testid="tpl-version-rollback"
                  >
                    <RotateCcw aria-hidden className="h-3 w-3" />{blueprintI18n("blueprintFlow.rollBackToThisVersion")}</Button>
                  {v.usedByActiveProjects > 0 && <span className="ml-2 text-10 text-muted-foreground">{blueprintI18n("blueprintFlow.usedByActiveProjectsUnavailableAsARollbackTarget")}</span>}
                </div>
              )}
            </li>
          ))}
        </ul>
      </StateShell>

      <ConfirmDialog
        open={!!rollback}
        tone="primary"
        title={blueprintI18n("blueprintFlow.rollBackToVValue1SContent", { value1: String(rollback?.versionNumber) })}
        confirmLabel={blueprintI18n("blueprintFlow.confirmRollback")}
        requireReason
        onConfirm={() => { onToast(canonicalBlueprintCopy("blueprintFlow.rolledBackCreatedVValue1WithVValue2ContentHistory", { value1: String(nextVersion), value2: String(rollback?.versionNumber) })); setRollback(null); }}
        onClose={() => setRollback(null)}
        impact={
          <div className="flex flex-col gap-1">
            <p>{blueprintI18n("blueprintFlow.rollbackDoesNotMoveAPointerBackwardItWill")}<b>{blueprintI18n("blueprintFlow.createV")}{nextVersion}</b>{blueprintI18n("blueprintFlow.withContentMatchingV")}{rollback?.versionNumber}{blueprintI18n("blueprintFlow.andRecord")}<code>rolled_back_from=v{rollback?.versionNumber}</code>。</p>
            <p className="text-muted-foreground">v{rollback?.versionNumber}{blueprintI18n("blueprintFlow.theCurrentV4RecordRemainsUnchangedAndExistingProjectsRetain")}</p>
            <p className="text-muted-foreground">{blueprintI18n("blueprintFlow.theRollbackReasonWillBeAudited")}</p>
          </div>
        }
      />
    </div>
  );
}
