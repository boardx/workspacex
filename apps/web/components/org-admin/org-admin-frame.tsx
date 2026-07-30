"use client";
import * as React from "react";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";

/**
 * org-admin 各屏共用骨架 —— 标题 + 引导 + 七态承载（走 StateShell）。
 *
 * ⚠ 已有原型是 happy path、零异常态。这里让每屏的七态经同一个 StateShell，
 *   不各写一套空/错/拒绝态（重现「每屏一套、都不完整」正是要避免的）。
 * 七态作用在**主内容区**；标题与引导条常驻，便于对照 sign-off。
 */
export function OrgAdminFrame({
  state, title, intro, uc, children,
  emptyHint, errors, depFailure, denial, successMessage, skeletonRows = 5,
}: {
  state: UiState;
  title: string;
  intro: React.ReactNode;
  uc: string;
  children: React.ReactNode;
  emptyHint: string;
  errors?: Record<string, string>;
  depFailure?: string;
  denial: { layer: "organization" | "project"; reason: string };
  successMessage: string;
  skeletonRows?: number;
}) {
  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h1 className="text-20 font-semibold tracking-tight">{title}</h1>
          <span className="rounded-sm border border-border px-1.5 py-0.5 text-10 text-muted-foreground">{uc}</span>
        </div>
        <p className="text-13 text-muted-foreground">{intro}</p>
      </div>

      <StateShell
        state={state}
        emptyHint={emptyHint}
        onCreate={() => {}}
        errors={errors}
        depFailure={depFailure ? { what: depFailure, retry: () => {} } : undefined}
        denial={denial}
        successMessage={successMessage}
        skeletonRows={skeletonRows}
      >
        {children}
      </StateShell>
    </div>
  );
}
