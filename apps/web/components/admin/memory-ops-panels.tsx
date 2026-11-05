"use client";
import * as React from "react";
import { useI18n } from "@/lib/i18n/provider";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { ApiError } from "@/lib/api-client";
import type { Locale } from "@/lib/i18n/locale";
import { translate, type MessageKey } from "@/lib/i18n/messages";
import { httpFailureText } from "@/lib/http-failure-text";
import {
  getConsolidationSetting, getExtractionSlo, runConsolidationNow, setConsolidationSetting,
  type ConsolidationPassOut, type ExtractionSloOut,
} from "@/lib/live-memory-ops";

/**
 * Phase 18 S8（#4365）—— 平台后台「运营状态」屏里、紧挨着「记忆抽取（整个部署）」开关的两块：
 *
 * - 「记忆抽取 SLO」：p95 延迟、失败率、卡住的租约（三个 SLO 指标，超阈值时顶部出横幅），以及「值得记」门控
 *   省下了多少次抽取模型调用。延迟 / 失败率 / 门控计数是**本实例**最近一小时；卡住的租约 / 死信 / 积压是全库现数。
 * - 「记忆整合」：部署级开关（**默认关**），以及「现在整合一次」（只回计数，不显示任何人的记忆内容——整合改了谁的哪一条，
 *   只有本人在自己的大脑页看得到、撤得动）。
 *
 * 权限形状同 `platform-extraction-setting-panel.tsx`：403 `NOT_PLATFORM_SUPERUSER` 渲染成一句说明、不画控件。
 */

const FORBIDDEN_TEXT = "platformOps.settingDenied";

function isForbidden(err: unknown): boolean {
  return err instanceof ApiError && (err.reasonCode === "NOT_PLATFORM_SUPERUSER" || err.status === 403);
}

function failureText(err: unknown, locale: Locale): string {
  if (err instanceof ApiError) {
    if (err.reasonCode === "KG_CONSOLIDATION_DISABLED") return translate(locale, "platformOps.consolidation.disabled");
    return httpFailureText(err.status, locale);
  }
  if (err instanceof TypeError) return translate(locale, "common.error.network");
  return translate(locale, "platformOps.unexpected");
}

type Load<T> = { kind: "loading" } | { kind: "ready"; out: T } | { kind: "forbidden" } | { kind: "failed"; message: unknown };

function useLoad<T>(fetcher: () => Promise<T>): [Load<T>, () => Promise<void>, React.Dispatch<React.SetStateAction<Load<T>>>] {
  const [load, setLoad] = React.useState<Load<T>>({ kind: "loading" });
  const reload = React.useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      setLoad({ kind: "ready", out: await fetcher() });
    } catch (err) {
      setLoad(isForbidden(err) ? { kind: "forbidden" } : { kind: "failed", message: err });
    }
  }, [fetcher]);
  React.useEffect(() => { void reload(); }, [reload]);
  return [load, reload, setLoad];
}

const METRIC_LABEL: Record<ExtractionSloOut["alerts"][number]["metric"], MessageKey> = {
  p95_latency: "platformOps.slo.metric.p95_latency",
  failure_rate: "platformOps.slo.metric.failure_rate",
  stuck_leases: "platformOps.slo.metric.stuck_leases",
};


function Stat({ label, value, hint, breached, testId }: { label: string; value: string; hint?: string; breached?: boolean; testId: string }) {
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 rounded-md border p-3 ${breached ? "border-destructive bg-card" : "border-border bg-card"}`} data-testid={testId}>
      <span className="text-11 text-muted-foreground">{label}</span>
      <span className={`tabular-nums text-16 font-semibold ${breached ? "text-destructive" : "text-card-foreground"}`}>{value}</span>
      {hint !== undefined && <span className="text-10 text-muted-foreground">{hint}</span>}
    </div>
  );
}

export function ExtractionSloPanel() {
  const { t, locale } = useI18n();
  const ms = (v: number | null) => (v === null ? "—" : v >= 1000 ? t("platformOps.seconds", { value: (v / 1000).toFixed(1) }) : t("platformOps.milliseconds", { value: Math.round(v) }));
  const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
  const alertValue = (a: ExtractionSloOut["alerts"][number]) =>
    a.metric === "p95_latency" ? t("platformOps.slo.threshold", { value: ms(a.value), threshold: ms(a.threshold) })
      : a.metric === "failure_rate" ? t("platformOps.slo.threshold", { value: pct(a.value), threshold: pct(a.threshold) })
        : t("platformOps.slo.countThreshold", { value: a.value, threshold: a.threshold });

  const fetcher = React.useCallback(() => getExtractionSlo(), []);
  const [load, reload] = useLoad<ExtractionSloOut>(fetcher);
  const breached = (m: ExtractionSloOut["alerts"][number]["metric"]) => load.kind === "ready" && load.out.alerts.some((a) => a.metric === m);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-panel p-4" data-testid="admin-extraction-slo">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-13 font-semibold">{t("platformOps.slo.title")}</h3>
          <p className="text-11 text-muted-foreground">{t("platformOps.slo.intro")}</p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => void reload()} disabled={load.kind === "loading"} data-testid="admin-extraction-slo-refresh">{t("common.refresh")}</Button>
      </div>
      {load.kind === "loading" && (
        <p className="flex items-center gap-1.5 text-12 text-muted-foreground" data-testid="admin-extraction-slo-loading">
          <Loader2 aria-hidden className="h-3 w-3 animate-spin" />{t("platformOps.loading")}</p>
      )}
      {load.kind === "forbidden" && <p className="text-12 text-muted-foreground" data-testid="admin-extraction-slo-forbidden">{t(FORBIDDEN_TEXT)}</p>}
      {load.kind === "failed" && (
        <p className="text-12 text-destructive" data-testid="admin-extraction-slo-failed">{t("platformOps.slo.failed", { reason: failureText(load.message, locale) })}</p>
      )}
      {load.kind === "ready" && (
        <>
          {load.out.alerts.length > 0 ? (
            <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive bg-card p-3" data-testid="admin-extraction-slo-alert">
              <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div className="flex flex-col gap-0.5">
                <p className="text-12 font-medium text-destructive">{t("platformOps.slo.breached")}</p>
                <ul className="text-11 text-card-foreground">
                  {load.out.alerts.map((a) => (
                    <li key={a.metric} data-testid={`admin-extraction-slo-alert-${a.metric}`}>{t("platformOps.slo.metricValue", { label: t(METRIC_LABEL[a.metric]), value: alertValue(a) })}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <p className="text-11 text-muted-foreground" data-testid="admin-extraction-slo-ok">{t("platformOps.slo.ok")}</p>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Stat testId="admin-extraction-slo-p95" label={t(METRIC_LABEL.p95_latency)} value={ms(load.out.p95LatencyMs)}
              hint={t("platformOps.slo.p95Hint", { threshold: ms(load.out.thresholds.p95LatencyMs), count: load.out.processed })} breached={breached("p95_latency")} />
            <Stat testId="admin-extraction-slo-failure-rate" label={t(METRIC_LABEL.failure_rate)} value={pct(load.out.failureRate)}
              hint={t("platformOps.slo.failureHint", { threshold: pct(load.out.thresholds.failureRate), failed: load.out.failed, jobs: load.out.modelJobs })} breached={breached("failure_rate")} />
            <Stat testId="admin-extraction-slo-stuck" label={t(METRIC_LABEL.stuck_leases)} value={t("platformOps.slo.count", { count: load.out.stuckLeases })}
              hint={t("platformOps.slo.stuckHint", { threshold: load.out.thresholds.stuckLeases, deadLetters: load.out.deadLetters, backlog: load.out.backlog })} breached={breached("stuck_leases")} />
          </div>
          <div className="flex flex-col gap-0.5 rounded-md border border-border bg-card p-3" data-testid="admin-extraction-gate">
            <p className="text-12 font-medium text-card-foreground">{t("platformOps.slo.gate")}</p>
            <p className="text-11 text-muted-foreground" data-testid="admin-extraction-gate-saved">
              {t("platformOps.slo.saved", { saved: load.out.gate.modelCallsSaved, greeting: load.out.gate.skippedByReason.greeting, acknowledgement: load.out.gate.skippedByReason.acknowledgement, question: load.out.gate.skippedByReason.pure_question, notWorth: load.out.gate.skippedByReason.model_not_worth, calls: load.out.gate.modelCalls })}
            </p>
            <p className="text-10 text-muted-foreground">
              {t("platformOps.slo.gateReview", { state: load.out.gate.gateModelEnabled ? t("platformOps.slo.gateOn", { checks: load.out.gate.gateModelChecks, errors: load.out.gate.gateModelErrors }) : t("platformOps.slo.gateRules") })}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

export function ConsolidationSettingPanel() {
  const { t, locale } = useI18n();
  const fetcher = React.useCallback(() => getConsolidationSetting(), []);
  const [load, reload, setLoad] = useLoad(fetcher);
  const [saving, setSaving] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [message, setMessage] = React.useState<
    | { tone: "error"; kind: "save"; enabled: boolean; error: unknown }
    | { tone: "error"; kind: "run"; error: unknown }
    | { tone: "ok"; kind: "completed"; out: ConsolidationPassOut }
    | null>(null);
  const [lastPass, setLastPass] = React.useState<ConsolidationPassOut | null>(null);

  const toggle = async (next: boolean) => {
    if (saving || load.kind !== "ready") return;
    const previous = load.out;
    setSaving(true);
    setMessage(null);
    setLoad({ kind: "ready", out: { enabled: next } });
    try {
      setLoad({ kind: "ready", out: await setConsolidationSetting(next) });
    } catch (err) {
      if (isForbidden(err)) setLoad({ kind: "forbidden" });
      else {
        setLoad({ kind: "ready", out: previous });
        setMessage({ tone: "error", kind: "save", enabled: previous.enabled, error: err });
      }
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    if (running) return;
    setRunning(true);
    setMessage(null);
    try {
      const out = await runConsolidationNow();
      setLastPass(out);
      setMessage({ tone: "ok", kind: "completed", out });
    } catch (err) {
      if (isForbidden(err)) setLoad({ kind: "forbidden" });
      else setMessage({ tone: "error", kind: "run", error: err });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-panel p-4" data-testid="admin-consolidation">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-13 font-semibold">{t("platformOps.consolidation.title")}</h3>
        <p className="text-11 text-muted-foreground">{t("platformOps.consolidation.intro")}</p>
      </div>
      {load.kind === "loading" && (
        <p className="flex items-center gap-1.5 text-12 text-muted-foreground"><Loader2 aria-hidden className="h-3 w-3 animate-spin" />{t("platformOps.loading")}</p>
      )}
      {load.kind === "forbidden" && <p className="text-12 text-muted-foreground" data-testid="admin-consolidation-forbidden">{t(FORBIDDEN_TEXT)}</p>}
      {load.kind === "failed" && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-12 text-destructive" data-testid="admin-consolidation-failed">{t("platformOps.consolidation.failed", { reason: failureText(load.message, locale) })}</p>
          <Button size="sm" variant="secondary" onClick={() => void reload()}>{t("platformOps.retry")}</Button>
        </div>
      )}
      {load.kind === "ready" && (
        <>
          <div className="flex items-start gap-3">
            <Toggle
              checked={load.out.enabled}
              label={t("platformOps.consolidation.toggle")}
              disabled={saving}
              onCheckedChange={(v) => void toggle(v)}
              data-testid="admin-consolidation-toggle"
              className="mt-0.5"
            />
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="text-12 font-medium text-card-foreground">{t("platformOps.consolidation.toggle")}<span className="ml-1.5 text-11 font-normal text-muted-foreground" data-testid="admin-consolidation-state">
                  {load.out.enabled ? t("platformOps.on") : t("platformOps.off")}
                </span>
                {saving && <Loader2 aria-hidden className="ml-1.5 inline h-3 w-3 animate-spin" />}
              </p>
              <p className="text-11 text-muted-foreground">
                {load.out.enabled ? t("platformOps.consolidation.active") : t("platformOps.consolidation.inactive")}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => void runNow()} disabled={running || !load.out.enabled} data-testid="admin-consolidation-run">
              {running ? t("platformOps.consolidation.running") : t("platformOps.consolidation.run")}
            </Button>
            {lastPass !== null && lastPass.failedUsers > 0 && (
              <span className="text-11 text-destructive">{t("platformOps.consolidation.failedUsers", { count: lastPass.failedUsers })}</span>
            )}
          </div>
        </>
      )}
      {message !== null && (
        <p role={message.tone === "error" ? "alert" : "status"} className={`text-11 ${message.tone === "error" ? "text-destructive" : "text-muted-foreground"}`} data-testid="admin-consolidation-message">
          {message.kind === "completed"
            ? t("platformOps.consolidation.completed", { users: message.out.users, claims: message.out.claimMerges, entities: message.out.entityMerges, conflicts: message.out.conflicts })
            : message.kind === "save"
              ? t("platformOps.saveFailed", { value: t(message.enabled ? "platformOps.enabled" : "platformOps.disabled"), reason: failureText(message.error, locale) })
              : t("platformOps.consolidation.runFailed", { reason: failureText(message.error, locale) })}
        </p>
      )}
    </div>
  );
}
