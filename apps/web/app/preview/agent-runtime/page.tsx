import * as React from "react";
import { PermissionScreen } from "@/components/agent-runtime/permission-screen";
import { McpPolicyScreen } from "@/components/agent-runtime/mcp-policy-screen";
import { RoutingScreen } from "@/components/agent-runtime/routing-screen";
import { TeamScreen } from "@/components/agent-runtime/team-screen";
import { ChatScreen } from "@/components/agent-runtime/chat-screen";
import { AuditScreen } from "@/components/agent-runtime/audit-screen";
import { resolvePreviewState, type UiState } from "@/lib/ui-state";
import { RUNTIME_ROLES, type RuntimeScreenKey, type RuntimeRole } from "@/lib/mock/agent-runtime";

/**
 * agent-runtime UI 先行原型入口 —— ADR-003 签核第 ① 件材料（04-agent / 20-model / 21-mcp 契约束）。
 *
 * 三个 query 参数（预览手段，生产环境预览开关不可达）：
 *   ?screen= permission | mcp-policy | routing | team | chat | audit
 *   ?as=     视角切换（能力维护者 / 安全评审人 / 组织管理员 / 引导师 / 组长 / 组员 / 观察者…）
 *   ?state=  default | loading | empty | invalid | dep-failed | denied | success（走共享 StateShell）
 *
 * ⚠ 只画各 UC 标为「原型确认缺失 / 需补画」的净新屏；列表屏（Agent/模型/MCP 管理）已在
 *   /admin/* 存在，本入口不重画、只在 mock 里复用其记录，保证同一 agent 两处是同一条。
 */
const SCREENS: Record<RuntimeScreenKey, (p: { role: RuntimeRole; state: UiState }) => React.ReactNode> = {
  permission: PermissionScreen,
  "mcp-policy": McpPolicyScreen,
  routing: RoutingScreen,
  team: TeamScreen,
  chat: ChatScreen,
  audit: AuditScreen,
};

const SCREEN_KEYS = Object.keys(SCREENS) as RuntimeScreenKey[];

function resolveScreen(raw: string | undefined): RuntimeScreenKey {
  return SCREEN_KEYS.includes(raw as RuntimeScreenKey) ? (raw as RuntimeScreenKey) : "permission";
}
function resolveRole(raw: string | undefined): RuntimeRole {
  const keys = RUNTIME_ROLES.map((r) => r.key);
  return keys.includes(raw as RuntimeRole) ? (raw as RuntimeRole) : "maintainer";
}

export default function AgentRuntimePreviewPage({
  searchParams,
}: {
  searchParams: { screen?: string; as?: string; state?: string };
}) {
  const screen = resolveScreen(searchParams.screen);
  const role = resolveRole(searchParams.as);
  const state = resolvePreviewState(searchParams.state);
  const Screen = SCREENS[screen];

  return (
    <main className="min-h-screen bg-background text-background-foreground">
      <Screen role={role} state={state} />
    </main>
  );
}
