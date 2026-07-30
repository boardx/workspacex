"use client";
import * as React from "react";
import {
  ShieldX, FileClock, Ban, Lock, AlertTriangle, ScrollText, Trash2, Check, ArrowLeft, Info,
} from "lucide-react";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Toggle } from "@/components/ui/toggle";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  RETENTION_PARAM, MATERIALS, CONSENT_RENDER, formatBytes, isReadOnlyRec, canWriteRec,
  type RecView, type MaterialRow,
} from "@/lib/mock/rec";

const SOURCE_LABEL: Record<MaterialRow["source"], string> = {
  interview: "访谈", workshop: "工作坊", conversation: "对话线程",
};

/**
 * UC-5.4 转写回流与保留期屏（F78–F79）。
 * ① 研究计划参数（材料保留期项目覆盖值 → 组织默认值 + 禁止训练开关）
 * ② 材料库每份保留期/删除时间（到期时间落库时固化）
 * ③ 同意书动态渲染 + 已提交快照不可改
 * 🔴 保留期到期删除撞上 phase-00 I-11「固定快照不可删」/ X-4「撤回是唯一豁口」——界面必须可见。
 */
export function RetentionPanel({ state, view }: { state: UiState; view: RecView }) {
  const readOnly = isReadOnlyRec(view);
  const canWrite = canWriteRec(view) && !readOnly;
  const eff = RETENTION_PARAM.effectiveDays;

  // 受访者视角：只看自己的授权告知（同意书渲染实例）
  if (view === "interviewee") return <IntervieweeConsentView eff={eff} />;

  return (
    <div className="flex flex-col gap-3 p-4">
      <header className="flex flex-col gap-0.5" data-testid="rec-retention-header">
        <h1 className="text-18 font-semibold tracking-tight">转写回流与保留期</h1>
        <p className="text-11 text-muted-foreground">
          材料保留期是五个留存参数之一，有组织默认值、项目级可覆盖；代码中不写死天数（数值来自参数解析）。
        </p>
      </header>

      <StateShell
        state={state}
        skeletonRows={5}
        emptyHint="本项目还没有归档的转写材料——一场录制结束、物化为文件后，逐字稿会按议程环节归入这里。"
        errors={{
          "org-default-missing": "组织默认「材料保留期」缺失、项目也未设覆盖值——拒绝开始录制并指向配置入口，不用隐含常量兜底（E5）。",
          "consent-var-missing": "同意书渲染变量缺失（未配置合规邮箱），不得发出授权链接：发一份告知不完整的同意书比不发更糟（E6）。",
        }}
        depFailure={{ what: "留存策略内核（五参数读取接口，由 00-core / 17-gov 提供）暂不可用；已解析并固化的到期时间不受影响，可安全重试。" }}
        denial={{ layer: "project", reason: "只有引导师/合规可编辑保留期参数与执行到期删除；你可查看每份材料的保留至日期，但不能修改。" }}
        successMessage="项目级「材料保留期」覆盖值已更新为 90 天：新发出的同意书文案随之变化；已提交的同意书快照与已落库材料的到期时间不变。"
      >
        <div className="flex flex-col gap-4">
          {/* ① 研究计划参数面板 */}
          <section className="flex flex-col gap-2 rounded-md border border-border-subtle bg-card p-3" data-testid="rec-retention-params">
            <div className="flex items-center gap-1.5">
              <FileClock aria-hidden className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-12 font-semibold">研究计划参数 · 数据保留</h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ret-days">材料保留期（项目级覆盖值）</Label>
                <div className="flex items-center gap-2">
                  <Input id="ret-days" type="number" defaultValue={RETENTION_PARAM.projectOverrideDays ?? ""} disabled={!canWrite} className="w-24" data-testid="rec-retention-days" />
                  <span className="text-11 text-muted-foreground">天</span>
                </div>
                <p className="text-9 text-muted-foreground" data-testid="rec-retention-resolution">
                  生效值 <strong className="font-medium text-background-foreground">{eff} 天</strong>（取自
                  {RETENTION_PARAM.resolvedFrom === "project-override" ? "项目覆盖值" : "组织默认值"}）· 组织默认 {RETENTION_PARAM.orgDefaultDays} 天。
                  解析结果与依据一并写入每份材料元数据。
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-13 font-medium">禁止用于训练</span>
                <div className="flex items-center gap-2">
                  <Toggle checked={RETENTION_PARAM.noTraining} onCheckedChange={() => {}} label="禁止用于训练" data-testid="rec-no-training" />
                  <span className="text-11 text-muted-foreground">独立开关，与保留期并列，全生命周期恒成立</span>
                </div>
                <p className="inline-flex items-center gap-1 text-9 text-muted-foreground"><Info aria-hidden className="h-3 w-3" /> 数值区间仍待合规收窄（O-01 默认已给：材料 180 天）；实现按参数读取，不写常量。</p> {/* [threshold-ok:retentionMaterial] 文案本身说的就是「按参数读取，不写常量」 */}
              </div>
            </div>
          </section>

          {/* ② 材料库：每份保留期 / 删除时间 */}
          <section className="flex flex-col gap-2" data-testid="rec-material-library">
            <h2 className="text-12 font-semibold text-muted-foreground">材料库 · 逐份保留期与删除时间（按议程环节归档）</h2>
            {MATERIALS.map((m) => <MaterialRowView key={m.id} m={m} canWrite={canWrite} />)}
          </section>

          {/* ③ 同意书动态渲染 + 快照不可改 */}
          <section className="grid gap-3 sm:grid-cols-2" data-testid="rec-consent">
            <div className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-card p-3">
              <div className="flex items-center gap-1.5">
                <ScrollText aria-hidden className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-12 font-semibold">同意书文案（按项目动态渲染）</h3>
              </div>
              <p className="rounded-md border border-border-subtle bg-panel p-2 text-11" data-testid="rec-consent-live">{CONSENT_RENDER.liveTemplate(eff)}</p>
              <p className="text-9 text-muted-foreground">三处同源：研究计划参数面板 / 材料库「保留至」/ 授权页告知，读同一解析结果，任一处对不上即缺陷。</p>
            </div>
            <div className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-card p-3">
              <div className="flex items-center gap-1.5">
                <Lock aria-hidden className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-12 font-semibold">已提交的同意书快照（不可回溯改写）</h3>
              </div>
              <p className="rounded-md border border-border-subtle bg-muted p-2 text-11" data-testid="rec-consent-snapshot">{CONSENT_RENDER.submittedSnapshot.text}</p>
              <p className="text-9 text-muted-foreground">
                {CONSENT_RENDER.submittedSnapshot.submittedBy} 于 {CONSENT_RENDER.submittedSnapshot.submittedAt} 提交（当时 {CONSENT_RENDER.submittedSnapshot.days} 天）；
                项目覆盖值改为 {eff} 天后此快照<strong className="font-medium text-background-foreground">仍显示 {CONSENT_RENDER.submittedSnapshot.days} 天</strong>——当时告知了什么，就是证据。
              </p>
            </div>
          </section>
        </div>
      </StateShell>
    </div>
  );
}

/* ── 单份材料行（含到期删除 + I-11/X-4 冲突呈现）──────────────────────── */

function MaterialRowView({ m, canWrite }: { m: MaterialRow; canWrite: boolean }) {
  const [confirming, setConfirming] = React.useState(false);
  const [ack, setAck] = React.useState(false);
  const blocked = m.status === "delete-blocked";
  const statusBadge =
    m.status === "active" ? <Badge tone="neutral">在保留期内</Badge>
    : m.status === "expiring" ? <Badge tone="warning">即将到期</Badge>
    : m.status === "pending-delete" ? <Badge tone="warning">待删除队列</Badge>
    : <Badge tone="danger" data-testid={`rec-mat-blocked-${m.id}`}>到期但删不掉</Badge>;

  return (
    <div data-testid={`rec-material-${m.id}`} className={cn("flex flex-col gap-2 rounded-md border p-3", blocked ? "border-destructive/40 bg-destructive/5" : "border-border-subtle bg-card")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-12 font-medium">{m.name}</span>
          <span className="text-9 text-muted-foreground">{SOURCE_LABEL[m.source]} · {m.segment} · {formatBytes(m.sizeBytes)} · 落库 {m.storedAt}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="outline" data-testid={`rec-mat-retention-${m.id}`}>保留至 {m.deleteBy}（{m.retentionDays} 天 · {m.resolvedFrom === "project-override" ? "项目覆盖" : "组织默认"}）</Badge>
          {statusBadge}
        </div>
      </div>

      {/* 🔴 I-11 / X-4 冲突：到期该删，但已被定版引用 → 删不掉 */}
      {blocked && (
        <div className="flex flex-col gap-1.5 rounded-md border border-destructive/40 bg-card p-2.5" data-testid={`rec-conflict-${m.id}`}>
          <p className="inline-flex items-center gap-1.5 text-11 font-medium text-destructive">
            <ShieldX aria-hidden className="h-4 w-4" /> 保留期已到，本应删除——但删不掉。
          </p>
          <ul className="flex list-disc flex-col gap-0.5 pl-5 text-10 text-muted-foreground">
            <li>这份逐字稿已被 <strong className="font-medium text-background-foreground">「{m.pinnedByFinalReport}」</strong> 定版引用（固定快照）。</li>
            <li>phase-00 <strong className="font-medium text-background-foreground">I-11</strong>：固定快照不可删、不可改、不可降级。</li>
            <li>一致性复核 <strong className="font-medium text-background-foreground">X-4</strong>：撤回删除是不可变原则的唯一豁口。</li>
          </ul>
          <p className="text-10 text-destructive">
            「材料保留期到期要删」与「被定版引用不可删」直接相撞。这不是实现能自己定的——
            <strong className="font-medium">应由合规 + 契约裁决</strong>（是否算法定留存豁免？还是走撤回豁口物理删除并让定版报告标「证据已撤回」？）。界面只把冲突显式暴露，不糊过去。
          </p>
          <Badge tone="outline" className="self-start">待裁决 · 见 README 第二节 #1</Badge>
        </div>
      )}

      {/* 到期删除的危险动作：二次确认 + 影响范围（仅对可删的到期材料）*/}
      {m.status === "expiring" && !blocked && (
        confirming ? (
          <div className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-card p-2.5" data-testid={`rec-delete-confirm-${m.id}`}>
            <button type="button" onClick={() => { setConfirming(false); setAck(false); }} className="inline-flex items-center gap-1 self-start text-11 text-muted-foreground transition-colors duration-200 hover:text-background-foreground" data-testid={`rec-delete-back-${m.id}`}>
              <ArrowLeft aria-hidden className="h-3 w-3" /> 先不删
            </button>
            <p className="inline-flex items-center gap-1 text-11 font-medium text-destructive"><AlertTriangle aria-hidden className="h-3.5 w-3.5" /> 到期删除的影响范围</p>
            <ul className="flex list-disc flex-col gap-0.5 pl-5 text-10 text-muted-foreground">
              <li>先逻辑失效（退出检索、Context Pack 不再召回该 Segment）再物理删除。</li>
              <li>删到文件层：22-files 中该场次音频 / transcript.jsonl / notes.md / 白板照片真的消失、不可下载。</li>
              <li>级联失效 OCR / embedding / 图边 / 摘要 / 缓存；产出可检索的删除证明。</li>
              <li>不可删对象（快照 / 绑定关系 / 审计留痕）豁免保留，不被误删。</li>
            </ul>
            <Checkbox checked={ack} onChange={(e) => setAck(e.currentTarget.checked)} label="我已了解上述影响范围，确认执行到期删除" data-testid={`rec-delete-ack-${m.id}`} />
            <div className="flex items-center gap-1.5">
              <Button size="xs" variant="destructive" disabled={!ack} data-testid={`rec-delete-commit-${m.id}`}><Trash2 aria-hidden className="h-3 w-3" /> 确认删除并出删除证明</Button>
              <Button size="xs" variant="ghost" onClick={() => { setConfirming(false); setAck(false); }} data-testid={`rec-delete-cancel-${m.id}`}>取消</Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="outline" className="self-start" disabled={!canWrite} onClick={() => setConfirming(true)} data-testid={`rec-delete-${m.id}`}>
            <Ban aria-hidden className="h-3.5 w-3.5" /> 执行到期删除…
          </Button>
        )
      )}
    </div>
  );
}

/* ── 受访者视角：只看自己的授权告知 ─────────────────────────────── */

function IntervieweeConsentView({ eff }: { eff: number }) {
  return (
    <div className="flex flex-col gap-4 p-4" data-testid="rec-interviewee-consent">
      <header className="flex flex-col gap-1">
        <h1 className="text-18 font-semibold tracking-tight">你的授权告知</h1>
        <p className="text-11 text-muted-foreground">你只能看到自己的授权与告知文案，看不到项目内部材料或其他受访者的数据。</p>
      </header>
      <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted p-3">
        <p className="text-12 font-medium">录音授权（当前项目文案）</p>
        <p className="text-11 text-muted-foreground" data-testid="rec-interviewee-consent-text">{CONSENT_RENDER.liveTemplate(eff)}</p>
      </div>
      <div className="flex flex-col gap-1 rounded-md border border-border-subtle bg-card p-3">
        <p className="text-11 font-medium">你已提交的同意书（快照）</p>
        <p className="text-10 text-muted-foreground">{CONSENT_RENDER.submittedSnapshot.text}</p>
        <p className="text-9 text-muted-foreground">提交于 {CONSENT_RENDER.submittedSnapshot.submittedAt}；即便项目后来改了保留期，你当时看到的告知不变。</p>
      </div>
      <p className="text-10 text-muted-foreground">
        数据控制方：{RETENTION_PARAM.dataController} · 联系人 {RETENTION_PARAM.contact} · 合规邮箱 {RETENTION_PARAM.complianceEmail}
      </p>
    </div>
  );
}
