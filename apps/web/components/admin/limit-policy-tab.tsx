"use client";
import * as React from "react";
import { ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { Toast } from "./panel";
import {
  DEGRADE_TIERS, TASK_TYPE_GRADING, LIMIT_POLICY_INTRO, type TaskGradingRow,
} from "@/lib/mock/admin-limits";
import { LimitRulesLive } from "./limit-rules-live";
import { NoBackendNotice } from "./no-backend-notice";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

function taskToneClass(tone: TaskGradingRow["tone"]): string {
  if (tone === "destructive") return "text-destructive";
  if (tone === "warning") return "text-warning";
  return "text-success";
}

export function LimitPolicyTab() {
  // 规则列表的状态全部搬进 `LimitRulesLive`（它读真库）。这里只剩降级阈值/任务分级
  // 那两块 mock 自己的 toast。
  const [toast, setToast] = React.useState<string | null>(null);

  return (
    <div className="flex flex-col gap-6" data-testid="admin-limits-tab">
      {/* 降级阈值：三级，最先触发的一条生效 */}
      <section className="flex flex-col gap-2" data-testid="admin-degrade-tiers">
        <div className="flex items-baseline gap-2">
          <h2 className="text-14 font-semibold">降级阈值 · 三级 ＋ 按任务分级</h2>
          <span className="text-10 text-muted-foreground">三级中最先触发的一条生效；降级方式按任务类型分级，不是一刀切</span>
        </div>
        {/* ⚠ 这两块（降级阈值三级 / 按任务分级）仍是 mock：它们属 phase-03 F14
            （异常检测处置矩阵）的地盘，那条 feature 有自己的签核。F162 只借它
            「取最先触发」的语义做规则求值，不把它的界面顺手做掉。 */}
        <NoBackendNotice />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card data-testid="admin-degrade-tier-org">
            <CardContent className="flex flex-col gap-3 pt-4">
              <div className="flex items-center gap-2">
                <span className="flex-1 text-12 font-medium">{DEGRADE_TIERS.org.label}</span>
                <Toggle checked={DEGRADE_TIERS.org.enabled} onCheckedChange={() => setToast("组织级降级阈值已启用（组织默认策略，不在本屏关闭）")} label="组织级降级阈值" />
              </div>
              <div className="flex items-center justify-between text-11">
                <span className="text-muted-foreground">触发点</span>
                <span className="font-mono">已用 {DEGRADE_TIERS.org.triggerPct}%</span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-inverse" style={{ width: `${DEGRADE_TIERS.org.triggerPct}%` }} />
              </div>
              <div className="flex items-center justify-between text-11">
                <span className="text-muted-foreground">降级到</span>
                <span className="font-mono">{DEGRADE_TIERS.org.target}</span>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="admin-degrade-tier-member">
            <CardContent className="flex flex-col gap-3 pt-4">
              <div className="flex items-center gap-2">
                <span className="flex-1 text-12 font-medium">{DEGRADE_TIERS.member.label}</span>
                <Toggle checked={DEGRADE_TIERS.member.enabled} onCheckedChange={() => setToast("成员级降级阈值已启用（组织默认策略，不在本屏关闭）")} label="成员级降级阈值" />
              </div>
              <div className="flex items-center justify-between text-11">
                <span className="text-muted-foreground">触发点</span>
                <span className="font-mono">已用 {DEGRADE_TIERS.member.triggerPct}%</span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-inverse" style={{ width: `${DEGRADE_TIERS.member.triggerPct}%` }} />
              </div>
              <p className="text-10 leading-relaxed text-muted-foreground">
                {DEGRADE_TIERS.member.note} · <span className="text-primary">{DEGRADE_TIERS.member.noteLink}</span>
              </p>
            </CardContent>
          </Card>

          <Card data-testid="admin-degrade-tier-agent">
            <CardContent className="flex flex-col gap-3 pt-4">
              <div className="flex items-center gap-2">
                <span className="flex-1 text-12 font-medium">{DEGRADE_TIERS.agent.label}</span>
                <Toggle checked={DEGRADE_TIERS.agent.enabled} onCheckedChange={() => setToast("Agent 级降级阈值已启用（组织默认策略，不在本屏关闭）")} label="Agent 级降级阈值" />
              </div>
              <div className="flex flex-col gap-1.5">
                {DEGRADE_TIERS.agent.rows.map((row) => (
                  <div key={row.id} className="flex items-center gap-2 text-11" data-testid={`admin-degrade-agent-${row.id}`}>
                    <span className="grid h-4.5 w-4.5 shrink-0 place-items-center rounded-sm bg-accent font-mono text-9 font-semibold text-accent-foreground">
                      {row.initials}
                    </span>
                    <span className="flex-1">{row.name}</span>
                    <span className="font-mono text-muted-foreground">{row.detail}</span>
                  </div>
                ))}
              </div>
              <p className="text-10 leading-relaxed text-muted-foreground">{DEGRADE_TIERS.agent.footnote}</p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* 任务类型分级表 */}
      <section className="flex flex-col gap-2">
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table className="w-full min-w-[560px] border-collapse text-11" data-testid="admin-degrade-task-table">
              <TableHeader>
                <TableRow className="border-b border-border bg-panel text-11 text-muted-foreground">
                  <TableHead className="px-3 py-2 text-left font-medium">任务类型</TableHead>
                  <TableHead className="px-3 py-2 text-left font-medium">触发降级时</TableHead>
                  <TableHead className="px-3 py-2 text-left font-medium">为什么</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {TASK_TYPE_GRADING.map((row) => (
                  <TableRow key={row.key} className="border-b border-border-subtle last:border-b-0" data-testid={`admin-degrade-task-${row.key}`}>
                    <TableCell className="px-3 py-2.5">{row.taskType}</TableCell>
                    <TableCell className={`px-3 py-2.5 font-medium ${taskToneClass(row.tone)}`}>{row.action}</TableCell>
                    <TableCell className="px-3 py-2.5 text-muted-foreground">{row.reason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      {/* 限额规则列表 —— F162 起**真栈**（`LimitRulesLive`）。
          这一块此前是 `lib/mock/admin-limits.LIMIT_RULES` + 只改本地 state 的编辑/新建
          （文件里原来的注释逐字写着「mock：只改本地上限展示值，无后端持久化」）。 */}
      <section className="flex flex-col gap-2" data-testid="admin-limits-rules">
        <div className="flex flex-wrap items-center gap-2">
          <ShieldAlert aria-hidden className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-14 font-semibold">限额规则</h2>
          <p className="min-w-[220px] flex-1 text-11 leading-relaxed text-muted-foreground" data-testid="admin-limits-intro">
            {LIMIT_POLICY_INTRO}
          </p>
        </div>
        <LimitRulesLive />
      </section>

      <Toast message={toast} testid="admin-limits-toast" onDismiss={() => setToast(null)} />
    </div>
  );
}
