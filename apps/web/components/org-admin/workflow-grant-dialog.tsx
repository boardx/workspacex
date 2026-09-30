"use client";

import { workflowDisplayName } from "@/lib/workflow-display-copy";
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { CAP_LEVEL, capabilityCopy } from "@/lib/workflow-capability-grant-copy";
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
  const initial: Level = row ? (row.blocked.length > 0 ? toLevel(row.requiredMax) : toLevel(row.current)) : "read";
  const [level, setLevel] = React.useState<Level>(initial);
  React.useEffect(() => setLevel(initial), [row?.category, initial]);

  if (!row) return null;
  const copy = capabilityCopy(row.category);
  const current = toLevel(row.current);
  const unchanged = level === current && row.grant.configured === (level !== "read");
  const revoking = level === "read";
  const stillBlocked = row.uses.filter((u) => !covers(level, u.requiredCap));
  const unblocked = row.uses.filter((u) => covers(level, u.requiredCap) && !covers(row.current, u.requiredCap));

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
      <DialogContent className="max-w-lg" data-testid="workflow-grant-dialog" closeTestId="workflow-grant-dialog-close">
        <DialogHeader>
          <DialogTitle className="text-16 font-semibold">调整「{copy.label}」权限</DialogTitle>
          <DialogDescription className="text-12 text-muted-foreground">
            {copy.allows} 这项设置对本组织所有使用它的工作流同时生效。
          </DialogDescription>
        </DialogHeader>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-12 font-medium">权限等级</legend>
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
                  {CAP_LEVEL[l].label}
                  {l === current ? <span className="ml-2 text-11 font-normal text-muted-foreground">当前</span> : null}
                  {l !== "read" && row.uses.some((u) => u.requiredCap === l) ? (
                    <span className="ml-2 text-11 font-normal text-muted-foreground" data-testid={`workflow-grant-level-needed-by-${l}`}>
                      {row.uses.filter((u) => u.requiredCap === l).map((u) => `「${workflowDisplayName(u.workflowKey, u.title)}」`).join("")}需要
                    </span>
                  ) : null}
                </span>
                <span className="text-12 text-muted-foreground">{CAP_LEVEL[l].description}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="flex flex-col gap-1.5 rounded-control bg-muted p-3 text-12" data-testid="workflow-grant-impact">
          <p className="font-medium">确认后的影响</p>
          {unblocked.length > 0 ? (
            <p>可以继续运行：{unblocked.map((u) => workflowDisplayName(u.workflowKey, u.title)).join("、")}</p>
          ) : null}
          {stillBlocked.length > 0 ? (
            <p className="text-destructive">
              会在对应步骤暂停，等待管理员授权：{stillBlocked.map((u) => workflowDisplayName(u.workflowKey, u.title)).join("、")}
            </p>
          ) : (
            <p className="text-muted-foreground">所有用到这项能力的工作流都能正常完成。</p>
          )}
          <p className="text-muted-foreground">每次调整都会记入下方的变更记录。</p>
        </div>

        {error ? <p role="alert" className="text-12 text-destructive">{error}</p> : null}

        <DialogFooter className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={busy} data-testid="workflow-grant-cancel">取消</Button>
          <Button
            variant={revoking ? "destructive" : "primary"}
            disabled={busy || unchanged}
            onClick={() => onConfirm(level)}
            data-testid="workflow-grant-confirm"
          >
            {busy ? "正在保存…" : unchanged ? "等级未改变" : revoking ? "确认撤销，恢复只读" : `确认授予「${CAP_LEVEL[level].label}」`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function toLevel(cap: SideEffectCap): Level {
  return cap === "none" ? "read" : cap;
}
