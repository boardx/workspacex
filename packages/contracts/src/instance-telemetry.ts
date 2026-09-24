/**
 * PROPOSED —— 客户实例运行信号上报契约（超级实例 S2）。**待人类签核，尚未生效。**
 *
 * 本文件刻意**不从 `index.ts` 导出**，也不修改任何既有操作，照 `capability-runtime-policy.ts`
 * 的先例办理：契约先起草、公开，人类签核（UI / 用例 / API 三件）之后才允许任何控制器消费它。
 * 设计依据：`docs/research/super-instance-design.md` §3；人类决策 D14（既是也不是）；待决 D16。
 *
 * ## 这份契约要守住的一句话
 *
 * **能不能从上报里重建出客户的一句话？能就不许传。**
 *
 * 所以这里的每一个叶子字段都只能是：数字、布尔、枚举、或受正则约束的短标识符。
 * **没有任何自由文本字段**——自由文本是客户内容唯一能挤进来的缝。这条由
 * `.harness/scripts/lint-telemetry-schema.mjs`（R8）机械检查，不靠评审自觉。
 *
 * ## 五条设计约束，各自落在哪
 *
 * | 约束 | 落点 |
 * |---|---|
 * | 出站上报，运营面对客户实例零读权限 | 本契约只有「实例 → 边缘」一个方向；没有任何「边缘 → 实例」的请求形状 |
 * | 传信号不传内容 | 全部 `.strict()`（多一个字段即拒）+ 无自由文本（R8 门控） |
 * | `personal-local` 一行不上报 | `excludesPersonalLocalOrgs: true` 为字面量必填，上报方必须显式声明已排除 |
 * | 同意不坍缩成布尔 | 四项独立同意；某项未同意时对应分节**必须缺席**（refine 强制） |
 * | 边缘只存投影、可重建 | 契约只描述上报内容，不承载任何只存在于边缘的事实 |
 *
 * ## 为什么不复用 `consent-item.ts`
 *
 * 那份是「一个人对这场对话被怎么处理授了哪几项权」（录音 / 转写 / AI 归纳 / 署名），
 * 对象是**自然人与对话**。这里是「一个组织的实例向我们报告哪几类运行信号」，对象是**实例**。
 * 复用的是它的**结构**——多项独立、互不合并、每项有自己的下游——不是它的枚举。
 * 把两者合成一份，会让「录音同意」与「遥测同意」共用名字，那才是真的一词两义。
 */
import { z } from "zod";
import { DeploymentEdition } from "./deployment";

/** 四项上报同意——本契约内的唯一事实源。 */
export const TelemetryConsentItem = z.enum(["health", "usage", "diagnostics", "benchmark"]);
export type TelemetryConsentItemValue = z.infer<typeof TelemetryConsentItem>;

/** 每项同意关掉后客户会失去什么——要在设置页原样展示给客户，所以放进契约。 */
export const TELEMETRY_CONSENT_COPY: Record<TelemetryConsentItemValue, { label: string; ifOff: string }> = {
  health: { label: "健康信号", ifOff: "我们看不到这个实例是否活着，不承诺主动发现故障" },
  usage: { label: "用量计数", ifOff: "无法按用量计价，只能按合同约定" },
  diagnostics: { label: "错误指纹", ifOff: "报障时需要你自己导出日志" },
  benchmark: { label: "同行对标", ifOff: "不进入跨客户对标基线，也收不到「你比同行慢在哪」的回馈" },
};

/** 实例的不可逆标识：安装时生成的随机密钥的 SHA-256。不含组织名、域名或任何可读信息。 */
export const InstanceId = z.string().regex(/^[0-9a-f]{64}$/, "实例标识必须是 64 位小写十六进制（不可逆哈希）");

const SemVer = z.string().regex(/^\d+\.\d+\.\d+$/);
const Ratio = z.number().min(0).max(1);
const Count = z.number().int().min(0);
const Millis = z.number().min(0);

export const TelemetryHealth = z
  .object({
    uptimeRatio: Ratio,
    latencyP50Ms: Millis,
    latencyP95Ms: Millis,
    queueDepth: Count,
    diskUsedRatio: Ratio,
    /** 数据库迁移号，形如 `0009`。 */
    migrationVersion: z.string().regex(/^\d{4}$/),
  })
  .strict();

export const TelemetryUsage = z
  .object({
    runCount: Count,
    tokenCount: Count,
    seatCount: Count,
    /** 普通组织数。`personal-local` 组织不计入——见信封上的 `excludesPersonalLocalOrgs`。 */
    organizationCount: Count,
    skillPackRuns: z
      .array(
        z
          .object({
            /** 技能包能力编号，形如 `WX-S021` 或 `<vendor>-<id>`；是编号不是名字。 */
            capabilityId: z.string().regex(/^(WX-S\d+|[a-z][a-z0-9]*-[A-Za-z0-9._-]{1,48})$/),
            runCount: Count,
          })
          .strict(),
      )
      .max(500),
  })
  .strict();

export const TelemetryDiagnostics = z
  .object({
    errorFingerprints: z
      .array(
        z
          .object({
            /** 堆栈的 SHA-256；**不带**消息文本、参数或请求体。 */
            fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
            /** 机器可读错误码，形如 `RUN_TIMEOUT`。 */
            errorCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
            count: Count,
          })
          .strict(),
      )
      .max(200),
  })
  .strict();

export const TelemetryBenchmark = z
  .object({
    runsPerSeatPerWeek: z.number().min(0),
    firstValueMedianMinutes: z.number().min(0),
  })
  .strict();

const SECTION_BY_CONSENT = {
  health: "health",
  usage: "usage",
  diagnostics: "diagnostics",
  benchmark: "benchmark",
} as const satisfies Record<TelemetryConsentItemValue, string>;

export const InstanceTelemetryReport = z
  .object({
    schemaVersion: z.literal(1),
    instanceId: InstanceId,
    edition: DeploymentEdition,
    productVersion: SemVer,
    /** ISO 8601 时间戳，上报周期的结束时刻。 */
    periodEnd: z.string().datetime(),
    /** 上报方必须显式声明：所有计数都已排除 `personal-local` 组织。字面量 true，不接受 false。 */
    excludesPersonalLocalOrgs: z.literal(true),
    consent: z.object({ health: z.boolean(), usage: z.boolean(), diagnostics: z.boolean(), benchmark: z.boolean() }).strict(),
    health: TelemetryHealth.optional(),
    usage: TelemetryUsage.optional(),
    diagnostics: TelemetryDiagnostics.optional(),
    benchmark: TelemetryBenchmark.optional(),
  })
  .strict()
  .superRefine((r, ctx) => {
    for (const item of TelemetryConsentItem.options) {
      const section = SECTION_BY_CONSENT[item];
      const present = r[section] !== undefined;
      if (present && !r.consent[item]) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [section], message: `未同意「${TELEMETRY_CONSENT_COPY[item].label}」，这一节必须缺席` });
      }
    }
  });
export type InstanceTelemetryReportValue = z.infer<typeof InstanceTelemetryReport>;
