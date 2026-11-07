"use client";
import * as React from "react";
import { useI18n } from "@/lib/i18n/provider";
import type { MessageKey } from "@/lib/i18n/messages";
import { ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Toggle } from "@/components/ui/toggle";
import { Toast } from "./panel";
import {
  DEGRADE_TIERS, DEGRADE_AGENT_DISPLAY, TASK_TYPE_GRADING, type TaskGradingRow,
} from "@/lib/mock/admin-limits";
import { LimitRulesLive } from "./limit-rules-live";
import { NoBackendNotice } from "./no-backend-notice";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

const taskCopyKeys = {
  generic: ["adminLimitPolicy.task.generic.type", "adminLimitPolicy.task.generic.action", "adminLimitPolicy.task.generic.reason"],
  research: ["adminLimitPolicy.task.research.type", "adminLimitPolicy.task.research.action", "adminLimitPolicy.task.research.reason"],
  confidential: ["adminLimitPolicy.task.confidential.type", "adminLimitPolicy.task.confidential.action", "adminLimitPolicy.task.confidential.reason"],
  "no-fallback": ["adminLimitPolicy.task.no-fallback.type", "adminLimitPolicy.task.no-fallback.action", "adminLimitPolicy.task.no-fallback.reason"],
} as const satisfies Record<string, readonly MessageKey[]>;
function taskCopy(key: string, column: 0 | 1 | 2, fallback: string, t: (key: MessageKey) => string): string {
  return Object.prototype.hasOwnProperty.call(taskCopyKeys, key) ? t(taskCopyKeys[key as keyof typeof taskCopyKeys][column]) : fallback;
}

function taskToneClass(tone: TaskGradingRow["tone"]): string {
  if (tone === "destructive") return "text-destructive";
  if (tone === "warning") return "text-warning";
  return "text-success";
}

export function LimitPolicyTab() {
  const { t } = useI18n();
  // 规则列表的状态全部搬进 `LimitRulesLive`（它读真库）。这里只剩降级阈值/任务分级
  // 那两块 mock 自己的 toast。
  const [toast, setToast] = React.useState<MessageKey | null>(null);

  return (
    <div className="min-w-0 flex flex-col gap-6" data-testid="admin-limits-tab">
      {/* 降级阈值：三级，最先触发的一条生效 */}
      <section className="flex flex-col gap-2" data-testid="admin-degrade-tiers">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-14 font-semibold">{t("adminLimitPolicy.tiersTitle")}</h2>
          <span className="text-10 text-muted-foreground">{t("adminLimitPolicy.tiersHint")}</span>
        </div>
        {/* ⚠ 这两块（降级阈值三级 / 按任务分级）仍是 mock：它们属 phase-03 F14
            （异常检测处置矩阵）的地盘，那条 feature 有自己的签核。F162 只借它
            「取最先触发」的语义做规则求值，不把它的界面顺手做掉。 */}
        <NoBackendNotice />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card className="min-w-0" data-testid="admin-degrade-tier-org">
            <CardContent className="flex flex-col gap-3 pt-4">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 text-12 font-medium">{t("adminLimitPolicy.org")}</span>
                <Toggle checked={DEGRADE_TIERS.org.enabled} onCheckedChange={() => setToast("adminLimitPolicy.orgToast")} label={t("adminLimitPolicy.orgToggle")} />
              </div>
              <div className="flex items-center justify-between text-11">
                <span className="text-muted-foreground">{t("adminLimitPolicy.trigger")}</span>
                <span className="font-mono">{t("adminLimitPolicy.percent", { pct: DEGRADE_TIERS.org.triggerPct })}</span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-inverse" style={{ width: `${DEGRADE_TIERS.org.triggerPct}%` }} />
              </div>
              <div className="flex items-center justify-between text-11">
                <span className="text-muted-foreground">{t("adminLimitPolicy.degradeTo")}</span>
                <span className="font-mono">{DEGRADE_TIERS.org.target}</span>
              </div>
            </CardContent>
          </Card>

          <Card className="min-w-0" data-testid="admin-degrade-tier-member">
            <CardContent className="flex flex-col gap-3 pt-4">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 text-12 font-medium">{t("adminLimitPolicy.member")}</span>
                <Toggle checked={DEGRADE_TIERS.member.enabled} onCheckedChange={() => setToast("adminLimitPolicy.memberToast")} label={t("adminLimitPolicy.memberToggle")} />
              </div>
              <div className="flex items-center justify-between text-11">
                <span className="text-muted-foreground">{t("adminLimitPolicy.trigger")}</span>
                <span className="font-mono">{t("adminLimitPolicy.percent", { pct: DEGRADE_TIERS.member.triggerPct })}</span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-inverse" style={{ width: `${DEGRADE_TIERS.member.triggerPct}%` }} />
              </div>
              <p className="text-10 leading-relaxed text-muted-foreground">
                {t("adminLimitPolicy.memberNote", { name: DEGRADE_TIERS.member.noteName, pct: DEGRADE_TIERS.member.notePct })} · <span className="text-primary">{t("adminLimitPolicy.memberLink")}</span>
              </p>
            </CardContent>
          </Card>

          <Card className="min-w-0" data-testid="admin-degrade-tier-agent">
            <CardContent className="flex flex-col gap-3 pt-4">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 text-12 font-medium">{t("adminLimitPolicy.agent")}</span>
                <Toggle checked={DEGRADE_TIERS.agent.enabled} onCheckedChange={() => setToast("adminLimitPolicy.agentToast")} label={t("adminLimitPolicy.agentToggle")} />
              </div>
              <div className="flex flex-col gap-1.5">
                {DEGRADE_TIERS.agent.rows.map((row) => (
                  <div key={row.id} className="flex min-w-0 flex-wrap items-center gap-2 text-11" data-testid={`admin-degrade-agent-${row.id}`}>
                    <span className="grid h-4.5 w-4.5 shrink-0 place-items-center rounded-sm bg-accent font-mono text-9 font-semibold text-accent-foreground">
                      {row.initials}
                    </span>
                    <span className="min-w-0 flex-1">{row.name}</span>
                    <span className="max-w-full break-words font-mono text-muted-foreground">{row.id === "ag-scout" ? t("adminLimitPolicy.scoutDetail", { amount: DEGRADE_AGENT_DISPLAY.scoutAmount, pct: DEGRADE_AGENT_DISPLAY.scoutPct }) : row.id === "ag-ledger" ? t("adminLimitPolicy.ledgerDetail", { amount: DEGRADE_AGENT_DISPLAY.ledgerAmount }) : t("adminLimitPolicy.avaDetail")}</span>
                  </div>
                ))}
              </div>
              <p className="text-10 leading-relaxed text-muted-foreground">{t("adminLimitPolicy.agentFootnote", { name: DEGRADE_TIERS.agent.rows[1]?.name ?? "" })}</p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* 任务类型分级表 */}
      <section className="flex flex-col gap-2">
        <Card className="min-w-0">
          <CardContent className="overflow-x-auto p-0">
            <Table className="w-full min-w-[560px] border-collapse text-11" data-testid="admin-degrade-task-table">
              <TableHeader>
                <TableRow className="border-b border-border bg-panel text-11 text-muted-foreground">
                  <TableHead className="px-3 py-2 text-left font-medium">{t("adminLimitPolicy.taskType")}</TableHead>
                  <TableHead className="px-3 py-2 text-left font-medium">{t("adminLimitPolicy.whenTriggered")}</TableHead>
                  <TableHead className="px-3 py-2 text-left font-medium">{t("adminLimitPolicy.why")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {TASK_TYPE_GRADING.map((row) => (
                  <TableRow key={row.key} className="border-b border-border-subtle last:border-b-0" data-testid={`admin-degrade-task-${row.key}`}>
                    <TableCell className="px-3 py-2.5">{taskCopy(row.key, 0, row.taskType, t)}</TableCell>
                    <TableCell className={`px-3 py-2.5 font-medium ${taskToneClass(row.tone)}`}>{taskCopy(row.key, 1, row.action, t)}</TableCell>
                    <TableCell className="px-3 py-2.5 text-muted-foreground">{taskCopy(row.key, 2, row.reason, t)}</TableCell>
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
          <h2 className="text-14 font-semibold">{t("adminLimitPolicy.rules")}</h2>
          <p className="min-w-0 basis-[220px] flex-1 text-11 leading-relaxed text-muted-foreground" data-testid="admin-limits-intro">
            {t("adminLimitPolicy.intro")}
          </p>
        </div>
        <LimitRulesLive />
      </section>

      <Toast message={toast ? t(toast) : null} testid="admin-limits-toast" onDismiss={() => setToast(null)} />
    </div>
  );
}
