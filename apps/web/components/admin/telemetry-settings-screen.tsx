"use client";
import * as React from "react";
import { Loader2 } from "lucide-react";
import { instanceTelemetry } from "@repo/contracts";
import { AdminScreen } from "./admin-screen";
import { Toggle } from "@/components/ui/toggle";
import { ApiError } from "@/lib/api-client";
import { httpFailureText } from "@/lib/http-failure-text";
import {
  getLastTelemetryReport, getTelemetrySettings, updateTelemetryConsent,
  type LastTelemetryReportOut, type TelemetrySettingsOut,
} from "@/lib/instance-telemetry";
import type { UiState } from "@/lib/ui-state";
import { useI18n } from "@/lib/i18n/provider";
import type { MessageKey } from "@/lib/i18n/messages";
import type { Locale } from "@/lib/i18n/locale";

/**
 * D9 —— 实例管理员的「上报设置」页（`docs/proposals/PROP-OPS-INSTANCE-TELEMETRY-001.md`「UI」一节）。
 *
 * - 四个**独立**开关，没有「全开/全关」；每个开关旁原样展示契约 `TELEMETRY_CONSENT_COPY`
 *   的 `label` 与 `ifOff`——文案只在契约里一份，这里不抄。
 * - 上报总状态（`enabled` / `endpoint_unset` / `kill_switch`）如实说：没配地址或总开关关着时，
 *   同意项开着也不会发。
 * - 「看见传了什么」：最近一次上报尝试的原样报告体（格式化 JSON）、结果、以及因为没数据而缺席的分节。
 * - 同意变更在下一个上报周期生效，周期取契约 `TELEMETRY_REPORT_INTERVAL_SECONDS`。
 */
const T = instanceTelemetry;
type ConsentItem = instanceTelemetry.TelemetryConsentItemValue;
type ReporterState = instanceTelemetry.TelemetryReporterStateValue;
type Outcome = instanceTelemetry.TelemetryAttemptOutcomeValue;
type TelemetryErrorCode =
  | (typeof T.operations.getTelemetrySettings.err)[number]
  | (typeof T.operations.updateTelemetryConsent.err)[number]
  | (typeof T.operations.getLastTelemetryReport.err)[number];

/** 契约错误码 → 人话（闭集，契约新增码漏配编译不过）。 */
const ERROR_TEXT = {
  NOT_PLATFORM_SUPERUSER: "telemetry.permission",
  VALIDATION_FAILED: "telemetry.validation",
} as const satisfies Record<TelemetryErrorCode, MessageKey>;
type Failure = { kind: "message"; key: MessageKey } | { kind: "http"; status: number };
function failureCause(err: unknown): Failure {
  if (err instanceof ApiError) {
    const code = err.reasonCode;
    if (code !== null && Object.hasOwn(ERROR_TEXT, code)) return { kind: "message", key: ERROR_TEXT[code as TelemetryErrorCode] };
    return { kind: "http", status: err.status };
  }
  return { kind: "message", key: err instanceof TypeError ? "telemetry.network" : "telemetry.unknown" };
}
function failureText(cause: Failure, { t, locale }: ReturnType<typeof useI18n>): string {
  return cause.kind === "http" ? httpFailureText(cause.status, locale) : t(cause.key);
}
const CONSENT_TEXT = {
  health: { label: "telemetry.health.label", ifOff: "telemetry.health.ifOff" },
  usage: { label: "telemetry.usage.label", ifOff: "telemetry.usage.ifOff" },
  diagnostics: { label: "telemetry.diagnostics.label", ifOff: "telemetry.diagnostics.ifOff" },
  benchmark: { label: "telemetry.benchmark.label", ifOff: "telemetry.benchmark.ifOff" },
} as const satisfies Record<ConsentItem, { label: MessageKey; ifOff: MessageKey }>;
const STATE_TEXT = {
  enabled: { title: "telemetry.enabled", detail: "telemetry.enabledDetail" },
  endpoint_unset: { title: "telemetry.endpointUnset", detail: "telemetry.disabledDetail" },
  kill_switch: { title: "telemetry.killSwitch", detail: "telemetry.disabledDetail" },
} as const satisfies Record<ReporterState, { title: MessageKey; detail: MessageKey }>;
const OUTCOME_TEXT = {
  sent: "telemetry.sent", failed: "telemetry.failed", invalid: "telemetry.invalid",
} as const satisfies Record<Outcome, MessageKey>;

function formatInterval(seconds: number, t: ReturnType<typeof useI18n>["t"]): string {
  if (seconds % 86_400 === 0) return seconds === 86_400 ? t("telemetry.daily") : t("telemetry.days", { count: seconds / 86_400 });
  if (seconds % 3_600 === 0) return t("telemetry.hours", { count: seconds / 3_600 });
  return t("telemetry.seconds", { count: seconds });
}

function formatTime(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleString(locale === "en" ? "en-US" : "zh-CN", {
    year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

export function TelemetrySettingsScreen({ state }: { state: UiState }) {
  const { t } = useI18n();
  return (
    <AdminScreen
      state={state}
      moduleLabel={t("adminNavigation.item.telemetry")}
      title={t("adminNavigation.item.telemetry")}
      liveBacked
      hideOrgIdentity
      intro={t("telemetry.intro")}
      emptyHint={t("telemetry.empty")}
      denialReason={t("telemetry.denial")}
      successMessage={t("state.saved")}
    >
      <div className="flex min-w-0 flex-col gap-4">
        <ConsentPanel />
        <LastReportPanel />
      </div>
    </AdminScreen>
  );
}

type SettingsState =
  | { kind: "loading" }
  | { kind: "ready"; out: TelemetrySettingsOut }
  | { kind: "failed"; cause: Failure };

function ConsentPanel() {
  const i18n = useI18n();
  const { t } = i18n;
  const [settings, setSettings] = React.useState<SettingsState>({ kind: "loading" });
  const [saving, setSaving] = React.useState<ConsentItem | null>(null);
  const [saveError, setSaveError] = React.useState<{ item: ConsentItem; cause: Failure } | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    getTelemetrySettings()
      .then((out) => { if (!cancelled) setSettings({ kind: "ready", out }); })
      .catch((err) => { if (!cancelled) setSettings({ kind: "failed", cause: failureCause(err) }); });
    return () => { cancelled = true; };
  }, []);

  const toggle = async (item: ConsentItem, next: boolean) => {
    setSaving(item);
    setSaveError(null);
    try {
      // 只传要改的那一项——四项互相独立。成功后以服务端返回为准，不做乐观更新。
      const out = await updateTelemetryConsent({ [item]: next });
      setSettings({ kind: "ready", out });
    } catch (err) {
      setSaveError({ item, cause: failureCause(err) });
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-3 break-words rounded-lg border border-border bg-panel p-4" data-testid="admin-telemetry-consent">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-13 font-semibold">{t("telemetry.signals")}</h3>
        <p className="text-11 text-muted-foreground" data-testid="admin-telemetry-interval-note">
          {t("telemetry.interval", { interval: formatInterval(T.TELEMETRY_REPORT_INTERVAL_SECONDS, t) })}
        </p>
      </div>
      {settings.kind === "loading" && (
        <p className="flex items-center gap-1.5 text-12 text-muted-foreground" data-testid="admin-telemetry-loading">
          <Loader2 aria-hidden className="h-3 w-3 animate-spin" />{t("ui.loading")}
        </p>
      )}
      {settings.kind === "failed" && (
        <p className="text-12 text-destructive" data-testid="admin-telemetry-failed">{failureText(settings.cause, i18n)}</p>
      )}
      {settings.kind === "ready" && (
        <>
          <div
            className={`flex flex-col gap-0.5 rounded-md border p-3 ${settings.out.state === "enabled" ? "border-border bg-card" : "border-warning bg-warning-tint"}`}
            data-testid={`admin-telemetry-state-${settings.out.state}`}
          >
            <p className="text-12 font-medium text-card-foreground">{t(STATE_TEXT[settings.out.state].title)}</p>
            <p className="text-11 text-muted-foreground">{t(STATE_TEXT[settings.out.state].detail)}</p>
          </div>
          <ul className="flex flex-col divide-y divide-border">
            {T.TelemetryConsentItem.options.map((item) => {
              const copy = CONSENT_TEXT[item];
              const checked = settings.out.consent[item];
              return (
                <li key={item} className="flex items-start gap-3 py-2.5" data-testid={`admin-telemetry-consent-${item}`}>
                  <Toggle
                    checked={checked}
                    label={t(copy.label)}
                    disabled={saving !== null}
                    onCheckedChange={(v) => void toggle(item, v)}
                    data-testid={`admin-telemetry-toggle-${item}`}
                    className="mt-0.5"
                  />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <p className="text-12 font-medium text-card-foreground">
                      {t(copy.label)}
                      <span className="ml-1.5 text-11 font-normal text-muted-foreground">{t(checked ? "telemetry.on" : "telemetry.off")}</span>
                      {saving === item && <span className="ml-1.5 text-11 font-normal text-muted-foreground" role="status"><Loader2 aria-hidden className="mr-1 inline h-3 w-3 animate-spin" />{t("telemetry.saving")}</span>}
                    </p>
                    <p className="text-11 text-muted-foreground" data-testid={`admin-telemetry-if-off-${item}`}>
                      {t("telemetry.ifOff", { consequence: t(copy.ifOff) })}
                    </p>
                    {saveError?.item === item && (
                      <p className="text-11 text-destructive" data-testid={`admin-telemetry-save-failed-${item}`}>
                        {t("telemetry.saveFailed", { value: t(checked ? "telemetry.on" : "telemetry.off"), reason: failureText(saveError.cause, i18n) })}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

type LastState =
  | { kind: "loading" }
  | { kind: "ready"; out: LastTelemetryReportOut }
  | { kind: "failed"; cause: Failure };

function LastReportPanel() {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const [state, setState] = React.useState<LastState>({ kind: "loading" });

  React.useEffect(() => {
    let cancelled = false;
    getLastTelemetryReport()
      .then((out) => { if (!cancelled) setState({ kind: "ready", out }); })
      .catch((err) => { if (!cancelled) setState({ kind: "failed", cause: failureCause(err) }); });
    return () => { cancelled = true; };
  }, []);

  const last = state.kind === "ready" ? state.out.last : null;

  return (
    <div className="flex min-w-0 flex-col gap-2 break-words rounded-lg border border-border bg-panel p-4" data-testid="admin-telemetry-last-report">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-13 font-semibold">{t("telemetry.lastHeading")}</h3>
        <p className="text-11 text-muted-foreground">{t("telemetry.lastIntro")}</p>
      </div>
      {state.kind === "loading" && (
        <p className="flex items-center gap-1.5 text-12 text-muted-foreground" data-testid="admin-telemetry-last-loading">
          <Loader2 aria-hidden className="h-3 w-3 animate-spin" />{t("ui.loading")}
        </p>
      )}
      {state.kind === "failed" && (
        <p className="text-12 text-destructive" data-testid="admin-telemetry-last-failed">{failureText(state.cause, i18n)}</p>
      )}
      {state.kind === "ready" && last === null && (
        <p className="text-12 text-muted-foreground" data-testid="admin-telemetry-last-none">{t("telemetry.lastNone")}</p>
      )}
      {last !== null && (
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="text-12 text-card-foreground" data-testid={`admin-telemetry-last-outcome-${last.outcome}`}>
            {formatTime(last.attemptedAt, locale)} · <span className={last.outcome === "sent" ? "text-success" : "text-destructive"}>{t(OUTCOME_TEXT[last.outcome])}</span>
          </p>
          {last.omittedForLackOfData.length > 0 && (
            <p className="text-11 text-muted-foreground" data-testid="admin-telemetry-last-omitted">
              {t("telemetry.omitted", { items: last.omittedForLackOfData.map((i) => t(CONSENT_TEXT[i].label)).join(locale === "en" ? ", " : "、") })}
            </p>
          )}
          {last.report === null ? (
            <p className="text-12 text-muted-foreground" data-testid="admin-telemetry-last-no-body">{t("telemetry.noBody")}</p>
          ) : (
            <pre className="max-h-96 overflow-auto rounded-md border border-border bg-card p-3 font-mono text-11 text-card-foreground" data-testid="admin-telemetry-last-body">
              {JSON.stringify(last.report, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
