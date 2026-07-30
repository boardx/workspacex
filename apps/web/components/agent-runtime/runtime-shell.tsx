"use client";
import * as React from "react";
import { StateShell, StatePreviewSwitcher } from "@/components/state/state-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { UiState } from "@/lib/ui-state";
import {
  RUNTIME_SCREENS, RUNTIME_ROLES, RUNTIME_ROLE_LABEL,
  type RuntimeScreenKey, type RuntimeRole,
} from "@/lib/mock/agent-runtime";

/**
 * agent-runtime 预览的统一屏骨架 —— 承载「屏 / 视角 / 七态」三行控制条 + StateShell。
 *
 * ⚠ 复用共享 StateShell（七态单一实现）与 StatePreviewSwitcher，不各屏自造异常态——
 *   避免重现旧原型「每屏一套、都不完整」的老问题。生产构建下预览控制条不渲染。
 * ⚠ 视角切换只是**界面投影**，真实权限在服务端（NestJS Guard + RLS）。
 */
export function RuntimeShell({
  screen, role, state, title, intro, children,
  roles, emptyHint, errors, depFailure, denialReason, successMessage,
}: {
  screen: RuntimeScreenKey;
  role: RuntimeRole;
  state: UiState;
  title: string;
  intro: React.ReactNode;
  children: React.ReactNode;
  /** 本屏相关的角色子集（R5 列了几个就放几个），用于视角切换器 */
  roles: RuntimeRole[];
  emptyHint: string;
  errors?: Record<string, string>;
  depFailure?: string;
  denialReason: string;
  successMessage: string;
}) {
  const meta = RUNTIME_SCREENS.find((s) => s.key === screen);
  const q = (patch: Record<string, string>) => {
    const base: Record<string, string> = { screen, as: role, state };
    return "?" + new URLSearchParams({ ...base, ...patch }).toString();
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h1 className="text-20 font-semibold tracking-tight">{title}</h1>
          {meta && <Badge tone="outline" data-testid="runtime-uc-ref">{meta.uc}</Badge>}
        </div>
        <p className="text-13 text-muted-foreground">{intro}</p>
      </div>

      {/* 控制条一 · 屏 */}
      <div className="flex flex-wrap items-center gap-1 rounded-md border border-border-subtle bg-panel p-1" data-testid="runtime-screen-switcher">
        <span className="px-1 text-10 uppercase tracking-wide text-muted-foreground">屏</span>
        {RUNTIME_SCREENS.map((s) => (
          <Button key={s.key} asChild size="xs" variant={s.key === screen ? "primary" : "ghost"} data-testid={`runtime-screen-${s.key}`}>
            <a href={q({ screen: s.key })}>{s.label}</a>
          </Button>
        ))}
      </div>

      {/* 控制条二 · 视角（预览手段，非权限实现） */}
      <div className="flex flex-wrap items-center gap-1 rounded-md border border-border-subtle bg-panel p-1" data-testid="runtime-role-switcher">
        <span className="px-1 text-10 uppercase tracking-wide text-muted-foreground">视角</span>
        {RUNTIME_ROLES.filter((r) => roles.includes(r.key)).map((r) => (
          <Button key={r.key} asChild size="xs" variant={r.key === role ? "primary" : "ghost"} data-testid={`runtime-role-${r.key}`}>
            <a href={q({ as: r.key })}>{r.label}</a>
          </Button>
        ))}
      </div>

      {/* 控制条三 · 七态 */}
      <StatePreviewSwitcher current={state} />

      <StateShell
        state={state}
        emptyHint={emptyHint}
        onCreate={() => {}}
        errors={errors}
        depFailure={depFailure ? { what: depFailure, retry: () => {} } : undefined}
        denial={{ layer: "organization", reason: `${denialReason}（当前视角：${RUNTIME_ROLE_LABEL[role]}）` }}
        successMessage={successMessage}
        skeletonRows={5}
      >
        {children}
      </StateShell>
    </div>
  );
}

/** 屏内小节标题。 */
export function SectionTitle({ children, hint, testid }: { children: React.ReactNode; hint?: string; testid?: string }) {
  return (
    <div className="flex flex-col gap-0.5" data-testid={testid}>
      <h2 className="text-14 font-semibold">{children}</h2>
      {hint && <p className="text-11 text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** 「我替 UC 做的判断 / 待裁决」的界面内标记 —— 让 sign-off 的争议点在屏上就看得见。 */
export function DecisionNote({ children, tone = "warning", testid }: { children: React.ReactNode; tone?: "warning" | "ai"; testid?: string }) {
  const cls = tone === "ai"
    ? "border-ai/25 bg-ai-tint text-ai-tint-foreground"
    : "border-warning/30 bg-warning/5";
  return (
    <p className={`rounded-md border ${cls} px-3 py-2 text-11`} data-testid={testid}>
      {children}
    </p>
  );
}
