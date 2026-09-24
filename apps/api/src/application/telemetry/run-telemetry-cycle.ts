/**
 * D9 —— 一个上报周期：读同意 → 只收集已同意的分节 → 组装 → 契约校验 → 存为「最近一次」→ 发 → 记结果。
 *
 * 用例（PROP-OPS-INSTANCE-TELEMETRY-001）逐条落点：
 * - 每周期发一次：调度在 worker，本函数只做一次。
 * - 失败即丢弃，不重试：`transport.post` 只调一次，失败只记 `failed`。
 * - 本地保留最近一次报告供查看：发之前就 `recordAttempt`，发的就是存的那份。
 * - 同意变更下一周期生效：每次周期开头重新读同意，本周期内不再读。
 * - 上报失败绝不影响实例任何功能：本函数**永不抛**（最外层 try/catch 只记日志）。
 *
 * 分节缺口（如实记录而不造数；见契约 `omittedForLackOfData`）：
 * - `usage`：E3 起 `firstValueFunnel` 有真实来源（`facts.firstValueFacts` → 契约
 *   `aggregateFirstValueFunnel`）；但契约把 runCount / tokenCount / seatCount / organizationCount /
 *   skillPackRuns 定为同节必填，`facts.usageBase` 给不出（skillPackRuns 的能力编号映射尚不存在）时
 *   整节仍缺席——不为了带上漏斗而给其余字段造数。
 * - `diagnostics`：`error_logs` 没有机器可读错误码列（只有自由文本 `msg`），造不出 `errorCode` ⇒ 暂缺席。
 * - `benchmark`：E3 起 `firstValueMedianMinutes` 由契约 `firstValueMedianMinutes()` 算出；同节必填的
 *   `runsPerSeatPerWeek` 来自 `kernel_benchmark_counts_for_report()`（周期内 agent 运行数 ÷ 席位数 ÷ 周数）；
 *   无席位（无分母）、或无组织到达价值时刻时整节缺席。
 * - `health`：来自 `TelemetryFactsSource.health`；周期内一条探活记录都没有时也缺席。
 */
import { createHash } from "node:crypto";
import { firstValueEvents as FV, instanceTelemetry as T } from "@repo/contracts";
import type { DeploymentEditionValue } from "@repo/contracts/deployment";
import type { LoggerPort } from "../ports/logger.port";
import type { TelemetryFactsSource, TelemetryStateRepository, TelemetryTransport } from "./telemetry-ports";

export interface TelemetryCycleDeps {
  readonly state: TelemetryStateRepository;
  readonly facts: TelemetryFactsSource;
  readonly transport: TelemetryTransport;
  readonly logger: LoggerPort;
  readonly now: () => Date;
}

export interface TelemetryCycleConfig {
  /** `null` ⇒ 未配置上报地址，整个上报关闭。 */
  readonly endpoint: string | null;
  readonly killSwitch: boolean;
  readonly timeoutMs: number;
  readonly edition: DeploymentEditionValue;
  readonly productVersion: string;
}

export type TelemetryCycleResult =
  | { readonly kind: "skipped"; readonly reason: "endpoint_unset" | "kill_switch" }
  | { readonly kind: T.TelemetryAttemptOutcomeValue };

/** 实例标识 = 安装密钥的 SHA-256（64 位小写十六进制）。不含主机名、组织名或任何可读信息。 */
export function instanceIdFromSecret(installSecret: string): string {
  return createHash("sha256").update(installSecret, "utf8").digest("hex");
}

export function reporterState(config: Pick<TelemetryCycleConfig, "endpoint" | "killSwitch">): T.TelemetryReporterStateValue {
  if (config.killSwitch) return "kill_switch";
  if (config.endpoint === null) return "endpoint_unset";
  return "enabled";
}

export async function runTelemetryCycle(deps: TelemetryCycleDeps, config: TelemetryCycleConfig): Promise<TelemetryCycleResult> {
  const state = reporterState(config);
  if (state !== "enabled") return { kind: "skipped", reason: state };
  const endpoint = config.endpoint as string;
  try {
    const row = await deps.state.ensure();
    const consent = { ...row.consent };
    const periodEnd = deps.now();
    const periodStart = new Date(periodEnd.getTime() - T.TELEMETRY_REPORT_INTERVAL_SECONDS * 1000);

    const omitted: T.TelemetryConsentItemValue[] = [];
    let health: T.InstanceTelemetryReportValue["health"];
    if (consent.health) {
      const h = await deps.facts.health(periodStart, periodEnd);
      if (h === null) omitted.push("health");
      else health = h.facts;
    }
    let usage: T.InstanceTelemetryReportValue["usage"];
    let benchmark: T.InstanceTelemetryReportValue["benchmark"];
    if (consent.usage || consent.benchmark) {
      // 事实已在 SQL 层排除 personal-local；契约 helper 再排除一次（纵深），并只产出计数。
      const fv = (await deps.facts.firstValueFacts()).facts;
      const end = periodEnd.toISOString();
      if (consent.usage) {
        const base = await deps.facts.usageBase(periodStart, periodEnd);
        if (base === null) omitted.push("usage");
        else usage = { ...base, ...(fv.length > 0 ? { firstValueFunnel: FV.aggregateFirstValueFunnel(fv, end) } : {}) };
      }
      if (consent.benchmark) {
        const median = FV.firstValueMedianMinutes(fv, end);
        const rps = median === undefined ? null : await deps.facts.runsPerSeatPerWeek(periodStart, periodEnd);
        if (median === undefined || rps === null) omitted.push("benchmark");
        else benchmark = { runsPerSeatPerWeek: rps, firstValueMedianMinutes: median };
      }
    }
    // diagnostics：见文件头「分节缺口」——已同意也缺席，如实列出。
    if (consent.diagnostics) omitted.push("diagnostics");

    const report = {
      schemaVersion: 1 as const,
      instanceId: instanceIdFromSecret(row.installSecret),
      edition: config.edition,
      productVersion: config.productVersion,
      periodEnd: periodEnd.toISOString(),
      // 只有两类来源能进报告：不按组织计的实例级事实，和 `facts.health` / `facts.firstValueFacts`
      // 在 SQL 层已排除 personal-local 的事实（返回类型把 `personalLocalExcluded: true` 做成了必带字面量）。
      // 没有第三条路径往报告里放按组织的计数——新增分节时必须同样经 `TelemetryFactsSource`。
      excludesPersonalLocalOrgs: true as const,
      consent,
      ...(health ? { health } : {}),
      ...(usage ? { usage } : {}),
      ...(benchmark ? { benchmark } : {}),
    };

    const parsed = T.InstanceTelemetryReport.safeParse(report);
    const attemptedAt = deps.now();
    if (!parsed.success) {
      await deps.state.recordAttempt({ attemptedAt, outcome: "invalid", omittedForLackOfData: omitted, report: null });
      deps.logger.error("instance telemetry report failed contract validation; not sent", {
        traceId: "instance-telemetry", err: parsed.error,
      });
      return { kind: "invalid" };
    }
    const body = JSON.stringify(parsed.data);
    const res = await deps.transport.post(endpoint, body, config.timeoutMs);
    // 存的就是发出去的那份字节（解析回对象），不是重新组装的一份。
    await deps.state.recordAttempt({ attemptedAt, outcome: res.ok ? "sent" : "failed", omittedForLackOfData: omitted, report: JSON.parse(body) });
    if (!res.ok) {
      deps.logger.info("instance telemetry send failed; dropped (no retry)", { traceId: "instance-telemetry" });
      return { kind: "failed" };
    }
    return { kind: "sent" };
  } catch (err) {
    deps.logger.error("instance telemetry cycle errored; dropped", { traceId: "instance-telemetry", err });
    return { kind: "failed" };
  }
}
