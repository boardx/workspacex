"use client";
import * as React from "react";
import { EyeOff, ScrollText, FileClock, Gauge } from "lucide-react";
import { AdminScreen } from "./admin-screen";
import { AdminDrawer, AdminModal, Toast, Field } from "./panel";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  MEMBERS, ADMIN_ACCESS_LOGS, ADMIN_PROJECT_ACCESS_COUNT, type MemberRow,
} from "@/lib/mock/admin";
import type { UiState } from "@/lib/ui-state";

function quotaTone(pct: number): "primary" | "warning" | "destructive" {
  if (pct >= 95) return "destructive";
  if (pct >= 80) return "warning";
  return "primary";
}

export function MembersScreen({ state }: { state: UiState }) {
  const [limits, setLimits] = React.useState<Record<string, number>>({});
  const [quotaOf, setQuotaOf] = React.useState<MemberRow | null>(null);
  const [newLimit, setNewLimit] = React.useState("");
  const [accessOpen, setAccessOpen] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);

  const openQuota = (m: MemberRow) => { setQuotaOf(m); setNewLimit((limits[m.id] ?? m.limitM).toFixed(1)); };

  return (
    <AdminScreen
      state={state}
      moduleLabel="成员配额"
      title="成员与配额"
      intro="管理员不是超级用户。你能看到每个人的用量与个人层「条目数」，但看不到个人层的内容——这一层是三层记忆里唯一对管理员封闭的一层。"
      emptyHint="组织里还没有成员"
      errors={{ quota: "提额失败：目标额度超过组织剩余额度（1,380 万 tokens），请先调整组织总额度" }}
      depFailure="用量统计依赖计量流水线（UC-17.7）；流水线不可用，配额与个人层计数无法刷新。"
      denialReason="成员与配额仅组织管理员可见；顾问只能通过『看我的访问记录』查看自己的访问历史。"
      successMessage="已为吴桐单独提额至 5.0M；本次操作已记入审计"
    >
      <div className="flex flex-col gap-5">
        {/* 成员配额列表 */}
        <section className="flex flex-col gap-2" data-testid="admin-members-list">
          <div className="flex items-center gap-1.5">
            <Gauge aria-hidden className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-14 font-semibold">成员配额</h2>
            <span className="text-11 text-muted-foreground">· 共 {MEMBERS.length} 人</span>
          </div>
          <Card>
            <CardContent className="flex flex-col pt-2">
              {MEMBERS.map((m, i) => {
                const limit = limits[m.id] ?? m.limitM;
                const pct = Math.round((m.usedM / limit) * 100);
                return (
                  <div key={m.id} data-testid={`admin-member-row-${m.id}`}>
                    <div className="flex flex-wrap items-center gap-3 py-2.5">
                      <span className="w-14 shrink-0 text-13 font-medium">{m.name}</span>
                      <Badge tone="outline">{m.orgRole}</Badge>
                      <span className="text-11 text-muted-foreground">{m.team}</span>
                      <div className="ml-auto flex w-full items-center gap-3 sm:w-64">
                        <Progress value={pct} tone={quotaTone(pct)} label={`${m.name} 配额 ${pct}%`} className="flex-1" />
                        <span className="shrink-0 font-mono text-11 text-muted-foreground">
                          {m.usedM.toFixed(1)}/{limit.toFixed(1)}M
                        </span>
                      </div>
                      <Button size="xs" variant="outline" onClick={() => openQuota(m)} data-testid={`admin-member-quota-${m.id}`}>给他单独提额</Button>
                    </div>
                    {i < MEMBERS.length - 1 && <Separator />}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </section>

        {/* 管理员权力边界（UC-17.5）—— 「你作为管理员看不到什么」 */}
        <section className="flex flex-col gap-2" data-testid="admin-members-boundary">
          <div className="flex items-center gap-1.5">
            <EyeOff aria-hidden className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-14 font-semibold">你作为管理员看不到什么</h2>
          </div>
          <Card>
            <CardContent className="flex flex-col gap-3 pt-4">
              <p className="text-12 text-muted-foreground">
                这不是缺失功能，是产品的硬约束。个人层是三层记忆里唯一对管理员封闭的一层——顾问敢把半成品判断写进系统，
                前提是这一层<strong className="text-background-foreground">组织管理员看不到、agent 也读不到</strong>。
              </p>

              {/* 个人层：只有计数 */}
              <div className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-panel p-3" data-testid="admin-members-private-counts">
                <span className="text-12 font-medium">个人层 · 只有计数（内容不可见、不可搜索、不可导出、不进 AI 检索）</span>
                <div className="flex flex-wrap gap-2">
                  {MEMBERS.filter((m) => m.privateEntries > 0).map((m) => (
                    <span
                      key={m.id}
                      data-testid={`admin-member-private-${m.id}`}
                      className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-card px-2 py-1 text-11"
                    >
                      <span className="font-medium">{m.name}</span>
                      <span className="text-muted-foreground">私有条目 {m.privateEntries} 条</span>
                      <Badge tone="neutral">内容不可见</Badge>
                    </span>
                  ))}
                </div>
              </div>

              {/* 项目层：可读但必留痕、对负责人可见 */}
              <div className="flex flex-col gap-2 rounded-md border border-warning/30 bg-warning/5 p-3" data-testid="admin-members-project-access">
                <div className="flex items-start gap-2">
                  <ScrollText aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <p className="text-12">
                    出于审计目的你可以读项目内容，但<strong className="text-background-foreground">每次访问都会写入审计日志，并对项目负责人可见</strong>。
                    本月你访问过 {ADMIN_PROJECT_ACCESS_COUNT} 个项目。「升到项目层」是获取内容的唯一路径——不存在申请、提权、临时授权等旁路。
                  </p>
                </div>
                <Button size="sm" variant="outline" className="self-start" onClick={() => setAccessOpen(true)} data-testid="admin-members-my-access">
                  <FileClock aria-hidden className="h-3.5 w-3.5" />
                  看我的访问记录
                </Button>
              </div>

              {/* 我的访问记录明细 */}
              <div className="flex flex-col gap-1" data-testid="admin-members-access-logs">
                <span className="text-11 font-medium text-muted-foreground">我本月的项目层访问（每条都对该项目负责人可见）</span>
                {ADMIN_ACCESS_LOGS.map((log) => (
                  <div
                    key={log.id}
                    data-testid={`admin-access-log-${log.id}`}
                    className="flex flex-wrap items-center gap-2 rounded-sm border border-border-subtle bg-card px-2.5 py-1.5 text-11"
                  >
                    <span className="font-medium">{log.project}</span>
                    <span className="text-muted-foreground">负责人 {log.lead}</span>
                    <span className="ml-auto text-muted-foreground">{log.when}</span>
                    <Badge tone="primary">对负责人可见</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>
      </div>

      {/* 单独提额 */}
      {quotaOf && (
        <AdminModal
          testid="admin-member-quota-dialog"
          title={`给 ${quotaOf.name} 单独提额`}
          subtitle={`当前 ${quotaOf.usedM.toFixed(1)}/${(limits[quotaOf.id] ?? quotaOf.limitM).toFixed(1)}M · ${quotaOf.orgRole} · ${quotaOf.team}`}
          onClose={() => setQuotaOf(null)}
          footer={
            <>
              <Button size="sm" variant="ghost" onClick={() => setQuotaOf(null)} data-testid="admin-member-quota-cancel">取消</Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  const v = parseFloat(newLimit);
                  if (!Number.isFinite(v) || v <= 0) return;
                  setLimits((p) => ({ ...p, [quotaOf.id]: v }));
                  setToast(`已为 ${quotaOf.name} 单独提额至 ${v.toFixed(1)}M；本次操作已记入审计`);
                  setQuotaOf(null);
                }}
                data-testid="admin-member-quota-save"
              >
                确认提额
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <Field
              id="admin-member-quota-input"
              label="新的月度额度（百万 token）"
              type="number"
              value={newLimit}
              onChange={(e) => setNewLimit(e.currentTarget.value)}
            />
            <p className="text-11 text-muted-foreground">
              提额不会绕过个人层封闭：即便你调高他的额度，仍看不到他个人层的内容，只看得到计数与用量。
            </p>
          </div>
        </AdminModal>
      )}

      {/* 我的访问记录抽屉 */}
      {accessOpen && (
        <AdminDrawer testid="admin-members-access-drawer" title="我的项目层访问记录" subtitle="每一条都对该项目负责人可见，不可删除" onClose={() => setAccessOpen(false)}>
          <div className="flex flex-col gap-2" data-testid="admin-members-access-full">
            <p className="text-11 text-muted-foreground">本月共 {ADMIN_ACCESS_LOGS.length} 次升到项目层读取内容。升项目层是获取内容的唯一路径。</p>
            {ADMIN_ACCESS_LOGS.map((log) => (
              <div key={log.id} className="flex flex-col gap-1 rounded-md border border-border-subtle bg-panel p-2.5" data-testid="admin-members-access-item">
                <div className="flex items-center gap-2">
                  <span className="text-12 font-medium">{log.project}</span>
                  <Badge tone="primary">对负责人 {log.lead} 可见</Badge>
                  <span className="ml-auto text-11 text-muted-foreground">{log.when}</span>
                </div>
                <p className="text-11 text-muted-foreground">读取范围：项目库文档与转写（不含任何成员个人层）。理由已随访问写入审计。</p>
              </div>
            ))}
          </div>
        </AdminDrawer>
      )}

      <Toast message={toast} testid="admin-members-toast" onDismiss={() => setToast(null)} />
    </AdminScreen>
  );
}
