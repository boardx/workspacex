"use client";
import { canonicalBlueprintCopy, localizeBlueprintCopy } from "@/lib/i18n/blueprint-copy";

import { useI18n } from "@/lib/i18n/provider";

import * as React from "react";
import { ArrowLeft, Check, Eye, Play, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import type { ProjectRole } from "@/lib/identity";
import { cn } from "@/lib/utils";
import {
  CONFIG_ITEMS, CONFIG_GROUPS, configTotal, configDoneCount,
  blockingRequiredItems, publishBlockers, type ConfigItem,
} from "@/lib/mock/tpl";
import { PANEL_RENDERERS } from "./designer-panels";
import { ConfirmDialog, SignoffFlag } from "./parts";

const RULE = "蓝本管骨架与默认值，不管具体内容。套用后引导师可逐场覆盖，改动只影响那一场。";

export function DesignerScreen({
  uiState, previewRole: _previewRole, onToast,
}: { uiState: UiState; previewRole: ProjectRole | null; onToast: (m: string) => void }) {
 const { t: blueprintI18n } = useI18n();

  const [selKey, setSelKey] = React.useState<string>(CONFIG_ITEMS[0]!.key);
  const [confirmPublish, setConfirmPublish] = React.useState(false);

  const total = configTotal();
  const done = configDoneCount();
  const blockers = publishBlockers(); // 界面真正演示的门槛：降级 Skill 未替换（原型明写）
  const requiredBlocking = blockingRequiredItems(); // D-2 未定的次级清单，仅作提示
  const nextVersion = 5;
  const selected = CONFIG_ITEMS.find((i) => i.key === selKey)!;
  const Panel = PANEL_RENDERERS[selKey]!;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col gap-1.5 border-b border-border px-4 py-3" data-testid="tpl-designer-header">
        <div className="flex items-center gap-2">
          <Button size="icon" variant="ghost" aria-label={blueprintI18n("blueprintFlow.backToBlueprintList")} data-testid="tpl-designer-back"><ArrowLeft aria-hidden className="h-4 w-4" /></Button>
          <h1 className="text-16 font-semibold">{blueprintI18n("blueprintFlow.hMWBlueprintDesign")}</h1>
        </div>
        <p className="text-12 text-muted-foreground" data-testid="tpl-version-line">{blueprintI18n("blueprintFlow.v4PublishedUsed12Times")}<span className="text-background-foreground">{blueprintI18n("blueprintFlow.changesCreateV")}{nextVersion}{blueprintI18n("blueprintFlow.existingProjectsRetainTheirPinnedVersion")}</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral" data-testid="tpl-autosave">{blueprintI18n("blueprintFlow.draftAutosaved1452")}</Badge>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => onToast(canonicalBlueprintCopy("blueprintFlow.renderThisDraftWithParticipantVisibilityReadOnlyWithoutChanging"))} data-testid="tpl-preview-participant"><Eye aria-hidden className="h-3.5 w-3.5" />{blueprintI18n("blueprintFlow.previewParticipantView")}</Button>
            <Button size="sm" variant="outline" onClick={() => onToast(canonicalBlueprintCopy("blueprintFlow.trialInstanceCreatedFromThisDraftAndMarkedTriedDoes"))} data-testid="tpl-trial-run"><Play aria-hidden className="h-3.5 w-3.5" />{blueprintI18n("blueprintFlow.runATrialSession")}</Button>
            <Button size="sm" variant="primary" onClick={() => setConfirmPublish(true)} data-testid="tpl-publish"><Rocket aria-hidden className="h-3.5 w-3.5" />{blueprintI18n("blueprintFlow.publishV")}{nextVersion}</Button>
          </div>
        </div>
        <p className="rounded-md bg-panel px-2.5 py-1.5 text-11 text-muted-foreground" data-testid="tpl-rule-sentence">{localizeBlueprintCopy(blueprintI18n, RULE)}</p>
      </header>

      <StateShell
        state={uiState}
        className="flex min-h-0 flex-1"
        skeletonRows={8}
        emptyHint={blueprintI18n("blueprintFlow.newBlueprintValue1FieldsNoneConfiguredCompleteThemToPreview", { value1: String(total) })}
        errors={{
          publish: blockers.length
            ? blueprintI18n("blueprintFlow.cannotPublishValue1", { value1: String(blockers.map((b) => localizeBlueprintCopy(blueprintI18n, b.reason)).join("；")) })
            : blueprintI18n("blueprintFlow.cannotPublishThisDraftHasNotBeenTriedSelectRun"),
        }}
        depFailure={{ what: blueprintI18n("blueprintFlow.theModelCatalog20ModelIsUnavailableModelPoliciesRequire") }}
        denial={{ layer: "project", reason: blueprintI18n("blueprintFlow.observersCannotEditBlueprintsOrViewUnpublishedDraftsTheyCan") }}
        successMessage={blueprintI18n("blueprintFlow.vValue1PublishedV4ArchivedExistingProjectsRemainPinnedTo", { value1: String(nextVersion) })}
      >
        <div className="flex min-h-0 w-full flex-col lg:flex-row" data-testid="tpl-designer-canvas">
          <ConfigDirectory total={total} done={done} selKey={selKey} onSelect={setSelKey} />
          <div className="min-h-0 flex-1 overflow-y-auto p-4" data-testid="tpl-panel-body">
            <Panel item={selected} />
          </div>
        </div>
      </StateShell>

      <ConfirmDialog
        open={confirmPublish}
        title={blueprintI18n("blueprintFlow.publishVValue1", { value1: String(nextVersion) })}
        tone="primary"
        confirmLabel={blockers.length ? blueprintI18n("blueprintFlow.blockedCannotPublish") : blueprintI18n("blueprintFlow.confirmPublicationOfVValue1", { value1: String(nextVersion) })}
        onConfirm={() => { setConfirmPublish(false); onToast(canonicalBlueprintCopy("blueprintFlow.vValue1PublishedV4ArchivedAutomaticallyExistingProjectsRemainPinned", { value1: String(nextVersion) })); }}
        onClose={() => setConfirmPublish(false)}
        impact={
          <div className="flex flex-col gap-1.5">
            <p>{blueprintI18n("blueprintFlow.prePublicationChecksGatesStatedInThePrototype")}</p>
            {blockers.length
              ? blockers.map((b) => <p key={b.reason} className="flex items-start gap-1.5 text-destructive"><span>✗</span>{localizeBlueprintCopy(blueprintI18n, b.reason)}</p>)
              : <p className="flex items-center gap-1.5 text-success">{blueprintI18n("blueprintFlow.noDowngradedSkillsReadyToPublish")}</p>}
            <p className="text-muted-foreground">{blueprintI18n("blueprintFlow.afterPassingCreateV")}{nextVersion}{blueprintI18n("blueprintFlow.andArchiveV4")}<b>{blueprintI18n("blueprintFlow.existingProjectsRetainTheirPinnedVersions")}</b>{blueprintI18n("blueprintFlow.andAreUnaffected")}</p>
            {requiredBlocking.length > 0 && (
              <SignoffFlag kind="note" title={blueprintI18n("blueprintFlow.theRequiredFieldsPublicationGateIsNotYetDefinedD")}>{blueprintI18n("blueprintFlow.all16ItemsAreConfigured1616WithNoIncomplete")}</SignoffFlag>
            )}
          </div>
        }
      />
    </div>
  );
}

/* ── 左：16 面板目录 + 完成度侧栏 ─────────────────────────────────────── */

function ConfigDirectory({
  total, done, selKey, onSelect,
}: {
  total: number; done: number; selKey: string; onSelect: (k: string) => void;
}) {
 const { t: blueprintI18n } = useI18n();

  return (
    <aside className="shrink-0 overflow-y-auto border-b border-border p-3 lg:w-60 lg:border-b-0 lg:border-r" data-testid="tpl-config-directory">
      <div className="mb-2 flex items-baseline gap-2 px-1">
        {/* 原型原文「设计环节」按 D-03 已正名为「设计配置」；计数分母恒读表（禁止硬编码 16/15）*/}
        <span className="text-12 font-semibold">{blueprintI18n("blueprintFlow.designSettings")}</span>
        <span className="font-mono text-11 text-success" data-testid="tpl-completion">{done} / {total}</span>
      </div>
      <Progress value={done} max={total} label={blueprintI18n("blueprintFlow.completenessValue1Value2", { value1: String(done), value2: String(total) })} className="mb-3" />
      {CONFIG_GROUPS.map((g) => {
        const items = CONFIG_ITEMS.filter((i) => i.group === g.key);
        return (
          <div key={g.key} className="mb-2">
            {g.divider && (
              <div className="mb-1 px-1 pt-2 text-10 uppercase tracking-wide text-muted-foreground" data-testid="tpl-config-group">{localizeBlueprintCopy(blueprintI18n, g.label)}</div>
            )}
            <ul className="flex flex-col gap-0.5">
              {items.map((i) => (
                <li key={i.key}>
                  <button
                    type="button"
                    onClick={() => onSelect(i.key)}
                    data-testid="tpl-config-item"
                    className={cn(
                      "flex w-full items-center gap-1.5 rounded-md border-l-2 px-2 py-1.5 text-left text-12 transition-colors duration-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      i.key === selKey
                        ? "border-primary bg-accent text-accent-foreground"
                        : "border-transparent hover:bg-muted",
                    )}
                  >
                    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", i.done ? "bg-success" : "bg-muted-foreground/40")} />
                    <span className="flex-1 truncate">{localizeBlueprintCopy(blueprintI18n, i.label)}</span>
                    {i.required && <Badge tone="outline" data-testid="tpl-required-tag">{blueprintI18n("canvas.required")}</Badge>}
                    {i.count && <span className="font-mono text-10 text-muted-foreground">{i.count}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <div className="mt-1 flex items-center gap-1 px-2 py-1 text-10 text-success" data-testid="tpl-config-groupdone">
        <Check aria-hidden className="h-3 w-3" />{blueprintI18n("blueprintFlow.1616ConfiguredReadyToPublish")}</div>
    </aside>
  );
}
