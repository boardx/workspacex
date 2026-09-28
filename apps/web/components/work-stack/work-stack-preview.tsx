"use client";
import * as React from "react";
import { AgentDirectoryScreen } from "@/components/work-stack/agent-directory-screen";
import { BoardRunScreen } from "@/components/work-stack/board-run-screen";
import { GateStatusScreen } from "@/components/work-stack/gate-status-screen";
import { SkillCatalogScreen } from "@/components/work-stack/skill-catalog-screen";
import { WorkflowRunPanel } from "@/components/work-stack/workflow-run-panel";
import { PREVIEW_STATES, type PreviewState, type WorkStackScreen } from "@/lib/mock/work-stack";

const SCREENS: readonly { key: WorkStackScreen; label: string }[] = [
  { key: "skill-catalog", label: "Skill 目录" },
  { key: "agent-directory", label: "Agent 目录" },
  { key: "run-panel", label: "运行面板" },
  { key: "gate-status", label: "门状态" },
  { key: "board-run", label: "看板投影" },
];

/** 预览视角：管理员/平台运营可见管理操作；成员不可见（R5 权限投影，仅预览手段） */
const ROLES: readonly { key: string; label: string; admin: boolean }[] = [
  { key: "member", label: "成员", admin: false },
  { key: "admin", label: "管理员 / 平台运营", admin: true },
];

export function WorkStackPreview({
  screen,
  state,
  isAdmin,
}: {
  screen: WorkStackScreen;
  state: PreviewState;
  isAdmin: boolean;
}) {
  const setParam = (key: string, value: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set(key, value);
    window.location.href = url.toString();
  };

  return (
    <div className="flex h-screen flex-col bg-background text-background-foreground">
      {/* 调试面板：切屏 / 切态 / 切视角 */}
      <div className="flex flex-wrap items-center gap-4 border-b border-border bg-card px-4 py-2">
        <div className="flex items-center gap-1.5">
          <span className="text-10 uppercase tracking-wide text-muted-foreground">屏</span>
          {SCREENS.map((s) => (
            <button
              key={s.key}
              data-testid={`ws-preview-screen-${s.key}`}
              onClick={() => setParam("screen", s.key)}
              className={`rounded-control px-2 py-0.5 text-11 transition-colors hover:bg-muted ${
                screen === s.key ? "bg-primary text-primary-foreground" : "text-muted-foreground"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-10 uppercase tracking-wide text-muted-foreground">态</span>
          {PREVIEW_STATES.map((s) => (
            <button
              key={s.key}
              data-testid={`ws-preview-state-${s.key}`}
              onClick={() => setParam("state", s.key)}
              className={`rounded-control px-2 py-0.5 text-11 transition-colors hover:bg-muted ${
                state === s.key ? "bg-primary text-primary-foreground" : "text-muted-foreground"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-10 uppercase tracking-wide text-muted-foreground">视角</span>
          {ROLES.map((r) => (
            <button
              key={r.key}
              data-testid={`ws-preview-role-${r.key}`}
              onClick={() => setParam("role", r.key)}
              className={`rounded-control px-2 py-0.5 text-11 transition-colors hover:bg-muted ${
                isAdmin === r.admin ? "bg-accent text-accent-foreground" : "text-muted-foreground"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {screen === "skill-catalog" && <SkillCatalogScreen state={state} isAdmin={isAdmin} />}
        {screen === "agent-directory" && <AgentDirectoryScreen state={state} />}
        {screen === "run-panel" && <WorkflowRunPanel state={state} />}
        {screen === "gate-status" && <GateStatusScreen state={state} isAdmin={isAdmin} />}
        {screen === "board-run" && <BoardRunScreen state={state} />}
      </div>
    </div>
  );
}
