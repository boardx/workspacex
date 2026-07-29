"use client";
import * as React from "react";
import { Check, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import type { ProjectRole } from "@/lib/identity";
import { cn } from "@/lib/utils";
import {
  BLUEPRINTS, DURATION_TIERS, TIER_LABEL, AGENDA_COUNT_BY_TIER, DEFAULT_TIER,
  INIT_CATEGORIES, configTotal, type DurationTier,
} from "@/lib/mock/tpl";
import { SignoffFlag, ConfirmDialog } from "./parts";
import { ProjectSideGaps } from "./project-gaps";

const APPLICABLE = BLUEPRINTS.filter((b) => b.state === "published");

export function ApplyWizardScreen({
  uiState, previewRole, onToast,
}: { uiState: UiState; previewRole: ProjectRole | null; onToast: (m: string) => void }) {
  const [step, setStep] = React.useState<1 | 2>(1);
  const [bpId, setBpId] = React.useState<string>(APPLICABLE[0]!.id);
  const [tier, setTier] = React.useState<DurationTier>(DEFAULT_TIER);
  const [confirm, setConfirm] = React.useState(false);
  const bp = APPLICABLE.find((b) => b.id === bpId)!;
  const total = configTotal();
  const agenda = AGENDA_COUNT_BY_TIER[tier];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-20 font-bold tracking-tight">新建项目</h1>
        <p className="text-12 text-muted-foreground">选一个已发布的蓝本 + 一个时长档位，一次性把六类默认值写进新项目。</p>
        <div className="mt-1 flex items-center gap-2 text-11">
          <StepDot n={1} active={step >= 1} label="选蓝本" />
          <ChevronRight aria-hidden className="h-3 w-3 text-muted-foreground" />
          <StepDot n={2} active={step >= 2} label="选档位并预览" />
        </div>
      </header>

      <StateShell
        state={uiState}
        skeletonRows={5}
        emptyHint="当前组织还没有已发布的蓝本可套用。先去后台把一个蓝本发布出来。"
        errors={{ "apply": "无法创建：主题未定 + 未选组长，属可分次推进的低准备度状态可保存，但『开场』前需补齐。" }}
        depFailure={{ what: "蓝本版本快照服务（UC-0.1 内核）暂不可用：无法绑定 blueprint_version_id，创建已暂停以避免建出无版本引用的项目。" }}
        denial={{ layer: "organization", reason: "只有组织角色『项目负责人 (lead)』或被授权的引导师能新建项目（依据 identity 契约 D-11）。" }}
        successMessage="项目已创建，绑定蓝本 HMW 定题项目 v4 快照；落到项目筹备页"
      >
        {step === 1 ? (
          <section className="flex flex-col gap-2" data-testid="tpl-apply-step1">
            <span className="text-12 font-medium">可选蓝本（仅已发布）</span>
            {APPLICABLE.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setBpId(b.id)}
                data-testid="tpl-apply-blueprint"
                className={cn(
                  "flex items-center gap-2 rounded-lg border p-3 text-left transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  b.id === bpId ? "border-primary bg-accent" : "border-border hover:bg-muted",
                )}
              >
                <span className={cn("flex h-4 w-4 items-center justify-center rounded-full border", b.id === bpId ? "border-primary bg-primary text-primary-foreground" : "border-input")}>
                  {b.id === bpId && <Check aria-hidden className="h-3 w-3" />}
                </span>
                <div className="flex-1">
                  <div className="text-13 font-medium">{b.name} <Badge tone="primary">v{b.version}</Badge></div>
                  <div className="text-10 text-muted-foreground">
                    {b.agendaSegments} 环节 · {b.duration} · 用过 {b.usedCount} 次 · {b.doneCount}/{total} 已配
                    {b.satisfaction ? ` · 满意度 ${b.satisfaction.mean.toFixed(1)}` : ""}
                  </div>
                </div>
              </button>
            ))}
            <div className="flex justify-end">
              <Button size="sm" variant="primary" onClick={() => setStep(2)} data-testid="tpl-apply-next">下一步：选档位 <ChevronRight aria-hidden className="h-3.5 w-3.5" /></Button>
            </div>
          </section>
        ) : (
          <section className="flex flex-col gap-3" data-testid="tpl-apply-step2">
            <div className="flex flex-col gap-1.5">
              <span className="text-12 font-medium">时长档位（默认取蓝本默认档位「两天」，可改）</span>
              <div className="flex flex-wrap gap-2">
                {DURATION_TIERS.map((t) => (
                  <Button key={t} size="sm" variant={t === tier ? "primary" : "outline"} onClick={() => setTier(t)} data-testid="tpl-apply-tier">
                    {TIER_LABEL[t]} · {AGENDA_COUNT_BY_TIER[t]} 环节
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5 rounded-lg border border-border p-3" data-testid="tpl-apply-init-preview">
              <span className="text-12 font-medium">将初始化什么（六类 · 复用蓝本一览）</span>
              <p className="text-11 text-muted-foreground">套用「{bp.name} v{bp.version}」+「{TIER_LABEL[tier]}」将写入 {agenda} 个议程环节，及以下六类默认值：</p>
              <ul className="flex flex-col gap-1">
                {INIT_CATEGORIES.map((c) => (
                  <li key={c.key} className="flex items-center gap-2 text-11" data-testid="tpl-apply-init-item">
                    <Badge tone="primary">{c.label}</Badge>
                    <span className="text-muted-foreground">→ {c.lands}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex items-center justify-between">
              <Button size="sm" variant="ghost" onClick={() => setStep(1)} data-testid="tpl-apply-back">上一步</Button>
              <Button size="sm" variant="primary" onClick={() => setConfirm(true)} data-testid="tpl-apply-create">创建项目</Button>
            </div>
          </section>
        )}
      </StateShell>

      {/* 项目侧缺失概念 —— UC-2.2 是项目唯一出生路径，但「项目」域需求刚被发现缺失 */}
      <ProjectSideGaps />

      <ConfirmDialog
        open={confirm}
        tone="primary"
        title="创建项目并绑定蓝本快照？"
        confirmLabel="确认创建"
        onConfirm={() => { setConfirm(false); onToast(`已创建项目，绑定 ${bp.name} v${bp.version} 快照（此后不随蓝本发布漂移）`); }}
        onClose={() => setConfirm(false)}
        impact={
          <div className="flex flex-col gap-1">
            <p>将一次性写入六类初始化项（要么全部成功、要么整体回滚，不建半成品）。</p>
            <p>项目绑定 <b>{bp.name} v{bp.version}</b> 的具体版本快照；引导师之后的修改不回写蓝本。</p>
            <SignoffFlag kind="confirmed-missing" title="向导为两步是设计判断（UC 未写明）">
              R8「推荐交互」建议两步（选蓝本 → 选档位并预览），但确认后才写入的细节、幂等去重的界面表达由我补。
            </SignoffFlag>
          </div>
        }
      />
    </div>
  );
}

function StepDot({ n, active, label }: { n: number; active: boolean; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn("flex h-4 w-4 items-center justify-center rounded-full text-10 font-semibold", active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{n}</span>
      <span className={cn(active ? "text-background-foreground" : "text-muted-foreground")}>{label}</span>
    </span>
  );
}
