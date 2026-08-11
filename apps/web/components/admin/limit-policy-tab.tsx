"use client";
import * as React from "react";
import { ShieldAlert, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { AdminModal, Field, Toast } from "./panel";
import {
  DEGRADE_TIERS, TASK_TYPE_GRADING, LIMIT_RULES, LIMIT_POLICY_INTRO,
  type LimitRule, type TaskGradingRow,
} from "@/lib/mock/admin-limits";

function taskToneClass(tone: TaskGradingRow["tone"]): string {
  if (tone === "destructive") return "text-destructive";
  if (tone === "warning") return "text-warning";
  return "text-success";
}

function ruleCard(
  rule: LimitRule,
  onToggle: (id: string) => void,
  onEdit: (rule: LimitRule) => void,
) {
  return (
    <div
      key={rule.id}
      data-testid={`admin-limit-rule-${rule.id}`}
      className={
        "flex flex-col gap-2.5 rounded-lg border p-3 " +
        (rule.highlighted ? "border-warning/40 bg-warning/5" : "border-border bg-card")
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="outline">{rule.scopeKind}</Badge>
        <span className="min-w-0 flex-1 truncate text-12 font-medium">{rule.scopeName}</span>
        <Toggle
          id={`admin-limit-rule-toggle-${rule.id}`}
          data-testid={`admin-limit-rule-toggle-${rule.id}`}
          checked={rule.enabled}
          onCheckedChange={() => onToggle(rule.id)}
          label={`${rule.scopeName} 规则启用状态`}
        />
      </div>
      <div className="grid grid-cols-3 gap-2 text-11">
        <div>
          <div className="mb-1 text-10 text-muted-foreground">适用模型</div>
          <div className="truncate font-mono text-11">{rule.appliesModel}</div>
        </div>
        <div>
          <div className="mb-1 text-10 text-muted-foreground">窗口</div>
          <div>{rule.window}</div>
        </div>
        <div>
          <div className="mb-1 text-10 text-muted-foreground">上限</div>
          <div className="font-mono">{rule.cap}</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full ${rule.usedPct >= 90 ? "bg-destructive" : "bg-foreground"}`}
            style={{ width: `${Math.min(100, rule.usedPct)}%` }}
          />
        </div>
        <span className={`font-mono text-10 ${rule.usedPct >= 90 ? "text-destructive" : "text-muted-foreground"}`}>
          已用 {rule.usedPct}%
        </span>
      </div>
      <div className="flex items-center gap-2 rounded-md border border-dashed border-border-subtle bg-panel px-2.5 py-2">
        <span className="whitespace-nowrap text-10 text-muted-foreground">达到上限后</span>
        <span className="min-w-0 flex-1 text-11">{rule.action}</span>
        <Button size="xs" variant="outline" onClick={() => onEdit(rule)} data-testid={`admin-limit-rule-edit-${rule.id}`}>
          编辑
        </Button>
      </div>
    </div>
  );
}

/**
 * 限额策略 tab（isMbPolicy 的限额规则列表 + 语义上并入的降级阈值/任务分级，
 * 见 `lib/mock/admin-limits.ts` 顶部注释关于字节序归类的留痕）。
 */
export function LimitPolicyTab() {
  const [rules, setRules] = React.useState<LimitRule[]>(LIMIT_RULES);
  const [editing, setEditing] = React.useState<LimitRule | null>(null);
  const [editCap, setEditCap] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);

  const openEdit = (rule: LimitRule) => {
    setEditing(rule);
    setEditCap(rule.cap);
  };

  const toggleRule = (id: string) => {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
    const target = rules.find((r) => r.id === id);
    if (target) setToast(`「${target.scopeName}」规则已${target.enabled ? "关闭" : "开启"}`);
  };

  return (
    <div className="flex flex-col gap-6" data-testid="admin-limits-tab">
      {/* 降级阈值：三级，最先触发的一条生效 */}
      <section className="flex flex-col gap-2" data-testid="admin-degrade-tiers">
        <div className="flex items-baseline gap-2">
          <h2 className="text-14 font-semibold">降级阈值 · 三级 ＋ 按任务分级</h2>
          <span className="text-10 text-muted-foreground">三级中最先触发的一条生效；降级方式按任务类型分级，不是一刀切</span>
        </div>
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
                <div className="h-full rounded-full bg-foreground" style={{ width: `${DEGRADE_TIERS.org.triggerPct}%` }} />
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
                <div className="h-full rounded-full bg-foreground" style={{ width: `${DEGRADE_TIERS.member.triggerPct}%` }} />
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
            <table className="w-full min-w-[560px] border-collapse text-11" data-testid="admin-degrade-task-table">
              <thead>
                <tr className="border-b border-border bg-panel text-11 text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">任务类型</th>
                  <th className="px-3 py-2 text-left font-medium">触发降级时</th>
                  <th className="px-3 py-2 text-left font-medium">为什么</th>
                </tr>
              </thead>
              <tbody>
                {TASK_TYPE_GRADING.map((row) => (
                  <tr key={row.key} className="border-b border-border-subtle last:border-b-0" data-testid={`admin-degrade-task-${row.key}`}>
                    <td className="px-3 py-2.5">{row.taskType}</td>
                    <td className={`px-3 py-2.5 font-medium ${taskToneClass(row.tone)}`}>{row.action}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{row.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </section>

      {/* 限额规则列表 */}
      <section className="flex flex-col gap-2" data-testid="admin-limits-rules">
        <div className="flex flex-wrap items-center gap-2">
          <ShieldAlert aria-hidden className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-14 font-semibold">限额规则</h2>
          <p className="min-w-[220px] flex-1 text-11 leading-relaxed text-muted-foreground" data-testid="admin-limits-intro">
            {LIMIT_POLICY_INTRO}
          </p>
          <Button size="sm" variant="primary" onClick={() => setCreating(true)} data-testid="admin-limits-new-rule">
            <Plus aria-hidden className="h-3.5 w-3.5" />
            新建限额规则
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rules.map((rule) => ruleCard(rule, toggleRule, openEdit))}
        </div>
      </section>

      {/* 编辑限额规则（mock：只改本地上限展示值，无后端持久化） */}
      {editing && (
        <AdminModal
          testid="admin-limit-rule-edit-dialog"
          title={`规则编辑 · ${editing.scopeName} × ${editing.appliesModel}`}
          subtitle={`作用对象：${editing.scopeKind} · ${editing.scopeName}`}
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)} data-testid="admin-limit-rule-edit-cancel">取消</Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  setRules((prev) => prev.map((r) => (r.id === editing.id ? { ...r, cap: editCap } : r)));
                  setToast(`已更新「${editing.scopeName} × ${editing.appliesModel}」的限额上限为 ${editCap}`);
                  setEditing(null);
                }}
                data-testid="admin-limit-rule-edit-save"
              >
                保存
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <Field id="admin-limit-rule-edit-model" data-testid="admin-limit-rule-edit-model" label="适用模型" value={editing.appliesModel} disabled />
            <Field id="admin-limit-rule-edit-window" data-testid="admin-limit-rule-edit-window" label="统计窗口" value={editing.window} disabled />
            <Field
              id="admin-limit-rule-edit-cap"
              data-testid="admin-limit-rule-edit-cap"
              label="上限"
              value={editCap}
              onChange={(e) => setEditCap(e.currentTarget.value)}
            />
            <p className="text-11 text-muted-foreground">达到上限后的动作：{editing.action}</p>
          </div>
        </AdminModal>
      )}

      {/* 新建限额规则（mock：追加到本地列表，无后端持久化） */}
      {creating && (
        <AdminModal
          testid="admin-limits-new-rule-dialog"
          title="新建限额规则"
          subtitle="限额按「谁 × 哪个模型 × 什么窗口」三段定义"
          onClose={() => setCreating(false)}
          footer={
            <>
              <Button size="sm" variant="ghost" onClick={() => setCreating(false)} data-testid="admin-limits-new-rule-cancel">取消</Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  const id = `lr-draft-${Date.now()}`;
                  setRules((prev) => [
                    ...prev,
                    {
                      id, scopeKind: "个人", scopeName: "（未命名规则）", enabled: true,
                      appliesModel: "全部模型", window: "每天", cap: "—", usedPct: 0,
                      action: "自动降级到 claude-sonnet-4.6", highlighted: false,
                    },
                  ]);
                  setToast("已新建限额规则草稿，请在卡片上点[编辑]补全上限");
                  setCreating(false);
                }}
                data-testid="admin-limits-new-rule-confirm"
              >
                创建
              </Button>
            </>
          }
        >
          <p className="text-12 text-muted-foreground">
            这是零后端 mock：创建后会以草稿形式加进下方规则列表，本地状态，刷新页面即重置。
          </p>
        </AdminModal>
      )}

      <Toast message={toast} testid="admin-limits-toast" onDismiss={() => setToast(null)} />
    </div>
  );
}
