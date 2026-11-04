"use client";

import { workflowDisplayName } from "@/lib/workflow-display-copy";
import { useI18n } from "@/lib/i18n/provider";
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { capabilityLevelCopy, capabilityCopy } from "@/lib/workflow-capability-grant-copy";
import type { SideEffectCap } from "@/lib/live-workflow-capability-grants";
import { covers, type CapabilityRow } from "./workflow-grant-model";

const LEVELS = ["read", "write", "external_send"] as const;
type Level = (typeof LEVELS)[number];

/**
 * 调整一项能力的权限等级 —— 先选等级、看影响、再确认。
 * 选「只读」= 撤销授权（回到默认）；等级不变时确认按钮禁用，避免产生一条无意义的审计记录。
 */
export function WorkflowGrantDialog({
  row, busy, error, onCancel, onConfirm,
}: {
  row: CapabilityRow | null;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (level: Level) => void;
}) {
  const { locale, t } = useI18n();
  const initial: Level = row ? (row.blocked.length > 0 ? toLevel(row.requiredMax) : toLevel(row.current)) : "read";
  const [level, setLevel] = React.useState<Level>(initial);
  React.useEffect(() => setLevel(initial), [row?.category, initial]);

  if (!row) return null;
  const copy = capabilityCopy(row.category, locale);
  const current = toLevel(row.current);
  const unchanged = level === current && row.grant.configured === (level !== "read");
  const revoking = level === "read";
  const stillBlocked = row.uses.filter((u) => !covers(level, u.requiredCap));
  const unblocked = row.uses.filter((u) => covers(level, u.requiredCap) && !covers(row.current, u.requiredCap));

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
      <DialogContent className="max-w-lg overflow-y-auto" data-testid="workflow-grant-dialog" closeTestId="workflow-grant-dialog-close">
        <DialogHeader>
          <DialogTitle className="text-16 font-semibold">{t("workflowGrants.dialogTitle", { label: copy.label })}</DialogTitle>
          <DialogDescription className="text-12 text-muted-foreground">
            {copy.allows} {t("workflowGrants.dialogHint")}
          </DialogDescription>
        </DialogHeader>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-12 font-medium">{t("workflowGrants.levels")}</legend>
          {LEVELS.map((l) => (
            <label
              key={l}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-control border p-3 transition-colors duration-fast",
                "focus-within:ring-2 focus-within:ring-ring",
                level === l ? "border-primary bg-accent" : "border-border hover:bg-muted",
              )}
            >
              <input
                type="radio"
                name="workflow-grant-level"
                value={l}
                checked={level === l}
                onChange={() => setLevel(l)}
                className="mt-0.5 accent-primary"
                data-testid={`workflow-grant-level-${l}`}
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-13 font-medium">
                  {capabilityLevelCopy(l, locale).label}
                  {l === current ? <span className="ml-2 text-11 font-normal text-muted-foreground">{t("workflowGrants.current")}</span> : null}
                  {l !== "read" && row.uses.some((u) => u.requiredCap === l) ? (
                    <span className="ml-2 text-11 font-normal text-muted-foreground" data-testid={`workflow-grant-level-needed-by-${l}`}>
                      {t("workflowGrants.neededBy", { titles: row.uses.filter((u) => u.requiredCap === l).map((u) => t("workflowGrants.workflowQuote", { title: workflowDisplayName(u.workflowKey, u.title, locale) })).join(t("workflowGrants.neededSeparator")) })}
                    </span>
                  ) : null}
                </span>
                <span className="text-12 text-muted-foreground">{capabilityLevelCopy(l, locale).description}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="flex flex-col gap-1.5 rounded-control bg-muted p-3 text-12" data-testid="workflow-grant-impact">
          <p className="font-medium">{t("workflowGrants.impact")}</p>
          {unblocked.length > 0 ? (
            <p>{t("workflowGrants.unblocked", { titles: unblocked.map((u) => workflowDisplayName(u.workflowKey, u.title, locale)).join(t("workflowGrants.listSeparator")) })}</p>
          ) : null}
          {stillBlocked.length > 0 ? (
            <p className="text-destructive">
              {t("workflowGrants.stillBlocked", { titles: stillBlocked.map((u) => workflowDisplayName(u.workflowKey, u.title, locale)).join(t("workflowGrants.listSeparator")) })}
            </p>
          ) : (
            <p className="text-muted-foreground">{t("workflowGrants.allReady")}</p>
          )}
          <p className="text-muted-foreground">{t("workflowGrants.auditHint")}</p>
        </div>

        {error ? <p role="alert" className="text-12 text-destructive">{error}</p> : null}

        <DialogFooter className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={busy} data-testid="workflow-grant-cancel">{t("workflowGrants.cancel")}</Button>
          <Button
            variant={revoking ? "destructive" : "primary"}
            disabled={busy || unchanged}
            onClick={() => onConfirm(level)}
            data-testid="workflow-grant-confirm"
          >
            {busy ? t("workflowGrants.saving") : unchanged ? t("workflowGrants.unchanged") : revoking ? t("workflowGrants.confirmRevoke") : t("workflowGrants.confirmGrant", { level: capabilityLevelCopy(level, locale).label })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function toLevel(cap: SideEffectCap): Level {
  return cap === "none" ? "read" : cap;
}
