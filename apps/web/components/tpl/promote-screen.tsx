"use client";
import * as React from "react";
import { GitPullRequestArrow, Check, X, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import type { ProjectRole } from "@/lib/identity";
import { DEVIATIONS, PENDING_CHANGES, type PendingChange } from "@/lib/mock/tpl";
import { ConfirmDialog, SignoffFlag } from "./parts";

export function PromoteScreen({
  uiState, previewRole, onToast,
}: { uiState: UiState; previewRole: ProjectRole | null; onToast: (m: string) => void }) {
  // 「蓝本维护者」是谁尚未裁决（缺 D-1）；此处以引导师=不可合并、方法负责人=可合并演示
  const canMerge = previewRole === "facilitator" ? false : true;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 p-4" data-testid="tpl-promote">
      <header className="flex flex-col gap-0.5">
        <h1 className="text-20 font-bold tracking-tight">把一次项目的改动提回蓝本</h1>
        <p className="text-12 text-muted-foreground">项目内改动不回写蓝本；复盘里「提交回蓝本」是唯一的沉淀通道。</p>
      </header>

      <SignoffFlag kind="unexplored" title="整份 UC 不可 sign-off —— 两侧屏一个未探明、一个确认缺失" testid="tpl-promote-flag">
        项目侧复盘屏（含偏离清单）本轮未点开，属「未探明」，不能断言原型有没有画；蓝本侧「待审改动收件面」在已探明区确认缺失（设计器与列表页都无入口）。下面两侧都是补画草案，需先补抽取 + 补画后再签。
      </SignoffFlag>

      <StateShell
        state={uiState}
        skeletonRows={6}
        emptyHint="本场完全照蓝本跑，没有偏离项。无需提回。"
        errors={{ "promote": "提交被拒：有勾选项未写「为什么」。理由必填 —— 蓝本规则的可追溯性靠这一句支撑。" }}
        depFailure={{ what: "蓝本版本快照服务暂不可用：无法以项目绑定版本为基准做偏离 diff，提交已暂停。" }}
        denial={{ layer: "project", reason: "观察者不能提回；提回由引导师发起、方法负责人（蓝本维护者）合并。" }}
        successMessage="已生成待审改动挂到蓝本上（不改蓝本内容、不生成新版本），等待维护者审阅"
      >
        <div className="grid gap-3 lg:grid-cols-2">
          {/* 项目侧：偏离清单 + 勾选 + 理由 */}
          <ProjectDeviations onToast={onToast} />
          {/* 蓝本侧：待审改动收件面 */}
          <MaintainerInbox canMerge={canMerge} onToast={onToast} />
        </div>
      </StateShell>
    </div>
  );
}

function ProjectDeviations({ onToast }: { onToast: (m: string) => void }) {
  const [checked, setChecked] = React.useState<Set<string>>(new Set([DEVIATIONS[0]!.configItemKey]));
  const [reasons, setReasons] = React.useState<Record<string, string>>({});
  const toggle = (k: string) => setChecked((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border p-4" data-testid="tpl-deviations">
      <div className="flex items-center gap-2">
        <GitPullRequestArrow aria-hidden className="h-4 w-4 text-muted-foreground" />
        <span className="text-13 font-semibold">项目侧 · 偏离清单（复盘 → 提交回蓝本）</span>
      </div>
      <p className="text-10 text-muted-foreground">按配置项定义表逐项列出「蓝本原值 → 本场实际值」；勾选要沉淀的项，每条写一句为什么（必填）。</p>
      <ul className="flex flex-col gap-2">
        {DEVIATIONS.map((d) => {
          const on = checked.has(d.configItemKey);
          return (
            <li key={d.configItemKey} className="flex flex-col gap-1.5 rounded-md border border-border p-2.5" data-testid="tpl-deviation-row">
              <Checkbox
                checked={on}
                onChange={() => toggle(d.configItemKey)}
                data-testid="tpl-deviation-check"
                label={<span className="text-12 font-medium">{d.configItemLabel}</span>}
                description={<span>蓝本原值：{d.before} → 本场实际值：{d.after}</span>}
              />
              {on && (
                <Input
                  placeholder="为什么值得沉淀回蓝本？（必填）"
                  value={reasons[d.configItemKey] ?? ""}
                  onChange={(e) => setReasons((r) => ({ ...r, [d.configItemKey]: e.target.value }))}
                  data-testid="tpl-deviation-reason"
                />
              )}
            </li>
          );
        })}
      </ul>
      <Button
        size="sm"
        variant="primary"
        className="w-fit"
        onClick={() => onToast("已提交，生成待审改动，等待蓝本维护者审阅（提交 ≠ 生效）")}
        data-testid="tpl-promote-submit"
      >
        提交回蓝本
      </Button>
      <p className="text-10 text-muted-foreground">已提交，等待维护者审阅 —— 不是已生效。</p>
    </section>
  );
}

function MaintainerInbox({ canMerge, onToast }: { canMerge: boolean; onToast: (m: string) => void }) {
  const [merging, setMerging] = React.useState<PendingChange | null>(null);
  // 同一处（流程 Agenda）被多场改过 → 并排显示各自理由
  const grouped = PENDING_CHANGES.reduce<Record<string, PendingChange[]>>((acc, c) => {
    (acc[c.configItemLabel] ??= []).push(c);
    return acc;
  }, {});

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border p-4" data-testid="tpl-inbox">
      <div className="flex items-center gap-2">
        <Inbox aria-hidden className="h-4 w-4 text-muted-foreground" />
        <span className="text-13 font-semibold">蓝本侧 · 待审改动收件面</span>
        <Badge tone="warning" className="ml-auto">{PENDING_CHANGES.length} 待审</Badge>
      </div>
      <SignoffFlag kind="confirmed-missing" title="此收件面 + 入口/角标/通知均确认缺失 —— 补画">
        入口挂哪（列表行 / 设计器顶部 / 独立收件箱）、是否有未读角标、通知方式都待定。「蓝本维护者」是组织角色还是每份蓝本单独指定的 owner，也待裁（缺 D-1）。
      </SignoffFlag>
      {Object.entries(grouped).map(([label, changes]) => (
        <div key={label} className="flex flex-col gap-1.5 rounded-md border border-border p-2.5" data-testid="tpl-inbox-group">
          <div className="flex items-center gap-2">
            <span className="text-12 font-medium">{label}</span>
            {changes.length > 1 && <Badge tone="outline">同一处 {changes.length} 场提回 · 并排看理由</Badge>}
          </div>
          {changes.map((c) => (
            <div key={c.id} className="flex flex-col gap-1 border-t border-border/60 pt-1.5" data-testid="tpl-inbox-item">
              <div className="text-11">{c.before} → <b>{c.after}</b></div>
              <div className="text-10 text-muted-foreground">理由：{c.rationale}</div>
              <div className="text-10 text-muted-foreground">来源：{c.sourceProject} · {c.proposedBy} · {c.proposedAt} · 基准 v{c.baseVersion}</div>
              <div className="flex items-center gap-1.5">
                <Button size="xs" variant="outline" disabled={!canMerge} onClick={() => setMerging(c)} data-testid="tpl-inbox-accept"><Check aria-hidden className="h-3 w-3" /> 接受</Button>
                <Button size="xs" variant="ghost" disabled={!canMerge} onClick={() => onToast(`已拒绝：${c.configItemLabel}（来自 ${c.sourceProject}）`)} data-testid="tpl-inbox-reject"><X aria-hidden className="h-3 w-3" /> 拒绝</Button>
                {!canMerge && <span className="text-10 text-muted-foreground">只有蓝本维护者能合并</span>}
              </div>
            </div>
          ))}
        </div>
      ))}

      <ConfirmDialog
        open={!!merging}
        tone="primary"
        title={`接受并合并改动到蓝本草稿？`}
        confirmLabel="确认合并"
        onConfirm={() => { onToast(`已接受：${merging?.configItemLabel}，进入蓝本草稿（发布仍走 UC-2.1 门槛）`); setMerging(null); }}
        onClose={() => setMerging(null)}
        impact={
          <div className="flex flex-col gap-1">
            <p>接受后改动进入蓝本<b>草稿</b>，不立即改当前版本；发布仍走「必填完成 ∧ 已试跑」门槛。</p>
            <p className="text-muted-foreground">合并后该蓝本字段可反查到来源项目 + 提出人 + 时间 + 理由（AC1 四要素）。</p>
          </div>
        }
      />
    </section>
  );
}
