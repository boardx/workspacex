/**
 * D9 —— 客户实例侧运行信号上报（超级实例 S3）的端口。契约：`@repo/contracts` 的 `instanceTelemetry`
 * （ACCEPTED，D27）；设计：`docs/proposals/PROP-OPS-INSTANCE-TELEMETRY-001.md`、
 * `docs/research/super-instance-design.md` §3。
 *
 * 方向只有一个：实例 → 上报地址。这里没有任何「对端来读实例」的端口。
 */
import type { instanceTelemetry as T } from "@repo/contracts";

export type TelemetryConsent = T.TelemetryConsentValue;
export type TelemetryHealthFacts = import("zod").infer<typeof T.TelemetryHealth>;

/** 实例级状态（单行）：安装密钥 + 四项同意 + 最近一次尝试的原样报告。 */
export interface TelemetryStateRow {
  /** 安装时生成的随机密钥（hex）。**只在本机**；上报的是它的 SHA-256。 */
  readonly installSecret: string;
  readonly consent: TelemetryConsent;
  readonly last: {
    readonly attemptedAt: Date;
    readonly outcome: T.TelemetryAttemptOutcomeValue;
    readonly omittedForLackOfData: readonly T.TelemetryConsentItemValue[];
    /** 原样 JSON——发出去的就是 `JSON.stringify(report)` 这份。 */
    readonly report: unknown;
  } | null;
}

export interface TelemetryStateRepository {
  /** 没有行就建一行（生成安装密钥、写出厂默认同意），再读回。幂等。 */
  ensure(): Promise<TelemetryStateRow>;
  updateConsent(patch: Partial<TelemetryConsent>): Promise<TelemetryConsent>;
  recordAttempt(attempt: NonNullable<TelemetryStateRow["last"]>): Promise<void>;
}

/**
 * 运行事实来源（D16：只传运行事实）。每个方法要么给出**真实**数值，要么返回 `null` 表示本实例
 * 尚无真实来源——调用方据此让整节缺席，**不造数**。
 *
 * `personalLocalExcluded: true` 由实现方在 SQL 层真的排除了 `personal-local` 组织之后才给出；
 * 报告信封上的 `excludesPersonalLocalOrgs` 只从这里来。
 */
export interface TelemetryFactsSource {
  health(periodStart: Date, periodEnd: Date): Promise<{ facts: TelemetryHealthFacts; personalLocalExcluded: true } | null>;
}

export interface TelemetryTransport {
  /** 发一次。任何失败都以 `{ ok: false }` 返回，不抛。 */
  post(endpoint: string, body: string, timeoutMs: number): Promise<{ ok: boolean }>;
}

/** 部署配置（来源见 `infrastructure/telemetry/telemetry-config.ts`，环境变量名的单点在那里）。 */
export interface TelemetryConfig {
  /** `null` ⇒ 未配置上报地址，整个上报关闭。 */
  readonly endpoint: string | null;
  readonly killSwitch: boolean;
  readonly timeoutMs: number;
  readonly productVersion: string;
}

export const TELEMETRY_CONFIG = Symbol("TELEMETRY_CONFIG");
export const TELEMETRY_STATE_REPOSITORY = Symbol("TELEMETRY_STATE_REPOSITORY");
export const TELEMETRY_FACTS_SOURCE = Symbol("TELEMETRY_FACTS_SOURCE");
export const TELEMETRY_TRANSPORT = Symbol("TELEMETRY_TRANSPORT");
