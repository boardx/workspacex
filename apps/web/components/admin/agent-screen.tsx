"use client";
import { Plus, Pencil, PlayCircle, ShieldQuestion } from "lucide-react";
import { AdminScreen } from "./admin-screen";
import { VisibilityBadge } from "./scope-badges";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { AGENTS, AGENT_STATUS_LABEL, type AgentStatus } from "@/lib/mock/admin";
import type { UiState } from "@/lib/ui-state";

const STATUS_TONE: Record<AgentStatus, "primary" | "warning" | "neutral" | "outline"> = {
  running: "primary",
  review: "warning",
  draft: "neutral",
  disabled: "outline",
};

export function AgentScreen({ state }: { state: UiState }) {
  return (
    <AdminScreen
      state={state}
      moduleLabel="Agent"
      title="Agent 管理"
      intro="每个 agent = 定义 + skill 挂载 + 工具白名单 + 模型 + 降级策略 + 可见性范围。发布走双重门禁，全程审计。"
      emptyHint="还没有注册任何 agent"
      errors={{ toolWhitelist: "工具白名单校验失败：Forge 申请的 mcp:客户 CRM(query_contact) 超出授权范围，需会签后才能保存" }}
      depFailure="agent 的模型下拉来自模型池（UC-20.1）；模型测试服务不可用，无法确认可用模型。"
      denialReason="Agent 管理仅组织管理员与能力维护者可进入；能力维护者只读，你当前无此角色。"
      successMessage="Agent『Ledger』的可见性范围已更新为仅能源组"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-12 text-muted-foreground">
            共 {AGENTS.length} 个 agent · {AGENTS.filter((a) => a.status === "running").length} 个运行中 · 1 个待审核
          </p>
          <Button size="sm" variant="primary" data-testid="admin-agent-add">
            <Plus aria-hidden className="h-3.5 w-3.5" />
            注册 agent
          </Button>
        </div>

        {/* 可见性范围 vs 授权范围 的界面澄清 —— 只在 agent/skill 出现「可见性范围」 */}
        <p className="rounded-md border border-border-subtle bg-panel px-3 py-2 text-11 text-muted-foreground">
          下表的<strong className="text-background-foreground">「可见性范围」</strong>决定「谁能看到、用这个 agent」，
          取值只有「全组织可用 / 仅某组」。它与 MCP 页的<strong className="text-background-foreground">「授权范围」</strong>
          （谁能调用某台服务器的工具）是<strong className="text-background-foreground">两个不同维度</strong>，两处徽标刻意长得不一样。
        </p>

        <div className="flex flex-col gap-2" data-testid="admin-agent-list">
          {AGENTS.map((a) => (
            <Card key={a.id} data-testid={`admin-agent-row-${a.id}`}>
              <CardContent className="flex flex-col gap-2 pt-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Avatar initials={a.initials} tone="ai" size="md" />
                  <div className="flex min-w-0 flex-col">
                    <span className="text-13 font-medium">{a.name}</span>
                    <span className="text-11 text-muted-foreground">{a.role}</span>
                  </div>
                  <Badge tone={STATUS_TONE[a.status]} data-testid={`admin-agent-status-${a.id}`}>
                    {AGENT_STATUS_LABEL[a.status]}
                  </Badge>
                  <VisibilityBadge scope={a.visibility} team={a.team} data-testid={`admin-agent-visibility-${a.id}`} />
                  <div className="ml-auto flex items-center gap-4 text-11 text-muted-foreground">
                    <span className="font-mono">{a.model}</span>
                    <span>{a.skills} skills</span>
                    <span>{a.callsPerMonth.toLocaleString()} 次/月</span>
                  </div>
                  <div className="flex gap-1.5">
                    <Button size="xs" variant="outline" data-testid={`admin-agent-edit-${a.id}`}>
                      <Pencil aria-hidden className="h-3 w-3" />
                      编辑
                    </Button>
                    <Button size="xs" variant="ghost" data-testid={`admin-agent-trial-${a.id}`}>
                      <PlayCircle aria-hidden className="h-3 w-3" />
                      试跑
                    </Button>
                  </div>
                </div>

                {a.blocker && (
                  <div
                    className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-2.5"
                    data-testid={`admin-agent-blocker-${a.id}`}
                  >
                    <ShieldQuestion aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                    <div className="flex flex-col gap-2">
                      <p className="text-12">{a.blocker}</p>
                      <div className="flex gap-1.5">
                        <Button size="xs" variant="primary" data-testid={`admin-agent-approve-${a.id}`}>批准发布</Button>
                        <Button size="xs" variant="outline" data-testid={`admin-agent-view-${a.id}`}>查看定义</Button>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AdminScreen>
  );
}
