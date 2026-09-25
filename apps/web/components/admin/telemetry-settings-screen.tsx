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
const ERROR_TEXT: Record<TelemetryErrorCode, string> = {
  NOT_PLATFORM_SUPERUSER: "这个页面仅平台运维（平台超管白名单，或被超管指定的平台管理员）可用——你当前的账号不是。",
  VALIDATION_FAILED: "这次改动没通过校验，刷新页面后再试一次",
};

function failureText(err: unknown): string {
  if (err instanceof ApiError) {
    const code = err.reasonCode;
    if (code !== null && code in ERROR_TEXT) return ERROR_TEXT[code as TelemetryErrorCode];
    return httpFailureText(err.status);
  }
  if (err instanceof TypeError) return "连不上服务器，检查一下网络再试";
  return "出了点问题，稍后再试一次";
}

const STATE_TEXT: Record<ReporterState, { title: string; detail: string }> = {
  enabled: { title: "上报已开启", detail: "按下面四项同意，每个周期发一次。" },
  endpoint_unset: { title: "上报未开启：没有配置上报地址", detail: "这个实例现在什么都不发——无论下面的同意项开着还是关着。" },
  kill_switch: { title: "上报未开启：全局总开关已关闭", detail: "这个实例现在什么都不发——无论下面的同意项开着还是关着。" },
};

const OUTCOME_TEXT: Record<Outcome, string> = {
  sent: "已发送（对端已确认收到）",
  failed: "发送失败——已丢弃，不重试",
  invalid: "报告没通过本地校验——根本没发",
};

function formatInterval(seconds: number): string {
  if (seconds % 86_400 === 0) return seconds === 86_400 ? "每天一次" : `每 ${seconds / 86_400} 天一次`;
  if (seconds % 3_600 === 0) return `每 ${seconds / 3_600} 小时一次`;
  return `每 ${seconds} 秒一次`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

export function TelemetrySettingsScreen({ state }: { state: UiState }) {
  return (
    <AdminScreen
      state={state}
      moduleLabel="上报设置"
      title="上报设置"
      liveBacked
      hideOrgIdentity
      intro="这个实例向我们上报哪几类运行信号——只有计数与状态，不含任何对话、文档或成员信息。"
      emptyHint="还没有上报设置"
      denialReason="仅平台运维（平台超管白名单，或被超管指定的平台管理员）可用。"
      successMessage="已保存"
    >
      <div className="flex flex-col gap-4">
        <ConsentPanel />
        <LastReportPanel />
      </div>
    </AdminScreen>
  );
}

type SettingsState =
  | { kind: "loading" }
  | { kind: "ready"; out: TelemetrySettingsOut }
  | { kind: "failed"; message: string };

function ConsentPanel() {
  const [settings, setSettings] = React.useState<SettingsState>({ kind: "loading" });
  const [saving, setSaving] = React.useState<ConsentItem | null>(null);
  const [saveError, setSaveError] = React.useState<{ item: ConsentItem; message: string } | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    getTelemetrySettings()
      .then((out) => { if (!cancelled) setSettings({ kind: "ready", out }); })
      .catch((err) => { if (!cancelled) setSettings({ kind: "failed", message: failureText(err) }); });
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
      setSaveError({ item, message: failureText(err) });
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-panel p-4" data-testid="admin-telemetry-consent">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-13 font-semibold">上报哪几类信号</h3>
        <p className="text-11 text-muted-foreground" data-testid="admin-telemetry-interval-note">
          上报周期：{formatInterval(T.TELEMETRY_REPORT_INTERVAL_SECONDS)}。改动从下一个周期起生效，不会立刻补发或撤回已发出的报告。
        </p>
      </div>
      {settings.kind === "loading" && (
        <p className="flex items-center gap-1.5 text-12 text-muted-foreground" data-testid="admin-telemetry-loading">
          <Loader2 aria-hidden className="h-3 w-3 animate-spin" />加载中……
        </p>
      )}
      {settings.kind === "failed" && (
        <p className="text-12 text-destructive" data-testid="admin-telemetry-failed">{settings.message}</p>
      )}
      {settings.kind === "ready" && (
        <>
          <div
            className={`flex flex-col gap-0.5 rounded-md border p-3 ${settings.out.state === "enabled" ? "border-border bg-card" : "border-warning bg-warning-tint"}`}
            data-testid={`admin-telemetry-state-${settings.out.state}`}
          >
            <p className="text-12 font-medium text-card-foreground">{STATE_TEXT[settings.out.state].title}</p>
            <p className="text-11 text-muted-foreground">{STATE_TEXT[settings.out.state].detail}</p>
          </div>
          <ul className="flex flex-col divide-y divide-border">
            {T.TelemetryConsentItem.options.map((item) => {
              const copy = T.TELEMETRY_CONSENT_COPY[item];
              const checked = settings.out.consent[item];
              return (
                <li key={item} className="flex items-start gap-3 py-2.5" data-testid={`admin-telemetry-consent-${item}`}>
                  <Toggle
                    checked={checked}
                    label={copy.label}
                    disabled={saving !== null}
                    onCheckedChange={(v) => void toggle(item, v)}
                    data-testid={`admin-telemetry-toggle-${item}`}
                    className="mt-0.5"
                  />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <p className="text-12 font-medium text-card-foreground">
                      {copy.label}
                      <span className="ml-1.5 text-11 font-normal text-muted-foreground">{checked ? "已开启" : "已关闭"}</span>
                      {saving === item && <Loader2 aria-hidden className="ml-1.5 inline h-3 w-3 animate-spin" />}
                    </p>
                    <p className="text-11 text-muted-foreground" data-testid={`admin-telemetry-if-off-${item}`}>
                      关掉后：{copy.ifOff}
                    </p>
                    {saveError?.item === item && (
                      <p className="text-11 text-destructive" data-testid={`admin-telemetry-save-failed-${item}`}>
                        没保存成功，仍是{checked ? "开启" : "关闭"}：{saveError.message}
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
  | { kind: "failed"; message: string };

function LastReportPanel() {
  const [state, setState] = React.useState<LastState>({ kind: "loading" });

  React.useEffect(() => {
    let cancelled = false;
    getLastTelemetryReport()
      .then((out) => { if (!cancelled) setState({ kind: "ready", out }); })
      .catch((err) => { if (!cancelled) setState({ kind: "failed", message: failureText(err) }); });
    return () => { cancelled = true; };
  }, []);

  const last = state.kind === "ready" ? state.out.last : null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-panel p-4" data-testid="admin-telemetry-last-report">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-13 font-semibold">看见传了什么</h3>
        <p className="text-11 text-muted-foreground">最近一次上报尝试的原样内容——发出去的就是下面这段，一个字不多。</p>
      </div>
      {state.kind === "loading" && (
        <p className="flex items-center gap-1.5 text-12 text-muted-foreground" data-testid="admin-telemetry-last-loading">
          <Loader2 aria-hidden className="h-3 w-3 animate-spin" />加载中……
        </p>
      )}
      {state.kind === "failed" && (
        <p className="text-12 text-destructive" data-testid="admin-telemetry-last-failed">{state.message}</p>
      )}
      {state.kind === "ready" && last === null && (
        <p className="text-12 text-muted-foreground" data-testid="admin-telemetry-last-none">还没有上报过。</p>
      )}
      {last !== null && (
        <div className="flex flex-col gap-1.5">
          <p className="text-12 text-card-foreground" data-testid={`admin-telemetry-last-outcome-${last.outcome}`}>
            {formatTime(last.attemptedAt)} · <span className={last.outcome === "sent" ? "text-success" : "text-destructive"}>{OUTCOME_TEXT[last.outcome]}</span>
          </p>
          {last.omittedForLackOfData.length > 0 && (
            <p className="text-11 text-muted-foreground" data-testid="admin-telemetry-last-omitted">
              已同意但本实例还没有真实数据、因此整节没发：{last.omittedForLackOfData.map((i) => T.TELEMETRY_CONSENT_COPY[i].label).join("、")}
            </p>
          )}
          {last.report === null ? (
            <p className="text-12 text-muted-foreground" data-testid="admin-telemetry-last-no-body">这次什么都没发出去。</p>
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
