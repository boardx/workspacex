import * as React from "react";
import { WorkStackPreview } from "@/components/work-stack/work-stack-preview";
import { PREVIEW_STATES, type PreviewState, type WorkStackScreen } from "@/lib/mock/work-stack";

/**
 * Phase-20 work-stack-foundation UI 先行原型入口（ADR-023 签核第 ① 件材料）。
 * 纯 mock，不接后端。query：
 *   ?screen= skill-catalog | agent-directory | run-panel | gate-status | board-run
 *   ?state=  default | loading | empty | invalid | depfail | denied | success
 *   ?role=   member | admin
 *
 * ⚠ 生产环境这些屏落在既有三栏骨架 / /skill / /agent / /workflows / /board 路由；
 *   此预览页只为逐屏逐态签核把它们单独铺出来，不新建生产路由。
 */
const SCREENS: readonly WorkStackScreen[] = [
  "skill-catalog",
  "agent-directory",
  "run-panel",
  "gate-status",
  "board-run",
];

function resolveScreen(raw: string | undefined): WorkStackScreen {
  return SCREENS.includes(raw as WorkStackScreen) ? (raw as WorkStackScreen) : "skill-catalog";
}

function resolveState(raw: string | undefined): PreviewState {
  return PREVIEW_STATES.some((s) => s.key === raw) ? (raw as PreviewState) : "default";
}

export default function WorkStackPreviewPage({
  searchParams,
}: {
  searchParams: { screen?: string; state?: string; role?: string };
}) {
  const screen = resolveScreen(searchParams.screen);
  const state = resolveState(searchParams.state);
  const isAdmin = searchParams.role === "admin";
  return <WorkStackPreview screen={screen} state={state} isAdmin={isAdmin} />;
}
