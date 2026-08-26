import * as React from "react";
import Link from "next/link";
import { OrchestrationPreview } from "@/components/live-collab/orchestration-preview";
import {
  LC_SCREENS, LC_SCREEN_LABEL, LC_STATES, LC_STATE_LABEL,
  resolveLcScreen, resolveLcState, resolveLcRole,
} from "@/lib/mock/live-collab-orchestration";
import { PROJECT_ROLE_LABEL, PROJECT_ROLES } from "@/lib/identity";

/**
 * Phase 10「现场协作编排」UI 先行原型入口 —— ADR-023 签核第 ① 件（UI）材料。
 *
 * ⚠ 纯前端 mock，**不接后端**。顶部三排切换器（屏 / 界面态 / 视角）是**预览手段**，
 *   不是权限实现——真实权限在服务端 RLS，视角切换只做界面投影。
 */
export default function LiveCollabOrchestrationPreviewPage({
  searchParams,
}: {
  searchParams: { screen?: string; state?: string; as?: string };
}) {
  const screen = resolveLcScreen(searchParams.screen);
  const state = resolveLcState(searchParams.state);
  const role = resolveLcRole(searchParams.as);

  const href = (next: { screen?: string; state?: string; as?: string }) =>
    `/preview/live-collab-orchestration?screen=${next.screen ?? screen}&state=${next.state ?? state}&as=${next.as ?? role}`;

  return (
    <main className="min-h-screen bg-background text-background-foreground">
      <div className="flex flex-col gap-2 border-b border-border px-4 py-3" data-testid="lc-preview-nav">
        <NavRow label="屏">
          {LC_SCREENS.map((s) => (
            <NavPill key={s} active={s === screen} href={href({ screen: s })} testid={`lc-nav-screen-${s}`}>
              {LC_SCREEN_LABEL[s]}
            </NavPill>
          ))}
        </NavRow>
        <NavRow label="界面态">
          {LC_STATES.map((s) => (
            <NavPill key={s} active={s === state} href={href({ state: s })} testid={`lc-nav-state-${s}`}>
              {LC_STATE_LABEL[s]}
            </NavPill>
          ))}
        </NavRow>
        <NavRow label="视角">
          {PROJECT_ROLES.map((r) => (
            <NavPill key={r} active={r === role} href={href({ as: r })} testid={`lc-nav-role-${r}`}>
              {PROJECT_ROLE_LABEL[r]}
            </NavPill>
          ))}
        </NavRow>
      </div>

      <OrchestrationPreview screen={screen} state={state} role={role} />
    </main>
  );
}

function NavRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 w-12 shrink-0 text-11 font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function NavPill({
  active, href, testid, children,
}: { active: boolean; href: string; testid: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      data-testid={testid}
      data-active={active}
      className={`rounded-full border px-2.5 py-1 text-11 transition-colors duration-200 ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-card-foreground hover:bg-muted"
      }`}
    >
      {children}
    </Link>
  );
}
