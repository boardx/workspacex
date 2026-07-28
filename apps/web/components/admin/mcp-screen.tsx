"use client";
import * as React from "react";
import { Plus, Plug, Wrench, ShieldCheck } from "lucide-react";
import { AdminScreen } from "./admin-screen";
import { AuthScopeBadge, ReviewBadge } from "./scope-badges";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Toggle } from "@/components/ui/toggle";
import {
  MCP_SERVERS, MCP_SUMMARY, MCP_CONN_LABEL, type McpConnStatus,
} from "@/lib/mock/admin";
import type { UiState } from "@/lib/ui-state";

const CONN_TONE: Record<McpConnStatus, "primary" | "warning" | "danger"> = {
  connected: "primary",
  throttled: "warning",
  isolated: "danger",
};

export function McpScreen({ state }: { state: UiState }) {
  const [defaultIsolation, setDefaultIsolation] = React.useState(true);
  return (
    <AdminScreen
      state={state}
      moduleLabel="MCP"
      title="MCP 服务器"
      intro="注册服务器、设定授权范围、默认隔离。新注册的服务器默认隔离、工具不可被调用，须经人工评审放行。工具随授权范围被 agent 白名单引用。"
      emptyHint="还没有注册任何 MCP 服务器"
      errors={{ endpoint: "工具发现失败：端点握手成功但未返回工具清单；服务器保持已隔离，不放行" }}
      depFailure="工具发现与连接状态监测依赖 MCP 网关；网关不可达，无法确认工具数与连接状态。"
      denialReason="只有组织管理员能注册、配置授权范围；能力维护者只读服务器名与工具清单，看不到端点与凭据。"
      successMessage="服务器『欧盟法规库』维持隔离；授权范围已设为全体成员，评审状态待安全评审"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-12 text-muted-foreground">
            {MCP_SUMMARY.total} 台 · {MCP_SUMMARY.connected} 台已连接 · {MCP_SUMMARY.isolated} 台已隔离
          </p>
          <Button size="sm" variant="primary" data-testid="admin-mcp-add">
            <Plus aria-hidden className="h-3.5 w-3.5" />
            添加服务器
          </Button>
        </div>

        {/* 默认隔离安全策略（UC-21.2） */}
        <Card data-testid="admin-mcp-policy">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="flex items-start gap-2">
              <ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="flex flex-col">
                <span className="text-12 font-medium">新服务器默认隔离，需人工评审后放行</span>
                <span className="text-11 text-muted-foreground">开启后，任何新注册服务器的工具在放行前都不可被任何 agent 调用。</span>
              </div>
            </div>
            <Toggle
              checked={defaultIsolation}
              onCheckedChange={setDefaultIsolation}
              label="新服务器默认隔离"
              data-testid="admin-mcp-policy-toggle"
            />
          </CardContent>
        </Card>

        {/* 两套枚举的界面澄清 —— 授权范围 ≠ 可见性范围；授权范围 ⊥ 评审状态 */}
        <div className="rounded-md border border-border-subtle bg-panel px-3 py-2.5 text-11 text-muted-foreground" data-testid="admin-mcp-scope-note">
          <p>
            这里的<strong className="text-background-foreground">「授权范围」</strong>（钥匙徽标）回答「谁能通过 agent 调用这台服务器的工具」，
            取值「仅项目负责人 / 仅某团队 / 全体成员」。它与 Agent/Skill 页的
            <strong className="text-background-foreground">「可见性范围」</strong>（眼睛徽标，全组织可用 / 仅某组）
            是两个不同维度——一个管「工具能不能被调」，一个管「能力能不能被看到」，不要合并。
          </p>
          <p className="mt-1.5">
            另外，<strong className="text-background-foreground">「评审状态」</strong>（盾牌徽标，待安全评审 / 已放行）
            与授权范围<strong className="text-background-foreground">正交</strong>：一台服务器可以同时「授权范围＝全体成员」且「评审状态＝待安全评审」，
            所以它们是两个并列的字段，不是一个。
          </p>
        </div>

        {/* 服务器清单：服务器 ｜ 端点 ｜ 工具 ｜ 授权范围 ｜ 评审 ｜ 状态 */}
        <div className="flex flex-col gap-1.5" data-testid="admin-mcp-list">
          {MCP_SERVERS.map((s) => (
            <Card key={s.id} data-testid={`admin-mcp-row-${s.id}`}>
              <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <Plug aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="text-12 font-medium">{s.name}</span>
                    <span className="text-11 text-muted-foreground">{s.note}</span>
                    {s.touchesClientData && <Badge tone="warning">涉客户数据</Badge>}
                  </div>
                  <span className="font-mono text-10 text-muted-foreground">{s.endpoint}</span>
                </div>

                <div className="flex items-center gap-1 text-11 text-muted-foreground">
                  <Wrench aria-hidden className="h-3 w-3" />
                  {s.tools} 工具
                </div>

                {/* 授权范围（枚举②） */}
                <AuthScopeBadge scope={s.authScope} team={s.authTeam} data-testid={`admin-mcp-authscope-${s.id}`} />

                {/* 评审状态（枚举③，与授权范围并列） */}
                <ReviewBadge status={s.reviewStatus} data-testid={`admin-mcp-review-${s.id}`} />

                {/* 连接状态 */}
                <Badge tone={CONN_TONE[s.conn]} data-testid={`admin-mcp-conn-${s.id}`}>
                  {MCP_CONN_LABEL[s.conn]}
                </Badge>

                <div className="ml-auto flex gap-1.5">
                  <Button size="xs" variant="outline" data-testid={`admin-mcp-config-${s.id}`}>配置</Button>
                  {s.reviewStatus === "pending" ? (
                    <Button size="xs" variant="primary" data-testid={`admin-mcp-review-action-${s.id}`}>放行评审</Button>
                  ) : (
                    <Button size="xs" variant="ghost" data-testid={`admin-mcp-tools-${s.id}`}>看工具</Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AdminScreen>
  );
}
