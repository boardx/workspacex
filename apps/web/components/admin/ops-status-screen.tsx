"use client";
import * as React from "react";
import { useI18n } from "@/lib/i18n/provider";
import { ConsumptionSettingsPanel } from "./consumption-settings-panel";
import { Loader2 } from "lucide-react";
import { AdminScreen } from "./admin-screen";
import { PlatformExtractionSettingPanel } from "./platform-extraction-setting-panel";
import { ConsolidationSettingPanel, ExtractionSloPanel } from "./memory-ops-panels";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { sendTestEmail, type SendTestEmailOut } from "@/lib/live-system-errors";
import { inspectPasswordResetThrottle, type InspectPasswordResetThrottleOut } from "@/lib/auth";
import { getServiceUptimeStatus, type GetServiceUptimeStatusOut } from "@/lib/system-uptime";
import { translate } from "@/lib/i18n/messages";
import type { Locale } from "@/lib/i18n/locale";
import type { UiState } from "@/lib/ui-state";

/**
 * OPS-1 —— 平台后台「运营状态」屏。
 *
 * 2026-09-03 人类反馈：「测试邮件的功能不要放在系统异常下面，放到平台后台的一个
 * 新的菜单叫运营状态」——原来挂在「反馈与迭代 → 系统异常」tab 顶部的 `TestMailPanel`
 * 搬到这里独立成一个入口。它不是"反馈"（没有提交人、没有分诊动作），是运维自查
 * 这个部署本身是否健康的工具，混在反馈收件箱里语义不对。
 *
 * 2026-09-04（issue #2632）新增「忘记密码限流状态」——一次真实支持事故的直接产物：
 * 两个账号先后反馈"忘记密码收不到邮件"，`requestPasswordReset` 对已注册但正在冷却/
 * 超过每日上限的邮箱会**无声跳过发信**（这是 I-1 防枚举要求的行为，不是 bug），但
 * 此前没有任何入口能确认"是不是卡在这里"——包括这次会话在内的每一个人都只能猜，
 * 直到有人手工查了数据库。这块面板把 `requestPasswordReset` 决定要不要发信之前看的
 * 那几个数字（是否注册、过去 24 小时发起次数、是否在冷却）直接摆出来，不用再猜。
 *
 * 以后其他运营自查工具（部署健康、依赖探活……）按同一模式加进来，不需要再挪一次菜单。
 *
 * 2026-09-04（issue #2645）新增「服务可用性」面板——反馈来源：后台「反馈与迭代」，
 * 反馈 ID `153f6e8f-09a6-4596-95c5-ec5a65638644`。后台定时 worker 每 60 秒 ping 一次
 * 探活目标（默认 Dev app，见 `apps/api/.../service-uptime-config.ts` 的
 * `DEV_APP_UPTIME_URL`），这块面板把最近一批探活结果画成红绿 bar，并给出精确到
 * 小数点后两位的可用性百分比——不是四舍五入到整数，需求原文明确要"确切的百分比"。
 *
 * 2026-09-26（issue #4247）新增「记忆抽取（整个部署）」面板——PR #4200 把部署级抽取开关
 * 搬进库后的平台管理入口，见 `platform-extraction-setting-panel.tsx` 头注。
 *
 * 2026-09-27（issue #4365，S8）紧挨着它加「记忆抽取 SLO」（p95 延迟 / 失败率 / 卡住的租约，超阈值出横幅）与
 * 「记忆整合（整个部署）」开关（默认关），见 `memory-ops-panels.tsx` 头注。
 */
export function OpsStatusScreen({ state }: { state: UiState }) {
  const { t } = useI18n();
  return (
    <AdminScreen
      state={state}
      moduleLabel={t("platformOps.title")}
      title={t("platformOps.title")}
      liveBacked
      hideOrgIdentity
      intro={t("platformOps.intro")}
      emptyHint={t("platformOps.empty")}
      denialReason={t("platformOps.denial")}
      successMessage={t("platformOps.success")}
    >
      <div className="flex flex-col gap-4">
        <ConsumptionSettingsPanel />
        <ServiceUptimePanel />
        <TestMailPanel />
        <PasswordResetThrottlePanel />
        <PlatformExtractionSettingPanel />
        <ExtractionSloPanel />
        <ConsolidationSettingPanel />
      </div>
    </AdminScreen>
  );
}

// Keep connection failures semantic so a locale change never needs to replay an operation.
function describeFailure(err: unknown): string | { kind: "network" } {
  if (err instanceof ApiError) return err.reasonCode ?? `http_${err.status}`;
  if (err instanceof TypeError) return { kind: "network" };
  return String(err);
}

function failureReason(reason: ReturnType<typeof describeFailure>, locale: Locale): string {
  return typeof reason === "string" ? reason : translate(locale, "platformOps.network");
}

/** 设计稿的时间格式：`2026/9/2 11:20`。 */
function formatTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

type TestMailState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; out: SendTestEmailOut }
  | { kind: "failed"; reasonCode: ReturnType<typeof describeFailure>; category: string | null };

/**
 * 「测试邮件」——人类 2026-09-02 要求：后台要能验证邮件发不发得出。走的是生产同一条
 * 事务邮件通路（`POST /system/mail/test`，见契约头注），不是另一套测试通路；失败
 * 如实报契约码 + 适配器归好类的 `category`，成功报收件人与供应商回执 id。
 *
 * ⚠ 与旧位置（「反馈与迭代 → 系统异常」tab）不同，这里没有先读一次系统异常列表来
 *   判断"当前账号是不是平台运维"——`sendTestEmail` 本身就是同一道超管门，非运维账号
 *   点发送会收到 `NOT_PLATFORM_SUPERUSER`，下面单独渲染成一句说明，不是让它落进
 *   通用失败文案。
 */
function TestMailPanel() {
  const { t, locale } = useI18n();
  const [to, setTo] = React.useState("");
  const [state, setState] = React.useState<TestMailState>({ kind: "idle" });

  const send = async () => {
    setState({ kind: "sending" });
    try {
      const out = await sendTestEmail(to);
      setState({ kind: "sent", out });
    } catch (err) {
      const body = err instanceof ApiError ? (err.raw as { category?: unknown } | null | undefined) : null;
      setState({
        kind: "failed",
        reasonCode: describeFailure(err),
        category: typeof body?.category === "string" ? body.category : null,
      });
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-panel p-4" data-testid="admin-ops-status-test-mail">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-13 font-semibold">{t("platformOps.mail.title")}</h3>
        <p className="text-11 text-muted-foreground">{t("platformOps.mail.intro")}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={to}
          onChange={(e) => { setTo(e.target.value); if (state.kind !== "sending") setState({ kind: "idle" }); }}
          placeholder={t("platformOps.mail.placeholder")}
          aria-label={t("platformOps.mail.recipient")}
          type="email"
          data-testid="admin-ops-status-test-mail-to"
          className="h-8 w-80 max-w-full rounded-md border border-border-subtle bg-card px-2.5 text-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button size="sm" variant="primary" disabled={state.kind === "sending"} onClick={() => void send()} data-testid="admin-ops-status-test-mail-send">
          {state.kind === "sending" && <Loader2 aria-hidden className="h-3 w-3 animate-spin" />}
          {t("platformOps.mail.send")}
        </Button>
      </div>
      {state.kind === "sent" && (
        <p className="text-12 text-card-foreground" data-testid="admin-ops-status-test-mail-sent">
          {t("platformOps.mail.sentTo")}<span className="font-medium">{state.out.sentTo}</span>{t("platformOps.mail.time", { time: formatTime(state.out.sentAt) })}
          {state.out.providerMessageId !== null && (
            <span className="text-muted-foreground">{t("platformOps.mail.receipt")}<code className="font-mono text-11">{state.out.providerMessageId}</code></span>
          )}
          {t("platformOps.mail.confirm", { subject: state.out.subject })}
        </p>
      )}
      {state.kind === "failed" && (
        <p className="text-12 text-destructive" data-testid="admin-ops-status-test-mail-failed">
          {state.reasonCode === "NOT_PLATFORM_SUPERUSER"
            ? t("platformOps.functionDenied")
            : state.reasonCode === "MAIL_NOT_CONFIGURED"
              ? t("platformOps.mail.configMissing", { detail: state.category === "configuration_invalid" ? t("platformOps.mail.configInvalid") : "" })
              : state.reasonCode === "NO_RECIPIENT"
                ? t("platformOps.mail.noRecipient")
                : t("platformOps.mail.failed", { reason: failureReason(state.reasonCode, locale), category: state.category !== null ? ` · ${state.category}` : "" })}
        </p>
      )}
    </div>
  );
}

type ThrottleState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "ready"; email: string; out: InspectPasswordResetThrottleOut }
  | { kind: "failed"; reasonCode: ReturnType<typeof describeFailure> };

/**
 * 「忘记密码限流状态」——见文件头 2026-09-04（issue #2632）一节。只读诊断，
 * 不提供任何"清除限流"的操作：那是一个需要单独裁决的能力（清冷却还是清每日
 * 上限？要不要审计记录？），本次事故只要求"能看见"，见用例头注。
 */
function PasswordResetThrottlePanel() {
  const { t, locale } = useI18n();
  const [email, setEmail] = React.useState("");
  const [state, setState] = React.useState<ThrottleState>({ kind: "idle" });

  const check = async () => {
    const target = email.trim();
    if (target === "") return;
    setState({ kind: "checking" });
    try {
      const out = await inspectPasswordResetThrottle(target);
      setState({ kind: "ready", email: target, out });
    } catch (err) {
      setState({ kind: "failed", reasonCode: describeFailure(err) });
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-panel p-4" data-testid="admin-ops-status-reset-throttle">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-13 font-semibold">{t("platformOps.throttle.title")}</h3>
        <p className="text-11 text-muted-foreground">{t("platformOps.throttle.intro")}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={email}
          onChange={(e) => { setEmail(e.target.value); if (state.kind !== "checking") setState({ kind: "idle" }); }}
          placeholder={t("platformOps.throttle.placeholder")}
          aria-label={t("platformOps.throttle.email")}
          type="email"
          data-testid="admin-ops-status-reset-throttle-email"
          className="h-8 w-80 max-w-full rounded-md border border-border-subtle bg-card px-2.5 text-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button size="sm" variant="primary" disabled={state.kind === "checking" || email.trim() === ""} onClick={() => void check()} data-testid="admin-ops-status-reset-throttle-check">
          {state.kind === "checking" && <Loader2 aria-hidden className="h-3 w-3 animate-spin" />}
          {t("platformOps.throttle.check")}
        </Button>
      </div>
      {state.kind === "ready" && (
        <div className="flex flex-col gap-1 text-12 text-card-foreground" data-testid="admin-ops-status-reset-throttle-result">
          {!state.out.registered ? (
            <p data-testid="admin-ops-status-reset-throttle-unregistered">
              <span className="font-medium">{state.email}</span>{t("platformOps.throttle.unregisteredBeforeTag")}<code className="font-mono text-11">{t("platformOps.throttle.tag")}</code>{t("platformOps.throttle.unregisteredAfterTag")}
            </p>
          ) : (
            <>
              <p>
                {t("platformOps.throttle.issued")}<span className="font-medium tabular-nums">{state.out.issuedInLast24h}</span>
                {" / "}
                <span className="tabular-nums">{state.out.dailyCap}</span>{t("platformOps.throttle.times")}
                {state.out.overDailyCap && <span className="ml-1 font-medium text-destructive">{t("platformOps.throttle.cap")}</span>}
              </p>
              <p>
                {t("platformOps.throttle.last", { time: state.out.lastIssuedAt === null ? t("platformOps.throttle.never") : formatTime(state.out.lastIssuedAt) })}
                {state.out.cooling && state.out.cooldownEndsAt !== null && (
                  <span className="ml-1 font-medium text-destructive">{t("platformOps.throttle.cooldown", { seconds: state.out.cooldownSeconds, time: formatTime(state.out.cooldownEndsAt) })}</span>
                )}
              </p>
              {!state.out.overDailyCap && !state.out.cooling && (
                <p className="text-muted-foreground">{t("platformOps.throttle.clear")}</p>
              )}
            </>
          )}
        </div>
      )}
      {state.kind === "failed" && (
        <p className="text-12 text-destructive" data-testid="admin-ops-status-reset-throttle-failed">
          {state.reasonCode === "NOT_PLATFORM_SUPERUSER"
            ? t("platformOps.functionDenied")
            : t("platformOps.lookupFailed", { reason: failureReason(state.reasonCode, locale) })}
        </p>
      )}
    </div>
  );
}

type UptimeState =
  | { kind: "loading" }
  | { kind: "ready"; out: GetServiceUptimeStatusOut }
  | { kind: "failed"; reasonCode: ReturnType<typeof describeFailure> };

function formatBucketRange(from: string, to: string): string {
  const f = new Date(from); const t = new Date(to);
  const hm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${f.toLocaleDateString()} ${hm(f)}–${hm(t)}`;
}

/**
 * 「服务可用性」——见文件头 2026-09-04（issue #2645）一节。2026-09-14 起看的是**最近
 * 24 小时**：bar 按 15 分钟一格等分成 96 桶（绿=这段全部可用，红=这段至少断过一次，
 * 灰=这段没有探活记录），从左（旧）到右（新）；下面一行给出窗口内精确到小数点后两位
 * 的可用性百分比。加载一次即可——这是运维自查面板，不需要轮询刷新，人要看最新状态
 * 刷新一下整个屏即可，同 `PasswordResetThrottlePanel`/`TestMailPanel` 的既有取舍。
 */
function ServiceUptimePanel() {
  const { t, locale } = useI18n();
  const [state, setState] = React.useState<UptimeState>({ kind: "loading" });

  React.useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    getServiceUptimeStatus()
      .then((out) => { if (!cancelled) setState({ kind: "ready", out }); })
      .catch((err) => { if (!cancelled) setState({ kind: "failed", reasonCode: describeFailure(err) }); });
    return () => { cancelled = true; };
  }, []);

  const downBuckets = state.kind === "ready" && Array.isArray(state.out.buckets) ? state.out.buckets.filter((b) => b.status === "down").length : 0;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-panel p-4" data-testid="admin-ops-status-uptime">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-13 font-semibold">{t("platformOps.uptime.title")}</h3>
        <p className="text-11 text-muted-foreground">
          {t("platformOps.uptime.intro", { hours: state.kind === "ready" ? state.out.windowHours : 24, minutes: state.kind === "ready" ? state.out.bucketMinutes : 15 })}
        </p>
        {state.kind === "ready" && state.out.target !== null && (
          <p className="text-11 text-muted-foreground" data-testid="admin-ops-status-uptime-target">
            {t("platformOps.uptime.target")}<code className="font-mono text-11">{state.out.target}</code>
          </p>
        )}
      </div>
      {state.kind === "loading" && (
        <p className="flex items-center gap-1.5 text-12 text-muted-foreground" data-testid="admin-ops-status-uptime-loading">
          <Loader2 aria-hidden className="h-3 w-3 animate-spin" />{t("platformOps.loading")}</p>
      )}
      {state.kind === "failed" && (
        <p className="text-12 text-destructive" data-testid="admin-ops-status-uptime-failed">
          {state.reasonCode === "NOT_PLATFORM_SUPERUSER"
            ? t("platformOps.functionDenied")
            : t("platformOps.lookupFailed", { reason: failureReason(state.reasonCode, locale) })}
        </p>
      )}
      {state.kind === "ready" && !state.out.configured && (
        <p className="text-12 text-muted-foreground" data-testid="admin-ops-status-uptime-unconfigured">
          {t("platformOps.uptime.unconfiguredBeforeTarget")}<code className="font-mono text-11">DEV_APP_UPTIME_URL</code>{t("platformOps.uptime.unconfiguredBetweenTargets")}<code className="font-mono text-11">APP_PUBLIC_URL</code>{t("platformOps.uptime.unconfiguredAfterTargets")}
        </p>
      )}
      {state.kind === "ready" && state.out.configured && state.out.totalChecks === 0 && (
        <p className="text-12 text-muted-foreground" data-testid="admin-ops-status-uptime-no-data">
          {t("platformOps.uptime.noData", { hours: state.out.windowHours })}
        </p>
      )}
      {state.kind === "ready" && state.out.configured && state.out.totalChecks > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex h-4 w-full gap-px overflow-hidden rounded-sm" data-testid="admin-ops-status-uptime-bar">
            {state.out.buckets.map((b) => (
              <div
                key={b.from}
                title={`${formatBucketRange(b.from, b.to)} · ${b.status === "no_data" ? t("platformOps.uptime.noChecks") : b.status === "up" ? t("platformOps.uptime.up", { checks: b.checks }) : t("platformOps.uptime.down", { down: b.downChecks, checks: b.checks })}`}
                data-testid={`admin-ops-status-uptime-segment-${b.status === "no_data" ? "empty" : b.status}`}
                className={`h-full flex-1 ${b.status === "up" ? "bg-success" : b.status === "down" ? "bg-destructive" : "bg-muted"}`}
              />
            ))}
          </div>
          <p className="text-12 text-card-foreground" data-testid="admin-ops-status-uptime-percent">
            {t("platformOps.uptime.availability")}<span className="font-medium tabular-nums">{state.out.availabilityPercent?.toFixed(2)}%</span>
            <span className="ml-1 text-muted-foreground">
              {t("platformOps.uptime.summary", { hours: state.out.windowHours, checks: state.out.totalChecks, up: state.out.upChecks, interruptions: downBuckets > 0 ? t("platformOps.uptime.interruptions", { count: downBuckets }) : "" })}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
