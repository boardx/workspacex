"use client";
import { recordingDisplay, recordingWithdrawalKeys, recordingSla } from "./recording-project-display";
import { useI18n } from "@/lib/i18n/provider";
import * as React from "react";
import {
  ShieldX, FileClock, Ban, Lock, AlertTriangle, ScrollText, Trash2, Check, ArrowLeft, Info, Undo2, FileWarning, UserCog,
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
  RETENTION_PARAM, MATERIALS, CONSENT_RENDER, consentItemsFor, formatBytes, isReadOnlyRec, canWriteRec,
  type RecView, type MaterialRow,
} from "@/lib/mock/rec";
// ⚠ 撤回五步 SLA 单一事实源——不在此文件另写一份（`lib/withdrawal-flow.ts` 头注有收敛记录）。
import { WITHDRAWAL_FLOW, WITHDRAWAL_SLA_SUMMARY } from "@/lib/withdrawal-flow";

const SOURCE_KEY = { interview: "rec.project.source.interview", workshop: "rec.project.source.workshop", conversation: "rec.project.source.conversation" } as const;

/**
 * UC-5.4 转写回流与保留期屏（F78–F79）。
 * ① 研究计划参数（材料保留期项目覆盖值 → 组织默认值 + 禁止训练开关）
 * ② 材料库每份保留期/删除时间（到期时间落库时固化）
 * ③ 同意书动态渲染 + 已提交快照不可改
 * 🔴 保留期到期删除撞上 phase-00 I-11「固定快照不可删」/ X-4「撤回是唯一豁口」——界面必须可见。
 */
export function RetentionPanel({ state, view }: { state: UiState; view: RecView }) {
  const { t: recT } = useI18n();
  const readOnly = isReadOnlyRec(view);
  const canWrite = canWriteRec(view) && !readOnly;
  const eff = RETENTION_PARAM.effectiveDays;

  // 受访者视角：只看自己的授权告知（同意书渲染实例）
  if (view === "interviewee") return <IntervieweeConsentView eff={eff} />;

  return (
    <div className="flex flex-col gap-3 p-4">
      <header className="flex flex-col gap-0.5" data-testid="rec-retention-header">
        <h1 className="text-18 font-semibold tracking-tight">{recT("rec.project.transcript.return.and.retention")}</h1>
        <p className="text-11 text-muted-foreground">

          {recT("rec.project.material.retention.is.one.of.five.retention")}
        </p>
      </header>

      <StateShell
        state={state}
        skeletonRows={5}
        emptyHint={recT("rec.project.this.project.has.no.archived.transcripts.yet")}
        errors={{
          "org-default-missing": recT("rec.project.neither.an.organization.retention.default.nor.a"),
          "consent-var-missing": recT("rec.project.the.consent.template.is.missing.a.compliance"),
        }}
        depFailure={{ what: recT("rec.project.the.retention.policy.service.00core.17gov.is") }}
        denial={{ layer: "project", reason: recT("rec.project.only.facilitators.and.compliance.staff.can.edit") }}
        successMessage={recT("rec.project.the.project.retention.override.is.now.90")}
      >
        <div className="flex flex-col gap-4">
          {/* ① 研究计划参数面板 */}
          <section className="flex flex-col gap-2 rounded-md border border-border-subtle bg-card p-3" data-testid="rec-retention-params">
            <div className="flex items-center gap-1.5">
              <FileClock aria-hidden className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-12 font-semibold">{recT("rec.project.research.plan.parameters.data.retention")}</h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ret-days">{recT("rec.project.material.retention.project.override")}</Label>
                <div className="flex items-center gap-2">
                  <Input id="ret-days" type="number" defaultValue={RETENTION_PARAM.projectOverrideDays ?? ""} disabled={!canWrite} className="w-24" data-testid="rec-retention-days" />
                  <span className="text-11 text-muted-foreground">{recT("rec.project.days")}</span>
                </div>
                <p className="text-9 text-muted-foreground" data-testid="rec-retention-resolution">

                  {recT("rec.project.effective.value")} <strong className="font-medium text-background-foreground">{eff}  {recT("rec.project.days")}</strong> {recT("rec.project.from")} {" "}
                  {RETENTION_PARAM.resolvedFrom === "project-override" ? recT("rec.project.project.override") : recT("rec.project.organization.default")}{recT("rec.project.organization.defaultSuffix")} {RETENTION_PARAM.orgDefaultDays}  {recT("rec.project.days.the.resolved.value.and.its.basis")}
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-13 font-medium">{recT("rec.project.do.not.use.for.training")}</span>
                <div className="flex items-center gap-2">
                  <Toggle checked={RETENTION_PARAM.noTraining} onCheckedChange={() => {}} label={recT("rec.project.do.not.use.for.training")} data-testid="rec-no-training" />
                  <span className="text-11 text-muted-foreground">{recT("rec.project.an.independent.setting.that.applies.throughout.the")}</span>
                </div>
                <p className="inline-flex items-center gap-1 text-9 text-muted-foreground"><Info aria-hidden className="h-3 w-3" />  {recT("rec.project.compliance.has.yet.to.narrow.the.range")}</p>{" "}
              </div>
            </div>
          </section>

          {/* ② 材料库：每份保留期 / 删除时间 */}
          <section className="flex flex-col gap-2" data-testid="rec-material-library">
            <h2 className="text-12 font-semibold text-muted-foreground">{recT("rec.project.material.library.retention.and.deletion.dates.by")}</h2>
            {MATERIALS.map((m) => <MaterialRowView key={m.id} m={m} canWrite={canWrite} />)}
          </section>

          {/* ③ 同意书动态渲染 + 快照不可改 */}
          <section className="grid gap-3 sm:grid-cols-2" data-testid="rec-consent">
            <div className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-card p-3">
              <div className="flex items-center gap-1.5">
                <ScrollText aria-hidden className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-12 font-semibold">{recT("rec.project.consent.notice.rendered.for.this.project")}</h3>
              </div>
              <p className="rounded-md border border-border-subtle bg-panel p-2 text-11" data-testid="rec-consent-live">{CONSENT_RENDER.liveTemplate(eff)}</p>
              <p className="text-9 text-muted-foreground">{recT("rec.project.the.research.plan.material.retention.dates.and")}</p>
            </div>
            <div className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-card p-3">
              <div className="flex items-center gap-1.5">
                <Lock aria-hidden className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-12 font-semibold">{recT("rec.project.submitted.consent.snapshot.cannot.be.rewritten")}</h3>
              </div>
              <p className="rounded-md border border-border-subtle bg-muted p-2 text-11" data-testid="rec-consent-snapshot">{CONSENT_RENDER.submittedSnapshot.text}</p>
              <p className="text-9 text-muted-foreground">
                {CONSENT_RENDER.submittedSnapshot.submittedBy}  {recT("rec.project.on")} {CONSENT_RENDER.submittedSnapshot.submittedAt}  {recT("rec.project.submitted.then")} {CONSENT_RENDER.submittedSnapshot.days}  {recT("rec.project.days.the.project.override.changed.to")} {eff}  {recT("rec.project.days.but.this.snapshot")} {" "}<strong className="font-medium text-background-foreground">{recT("rec.project.still.shows")} {CONSENT_RENDER.submittedSnapshot.days}  {recT("rec.project.days")}</strong> {recT("rec.project.the.notice.shown.at.submission.is")}
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
  const { t: recT } = useI18n();
  const [confirming, setConfirming] = React.useState(false);
  const [ack, setAck] = React.useState(false);
  const blocked = m.status === "delete-blocked";
  const statusBadge =
    m.status === "active" ? <Badge tone="neutral">{recT("rec.project.within.retention.period")}</Badge>
    : m.status === "expiring" ? <Badge tone="warning">{recT("rec.project.expiring.soon")}</Badge>
    : m.status === "pending-delete" ? <Badge tone="warning">{recT("rec.project.deletion.queue")}</Badge>
    : <Badge tone="danger" data-testid={`rec-mat-blocked-${m.id}`}>{recT("rec.project.expired.but.blocked.from.deletion")}</Badge>;

  return (
    <div data-testid={`rec-material-${m.id}`} className={cn("flex flex-col gap-2 rounded-md border p-3", blocked ? "border-destructive/40 bg-destructive/5" : "border-border-subtle bg-card")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-12 font-medium">{m.name}</span>
          <span className="text-9 text-muted-foreground">{recT(SOURCE_KEY[m.source])} · {m.segment} · {formatBytes(m.sizeBytes)}  {recT("rec.project.stored")} {m.storedAt}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="outline" data-testid={`rec-mat-retention-${m.id}`}>{recT("rec.project.retain.until")} {m.deleteBy}（{m.retentionDays}  {recT("rec.project.days.")} {m.resolvedFrom === "project-override" ? recT("rec.project.project.override.187") : recT("rec.project.organization.default.188")}）</Badge>
          {statusBadge}
        </div>
      </div>

      {/* 🔴 I-11 / X-4 冲突：到期该删，但已被定版引用 → 删不掉 */}
      {blocked && (
        <div className="flex flex-col gap-1.5 rounded-md border border-destructive/40 bg-card p-2.5" data-testid={`rec-conflict-${m.id}`}>
          <p className="inline-flex items-center gap-1.5 text-11 font-medium text-destructive">
            <ShieldX aria-hidden className="h-4 w-4" />  {recT("rec.project.the.retention.period.has.ended.but.deletion")}
          </p>
          <ul className="flex list-disc flex-col gap-0.5 pl-5 text-10 text-muted-foreground">
            <li>{recT("rec.project.this.transcript.is.referenced.by")} <strong className="font-medium text-background-foreground">「{m.pinnedByFinalReport}」</strong>  {recT("rec.project.as.a.finalized.fixed.snapshot")}</li>
            <li>phase-00 <strong className="font-medium text-background-foreground">I-11</strong>{recT("rec.project.fixed.snapshots.cannot.be.deleted.modified")}</li>
            <li>{recT("rec.project.consistency.review")} <strong className="font-medium text-background-foreground">X-4</strong>{recT("rec.project.withdrawal.deletion.is.the.sole.exception")}</li>
          </ul>
          <p className="text-10 text-destructive">

            {recT("rec.project.expiry.deletion.conflicts.with.preservation.of.finalized")}
            <strong className="font-medium">{recT("rec.project.a.compliance.and.contract.decision")}</strong> {recT("rec.project.whether.a.legal.retention.exception.applies.or")}
          </p>
          <Badge tone="outline" className="self-start">{recT("rec.project.decision.required.see.readme.section.2.item")}</Badge>
        </div>
      )}

      {/* 到期删除的危险动作：二次确认 + 影响范围（仅对可删的到期材料）*/}
      {m.status === "expiring" && !blocked && (
        confirming ? (
          <div className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-card p-2.5" data-testid={`rec-delete-confirm-${m.id}`}>
            <button type="button" onClick={() => { setConfirming(false); setAck(false); }} className="inline-flex items-center gap-1 self-start text-11 text-muted-foreground transition-colors duration-200 hover:text-background-foreground" data-testid={`rec-delete-back-${m.id}`}>
              <ArrowLeft aria-hidden className="h-3 w-3" />  {recT("rec.project.keep.for.now")}
            </button>
            <p className="inline-flex items-center gap-1 text-11 font-medium text-destructive"><AlertTriangle aria-hidden className="h-3.5 w-3.5" />  {recT("rec.project.scope.of.expiry.deletion")}</p>
            <ul className="flex list-disc flex-col gap-0.5 pl-5 text-10 text-muted-foreground">
              <li>{recT("rec.project.invalidate.first.remove.from.search.and.context")}</li>
              <li>{recT("rec.project.delete.session.audio.transcriptjsonl.notesmd.and.whiteboard")}</li>
              <li>{recT("rec.project.invalidate.related.ocr.embeddings.graph.edges.summaries")}</li>
              <li>{recT("rec.project.exempt.immutable.snapshots.bindings.and.audit.records")}</li>
            </ul>
            <Checkbox checked={ack} onChange={(e) => setAck(e.currentTarget.checked)} label={recT("rec.project.i.understand.the.scope.and.confirm.deletion")} data-testid={`rec-delete-ack-${m.id}`} />
            <div className="flex items-center gap-1.5">
              <Button size="xs" variant="destructive" disabled={!ack} data-testid={`rec-delete-commit-${m.id}`}><Trash2 aria-hidden className="h-3 w-3" />  {recT("rec.project.confirm.deletion.and.generate.receipt")}</Button>
              <Button size="xs" variant="ghost" onClick={() => { setConfirming(false); setAck(false); }} data-testid={`rec-delete-cancel-${m.id}`}>{recT("rec.project.cancel")}</Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="outline" className="self-start" disabled={!canWrite} onClick={() => setConfirming(true)} data-testid={`rec-delete-${m.id}`}>
            <Ban aria-hidden className="h-3.5 w-3.5" />  {recT("rec.project.delete.expired.materials")}
          </Button>
        )
      )}
    </div>
  );
}

/* ── 受访者视角：只看自己的授权告知（原型 16392000「外部受访者·同意与撤回」）───── */

function IntervieweeConsentView({ eff }: { eff: number }) {
  const { t: recT } = useI18n();
  const items = consentItemsFor(eff);
  const [withdrawing, setWithdrawing] = React.useState(false);

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="rec-interviewee-consent">
      <header className="flex flex-col gap-1">
        <h1 className="text-18 font-semibold tracking-tight">{recT("rec.project.your.consent.notice")}</h1>
        <p className="text-11 text-muted-foreground">

          {recT("rec.project.view.your.own.consent.choices.and.notices")}
        </p>
      </header>

      {/* 四项自选 —— 与准备室逐人×三项授权矩阵同源（录音/转录/AI 分析）+ 署名项 */}
      <div className="flex flex-col gap-2" data-testid="rec-interviewee-consent-items">
        <p className="text-12 font-semibold">{recT("rec.project.your.consented.items.each.choice.is.independent")}</p>
        {items.map((it) => (
          <div
            key={it.id}
            data-testid={`rec-interviewee-consent-item-${it.id}`}
            className={cn("rounded-md border p-3", it.granted ? "border-border-subtle bg-card" : "border-warning/30 bg-warning/5")}
          >
            <Checkbox
              checked={it.granted}
              disabled
              onChange={() => {}}
              data-testid={`rec-interviewee-consent-check-${it.id}`}
              label={<span className="flex items-center gap-2">{recT(({ record: "rec.project.consentLabel.record", transcript: "rec.project.consentLabel.transcript", aiAnalysis: "rec.project.consentLabel.aiAnalysis", realname: "rec.project.consentLabel.realname" } as const)[it.id])}{!it.granted && <Badge tone="warning">{recT("rec.project.you.declined")}</Badge>}</span>}
              description={recT(({ record: "rec.project.consentHelp.record", transcript: "rec.project.consentHelp.transcript", aiAnalysis: "rec.project.consentHelp.aiAnalysis", realname: "rec.project.consentHelp.realname" } as const)[it.id], { days: eff })}
            />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted p-3">
        <p className="text-12 font-medium">{recT("rec.project.recording.consent.current.project.notice")}</p>
        <p className="text-11 text-muted-foreground" data-testid="rec-interviewee-consent-text">{CONSENT_RENDER.liveTemplate(eff)}</p>
      </div>
      <div className="flex flex-col gap-1 rounded-md border border-border-subtle bg-card p-3">
        <p className="text-11 font-medium">{recT("rec.project.your.submitted.consent.snapshot")}</p>
        <p className="text-10 text-muted-foreground">{CONSENT_RENDER.submittedSnapshot.text}</p>
        <p className="text-9 text-muted-foreground">{recT("rec.project.submitted.on")} {CONSENT_RENDER.submittedSnapshot.submittedAt}{recT("rec.project.later.retention.changes.do.not.alter")}</p>
      </div>

      {/* 撤回之后会发生什么 —— 五步，单一事实源 lib/withdrawal-flow.ts */}
      <div className="flex flex-col gap-2 rounded-md border border-border-subtle bg-panel p-3" data-testid="rec-interviewee-withdraw">
        <div className="flex items-center justify-between gap-2">
          <p className="text-12 font-semibold">{recT("rec.project.what.happens.after.withdrawal")}</p>
          <span className="text-10 text-muted-foreground">{recT("rec.project.withdrawal.summary", { logical: recordingSla(recT, WITHDRAWAL_SLA_SUMMARY.logical), physical: recordingSla(recT, WITHDRAWAL_SLA_SUMMARY.physical) })}</span>
        </div>
        {!withdrawing ? (
          <Button size="sm" variant="outline" className="self-start" onClick={() => setWithdrawing(true)} data-testid="rec-interviewee-withdraw-open">
            <Undo2 aria-hidden className="h-3.5 w-3.5" />  {recT("rec.project.view.the.effects.of.withdrawal")}
          </Button>
        ) : (
          <ol className="flex flex-col gap-1.5" data-testid="rec-interviewee-withdraw-flow">
            {WITHDRAWAL_FLOW.map((s) => (
              <li
                key={s.no}
                data-testid={`rec-interviewee-withdraw-step-${s.no}`}
                className={cn(
                  "flex items-start gap-2.5 rounded-md border p-2.5",
                  s.emphasis === "evidence" ? "border-warning/40 bg-warning/5"
                    : s.emphasis === "human" ? "border-ai/30 bg-ai-tint"
                      : "border-border-subtle bg-card",
                )}
              >
                <span className="font-mono text-11 font-semibold text-muted-foreground">{s.no}</span>
                <div className="flex flex-1 flex-wrap items-center gap-1.5">
                  <span className="text-11">{recordingDisplay(recT, recordingWithdrawalKeys, s.no, s.step)}</span>
                  {s.emphasis === "evidence" && <Badge tone="warning"><FileWarning aria-hidden className="h-3 w-3" />  {recT("rec.project.mark.as.retained")}</Badge>}
                  {s.emphasis === "human" && <Badge tone="ai"><UserCog aria-hidden className="h-3 w-3" />  {recT("rec.project.notify.the.decision.maker.for.review")}</Badge>}
                </div>
                <span className="shrink-0 text-10 text-muted-foreground">{recordingSla(recT, s.sla)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <p className="text-10 text-muted-foreground">

        {recT("rec.project.data.controller")}{RETENTION_PARAM.dataController}  {recT("rec.project.contact")} {RETENTION_PARAM.contact}  {recT("rec.project.compliance.email")} {RETENTION_PARAM.complianceEmail}
      </p>
    </div>
  );
}
